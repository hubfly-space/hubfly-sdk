package realtime

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type captured struct {
	Method string
	Path   string
	Query  url.Values
	Body   []byte
	JSON   map[string]any
}

// fakeAPI is an httptest server that verifies every request's signature like the engine
// (decoded parameters, lower-cased, sorted, unescaped; body_md5) and answers with reply.
func fakeAPI(t *testing.T, key, secret string, reply func(c *captured, n int) (int, any)) (*httptest.Server, func() []*captured) {
	t.Helper()
	var mu sync.Mutex
	var calls []*captured
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		c := &captured{Method: r.Method, Path: r.URL.Path, Query: r.URL.Query(), Body: body}
		if len(body) > 0 {
			_ = json.Unmarshal(body, &c.JSON)
		}
		if err := verifySignature(c, key, secret); err != nil {
			t.Errorf("%s %s: %v", r.Method, r.URL.Path, err)
		}
		mu.Lock()
		calls = append(calls, c)
		n := len(calls)
		mu.Unlock()
		status, out := 200, any(map[string]any{})
		if reply != nil {
			status, out = reply(c, n)
		}
		if status == 503 {
			w.Header().Set("Retry-After", "0")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(out)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []*captured {
		mu.Lock()
		defer mu.Unlock()
		return append([]*captured(nil), calls...)
	}
}

func verifySignature(c *captured, key, secret string) error {
	params := map[string]string{}
	for k, v := range c.Query {
		params[strings.ToLower(k)] = v[0]
	}
	sig := params["auth_signature"]
	delete(params, "auth_signature")
	if params["auth_key"] != key || params["auth_version"] != "1.0" {
		return errors.New("auth_key/auth_version")
	}
	if len(c.Body) > 0 {
		sum := md5.Sum(c.Body)
		if params["body_md5"] != hex.EncodeToString(sum[:]) {
			return errors.New("body_md5")
		}
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	if refHMAC(secret, c.Method+"\n"+c.Path+"\n"+strings.Join(parts, "&")) != sig {
		return errors.New("bad signature")
	}
	return nil
}

const (
	testKey    = "k3n9x2m4q8w1e7r5t6y0"
	testSecret = "go-test-secret-0123456789"
	socketA    = "1234567890.1234567890"
)

func testClient(t *testing.T, srv *httptest.Server, keys string) *Client {
	return &Client{URL: srv.URL, AppID: "1000001", Key: testKey, Secret: testSecret, EncryptionKeys: keys}
}

func vectorKeys(t *testing.T) (string, *vectorFile) {
	v, _ := loadVectors(t)
	return "k1:" + v.MasterKeys[0].Key + ",k0:" + v.MasterKeys[1].Key, v
}

func TestSignQueryPusherRESTVector(t *testing.T) {
	body := []byte(`{"name":"foo","channels":["project-3"],"data":"{\"some\":\"data\"}"}`)
	got := docClient().SignQuery("POST", "/apps/3/events", nil, body, time.Unix(1353088179, 0))
	want := "auth_key=278d425bdf160c739803&auth_timestamp=1353088179&auth_version=1.0&body_md5=ec365a775a4cd0599faeb73354201b6f" +
		"&auth_signature=da454824c97ba181a32ccc17a72625ba02771f50b50e1e7430e47a1f3f457e6c"
	if got != want {
		t.Errorf("SignQuery =\n%s\nwant\n%s", got, want)
	}
}

func TestTrigger(t *testing.T) {
	ctx := context.Background()
	keys, v := vectorKeys(t)
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		if strings.HasSuffix(c.Path, "/batch_events") {
			return 200, map[string]any{"batch": []any{map[string]any{"subscription_count": 1}, map[string]any{"subscription_count": 2}}}
		}
		return 200, map[string]any{}
	})
	c := testClient(t, srv, keys)
	e2eID := v.ConnectionIDs[0].ID

	if _, err := c.Trigger(ctx, []string{"orders", "presence-room"}, "order.updated", map[string]int{"id": 1}, &TriggerOptions{SocketID: e2eID, Info: []string{"subscription_count"}}); err != nil {
		t.Fatal(err)
	}
	got := calls()[0]
	if got.Path != "/apps/1000001/events" || got.JSON["data"] != `{"id":1}` || got.JSON["socket_id"] != socketA || got.JSON["info"] != "subscription_count" || got.JSON["name"] != "order.updated" {
		t.Errorf("plain trigger body %s", got.Body)
	}

	if _, err := c.Trigger(ctx, []string{"private-encrypted-orders"}, "order.updated", map[string]int{"id": 1}, nil); err != nil {
		t.Fatal(err)
	}
	enc := calls()[1].JSON
	pt, err := DecryptPusher([][]byte{mustB64(t, v.Derive[0].Key)}, []byte(enc["data"].(string)))
	if err != nil || string(pt) != `{"id":1}` || enc["name"] != "order.updated" {
		t.Errorf("encrypted trigger: %s %v", pt, err)
	}

	res, err := c.Trigger(ctx, []string{"private-encrypted-orders", "orders"}, "e", "x", &TriggerOptions{Info: []string{"subscription_count"}})
	if err != nil {
		t.Fatal(err)
	}
	batch := calls()[2]
	if batch.Path != "/apps/1000001/batch_events" || len(batch.JSON["batch"].([]any)) != 2 {
		t.Errorf("multi-channel encrypted trigger should batch: %s", batch.Body)
	}
	if *res.Channels["orders"].SubscriptionCount != 2 {
		t.Errorf("batch result %+v", res)
	}

	if _, err := (&Client{URL: srv.URL, AppID: "1", Key: testKey, Secret: testSecret}).Trigger(ctx, []string{"private-encrypted-x"}, "e", 1, nil); err == nil {
		t.Error("encrypted channel without keys accepted")
	}
	if _, err := c.Trigger(ctx, []string{"private-encrypted-x"}, "e", 1, &TriggerOptions{Encrypt: Bool(false)}); err == nil {
		t.Error("encrypted channel with Encrypt=false accepted")
	}
	for _, bad := range [][2]string{{"bad channel", "e"}, {"ok", "pusher:x"}, {"ok", "hubfly:x"}} {
		if _, err := c.Trigger(ctx, []string{bad[0]}, bad[1], 1, nil); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
}

func TestFullE2ETrigger(t *testing.T) {
	keys, _ := vectorKeys(t)
	srv, calls := fakeAPI(t, testKey, testSecret, nil)
	c := testClient(t, srv, keys)
	c.FullE2E = true
	if _, err := c.Trigger(context.Background(), []string{"private-orders"}, "order.updated", map[string]int{"id": 1}, nil); err != nil {
		t.Fatal(err)
	}
	body := calls()[0].JSON
	km, _ := ParseKeyList(keys)
	msg, kid, err := DecryptV1(func(string) []byte { return DeriveKey("private-orders", km[0].Key) }, []byte(body["data"].(string)))
	if err != nil || body["name"] != E2EEvent || kid != "k1" || msg.E != "order.updated" || msg.To != "private-orders" || string(msg.D) != `{"id":1}` {
		t.Errorf("full e2e: %+v %v %s", msg, err, body["name"])
	}
}

func TestPublish(t *testing.T) {
	ctx := context.Background()
	keys, v := vectorKeys(t)
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		ch := c.JSON["channels"].([]any)[0].(string)
		return 200, map[string]any{"message_id": c.JSON["message_id"], "channels": map[string]any{ch: map[string]any{"epoch": "e7k2m9", "offset": 43}}}
	})
	c := testClient(t, srv, "")
	res, err := c.Publish(ctx, []string{"orders"}, "order.updated", map[string]int{"id": 1}, &PublishOptions{MessageID: "order-1-v2", SocketID: socketA})
	if err != nil {
		t.Fatal(err)
	}
	b := calls()[0]
	if b.Path != "/apps/1000001/hubfly/v1/publish" || b.JSON["message_id"] != "order-1-v2" || b.JSON["socket_id"] != socketA {
		t.Errorf("publish body %s", b.Body)
	}
	if d, _ := json.Marshal(b.JSON["data"]); string(d) != `{"id":1}` {
		t.Errorf("publish data %s", d)
	}
	if res.MessageID != "order-1-v2" || res.Channels["orders"] != (Position{"e7k2m9", 43}) || res.MessageIDs != nil {
		t.Errorf("publish result %+v", res)
	}
	if _, err := c.Publish(ctx, []string{"a"}, "x", 1, nil); err != nil || !regexp.MustCompile(`^m_[0-9A-HJKMNP-TV-Z]{26}$`).MatchString(calls()[1].JSON["message_id"].(string)) {
		t.Errorf("generated id: %v %v", err, calls()[1].JSON["message_id"])
	}
	if _, err := c.Publish(ctx, []string{"a"}, "x", 1, &PublishOptions{MessageID: "bad id"}); err == nil {
		t.Error("bad message id accepted")
	}

	enc := testClient(t, srv, keys)
	res, err = enc.Publish(ctx, []string{"private-encrypted-orders", "orders"}, "created", map[string]int{"id": 7}, &PublishOptions{MessageID: "abc"})
	if err != nil {
		t.Fatal(err)
	}
	split := calls()[2:]
	ids := []string{split[0].JSON["message_id"].(string), split[1].JSON["message_id"].(string)}
	sort.Strings(ids)
	if ids[0] != "abc.0" || ids[1] != "abc.1" || res.MessageIDs["private-encrypted-orders"] != "abc.0" || res.MessageIDs["orders"] != "abc.1" || len(res.Channels) != 2 {
		t.Errorf("split publish %+v %v", res, ids)
	}
	for _, s := range split {
		if s.JSON["channels"].([]any)[0] == "private-encrypted-orders" {
			pt, err := DecryptPusher([][]byte{mustB64(t, v.Derive[0].Key)}, []byte(s.JSON["data"].(string)))
			if err != nil || string(pt) != `{"id":7}` {
				t.Errorf("encrypted publish: %s %v", pt, err)
			}
		}
	}
}

func TestSendToConnections(t *testing.T) {
	ctx := context.Background()
	_, v := vectorKeys(t)
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		var results []any
		for _, s := range c.JSON["socket_ids"].([]any) {
			results = append(results, map[string]any{"socket_id": s, "status": "delivered"})
		}
		return 200, map[string]any{"message_id": c.JSON["message_id"], "results": results}
	})
	c := testClient(t, srv, "")
	e2eID := v.ConnectionIDs[0].ID
	plainIDs := []string{"1111111111.2222222222", "3333333333.4444444444"}
	res, err := c.SendToConnections(ctx, append(plainIDs, e2eID), "order.updated", map[string]string{"orderId": "o_9"}, &SendOptions{MessageID: "send-1", Ack: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(calls()) != 2 {
		t.Fatalf("%d requests", len(calls()))
	}
	for _, cl := range calls() {
		ids := cl.JSON["socket_ids"].([]any)
		if cl.JSON["ack"] != true {
			t.Error("ack missing")
		}
		if len(ids) == 2 {
			if cl.JSON["message_id"] != "send-1.0" || cl.JSON["event"] != "order.updated" {
				t.Errorf("plain request %s", cl.Body)
			}
			continue
		}
		key, _ := base64.RawURLEncoding.DecodeString(v.ConnectionIDs[0].Key)
		msg, kid, err := DecryptV1(func(string) []byte { return key }, []byte(cl.JSON["data"].(string)))
		if err != nil || cl.JSON["event"] != E2EEvent || kid != "c" || msg.To != "#direct-"+socketA || msg.M != "send-1.1" || string(msg.D) != `{"orderId":"o_9"}` {
			t.Errorf("e2e request: %+v %v", msg, err)
		}
	}
	got := map[string]string{}
	for _, r := range res.Results {
		got[r.ID] = r.MessageID + "/" + r.Status
	}
	if res.MessageID != "send-1" || got[e2eID] != "send-1.1/delivered" || got[plainIDs[0]] != "send-1.0/delivered" || len(got) != 3 {
		t.Errorf("results %+v", res)
	}

	if _, err := c.SendToConnection(ctx, e2eID, "x", 1, &SendOptions{MessageID: "only", Encrypt: Bool(false)}); err != nil {
		t.Fatal(err)
	}
	last := calls()[2].JSON
	if last["message_id"] != "only" || last["event"] != "x" || last["ack"] != nil {
		t.Errorf("single request %v", last)
	}
	if _, err := c.SendToConnection(ctx, socketA, "x", 1, &SendOptions{Encrypt: Bool(true)}); err == nil {
		t.Error("Encrypt=true with a plain socket id accepted")
	}
	if _, err := c.SendToConnection(ctx, "nope", "x", 1, nil); err == nil {
		t.Error("invalid id accepted")
	}
}

func TestSendToUsers(t *testing.T) {
	ctx := context.Background()
	keys, _ := vectorKeys(t)
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		var results []any
		for _, u := range c.JSON["user_ids"].([]any) {
			results = append(results, map[string]any{"user_id": u, "status": "queued", "connections": 0})
		}
		return 200, map[string]any{"results": results}
	})
	c := testClient(t, srv, keys)
	res, err := c.SendToUsers(ctx, []string{"u_42", "u_43"}, "notice", map[string]string{"text": "Hi"}, &SendOptions{MessageID: "n1"})
	if err != nil {
		t.Fatal(err)
	}
	km, _ := ParseKeyList(keys)
	for _, cl := range calls() {
		user := cl.JSON["user_ids"].([]any)[0].(string)
		ctxName := "#server-to-user-" + user
		msg, kid, err := DecryptV1(func(string) []byte { return DeriveKey(ctxName, km[0].Key) }, []byte(cl.JSON["data"].(string)))
		if err != nil || kid != "k1" || msg.To != ctxName || msg.E != "notice" {
			t.Errorf("user message for %s: %+v %v", user, msg, err)
		}
	}
	if len(res.Results) != 2 || res.Results[0].ID == "" {
		t.Errorf("results %+v", res)
	}
	plainClient := testClient(t, srv, "")
	if _, err := plainClient.SendToUser(ctx, "u_1", "notice", 1, nil); err != nil {
		t.Fatal(err)
	}
	if last := calls()[2].JSON; last["event"] != "notice" || last["data"] != float64(1) {
		t.Errorf("plaintext user message %v", last)
	}
	if _, err := plainClient.SendToUser(ctx, "u_1", "n", 1, &SendOptions{Encrypt: Bool(true)}); err == nil {
		t.Error("Encrypt=true without keys accepted")
	}
}

func TestStatusAndHistory(t *testing.T) {
	ctx := context.Background()
	keys, v := vectorKeys(t)
	km, _ := ParseKeyList(keys)
	v1env, _ := EncryptV1(DeriveKey("private-encrypted-orders", km[1].Key), "k0", V1Message{E: "client-typing", D: json.RawMessage(`{"t":1}`), To: "private-encrypted-orders", M: "x1", T: 1})
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		switch {
		case strings.Contains(c.Path, "/history/orders"):
			return 200, map[string]any{"channel": "orders", "epoch": "e1", "head": 3, "oldest": 1, "messages": []any{
				map[string]any{"offset": 1, "event": "a", "data": `{"id":1}`, "message_id": "a"},
				map[string]any{"offset": 2, "event": "b", "data": "plain text", "message_id": "b"},
				map[string]any{"offset": 3, "event": "c", "data": "42", "message_id": "c", "user_id": "u_1"},
			}}
		case strings.Contains(c.Path, "/connections/1111111111.1111111111"):
			return 404, map[string]any{"online": false}
		case strings.HasSuffix(c.Path, "/terminate"):
			return 200, map[string]any{"terminated": true}
		case strings.Contains(c.Path, "/connections/"):
			return 200, map[string]any{"socket_id": socketA, "online": true, "state": "connected"}
		case strings.Contains(c.Path, "/users/u_gone"):
			return 404, map[string]any{"error": "not found"}
		case strings.Contains(c.Path, "/users/"):
			return 200, map[string]any{"user_id": "u_1", "online": true, "connections": 2, "socket_ids": []string{socketA}}
		case strings.Contains(c.Path, "/messages/m_unknown"):
			return 404, map[string]any{"error": "not found"}
		case strings.Contains(c.Path, "/messages/"):
			return 200, map[string]any{"message_id": "m_1", "event": "x", "targets": []any{map[string]any{"socket_id": socketA, "status": "acked"}}}
		case strings.Contains(c.Path, "/history/"):
			if c.Query.Get("limit") != "10" || c.Query.Get("since") != "0" || c.Query.Get("epoch") != "e1" {
				t.Errorf("history query %v", c.Query)
			}
			return 200, map[string]any{"channel": "private-encrypted-orders", "epoch": "e1", "head": 3, "oldest": 1, "messages": []any{
				map[string]any{"offset": 1, "event": "order.updated", "data": v.Pusher[0].Envelope, "message_id": "a"},
				map[string]any{"offset": 2, "event": "client-hubfly.e2e", "data": v1env, "message_id": "b"},
				map[string]any{"offset": 3, "event": "order.updated", "data": `{"nonce":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY","ciphertext":"AgMEBQYHCAkKCwwNDg8QEQ=="}`, "message_id": "c"},
			}}
		}
		return 500, map[string]any{"error": "unexpected"}
	})
	c := testClient(t, srv, keys)
	if ok, err := c.IsOnline(ctx, v.ConnectionIDs[0].ID); err != nil || !ok {
		t.Errorf("IsOnline: %v %v", ok, err)
	}
	if st, err := c.ConnectionStatus(ctx, "1111111111.1111111111"); err != nil || st.Online || st.SocketID != "1111111111.1111111111" {
		t.Errorf("unknown connection: %+v %v", st, err)
	}
	if err := c.TerminateConnection(ctx, v.ConnectionIDs[0].ID); err != nil {
		t.Error(err)
	}
	if err := c.DisconnectConnection(ctx, v.ConnectionIDs[0].ID); err != nil {
		t.Error(err)
	}
	if got := calls(); got[len(got)-2].JSON["mode"] != "terminate" || got[len(got)-1].JSON["mode"] != "disconnect" || !strings.HasSuffix(got[len(got)-1].Path, "/hubfly/v1/connections/"+socketA+"/terminate") {
		t.Errorf("terminate modes: %+v %+v", got[len(got)-2], got[len(got)-1])
	}
	if st, err := c.UserStatus(ctx, "u_1"); err != nil || st.Connections != 2 {
		t.Errorf("UserStatus %+v %v", st, err)
	}
	if st, err := c.UserStatus(ctx, "u_gone"); err != nil || st.Online {
		t.Errorf("unknown user %+v %v", st, err)
	}
	if r, err := c.MessageReceipt(ctx, "m_1"); err != nil || r.Targets[0].Status != "acked" {
		t.Errorf("receipt %+v %v", r, err)
	}
	if r, err := c.MessageReceipt(ctx, "m_unknown"); err != nil || r != nil {
		t.Errorf("unknown receipt %+v %v", r, err)
	}
	since := int64(0)
	h, err := c.History(ctx, "private-encrypted-orders", &HistoryOptions{Since: &since, Epoch: "e1", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if !h.Messages[0].Encrypted || string(h.Messages[0].Data) != v.Pusher[0].Plaintext || h.Messages[0].Event != "order.updated" {
		t.Errorf("history[0] %+v", h.Messages[0])
	}
	if h.Messages[1].Event != "client-typing" || string(h.Messages[1].Data) != `{"t":1}` {
		t.Errorf("history[1] %+v", h.Messages[1])
	}
	if h.Messages[2].E2EError != "decrypt_failed" {
		t.Errorf("history[2] %+v", h.Messages[2])
	}
	raw, _ := c.History(ctx, "private-encrypted-orders", &HistoryOptions{Since: &since, Epoch: "e1", Limit: 10, Raw: true})
	if raw.Messages[0].Encrypted {
		t.Error("Raw decrypted")
	}
	// Plaintext is decoded like client handlers receive it; Raw keeps the stored JSON string.
	plain, err := c.History(ctx, "orders", nil)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range plain.Messages {
		got = append(got, string(m.Data))
	}
	if strings.Join(got, " ") != `{"id":1} "plain text" 42` || plain.Messages[2].UserID != "u_1" {
		t.Errorf("plaintext history %q %+v", got, plain.Messages[2])
	}
	if rawPlain, _ := c.History(ctx, "orders", &HistoryOptions{Raw: true}); string(rawPlain.Messages[0].Data) != `"{\"id\":1}"` {
		t.Errorf("raw plaintext %s", rawPlain.Messages[0].Data)
	}
}

func TestRetriesAndErrors(t *testing.T) {
	ctx := context.Background()
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		if n == 1 {
			return 503, map[string]any{"error": "draining"}
		}
		return 200, map[string]any{"message_id": c.JSON["message_id"], "channels": map[string]any{}}
	})
	c := testClient(t, srv, "")
	if res, err := c.Publish(ctx, []string{"a"}, "x", 1, &PublishOptions{MessageID: "retry-me"}); err != nil || res.MessageID != "retry-me" {
		t.Fatalf("publish after 503: %v", err)
	}
	if n := len(calls()); n != 2 || calls()[1].JSON["message_id"] != "retry-me" {
		t.Errorf("%d calls", n)
	}

	srv2, calls2 := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		return 403, map[string]any{"error": "Plaintext rejected", "reason": "e2e_required"}
	})
	_, err := testClient(t, srv2, "").Trigger(ctx, []string{"a"}, "x", 1, nil)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 403 || apiErr.Reason != "e2e_required" || apiErr.Message != "Plaintext rejected" {
		t.Errorf("api error %#v", err)
	}
	if len(calls2()) != 1 {
		t.Error("non-idempotent request retried")
	}
	srv3, calls3 := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		return 503, map[string]any{"error": "draining"}
	})
	noRetry := testClient(t, srv3, "")
	noRetry.DisableRetry = true
	if _, err := noRetry.Publish(ctx, []string{"a"}, "x", 1, nil); err == nil || len(calls3()) != 1 {
		t.Errorf("DisableRetry: %v, %d calls", err, len(calls3()))
	}
}

func TestChannelsEndpoints(t *testing.T) {
	ctx := context.Background()
	srv, calls := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		switch {
		case strings.HasSuffix(c.Path, "/users") && strings.Contains(c.Path, "/channels/"):
			return 200, map[string]any{"users": []any{map[string]any{"id": "u_1"}}}
		case strings.Contains(c.Path, "/channels/"):
			return 200, map[string]any{"occupied": true, "user_count": 2}
		case strings.HasSuffix(c.Path, "/channels"):
			return 200, map[string]any{"channels": map[string]any{"presence-room": map[string]any{"user_count": 2}}}
		}
		return 200, map[string]any{}
	})
	c := testClient(t, srv, "")
	if r, err := c.Channels(ctx, "presence-", []string{"user_count"}); err != nil || *r.Channels["presence-room"].UserCount != 2 {
		t.Errorf("Channels %+v %v", r, err)
	}
	if q := calls()[0].Query; q.Get("filter_by_prefix") != "presence-" || q.Get("info") != "user_count" {
		t.Errorf("query %v", q)
	}
	if r, err := c.ChannelInfo(ctx, "presence-room", []string{"user_count"}); err != nil || !r.Occupied {
		t.Errorf("ChannelInfo %+v %v", r, err)
	}
	if u, err := c.ChannelUsers(ctx, "presence-room"); err != nil || len(u) != 1 || u[0] != "u_1" {
		t.Errorf("ChannelUsers %v %v", u, err)
	}
	if err := c.TerminateUserConnections(ctx, "u_1"); err != nil || calls()[3].Path != "/apps/1000001/users/u_1/terminate_connections" {
		t.Errorf("TerminateUserConnections %v", err)
	}
	if _, err := c.ChannelInfo(ctx, "#server-to-user-u1", nil); err == nil {
		t.Error("user channel path accepted")
	}
	if res, err := c.TriggerBatch(ctx, []BatchEvent{{Channel: "a", Name: "x", Data: 1}, {Channel: "b", Name: "y", Data: "two", SocketID: socketA}}); err != nil || res == nil {
		t.Fatal(err)
	}
	batch := calls()[4].JSON["batch"].([]any)
	if b0 := batch[0].(map[string]any); b0["data"] != "1" {
		t.Errorf("batch[0] %v", b0)
	}
	if b1 := batch[1].(map[string]any); b1["data"] != "two" || b1["socket_id"] != socketA {
		t.Errorf("batch[1] %v", b1)
	}
}

func TestDecryptHelper(t *testing.T) {
	keys, v := vectorKeys(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: keys}
	ev, d, err := c.Decrypt("private-encrypted-orders", "order.updated", v.Pusher[0].Envelope)
	if err != nil || ev != "order.updated" || string(d) != v.Pusher[0].Plaintext {
		t.Errorf("pusher: %s %s %v", ev, d, err)
	}
	quoted, _ := json.Marshal(v.V1[5].Envelope) // as a webhook data string inside JSON
	ev, d, err = c.Decrypt("private-encrypted-orders", ClientE2EEvent, json.RawMessage(quoted))
	if err != nil || ev != "client-typing" || string(d) != `{"typing":true}` {
		t.Errorf("v1: %s %s %v", ev, d, err)
	}
	if _, _, err := c.Decrypt("private-encrypted-other", ClientE2EEvent, v.V1[5].Envelope); reasonOf(err) != "unknown_kid" && reasonOf(err) != "decrypt_failed" && reasonOf(err) != "wrong_context" {
		t.Errorf("wrong context: %v", err)
	}
}

func TestClientValidation(t *testing.T) {
	for _, c := range []*Client{
		{URL: "ftp://x", AppID: "1", Key: "k", Secret: "s"},
		{URL: "::", AppID: "1", Key: "k", Secret: "s"},
		{URL: "https://x", AppID: "1/2", Key: "k", Secret: "s"},
		{URL: "https://x", AppID: "1", Key: "k"},
	} {
		if _, err := c.baseURL(); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	c := &Client{URL: "wss://a.rt.hubfly.app/", AppID: "1", Key: "k", Secret: "s"}
	if u, err := c.baseURL(); err != nil || u != "https://a.rt.hubfly.app" {
		t.Errorf("baseURL %q %v", u, err)
	}
	if _, err := (&Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: "k1:AAAA"}).AuthorizeChannel("1.2", "private-a", nil); err == nil {
		t.Error("bad encryption keys accepted")
	}
}

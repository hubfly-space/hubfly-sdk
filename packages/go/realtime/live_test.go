package realtime_test

// Live tests against a running HubFly Realtime instance or rt-devserver
// (hubfly-realtime/cmd/rt-devserver). Skipped unless HUBFLY_REALTIME_TEST_URL,
// HUBFLY_REALTIME_TEST_APP_ID, HUBFLY_REALTIME_TEST_KEY and HUBFLY_REALTIME_TEST_SECRET are set
// (an app with history kept, client events on, the offline queue on, a detach TTL of at least
// 10 s and the "optional" or "off" encryption policy).
// HUBFLY_REALTIME_TEST_REQUIRED_APP_ID/_KEY/_SECRET add the "required" policy checks.
//
//	HUBFLY_REALTIME_TEST_URL=http://127.0.0.1:6001 HUBFLY_REALTIME_TEST_APP_ID=1000001 \
//	HUBFLY_REALTIME_TEST_KEY=… HUBFLY_REALTIME_TEST_SECRET=… go test -run Live -v ./...

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/hubfly/hubfly-sdk/go/realtime"
)

type liveApp struct{ id, key, secret string }

// uniq returns a fresh suffix for channel names, user ids and message ids, so repeated runs
// (-count=N) against the same instance never share state.
func uniq() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// liveKeys are E2E master keys generated for this run; the instance never sees them.
var liveKeys = func() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "k1:" + base64.StdEncoding.EncodeToString(b)
}()

func liveEnv(t *testing.T, prefix string) liveApp {
	t.Helper()
	url := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	app := liveApp{os.Getenv(prefix + "APP_ID"), os.Getenv(prefix + "KEY"), os.Getenv(prefix + "SECRET")}
	if url == "" || app.id == "" || app.key == "" || app.secret == "" {
		t.Skip("set HUBFLY_REALTIME_TEST_URL and " + prefix + "APP_ID/_KEY/_SECRET to run the live tests")
	}
	return app
}

func liveClient(t *testing.T, app liveApp, keys string) *realtime.Client {
	return &realtime.Client{URL: os.Getenv("HUBFLY_REALTIME_TEST_URL"), AppID: app.id, Key: app.key, Secret: app.secret, EncryptionKeys: keys}
}

func liveCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); !cond(); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(end) {
			t.Fatalf("timeout waiting for %s", what)
		}
	}
}

func subscribers(t *testing.T, ctx context.Context, c *realtime.Client, channel string, n int) {
	t.Helper()
	waitFor(t, fmt.Sprintf("%d subscribers on %s", n, channel), func() bool {
		info, err := c.ChannelInfo(ctx, channel, []string{"subscription_count"})
		return err == nil && info.SubscriptionCount != nil && *info.SubscriptionCount == n
	})
}

func TestLiveTriggerPublishHistory(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	liveRun := uniq()
	ctx := liveCtx(t)
	c := liveClient(t, app, "")
	base := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	a := dialSocket(t, base, app.key, false)
	b := dialSocket(t, base, app.key, true)
	name := "go-live-" + liveRun
	for _, s := range []*liveSocket{a, b} {
		if f := s.Subscribe(name, "", ""); f.Event != "pusher_internal:subscription_succeeded" {
			t.Fatalf("subscribe: %s", f)
		}
	}
	subscribers(t, ctx, c, name, 2)

	// Pusher trigger, excluding a's socket (an E2E connection id is accepted too).
	res, err := c.Trigger(ctx, []string{name}, "plain", map[string]any{"ok": true}, &realtime.TriggerOptions{SocketID: a.SocketID, Info: []string{"subscription_count"}})
	if err != nil || res.Channels[name].SubscriptionCount == nil || *res.Channels[name].SubscriptionCount != 2 {
		t.Fatalf("Trigger %+v %v", res, err)
	}
	if f := b.Event("plain"); f.text() != `{"ok":true}` || f.Hubfly == nil || !strings.HasPrefix(f.Hubfly.ID, "m_") {
		t.Errorf("trigger frame %s %+v", f, f.Hubfly)
	}
	a.None("plain", 200*time.Millisecond)

	// HubFly publish with an idempotency key: one delivery, the same result twice.
	opts := &realtime.PublishOptions{MessageID: "go-" + liveRun}
	first, err := c.Publish(ctx, []string{name}, "created", map[string]int{"n": 1}, opts)
	if err != nil {
		t.Fatal(err)
	}
	again, err := c.Publish(ctx, []string{name}, "created", map[string]int{"n": 1}, opts)
	if err != nil || first.MessageID != opts.MessageID || again.Channels[name] != first.Channels[name] || first.Channels[name].Offset < 1 || first.Channels[name].Epoch == "" {
		t.Fatalf("idempotent publish: %+v %+v %v", first, again, err)
	}
	if f := b.Event("created"); f.text() != `{"n":1}` || f.Hubfly.ID != opts.MessageID || f.Hubfly.Offset != first.Channels[name].Offset || f.Hubfly.Epoch != first.Channels[name].Epoch {
		t.Errorf("publish frame %s %+v", f, f.Hubfly)
	}
	if f := a.Event("created"); f.Hubfly != nil {
		t.Errorf("the Pusher socket got HubFly metadata: %+v", f.Hubfly)
	}
	b.None("created", 300*time.Millisecond)
	if _, err := c.Publish(ctx, []string{name}, "created", "two", nil); err != nil {
		t.Fatal(err)
	}

	h, err := c.History(ctx, name, nil)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range h.Messages {
		got = append(got, m.Event+"="+string(m.Data))
	}
	if strings.Join(got, " ") != `plain={"ok":true} created={"n":1} created="two"` || *h.Head != first.Channels[name].Offset+1 {
		t.Errorf("history %q head %v", got, h.Head)
	}
	since := first.Channels[name].Offset
	if later, err := c.History(ctx, name, &realtime.HistoryOptions{Since: &since, Epoch: first.Channels[name].Epoch, Limit: 10}); err != nil || len(later.Messages) != 1 || string(later.Messages[0].Data) != `"two"` {
		t.Errorf("history since %+v %v", later, err)
	}
	list, err := c.Channels(ctx, "go-live-", nil)
	if _, ok := list.Channels[name]; err != nil || !ok {
		t.Errorf("Channels %+v %v", list, err)
	}
	batch, err := c.TriggerBatch(ctx, []realtime.BatchEvent{{Channel: name, Name: "b1", Data: 1}, {Channel: name, Name: "b2", Data: "x"}})
	if err != nil || batch == nil {
		t.Fatal(err)
	}
	if f := b.Event("b2"); f.text() != "x" {
		t.Errorf("batch frame %s", f)
	}
}

func TestLiveAuthPresenceAndUsers(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	liveRun := uniq()
	ctx := liveCtx(t)
	c := liveClient(t, app, "")
	base := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	s := dialSocket(t, base, app.key, true)
	other := dialSocket(t, base, app.key, false)

	priv := "private-go-" + liveRun
	auth, err := c.AuthorizeChannel(s.SocketID, priv, nil)
	if err != nil {
		t.Fatal(err)
	}
	if f := s.Subscribe(priv, auth.Auth, ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("private subscribe %s", f)
	}
	if f := other.Subscribe(priv, auth.Auth, ""); f.Event != "pusher:subscription_error" || !strings.Contains(f.text(), "401") {
		t.Errorf("a signature for another socket was accepted: %s", f)
	}

	pres := "presence-go-" + liveRun
	pa, err := c.AuthorizeChannel(s.SocketID, pres, &realtime.PresenceData{UserID: "u_go", UserInfo: map[string]string{"name": "Gopher"}})
	if err != nil {
		t.Fatal(err)
	}
	f := s.Subscribe(pres, pa.Auth, pa.ChannelData)
	if f.Event != "pusher_internal:subscription_succeeded" || !strings.Contains(f.text(), `"u_go":{"name":"Gopher"}`) {
		t.Fatalf("presence subscribe %s", f)
	}
	if users, err := c.ChannelUsers(ctx, pres); err != nil || len(users) != 1 || users[0] != "u_go" {
		t.Errorf("ChannelUsers %v %v", users, err)
	}
	if info, err := c.ChannelInfo(ctx, pres, []string{"user_count"}); err != nil || !info.Occupied || info.UserCount == nil || *info.UserCount != 1 {
		t.Errorf("ChannelInfo %+v %v", info, err)
	}

	// Sign in, then user messages on #server-to-user-<id>.
	user := "u_go_" + liveRun
	ua, err := c.AuthenticateUser(s.SocketID, realtime.UserData{ID: user})
	if err != nil {
		t.Fatal(err)
	}
	s.Send("pusher:signin", map[string]string{"auth": ua.Auth, "user_data": ua.UserData}, "")
	s.Next(func(f frame) bool { return f.Event == "pusher:signin_success" })
	if f := s.Subscribe("#server-to-user-"+user, "", ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("user channel %s", f)
	}
	st, err := c.UserStatus(ctx, user)
	if err != nil || !st.Online || st.Connections != 1 || st.SocketIDs[0] != s.SocketID {
		t.Errorf("UserStatus %+v %v", st, err)
	}
	if cs, err := c.ConnectionStatus(ctx, s.SocketID); err != nil || cs.UserID != user || cs.Protocol != "hubfly" || cs.State != "connected" {
		t.Errorf("ConnectionStatus %+v %v", cs, err)
	}
	res, err := c.SendToUser(ctx, user, "notice", map[string]string{"text": "Hi"}, &realtime.SendOptions{Ack: true})
	if err != nil || len(res.Results) != 1 || res.Results[0].Status != "delivered" || res.Results[0].Connections != 1 || res.Results[0].ID != user {
		t.Fatalf("SendToUser %+v %v", res, err)
	}
	f = s.Event("notice")
	if f.Channel != "#server-to-user-"+user || f.text() != `{"text":"Hi"}` || f.Hubfly.Kind != "user" || !f.Hubfly.Ack || f.Hubfly.ID != res.MessageID {
		t.Errorf("user message %s %+v", f, f.Hubfly)
	}
	s.Send("hubfly:ack", map[string]any{"m": []string{f.Hubfly.ID}}, "")
	waitFor(t, "the acked receipt", func() bool {
		r, err := c.MessageReceipt(ctx, res.MessageID)
		return err == nil && r != nil && len(r.Targets) == 1 && r.Targets[0].Status == "acked" && r.Targets[0].UserID == user
	})
	if off, err := c.SendToUser(ctx, "u_nobody_"+liveRun, "n", 1, nil); err != nil || (off.Results[0].Status != "offline" && off.Results[0].Status != "queued") {
		t.Errorf("offline user %+v %v", off, err)
	}
	if err := c.TerminateUserConnections(ctx, user); err != nil {
		t.Fatal(err)
	}
	if code := s.WaitClose(); code != 4009 {
		t.Errorf("close code %d, want 4009", code)
	}
}

func TestLiveE2EDirectAndEncryptedChannels(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	liveRun := uniq()
	ctx := liveCtx(t)
	c := liveClient(t, app, liveKeys)
	base := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	s := dialSocket(t, base, app.key, true)
	if s.Hello == nil || s.Hello["session_token"] == "" || s.Hello["resumed"] != false {
		t.Errorf("hello %+v", s.Hello)
	}

	// The browser's E2E connection id: its socket id plus a key that never reaches HubFly.
	k := make([]byte, 32)
	_, _ = rand.Read(k)
	id, err := realtime.FormatConnectionID(s.SocketID, k)
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.SendToConnection(ctx, id, "order.updated", map[string]any{"orderId": "o_1", "note": "café ✓"}, &realtime.SendOptions{Ack: true})
	if err != nil || res.Results[0].Status != "delivered" || res.Results[0].ID != id || res.Results[0].SocketID != s.SocketID {
		t.Fatalf("SendToConnection %+v %v", res, err)
	}
	f := s.Event(realtime.E2EEvent)
	if f.Hubfly.Kind != "direct" || !f.Hubfly.Ack || f.Hubfly.ID != res.MessageID {
		t.Errorf("direct meta %+v", f.Hubfly)
	}
	msg, kid, err := realtime.DecryptV1(func(kid string) []byte {
		if kid == "c" {
			return k
		}
		return nil
	}, []byte(f.text()))
	if err != nil || kid != "c" || msg.E != "order.updated" || msg.To != "#direct-"+s.SocketID || msg.M != res.MessageID || string(msg.D) != `{"note":"café ✓","orderId":"o_1"}` {
		t.Fatalf("direct envelope %+v %s %v", msg, kid, err)
	}
	s.Send("hubfly:ack", map[string]any{"m": []string{f.Hubfly.ID}}, "")
	waitFor(t, "the acked receipt", func() bool {
		r, err := c.MessageReceipt(ctx, res.MessageID)
		return err == nil && r != nil && r.Event == realtime.E2EEvent && r.Targets[0].Status == "acked"
	})

	// private-encrypted-*: the shared secret from the auth response opens Pusher envelopes.
	enc := "private-encrypted-go-" + liveRun
	auth, err := c.AuthorizeChannel(s.SocketID, enc, nil)
	if err != nil || auth.SharedSecret == "" || auth.HubFly == nil || auth.HubFly.Keys[0].Kid != "k1" {
		t.Fatalf("AuthorizeChannel %+v %v", auth, err)
	}
	if f := s.Subscribe(enc, auth.Auth, ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("encrypted subscribe %s", f)
	}
	if _, err := c.Publish(ctx, []string{enc}, "created", map[string]int{"n": 1}, nil); err != nil {
		t.Fatal(err)
	}
	shared, _ := base64.StdEncoding.DecodeString(auth.SharedSecret)
	f = s.Event("created")
	if d, err := realtime.DecryptPusher([][]byte{shared}, []byte(f.text())); err != nil || string(d) != `{"n":1}` {
		t.Errorf("Pusher envelope %s %v", d, err)
	}
	h, err := c.History(ctx, enc, nil)
	if err != nil || len(h.Messages) != 1 || !h.Messages[0].Encrypted || string(h.Messages[0].Data) != `{"n":1}` {
		t.Errorf("encrypted history %+v %v", h, err)
	}
	raw, _ := c.History(ctx, enc, &realtime.HistoryOptions{Raw: true})
	if !strings.Contains(string(raw.Messages[0].Data), "ciphertext") {
		t.Errorf("raw history %s", raw.Messages[0].Data)
	}

	// Full E2E on a private channel: v1 envelopes with the derived keys from hubfly.keys.
	full := &realtime.Client{URL: c.URL, AppID: c.AppID, Key: c.Key, Secret: c.Secret, EncryptionKeys: liveKeys, FullE2E: true}
	priv := "private-go-full-" + liveRun
	pa, _ := full.AuthorizeChannel(s.SocketID, priv, nil)
	if f := s.Subscribe(priv, pa.Auth, ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("private subscribe %s", f)
	}
	if _, err := full.Trigger(ctx, []string{priv}, "secret", "x", nil); err != nil {
		t.Fatal(err)
	}
	f = s.Event(realtime.E2EEvent)
	derived, _ := base64.StdEncoding.DecodeString(pa.HubFly.Keys[0].Key)
	m2, _, err := realtime.DecryptV1(func(string) []byte { return derived }, []byte(f.text()))
	if err != nil || m2.E != "secret" || m2.To != priv || string(m2.D) != `"x"` {
		t.Errorf("full E2E envelope %+v %v", m2, err)
	}
}

func TestLiveConnectionControl(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	ctx := liveCtx(t)
	c := liveClient(t, app, "")
	base := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	a := dialSocket(t, base, app.key, true)
	b := dialSocket(t, base, app.key, false)
	if ok, err := c.IsOnline(ctx, a.SocketID); err != nil || !ok {
		t.Fatalf("IsOnline %v %v", ok, err)
	}
	if cs, err := c.ConnectionStatus(ctx, b.SocketID); err != nil || cs.Protocol != "pusher" {
		t.Errorf("ConnectionStatus %+v %v", cs, err)
	}
	if err := c.DisconnectConnection(ctx, a.SocketID); err != nil {
		t.Fatal(err)
	}
	if code := a.WaitClose(); code != 4200 {
		t.Errorf("disconnect close code %d, want 4200", code)
	}
	if err := c.TerminateConnection(ctx, b.SocketID); err != nil {
		t.Fatal(err)
	}
	if code := b.WaitClose(); code != 4009 {
		t.Errorf("terminate close code %d, want 4009", code)
	}
	waitFor(t, "offline", func() bool { ok, err := c.IsOnline(ctx, b.SocketID); return err == nil && !ok })
	err := c.TerminateConnection(ctx, b.SocketID)
	var apiErr *realtime.APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 404 || !realtime.IsNotFound(err) {
		t.Errorf("terminating a closed connection: %v", err)
	}
	res, err := c.SendToConnection(ctx, b.SocketID, "x", 1, nil)
	if err != nil || res.Results[0].Status != "offline" {
		t.Errorf("send to a closed connection %+v %v", res, err)
	}
	// Bad signatures are refused.
	bad := liveClient(t, liveApp{app.id, app.key, "wrong-secret"}, "")
	if _, err := bad.Channels(ctx, "", nil); !errors.As(err, &apiErr) || apiErr.Status != 401 {
		t.Errorf("bad secret: %v", err)
	}
}

func TestLiveRequiredPolicy(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_REQUIRED_")
	liveRun := uniq()
	ctx := liveCtx(t)
	plain := liveClient(t, app, "")
	sealed := &realtime.Client{URL: plain.URL, AppID: app.id, Key: app.key, Secret: app.secret, EncryptionKeys: liveKeys, FullE2E: true}
	s := dialSocket(t, os.Getenv("HUBFLY_REALTIME_TEST_URL"), app.key, true)
	k := make([]byte, 32)
	_, _ = rand.Read(k)
	id, _ := realtime.FormatConnectionID(s.SocketID, k)

	var apiErr *realtime.APIError
	for name, call := range map[string]func() error{
		"publish": func() error { _, err := plain.Publish(ctx, []string{"req-" + liveRun}, "x", 1, nil); return err },
		"trigger": func() error { _, err := plain.Trigger(ctx, []string{"req-" + liveRun}, "x", 1, nil); return err },
		"send":    func() error { _, err := plain.SendToConnection(ctx, s.SocketID, "x", 1, nil); return err },
		"user":    func() error { _, err := plain.SendToUser(ctx, "u_req", "x", 1, nil); return err },
	} {
		if err := call(); !errors.As(err, &apiErr) || apiErr.Status != 403 || apiErr.Reason != "e2e_required" {
			t.Errorf("plaintext %s: %v", name, err)
		}
	}
	if res, err := sealed.SendToConnection(ctx, id, "x", 1, nil); err != nil || res.Results[0].Status != "delivered" {
		t.Errorf("sealed send %+v %v", res, err)
	}
	if _, err := sealed.SendToUser(ctx, "u_req", "x", 1, nil); err != nil {
		t.Errorf("sealed user message: %v", err)
	}
	for _, ch := range []string{"private-encrypted-req-" + liveRun, "private-req-" + liveRun, "presence-req-" + liveRun} {
		if _, err := sealed.Publish(ctx, []string{ch}, "x", map[string]int{"n": 1}, nil); err != nil {
			t.Errorf("sealed publish to %s: %v", ch, err)
		}
	}
	if _, err := sealed.Publish(ctx, []string{"req-" + liveRun}, "x", 1, &realtime.PublishOptions{Encrypt: realtime.Bool(true)}); err != nil {
		t.Errorf("encrypt: true on a public channel: %v", err)
	}
	// Sealed presence user_info is accepted; plaintext user_info is refused.
	pres := "presence-req-" + liveRun
	pa, _ := sealed.AuthorizeChannel(s.SocketID, pres, &realtime.PresenceData{UserID: "u_req", UserInfo: map[string]string{"name": "Sealed"}})
	if f := s.Subscribe(pres, pa.Auth, pa.ChannelData); f.Event != "pusher_internal:subscription_succeeded" {
		t.Errorf("sealed presence %s", f)
	}
	pp, _ := plain.AuthorizeChannel(s.SocketID, pres+"-plain", &realtime.PresenceData{UserID: "u_req", UserInfo: map[string]string{"name": "Plain"}})
	if f := s.Subscribe(pres+"-plain", pp.Auth, pp.ChannelData); f.Event != "pusher:subscription_error" || !strings.Contains(f.text(), "403") {
		t.Errorf("plaintext presence user_info %s", f)
	}
	// Sign-in user_info: sealed (FullE2E) and absent are accepted; plaintext is refused with 4009.
	ua, _ := sealed.AuthenticateUser(s.SocketID, realtime.UserData{ID: "u_req", UserInfo: map[string]string{"name": "Sealed"}})
	if strings.Contains(ua.UserData, "Sealed") {
		t.Errorf("sign-in user_info not sealed: %s", ua.UserData)
	}
	s.Send("pusher:signin", map[string]string{"auth": ua.Auth, "user_data": ua.UserData}, "")
	if f := s.Next(func(f frame) bool { return f.Event == "pusher:signin_success" || f.Event == "pusher:error" }); f.Event != "pusher:signin_success" {
		t.Errorf("sealed sign-in %s", f)
	}
	s2 := dialSocket(t, os.Getenv("HUBFLY_REALTIME_TEST_URL"), app.key, true)
	ua, _ = plain.AuthenticateUser(s2.SocketID, realtime.UserData{ID: "u_req2"})
	s2.Send("pusher:signin", map[string]string{"auth": ua.Auth, "user_data": ua.UserData}, "")
	if f := s2.Next(func(f frame) bool { return f.Event == "pusher:signin_success" || f.Event == "pusher:error" }); f.Event != "pusher:signin_success" {
		t.Errorf("sign-in without user_info %s", f)
	}
	s3 := dialSocket(t, os.Getenv("HUBFLY_REALTIME_TEST_URL"), app.key, true)
	ua, _ = plain.AuthenticateUser(s3.SocketID, realtime.UserData{ID: "u_req3", UserInfo: map[string]string{"name": "Plain"}})
	s3.Send("pusher:signin", map[string]string{"auth": ua.Auth, "user_data": ua.UserData}, "")
	if f := s3.Next(func(f frame) bool { return f.Event == "pusher:signin_success" || f.Event == "pusher:error" }); f.Event != "pusher:error" || !strings.Contains(f.text(), "4009") {
		t.Errorf("plaintext sign-in user_info %s", f)
	}
	if code := s3.WaitClose(); code != 4009 {
		t.Errorf("plaintext sign-in close code %d, want 4009", code)
	}
}

// signin signs the socket in as user (plaintext user_info) and subscribes to its user channel.
func signin(t *testing.T, c *realtime.Client, s *liveSocket, user string) {
	t.Helper()
	ua, err := c.AuthenticateUser(s.SocketID, realtime.UserData{ID: user})
	if err != nil {
		t.Fatal(err)
	}
	s.Send("pusher:signin", map[string]string{"auth": ua.Auth, "user_data": ua.UserData}, "")
	s.Next(func(f frame) bool { return f.Event == "pusher:signin_success" })
	if f := s.Subscribe("#server-to-user-"+user, "", ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("user channel %s", f)
	}
}

func TestLiveSessionsResumeAndBuffer(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	liveRun := uniq()
	ctx := liveCtx(t)
	c := liveClient(t, app, "")
	base := os.Getenv("HUBFLY_REALTIME_TEST_URL")
	s := dialSocket(t, base, app.key, true)
	token, _ := s.Hello["session_token"].(string)
	if token == "" || s.Hello["resumed"] != false || s.Hello["detach_ttl"] == nil {
		t.Fatalf("hubfly block %+v", s.Hello)
	}
	user := "u_sess_" + liveRun
	signin(t, c, s, user)
	ch := "sess-" + liveRun
	if f := s.Subscribe(ch, "", ""); f.Event != "pusher_internal:subscription_succeeded" {
		t.Fatalf("subscribe %s", f)
	}
	subscribers(t, ctx, c, ch, 1)
	if _, err := c.Publish(ctx, []string{ch}, "tick", 1, nil); err != nil {
		t.Fatal(err)
	}
	first := s.Event("tick")

	// 4200 detaches the session; sends are buffered.
	if err := c.DisconnectConnection(ctx, s.SocketID); err != nil {
		t.Fatal(err)
	}
	if code := s.WaitClose(); code != 4200 {
		t.Fatalf("close code %d, want 4200", code)
	}
	waitFor(t, "the detached session", func() bool {
		cs, err := c.ConnectionStatus(ctx, s.SocketID)
		return err == nil && cs.State == "detached" && !cs.Online && cs.ExpiresAt != ""
	})
	dm, err := c.SendToConnection(ctx, s.SocketID, "dm", 2, &realtime.SendOptions{Ack: true})
	if err != nil || dm.Results[0].Status != "buffered" {
		t.Fatalf("send to a detached session %+v %v", dm, err)
	}
	um, err := c.SendToUser(ctx, user, "note", 3, &realtime.SendOptions{Ack: true})
	if err != nil || um.Results[0].Status != "buffered" {
		t.Fatalf("user message to a detached session %+v %v", um, err)
	}
	if _, err := c.Publish(ctx, []string{ch}, "tick", 4, nil); err != nil {
		t.Fatal(err)
	}
	if r, err := c.MessageReceipt(ctx, dm.MessageID); err != nil || r.Targets[0].Status != "buffered" {
		t.Errorf("buffered receipt %+v %v", r, err)
	}

	// Resume: same socket id, rotated token, replay from the channel offset, buffered messages,
	// then hubfly:resumed.
	s2 := dialHello(t, base, app.key, map[string]any{
		"v": 1, "features": []string{"ack", "offsets"},
		"resume":   map[string]any{"socket_id": s.SocketID, "token": token},
		"channels": map[string]any{ch: map[string]any{"epoch": first.Hubfly.Epoch, "offset": first.Hubfly.Offset}},
	})
	if s2.SocketID != s.SocketID || s2.Hello["resumed"] != true || s2.Hello["session_token"] == token {
		t.Fatalf("resume: %s %+v", s2.SocketID, s2.Hello)
	}
	var got []string
	var acks []string
	for len(got) < 4 {
		f := s2.Next(func(f frame) bool { return f.Event != "pusher:pong" })
		got = append(got, f.Event)
		if f.Hubfly != nil && f.Hubfly.Ack {
			acks = append(acks, f.Hubfly.ID)
		}
		if f.Event == "hubfly:resumed" {
			if !strings.Contains(f.text(), `"replayed":2`) || !strings.Contains(f.text(), `"recovered"`) {
				t.Errorf("hubfly:resumed %s", f.text())
			}
			break
		}
	}
	if strings.Join(got, ",") != "tick,dm,note,hubfly:resumed" {
		t.Errorf("resume frames %v", got)
	}
	s2.Send("hubfly:ack", map[string]any{"m": acks}, "")
	for _, id := range []string{dm.MessageID, um.MessageID} {
		waitFor(t, "the acked receipt", func() bool {
			r, err := c.MessageReceipt(ctx, id)
			return err == nil && r != nil && r.Targets[0].Status == "acked"
		})
	}
	// The old token was rotated: resuming with it starts a new session.
	s3 := dialHello(t, base, app.key, map[string]any{"v": 1, "resume": map[string]any{"socket_id": s.SocketID, "token": token}})
	if s3.SocketID == s.SocketID || s3.Hello["resumed"] != false {
		t.Errorf("stale token resumed: %s %+v", s3.SocketID, s3.Hello)
	}
}

func TestLiveOfflineQueue(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	ctx := liveCtx(t)
	c := liveClient(t, app, "")
	user := "u_queue_" + uniq()
	var ids []string
	for i := 1; i <= 2; i++ {
		res, err := c.SendToUser(ctx, user, "queued", i, nil)
		if err != nil || res.Results[0].Status != "queued" {
			t.Fatalf("SendToUser to an offline user %+v %v", res, err)
		}
		ids = append(ids, res.MessageID)
	}
	s := dialSocket(t, os.Getenv("HUBFLY_REALTIME_TEST_URL"), app.key, true)
	signin(t, c, s, user)
	for i, id := range ids {
		f := s.Event("queued")
		if f.Hubfly == nil || f.Hubfly.ID != id || f.Hubfly.Kind != "user" || f.text() != fmt.Sprint(i+1) {
			t.Errorf("queued message %d: %s %+v", i, f, f.Hubfly)
		}
	}
}

// Security review H3 (Go parity): History of a full-E2E channel flags injected plaintext unless
// AllowPlaintext is set.
func TestLiveHistoryPlaintextInFullE2EChannel(t *testing.T) {
	app := liveEnv(t, "HUBFLY_REALTIME_TEST_")
	ctx := liveCtx(t)
	ch := "private-h3-go-" + uniq()
	injector := liveClient(t, app, "") // stands in for a relay that injects plaintext
	full := liveClient(t, app, liveKeys)
	full.FullE2E = true
	if _, err := injector.Trigger(ctx, []string{ch}, "order.paid", map[string]int{"amount": 0}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := full.Publish(ctx, []string{ch}, "order.paid", map[string]int{"amount": 10}, nil); err != nil {
		t.Fatal(err)
	}
	var h *realtime.HistoryResult
	waitFor(t, "both messages in history", func() bool {
		var err error
		h, err = full.History(ctx, ch, nil)
		return err == nil && len(h.Messages) == 2
	})
	if m := h.Messages[0]; m.E2EError != "plaintext" || m.Encrypted {
		t.Errorf("injected: %+v (data %s)", m, m.Data)
	}
	if m := h.Messages[1]; m.E2EError != "" || !m.Encrypted || m.Event != "order.paid" || string(m.Data) != `{"amount":10}` {
		t.Errorf("sealed: %+v (data %s)", m, m.Data)
	}
	full.AllowPlaintext = true
	h, err := full.History(ctx, ch, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m := h.Messages[0]; m.E2EError != "" || m.Encrypted || string(m.Data) != `{"amount":0}` {
		t.Errorf("AllowPlaintext: %+v (data %s)", m, m.Data)
	}
	if _, _, err := full.Decrypt(ch, "client-x", `{"a":1}`); err != nil {
		t.Errorf("AllowPlaintext Decrypt: %v", err)
	}
}

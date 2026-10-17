package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Security review H3: plaintext in an E2E context is not passed off as a decrypted event.
func TestDecryptRefusesPlaintextInE2EContexts(t *testing.T) {
	keys, v := vectorKeys(t)
	full := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: keys, FullE2E: true}
	plain := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: keys}
	// A forged client_event webhook on a full-E2E channel (the review's PoC event).
	for _, ch := range []string{"private-orders", "presence-room"} {
		if _, _, err := full.Decrypt(ch, "client-order.paid", `{"amount":0}`); reasonOf(err) != "plaintext" {
			t.Errorf("%s: %v", ch, err)
		}
	}
	for _, c := range []*Client{full, plain} {
		if _, _, err := c.Decrypt("#server-to-user-u_1", "notice", `{"a":1}`); reasonOf(err) != "plaintext" {
			t.Errorf("user context (FullE2E %t): %v", c.FullE2E, err)
		}
		if _, _, err := c.Decrypt("private-encrypted-orders", "client-x", `{"a":1}`); reasonOf(err) != "plaintext" {
			t.Errorf("encrypted channel (FullE2E %t): %v", c.FullE2E, err)
		}
	}
	// Not E2E contexts: unchanged.
	if ev, d, err := plain.Decrypt("private-orders", "client-x", json.RawMessage(`{"a":1}`)); err != nil || ev != "client-x" || string(d) != `{"a":1}` {
		t.Errorf("private without FullE2E: %s %s %v", ev, d, err)
	}
	if _, _, err := full.Decrypt("orders", "x", 1); err != nil {
		t.Errorf("public channel: %v", err)
	}
	// Envelopes still open.
	if ev, _, err := full.Decrypt("private-encrypted-orders", "order.updated", v.Pusher[0].Envelope); err != nil || ev != "order.updated" {
		t.Errorf("pusher envelope: %v", err)
	}
	// AllowPlaintext restores pass-through; encrypted channels still refuse plaintext.
	lax := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: keys, FullE2E: true, AllowPlaintext: true}
	if ev, d, err := lax.Decrypt("private-orders", "client-order.paid", json.RawMessage(`{"amount":0}`)); err != nil || ev != "client-order.paid" || string(d) != `{"amount":0}` {
		t.Errorf("AllowPlaintext: %s %s %v", ev, d, err)
	}
	if _, _, err := lax.Decrypt("#server-to-user-u_1", "notice", 1); err != nil {
		t.Errorf("AllowPlaintext user context: %v", err)
	}
	if _, _, err := lax.Decrypt("private-encrypted-orders", "client-x", `{"a":1}`); reasonOf(err) != "plaintext" {
		t.Errorf("AllowPlaintext encrypted channel: %v", err)
	}
}

func TestHistoryFlagsPlaintextInFullE2EChannels(t *testing.T) {
	keys, _ := vectorKeys(t)
	srv, _ := fakeAPI(t, testKey, testSecret, func(c *captured, n int) (int, any) {
		return 200, map[string]any{"channel": "private-orders", "epoch": "e1", "head": 1, "oldest": 1, "messages": []any{
			map[string]any{"offset": 1, "event": "order.paid", "data": `{"amount":0}`, "message_id": "a"},
		}}
	})
	for _, tc := range []struct {
		allow    bool
		data, ee string
	}{{false, `"{\"amount\":0}"`, "plaintext"}, {true, `{"amount":0}`, ""}} {
		c := testClient(t, srv, keys)
		c.FullE2E, c.AllowPlaintext = true, tc.allow
		h, err := c.History(context.Background(), "private-orders", nil)
		if err != nil {
			t.Fatal(err)
		}
		m := h.Messages[0]
		if m.E2EError != tc.ee || string(m.Data) != tc.data || m.Encrypted || m.Event != "order.paid" {
			t.Errorf("AllowPlaintext %t: %+v (data %s)", tc.allow, m, m.Data)
		}
	}
}

func TestClientStringHidesSecrets(t *testing.T) {
	keys, v := vectorKeys(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "pubkey", Secret: "TOP-SECRET-VALUE", EncryptionKeys: keys}
	wrapper := struct{ RT *Client }{c}
	for _, out := range []string{
		fmt.Sprint(c), fmt.Sprintf("%v", c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), fmt.Sprintf("%s", c),
		fmt.Sprintf("%v", wrapper), fmt.Sprintf("%+v", []*Client{c}),
	} {
		if strings.Contains(out, "TOP-SECRET-VALUE") || strings.Contains(out, v.MasterKeys[0].Key) || !strings.Contains(out, "[redacted]") {
			t.Errorf("leaks or misses redaction: %s", out)
		}
	}
	if s := c.String(); !strings.Contains(s, `Key:"pubkey"`) || !strings.Contains(s, "Encryption:true") {
		t.Errorf("String: %s", s)
	}
}

func TestIDErrorsHideConnectionKeys(t *testing.T) {
	k := strings.Repeat("A", 43)
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s"}
	_, _, e1 := ParseConnectionID("bad.id~" + k)
	_, e2 := c.AuthorizeChannel("1.2~"+k, "private-x", nil)
	_, e3 := c.AuthenticateUser("1.2~"+k, UserData{ID: "u"})
	_, e4 := c.SendToUser(context.Background(), "1.2~"+k, "x", 1, nil)
	_, e5 := FormatConnectionID("x~"+k, make([]byte, 32))
	for i, err := range []error{e1, e2, e3, e4, e5} {
		if err == nil || strings.Contains(err.Error(), k) || !strings.Contains(err.Error(), "invalid") {
			t.Errorf("error %d: %v", i+1, err)
		}
	}
	if !strings.Contains(e1.Error(), `"bad.id~…"`) {
		t.Errorf("quoted id: %v", e1)
	}
}

func TestAuthHandlerHidesInternalErrors(t *testing.T) {
	// Broken key configuration (channel auth) and an id the SDK refuses (sign-in): the reasons
	// stay on the server.
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: "internal-kid:not-base64"}
	h := c.AuthHandler(AuthHandlerOptions{GetUser: func(r *http.Request) (*User, error) {
		return &User{ID: "secret internal~value"}, nil
	}})
	for _, body := range []string{
		url.Values{"socket_id": {"1.2"}}.Encode(),
		url.Values{"socket_id": {"1.2"}, "channel_name": {"private-room"}}.Encode(),
	} {
		r := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusInternalServerError || strings.TrimSpace(w.Body.String()) != `{"error":"Authorization failed"}` {
			t.Errorf("%s: %d %s", body, w.Code, w.Body.String())
		}
	}
}

func TestVerifyWebhookRefusesFutureTimestamps(t *testing.T) {
	now := int64(1760600000)
	c := &Client{URL: "https://x", AppID: "1", Key: testKey, Secret: testSecret, Now: func() time.Time { return time.Unix(now, 0) }}
	body := `{"time_ms":1760600000000,"events":[]}`
	for _, tc := range []struct {
		ts   int64
		opts *WebhookOptions
		want string
	}{
		{now + 60, nil, "ok"},
		{now + 61, nil, "timestamp_out_of_tolerance"},
		{now + 1000, &WebhookOptions{Tolerance: 2000 * time.Second}, "timestamp_out_of_tolerance"},
		{now - 1000, &WebhookOptions{Tolerance: 2000 * time.Second}, "ok"},
	} {
		_, err := c.VerifyWebhookBody(webhookHeaders(body, tc.ts, testKey, testSecret), []byte(body), tc.opts)
		if got := webhookReason(err); got != tc.want {
			t.Errorf("t=now%+d: %s, want %s", tc.ts-now, got, tc.want)
		}
	}
}

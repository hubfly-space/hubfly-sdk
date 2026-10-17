package realtime

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func webhookHeaders(body string, ts int64, key, secret string) http.Header {
	h := http.Header{}
	h.Set("Content-Type", "application/json")
	h.Set("X-Pusher-Key", key)
	h.Set("X-Pusher-Signature", refHMAC(secret, body))
	h.Set("X-HubFly-Signature", "t="+strconv.FormatInt(ts, 10)+",v1="+refHMAC(secret, strconv.FormatInt(ts, 10)+"."+body))
	h.Set("X-HubFly-Delivery-Id", "wd_1")
	return h
}

func webhookReason(err error) string {
	var e *WebhookError
	if errors.As(err, &e) {
		return e.Reason
	}
	if err == nil {
		return "ok"
	}
	return err.Error()
}

func TestVerifyWebhook(t *testing.T) {
	now := int64(1760600000)
	c := &Client{URL: "https://x", AppID: "1", Key: testKey, Secret: testSecret, Now: func() time.Time { return time.Unix(now, 0) }}
	body := `{"time_ms":1760600000000,"events":[{"name":"member_added","channel":"presence-room","user_id":"u_1"}]}`

	req := httptest.NewRequest(http.MethodPost, "/hook", strings.NewReader(body))
	req.Header = webhookHeaders(body, now, testKey, testSecret)
	p, err := c.VerifyWebhook(req, nil)
	if err != nil || p.TimeMs != 1760600000000 || p.Events[0].Name != "member_added" || p.Events[0].UserID != "u_1" || !bytes.Contains(p.Events[0].Raw, []byte(`"user_id":"u_1"`)) {
		t.Fatalf("valid webhook: %+v %v", p, err)
	}

	check := func(name string, h http.Header, b string, opts *WebhookOptions, want string) {
		t.Helper()
		_, err := c.VerifyWebhookBody(h, []byte(b), opts)
		if got := webhookReason(err); got != want {
			t.Errorf("%s: %s, want %s", name, got, want)
		}
	}
	check("tampered", webhookHeaders(body, now, testKey, testSecret), body+" ", nil, "bad_signature")
	check("old", webhookHeaders(body, now-301, testKey, testSecret), body, nil, "timestamp_out_of_tolerance")
	check("future", webhookHeaders(body, now+301, testKey, testSecret), body, nil, "timestamp_out_of_tolerance")
	check("tolerance", webhookHeaders(body, now-1000, testKey, testSecret), body, &WebhookOptions{Tolerance: 2000 * time.Second}, "ok")
	check("wrong secret", webhookHeaders(body, now, testKey, "other"), body, nil, "bad_signature")
	pusherOnly := webhookHeaders(body, now, testKey, testSecret)
	pusherOnly.Del("X-HubFly-Signature")
	check("pusher only", pusherOnly, body, nil, "missing_hubfly_signature")
	check("pusher only allowed", pusherOnly, body, &WebhookOptions{AllowPusherSignature: true}, "ok")
	check("unsigned", http.Header{}, body, nil, "missing_signature")
	badPusher := webhookHeaders(body, now, testKey, testSecret)
	badPusher.Set("X-Pusher-Signature", refHMAC("x", body))
	check("bad pusher signature", badPusher, body, nil, "bad_signature")
	rotated := webhookHeaders(body, now, "rotatedkey0000000000", "rotated-secret")
	check("unknown key", rotated, body, nil, "unknown_key")
	check("extra key", rotated, body, &WebhookOptions{ExtraKeys: map[string]string{"rotatedkey0000000000": "rotated-secret"}}, "ok")
	check("bad body", webhookHeaders("nope", now, testKey, testSecret), "nope", nil, "bad_body")
	multi := webhookHeaders(body, now, testKey, testSecret)
	multi.Set("X-HubFly-Signature", "t="+strconv.FormatInt(now, 10)+",v1="+strings.Repeat("0", 64)+",v1="+refHMAC(testSecret, strconv.FormatInt(now, 10)+"."+body))
	check("multiple v1", multi, body, nil, "ok")
}

package streams

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type webhookVectors struct {
	Cases []struct {
		Name             string
		Secret           string
		Header           string
		Body             string
		Now              int64
		ToleranceSeconds int64 `json:"tolerance_seconds"`
		Valid            bool
	}
}

func TestWebhookVectors(t *testing.T) {
	var v webhookVectors
	loadJSON(t, "testdata/webhook-signatures.json", &v)
	if len(v.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			opts := WebhookOptions{Now: time.Unix(c.Now, 0), Tolerance: time.Duration(c.ToleranceSeconds) * time.Second}
			err := VerifyWebhook(c.Secret, []byte(c.Body), c.Header, opts)
			if (err == nil) != c.Valid {
				t.Fatalf("err = %v, want valid %v", err, c.Valid)
			}
			var werr *WebhookError
			if err != nil && !errors.As(err, &werr) {
				t.Fatalf("err %T is not a *WebhookError", err)
			}
		})
	}
	valid := v.Cases[0]
	if got := SignWebhook(valid.Secret, []byte(valid.Body), time.Unix(valid.Now, 0)); got != valid.Header {
		t.Fatalf("SignWebhook = %q, want %q", got, valid.Header)
	}
}

func TestWebhookHandler(t *testing.T) {
	const secret = "whsec_test"
	body := `{"id":"evt_1","type":"channel.live","at":"2026-01-01T00:00:00Z","tenant":"msi_abc12345","data":{"channel":"sch_main0001"}}`
	var got WebhookEvent
	h := WebhookHandler(secret, WebhookOptions{}, func(_ *http.Request, e WebhookEvent) error {
		got = e
		if e.ID == "evt_fail" {
			return errors.New("db down")
		}
		return nil
	})
	send := func(method, body, signature string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/hubfly/stream", strings.NewReader(body))
		if signature != "" {
			r.Header.Set(SignatureHeader, signature)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	if w := send(http.MethodPost, body, SignWebhook(secret, []byte(body), time.Now())); w.Code != http.StatusNoContent {
		t.Fatalf("valid: %d %s", w.Code, w.Body)
	}
	if got.Type != "channel.live" || got.Tenant != "msi_abc12345" || string(got.Data) != `{"channel":"sch_main0001"}` {
		t.Fatalf("event = %+v", got)
	}
	tests := []struct {
		name, method, body, signature string
		code                          int
		reason                        string
	}{
		{"unsigned", http.MethodPost, body, "", 400, "missing_signature"},
		{"other secret", http.MethodPost, body, SignWebhook("whsec_other", []byte(body), time.Now()), 400, "bad_signature"},
		{"old", http.MethodPost, body, SignWebhook(secret, []byte(body), time.Now().Add(-10*time.Minute)), 400, "timestamp_out_of_tolerance"},
		{"not json", http.MethodPost, "nope", SignWebhook(secret, []byte("nope"), time.Now()), 400, "bad_body"},
		{"handler error", http.MethodPost, strings.Replace(body, "evt_1", "evt_fail", 1), SignWebhook(secret, []byte(strings.Replace(body, "evt_1", "evt_fail", 1)), time.Now()), 500, "handler failed"},
		{"GET", http.MethodGet, "", "", 405, "method not allowed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := send(tt.method, tt.body, tt.signature)
			if w.Code != tt.code || strings.TrimSpace(w.Body.String()) != tt.reason {
				t.Fatalf("got %d %q, want %d %q", w.Code, w.Body, tt.code, tt.reason)
			}
		})
	}
}

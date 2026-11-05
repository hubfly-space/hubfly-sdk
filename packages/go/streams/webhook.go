package streams

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// SignatureHeader is the header that carries a delivery's signature.
const SignatureHeader = "HubFly-Signature"

// DefaultWebhookTolerance is the largest |now − t| VerifyWebhook accepts by default.
const DefaultWebhookTolerance = 5 * time.Minute

// maxWebhookBody bounds what WebhookHandler reads.
const maxWebhookBody = 1 << 20

// WebhookError is a delivery that failed verification. Reason is one of missing_signature,
// bad_signature, timestamp_out_of_tolerance or bad_body.
type WebhookError struct {
	Reason string
}

func (e *WebhookError) Error() string { return "hubfly streams webhook: " + e.Reason }

// WebhookOptions configure webhook verification.
type WebhookOptions struct {
	// Tolerance is the largest |now − t| accepted (default 5 minutes).
	Tolerance time.Duration
	// Now defaults to time.Now().
	Now time.Time
}

// WebhookEvent is the body of a delivery (hubfly-stream docs/API.md "Webhook deliveries").
type WebhookEvent struct {
	ID     string          `json:"id"`
	Type   string          `json:"type"`
	At     time.Time       `json:"at"`
	Tenant string          `json:"tenant"`
	Data   json.RawMessage `json:"data,omitempty"`
}

// SignWebhook returns the HubFly-Signature value for body at time t. The node signs deliveries
// itself; use it to test a receiver.
func SignWebhook(secret string, body []byte, t time.Time) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	return "t=" + ts + ",v1=" + hex.EncodeToString(webhookMAC(secret, ts, body))
}

// VerifyWebhook checks a HubFly-Signature header against the raw body: valid when any v1 value
// matches (constant time) and the timestamp is within the tolerance. It returns nil or a
// *WebhookError.
func VerifyWebhook(secret string, body []byte, header string, opts WebhookOptions) error {
	if secret == "" || header == "" {
		return &WebhookError{Reason: "missing_signature"}
	}
	var stamp string
	var signatures []string
	stamps := 0
	for _, part := range strings.Split(header, ",") {
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch k {
		case "t":
			stamp = v
			stamps++
		case "v1":
			signatures = append(signatures, v)
		}
	}
	if stamps != 1 || len(signatures) == 0 {
		return &WebhookError{Reason: "missing_signature"}
	}
	t, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || t < 0 || strings.HasPrefix(stamp, "+") {
		return &WebhookError{Reason: "missing_signature"}
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	tolerance := opts.Tolerance
	if tolerance <= 0 {
		tolerance = DefaultWebhookTolerance
	}
	if d := now.Unix() - t; d > int64(tolerance/time.Second) || -d > int64(tolerance/time.Second) {
		return &WebhookError{Reason: "timestamp_out_of_tolerance"}
	}
	expected := []byte(hex.EncodeToString(webhookMAC(secret, stamp, body)))
	ok := false
	for _, s := range signatures {
		if hmac.Equal([]byte(s), expected) {
			ok = true
		}
	}
	if !ok {
		return &WebhookError{Reason: "bad_signature"}
	}
	return nil
}

// WebhookHandler verifies each delivery, decodes it and calls fn. It answers 400 when the
// signature or body is bad, 500 when fn fails (the node retries), and 204 otherwise. Deliveries
// may repeat: use event.ID (also in HubFly-Event-Id) to ignore duplicates.
func WebhookHandler(secret string, opts WebhookOptions, fn func(r *http.Request, event WebhookEvent) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxWebhookBody+1))
		if err != nil || len(body) > maxWebhookBody {
			http.Error(w, "bad_body", http.StatusBadRequest)
			return
		}
		check := opts
		if check.Now.IsZero() {
			check.Now = time.Now()
		}
		if err := VerifyWebhook(secret, body, r.Header.Get(SignatureHeader), check); err != nil {
			var werr *WebhookError
			errors.As(err, &werr)
			http.Error(w, werr.Reason, http.StatusBadRequest)
			return
		}
		var event WebhookEvent
		if err := json.Unmarshal(body, &event); err != nil || event.Type == "" {
			http.Error(w, "bad_body", http.StatusBadRequest)
			return
		}
		if err := fn(r, event); err != nil {
			http.Error(w, "handler failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func webhookMAC(secret, stamp string, body []byte) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(stamp))
	h.Write([]byte{'.'})
	h.Write(body)
	return h.Sum(nil)
}

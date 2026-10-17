package realtime

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// WebhookError is a webhook that failed verification. Reason is one of missing_signature,
// missing_hubfly_signature, bad_signature, timestamp_out_of_tolerance, unknown_key, bad_body.
type WebhookError struct {
	Reason string
}

func (e *WebhookError) Error() string { return "hubfly realtime webhook: " + e.Reason }

// WebhookFutureSkew is how far in the future a webhook signature timestamp may be.
const WebhookFutureSkew = 60 * time.Second

// WebhookOptions configure webhook verification.
type WebhookOptions struct {
	// Tolerance is the max age of the X-HubFly-Signature timestamp (default 5 minutes). The
	// timestamp may be at most WebhookFutureSkew in the future.
	Tolerance time.Duration
	// AllowPusherSignature accepts requests that carry only X-Pusher-Signature (no replay
	// protection).
	AllowPusherSignature bool
	// ExtraKeys maps other app keys to their secrets (key rotation).
	ExtraKeys map[string]string
}

// WebhookEvent is one event of a webhook batch (docs/WIRE.md "Webhooks"). Raw holds the
// complete JSON object.
type WebhookEvent struct {
	Name              string          `json:"name"`
	Channel           string          `json:"channel,omitempty"`
	Event             string          `json:"event,omitempty"`
	Data              string          `json:"data,omitempty"`
	SocketID          string          `json:"socket_id,omitempty"`
	UserID            string          `json:"user_id,omitempty"`
	MessageID         string          `json:"message_id,omitempty"`
	Status            string          `json:"status,omitempty"`
	SubscriptionCount *int            `json:"subscription_count,omitempty"`
	Raw               json.RawMessage `json:"-"`
}

// UnmarshalJSON keeps the raw object next to the typed fields.
func (e *WebhookEvent) UnmarshalJSON(b []byte) error {
	type plain WebhookEvent
	if err := json.Unmarshal(b, (*plain)(e)); err != nil {
		return err
	}
	e.Raw = append(json.RawMessage(nil), b...)
	return nil
}

// WebhookPayload is a verified webhook batch.
type WebhookPayload struct {
	TimeMs int64          `json:"time_ms"`
	Events []WebhookEvent `json:"events"`
}

// VerifyWebhook reads and verifies a webhook request (see VerifyWebhookBody).
func (c *Client) VerifyWebhook(r *http.Request, opts *WebhookOptions) (*WebhookPayload, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	return c.VerifyWebhookBody(r.Header, body, opts)
}

// VerifyWebhookBody verifies a webhook and returns its payload. It requires X-HubFly-Signature
// (t=<unix>,v1=<hex> over "<t>.<body>", t within the tolerance) and also checks
// X-Pusher-Signature (hex HMAC of the body) when present. Comparisons are constant-time.
// Receivers should dedupe on X-HubFly-Delivery-Id.
func (c *Client) VerifyWebhookBody(header http.Header, body []byte, opts *WebhookOptions) (*WebhookPayload, error) {
	if opts == nil {
		opts = &WebhookOptions{}
	}
	secret := c.Secret
	if key := header.Get("X-Pusher-Key"); key != "" && key != c.Key {
		s, ok := opts.ExtraKeys[key]
		if !ok {
			return nil, &WebhookError{"unknown_key"}
		}
		secret = s
	}
	hub := header.Get("X-HubFly-Signature")
	pusher := strings.TrimSpace(header.Get("X-Pusher-Signature"))
	if hub == "" {
		if pusher == "" {
			return nil, &WebhookError{"missing_signature"}
		}
		if !opts.AllowPusherSignature {
			return nil, &WebhookError{"missing_hubfly_signature"}
		}
	} else {
		var t string
		var v1 []string
		for _, part := range strings.Split(hub, ",") {
			k, v, _ := strings.Cut(part, "=")
			switch strings.TrimSpace(k) {
			case "t":
				t = strings.TrimSpace(v)
			case "v1":
				v1 = append(v1, strings.ToLower(strings.TrimSpace(v)))
			}
		}
		tolerance := opts.Tolerance
		if tolerance == 0 {
			tolerance = 5 * time.Minute
		}
		ts, err := strconv.ParseInt(t, 10, 64)
		if err != nil || ts < 0 {
			return nil, &WebhookError{"timestamp_out_of_tolerance"}
		}
		// Old signatures are replays; ones more than a small clock skew in the future are forged
		// ahead of time (they would stay valid long after capture).
		if d := c.now().Sub(time.Unix(ts, 0)); d > tolerance || d < -WebhookFutureSkew {
			return nil, &WebhookError{"timestamp_out_of_tolerance"}
		}
		expected := hmacHex(secret, []byte(t+"."), body)
		ok := false
		for _, v := range v1 {
			if subtle.ConstantTimeCompare([]byte(v), []byte(expected)) == 1 {
				ok = true
			}
		}
		if !ok {
			return nil, &WebhookError{"bad_signature"}
		}
	}
	if pusher != "" && subtle.ConstantTimeCompare([]byte(strings.ToLower(pusher)), []byte(hmacHex(secret, body))) != 1 {
		return nil, &WebhookError{"bad_signature"}
	}
	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil || payload.Events == nil {
		return nil, &WebhookError{"bad_body"}
	}
	return &payload, nil
}

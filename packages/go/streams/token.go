package streams

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"time"
)

// MaxTokenLifetime is the longest a playback token may live (exp at most this far ahead).
const MaxTokenLifetime = 31 * 24 * time.Hour

// DefaultTokenTTL is the lifetime SignPlaybackToken uses when Expires is zero.
const DefaultTokenTTL = time.Hour

const tokenLeeway = 30 // seconds, for exp and nbf

// ErrPlaybackTokenRefused is returned for every refused token, without saying which check
// failed (like the node's 401).
var ErrPlaybackTokenRefused = errors.New("hubfly streams: playback token refused")

// PlaybackKey is a playback key of a stream server: its id (spk_…), its secret (32 bytes,
// base64url without padding) and its status. An empty Status counts as active; revoked keys
// never verify.
type PlaybackKey struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
	Status string `json:"status,omitempty"`
}

// PlaybackClaims are the claims of a playback token. Zero values are omitted, and claims are
// serialized in the order ch, exp, iat, nbf, sub, ip.
type PlaybackClaims struct {
	// Channel is a channel id, or "*" for every channel of the server.
	Channel string `json:"ch"`
	// Expires is the expiry in Unix seconds, at most 31 days ahead.
	Expires int64 `json:"exp"`
	// IssuedAt and NotBefore are Unix seconds.
	IssuedAt  int64 `json:"iat,omitempty"`
	NotBefore int64 `json:"nbf,omitempty"`
	// Subject is a viewer id (≤ 128 characters), used only in stats.
	Subject string `json:"sub,omitempty"`
	// IP is an IPv4 address or CIDR the viewer must come from.
	IP string `json:"ip,omitempty"`
}

// VerifyOptions describe the request a token is checked against.
type VerifyOptions struct {
	// Channel is the channel the viewer asked for.
	Channel string
	// ClientIP is the viewer's address; required when the token has an ip claim.
	ClientIP string
	// Now defaults to time.Now().
	Now time.Time
}

// SignPlaybackToken signs claims with key. A zero Expires becomes now + DefaultTokenTTL.
func SignPlaybackToken(key PlaybackKey, claims PlaybackClaims) (string, error) {
	if key.ID == "" {
		return "", errors.New("hubfly streams: playback key id is required")
	}
	secret, err := base64.RawURLEncoding.DecodeString(key.Secret)
	if err != nil || len(secret) == 0 {
		return "", errors.New("hubfly streams: playback key secret is not base64url")
	}
	if claims.Channel == "" {
		return "", errors.New("hubfly streams: claims.Channel is required")
	}
	if claims.Expires == 0 {
		claims.Expires = time.Now().Add(DefaultTokenTTL).Unix()
	}
	header, err := marshal(struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
		Kid string `json:"kid"`
	}{"HS256", "JWT", key.ID})
	if err != nil {
		return "", err
	}
	payload, err := marshal(claims)
	if err != nil {
		return "", err
	}
	signing := b64(header) + "." + b64(payload)
	return signing + "." + b64(sign(secret, signing)), nil
}

// VerifyPlaybackToken checks token as the stream node does and returns its claims: alg HS256,
// a kid naming an active or retiring key, the signature, exp > now − 30 s, nbf ≤ now + 30 s,
// exp − now ≤ 31 days, the channel, and the ip claim. Any failure is ErrPlaybackTokenRefused.
func VerifyPlaybackToken(token string, keys []PlaybackKey, opts VerifyOptions) (*PlaybackClaims, error) {
	claims, ok := verifyToken(token, keys, opts)
	if !ok {
		return nil, ErrPlaybackTokenRefused
	}
	return claims, nil
}

func verifyToken(token string, keys []PlaybackKey, opts VerifyOptions) (*PlaybackClaims, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, false
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if !decodeJSON(parts[0], &header) || header.Alg != "HS256" || header.Kid == "" {
		return nil, false
	}
	var key *PlaybackKey
	for i := range keys {
		if keys[i].ID == header.Kid && keys[i].Status != "revoked" {
			key = &keys[i]
			break
		}
	}
	if key == nil {
		return nil, false
	}
	secret, err1 := base64.RawURLEncoding.DecodeString(key.Secret)
	signature, err2 := base64.RawURLEncoding.DecodeString(parts[2])
	if err1 != nil || err2 != nil || !hmac.Equal(signature, sign(secret, parts[0]+"."+parts[1])) {
		return nil, false
	}

	// Decode loosely first so wrong types (a string exp, a fractional nbf) are refused.
	var raw map[string]json.RawMessage
	if !decodeJSON(parts[1], &raw) {
		return nil, false
	}
	var c PlaybackClaims
	if !str(raw, "ch", &c.Channel, true) || !integer(raw, "exp", &c.Expires, true) ||
		!integer(raw, "iat", &c.IssuedAt, false) || !integer(raw, "nbf", &c.NotBefore, false) ||
		!str(raw, "sub", &c.Subject, false) || !str(raw, "ip", &c.IP, false) {
		return nil, false
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	n := now.Unix()
	maxLife := int64(MaxTokenLifetime / time.Second)
	switch {
	case c.Channel == "" || (c.Channel != "*" && c.Channel != opts.Channel):
		return nil, false
	case c.Expires <= n-tokenLeeway || c.Expires-n > maxLife:
		return nil, false
	case raw["nbf"] != nil && c.NotBefore > n+tokenLeeway:
		return nil, false
	case raw["iat"] != nil && c.Expires-c.IssuedAt > maxLife:
		return nil, false
	case len(c.Subject) > 128:
		return nil, false
	case raw["ip"] != nil && !ipMatches(c.IP, opts.ClientIP):
		return nil, false
	}
	return &c, true
}

func ipMatches(claim, client string) bool {
	addr, err := netip.ParseAddr(client)
	if err != nil || !addr.Is4() {
		return false
	}
	if !strings.Contains(claim, "/") {
		claim += "/32"
	}
	prefix, err := netip.ParsePrefix(claim)
	return err == nil && prefix.Addr().Is4() && prefix.Contains(addr)
}

func str(raw map[string]json.RawMessage, name string, out *string, required bool) bool {
	v, ok := raw[name]
	if !ok {
		return !required
	}
	return json.Unmarshal(v, out) == nil
}

func integer(raw map[string]json.RawMessage, name string, out *int64, required bool) bool {
	v, ok := raw[name]
	if !ok {
		return !required
	}
	var n json.Number
	d := json.NewDecoder(bytes.NewReader(v))
	d.UseNumber()
	if d.Decode(&n) != nil {
		return false
	}
	i, err := n.Int64()
	*out = i
	return err == nil
}

func decodeJSON(part string, out any) bool {
	b, err := base64.RawURLEncoding.DecodeString(part)
	return err == nil && json.Unmarshal(b, out) == nil
}

// marshal is json.Marshal without HTML escaping, so ids and CIDRs serialize byte for byte as
// in the vectors.
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func sign(secret []byte, data string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(data))
	return h.Sum(nil)
}

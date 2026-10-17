package realtime

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/nacl/secretbox"
)

// E2E event names (docs/E2E.md).
const (
	// E2EEvent is the outer event name of v1 envelopes published by servers.
	E2EEvent = "hubfly.e2e"
	// ClientE2EEvent is the outer event name of v1 envelopes sent as client events.
	ClientE2EEvent = "client-hubfly.e2e"
	// UserInfoEvent is the inner event name of sealed presence user_info.
	UserInfoEvent = "presence.user_info"
	// SigninUserInfoEvent is the inner event name of sealed sign-in user_info (context
	// #server-to-user-<id>).
	SigninUserInfoEvent = "signin.user_info"
	// DefaultMaxAge is the default receiver window (the longest history window).
	DefaultMaxAge = 24 * time.Hour
)

// E2EError is an end-to-end encryption failure. Reason is a stable code: the engine's envelope
// shape reasons (not_json, not_object, missing_members, unknown_member, bad_nonce,
// short_ciphertext, bad_base64, bad_version, bad_kid, bad_ciphertext) or wrong_envelope, no_key,
// unknown_kid, decrypt_failed, bad_plaintext, bad_event, wrong_context, replayed, expired.
type E2EError struct {
	Reason string
}

func (e *E2EError) Error() string { return "hubfly realtime e2e: " + e.Reason }

func e2eErr(reason string) error { return &E2EError{Reason: reason} }

var (
	kidRE      = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	socketIDRE = regexp.MustCompile(`^\d+\.\d+$`)
	stdB64RE   = regexp.MustCompile(`^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`)
	urlB64RE   = regexp.MustCompile(`^[A-Za-z0-9_-]*$`)
)

// decodeStd is strict standard base64 (padding required, no line breaks), like the engine.
func decodeStd(s string) ([]byte, error) {
	if !stdB64RE.MatchString(s) {
		return nil, e2eErr("bad_base64")
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, e2eErr("bad_base64")
	}
	return b, nil
}

// decodeKeyMaterial accepts standard or URL-safe base64, with or without padding.
func decodeKeyMaterial(s string) ([]byte, error) {
	t := strings.TrimRight(strings.NewReplacer("-", "+", "_", "/").Replace(strings.TrimSpace(s)), "=")
	for len(t)%4 != 0 {
		t += "="
	}
	return decodeStd(t)
}

// MasterKey is a customer master key. Kid is 1–32 characters from [A-Za-z0-9_-], never "c".
type MasterKey struct {
	Kid string
	Key []byte
}

// WireKey is a derived key as it travels in auth responses (hubfly.keys).
type WireKey struct {
	Kid string `json:"kid"`
	Key string `json:"key"`
}

// ParseKeyList parses HUBFLY_REALTIME_E2E_KEYS: comma-separated "kid:base64" entries, the first
// is active (encrypts), the rest only decrypt. A bare base64 value means kid "k1".
func ParseKeyList(value string) ([]MasterKey, error) {
	var out []MasterKey
	seen := map[string]bool{}
	for _, raw := range strings.Split(value, ",") {
		part := strings.TrimSpace(raw)
		if part == "" {
			continue
		}
		kid, material := "k1", part
		if i := strings.IndexByte(part, ':'); i >= 0 {
			kid, material = strings.TrimSpace(part[:i]), part[i+1:]
		}
		if !kidRE.MatchString(kid) || kid == "c" {
			return nil, fmt.Errorf("hubfly realtime: invalid encryption key id %q (1-32 characters from [A-Za-z0-9_-], not \"c\")", kid)
		}
		if seen[kid] {
			return nil, fmt.Errorf("hubfly realtime: duplicate encryption key id %q", kid)
		}
		seen[kid] = true
		key, err := decodeKeyMaterial(material)
		if err != nil {
			return nil, fmt.Errorf("hubfly realtime: encryption key %q is not valid base64", kid)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("hubfly realtime: encryption key %q must be 32 bytes (got %d)", kid, len(key))
		}
		out = append(out, MasterKey{Kid: kid, Key: key})
	}
	if len(out) == 0 {
		return nil, errors.New("hubfly realtime: no encryption keys given")
	}
	return out, nil
}

// DeriveKey returns K(name, master) = SHA-256(UTF-8(name) || master).
func DeriveKey(name string, master []byte) []byte {
	h := sha256.New()
	h.Write([]byte(name))
	h.Write(master)
	return h.Sum(nil)
}

// DeriveWireKeys returns the derived keys of name for every master key, active first.
func DeriveWireKeys(name string, masters []MasterKey) []WireKey {
	out := make([]WireKey, len(masters))
	for i, m := range masters {
		out[i] = WireKey{Kid: m.Kid, Key: base64.StdEncoding.EncodeToString(DeriveKey(name, m.Key))}
	}
	return out
}

// marshal is json.Marshal without HTML escaping (what JSON.stringify produces).
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// jsonValue encodes data for envelopes and request bodies: json.RawMessage is used as given
// (compacted), nil becomes null.
func jsonValue(data any) (json.RawMessage, error) {
	switch d := data.(type) {
	case json.RawMessage:
		if len(d) == 0 {
			return json.RawMessage("null"), nil
		}
		var buf bytes.Buffer
		if err := json.Compact(&buf, d); err != nil {
			return nil, errors.New("hubfly realtime: data is not valid JSON")
		}
		return buf.Bytes(), nil
	case nil:
		return json.RawMessage("null"), nil
	}
	return marshal(data)
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("hubfly realtime: crypto/rand failed: " + err.Error())
	}
	return b
}

func seal(key, nonce, plaintext []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("hubfly realtime: E2E keys are 32 bytes")
	}
	if len(nonce) != 24 {
		return nil, errors.New("hubfly realtime: nonces are 24 bytes")
	}
	var k [32]byte
	var n [24]byte
	copy(k[:], key)
	copy(n[:], nonce)
	return secretbox.Seal(nil, plaintext, &n, &k), nil
}

func unseal(key, nonce, ciphertext []byte) ([]byte, bool) {
	if len(key) != 32 || len(nonce) != 24 {
		return nil, false
	}
	var k [32]byte
	var n [24]byte
	copy(k[:], key)
	copy(n[:], nonce)
	return secretbox.Open(nil, ciphertext, &n, &k)
}

// Envelope is a parsed, shape-checked envelope. V is 1 for v1 envelopes, 0 for Pusher envelopes.
type Envelope struct {
	V          int
	Kid        string
	Nonce      []byte
	Ciphertext []byte
}

// ParseEnvelope shape-checks an envelope exactly like the engine (valid JSON object, exactly the
// documented members, v = 1 and a valid kid for v1, nonce of 24 bytes, ciphertext of at least
// 16 bytes). It returns an *E2EError with the engine's reason.
func ParseEnvelope(envelope []byte) (*Envelope, error) {
	trimmed := bytes.TrimSpace(envelope)
	if !json.Valid(trimmed) {
		return nil, e2eErr("not_json")
	}
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, e2eErr("not_object")
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &obj); err != nil {
		return nil, e2eErr("not_object")
	}
	_, isV1 := obj["v"]
	members := []string{"nonce", "ciphertext"}
	if isV1 {
		members = []string{"v", "kid", "nonce", "ciphertext"}
	}
	for _, m := range members {
		if _, ok := obj[m]; !ok {
			return nil, e2eErr("missing_members")
		}
	}
	for k := range obj {
		known := false
		for _, m := range members {
			known = known || k == m
		}
		if !known {
			return nil, e2eErr("unknown_member")
		}
	}
	env := &Envelope{}
	if isV1 {
		var v float64
		if err := json.Unmarshal(obj["v"], &v); err != nil || v != 1 {
			return nil, e2eErr("bad_version")
		}
		env.V = 1
		if err := json.Unmarshal(obj["kid"], &env.Kid); err != nil || !kidRE.MatchString(env.Kid) {
			return nil, e2eErr("bad_kid")
		}
	}
	var nonce, ct string
	if err := json.Unmarshal(obj["nonce"], &nonce); err != nil || bytes.Equal(obj["nonce"], []byte("null")) {
		return nil, e2eErr("bad_nonce")
	}
	var err error
	if env.Nonce, err = decodeStd(nonce); err != nil {
		return nil, err
	}
	if len(env.Nonce) != 24 {
		return nil, e2eErr("bad_nonce")
	}
	if err := json.Unmarshal(obj["ciphertext"], &ct); err != nil || bytes.Equal(obj["ciphertext"], []byte("null")) {
		return nil, e2eErr("bad_ciphertext")
	}
	if env.Ciphertext, err = decodeStd(ct); err != nil {
		return nil, err
	}
	if len(env.Ciphertext) < 16 {
		return nil, e2eErr("short_ciphertext")
	}
	return env, nil
}

// envelopeBytes accepts an envelope as JSON text, a JSON string containing it, or raw bytes.
func envelopeBytes(data any) []byte {
	switch d := data.(type) {
	case string:
		return []byte(d)
	case []byte:
		return unquoteJSON(d)
	case json.RawMessage:
		return unquoteJSON(d)
	}
	b, _ := json.Marshal(data)
	return b
}

func unquoteJSON(b []byte) []byte {
	t := bytes.TrimSpace(b)
	if len(t) > 0 && t[0] == '"' {
		var s string
		if json.Unmarshal(t, &s) == nil {
			return []byte(s)
		}
	}
	return t
}

// EncryptPusher returns the Pusher envelope `{"nonce","ciphertext"}` (an event data string) for
// data; the plaintext is its JSON encoding.
func EncryptPusher(key []byte, data any) (string, error) {
	return encryptPusherNonce(key, data, randomBytes(24))
}

func encryptPusherNonce(key []byte, data any, nonce []byte) (string, error) {
	plaintext, err := jsonValue(data)
	if err != nil {
		return "", err
	}
	ct, err := seal(key, nonce, plaintext)
	if err != nil {
		return "", err
	}
	out, err := marshal(struct {
		Nonce      string `json:"nonce"`
		Ciphertext string `json:"ciphertext"`
	}{base64.StdEncoding.EncodeToString(nonce), base64.StdEncoding.EncodeToString(ct)})
	return string(out), err
}

// DecryptPusher opens a Pusher envelope with the first key that works and returns the plaintext
// JSON (a JSON string value when the plaintext is not JSON).
func DecryptPusher(keys [][]byte, envelope []byte) (json.RawMessage, error) {
	env, err := ParseEnvelope(envelope)
	if err != nil {
		return nil, err
	}
	return openPusher(keys, env)
}

func openPusher(keys [][]byte, env *Envelope) (json.RawMessage, error) {
	if env.V != 0 {
		return nil, e2eErr("wrong_envelope")
	}
	for _, k := range keys {
		if pt, ok := unseal(k, env.Nonce, env.Ciphertext); ok {
			if json.Valid(pt) {
				return pt, nil
			}
			q, _ := json.Marshal(string(pt))
			return q, nil
		}
	}
	return nil, e2eErr("decrypt_failed")
}

// V1Message is the plaintext of a v1 envelope.
type V1Message struct {
	// E is the real event name.
	E string `json:"e"`
	// D is the application data (any JSON value).
	D json.RawMessage `json:"d"`
	// To is the context: a channel, #server-to-user-<id> or #direct-<socket_id>.
	To string `json:"to"`
	// M is the message id.
	M string `json:"m"`
	// T is the sender time in Unix milliseconds.
	T int64 `json:"t"`
}

// EncryptV1 returns the v1 envelope `{"v":1,"kid","nonce","ciphertext"}` for msg.
func EncryptV1(key []byte, kid string, msg V1Message) (string, error) {
	return encryptV1Nonce(key, kid, msg, randomBytes(24))
}

func encryptV1Nonce(key []byte, kid string, msg V1Message, nonce []byte) (string, error) {
	if !kidRE.MatchString(kid) {
		return "", fmt.Errorf("hubfly realtime: invalid key id %q", kid)
	}
	if len(msg.D) == 0 {
		msg.D = json.RawMessage("null")
	}
	plaintext, err := marshal(msg)
	if err != nil {
		return "", err
	}
	ct, err := seal(key, nonce, plaintext)
	if err != nil {
		return "", err
	}
	out, err := marshal(struct {
		V          int    `json:"v"`
		Kid        string `json:"kid"`
		Nonce      string `json:"nonce"`
		Ciphertext string `json:"ciphertext"`
	}{1, kid, base64.StdEncoding.EncodeToString(nonce), base64.StdEncoding.EncodeToString(ct)})
	return string(out), err
}

func openV1(key []byte, env *Envelope) (*V1Message, error) {
	if env.V != 1 {
		return nil, e2eErr("wrong_envelope")
	}
	pt, ok := unseal(key, env.Nonce, env.Ciphertext)
	if !ok {
		return nil, e2eErr("decrypt_failed")
	}
	var raw struct {
		E  *string         `json:"e"`
		D  json.RawMessage `json:"d"`
		To *string         `json:"to"`
		M  *string         `json:"m"`
		T  *float64        `json:"t"`
	}
	if err := json.Unmarshal(pt, &raw); err != nil || raw.E == nil || raw.To == nil || raw.M == nil || raw.T == nil {
		return nil, e2eErr("bad_plaintext")
	}
	d := raw.D
	if len(d) == 0 {
		d = json.RawMessage("null")
	}
	return &V1Message{E: *raw.E, D: d, To: *raw.To, M: *raw.M, T: int64(*raw.T)}, nil
}

// DecryptV1 opens a v1 envelope; keyFor returns the key of a kid (nil when unknown). It does not
// run receiver checks (see Receiver).
func DecryptV1(keyFor func(kid string) []byte, envelope []byte) (*V1Message, string, error) {
	env, err := ParseEnvelope(envelope)
	if err != nil {
		return nil, "", err
	}
	if env.V != 1 {
		return nil, "", e2eErr("wrong_envelope")
	}
	key := keyFor(env.Kid)
	if key == nil {
		return nil, env.Kid, e2eErr("unknown_kid")
	}
	msg, err := openV1(key, env)
	return msg, env.Kid, err
}

// Receiver applies the E2E.md receiver checks to v1 messages: To must equal the arrival
// context, M must not repeat (last 1,000 ids per context) and T must not be older than MaxAge.
// The zero value uses DefaultMaxAge. Safe for concurrent use.
type Receiver struct {
	MaxAge time.Duration
	Now    func() time.Time

	mu   sync.Mutex
	seen map[string]*idRing
}

type idRing struct {
	set   map[string]struct{}
	order []string
}

// Check validates msg as received in context.
func (r *Receiver) Check(context string, msg *V1Message) error {
	if msg.To != context {
		return e2eErr("wrong_context")
	}
	now := time.Now()
	if r.Now != nil {
		now = r.Now()
	}
	maxAge := r.MaxAge
	if maxAge == 0 {
		maxAge = DefaultMaxAge
	}
	if now.UnixMilli()-msg.T > maxAge.Milliseconds() {
		return e2eErr("expired")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.seen == nil {
		r.seen = map[string]*idRing{}
	}
	ring := r.seen[context]
	if ring == nil {
		ring = &idRing{set: map[string]struct{}{}}
		r.seen[context] = ring
	}
	if _, dup := ring.set[msg.M]; dup {
		return e2eErr("replayed")
	}
	ring.set[msg.M] = struct{}{}
	ring.order = append(ring.order, msg.M)
	if len(ring.order) > 1000 {
		delete(ring.set, ring.order[0])
		ring.order = ring.order[1:]
	}
	return nil
}

// quoteID quotes an id for an error message without leaking an E2E connection key: everything
// after "~" becomes "…", and long values are cut.
func quoteID(id string) string {
	if i := strings.IndexByte(id, '~'); i >= 0 {
		id = id[:i] + "~…"
	}
	if len(id) > 64 {
		id = id[:64] + "…"
	}
	return strconv.Quote(id)
}

// IsSocketID reports whether s looks like a Pusher socket id (<digits>.<digits>).
func IsSocketID(s string) bool { return socketIDRE.MatchString(s) }

// FormatConnectionID returns the E2E connection id <socket_id>~<base64url(key)>.
func FormatConnectionID(socketID string, key []byte) (string, error) {
	if !IsSocketID(socketID) {
		return "", fmt.Errorf("hubfly realtime: invalid socket id %s", quoteID(socketID))
	}
	if len(key) != 32 {
		return "", errors.New("hubfly realtime: connection keys are 32 bytes")
	}
	return socketID + "~" + base64.RawURLEncoding.EncodeToString(key), nil
}

// ParseConnectionID splits a connection id into its socket id and, for E2E ids, the 32-byte
// client key (nil for plain socket ids).
func ParseConnectionID(id string) (socketID string, key []byte, err error) {
	socketID, enc, hasKey := strings.Cut(id, "~")
	if !IsSocketID(socketID) {
		return "", nil, fmt.Errorf("hubfly realtime: invalid connection id %s", quoteID(id))
	}
	if !hasKey {
		return socketID, nil, nil
	}
	if !urlB64RE.MatchString(enc) {
		return "", nil, errors.New("hubfly realtime: invalid connection id key")
	}
	key, err = base64.RawURLEncoding.DecodeString(enc)
	if err != nil || len(key) != 32 {
		return "", nil, errors.New("hubfly realtime: invalid connection id key")
	}
	return socketID, key, nil
}

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// NewMessageID returns a message id in the engine's format: "m_" + 26 Crockford base32
// characters (48-bit millisecond time, then 80 random bits), so ids sort by creation time.
func NewMessageID() string { return newMessageIDAt(time.Now()) }

func newMessageIDAt(t time.Time) string {
	var b [28]byte
	b[0], b[1] = 'm', '_'
	ms := uint64(t.UnixMilli())
	for i := 11; i >= 2; i-- {
		b[i] = crockford[ms%32]
		ms /= 32
	}
	r := randomBytes(16)
	for i := 0; i < 16; i++ {
		b[12+i] = crockford[r[i]&31]
	}
	return string(b[:])
}

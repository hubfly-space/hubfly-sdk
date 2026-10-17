package realtime

// testdata/vectors.json is a byte-for-byte copy of hubfly-realtime/testdata/e2e/vectors.json
// (generated there by `go run ./scripts/e2evectors`). Re-copy it when the engine regenerates it;
// TestVectorsMatchEngine compares the two when the engine checkout sits next to this repository.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

type vectorFile struct {
	MasterKeys []struct {
		Kid string `json:"kid"`
		Key string `json:"key"`
	} `json:"master_keys"`
	Derive []struct {
		Name string `json:"name"`
		Kid  string `json:"kid"`
		Key  string `json:"key"`
	} `json:"derive"`
	Pusher []struct {
		Channel   string          `json:"channel"`
		Kid       string          `json:"kid"`
		Key       string          `json:"key"`
		Nonce     string          `json:"nonce"`
		Data      json.RawMessage `json:"data"`
		Plaintext string          `json:"plaintext"`
		Envelope  string          `json:"envelope"`
	} `json:"pusher"`
	V1 []struct {
		Context   string          `json:"context"`
		Kid       string          `json:"kid"`
		Key       string          `json:"key"`
		Nonce     string          `json:"nonce"`
		Message   json.RawMessage `json:"message"`
		Plaintext string          `json:"plaintext"`
		Envelope  string          `json:"envelope"`
	} `json:"v1"`
	ConnectionIDs []struct {
		SocketID string `json:"socket_id"`
		Key      string `json:"key"`
		ID       string `json:"id"`
	} `json:"connection_ids"`
	Shape struct {
		ValidPusher []struct{ Envelope string } `json:"valid_pusher"`
		ValidV1     []struct{ Envelope string } `json:"valid_v1"`
		Invalid     []struct {
			Envelope string `json:"envelope"`
			Reason   string `json:"reason"`
		} `json:"invalid"`
	} `json:"shape"`
}

func loadVectors(t *testing.T) (*vectorFile, map[string][]byte) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v vectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	masters := map[string][]byte{}
	for _, m := range v.MasterKeys {
		masters[m.Kid] = mustB64(t, m.Key)
	}
	return &v, masters
}

func mustB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func reasonOf(err error) string {
	var e *E2EError
	if errors.As(err, &e) {
		return e.Reason
	}
	if err == nil {
		return "no error"
	}
	return "other: " + err.Error()
}

func TestVectorsMatchEngine(t *testing.T) {
	engine := filepath.Join("..", "..", "..", "..", "hubfly-realtime", "testdata", "e2e", "vectors.json")
	want, err := os.ReadFile(engine)
	if err != nil {
		t.Skip("engine checkout not found")
	}
	got, _ := os.ReadFile(filepath.Join("testdata", "vectors.json"))
	if !bytes.Equal(got, want) {
		t.Fatal("testdata/vectors.json differs from the engine's copy; re-copy it")
	}
}

func TestVectorDerive(t *testing.T) {
	v, masters := loadVectors(t)
	if len(v.Derive) == 0 {
		t.Fatal("no derive vectors")
	}
	for _, d := range v.Derive {
		if got := b64(DeriveKey(d.Name, masters[d.Kid])); got != d.Key {
			t.Errorf("DeriveKey(%q, %s) = %s, want %s", d.Name, d.Kid, got, d.Key)
		}
	}
	keys, err := ParseKeyList("k1:" + v.MasterKeys[0].Key + ",k0:" + v.MasterKeys[1].Key)
	if err != nil {
		t.Fatal(err)
	}
	wire := DeriveWireKeys("private-encrypted-orders", keys)
	if wire[0] != (WireKey{"k1", v.Derive[0].Key}) || wire[1] != (WireKey{"k0", v.Derive[1].Key}) {
		t.Errorf("DeriveWireKeys = %+v", wire)
	}
}

func TestVectorPusherEnvelopes(t *testing.T) {
	v, masters := loadVectors(t)
	for _, p := range v.Pusher {
		key := mustB64(t, p.Key)
		if b64(DeriveKey(p.Channel, masters[p.Kid])) != p.Key {
			t.Errorf("%s: derived key mismatch", p.Channel)
		}
		env, err := encryptPusherNonce(key, p.Data, mustB64(t, p.Nonce))
		if err != nil || env != p.Envelope {
			t.Errorf("encrypt %s:\n got %s (%v)\nwant %s", p.Channel, env, err, p.Envelope)
		}
		pt, err := DecryptPusher([][]byte{make([]byte, 32), key}, []byte(p.Envelope))
		if err != nil || string(pt) != p.Plaintext {
			t.Errorf("decrypt %s = %s, %v; want %s", p.Channel, pt, err, p.Plaintext)
		}
		if _, err := DecryptPusher([][]byte{make([]byte, 32)}, []byte(p.Envelope)); reasonOf(err) != "decrypt_failed" {
			t.Errorf("wrong key: %v", err)
		}
	}
}

func TestVectorV1Envelopes(t *testing.T) {
	v, masters := loadVectors(t)
	for _, x := range v.V1 {
		key := mustB64(t, x.Key)
		if x.Kid != "c" && b64(DeriveKey(x.Context, masters[x.Kid])) != x.Key {
			t.Errorf("%s/%s: derived key mismatch", x.Context, x.Kid)
		}
		var msg V1Message
		if err := json.Unmarshal(x.Message, &msg); err != nil {
			t.Fatal(err)
		}
		env, err := encryptV1Nonce(key, x.Kid, msg, mustB64(t, x.Nonce))
		if err != nil || env != x.Envelope {
			t.Errorf("encrypt %s:\n got %s (%v)\nwant %s", x.Context, env, err, x.Envelope)
		}
		got, kid, err := DecryptV1(func(k string) []byte {
			if k == x.Kid {
				return key
			}
			return nil
		}, []byte(x.Envelope))
		if err != nil || kid != x.Kid {
			t.Fatalf("decrypt %s: %v (kid %q)", x.Context, err, kid)
		}
		plaintext, _ := marshal(got)
		if string(plaintext) != x.Plaintext {
			t.Errorf("plaintext %s, want %s", plaintext, x.Plaintext)
		}
		if _, _, err := DecryptV1(func(string) []byte { return nil }, []byte(x.Envelope)); reasonOf(err) != "unknown_kid" {
			t.Errorf("unknown kid: %v", err)
		}
		if _, _, err := DecryptV1(func(string) []byte { return make([]byte, 32) }, []byte(x.Envelope)); reasonOf(err) != "decrypt_failed" {
			t.Errorf("wrong key: %v", err)
		}
	}
}

func TestVectorConnectionIDs(t *testing.T) {
	v, _ := loadVectors(t)
	for _, c := range v.ConnectionIDs {
		key, err := base64.RawURLEncoding.DecodeString(c.Key)
		if err != nil || len(key) != 32 {
			t.Fatal("bad vector key")
		}
		id, err := FormatConnectionID(c.SocketID, key)
		if err != nil || id != c.ID {
			t.Errorf("FormatConnectionID = %q, %v", id, err)
		}
		s, k, err := ParseConnectionID(c.ID)
		if err != nil || s != c.SocketID || !bytes.Equal(k, key) {
			t.Errorf("ParseConnectionID = %q, %x, %v", s, k, err)
		}
		if s, k, err := ParseConnectionID(c.SocketID); err != nil || s != c.SocketID || k != nil {
			t.Errorf("plain socket id: %q %x %v", s, k, err)
		}
	}
	// The direct-message vector is encrypted with the connection-id key.
	for _, x := range v.V1 {
		if x.Kid == "c" {
			key, _ := base64.RawURLEncoding.DecodeString(v.ConnectionIDs[0].Key)
			if b64(key) != x.Key {
				t.Error("direct vector key differs from the connection id key")
			}
		}
	}
	for _, bad := range []string{"", "abc", "1234.5678~", "1234.5678~AAAA", "1234.5678~" + string(bytes.Repeat([]byte("A"), 43)) + "=", "x1.2"} {
		if _, _, err := ParseConnectionID(bad); err == nil {
			t.Errorf("ParseConnectionID(%q) accepted", bad)
		}
	}
}

func TestVectorShapes(t *testing.T) {
	v, _ := loadVectors(t)
	for _, s := range v.Shape.ValidPusher {
		if env, err := ParseEnvelope([]byte(s.Envelope)); err != nil || env.V != 0 {
			t.Errorf("valid pusher %s: %v", s.Envelope, err)
		}
	}
	for _, s := range v.Shape.ValidV1 {
		if env, err := ParseEnvelope([]byte(s.Envelope)); err != nil || env.V != 1 {
			t.Errorf("valid v1 %s: %v", s.Envelope, err)
		}
	}
	for _, s := range v.Shape.Invalid {
		if _, err := ParseEnvelope([]byte(s.Envelope)); reasonOf(err) != s.Reason {
			t.Errorf("%s: got %s, want %s", s.Envelope, reasonOf(err), s.Reason)
		}
	}
}

func TestParseKeyList(t *testing.T) {
	v, masters := loadVectors(t)
	k1, k0 := v.MasterKeys[0].Key, v.MasterKeys[1].Key
	keys, err := ParseKeyList("k2:" + k0 + ", k1:" + k1)
	if err != nil || len(keys) != 2 || keys[0].Kid != "k2" || keys[1].Kid != "k1" {
		t.Fatalf("ParseKeyList = %+v, %v", keys, err)
	}
	bare, err := ParseKeyList(k1)
	if err != nil || bare[0].Kid != "k1" || !bytes.Equal(bare[0].Key, masters["k1"]) {
		t.Fatalf("bare: %+v %v", bare, err)
	}
	unpadded, err := ParseKeyList("a:" + k1[:len(k1)-1])
	if err != nil || !bytes.Equal(unpadded[0].Key, masters["k1"]) {
		t.Fatalf("unpadded: %v", err)
	}
	url, err := ParseKeyList("rot_2026-10:" + base64.RawURLEncoding.EncodeToString(masters["k0"]))
	if err != nil || !bytes.Equal(url[0].Key, masters["k0"]) {
		t.Fatalf("url alphabet: %v", err)
	}
	for in, want := range map[string]string{
		"":                       "no encryption keys",
		"c:" + k1:                "invalid encryption key id",
		"has space:" + k1:        "invalid encryption key id",
		"k1:" + k1 + ",k1:" + k0: "duplicate",
		k1 + "," + k0:            "duplicate",
		"k1:AAAA":                "must be 32 bytes",
		"k1:!!!!":                "not valid base64",
	} {
		if _, err := ParseKeyList(in); err == nil || !regexp.MustCompile(want).MatchString(err.Error()) {
			t.Errorf("ParseKeyList(%q) error = %v, want %q", in, err, want)
		}
	}
}

func TestReceiver(t *testing.T) {
	now := time.UnixMilli(1_000_000)
	r := &Receiver{MaxAge: time.Second, Now: func() time.Time { return now }}
	msg := func(m string, ts int64, to string) *V1Message { return &V1Message{E: "x", To: to, M: m, T: ts} }
	if err := r.Check("private-orders", msg("a", 1_000_000, "private-orders")); err != nil {
		t.Fatal(err)
	}
	if reasonOf(r.Check("private-orders", msg("a", 1_000_000, "private-orders"))) != "replayed" {
		t.Error("replay accepted")
	}
	if reasonOf(r.Check("private-other", msg("b", 1_000_000, "private-orders"))) != "wrong_context" {
		t.Error("wrong context accepted")
	}
	now = now.Add(1001 * time.Millisecond)
	if reasonOf(r.Check("private-orders", msg("c", 1_000_000, "private-orders"))) != "expired" {
		t.Error("expired accepted")
	}
	r2 := &Receiver{MaxAge: 1000 * time.Hour}
	for i := 0; i < 1001; i++ {
		if err := r2.Check("c1", msg(string(rune('A'+i%26))+time.Duration(i).String(), time.Now().UnixMilli(), "c1")); err != nil {
			t.Fatal(err)
		}
	}
	if err := r2.Check("c1", msg("A0s", time.Now().UnixMilli(), "c1")); err != nil {
		t.Errorf("evicted id rejected: %v", err)
	}
}

func TestMessageIDs(t *testing.T) {
	re := regexp.MustCompile(`^m_[0-9A-HJKMNP-TV-Z]{26}$`)
	at := time.UnixMilli(1760600000000)
	a, b := newMessageIDAt(at), newMessageIDAt(at.Add(time.Millisecond))
	if !re.MatchString(a) || !re.MatchString(NewMessageID()) {
		t.Fatalf("bad id %s", a)
	}
	if a[:12] != newMessageIDAt(at)[:12] || !(b > a) {
		t.Errorf("ids are not time-ordered: %s %s", a, b)
	}
}

func TestEncryptRoundTrip(t *testing.T) {
	key := DeriveKey("private-encrypted-x", bytes.Repeat([]byte{7}, 32))
	env, err := EncryptPusher(key, map[string]any{"a": "<b>&"})
	if err != nil {
		t.Fatal(err)
	}
	pt, err := DecryptPusher([][]byte{key}, []byte(env))
	if err != nil || string(pt) != `{"a":"<b>&"}` {
		t.Errorf("round trip: %s %v", pt, err)
	}
	v1, err := EncryptV1(key, "k1", V1Message{E: "e", D: json.RawMessage(`[1]`), To: "x", M: "m", T: 5})
	if err != nil {
		t.Fatal(err)
	}
	msg, kid, err := DecryptV1(func(string) []byte { return key }, []byte(v1))
	if err != nil || kid != "k1" || string(msg.D) != "[1]" || msg.T != 5 {
		t.Errorf("v1 round trip: %+v %s %v", msg, kid, err)
	}
	if _, err := EncryptV1(key, "bad kid", V1Message{}); err == nil {
		t.Error("bad kid accepted")
	}
}

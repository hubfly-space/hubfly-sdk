package streams

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

type playbackVectors struct {
	Now   int64
	Keys  []PlaybackKey
	Cases []struct {
		Name     string
		Header   map[string]string
		Claims   json.RawMessage
		Token    string
		Channel  string
		ClientIP string `json:"client_ip"`
		Valid    bool
		Signing  bool `json:"signing_vector"`
	}
}

func loadJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestPlaybackVectors(t *testing.T) {
	var v playbackVectors
	loadJSON(t, "testdata/playback.json", &v)
	if len(v.Cases) == 0 {
		t.Fatal("no cases")
	}
	now := time.Unix(v.Now, 0)
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			claims, err := VerifyPlaybackToken(c.Token, v.Keys, VerifyOptions{Channel: c.Channel, ClientIP: c.ClientIP, Now: now})
			if c.Valid != (err == nil) {
				t.Fatalf("valid = %v, want %v (err %v)", err == nil, c.Valid, err)
			}
			if err != nil && !errors.Is(err, ErrPlaybackTokenRefused) {
				t.Fatalf("err = %v", err)
			}
			if c.Valid && claims.Channel == "" {
				t.Fatal("claims not returned")
			}
			if !c.Signing {
				return
			}
			var want PlaybackClaims
			if err := json.Unmarshal(c.Claims, &want); err != nil {
				t.Fatal(err)
			}
			var key PlaybackKey
			for _, k := range v.Keys {
				if k.ID == c.Header["kid"] {
					key = k
				}
			}
			got, err := SignPlaybackToken(key, want)
			switch {
			case want.Channel == "":
				// The signer refuses a token without a channel ...
				if err == nil {
					t.Fatal("signed a token without ch")
				}
			case want.Expires == 0:
				// ... and always sets exp, so this vector only tests verification.
				if err != nil || got == c.Token {
					t.Fatalf("got %q, %v", got, err)
				}
			case err != nil || got != c.Token:
				t.Fatalf("sign = %q, %v; want %q", got, err, c.Token)
			}
		})
	}
}

func TestPlaybackTokenRoundTrip(t *testing.T) {
	key := PlaybackKey{ID: "spk_key00001", Secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"}
	now := time.Now()
	token, err := SignPlaybackToken(key, PlaybackClaims{Channel: "*", Subject: "viewer-42", IP: "203.0.113.0/24"})
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		keys []PlaybackKey
		opts VerifyOptions
		ok   bool
	}{
		{"inside the network", []PlaybackKey{key}, VerifyOptions{Channel: "sch_a", ClientIP: "203.0.113.9", Now: now}, true},
		{"no client address", []PlaybackKey{key}, VerifyOptions{Channel: "sch_a", Now: now}, false},
		{"other network", []PlaybackKey{key}, VerifyOptions{Channel: "sch_a", ClientIP: "198.51.100.1", Now: now}, false},
		{"revoked key", []PlaybackKey{{ID: key.ID, Secret: key.Secret, Status: "revoked"}}, VerifyOptions{Channel: "sch_a", ClientIP: "203.0.113.9", Now: now}, false},
		{"after the default ttl", []PlaybackKey{key}, VerifyOptions{Channel: "sch_a", ClientIP: "203.0.113.9", Now: now.Add(DefaultTokenTTL + time.Minute)}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, err := VerifyPlaybackToken(token, tt.keys, tt.opts)
			if (err == nil) != tt.ok {
				t.Fatalf("err = %v, want ok %v", err, tt.ok)
			}
			if tt.ok && claims.Subject != "viewer-42" {
				t.Fatalf("claims = %+v", claims)
			}
		})
	}
}

func TestSignPlaybackTokenRefusesBadKeys(t *testing.T) {
	for _, key := range []PlaybackKey{{Secret: "AAAA"}, {ID: "spk_1", Secret: "not base64!"}, {ID: "spk_1"}} {
		if _, err := SignPlaybackToken(key, PlaybackClaims{Channel: "*"}); err == nil {
			t.Errorf("signed with %+v", key)
		}
	}
}

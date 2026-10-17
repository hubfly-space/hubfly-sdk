package realtime

import (
	"strings"
	"testing"
)

func envFunc(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestFromEnvCanonicalNames(t *testing.T) {
	keys, _ := vectorKeys(t)
	c, err := FromEnvFunc(envFunc(map[string]string{
		"HUBFLY_REALTIME_URL":      "https://blue.rt.hubfly.app",
		"HUBFLY_REALTIME_APP_ID":   "1000001",
		"HUBFLY_REALTIME_KEY":      "k3n9x2m4q8w1e7r5t6y0",
		"HUBFLY_REALTIME_SECRET":   "s",
		"HUBFLY_REALTIME_E2E_KEYS": keys,
	}))
	if err != nil || c.URL != "https://blue.rt.hubfly.app" || c.AppID != "1000001" || c.EncryptionKeys != keys {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestFromEnvPusherFallbacks(t *testing.T) {
	c, err := FromEnvFunc(envFunc(map[string]string{
		"PUSHER_HOST": "blue.rt.hubfly.app", "PUSHER_PORT": "443", "PUSHER_SCHEME": "https",
		"PUSHER_APP_ID": "7", "PUSHER_APP_KEY": "pk", "PUSHER_APP_SECRET": "ps",
	}))
	if err != nil || c.URL != "https://blue.rt.hubfly.app" || c.AppID != "7" || c.Key != "pk" || c.Secret != "ps" {
		t.Fatalf("%+v %v", c, err)
	}
	c, err = FromEnvFunc(envFunc(map[string]string{
		"PUSHER_HOST": "127.0.0.1", "PUSHER_PORT": "6001", "PUSHER_SCHEME": "http",
		"PUSHER_APP_ID": "7", "PUSHER_APP_KEY": "pk", "PUSHER_APP_SECRET": "ps",
	}))
	if err != nil || c.URL != "http://127.0.0.1:6001" {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestFromEnvErrors(t *testing.T) {
	_, err := FromEnvFunc(envFunc(map[string]string{"HUBFLY_REALTIME_URL": "https://x"}))
	if err == nil || !strings.Contains(err.Error(), "missing environment variables: HUBFLY_REALTIME_APP_ID, HUBFLY_REALTIME_KEY, HUBFLY_REALTIME_SECRET") {
		t.Errorf("missing: %v", err)
	}
	_, err = FromEnvFunc(envFunc(map[string]string{
		"HUBFLY_REALTIME_URL": "https://x", "HUBFLY_REALTIME_APP_ID": "1", "HUBFLY_REALTIME_KEY": "k",
		"HUBFLY_REALTIME_SECRET": "s", "HUBFLY_REALTIME_E2E_KEYS": "k1:AAAA",
	}))
	if err == nil || !strings.Contains(err.Error(), "32 bytes") {
		t.Errorf("bad keys: %v", err)
	}
	t.Setenv("HUBFLY_REALTIME_URL", "https://env.rt.hubfly.app")
	t.Setenv("HUBFLY_REALTIME_APP_ID", "42")
	t.Setenv("HUBFLY_REALTIME_KEY", "kk")
	t.Setenv("HUBFLY_REALTIME_SECRET", "ss")
	if c, err := FromEnv(); err != nil || c.AppID != "42" {
		t.Errorf("FromEnv: %+v %v", c, err)
	}
}

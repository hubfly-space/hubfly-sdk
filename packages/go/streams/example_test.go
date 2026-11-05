package streams_test

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/hubfly/hubfly-sdk/go/streams"
)

func ExampleSignPlaybackToken() {
	// In a real backend: os.Getenv("HUBFLY_STREAM_PLAYBACK_KEY_ID") and _SECRET.
	key := streams.PlaybackKey{ID: "spk_key00001", Secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"}
	token, err := streams.SignPlaybackToken(key, streams.PlaybackClaims{
		Channel: "sch_main0001",
		Expires: 1767229200,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(token)
	// Output: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InNwa19rZXkwMDAwMSJ9.eyJjaCI6InNjaF9tYWluMDAwMSIsImV4cCI6MTc2NzIyOTIwMH0.6MnRZ50ELAPsALzXGycxXQdxPfYX-F_n15IotO-ZF3Y
}

func ExampleVerifyWebhook() {
	secret := "whsec_2Jq8fK0vN5xR7mT1wB4cY9hL3dS6aZp"
	body := []byte(`{"id":"evt_9f8e7d6c","type":"channel.live","at":"2026-01-01T00:00:00Z","tenant":"msi_abc12345","data":{"channel":"sch_main0001"}}`)
	header := "t=1767225600,v1=03a930aadaba789843660777edac819d77c798bec9d6b7f3e16789d2107a0a00"

	err := streams.VerifyWebhook(secret, body, header, streams.WebhookOptions{Now: time.Unix(1767225600, 0)})
	fmt.Println(err == nil)
	// Output: true
}

func ExampleWebhookHandler() {
	http.Handle("/hubfly/stream", streams.WebhookHandler("whsec_…", streams.WebhookOptions{},
		func(r *http.Request, event streams.WebhookEvent) error {
			if event.Type == "channel.live" {
				log.Printf("live: %s", event.Data)
			}
			return nil
		}))
}

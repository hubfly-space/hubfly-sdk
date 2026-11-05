// Package streams is the Go server SDK for HubFly Managed Streams: it signs and verifies
// playback tokens for channels in token mode, and authenticates webhook deliveries.
//
// It has no dependencies beyond the standard library. Manage servers, inputs, channels and
// playback keys through the Dashboard API with the main SDK (client.Managed.Streams) or the
// CLI (hubfly stream).
//
// # Playback tokens
//
// A playback token is a compact JWS (HS256) signed with a playback key of the stream server
// (hubfly-stream docs/PLAYBACK.md "Playback tokens"). Mint one per viewer on your backend and
// hand it to the player:
//
//	key := streams.PlaybackKey{ID: os.Getenv("HUBFLY_STREAM_PLAYBACK_KEY_ID"), Secret: os.Getenv("HUBFLY_STREAM_PLAYBACK_KEY_SECRET")}
//	token, err := streams.SignPlaybackToken(key, streams.PlaybackClaims{
//		Channel: "sch_main0001",
//		Expires: time.Now().Add(time.Hour).Unix(),
//		Subject: "viewer-42",
//	})
//
// The stream node verifies tokens itself; VerifyPlaybackToken applies the same rules for
// backends that want to check one.
//
// # Webhooks
//
// Every delivery carries HubFly-Signature: t=<unix>,v1=<hex HMAC-SHA256>. Verify the raw body
// with VerifyWebhook, or let WebhookHandler do it:
//
//	http.Handle("/hubfly/stream", streams.WebhookHandler(os.Getenv("HUBFLY_STREAM_WEBHOOK_SECRET"), streams.WebhookOptions{},
//		func(r *http.Request, event streams.WebhookEvent) error {
//			log.Printf("%s %s", event.Type, event.Data)
//			return nil
//		}))
//
// testdata/playback.json and testdata/webhook-signatures.json are byte copies of the shared
// vectors in hubfly-stream/testdata; the TypeScript SDK passes the same cases.
package streams

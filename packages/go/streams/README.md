# HubFly Streams for Go

Sign playback tokens and verify webhooks for HubFly Managed Streams. Standard
library only.

```sh
go get github.com/hubfly/hubfly-sdk/go/streams
```

## Playback tokens

Channels in **Token** mode play only with a token signed by one of the
server's playback keys. A Dashboard binding writes the key into your
container as `HUBFLY_STREAM_PLAYBACK_KEY_ID` and `HUBFLY_STREAM_PLAYBACK_KEY_SECRET`.

```go
key := streams.PlaybackKey{
	ID:     os.Getenv("HUBFLY_STREAM_PLAYBACK_KEY_ID"),
	Secret: os.Getenv("HUBFLY_STREAM_PLAYBACK_KEY_SECRET"),
}

http.HandleFunc("/api/stream-token", func(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r) // your own session check
	token, err := streams.SignPlaybackToken(key, streams.PlaybackClaims{
		Channel: "sch_main0001",
		Expires: time.Now().Add(time.Hour).Unix(),
		Subject: user.ID,
	})
	if err != nil {
		http.Error(w, "could not sign", http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"token": token})
})
```

Pass the token to `<hubfly-player token="…">` (`@hubfly/streams/player`) or
append it as `?token=` to HLS and audio URLs. `Channel: "*"` covers every
channel of the server; `IP` binds the token to an IPv4 address or CIDR. Tokens
live at most 31 days (`MaxTokenLifetime`); a zero `Expires` means one hour.

`VerifyPlaybackToken(token, keys, streams.VerifyOptions{Channel, ClientIP})`
applies the node's rules if your backend wants to check a token. Every
refusal is `ErrPlaybackTokenRefused`.

## Webhooks

```go
http.Handle("/hubfly/stream", streams.WebhookHandler(os.Getenv("HUBFLY_STREAM_WEBHOOK_SECRET"), streams.WebhookOptions{},
	func(r *http.Request, event streams.WebhookEvent) error {
		switch event.Type {
		case "channel.live", "channel.offline":
			log.Printf("%s %s", event.Type, event.Data)
		}
		return nil // an error answers 500 and the node retries
	}))
```

The handler reads at most 1 MB, verifies `HubFly-Signature` over the raw body
(any `v1` may match; the timestamp must be within 5 minutes), and answers 204,
400 or 500. To verify yourself, call
`streams.VerifyWebhook(secret, rawBody, r.Header.Get(streams.SignatureHeader), streams.WebhookOptions{})`;
it returns nil or a `*WebhookError` whose `Reason` is `missing_signature`,
`bad_signature` or `timestamp_out_of_tolerance`. `SignWebhook` signs test
deliveries.

## Tests

```sh
go vet ./... && go test ./...
```

`testdata/playback.json` and `testdata/webhook-signatures.json` are byte copies
of the shared vectors in `hubfly-stream/testdata`
(`make -C hubfly-stream vectors-sync-check` compares them).

# HubFly Realtime Go server SDK (`github.com/hubfly/hubfly-sdk/go/realtime`)

The server side of **HubFly Realtime**, HubFly's managed WebSocket service (Pusher Channels
protocol 7 plus the HubFly v1 extensions, with built-in end-to-end encryption). It signs the
Pusher-compatible REST API and the HubFly endpoints, answers your clients' auth endpoint, verifies
webhooks and encrypts payloads with your own keys. Browsers and apps connect with
[`@hubfly/realtime`](../../realtime) (or pusher-js / Laravel Echo).

This is a separate Go module (Go 1.25+, one dependency: `golang.org/x/crypto`).

```bash
go get github.com/hubfly/hubfly-sdk/go/realtime
```

## Quick start

```go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/hubfly/hubfly-sdk/go/realtime"
)

func main() {
	// HUBFLY_REALTIME_URL, _APP_ID, _KEY, _SECRET and the optional _E2E_KEYS
	// (falls back to PUSHER_APP_ID, PUSHER_APP_KEY, PUSHER_APP_SECRET, PUSHER_HOST/PORT/SCHEME).
	rt, err := realtime.FromEnv()
	if err != nil {
		log.Fatal(err)
	}

	// The client's authEndpoint and userAuthEndpoint (form-encoded like pusher-js, or JSON).
	http.Handle("/api/realtime/auth", rt.AuthHandler(realtime.AuthHandlerOptions{
		GetUser: func(r *http.Request) (*realtime.User, error) {
			u := currentUser(r) // your session lookup; nil for anonymous requests
			if u == nil {
				return nil, nil
			}
			return &realtime.User{ID: u.ID, Info: map[string]string{"name": u.Name}}, nil
		},
		// Optional. Default: any signed-in user may join private-* and presence-* channels.
		CanAccess: func(u *realtime.User, channel string, r *http.Request) bool {
			return u != nil && mayRead(u.ID, channel)
		},
	}))

	ctx := context.Background()
	// A channel, after your database commit; MessageID makes retries deliver once.
	_, err = rt.Publish(ctx, []string{"private-orders"}, "order.created", map[string]int{"id": 42},
		&realtime.PublishOptions{MessageID: "order-42-created"})
	// One connection: the id the browser got from `await rt.connect()`.
	res, err := rt.SendToConnection(ctx, connectionID, "export.ready", map[string]string{"url": url},
		&realtime.SendOptions{Ack: true})
	// Every connection of a signed-in user.
	_, err = rt.SendToUser(ctx, "u_42", "notification", map[string]string{"title": "Hi"}, nil)
	_ = res
}
```

`GetUser` returns `*realtime.User{ID, Info}` (or `nil` when nobody is signed in; an error answers
500). `ID` is the presence `user_id` and the sign-in user id; `Info` becomes presence and sign-in
`user_info`. Answers: 200 with the signed auth, 403 (not signed in, forbidden), 400 (bad
`socket_id`, public channel, malformed body), 500 `Authorization failed` (any other error, e.g. an
invalid user id or broken `EncryptionKeys`; its text stays on the server).

`fmt` prints a `*Client` without its `Secret` or `EncryptionKeys` (`String`/`GoString`); don't
print a `Client` value.

## API

| Method | Endpoint | Result |
| :--- | :--- | :--- |
| `Publish(ctx, channels, event, data, *PublishOptions{MessageID, SocketID, Encrypt})` | `POST …/hubfly/v1/publish` | `*PublishResult{MessageID, Channels map[string]Position{Epoch, Offset}, MessageIDs}` |
| `SendToConnection(ctx, id, …)` / `SendToConnections(ctx, ids, event, data, *SendOptions{MessageID, Ack, Encrypt})` | `POST …/hubfly/v1/send` | `*SendResult{MessageID, Results []SendTarget{ID, SocketID, UserID, Status, Connections, MessageID}}` |
| `SendToUser(ctx, userID, …)` / `SendToUsers(ctx, userIDs, event, data, *SendOptions)` | `POST …/hubfly/v1/send` | `*SendResult` |
| `Trigger(ctx, channels, event, data, *TriggerOptions{SocketID, Info, Encrypt})` | `POST /apps/{id}/events` | `*TriggerResult{Channels, Batch}` |
| `TriggerBatch(ctx, []BatchEvent{Channel, Name, Data, SocketID, Info, Encrypt})` | `POST /apps/{id}/batch_events` | `*TriggerResult` |
| `Channels(ctx, prefix, info)` / `ChannelInfo(ctx, channel, info)` / `ChannelUsers(ctx, channel)` | `GET /apps/{id}/channels…` | occupied channels / `*ChannelInfo{Occupied, SubscriptionCount, UserCount}` / user ids |
| `TerminateUserConnections(ctx, userID)` | `POST /apps/{id}/users/{uid}/terminate_connections` | closes them with 4009 |
| `ConnectionStatus(ctx, id)` / `IsOnline(ctx, id)` | `GET …/hubfly/v1/connections/{socket_id}` | `*ConnectionStatus{SocketID, Online, State, UserID, ConnectedAt, ExpiresAt, Protocol}` (`State` `detached` + `ExpiresAt` while a session waits to be resumed) / `bool` |
| `UserStatus(ctx, userID)` | `GET …/hubfly/v1/users/{uid}` | `*UserStatus{UserID, Online, Connections, SocketIDs}` |
| `TerminateConnection(ctx, id)` / `DisconnectConnection(ctx, id)` | `POST …/hubfly/v1/connections/{socket_id}/terminate` | close 4009 (client stops) / close 4200 (client reconnects at once) |
| `History(ctx, channel, *HistoryOptions{Since, Epoch, Limit, Raw})` | `GET …/hubfly/v1/history/{name}` | `*HistoryResult{Channel, Epoch, Head, Oldest, Messages []HistoryMessage{Offset, Event, Data, MessageID, PublishedAt, UserID, Encrypted, E2EError}, Truncated, Gap}` |
| `MessageReceipt(ctx, messageID)` | `GET …/hubfly/v1/messages/{id}` | `*MessageReceipt` (nil when unknown; kept 1 h) |
| `AuthorizeChannel(socketID, channel, *PresenceData{UserID, UserInfo})` | | `*ChannelAuth{Auth, ChannelData, SharedSecret, HubFly}` |
| `AuthenticateUser(socketID, UserData{ID, UserInfo})` | | `*UserAuth{Auth, UserData, HubFly}` |
| `AuthHandler(AuthHandlerOptions{GetUser, CanAccess})` | | `http.Handler` |
| `VerifyWebhook(r, *WebhookOptions{Tolerance, AllowPusherSignature, ExtraKeys})` / `VerifyWebhookBody(header, body, opts)` | | `*WebhookPayload{TimeMs, Events []WebhookEvent}`; the signature time must be within `Tolerance` (5 min) in the past and at most `WebhookFutureSkew` (60 s) in the future |
| `Decrypt(context, event, data)` | | real event name and data of an envelope (webhooks, history); E2EError `plaintext` for plaintext in an E2E context unless `AllowPlaintext` |
| `Get(ctx, path, params, out)` / `Post(ctx, path, body, out)` / `SignQuery(method, path, params, body, at)` | any signed `/apps/{id}/…` call | |

Send statuses: `delivered`, `buffered` (session detached, delivered on resume), `queued` (offline
queue), `offline`; receipts add `acked`, `expired`, `dropped`. `ids` may be socket ids or E2E
connection ids (`<socket_id>~<key>`). History `Data` is the JSON value clients receive (the
decrypted value when `Encrypted`); `Raw: true` returns it as stored. Errors: `*APIError{Status,
Message, Reason, RetryAfter, Body}` (`Reason` is `e2e_required` under the `required` encryption
policy; `IsNotFound(err)`), `*WebhookError{Reason}`, `*E2EError{Reason}`. `Publish` and the sends
retry once on network errors and 502/503/504 (their message ids make that safe;
`Client.DisableRetry` turns it off).

## End-to-end encryption

Set `EncryptionKeys` (`HUBFLY_REALTIME_E2E_KEYS`, `kid:base64,…`, first is active; generate one with
`openssl rand -base64 32`). Then:

- `private-encrypted-*` channels get Pusher envelopes (pusher-js `with-encryption` and
  `@hubfly/realtime` read them); `AuthorizeChannel` adds `shared_secret` and `hubfly.keys` (for
  other private/presence channels only with `FullE2E`).
- User messages get v1 envelopes under `K(#server-to-user-<id>)` (`Encrypt: realtime.Bool(false)`
  sends plaintext); `AuthenticateUser` adds the user key.
- Direct messages to E2E connection ids are encrypted with the key inside the id, which the browser
  generated and HubFly never sees (`ParseConnectionID`, `FormatConnectionID`).
- `FullE2E: true` also seals `private-*`/`presence-*` publishes (v1, event names hidden), presence
  `user_info` (under `K(channel)`) and sign-in `user_info` (under `K(#server-to-user-<id>)`;
  `@hubfly/realtime`'s `signin()` opens it). Under the app's `required` policy plaintext presence or
  sign-in `user_info` is refused, so set `FullE2E` or leave `Info` empty.
- Plaintext is refused in E2E contexts: user messages, `private-encrypted-*` and (with `FullE2E`)
  private/presence channels. There `Decrypt` (e.g. for a `client_event` webhook) fails with
  `E2EError{Reason: "plaintext"}` and `History` sets `E2EError: "plaintext"` instead of returning
  plaintext a compromised relay could have injected; `@hubfly/realtime` clients drop such events
  the same way. `AllowPlaintext: true` restores pass-through (`Encrypted` false). **It weakens the
  guarantee**; `private-encrypted-*` channels never accept plaintext.
- Receivers (`Receiver`, the browser SDK) reject replays within the last 1,000 message ids per
  context and messages older than 24 h.

Rotation: put the new key first and keep the old one (`k2:<new>,k1:<old>`) on every server; clients
re-authorize and read both; remove `k1` after 24 h. Lower-level helpers: `ParseKeyList`, `DeriveKey`,
`DeriveWireKeys`, `EncryptPusher`/`DecryptPusher`, `EncryptV1`/`DecryptV1`, `ParseEnvelope`,
`Receiver` (`to`/replay/age checks), `NewMessageID`. The wire format is `docs/E2E.md` in
hubfly-realtime; `testdata/vectors.json` is a byte copy of the engine's shared vectors.

## Tests

```bash
go vet ./... && go test -race ./...
```

`live_test.go` runs against a real instance or the engine's `rt-devserver` and skips unless
`HUBFLY_REALTIME_TEST_URL`, `HUBFLY_REALTIME_TEST_APP_ID`, `HUBFLY_REALTIME_TEST_KEY` and
`HUBFLY_REALTIME_TEST_SECRET` are set (plus `HUBFLY_REALTIME_TEST_REQUIRED_APP_ID`/`_KEY`/`_SECRET`
for an app with the `required` encryption policy). The main app needs the offline queue on and a
detach TTL of at least 10 s; `packages/realtime/test/fixtures/rt-devserver-apps.json` has both:

```bash
HUBFLY_REALTIME_TEST_URL=http://127.0.0.1:6001 HUBFLY_REALTIME_TEST_APP_ID=1000001 \
  HUBFLY_REALTIME_TEST_KEY=… HUBFLY_REALTIME_TEST_SECRET=… go test -run Live -v ./...
```

`packages/realtime/test/fixtures/rt-devserver-apps.json` is a ready `rt-devserver -config` file
(test-only keys); the `@hubfly/realtime` README shows the full command line.

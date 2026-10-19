# API reference

[Get started](../README.md) · [Authentication](authentication.md) · [Encryption](encryption.md)

## Client

```ts
import { Realtime } from '@hubfly/realtime';

const realtime = new Realtime({ url, key });
```

### Connection options

| Option | Purpose |
| --- | --- |
| `url`, `key` | Required instance URL and public app key. URL accepts `https://` or `wss://`. |
| `authEndpoint` | Backend URL authorizing private/presence subscriptions. |
| `userAuthEndpoint` | Backend URL authenticating `signin()`. Can use the same auth endpoint. |
| `authorizer`, `userAuthorizer` | Custom async authorization callbacks instead of endpoint URLs. |
| `auth` | Extra `headers`, form `params`, and fetch `credentials` for auth requests. |
| `e2e` | `true` or encryption options. Default: off. See [encryption](encryption.md). |
| `transport` | `'auto'` (default), `'hubfly'`, or `'pusher'`. |
| `backoff` | Reconnect delays: `{ minMs: 1000, maxMs: 30000 }` by default. |
| `connectTimeoutMs`, `pongTimeoutMs` | Connection/pong timeouts. Defaults: 10,000 / 30,000 ms. |
| `activityTimeoutMs` | Idle time before pinging. Defaults to the server's activity timeout. |
| `WebSocket`, `fetch` | Custom implementations for your runtime. |

### Methods and properties

| Member | Use |
| --- | --- |
| `connect()` | Returns a promise for `{ id, socketId }`. Resolves on connection, before channel subscriptions are necessarily ready. |
| `disconnect()` | Ends the session and stops reconnecting. Keeps channel registrations for a later `connect()`. |
| `subscribe(name)` / `channel(name)` | Returns a channel. Can be called before connecting. |
| `unsubscribe(name)` | Removes a channel subscription. |
| `signin()` | Authenticates the current user; returns `{ id, info? }`. |
| `reauthorize()` | Refreshes channel/user auth and encryption keys. |
| `on(event, handler)` / `off(event?, handler?)` | Handles direct/user messages and lifecycle events. |
| `state` | `initialized`, `connecting`, `connected`, `reconnecting`, or `disconnected`. |
| `id`, `socketId` | Current connection ID and underlying socket ID. E2E connection IDs contain a key: keep them private. |
| `user`, `hubfly` | Current signed-in user; whether HubFly transport is active. |

Channel `bind(event, handler)` / `unbind(event?, handler?)` are aliases of
`on` / `off`. A channel also provides `name`, `subscribed`, `unsubscribe()`,
`trigger('client-…', data)`, and presence `members`.

Message handlers receive `(data, meta)`. Metadata can contain `id`, `event`,
`channel`, `user_id`, `kind` (`direct` or `user`), and `encrypted`, depending
on the transport and message type.

### Events

| Where | Event | Payload / purpose |
| --- | --- | --- |
| Client | `state` | `{ previous, current }` |
| Client | `connected` | `{ id, resumed }` |
| Client | `reconnecting` | `{ code, delay, attempt }` |
| Client | `id` | `{ id, previous }` after the connection ID changes. |
| Client | `signin` | `{ id, info? }` |
| Client | `resumed` | Per-channel recovery results and buffered messages. |
| Client | `error`, `e2e:error` | Connection/protocol error; encryption error with `reason` and context. |
| Channel | `pusher:subscription_succeeded` | Ready to receive messages. Presence channels receive a `Members` object. |
| Channel | `pusher:subscription_error` | `{ type, error, status }` |
| Channel | `pusher:member_added`, `pusher:member_removed` | `{ id, info }` |
| Channel | `recovery`, `recovery:failed` | Recovery status / reason; reload app state when history cannot fill a gap. |
| Channel | `pusher:subscription_count`, `pusher:cache_miss`, `e2e:error` | Subscription count, cache miss, or channel encryption error. |

The client also emits `connecting` and `disconnected`. Presence `members`
provides `count`, `me`, `get(id)`, and `each(callback)`.

## Server

```ts
import { RealtimeServer } from '@hubfly/realtime/server';

const realtime = RealtimeServer.fromEnv();
```

`fromEnv(env?, overrides?)` reads `HUBFLY_REALTIME_URL`, `_APP_ID`, `_KEY`,
`_SECRET`, and optional `_E2E_KEYS`. It falls back to `PUSHER_APP_ID`,
`PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `PUSHER_HOST`, `PUSHER_PORT`, and
`PUSHER_SCHEME` when the corresponding HubFly variables are absent.
Workers should pass their `env` bindings explicitly.

You can also construct `new RealtimeServer({ url, appId, key, secret })`.
Optional settings: `encryptionKeys`, `fullE2E`, `allowPlaintext`, `fetch`,
`crypto`, `timeoutMs` (default 10,000), `retries` (default one extra attempt
for retry-safe publish/send requests), and `now`.

### Send messages

| Method | Result |
| --- | --- |
| `channel(name).publish(event, data, options?)` | Publishes to one channel. |
| `publish(channels, event, data, options?)` | Publishes to one/many channels; returns `message_id` and per-channel positions. |
| `send(connectionIds, event, data, options?)` | Direct message to one/many connections; returns `message_id` and delivery results. |
| `sendToUsers(userIds, event, data, options?)` | Sends to signed-in users across their connections. |
| `toUser(id).send(event, data, options?)` | Sends to one user's connections. |
| `trigger(channels, event, data, options?)` | Pusher-compatible publish. |
| `triggerBatch(events)` | Pusher-compatible batch of `{ channel, name, data, … }` objects. |

Publish/send options accept `messageId` and `encrypt`. Publish also accepts
`socketId` to exclude a sender; send accepts `ack` to request acknowledgement.

Reusing a `messageId` within five minutes avoids duplicate delivery. Generate
a new ID for each distinct message. Delivery results report `delivered`,
`buffered` (detached session), `queued` (offline queue), or `offline` (dropped).

### History, connections, and receipts

| Method | Result |
| --- | --- |
| `history(channel, { since?, epoch?, limit?, raw? })` | `{ messages, epoch, head, oldest, truncated, gap, … }`. Enable channel history first. |
| `messageReceipt(messageId)` | Receipt with per-target status, or `null`. Statuses include `acked`, `expired`, and `dropped`. |
| `connectionStatus(id)` / `isOnline(id)` | Connection details / boolean. |
| `userStatus(id)` | Online status, connection count, and socket IDs. |
| `terminate(id, { mode? })` | `terminate` stops reconnecting; `disconnect` asks the client to reconnect. |
| `terminateUserConnections(userId)` | Ends all connections for a signed-in user. |
| `channels(options?)` / `channelInfo(name, options?)` | Channel list / occupancy and optional counts. |
| `channelUsers(name)` | Presence users. |

`channel(name)` also has `history()`, `info()`, `users()`, and `trigger()`.
`connection(id)` has `send()`, `status()`, `isOnline()`, and `terminate()`.
`toUser(id)` has `status()`, `isOnline()`, and `terminate()` alongside `send()`.

### Authorization and webhooks

| Method | Purpose |
| --- | --- |
| `authHandler({ getUser, canAccess? })` | Fetch API authorization handler. See [authentication](authentication.md). |
| `authorizeChannel(socketId, channel, presenceData?)` | Signs channel authorization. Presence data uses `user_id` and optional `user_info`. |
| `authenticateUser(socketId, { id, user_info? })` | Signs user authentication. |
| `verifyWebhook(request, options?)` | Checks signatures/timestamp and returns `{ time_ms, events }`; throws `WebhookError`. |
| `decrypt(context, event, data)` | Opens an encrypted webhook payload. |
| `get(path, params?)`, `post(path, body, params?)`, `signQuery(…)` | Lower-level signed REST calls. |

Verify webhooks before handling their events. Verification uses the raw request
body; do not parse it first.

```ts
export async function POST(request: Request) {
  const { events } = await realtime.verifyWebhook(request);
  // Deduplicate using request.headers.get('X-HubFly-Delivery-Id'),
  // then process events in your application.
  console.log(events);
  return new Response(null, { status: 204 });
}
```

Delivery is at least once. The default signature tolerance is 300 seconds;
requests more than 60 seconds in the future are rejected. Verification requires
the HubFly signature and checks a Pusher signature when present.

## Reconnection and recovery

The default transport tries HubFly first and falls back to Pusher when
unavailable. HubFly sessions resume within the configured detach TTL, preserving
connection IDs and subscriptions and replaying buffered messages.

If resume fails, the client obtains a new ID and resubscribes using channel
positions. Recovery depends on retained history. Listen for `recovery` and
`recovery:failed` to reload app state when messages cannot be recovered.
Calling `disconnect()` intentionally ends the session.

Acknowledged messages are marked `acked` after handlers and their returned
promises finish. Handlers should return their processing promise if the
acknowledgement must wait for that work.

## Errors

| Error | Useful fields |
| --- | --- |
| `RealtimeApiError` | `status`, `body`, optional `reason` and `retryAfter`. Exported from `/server`. |
| `WebhookError` | `reason`. Exported from `/server`. |
| `E2EError` | `reason`. Exported from `/server` and `/e2e`. |
| `TypeError` | Invalid channel, event, user, or message identifiers. |

The `/e2e` entry also exports key parsing/derivation, envelope encryption,
decryption, and receiver helpers. Normal app code can use `e2e: true` and
`RealtimeServer.fromEnv()` without calling those helpers directly.

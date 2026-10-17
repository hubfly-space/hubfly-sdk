# @hubfly/realtime

The official SDK for **HubFly Realtime**, HubFly's managed WebSocket service. It speaks the Pusher
Channels protocol 7 plus the HubFly v1 extensions (stable connection ids, session resume, message
offsets and recovery, direct messages, acknowledgements) and has end-to-end encryption built in.

| Entry | For | Size (min+gzip) |
| :--- | :--- | :--- |
| `@hubfly/realtime` | Browsers, React Native, Node, Bun, Deno: connect, subscribe, presence, client events, direct and user messages | ~4.4 KB, zero dependencies |
| `@hubfly/realtime/server` | Your backend on Node ≥ 18, Bun, Deno and Cloudflare Workers: auth endpoint, publish, send, history, receipts, webhooks | ~15 KB (`fetch` + WebCrypto only) |
| `@hubfly/realtime/e2e` | End-to-end encryption, loaded by the client only when `e2e` is on | ~9.6 KB (`@noble/ciphers`, `@noble/hashes`) |

pusher-js, Laravel Echo and the Pusher server libraries keep working against the same host (see
[Pusher and Laravel Echo](#pusher-js-and-laravel-echo)).

```bash
npm install @hubfly/realtime   # or: bun add @hubfly/realtime
```

## Environment variables

The Dashboard's app bindings and the AI Builder write these names; `RealtimeServer.fromEnv()` and
the Go `realtime.FromEnv()` read them.

| Variable | Where | Value |
| :--- | :--- | :--- |
| `HUBFLY_REALTIME_URL` | server | `https://<host>` of your realtime instance (sockets use `wss://<host>`) |
| `HUBFLY_REALTIME_APP_ID` | server | App id |
| `HUBFLY_REALTIME_KEY` | server | App key (public: browsers use it too) |
| `HUBFLY_REALTIME_SECRET` | server only | Signs channel access and REST calls. Never ship it to browsers |
| `HUBFLY_REALTIME_E2E_KEYS` | server only, optional | Your end-to-end master keys, `kid:base64,…` (first is active). HubFly never writes or sees it |
| `NEXT_PUBLIC_HUBFLY_REALTIME_URL` / `_KEY` | browser (Next.js) | Public copies of URL and key |
| `VITE_HUBFLY_REALTIME_URL` / `_KEY` | browser (Vite) | Public copies of URL and key |
| `PUBLIC_HUBFLY_REALTIME_URL` / `_KEY` | browser (SvelteKit, Astro) | Public copies of URL and key |

`fromEnv` falls back to the Laravel/Pusher names (`PUSHER_APP_ID`, `PUSHER_APP_KEY`,
`PUSHER_APP_SECRET`, `PUSHER_HOST`, `PUSHER_PORT`, `PUSHER_SCHEME`) when the HubFly names are unset.

## Quick start: browser

```ts
import { Realtime } from '@hubfly/realtime';

const rt = new Realtime({
  url: import.meta.env.VITE_HUBFLY_REALTIME_URL, // https://<host>
  key: import.meta.env.VITE_HUBFLY_REALTIME_KEY,
  authEndpoint: '/api/realtime/auth', // private-* and presence-* channels
  userAuthEndpoint: '/api/realtime/auth', // rt.signin()
});

const { id } = await rt.connect(); // this connection's id: send it to your server to address this tab

// Channels (public, private-*, presence-*, private-encrypted-*).
const orders = rt.subscribe('private-orders');
orders.bind('order.created', (order, meta) => console.log(order, meta.id));

// Direct messages (server: rt.send(id, …)) and user messages (server: rt.toUser(uid).send(…)).
rt.on('export.ready', ({ url }) => download(url));
await rt.signin(); // every connection of this user now receives toUser() messages

// Presence.
const room = rt.subscribe('presence-room-42');
room.bind('pusher:subscription_succeeded', (members) => render(members.count, members.me));
room.bind('pusher:member_added', ({ id, info }) => add(id, info));
room.bind('pusher:member_removed', ({ id }) => remove(id));

// Client events (enable "client events" for the app; private and presence channels only).
room.trigger('client-typing', { typing: true });

// Connection state.
rt.on('state', ({ previous, current }) => setStatus(current)); // connecting/connected/reconnecting/disconnected
rt.on('id', ({ id, previous }) => tellServer(id)); // the connection id changed after a reconnect
orders.bind('recovery:failed', () => refetchOrders()); // messages were missed and cannot be replayed
```

Node < 22 has no global `WebSocket`: pass one (`import WebSocket from 'ws'`, then
`new Realtime({ …, WebSocket })`). Deno, Bun, browsers and React Native need nothing.

## Quick start: auth endpoint (Next.js route handler)

The client calls your auth endpoint for every private or presence subscription and for
`rt.signin()`, exactly like pusher-js (`POST`, `application/x-www-form-urlencoded`,
`socket_id` + `channel_name`; sign-in sends only `socket_id`). `authHandler` answers both.

```ts
// lib/realtime.ts (server only)
import { RealtimeServer } from '@hubfly/realtime/server';

let server: RealtimeServer | undefined;
// HUBFLY_REALTIME_URL, _APP_ID, _KEY, _SECRET (+ optional _E2E_KEYS), read on first use.
export const realtime = () => (server ??= RealtimeServer.fromEnv());
```

```ts
// app/api/realtime/auth/route.ts
import { realtime } from '@/lib/realtime';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  return realtime().authHandler({
    // Who is asking? Return null for anonymous requests.
    getUser: async (req) => {
      const session = await getSession(req);
      return session ? { id: session.user.id, info: { name: session.user.name } } : null;
    },
    // Optional. Default: any signed-in user may join private-* and presence-* channels.
    canAccess: async (user, channel) => !!user && (await mayRead(user.id, channel)),
  })(request);
}
```

- `getUser(request)` returns `{ id: string, info?: unknown }` or `null`/`undefined` (sync or async).
  `id` becomes the presence `user_id` and the sign-in user id; `info` becomes presence
  `user_info` and sign-in `user_info` (keep it under 1 KiB).
- `canAccess(user, channel, request)` returns `boolean | Promise<boolean>`; `user` is `null` for
  anonymous requests. Presence channels and sign-in always need a user.
- Responses: `200` with the signed auth, `403` (`Not signed in`, `Forbidden`), `400` (bad
  `socket_id`, a public `channel_name`, malformed body), `500` `Authorization failed` (invalid
  data from `getUser`; the details stay on the server). JSON bodies are accepted too.

## Quick start: Node, Bun and Workers servers

```ts
import { RealtimeServer } from '@hubfly/realtime/server';

const rt = RealtimeServer.fromEnv(); // Workers: RealtimeServer.fromEnv(env)

// A channel, after your database commit. Returns { message_id, channels: { name: { epoch, offset } } }.
await rt.channel('private-orders').publish('order.created', { id: 42 });

// Retry-safe: the same messageId within 5 minutes delivers once and returns the first result.
await rt.publish(['private-orders', 'dashboard'], 'order.created', { id: 42 }, { messageId: `order-42-created` });

// One connection (the id the browser got from rt.connect()); ask for an acknowledgement.
const res = await rt.send(connectionId, 'export.ready', { url }, { ack: true });
// res.results: [{ id, socket_id, status: 'delivered' | 'buffered' | 'queued' | 'offline', message_id }]
await rt.messageReceipt(res.message_id); // { targets: [{ socket_id, status: 'acked', … }] }

// Every connection of a signed-in user.
await rt.toUser('u_42').send('notification', { title: 'Hi' });

// Pusher-style trigger, channel info, presence users.
await rt.trigger('orders', 'order.created', { id: 42 }, { socketId: senderId });
await rt.channelInfo('presence-room-42', { info: ['user_count'] });
await rt.channelUsers('presence-room-42'); // { users: [{ id }] }

// History (channels that keep history) and connection state.
const { messages } = await rt.history('private-orders', { limit: 50 });
await rt.isOnline(connectionId);
await rt.toUser('u_42').status(); // { online, connections, socket_ids }
```

Serving the auth endpoint without a framework:

```ts
// Bun
const auth = rt.authHandler({ getUser });
Bun.serve({ fetch: (req) => (new URL(req.url).pathname === '/api/realtime/auth' ? auth(req) : app(req)) });

// Cloudflare Workers
export default {
  async fetch(request: Request, env: Record<string, string>) {
    const rt = RealtimeServer.fromEnv(env);
    if (new URL(request.url).pathname === '/api/realtime/auth') return rt.authHandler({ getUser })(request);
    // …
  },
};

// Node + Express: rebuild a Fetch Request from the parsed form body.
app.post('/api/realtime/auth', express.urlencoded({ extended: false }), async (req, res) => {
  const response = await rt.authHandler({ getUser: () => currentUser(req) })(
    new Request('http://localhost/api/realtime/auth', { method: 'POST', body: new URLSearchParams(req.body) }),
  );
  res.status(response.status).type('application/json').send(await response.text());
});
```

The server entry uses only `fetch` and WebCrypto. On Node 18, where `globalThis.crypto` is not
defined, pass `crypto: (await import('node:crypto')).webcrypto` in the options.

### Webhooks

```ts
export async function POST(request: Request) {
  const { events } = await realtime().verifyWebhook(request); // throws WebhookError
  for (const e of events) if (e.name === 'hubfly.user_offline') await markOffline(e.user_id);
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` requires `X-HubFly-Signature` (`t=<unix>,v1=<hex>` over `"<t>.<body>"`, `t`
within 300 s) and also checks `X-Pusher-Signature` when present; comparisons are constant-time.
Delivery is at least once: dedupe on the `X-HubFly-Delivery-Id` header. Encrypted payloads of
`client_event` webhooks open with `rt.decrypt(channel, event, data)`.

## pusher-js and Laravel Echo

Existing Pusher clients connect to the same host on `/app/{key}`; they get Pusher protocol 7 without
the HubFly extensions. `@hubfly/realtime` uses `/hubfly/v1/app/{key}` and falls back to `/app/{key}`
by itself when that path is unavailable.

```ts
import Pusher from 'pusher-js';

const pusher = new Pusher(process.env.NEXT_PUBLIC_HUBFLY_REALTIME_KEY!, {
  wsHost: new URL(process.env.NEXT_PUBLIC_HUBFLY_REALTIME_URL!).host,
  wssPort: 443,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  cluster: 'mt1', // required by pusher-js, ignored by HubFly
  channelAuthorization: { endpoint: '/api/realtime/auth', transport: 'ajax' },
});
```

Laravel: set `BROADCAST_CONNECTION=pusher` (Laravel 11+, `BROADCAST_DRIVER` before) and

```dotenv
PUSHER_APP_ID=<HUBFLY_REALTIME_APP_ID>
PUSHER_APP_KEY=<HUBFLY_REALTIME_KEY>
PUSHER_APP_SECRET=<HUBFLY_REALTIME_SECRET>
PUSHER_HOST=<host of HUBFLY_REALTIME_URL>
PUSHER_PORT=443
PUSHER_SCHEME=https
```

and configure Laravel Echo with `broadcaster: 'pusher'` plus the same `wsHost`/`wssPort`/`forceTLS`/
`enabledTransports` options as above. The Pusher server libraries (`pusher` for Node, PHP,
Python, `pusher-http-go`, …) work with `host` = your instance host, port 443 and TLS on; the auth
responses of `authHandler` are pusher-js compatible, and pusher-js `with-encryption` reads
`private-encrypted-*` channels published by this SDK.

## End-to-end encryption

With E2E, the realtime service relays ciphertext: only your servers and your users' clients hold
keys.

1. Generate a master key and give it to **your servers only**:
   ```bash
   echo "HUBFLY_REALTIME_E2E_KEYS=k1:$(openssl rand -base64 32)"   # or: hubfly realtime keygen
   ```
   `RealtimeServer.fromEnv()` reads it (or pass `encryptionKeys: 'k1:…'`). Your auth endpoint
   (`authHandler`/`authorizeChannel`) now hands the derived channel keys to authorized clients
   (`shared_secret` and `hubfly.keys` in the auth response for `private-encrypted-*` channels, and
   with `fullE2E` for every private/presence channel), and sign-in hands out the user-message key.
2. Turn it on in the client: `new Realtime({ …, e2e: true })`. The E2E code (`@hubfly/realtime/e2e`)
   is loaded on the first `connect()`; where dynamic `import()` is unavailable pass the module:
   `import * as e2e from '@hubfly/realtime/e2e'` then `e2e: { module: e2e }`. React Native needs a
   `crypto.getRandomValues` polyfill (`react-native-get-random-values`).
3. What gets encrypted:
   - `private-encrypted-*` channels: always (Pusher envelope, so pusher-js `with-encryption` can
     read them; event names stay visible).
   - User messages (`toUser().send`): whenever the server has keys (v1 envelope, event name hidden;
     pass `{ encrypt: false }` for users whose clients do not use E2E).
   - Direct messages (`send(id, …)`): whenever `id` is an E2E connection id. With `e2e` on,
     `rt.connect()` returns `<socket_id>~<key>`: the key is generated in the browser and travels
     only to your server inside the id, never through HubFly. Treat these ids as secrets.
   - "Full E2E" (`new RealtimeServer({ …, fullE2E: true })`): also `private-*` and `presence-*`
     publishes (v1 envelope: event names hidden; pusher-js subscribers cannot read them),
     presence `user_info` (sealed, opened by members) and sign-in `user_info` (sealed with the
     user's key; `rt.signin()` returns it opened, and a client without E2E gets `info: undefined`
     plus an `e2e:error`, never the ciphertext). Client events from E2E clients are sealed on every
     channel whose auth returned keys. The keys of other private/presence channels are handed out
     only with `fullE2E`.
   - Set the app's encryption policy to `required` (Dashboard) to make the service refuse
     plaintext: REST calls then fail with `RealtimeApiError` `status: 403, reason: 'e2e_required'`;
     presence and sign-in `user_info` must be sealed (`fullE2E`) or absent (a plaintext sign-in
     `user_info` makes `rt.signin()` reject with code 4009 and closes the connection).
4. Errors: a message that cannot be decrypted, is replayed, is addressed to another context or is
   older than `maxAgeMs` (default 24 h; `e2e: { maxAgeMs }`) is dropped and reported as
   `rt.on('e2e:error', ({ reason, context, event, channel }) => …)` (also on the channel). Replay
   protection remembers the last 1,000 message ids per context; together with the 24 h age limit
   this is the replay window.
5. **Plaintext is refused in E2E contexts.** With `e2e` on, these contexts accept envelopes only:
   `private-encrypted-*` channels, channels whose auth response carried `hubfly.keys` (full E2E),
   direct messages, and user messages once the sign-in returned keys. An application event there
   that is not a valid envelope (for example a plaintext `order.paid` injected by a compromised
   relay) never reaches your handlers: it is dropped with `e2e:error` `{ reason: 'plaintext' }`.
   Plaintext presence `user_info` on a full-E2E channel counts as absent (`info: undefined`) and
   also emits `e2e:error`. Protocol events (`pusher:*`, `pusher_internal:*`, `hubfly:*`) are not
   affected. Sign-in `user_info` is taken from your own auth response, never from the relay's echo.
   The server SDK does the same: `decrypt()` (webhooks) throws `E2EError('plaintext')` and
   `history()` sets `e2e_error: 'plaintext'` for plaintext in user contexts, `private-encrypted-*`
   and (with `fullE2E`) private/presence channels.

   `e2e: { allowPlaintext: true }` (client) and `new RealtimeServer({ …, allowPlaintext: true })`
   restore pass-through with `meta.encrypted: false` (`encrypted: false` from `decrypt()`), for
   example while migrating senders to E2E. **This weakens the guarantee**: a compromised relay can
   then inject events that look like yours unless every handler checks `meta.encrypted`.
   `private-encrypted-*` channels never accept plaintext.

**Rotation.** Put a new key first and keep the old one after it, on every server:
`HUBFLY_REALTIME_E2E_KEYS=k2:<new>,k1:<old>`. New messages use `k2`. A client that receives a
message it cannot open re-authorizes once (at most every 30 s per channel) and gets both keys, so
it keeps reading old and new messages; `rt.reauthorize()` refreshes every channel at once. Remove
`k1` after the longest history window (at most 24 h). pusher-js knows one shared secret per
channel and reads new messages after its next re-authorization (reconnect).

**What HubFly can see:** app ids and keys; channel names; socket ids and user ids; presence
membership (and presence and sign-in `user_info` unless sealed with `fullE2E`); event
names of Pusher envelopes (`private-encrypted-*`) and of plaintext messages; message sizes, counts
and timing; IP addresses, origins and client libraries; webhook URLs. HubFly can drop, delay or
reorder messages.

**What HubFly cannot see or do:** the content of encrypted messages (channels, user and direct
messages, sealed client events and presence/sign-in info, history, webhooks and the debug console all
carry ciphertext), the event names inside v1 envelopes, your master keys and the client keys inside
E2E connection ids; it cannot forge messages that your clients accept.

E2E protects against the realtime service, not against whoever hosts your auth endpoint and master
key: if those run on HubFly hosting (for example an AI Builder app), the hosting platform could read
messages.

## How the client stays connected

- **Transport.** `transport: 'auto'` (default) opens `/hubfly/v1/app/{key}`, sends `hubfly:hello`
  and falls back to `/app/{key}` when the HubFly path cannot be opened (but not while a dropped
  HubFly session can still be resumed, i.e. within the server's `detach_ttl`: only the HubFly path
  resumes). `rt.hubfly` is true on the HubFly socket. Force one with `transport: 'hubfly' | 'pusher'`.
- **Reconnects.** Close codes 4000–4099 stop (`disconnected`, `error` with the code), 4100–4199 back
  off longer, 4200–4299 reconnect at once; everything else backs off with full jitter:
  `random(0, min(maxMs, minMs · 2^attempt))` (defaults 1 s / 30 s; `backoff: { minMs, maxMs }`).
  `hubfly:reconnect { after_ms }` from the server (planned restarts) reconnects after `after_ms`.
  Pings follow the server's `activity_timeout`; a missing pong reconnects.
- **Resume.** The client keeps the session token and resumes after a dropped connection: the same
  connection id, subscriptions and sign-in, no resubscribe, and the server replays what was missed
  (`resumed` event with per-channel results), then direct and user messages sent while the session
  was detached (`buffered`). The server keeps a detached session for the app's detach TTL (default
  60 s), also across planned restarts. `rt.disconnect()` ends the session.
- **Recovery.** When a session cannot be resumed, the client gets a new id (`id` event) and
  resubscribes with each channel's last position (`epoch`, `offset`); the server replays what it
  still has. Each channel emits `recovery` (`{ status: 'recovered' | 'gap' | 'failed', reason, … }`)
  and, when nothing could be replayed, `recovery:failed` (`{ reason }`: refetch your state).
- **Dedupe and acks.** Messages carry ids; the client drops repeats (it remembers the last 1,000
  channel/id pairs) and positions it has already seen, and acknowledges `ack: true` messages after
  your handlers ran (and their promises settled), so `messageReceipt()` shows `acked` only for
  messages your code handled. Messages that fail E2E checks are never acknowledged.

## API reference

### Client: `new Realtime(options)`

| Option | Type | Default |
| :--- | :--- | :--- |
| `url` | `string`: `https://<host>` or `wss://<host>` | required |
| `key` | `string`: app key | required |
| `authEndpoint` | `string`: channel auth URL | |
| `authorizer` | `({ socketId, channelName }) => Promise<ChannelAuth>` instead of `authEndpoint` | |
| `userAuthEndpoint` | `string`: sign-in URL | |
| `userAuthorizer` | `({ socketId }) => Promise<UserAuth>` instead of `userAuthEndpoint` | |
| `auth` | `{ headers?: Record<string,string> \| () => Record \| Promise<Record>, params?: Record<string,string>, credentials?: 'omit' \| 'same-origin' \| 'include' }` | |
| `e2e` | `boolean \| { module?, maxAgeMs?, allowPlaintext?, now? }` | `false` (`allowPlaintext` weakens E2E, see above) |
| `WebSocket` | WebSocket constructor | `globalThis.WebSocket` |
| `fetch` | fetch for auth requests | `globalThis.fetch` |
| `transport` | `'auto' \| 'hubfly' \| 'pusher'` | `'auto'` |
| `backoff` | `{ minMs?, maxMs? }` | `1000`, `30000` |
| `activityTimeoutMs`, `pongTimeoutMs`, `connectTimeoutMs` | `number` | server's `activity_timeout`, `30000`, `10000` |

| Member | |
| :--- | :--- |
| `connect(): Promise<{ id, socketId }>` | Connects (or joins the current attempt). `id` is `<socket_id>~<key>` with E2E, else the socket id |
| `disconnect()` | Closes (ends the session) and stops reconnecting; channels are kept for the next `connect()` |
| `subscribe(name): Channel` (alias `channel(name)`) | Idempotent; may be called before `connect()` |
| `unsubscribe(name)` | |
| `signin(): Promise<{ id, info? }>` | User auth; subscribes `#server-to-user-<id>`; repeated after reconnects that lose the session |
| `reauthorize(): Promise<void>` | Fresh auth (and E2E keys) for every private/presence channel and the user |
| `on(event, (data, meta) => …)` / `off(event?, handler?)` | Direct and user messages, plus the lifecycle events below |
| `state`, `id`, `socketId`, `hubfly`, `user` | `state`: `initialized \| connecting \| connected \| reconnecting \| disconnected` |

Lifecycle events on `rt.on`: `state` (`{ previous, current }`), `connecting`, `connected`
(`{ id, resumed }`), `reconnecting` (`{ code, delay, attempt }`), `disconnected` (the error, if
any), `id` (`{ id, previous }`), `resumed` (`{ channels, messages }`), `signin` (`{ id, info }`),
`error` (`pusher:error` data or an `Error`), `e2e:error` (`{ reason, context, event?, channel?, user_id? }`).

Message handlers receive `(data, meta)`: `data` is the JSON-decoded payload and `meta` is
`{ event, channel?, id?, user_id?, kind?: 'direct' | 'user', encrypted? }` (`id` and `kind` on the
HubFly socket; `user_id` is the sender of a presence client event).

`Channel`: `name`, `subscribed`, `members` (presence only), `bind(event, handler)` /
`unbind(event?, handler?)` (aliases of `on`/`off`), `trigger('client-…', data): boolean` (false when
not subscribed or not connected), `unsubscribe()`. Channel events: `pusher:subscription_succeeded`
(presence: the `Members`), `pusher:subscription_error` (`{ type, error, status }`),
`pusher:member_added` / `pusher:member_removed` (`{ id, info }`), `pusher:subscription_count`
(`{ subscription_count }`), `pusher:cache_miss`, `recovery`, `recovery:failed` (`{ reason }`),
`e2e:error`. `Members`: `count`, `me` (`{ id, info }`), `get(id)`, `each(fn)`.

### Server: `new RealtimeServer(options)` / `RealtimeServer.fromEnv(env?, overrides?)`

Options: `url`, `appId`, `key`, `secret` (required), `encryptionKeys?` (`HUBFLY_REALTIME_E2E_KEYS`
format or a key list), `fullE2E?` (default `false`), `allowPlaintext?` (default `false`; weakens
E2E, see "End-to-end encryption"), `fetch?`, `crypto?`, `timeoutMs?` (10000),
`retries?` (1: extra attempts of `send`/`publish` on network errors and 502/503/504, safe because
of their message ids), `now?`.

| Method | Calls | Returns |
| :--- | :--- | :--- |
| `publish(channels, event, data, { messageId?, socketId?, encrypt? })` | `POST …/hubfly/v1/publish` | `{ message_id, channels: { [name]: { epoch, offset } \| {} }, message_ids? }` |
| `send(ids, event, data, { messageId?, ack?, encrypt? })` | `POST …/hubfly/v1/send` | `{ message_id, results: [{ id, socket_id, status, message_id }] }` |
| `sendToUsers(userIds, event, data, options?)` | `POST …/hubfly/v1/send` | `{ message_id, results: [{ id, user_id, status, connections, message_id }] }` |
| `toUser(id)` | | `{ send(event, data, options?), status(), isOnline(), terminate() }` |
| `connection(id)` | | `{ send(event, data, options?), status(), isOnline(), terminate(options?) }` |
| `channel(name)` | | `{ name, publish(event, data, options?), trigger(event, data, options?), history(options?), info(options?), users() }` |
| `trigger(channels, event, data, { socketId?, info?, encrypt? })` | `POST /apps/{id}/events` | `{}` or `{ channels: { [name]: { subscription_count?, user_count? } } }` |
| `triggerBatch([{ channel, name, data, socketId?, info?, encrypt? }])` | `POST /apps/{id}/batch_events` | `{}` or `{ batch: [...] }` |
| `channels({ prefix?, info? })` | `GET /apps/{id}/channels` | `{ channels: { [name]: { user_count?, subscription_count? } } }` |
| `channelInfo(channel, { info? })` | `GET /apps/{id}/channels/{name}` | `{ occupied, subscription_count?, user_count? }` |
| `channelUsers(channel)` | `GET /apps/{id}/channels/{name}/users` | `{ users: [{ id }] }` |
| `terminateUserConnections(userId)` | `POST /apps/{id}/users/{uid}/terminate_connections` | closes every connection of the user with 4009 |
| `connectionStatus(id)` / `isOnline(id)` | `GET …/hubfly/v1/connections/{socket_id}` | `{ socket_id, online, state?, user_id?, connected_at?, protocol? }` / `boolean` |
| `userStatus(userId)` | `GET …/hubfly/v1/users/{uid}` | `{ user_id, online, connections, socket_ids }` |
| `terminate(id, { mode?: 'terminate' \| 'disconnect' })` | `POST …/hubfly/v1/connections/{socket_id}/terminate` | `{ terminated: true }`; `terminate` closes with 4009 (client stops), `disconnect` with 4200 (client reconnects at once) |
| `history(channel, { since?, epoch?, limit?, raw? })` | `GET …/hubfly/v1/history/{name}` | `{ channel, epoch, head, oldest, messages: [{ offset, event, data, message_id, published_at, user_id?, encrypted?, e2e_error? }], truncated, gap }`; `data` decoded like client handlers receive it, envelopes opened with your keys; `raw: true` returns it as stored |
| `messageReceipt(messageId)` | `GET …/hubfly/v1/messages/{id}` | `{ message_id, created_at, event, targets: [{ socket_id, user_id?, status, updated_at }] }` or `null` |
| `authorizeChannel(socketId, channel, presenceData?)` | | `{ auth, channel_data?, shared_secret?, hubfly?: { keys } }` (`presenceData`: `{ user_id, user_info? }`) |
| `authenticateUser(socketId, { id, user_info? })` | | `{ auth, user_data, hubfly?: { keys } }` (`user_info` sealed with `fullE2E`) |
| `authHandler({ getUser, canAccess? })` | | `(request: Request) => Promise<Response>` |
| `verifyWebhook(request \| { headers, body }, { toleranceSeconds?, allowPusherSignature?, extraKeys? })` | | `{ time_ms, events: [{ name, channel?, event?, data?, socket_id?, user_id?, … }] }`; the signature time must be within `toleranceSeconds` (300) in the past and at most 60 s in the future |
| `decrypt(context, event, data)` | | `{ event, data, encrypted }`; throws `E2EError('plaintext')` for plaintext in an E2E context unless `allowPlaintext` |
| `get(path, params?)` / `post(path, body, params?)` / `signQuery(method, path, params?, body?)` | any signed `/apps/{id}/…` call | |

Send statuses: `delivered`, `buffered` (session detached, delivered on resume), `queued` (user
offline, kept in the offline queue), `offline` (dropped); receipts add `acked`, `expired` and
`dropped`. `ids` passed to `send` may be socket ids or E2E connection ids; `socketId` options accept
both. Calls that encrypt per target split into several requests with message ids
`<messageId>.<n>`. Errors: `RealtimeApiError` (`status`, `body`, `reason?`, `retryAfter?`),
`WebhookError` (`reason`), `E2EError` (`reason`); invalid names throw `TypeError` before any request.

### E2E: `@hubfly/realtime/e2e`

`parseKeyList(value)`, `deriveKey(name, master)` (`SHA-256(name ‖ master)`), `deriveWireKeys`,
`encryptPusher(key, data)` / `decryptPusher(keys, envelope)`, `encryptV1(key, kid, { e, d, to, m, t })` /
`decryptV1(keys, envelope)` / `openV1`, `parseEnvelope` / `checkEnvelope` (the engine's shape rules),
`Receiver` (`to`, replay and age checks), `parseConnectionId(id)` / `formatConnectionId(socketId, key)`
/ `isSocketId`, `createClientE2E(options)` (what the client core drives), `newMessageId()`, and the
constants `E2E_EVENT` (`hubfly.e2e`), `CLIENT_E2E_EVENT`, `USER_INFO_EVENT` (`presence.user_info`),
`SIGNIN_USER_INFO_EVENT` (`signin.user_info`), `DEFAULT_MAX_AGE_MS`.
The wire format is specified in `hubfly-realtime/docs/E2E.md`; `test/fixtures/vectors.json` is a
byte copy of the engine's shared test vectors.

## Development

```bash
bun test                 # unit, protocol (in-process fake server), interop and size tests
bun run build            # dist/: ESM + CJS + .d.ts for the three entries
bun run typecheck
```

Interop tests check signatures and envelopes against `pusher` (pusher-http-node), `tweetnacl` and
pusher-js `with-encryption`. The live tests (`test/live.test.ts`) run against a real instance or the
engine's dev server and skip unless `HUBFLY_REALTIME_TEST_URL`, `HUBFLY_REALTIME_TEST_APP_ID`,
`HUBFLY_REALTIME_TEST_KEY` and `HUBFLY_REALTIME_TEST_SECRET` are set (optionally
`HUBFLY_REALTIME_TEST_REQUIRED_APP_ID`/`_KEY`/`_SECRET` for an app with the `required` policy, and
`HUBFLY_REALTIME_TEST_RESTART`, a shell command that restarts the instance with SIGTERM on the same
address and data directory and returns once it is ready, for the planned-restart test). The main
app needs the offline queue on and a detach TTL of at least 10 s (the fixture has both):

```bash
# test/fixtures/rt-devserver-apps.json: app 1000001 ("optional" policy) and 1000002 ("required"), test-only keys
(cd ../../../hubfly-realtime && go build -o /tmp/rt-devserver ./cmd/rt-devserver)
/tmp/rt-devserver -config test/fixtures/rt-devserver-apps.json -listen 127.0.0.1:0 -data-dir /tmp/rt-data   # prints {"ready":true,"listeners":["127.0.0.1:<port>"],…}
export HUBFLY_REALTIME_TEST_URL=http://127.0.0.1:<port> HUBFLY_REALTIME_TEST_APP_ID=1000001 \
  HUBFLY_REALTIME_TEST_KEY=sdklivetestkey000001 HUBFLY_REALTIME_TEST_SECRET=sdk-live-secret-0123456789 \
  HUBFLY_REALTIME_TEST_REQUIRED_APP_ID=1000002 HUBFLY_REALTIME_TEST_REQUIRED_KEY=sdklivetestkey000002 \
  HUBFLY_REALTIME_TEST_REQUIRED_SECRET=sdk-live-secret-required-0123
bun test test/live.test.ts
(cd ../go/realtime && go test -run Live -v ./...)
```

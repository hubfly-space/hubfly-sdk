# HubFly Streams

Play, publish and secure live video and audio from HubFly Managed Streams.
Includes a browser player, browser publishing over WHIP, and server helpers for
playback tokens and webhook signatures.

```sh
npm install @hubfly/streams
# optional: LL-HLS playback in browsers without native HLS (Chrome, Firefox, Edge)
npm install hls.js
```

| Entry | Runs in | What it does |
|---|---|---|
| `@hubfly/streams` | anywhere | Types and URL helpers (`playbackURLs`, `withToken`) |
| `@hubfly/streams/player` | browser | `<hubfly-player>` and `createPlayer()`: WebRTC, then LL-HLS, then HLS |
| `@hubfly/streams/publish` | browser | `publish()`: camera, screen or canvas to a WHIP input |
| `@hubfly/streams/server` | Node 18+, Bun, Deno, Workers | `signPlaybackToken`, `verifyPlaybackToken`, `signWebhook`, `verifyWebhook` |

## Get started

In the [HubFly Dashboard](https://dashboard.hubfly.space), create a Stream
server. It comes with an input (your encoder sends to it) and a channel (your
viewers watch it). Copy the channel's id and the server host, for example
`acme-tv.live.hubfly.app`, from the channel's **Playback** tab.

### 1. Embed the player

```html
<script type="module">
  import '@hubfly/streams/player';
</script>

<hubfly-player host="acme-tv.live.hubfly.app" channel="sch_main0001" autoplay muted></hubfly-player>
```

Or from code:

```js
import { createPlayer } from '@hubfly/streams/player';

const player = createPlayer(document.querySelector('#player'), {
  host: 'acme-tv.live.hubfly.app',
  channel: 'sch_main0001',
  autoplay: true,
  muted: true,
});

document.querySelector('#player').addEventListener('statechange', (event) => {
  console.log(event.detail.state, event.detail.message); // "live", "Live"
});
```

The player tries WebRTC (WHEP, under a second of latency) first. When WebRTC
is refused (the channel's WebRTC session cap is reached, the source has
B-frames, or WebRTC is off on the channel) or cannot connect, it falls back to
LL-HLS: natively in Safari, otherwise through `hls.js`, which is imported only
at that moment. After repeated LL-HLS failures it uses plain HLS.

Browsers allow autoplay only when muted. Without `autoplay`, or when the
browser blocks it, the player shows a **Play** button.

### 2. Protect a channel with playback tokens

Set the channel's access to **Token**, create a playback key on the server's
**Playback keys** tab, and keep its secret on your backend. A Dashboard binding
writes it into your container:

```dotenv
HUBFLY_STREAM_URL=https://acme-tv.live.hubfly.app
HUBFLY_STREAM_PLAYBACK_KEY_ID=spk_key00001
HUBFLY_STREAM_PLAYBACK_KEY_SECRET=your-playback-key-secret
```

Mint a short-lived token per viewer on your server:

```js
import { signPlaybackToken } from '@hubfly/streams/server';

export async function GET(request) {
  // Check your own session first: only signed-in viewers get a token.
  const token = await signPlaybackToken(
    { id: process.env.HUBFLY_STREAM_PLAYBACK_KEY_ID, secret: process.env.HUBFLY_STREAM_PLAYBACK_KEY_SECRET },
    { ch: 'sch_main0001', sub: 'viewer-42' },
    { ttlSeconds: 3600 },
  );
  return Response.json({ token });
}
```

and give it to the player:

```html
<hubfly-player host="acme-tv.live.hubfly.app" channel="sch_main0001" token="eyJhbGciOi…"></hubfly-player>
```

Changing the `token` attribute reconnects with the new token. A session that
has started keeps playing until the token's `exp`. Use `ch: '*'` for every
channel of the server, and `ip: '203.0.113.0/24'` to bind a token to a
network. Tokens live at most 31 days.

### 3. Verify webhooks

The stream server signs every webhook delivery with the webhook's secret
(`whsec_…`, shown once when you create the webhook). Verify the **raw** body,
before parsing it:

```js
import { verifyWebhook } from '@hubfly/streams/server';

export async function POST(request) {
  const raw = await request.text();
  const ok = await verifyWebhook(process.env.HUBFLY_STREAM_WEBHOOK_SECRET, raw, request.headers.get('HubFly-Signature'));
  if (!ok) return new Response('invalid signature', { status: 400 });

  const event = JSON.parse(raw); // {"id":"evt_…","type":"channel.live","at":"…","tenant":"msi_…","data":{…}}
  if (event.type === 'channel.live') console.log('Live:', event.data.channel);
  return new Response(null, { status: 204 });
}
```

Signatures older or newer than 300 seconds are refused (`toleranceSeconds`
changes that). Answer with a 2xx within 10 seconds; failed deliveries are
retried for about 8 hours. Use `HubFly-Event-Id` to ignore repeats.

### 4. Go live from the browser

Create an input with the **WHIP** protocol, and send its stream key only to
the people allowed to broadcast (it lets anyone publish to the input):

```js
import { publish } from '@hubfly/streams/publish';

const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });

try {
  const broadcast = await publish({
    url: 'https://acme-tv.live.hubfly.app/whip/sin_cam00001',
    token: streamKey,
    stream,
    maxBitrateKbps: 4500,
  });
  broadcast.addEventListener('statechange', () => console.log(broadcast.state)); // connecting → live
  // later
  await broadcast.stop();
} catch (error) {
  // error.code: unauthorized (bad key), forbidden (input disabled, server stopped or paused),
  // conflict (another encoder is publishing), network, ice, …
  console.error(error.code, error.message);
}
```

Video prefers H.264 (the codec every output can pass through), then VP8; audio
is Opus. For OBS, ffmpeg or hardware encoders use RTMPS or SRT instead
(Dashboard **Inputs** tab, or `hubfly stream push`).

## The player

### Attributes and options

| Attribute | Option | Default | Meaning |
|---|---|---|---|
| `host` | `host` | | Server host or verified custom playback domain |
| `channel` | `channel` | | Channel id |
| `hls`, `whep`, `status` | `urls` | | Explicit playback URLs instead of `host` + `channel` |
| `token` | `token` | | Playback token for channels in token mode |
| `latency` | `latency` | `webrtc` | `webrtc`, `ll-hls` or `hls`: the first transport to try |
| `autoplay` | `autoplay` | off | Start as soon as media arrives (with `muted` in most browsers) |
| `muted` | `muted` | off | Start muted |
| `poster` | `poster` | | Image shown before the first frame |
| `controls="false"` | `controls` | on | Native media controls |
| `audio-only` | `audioOnly` | off | Play in an `<audio>` element from the audio outputs (Opus, else MP3) |
| | `hlsConfig` | | Extra `hls.js` configuration |
| | `loadHls` | `import('hls.js')` | Load `hls.js` from elsewhere (a CDN) |

### States

The element carries `state` (and `reason`) attributes, dispatches a
`statechange` event (`detail: {state, reason, transport, message}`), and
announces `message` through an `aria-live` status. Style it with
`hubfly-player[state="offline"] { … }`.

| `state` | `reason` | Shown to viewers |
|---|---|---|
| `loading` | | Connecting… |
| `live` | | Live |
| `reconnecting` | | Reconnecting… (retries with backoff up to 30 s) |
| `offline` | `not_live` | The offline slate plays: nothing is live yet |
| `offline` | `stopped`, `paused` | The server is stopped or paused; the player checks again every 5 s |
| `error` | `unauthorized`, `forbidden`, `unsupported`, … | Why it can't play, and a **Try again** button |

Every state has text, not only a colored dot. The Play and Try again buttons
are real buttons with a visible focus ring, and the player has no animation
beyond a 200 ms fade, which `prefers-reduced-motion` turns off.

### Methods

`createPlayer(el, options)` returns `{media, state, reason, transport, play(), reload(), destroy()}`.
`<hubfly-player>` exposes the same object as `element.player`.

## More

- [API reference](docs/api.md): every export and its signature.
- [Player details](docs/player.md): transports, fallbacks, offline slates, styling and accessibility.
- [Development](docs/development.md): build, tests, size budgets and test vectors.
- Manage servers, inputs, channels and keys from code with
  [`@hubfly/sdk`](../ts) (`hubfly.managed.streams`) or the
  [CLI](https://github.com/hubfly-space/hubfly-cli) (`hubfly stream`).
- Go backends: [`github.com/hubfly/hubfly-sdk/go/streams`](../go/streams).

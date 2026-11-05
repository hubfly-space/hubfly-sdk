# API reference

[Get started](../README.md)

## `@hubfly/streams`

```ts
const VERSION: string;

type PlayerState = 'loading' | 'live' | 'reconnecting' | 'offline' | 'error';
type LatencyPreference = 'webrtc' | 'll-hls' | 'hls';
type PlayerTransport = 'webrtc' | 'll-hls' | 'hls' | 'audio';

interface PlaybackURLs {
  hls: string;          // HLS / LL-HLS multivariant playlist
  whep?: string;        // WHEP endpoint
  status?: string;      // status JSON
  thumb?: string;       // JPEG thumbnail
  embed?: string;       // embed page
  audio?: Array<{ format: string; url: string }>; // mp3, aac, opus
}

interface ChannelStatus { live: boolean; viewers?: number; started_at?: string; state?: string }

function playbackURLs(host: string, channel: string): PlaybackURLs;
function withToken(url: string, token?: string): string; // adds ?token=
```

`host` is the server host (`acme-tv.live.hubfly.app`), a verified custom
playback domain, or a full origin (`https://dev.localhost:18443`).

## `@hubfly/streams/player`

Importing the entry registers `<hubfly-player>` in browsers (and does nothing
in server renderers).

```ts
function createPlayer(el: HTMLElement, options: PlayerOptions): Player;
function defineHubflyPlayer(name?: string): void; // default 'hubfly-player'

interface PlayerOptions {
  urls?: PlaybackURLs;   // or host + channel
  host?: string;
  channel?: string;
  token?: string;
  latency?: LatencyPreference;   // default 'webrtc'
  autoplay?: boolean;
  muted?: boolean;
  poster?: string;
  controls?: boolean;            // default true
  audioOnly?: boolean;
  hlsConfig?: Record<string, unknown>;
  loadHls?: () => Promise<unknown>; // default import('hls.js')
}

interface Player {
  readonly media: HTMLMediaElement;
  readonly state: PlayerState;
  readonly reason: string;
  readonly transport: PlayerTransport | undefined;
  play(): Promise<void>;
  reload(): void;
  destroy(): void;
}

interface PlayerStateDetail { state: PlayerState; reason: string; transport: PlayerTransport | undefined; message: string }
```

The host element dispatches `statechange` (`CustomEvent<PlayerStateDetail>`)
and carries `state` and `reason` attributes. The entry also re-exports
`MediaError`, `playbackURLs`, `withToken` and the shared types.

## `@hubfly/streams/publish`

```ts
function publish(options: PublishOptions): Promise<PublishHandle>;

interface PublishOptions { url: string; token: string; stream: MediaStream; maxBitrateKbps?: number }

type PublishState = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'stopped';

interface PublishHandle extends EventTarget {   // dispatches 'statechange'
  readonly state: PublishState;
  readonly peerConnection: RTCPeerConnection;
  stop(): Promise<void>;
}

class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly status: number;      // HTTP status, 0 for network/ICE failures
  readonly reason: string;      // the server's short reason, e.g. 'input_disabled'
  readonly retryAfter?: number; // seconds, from Retry-After
}

type MediaErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'
  | 'rate_limited' | 'bad_request' | 'network' | 'ice' | 'failed';
```

| WHIP status | `code` | Meaning (INGEST.md "Refusals") |
|---|---|---|
| 401 | `unauthorized` | Bad key, unknown input, or WHIP not enabled on the input |
| 403 | `forbidden` | Input disabled, server stopped or billing-blocked, address not allowed |
| 409 | `conflict` | Another encoder is publishing on that role |
| 503 | `unavailable` | The server is not accepting publishers |

## `@hubfly/streams/server`

```ts
function signPlaybackToken(
  key: { id: string; secret: string },
  claims: { ch: string; exp?: number; iat?: number; nbf?: number; sub?: string; ip?: string },
  options?: { ttlSeconds?: number; now?: number },   // ttl default 3600, max 31 days
): Promise<string>;

function verifyPlaybackToken(
  token: string,
  keys: readonly PlaybackKey[],                      // { id, secret, status?: 'active' | 'retiring' | 'revoked' }
  options: { channel: string; clientIp?: string; now?: number },
): Promise<PlaybackClaims>;                          // throws PlaybackTokenError

function signWebhook(secret: string, body: string, timestamp?: number): Promise<string>;

function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null | undefined,                 // HubFly-Signature
  options?: { toleranceSeconds?: number; now?: number }, // default 300
): Promise<boolean>;

class PlaybackTokenError extends Error {}            // message: 'Playback token refused'
```

Times are Unix seconds. The server entry uses only Web Crypto and works in
Node 18+, Bun, Deno and Cloudflare Workers.

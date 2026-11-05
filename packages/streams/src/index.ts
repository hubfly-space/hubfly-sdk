/**
 * Shared types and URL helpers of `@hubfly/streams`. The browser player lives in
 * `@hubfly/streams/player`, WHIP publishing in `@hubfly/streams/publish`, and token
 * signing and webhook verification (server only) in `@hubfly/streams/server`.
 */

export const VERSION = '0.1.0';

/**
 * What a player shows (PLAYBACK.md):
 * - `loading`: connecting to the channel;
 * - `live`: media is playing;
 * - `reconnecting`: the connection dropped; retrying with backoff;
 * - `offline`: nothing is live (the offline slate plays), or the server is stopped or paused;
 * - `error`: the playback token was refused (401/403) or the browser cannot play the channel.
 */
export type PlayerState = 'loading' | 'live' | 'reconnecting' | 'offline' | 'error';

/** Preferred transport: WebRTC (WHEP, < 1 s), LL-HLS (3–5 s) or plain HLS (15–25 s). */
export type LatencyPreference = 'webrtc' | 'll-hls' | 'hls';

/** The transport a player is using. */
export type PlayerTransport = 'webrtc' | 'll-hls' | 'hls' | 'audio';

/** The playback URLs of a channel, as returned by the Dashboard (`GET …/channels/:id/playback`). */
export interface PlaybackURLs {
  /** HLS / LL-HLS multivariant playlist. */
  hls: string;
  /** WHEP endpoint; absent when WebRTC playback is disabled on the channel. */
  whep?: string;
  /** Public status JSON (`{"live":…,"viewers":…,"state":…}`). */
  status?: string;
  /** JPEG thumbnail, at most 5 s old. */
  thumb?: string;
  /** Embed page. */
  embed?: string;
  /** Icecast-compatible audio outputs. */
  audio?: Array<{ format: string; url: string }>;
}

/** The answer of `status/<channel>.json`. */
export interface ChannelStatus {
  live: boolean;
  viewers?: number;
  started_at?: string;
  /** `stopped` or `paused` when the server serves no media. */
  state?: string;
}

/**
 * The playback URLs of a channel from the server host (`acme-tv.live.hubfly.app`, a verified
 * custom playback domain, or a full origin such as `https://dev.localhost:18443`) and the
 * channel id. Outputs that are disabled on the channel answer 404.
 */
export function playbackURLs(host: string, channel: string): PlaybackURLs {
  const origin = host.includes('://') ? new URL(host).origin : `https://${host}`;
  const ch = encodeURIComponent(channel);
  return {
    hls: `${origin}/hls/${ch}/index.m3u8`,
    whep: `${origin}/whep/${ch}`,
    status: `${origin}/status/${ch}.json`,
    thumb: `${origin}/thumb/${ch}.jpg`,
    embed: `${origin}/embed/${ch}`,
    audio: ['mp3', 'aac', 'opus'].map((format) => ({ format, url: `${origin}/radio/${ch}.${format}` })),
  };
}

/** Adds `token` to a playback URL as `?token=` (HLS, audio, thumbnail, status, embed). */
export function withToken(url: string, token?: string): string {
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.href;
}

export type {
  PlaybackClaims,
  PlaybackKey,
  SignPlaybackTokenOptions,
  VerifyPlaybackTokenOptions,
  VerifyWebhookOptions,
} from './server';
export type { Player, PlayerOptions, PlayerStateDetail } from './player';
export type { PublishHandle, PublishOptions, PublishState } from './publish';
export type { MediaError, MediaErrorCode } from './rtc';

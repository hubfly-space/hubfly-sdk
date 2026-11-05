/**
 * `@hubfly/streams/player`: plays a HubFly Managed Streams channel in the browser.
 *
 * WebRTC (WHEP) first when the latency preference allows it; when WHEP is refused (session cap,
 * a source with B-frames, WebRTC disabled) or ICE fails, LL-HLS: native in Safari, otherwise
 * `hls.js`, imported only at that moment (optional peer dependency). After repeated LL-HLS
 * failures the player drops to plain HLS. Audio-only channels play in an `<audio>` element from
 * the Icecast-compatible outputs.
 *
 * Importing this entry registers `<hubfly-player>`; it is safe in server renderers.
 */
import { playbackURLs, withToken } from './index';
import type { ChannelStatus, LatencyPreference, PlaybackURLs, PlayerState, PlayerTransport } from './index';
import { completeOffer, endSession, exchange, MediaError } from './rtc';

export { MediaError } from './rtc';
export type { ChannelStatus, LatencyPreference, PlaybackURLs, PlayerState, PlayerTransport } from './index';
export { playbackURLs, withToken } from './index';

export interface PlayerOptions {
  /** The channel's playback URLs (Dashboard `GET …/channels/:id/playback` → `urls`). */
  urls?: PlaybackURLs;
  /** The server host (or custom playback domain) when `urls` is not given. */
  host?: string;
  /** The channel id when `urls` is not given. */
  channel?: string;
  /** A playback token for channels in token mode (mint it on your server). */
  token?: string;
  /** Preferred transport; default `webrtc` (falls back to LL-HLS, then HLS). */
  latency?: LatencyPreference;
  /** Start playing as soon as media arrives; browsers allow it only when `muted`. Default false. */
  autoplay?: boolean;
  muted?: boolean;
  /** Image shown before the first frame (video only). */
  poster?: string;
  /** Native media controls; default true. */
  controls?: boolean;
  /** Play an audio-only channel in an `<audio>` element. */
  audioOnly?: boolean;
  /** Extra `hls.js` configuration. */
  hlsConfig?: Record<string, unknown>;
  /** Loads the `hls.js` constructor; default `import('hls.js')`. */
  loadHls?: () => Promise<unknown>;
}

export interface Player {
  readonly media: HTMLMediaElement;
  readonly state: PlayerState;
  /** Why the player is `offline` (`paused`, `stopped`, `not_live`) or in `error`; empty otherwise. */
  readonly reason: string;
  readonly transport: PlayerTransport | undefined;
  /** Starts playback from a user gesture (when autoplay was blocked). */
  play(): Promise<void>;
  /** Reconnects now. */
  reload(): void;
  destroy(): void;
}

/** Detail of the `statechange` event dispatched on the host element. */
export interface PlayerStateDetail {
  state: PlayerState;
  reason: string;
  transport: PlayerTransport | undefined;
  /** A readable sentence, also announced through the `aria-live` status. */
  message: string;
}

const HLS_MIME = 'application/vnd.apple.mpegurl';
const STATUS_LIVE_MS = 15_000;
const STATUS_OFFLINE_MS = 5_000;
const ICE_CONNECT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

const WHEP_MESSAGES = {
  unauthorized: 'The playback token was refused',
  forbidden: 'Playback is not allowed from here',
  conflict: 'WebRTC playback is not available for this channel',
  unavailable: 'WebRTC playback is full',
};

const STYLE = `.hfp{position:relative;display:block;width:100%;background:#0b0d10;color:#f5f6f7;font:500 14px/1.4 system-ui,sans-serif}
.hfp video{display:block;width:100%;height:100%;aspect-ratio:16/9;background:#000}
.hfp audio{display:block;width:100%}
.hfp-status{position:absolute;left:12px;top:12px;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;background:rgba(11,13,16,.82);transition:opacity .2s ease}
.hfp audio~.hfp-status{position:static;margin:8px 0 0;width:max-content}
.hfp[data-state=live] .hfp-status{opacity:.92}
.hfp-dot{width:8px;height:8px;border-radius:50%;background:#9aa0a6}
.hfp[data-state=live] .hfp-dot{background:#e5484d}
.hfp[data-state=error] .hfp-dot{background:#f5a524}
.hfp-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 20px;border:0;border-radius:6px;background:#f5f6f7;color:#0b0d10;font:600 15px/1 system-ui,sans-serif;cursor:pointer}
.hfp audio~.hfp-play{position:static;transform:none;margin:8px 0 0}
.hfp-play:hover{background:#fff}
.hfp-play:focus-visible{outline:3px solid #4ea1ff;outline-offset:3px}
.hfp-play[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.hfp-status{transition:none}}`;

function message(state: PlayerState, reason: string): string {
  switch (state) {
    case 'loading':
      return 'Connecting…';
    case 'live':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'offline':
      return reason === 'paused' || reason === 'stopped' ? 'This stream is paused' : 'Offline: the stream will start here when it goes live';
    case 'error':
      return reason === 'unsupported'
        ? "This browser can't play the stream"
        : `Can't play this stream: ${reason === 'unauthorized' || reason === 'forbidden' ? 'access was refused' : reason}`;
  }
}

type HlsLike = {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: { fatal?: boolean; type?: string; response?: { code?: number } }) => void): void;
  recoverMediaError(): void;
  destroy(): void;
};
type HlsConstructor = {
  new (config: Record<string, unknown>): HlsLike;
  isSupported(): boolean;
  Events: { ERROR: string };
  ErrorTypes?: { MEDIA_ERROR?: string };
};

const importHls = () => import('hls.js').then((m) => (m as { default?: unknown }).default ?? m);

/** Plays a channel inside `el` and reflects its state as `state`/`reason` attributes and `statechange` events. */
export function createPlayer(el: HTMLElement, options: PlayerOptions): Player {
  const urls = options.urls ?? playbackURLs(required(options.host, 'host'), required(options.channel, 'channel'));
  const token = options.token;
  const latency = options.latency ?? 'webrtc';
  const audioOnly = !!options.audioOnly;

  const root = document.createElement('div');
  root.className = 'hfp';
  const style = document.createElement('style');
  style.textContent = STYLE;
  const media = document.createElement(audioOnly ? 'audio' : 'video') as HTMLMediaElement;
  media.controls = options.controls ?? true;
  media.muted = !!options.muted;
  media.autoplay = false; // playback starts through play() so a blocked autoplay shows the Play button
  media.preload = 'auto';
  if (!audioOnly) {
    media.setAttribute('playsinline', '');
    if (options.poster) media.setAttribute('poster', options.poster);
  }
  const status = document.createElement('div');
  status.className = 'hfp-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const dot = document.createElement('span');
  dot.className = 'hfp-dot';
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  status.append(dot, text);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hfp-play';
  button.hidden = true;
  root.append(style, media, status, button);
  el.append(root);

  let state: PlayerState | undefined;
  let reason = '';
  let transport: PlayerTransport | undefined;
  let destroyed = false;
  let gen = 0; // bumped on every teardown; async work of an older generation stops
  let attempt = 0;
  let llFailures = 0;
  let offline = false; // the status endpoint says nothing is live (the slate plays)
  let paused = false; // the server is stopped or paused: no media at all
  let attached = false;
  let pc: RTCPeerConnection | undefined;
  let session: string | undefined;
  let hls: HlsLike | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let iceTimer: ReturnType<typeof setTimeout> | undefined;

  function set(next: PlayerState, why = '') {
    if (destroyed || (next === state && why === reason)) return;
    state = next;
    reason = why;
    const msg = message(next, why);
    root.setAttribute('data-state', next);
    el.setAttribute('state', next);
    if (why) el.setAttribute('reason', why);
    else el.removeAttribute('reason');
    text.textContent = msg;
    if (next === 'error') showButton('Try again');
    else if (button.textContent === 'Try again') button.hidden = true;
    const detail: PlayerStateDetail = { state: next, reason: why, transport, message: msg };
    el.dispatchEvent(new CustomEvent('statechange', { detail }));
  }

  function showButton(label: string) {
    button.textContent = label;
    button.hidden = false;
  }

  function teardown() {
    gen++;
    attached = false;
    clearTimeout(iceTimer);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.close();
      pc = undefined;
    }
    endSession(session, token);
    session = undefined;
    hls?.destroy();
    hls = undefined;
    if (media.srcObject) media.srcObject = null;
    if (media.getAttribute('src')) {
      media.removeAttribute('src');
      media.load();
    }
    transport = undefined;
  }

  function flowing() {
    if (!attached || destroyed) return;
    attempt = 0;
    set(offline ? 'offline' : 'live', offline ? 'not_live' : '');
  }

  function fail(why: string) {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    teardown();
    set('error', why);
    poll(); // a refreshed page or token is the usual fix; keep checking the status anyway
  }

  function retry() {
    if (destroyed || retryTimer || state === 'error') return;
    teardown();
    set('reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++) * (0.75 + Math.random() * 0.25);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void start();
    }, delay);
  }

  async function checkStatus(): Promise<ChannelStatus | 'refused' | undefined> {
    if (!urls.status) return;
    try {
      const response = await fetch(withToken(urls.status, token), { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) return 'refused';
      if (response.ok) return (await response.json()) as ChannelStatus;
    } catch {
      // Best effort: media requests report real failures.
    }
  }

  function applyStatus(s: ChannelStatus | undefined) {
    paused = s?.state === 'stopped' || s?.state === 'paused';
    offline = s?.live === false;
  }

  function poll() {
    clearTimeout(pollTimer);
    if (destroyed || !urls.status) return;
    pollTimer = setTimeout(async () => {
      const my = gen;
      const s = await checkStatus();
      if (destroyed) return;
      if (s === 'refused') {
        if (state !== 'error') fail('unauthorized');
        else poll();
        return;
      }
      const wasPaused = paused;
      applyStatus(s);
      if (my !== gen && state !== 'error') return poll();
      if (paused && !wasPaused) {
        teardown();
        set('offline', s?.state);
      } else if (!paused && (wasPaused || state === 'error') && s) {
        attempt = 0;
        return void start();
      } else if (attached && (state === 'live' || state === 'offline')) {
        set(offline ? 'offline' : 'live', offline ? 'not_live' : '');
      }
      poll();
    }, state === 'live' ? STATUS_LIVE_MS : STATUS_OFFLINE_MS);
  }

  function order(): PlayerTransport[] {
    const list: PlayerTransport[] = [];
    if (latency === 'webrtc' && urls.whep && typeof RTCPeerConnection !== 'undefined') list.push('webrtc');
    if (audioOnly && urls.audio?.length) list.push('audio');
    else list.push(latency === 'hls' || llFailures >= 2 ? 'hls' : 'll-hls');
    return list;
  }

  async function attachWebRTC(my: number) {
    const peer = new RTCPeerConnection();
    pc = peer;
    peer.addTransceiver('audio', { direction: 'recvonly' });
    if (!audioOnly) peer.addTransceiver('video', { direction: 'recvonly' });
    peer.ontrack = (event) => {
      if (my !== gen) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (media.srcObject !== stream) media.srcObject = stream;
      startPlayback();
    };
    const { answer, session: url } = await exchange(urls.whep!, await completeOffer(peer), token, WHEP_MESSAGES);
    if (my !== gen) return endSession(url, token);
    session = url;
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    await new Promise<void>((resolve, reject) => {
      iceTimer = setTimeout(() => reject(new MediaError('ice', 'WebRTC could not connect')), ICE_CONNECT_MS);
      peer.onconnectionstatechange = () => {
        const s = peer.connectionState;
        if (s === 'connected') {
          clearTimeout(iceTimer);
          resolve();
        } else if (s === 'failed' || s === 'closed') {
          clearTimeout(iceTimer);
          reject(new MediaError('ice', 'WebRTC could not connect'));
        }
      };
      peer.onconnectionstatechange(new Event('connectionstatechange')); // it may have settled already
    });
    peer.onconnectionstatechange = () => {
      if (my !== gen) return;
      if (peer.connectionState === 'failed') retry();
      else if (peer.connectionState === 'disconnected') {
        clearTimeout(iceTimer);
        iceTimer = setTimeout(() => peer.connectionState !== 'connected' && my === gen && retry(), 4000);
      }
    };
  }

  async function attachHLS(my: number, low: boolean) {
    const src = withToken(urls.hls, token);
    if (media.canPlayType(HLS_MIME)) {
      media.src = src; // Safari plays LL-HLS natively
      return startPlayback();
    }
    let Hls: HlsConstructor | undefined;
    try {
      Hls = (await (options.loadHls ?? importHls)()) as HlsConstructor;
    } catch {
      // hls.js is not installed.
    }
    if (my !== gen) return;
    if (!Hls?.isSupported?.()) throw new MediaError('failed', 'unsupported');
    const player = new Hls({ lowLatencyMode: low, liveDurationInfinity: true, ...options.hlsConfig });
    hls = player;
    let recovered = false;
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (my !== gen || !data.fatal) return;
      const code = data.response?.code;
      if (code === 401 || code === 403) return fail(code === 401 ? 'unauthorized' : 'forbidden');
      if (data.type === (Hls!.ErrorTypes?.MEDIA_ERROR ?? 'mediaError') && !recovered) {
        recovered = true;
        return player.recoverMediaError();
      }
      if (low) llFailures++;
      retry();
    });
    player.loadSource(src);
    player.attachMedia(media);
    startPlayback();
  }

  function attachAudio() {
    const outputs = urls.audio!;
    const opus = media.canPlayType('audio/ogg; codecs=opus') ? outputs.find((o) => o.format === 'opus') : undefined;
    media.src = withToken((opus ?? outputs.find((o) => o.format === 'mp3') ?? outputs[0]).url, token);
    startPlayback();
  }

  function startPlayback() {
    attached = true;
    if (!options.autoplay && !button.hidden) return;
    if (!options.autoplay) return showButton('Play');
    const result = media.play();
    if (result && typeof result.catch === 'function') {
      result.catch((error: { name?: string }) => {
        if (error?.name === 'NotAllowedError') showButton('Play');
      });
    }
  }

  async function start() {
    if (destroyed) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    teardown();
    const my = gen;
    if (state !== 'reconnecting') set('loading');
    const s = await checkStatus();
    if (my !== gen || destroyed) return;
    if (s === 'refused') return fail('unauthorized');
    applyStatus(s);
    if (paused) {
      set('offline', s!.state);
      return poll();
    }
    const list = order();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      try {
        transport = t;
        if (t === 'webrtc') await attachWebRTC(my);
        else if (t === 'audio') attachAudio();
        else await attachHLS(my, t === 'll-hls');
        if (my !== gen) return;
        attached = true;
        if (t === 'webrtc' && media.srcObject) flowing();
        break;
      } catch (error) {
        if (my !== gen) return;
        const e = error instanceof MediaError ? error : new MediaError('failed', String(error));
        if (e.code === 'unauthorized' || e.code === 'forbidden') return fail(e.reason || e.code);
        if (e.status === 503 && e.reason.startsWith('server_')) {
          teardown();
          paused = true;
          set('offline', e.reason === 'server_blocked' ? 'paused' : 'stopped');
          return poll();
        }
        if (e.message === 'unsupported' && i === list.length - 1) return fail('unsupported');
        if (t === 'webrtc') {
          // Fall back: tear down WebRTC only, keep the generation.
          pc?.close();
          pc = undefined;
          endSession(session, token);
          session = undefined;
          clearTimeout(iceTimer);
          continue;
        }
        return retry();
      }
    }
    poll();
  }

  const onOnline = () => {
    if (state === 'reconnecting') {
      attempt = 0;
      void start();
    }
  };
  const onOffline = () => retry();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }
  media.addEventListener('loadeddata', flowing);
  media.addEventListener('playing', () => {
    button.hidden = true;
    flowing();
  });
  media.addEventListener('error', () => attached && retry());
  media.addEventListener('ended', () => attached && retry());
  button.addEventListener('click', () => {
    if (state === 'error') {
      attempt = 0;
      set('loading');
      void start();
    } else void api.play();
  });

  const api: Player = {
    media,
    get state() {
      return state ?? 'loading';
    },
    get reason() {
      return reason;
    },
    get transport() {
      return transport;
    },
    async play() {
      button.hidden = true;
      await media.play();
    },
    reload() {
      attempt = 0;
      void start();
    },
    destroy() {
      if (destroyed) return;
      teardown();
      destroyed = true;
      clearTimeout(retryTimer);
      clearTimeout(pollTimer);
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
      root.remove();
      el.removeAttribute('state');
      el.removeAttribute('reason');
    },
  };
  void start();
  return api;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`createPlayer: "${name}" is required without "urls"`);
  return value;
}

const ATTRIBUTES = ['host', 'channel', 'token', 'latency', 'hls', 'whep', 'status', 'autoplay', 'muted', 'poster', 'controls', 'audio-only'];

/**
 * Registers `<hubfly-player>` (done on import in browsers). Attributes: `host` + `channel`, or
 * `hls` (+ `whep`, `status`); `token`, `latency` (`webrtc` | `ll-hls` | `hls`), `autoplay`,
 * `muted`, `poster`, `controls="false"` (native controls are on by default), `audio-only`.
 * Changing an attribute reconnects (for example a refreshed `token`).
 */
export function defineHubflyPlayer(name = 'hubfly-player'): void {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined' || customElements.get(name)) return;
  class HubflyPlayer extends HTMLElement {
    static observedAttributes = ATTRIBUTES;
    player?: Player;

    connectedCallback() {
      this.render();
    }

    disconnectedCallback() {
      this.player?.destroy();
      this.player = undefined;
    }

    attributeChangedCallback() {
      if (this.player) this.render();
    }

    private render() {
      this.player?.destroy();
      const attr = (n: string) => this.getAttribute(n) ?? undefined;
      const hls = attr('hls');
      this.player = createPlayer(this, {
        host: attr('host'),
        channel: attr('channel'),
        urls: hls ? { hls, whep: attr('whep'), status: attr('status') } : undefined,
        token: attr('token'),
        latency: attr('latency') as LatencyPreference | undefined,
        autoplay: this.hasAttribute('autoplay'),
        muted: this.hasAttribute('muted'),
        poster: attr('poster'),
        controls: attr('controls') !== 'false',
        audioOnly: this.hasAttribute('audio-only'),
      });
    }
  }
  customElements.define(name, HubflyPlayer);
}

defineHubflyPlayer();

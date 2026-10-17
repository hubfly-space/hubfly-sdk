/**
 * `@hubfly/realtime/server`: the server side of HubFly Realtime.
 *
 * Runs on Cloudflare Workers, Bun, Deno and Node >= 18 with only `fetch` and WebCrypto
 * (HMAC-SHA256 via `crypto.subtle`; MD5 for `body_md5` is a small pure implementation).
 * Pusher-signed REST (`trigger`, `triggerBatch`, channel info/users, `terminateUserConnections`),
 * the HubFly endpoints (`send`, `toUser`, `channel().publish`, status, `terminate`, `history`,
 * receipts), channel/user authorization (pusher-js compatible, plus E2E keys), a Fetch-API auth
 * handler and webhook verification.
 */
import {
  CLIENT_E2E_EVENT,
  E2EError,
  E2E_EVENT,
  SIGNIN_USER_INFO_EVENT,
  USER_INFO_EVENT,
  decryptPusher,
  decryptV1,
  deriveKey,
  deriveWireKeys,
  encryptPusher,
  encryptV1,
  isSocketId,
  newMessageId,
  parseConnectionId,
  parseEnvelope,
  toBase64,
  toMasterKeys,
  type MasterKey,
  type WireKey,
} from '../e2e/index';
import { quoteId, toHex, utf8Encode } from '../e2e/codec';
import { md5 } from './md5';

export { E2EError, parseConnectionId, formatConnectionId, isSocketId, parseKeyList } from '../e2e/index';
export type { MasterKey, WireKey } from '../e2e/index';

// ---------------------------------------------------------------------------------------------
// Types

export interface RealtimeServerOptions {
  /** The instance URL, `https://<host>` (`HUBFLY_REALTIME_URL`). `wss://` is accepted too. */
  url: string;
  /** `HUBFLY_REALTIME_APP_ID` */
  appId: string;
  /** `HUBFLY_REALTIME_KEY` */
  key: string;
  /** `HUBFLY_REALTIME_SECRET` */
  secret: string;
  /**
   * Customer-held master keys (`HUBFLY_REALTIME_E2E_KEYS`: `kid:base64,…`, first is active, a bare
   * base64 value is kid `k1`). Enables end-to-end encryption; HubFly never sees these keys.
   */
  encryptionKeys?: string | ReadonlyArray<MasterKey | WireKey>;
  /**
   * "Full E2E": also seal publishes to `private-*` and `presence-*` channels with the v1 envelope
   * (event names hidden; pusher-js subscribers cannot read them), seal presence `user_info` and
   * hand those channels' keys to clients, which then accept only envelopes on them. Default false. `private-encrypted-*` channels, user messages and direct messages to E2E
   * connection ids are encrypted whenever keys are available.
   */
  fullE2E?: boolean;
  /**
   * Let `decrypt()` (and `history()`) return plaintext found in an E2E context (user messages,
   * full-E2E channels) with `encrypted: false` instead of throwing `E2EError('plaintext')`.
   * This WEAKENS the guarantee: a compromised relay could then forge such events. Default false.
   */
  allowPlaintext?: boolean;
  /** Custom fetch (defaults to the global `fetch`). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** WebCrypto implementation. Defaults to `globalThis.crypto`; on Node 18 pass `require('node:crypto').webcrypto`. */
  crypto?: Crypto;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
  /** Extra attempts for idempotent HubFly POSTs (`send`, `publish`) on network errors and 502/503/504 (default 1). */
  retries?: number;
  /** Clock in ms, for tests. */
  now?: () => number;
}

export type EnvLike = Record<string, string | undefined>;

export interface PresenceData {
  user_id: string | number;
  user_info?: unknown;
}

export interface ChannelAuthResponse {
  auth: string;
  channel_data?: string;
  /** Pusher's field for `private-encrypted-*` channels: base64 `K(channel, active kid)`. */
  shared_secret?: string;
  /** Every configured kid, active first (pusher-js ignores it). */
  hubfly?: { keys: WireKey[] };
}

export interface UserData {
  id: string;
  user_info?: unknown;
  [key: string]: unknown;
}

export interface UserAuthResponse {
  auth: string;
  user_data: string;
  hubfly?: { keys: WireKey[] };
}

/** What `authHandler`'s `getUser` returns for a signed-in user. */
export interface RealtimeUser {
  id: string;
  /** Presence `user_info` and sign-in `user_info`. */
  info?: unknown;
}

export interface AuthHandlerOptions {
  /** Returns the signed-in user of the request, or null/undefined. */
  getUser: (request: Request) => RealtimeUser | null | undefined | Promise<RealtimeUser | null | undefined>;
  /** May the user join the channel? Default: any signed-in user may join private/presence channels. */
  canAccess?: (user: RealtimeUser | null, channel: string, request: Request) => boolean | Promise<boolean>;
}

export interface TriggerOptions {
  /** Exclude this connection (socket id or E2E connection id) from delivery. */
  socketId?: string;
  /** `subscription_count`, `user_count` (comma-separated or a list). */
  info?: string | string[];
  /** Force (`true`, v1 envelope) or skip (`false`) encryption; default: automatic. */
  encrypt?: boolean;
}

export interface BatchEvent {
  channel: string;
  name: string;
  data: unknown;
  socketId?: string;
  info?: string | string[];
  encrypt?: boolean;
}

export interface TriggerResult {
  channels?: Record<string, { subscription_count?: number; user_count?: number }>;
  batch?: Array<{ subscription_count?: number; user_count?: number }>;
}

export interface PublishOptions {
  /** Idempotency key (1–64 of `[A-Za-z0-9_.:-]`); generated when omitted. Reuse it on retries. */
  messageId?: string;
  /** Exclude this connection from delivery. */
  socketId?: string;
  encrypt?: boolean;
}

export interface ChannelPosition {
  epoch: string;
  offset: number;
}

export interface PublishResult {
  message_id: string;
  /** Per channel position (`{}` for channels without history). */
  channels: Record<string, ChannelPosition | Record<string, never>>;
  /** Present when the publish was split (one request per encrypted channel). */
  message_ids?: Record<string, string>;
}

export interface SendOptions {
  /** Idempotency key; generated when omitted. Reuse it on retries. */
  messageId?: string;
  /** Ask the receiving client to acknowledge (receipt becomes `acked`). */
  ack?: boolean;
  /** Force (`true`) or skip (`false`) encryption; default: encrypt whenever a key is available. */
  encrypt?: boolean;
}

export type DeliveryStatus = 'delivered' | 'buffered' | 'queued' | 'offline';

export interface SendTargetResult {
  /** The id as given (connection id or user id). */
  id: string;
  socket_id?: string;
  user_id?: string;
  status: DeliveryStatus;
  connections?: number;
  /** The message id of the request that carried this target. */
  message_id: string;
}

export interface SendResult {
  message_id: string;
  results: SendTargetResult[];
}

export interface ConnectionStatus {
  socket_id: string;
  online: boolean;
  /** `connected` (or `detached` while a HubFly session waits to be resumed). */
  state?: string;
  /** The signed-in user, or null. */
  user_id?: string | null;
  connected_at?: string;
  /** When a detached session expires unless it is resumed. */
  expires_at?: string;
  /** `hubfly` or `pusher`. */
  protocol?: string;
}

export interface UserStatus {
  user_id: string;
  online: boolean;
  connections?: number;
  socket_ids?: string[];
}

export interface HistoryOptions {
  /** Only messages after this offset. */
  since?: number;
  /** The epoch `since` belongs to. */
  epoch?: string;
  /** At most 1000 (the engine's default is 100). */
  limit?: number;
  /**
   * Return `data` exactly as stored: the event's data text, envelopes unopened. Default false:
   * `data` is decoded the way client handlers receive it (JSON text parsed, E2E envelopes opened
   * with the configured keys).
   */
  raw?: boolean;
}

export interface HistoryMessage {
  offset: number;
  /** The event name (the real one when an envelope was opened). */
  event: string;
  data: unknown;
  message_id: string;
  published_at: string;
  /** The sender of a client event on a presence channel. */
  user_id?: string;
  /** Set when an envelope was opened. */
  encrypted?: boolean;
  /** Set when an envelope could not be opened (`data` is left as stored). */
  e2e_error?: string;
}

export interface HistoryResult {
  channel: string;
  epoch: string | null;
  head: number | null;
  oldest: number | null;
  messages: HistoryMessage[];
  truncated: boolean;
  gap: boolean;
}

export interface MessageReceipt {
  message_id: string;
  created_at: string;
  /** The event name the engine saw (`hubfly.e2e` for encrypted messages). */
  event: string;
  /** Per connection (`socket_id`, plus `user_id` for user messages; `socket_id` is null for an offline user). */
  targets: Array<{ socket_id?: string | null; user_id?: string; status: string; updated_at: string }>;
}

export interface TerminateOptions {
  /**
   * `terminate` (default) closes with 4009: clients stop and the session ends. `disconnect`
   * closes with 4200: clients reconnect at once (HubFly sessions resume).
   */
  mode?: 'terminate' | 'disconnect';
}

export interface WebhookEvent {
  name: string;
  channel?: string;
  event?: string;
  data?: string;
  socket_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface WebhookPayload {
  time_ms: number;
  events: WebhookEvent[];
}

export interface WebhookInput {
  headers: Headers | Record<string, string | string[] | undefined>;
  body: string | Uint8Array | ArrayBuffer;
}

export interface VerifyWebhookOptions {
  /** Max age of `X-HubFly-Signature` `t` in seconds (default 300); `t` may be at most 60 s in the future. */
  toleranceSeconds?: number;
  /** Accept requests that carry only `X-Pusher-Signature` (no replay protection). Default false. */
  allowPusherSignature?: boolean;
  /** Other key/secret pairs a webhook may be signed with (rotation). */
  extraKeys?: ReadonlyArray<{ key: string; secret: string }>;
}

/** A non-2xx answer of the realtime REST API. */
export class RealtimeApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** `e2e_required` when the app's encryption policy rejected plaintext. */
  readonly reason?: string;
  /** Seconds, from `Retry-After`. */
  readonly retryAfter?: number;
  constructor(status: number, body: unknown, retryAfter?: number) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${status}`;
    super(`HubFly Realtime API: ${msg}`);
    this.name = 'RealtimeApiError';
    this.status = status;
    this.body = body;
    this.reason = body && typeof body === 'object' && 'reason' in body ? String((body as { reason: unknown }).reason) : undefined;
    this.retryAfter = retryAfter;
  }
}

/** A webhook that failed verification. */
export class WebhookError extends Error {
  readonly reason:
    | 'missing_signature'
    | 'missing_hubfly_signature'
    | 'bad_signature'
    | 'timestamp_out_of_tolerance'
    | 'unknown_key'
    | 'bad_body';
  constructor(reason: WebhookError['reason']) {
    super(`HubFly Realtime webhook: ${reason}`);
    this.name = 'WebhookError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------------------------
// Names

const NAME = '[-a-zA-Z0-9_=@,.;]';
const CHANNEL_RE = new RegExp(`^${NAME}{1,200}$`);
const USER_CHANNEL_RE = new RegExp(`^#server-to-user-${NAME}{1,128}$`);
const USER_ID_RE = new RegExp(`^${NAME}{1,128}$`);
const MESSAGE_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const APP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_EVENT_RE = /^(pusher:|pusher_internal:|hubfly:)/;
const USER_PREFIX = '#server-to-user-';
const WEBHOOK_FUTURE_SKEW_S = 60;

const isChannel = (c: unknown): c is string =>
  typeof c === 'string' && c.length <= 200 && (CHANNEL_RE.test(c) || USER_CHANNEL_RE.test(c));
const needsAuth = (c: string) => c.startsWith('private-') || c.startsWith('presence-');
const isEnvelope = (d: unknown) => {
  try {
    parseEnvelope(d);
    return true;
  } catch {
    return false;
  }
};

function checkChannel(c: unknown, pathSafe = false): asserts c is string {
  if (!isChannel(c) || (pathSafe && c.startsWith('#'))) throw new TypeError(`HubFly Realtime: invalid channel name ${JSON.stringify(c)}`);
}

function checkEvent(e: unknown): asserts e is string {
  if (typeof e !== 'string' || !e.length || e.length > 200 || RESERVED_EVENT_RE.test(e)) {
    throw new TypeError(`HubFly Realtime: invalid event name ${JSON.stringify(e)}`);
  }
}

function checkUserId(u: unknown): asserts u is string {
  if (typeof u !== 'string' || !USER_ID_RE.test(u)) throw new TypeError(`HubFly Realtime: invalid user id ${quoteId(u)}`);
}

function checkMessageId(m: string) {
  if (!MESSAGE_ID_RE.test(m)) throw new TypeError(`HubFly Realtime: invalid message id ${JSON.stringify(m)} (1-64 of [A-Za-z0-9_.:-])`);
}

const toList = <T>(v: T | readonly T[]): T[] => (Array.isArray(v) ? [...v] : [v as T]);
const joinInfo = (info: string | string[] | undefined) => (Array.isArray(info) ? info.join(',') : info);
const encodeData = (data: unknown) => (typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data));
/** Stored/wire `data` text to the value client handlers receive (JSON parsed when possible). */
const decodeData = (data: unknown) => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

/** `base`, `base.1`, `base.2`, … for requests a call had to split. */
function splitId(base: string, i: number, total: number): string {
  if (total === 1) return base;
  const id = `${base}.${i}`;
  if (id.length > 64) throw new TypeError('HubFly Realtime: messageId too long to split across requests (keep it under 60 characters)');
  return id;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Constant-time string comparison (length is not secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function headerOf(headers: WebhookInput['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const rec = headers as Record<string, string | string[] | undefined>;
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === name) {
      const v = rec[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// RealtimeServer

export class RealtimeServer {
  readonly url: string;
  readonly appId: string;
  readonly key: string;
  private readonly secret: string;
  private readonly masters?: MasterKey[];
  private readonly fullE2E: boolean;
  private readonly allowPlaintext: boolean;
  private readonly doFetch: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly webCrypto?: Crypto;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly now: () => number;
  private readonly hmacKeys = new Map<string, Promise<CryptoKey>>();

  /**
   * Builds a server from environment variables: `HUBFLY_REALTIME_URL`, `HUBFLY_REALTIME_APP_ID`,
   * `HUBFLY_REALTIME_KEY`, `HUBFLY_REALTIME_SECRET` and optional `HUBFLY_REALTIME_E2E_KEYS`.
   * Each falls back to the Laravel/Pusher names (`PUSHER_HOST`/`PUSHER_PORT`/`PUSHER_SCHEME`,
   * `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`). `env` defaults to `process.env`
   * where it exists; on Workers pass the env bindings object.
   */
  static fromEnv(env?: EnvLike, overrides: Partial<RealtimeServerOptions> = {}): RealtimeServer {
    const e: EnvLike = env ?? (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
    let pusherUrl: string | undefined;
    if (e.PUSHER_HOST) {
      const scheme = e.PUSHER_SCHEME || 'https';
      const port = e.PUSHER_PORT && e.PUSHER_PORT !== (scheme === 'https' ? '443' : '80') ? `:${e.PUSHER_PORT}` : '';
      pusherUrl = `${scheme}://${e.PUSHER_HOST}${port}`;
    }
    const opts = {
      url: e.HUBFLY_REALTIME_URL || pusherUrl,
      appId: e.HUBFLY_REALTIME_APP_ID || e.PUSHER_APP_ID,
      key: e.HUBFLY_REALTIME_KEY || e.PUSHER_APP_KEY,
      secret: e.HUBFLY_REALTIME_SECRET || e.PUSHER_APP_SECRET,
      encryptionKeys: e.HUBFLY_REALTIME_E2E_KEYS || undefined,
      ...overrides,
    };
    const missing = (
      [
        ['url', 'HUBFLY_REALTIME_URL'],
        ['appId', 'HUBFLY_REALTIME_APP_ID'],
        ['key', 'HUBFLY_REALTIME_KEY'],
        ['secret', 'HUBFLY_REALTIME_SECRET'],
      ] as const
    )
      .filter(([k]) => !opts[k])
      .map(([, name]) => name);
    if (missing.length) throw new Error(`HubFly Realtime: missing environment variables: ${missing.join(', ')}`);
    return new RealtimeServer(opts as RealtimeServerOptions);
  }

  constructor(options: RealtimeServerOptions) {
    const o = options;
    let url: URL;
    try {
      url = new URL(String(o.url));
    } catch {
      throw new TypeError(`HubFly Realtime: invalid url ${JSON.stringify(o.url)}`);
    }
    const scheme = { 'https:': 'https:', 'wss:': 'https:', 'http:': 'http:', 'ws:': 'http:' }[url.protocol];
    if (!scheme) throw new TypeError(`HubFly Realtime: url must be https:// (got ${url.protocol})`);
    this.url = `${scheme}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
    if (!APP_ID_RE.test(String(o.appId))) throw new TypeError('HubFly Realtime: invalid appId');
    if (!o.key || !o.secret) throw new TypeError('HubFly Realtime: key and secret are required');
    this.appId = String(o.appId);
    this.key = o.key;
    this.secret = o.secret;
    if (o.encryptionKeys && (typeof o.encryptionKeys !== 'string' || o.encryptionKeys.trim())) {
      this.masters = toMasterKeys(o.encryptionKeys);
    }
    this.fullE2E = !!o.fullE2E;
    this.allowPlaintext = !!o.allowPlaintext;
    this.doFetch = o.fetch ?? ((input, init) => fetch(input, init));
    this.webCrypto = o.crypto;
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.retries = o.retries ?? 1;
    this.now = o.now ?? Date.now;
  }

  /** True when encryption keys are configured. */
  get encryption(): boolean {
    return !!this.masters;
  }

  /** What `JSON.stringify` shows: never the secret or the encryption keys. */
  toJSON(): { url: string; appId: string; key: string; secret: string; encryption: boolean } {
    return { url: this.url, appId: this.appId, key: this.key, secret: '[redacted]', encryption: this.encryption };
  }

  /** What `console.log` / `util.inspect` show in Node, Bun and Deno: same as `toJSON`. */
  [Symbol.for('nodejs.util.inspect.custom')](): unknown {
    return Object.assign(Object.create({ constructor: RealtimeServer }), this.toJSON());
  }

  // -------------------------------------------------------------------------------------------
  // Signing

  private async hmac(secret: string, message: string | Uint8Array): Promise<string> {
    const subtle = (this.webCrypto ?? (globalThis as { crypto?: Crypto }).crypto)?.subtle;
    if (!subtle) {
      throw new Error("HubFly Realtime: WebCrypto is not available; on Node 18 pass { crypto: require('node:crypto').webcrypto }");
    }
    let key = this.hmacKeys.get(secret);
    if (!key) {
      key = subtle.importKey('raw', utf8Encode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      this.hmacKeys.set(secret, key);
    }
    const data = typeof message === 'string' ? utf8Encode(message) : message;
    return toHex(new Uint8Array(await subtle.sign('HMAC', await key, data as BufferSource)));
  }

  /**
   * The signed query string of a REST request (Pusher auth version 1.0): `params` plus
   * `auth_key`, `auth_timestamp`, `auth_version`, `body_md5` (non-empty bodies) and
   * `auth_signature = HMAC-SHA256-hex(secret, "<METHOD>\n<path>\n<sorted query>")`.
   * `path` is the full path (`/apps/<id>/…`). Values are URL-encoded in the result.
   */
  async signQuery(
    method: string,
    path: string,
    params: Record<string, string | number | undefined> = {},
    body?: string,
  ): Promise<string> {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q[k.toLowerCase()] = String(v);
    q.auth_key = this.key;
    q.auth_timestamp = String(Math.floor(this.now() / 1000));
    q.auth_version = '1.0';
    if (body) q.body_md5 = toHex(md5(utf8Encode(body)));
    delete q.auth_signature;
    const keys = Object.keys(q).sort();
    const signature = await this.hmac(this.secret, `${method.toUpperCase()}\n${path}\n${keys.map((k) => `${k}=${q[k]}`).join('&')}`);
    return `${keys.map((k) => `${k}=${encodeURIComponent(q[k])}`).join('&')}&auth_signature=${signature}`;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, string | number | undefined>,
    body?: unknown,
    idempotent = false,
  ): Promise<T> {
    const fullPath = `/apps/${this.appId}${path}`;
    const text = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; ; attempt++) {
      const url = `${this.url}${fullPath}?${await this.signQuery(method, fullPath, params, text)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method,
          headers: text === undefined ? undefined : { 'content-type': 'application/json' },
          body: text,
          signal: ctrl.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (idempotent && attempt < this.retries) {
          await sleep(200 * (attempt + 1));
          continue;
        }
        throw err;
      }
      let raw: string;
      try {
        raw = await res.text();
      } finally {
        clearTimeout(timer);
      }
      let data: unknown = raw;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        // keep the raw text
      }
      if (res.ok) return data as T;
      const retryAfter = Number(res.headers.get('retry-after')) || undefined;
      if (idempotent && attempt < this.retries && [502, 503, 504].includes(res.status)) {
        await sleep(Math.min((retryAfter ?? 0.2) * 1000, 2000));
        continue;
      }
      throw new RealtimeApiError(res.status, data, retryAfter);
    }
  }

  /** Signed GET of any `/apps/<id>` sub-path (like the Pusher libraries' generic `get`). */
  get<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('GET', path, params);
  }

  /** Signed POST of any `/apps/<id>` sub-path (like the Pusher libraries' generic `post`). */
  post<T = unknown>(path: string, body: unknown, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>('POST', path, params, body);
  }

  // -------------------------------------------------------------------------------------------
  // E2E

  private requireKeys(what: string): MasterKey[] {
    if (!this.masters) throw new Error(`HubFly Realtime: ${what} needs encryptionKeys (HUBFLY_REALTIME_E2E_KEYS)`);
    return this.masters;
  }

  /** How a publish to `channel` is encrypted: Pusher envelope, v1 envelope or not at all. */
  private channelMode(channel: string, encrypt?: boolean): 'pusher' | 'v1' | null {
    if (channel.startsWith('private-encrypted-')) {
      this.requireKeys(`"${channel}"`);
      if (encrypt === false) throw new Error('HubFly Realtime: private-encrypted channels are always encrypted');
      return 'pusher';
    }
    if (encrypt === false) return null;
    if (encrypt === true) {
      this.requireKeys('encrypt: true');
      return 'v1';
    }
    if (!this.masters) return null;
    if (channel.startsWith(USER_PREFIX)) return 'v1';
    return this.fullE2E && needsAuth(channel) ? 'v1' : null;
  }

  /**
   * True for contexts whose messages are always encrypted with these keys (and whose auth
   * responses carry `hubfly.keys`): `private-encrypted-*`, user messages and, with `fullE2E`,
   * private/presence channels. Clients accept only envelopes there.
   */
  private e2eContext(context: string): boolean {
    return (
      !!this.masters &&
      (context.startsWith('private-encrypted-') || context.startsWith(USER_PREFIX) || (this.fullE2E && needsAuth(context)))
    );
  }

  private sealV1(context: string, key: Uint8Array, kid: string, event: string, data: unknown, messageId: string): string {
    return encryptV1(key, kid, { e: event, d: data, to: context, m: messageId, t: this.now() });
  }

  private encryptFor(context: string, mode: 'pusher' | 'v1', event: string, data: unknown, messageId: string) {
    const active = this.requireKeys('encryption')[0];
    const key = deriveKey(context, active.key);
    return mode === 'pusher'
      ? { event, data: encryptPusher(key, data) }
      : { event: E2E_EVENT, data: this.sealV1(context, key, active.kid, event, data, messageId) };
  }

  /**
   * Decrypts an event of `context` (channel or `#server-to-user-<id>`): v1 envelopes
   * (`hubfly.e2e` / `client-hubfly.e2e`, any configured kid) and Pusher envelopes on
   * `private-encrypted-*`. Other events are returned unchanged (`encrypted: false`), except in
   * E2E contexts (`private-encrypted-*`, `#server-to-user-<id>`, and private/presence channels
   * with `fullE2E`), where a non-envelope event throws `E2EError('plaintext')` unless
   * `allowPlaintext` is set. Useful for `client_event` webhooks and history.
   */
  decrypt(context: string, event: string, data: unknown): { event: string; data: unknown; encrypted: boolean } {
    const masters = this.requireKeys('decrypt');
    if (event === E2E_EVENT || event === CLIENT_E2E_EVENT) {
      const msg = decryptV1((kid) => {
        const m = masters.find((k) => k.kid === kid);
        return m && deriveKey(context, m.key);
      }, data);
      if (msg.to !== context) throw new E2EError('wrong_context');
      if ((event === CLIENT_E2E_EVENT) !== msg.e.startsWith('client-')) throw new E2EError('bad_event');
      return { event: msg.e, data: msg.d, encrypted: true };
    }
    if (context.startsWith('private-encrypted-')) {
      if (!isEnvelope(data)) throw new E2EError('plaintext');
      return { event, data: decryptPusher(masters.map((m) => deriveKey(context, m.key)), data), encrypted: true };
    }
    if (this.e2eContext(context) && !this.allowPlaintext) throw new E2EError('plaintext');
    return { event, data, encrypted: false };
  }

  // -------------------------------------------------------------------------------------------
  // Authorization

  /**
   * Signs a channel subscription (pusher-js compatible). Presence channels need `presenceData`.
   * With encryption keys: `shared_secret` and `hubfly.keys` for `private-encrypted-*`; with
   * `fullE2E` also `hubfly.keys` for other private/presence channels and sealed presence
   * `user_info` (clients then accept only envelopes on them).
   */
  async authorizeChannel(socketId: string, channel: string, presenceData?: PresenceData): Promise<ChannelAuthResponse> {
    if (!isSocketId(socketId)) throw new TypeError(`HubFly Realtime: invalid socket id ${quoteId(socketId)}`);
    checkChannel(channel);
    let toSign = `${socketId}:${channel}`;
    const out: ChannelAuthResponse = { auth: '' };
    if (channel.startsWith('presence-')) {
      if (!presenceData || presenceData.user_id === undefined || presenceData.user_id === null || presenceData.user_id === '') {
        throw new TypeError('HubFly Realtime: presence channels need presenceData.user_id');
      }
      let pd = presenceData;
      if (this.fullE2E && this.masters && pd.user_info !== undefined) {
        const active = this.masters[0];
        const sealed = this.sealV1(channel, deriveKey(channel, active.key), active.kid, USER_INFO_EVENT, pd.user_info, String(pd.user_id));
        pd = { ...pd, user_info: JSON.parse(sealed) };
      }
      out.channel_data = JSON.stringify(pd);
      toSign += `:${out.channel_data}`;
    }
    out.auth = `${this.key}:${await this.hmac(this.secret, toSign)}`;
    if (channel.startsWith('private-encrypted-')) {
      out.shared_secret = toBase64(deriveKey(channel, this.requireKeys(`"${channel}"`)[0].key));
    }
    if (this.e2eContext(channel)) out.hubfly = { keys: deriveWireKeys(channel, this.masters!) };
    return out;
  }

  /**
   * Signs a user sign-in (`pusher:signin`); adds the user-message keys when keys are configured.
   * With `fullE2E` sign-in `user_info` is sealed with `K(#server-to-user-<id>)`.
   */
  async authenticateUser(socketId: string, user: UserData): Promise<UserAuthResponse> {
    if (!isSocketId(socketId)) throw new TypeError(`HubFly Realtime: invalid socket id ${quoteId(socketId)}`);
    if (!user || typeof user !== 'object') throw new TypeError('HubFly Realtime: user data is required');
    checkUserId(user.id);
    let u = user;
    if (this.fullE2E && this.masters && u.user_info !== undefined) {
      const context = USER_PREFIX + u.id;
      const active = this.masters[0];
      const sealed = this.sealV1(context, deriveKey(context, active.key), active.kid, SIGNIN_USER_INFO_EVENT, u.user_info, String(u.id));
      u = { ...u, user_info: JSON.parse(sealed) };
    }
    const userData = JSON.stringify(u);
    const out: UserAuthResponse = {
      auth: `${this.key}:${await this.hmac(this.secret, `${socketId}::user::${userData}`)}`,
      user_data: userData,
    };
    if (this.masters) out.hubfly = { keys: deriveWireKeys(USER_PREFIX + user.id, this.masters) };
    return out;
  }

  /**
   * A Fetch-API handler (`(Request) => Promise<Response>`) for the client's `authEndpoint` and
   * `userAuthEndpoint`: form-encoded (pusher-js) or JSON bodies with `socket_id` and, for
   * channel auth, `channel_name`. Next.js: `export const POST = realtime.authHandler({ getUser })`.
   */
  authHandler(options: AuthHandlerOptions): (request: Request) => Promise<Response> {
    return async (request) => {
      let params: Record<string, unknown>;
      try {
        if (request.method === 'GET') params = Object.fromEntries(new URL(request.url).searchParams);
        else {
          const text = await request.text();
          params = (request.headers.get('content-type') || '').includes('json')
            ? (JSON.parse(text || '{}') as Record<string, unknown>)
            : Object.fromEntries(new URLSearchParams(text));
          if (!params || typeof params !== 'object') throw new Error('bad body');
        }
      } catch {
        return jsonResponse(400, { error: 'Malformed request body' });
      }
      const socketId = params.socket_id;
      const channel = params.channel_name;
      if (!isSocketId(socketId)) return jsonResponse(400, { error: 'Invalid socket_id' });
      const user = (await options.getUser(request)) ?? null;
      try {
        if (channel === undefined || channel === '') {
          if (!user) return jsonResponse(403, { error: 'Not signed in' });
          const data: UserData = { id: user.id };
          if (user.info !== undefined) data.user_info = user.info;
          return jsonResponse(200, await this.authenticateUser(socketId, data));
        }
        if (!isChannel(channel) || !needsAuth(channel)) return jsonResponse(400, { error: 'Invalid channel_name' });
        if (channel.startsWith('private-encrypted-') && !this.masters) {
          return jsonResponse(403, { error: 'Encrypted channels are not configured on this server' });
        }
        const allowed = options.canAccess ? await options.canAccess(user, channel, request) : !!user;
        if (!allowed) return jsonResponse(403, { error: 'Forbidden' });
        let presence: PresenceData | undefined;
        if (channel.startsWith('presence-')) {
          if (!user) return jsonResponse(403, { error: 'Not signed in' });
          presence = { user_id: user.id };
          if (user.info !== undefined) presence.user_info = user.info;
        }
        return jsonResponse(200, await this.authorizeChannel(socketId, channel, presence));
      } catch (err) {
        // Invalid user data from getUser: a server-side problem; the details stay on the server.
        if (err instanceof TypeError) return jsonResponse(500, { error: 'Authorization failed' });
        throw err;
      }
    };
  }

  // -------------------------------------------------------------------------------------------
  // Webhooks

  /**
   * Verifies a webhook request and returns its payload. Requires `X-HubFly-Signature`
   * (`t=<unix>,v1=<hex>` over `"<t>.<body>"`, `t` within the tolerance) and also checks
   * `X-Pusher-Signature` (hex HMAC of the body) when present. Constant-time comparisons.
   * Throws `WebhookError`. Receivers should dedupe on `X-HubFly-Delivery-Id`.
   */
  async verifyWebhook(input: Request | WebhookInput, options: VerifyWebhookOptions = {}): Promise<WebhookPayload> {
    let headers: WebhookInput['headers'];
    let body: Uint8Array;
    if (typeof (input as Request).arrayBuffer === 'function' && (input as Request).headers) {
      headers = (input as Request).headers;
      body = new Uint8Array(await (input as Request).arrayBuffer());
    } else {
      const i = input as WebhookInput;
      headers = i.headers;
      body = typeof i.body === 'string' ? utf8Encode(i.body) : i.body instanceof Uint8Array ? i.body : new Uint8Array(i.body);
    }
    let secret = this.secret;
    const key = headerOf(headers, 'x-pusher-key');
    if (key && key !== this.key) {
      const extra = options.extraKeys?.find((k) => k.key === key);
      if (!extra) throw new WebhookError('unknown_key');
      secret = extra.secret;
    }
    const hubfly = headerOf(headers, 'x-hubfly-signature');
    const pusher = headerOf(headers, 'x-pusher-signature');
    if (!hubfly) {
      if (!pusher) throw new WebhookError('missing_signature');
      if (!options.allowPusherSignature) throw new WebhookError('missing_hubfly_signature');
    } else {
      let t = '';
      const v1: string[] = [];
      for (const part of hubfly.split(',')) {
        const i = part.indexOf('=');
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k === 't') t = v;
        else if (k === 'v1') v1.push(v.toLowerCase());
      }
      const ts = Number(t);
      const age = this.now() / 1000 - ts;
      // Old signatures are replays; ones more than a small clock skew in the future are forged
      // ahead of time (they would stay valid long after capture).
      if (!/^\d+$/.test(t) || age > (options.toleranceSeconds ?? 300) || age < -WEBHOOK_FUTURE_SKEW_S) {
        throw new WebhookError('timestamp_out_of_tolerance');
      }
      const prefix = utf8Encode(`${t}.`);
      const signed = new Uint8Array(prefix.length + body.length);
      signed.set(prefix);
      signed.set(body, prefix.length);
      const expected = await this.hmac(secret, signed);
      if (!v1.some((v) => safeEqual(v, expected))) throw new WebhookError('bad_signature');
    }
    if (pusher && !safeEqual(pusher.trim().toLowerCase(), await this.hmac(secret, body))) {
      throw new WebhookError('bad_signature');
    }
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new WebhookError('bad_body');
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) throw new WebhookError('bad_body');
    return payload;
  }

  // -------------------------------------------------------------------------------------------
  // Pusher REST endpoints

  /**
   * `POST /apps/<id>/events`. `data` strings are sent as-is, other values JSON-encoded.
   * Encrypted channels get a Pusher envelope, user/full-E2E channels a v1 envelope; a trigger
   * to several channels that need different keys is sent as a batch (one event per channel).
   */
  async trigger(channels: string | string[], event: string, data: unknown, options: TriggerOptions = {}): Promise<TriggerResult> {
    const list = toList(channels);
    if (!list.length || list.length > 100) throw new TypeError('HubFly Realtime: trigger needs 1-100 channels');
    list.forEach((c) => checkChannel(c));
    checkEvent(event);
    const modes = list.map((c) => this.channelMode(c, options.encrypt));
    if (list.length > 1 && modes.some(Boolean)) {
      const res = await this.triggerBatch(list.map((channel) => ({ channel, name: event, data, ...options })));
      if (!res.batch) return {};
      return { channels: Object.fromEntries(list.map((c, i) => [c, res.batch![i] ?? {}])) };
    }
    const body: Record<string, unknown> = { name: event, channels: list, data: encodeData(data) };
    if (modes[0]) Object.assign(body, this.encryptedFields(list[0], modes[0], event, data, 'name'));
    if (options.socketId) body.socket_id = parseConnectionId(options.socketId).socketId;
    if (options.info) body.info = joinInfo(options.info);
    return this.request<TriggerResult>('POST', '/events', undefined, body);
  }

  private encryptedFields(channel: string, mode: 'pusher' | 'v1', event: string, data: unknown, nameField: 'name' | 'event') {
    const enc = this.encryptFor(channel, mode, event, data, newMessageId(this.now()));
    return { [nameField]: enc.event, data: enc.data };
  }

  /** `POST /apps/<id>/batch_events` (≤ 100 events), encrypting per event like `trigger`. */
  async triggerBatch(batch: BatchEvent[]): Promise<TriggerResult> {
    if (!batch.length || batch.length > 100) throw new TypeError('HubFly Realtime: triggerBatch needs 1-100 events');
    const items = batch.map((e) => {
      checkChannel(e.channel);
      checkEvent(e.name);
      const mode = this.channelMode(e.channel, e.encrypt);
      const item: Record<string, unknown> = { channel: e.channel, name: e.name, data: encodeData(e.data) };
      if (mode) Object.assign(item, this.encryptedFields(e.channel, mode, e.name, e.data, 'name'));
      if (e.socketId) item.socket_id = parseConnectionId(e.socketId).socketId;
      if (e.info) item.info = joinInfo(e.info);
      return item;
    });
    return this.request<TriggerResult>('POST', '/batch_events', undefined, { batch: items });
  }

  /** `GET /apps/<id>/channels` (occupied channels). */
  channels(options: { prefix?: string; info?: string | string[] } = {}): Promise<{ channels: Record<string, { user_count?: number; subscription_count?: number }> }> {
    return this.request('GET', '/channels', { filter_by_prefix: options.prefix, info: joinInfo(options.info) });
  }

  /** `GET /apps/<id>/channels/<name>`. */
  channelInfo(channel: string, options: { info?: string | string[] } = {}): Promise<{ occupied: boolean; subscription_count?: number; user_count?: number }> {
    checkChannel(channel, true);
    return this.request('GET', `/channels/${channel}`, { info: joinInfo(options.info) });
  }

  /** `GET /apps/<id>/channels/<presence channel>/users`. */
  channelUsers(channel: string): Promise<{ users: Array<{ id: string }> }> {
    checkChannel(channel, true);
    return this.request('GET', `/channels/${channel}/users`);
  }

  /** `POST /apps/<id>/users/<user_id>/terminate_connections` (closes them with 4009). */
  async terminateUserConnections(userId: string): Promise<void> {
    checkUserId(userId);
    await this.request('POST', `/users/${userId}/terminate_connections`, undefined, {});
  }

  // -------------------------------------------------------------------------------------------
  // HubFly endpoints

  /**
   * `POST …/hubfly/v1/publish`: publishes with `message_id` idempotency and returns the channel
   * positions. Encrypted channels are published one request per channel (ids `<id>.<n>`).
   */
  async publish(channels: string | string[], event: string, data: unknown, options: PublishOptions = {}): Promise<PublishResult> {
    const list = [...new Set(toList(channels))];
    if (!list.length || list.length > 100) throw new TypeError('HubFly Realtime: publish needs 1-100 channels');
    list.forEach((c) => checkChannel(c));
    checkEvent(event);
    const base = options.messageId ?? newMessageId(this.now());
    checkMessageId(base);
    const modes = list.map((c) => this.channelMode(c, options.encrypt));
    const groups = modes.some(Boolean) ? list.map((c) => [c]) : [list];
    const socketId = options.socketId ? parseConnectionId(options.socketId).socketId : undefined;
    const ids: Record<string, string> = {};
    const results = await mapLimit(groups, 8, (chs, i) => {
      const messageId = splitId(base, i, groups.length);
      const mode = modes[list.indexOf(chs[0])];
      const body: Record<string, unknown> = { channels: chs, event, data, message_id: messageId };
      if (mode) Object.assign(body, this.encryptFor(chs[0], mode, event, data, messageId));
      if (socketId) body.socket_id = socketId;
      for (const c of chs) ids[c] = messageId;
      return this.request<PublishResult>('POST', '/hubfly/v1/publish', undefined, body, true);
    });
    const out: PublishResult = { message_id: base, channels: Object.assign({}, ...results.map((r) => r.channels ?? {})) };
    if (groups.length > 1) out.message_ids = ids;
    return out;
  }

  /**
   * `POST …/hubfly/v1/send` to connection ids (socket ids or E2E connection ids
   * `<socket_id>~<k>`). E2E ids are encrypted with their own key (v1 envelope, kid `c`), one
   * request per E2E target; plaintext targets go 100 per request. Message ids of split requests
   * are `<messageId>.<n>`.
   */
  async send(ids: string | string[], event: string, data: unknown, options: SendOptions = {}): Promise<SendResult> {
    const targets = [...new Set(toList(ids))].map((id) => ({ id, ...parseConnectionId(id) }));
    if (!targets.length) throw new TypeError('HubFly Realtime: send needs at least one connection id');
    checkEvent(event);
    if (options.encrypt === true && targets.some((t) => !t.key)) {
      throw new TypeError('HubFly Realtime: encrypt: true needs E2E connection ids (<socket_id>~<key>)');
    }
    const encrypt = options.encrypt !== false;
    const plain = targets.filter((t) => !(encrypt && t.key));
    const requests: Array<typeof targets> = [];
    for (let i = 0; i < plain.length; i += 100) requests.push(plain.slice(i, i + 100));
    for (const t of targets) if (encrypt && t.key) requests.push([t]);
    return this.dispatch(requests, options, (group, messageId) => {
      const body: Record<string, unknown> = { socket_ids: group.map((t) => t.socketId), event, data, message_id: messageId };
      const key = encrypt ? group[0].key : undefined;
      if (key) {
        body.event = E2E_EVENT;
        body.data = this.sealV1(`#direct-${group[0].socketId}`, key, 'c', event, data, messageId);
      }
      return body;
    }, (group, r) => group.find((t) => t.socketId === r.socket_id)?.id ?? r.socket_id ?? '');
  }

  /**
   * `POST …/hubfly/v1/send` to users (every connection of each user). With encryption keys each
   * user gets a v1 envelope under `K(#server-to-user-<id>)` (one request per user).
   */
  async sendToUsers(userIds: string | string[], event: string, data: unknown, options: SendOptions = {}): Promise<SendResult> {
    const users = [...new Set(toList(userIds))];
    if (!users.length) throw new TypeError('HubFly Realtime: sendToUsers needs at least one user id');
    users.forEach(checkUserId);
    checkEvent(event);
    const encrypt = options.encrypt === true || (options.encrypt !== false && !!this.masters);
    const active = encrypt ? this.requireKeys('encrypt: true')[0] : undefined;
    const requests: string[][] = [];
    if (active) for (const u of users) requests.push([u]);
    else for (let i = 0; i < users.length; i += 100) requests.push(users.slice(i, i + 100));
    return this.dispatch(requests, options, (group, messageId) => {
      const body: Record<string, unknown> = { user_ids: group, event, data, message_id: messageId };
      if (active) {
        const ctx = USER_PREFIX + group[0];
        body.event = E2E_EVENT;
        body.data = this.sealV1(ctx, deriveKey(ctx, active.key), active.kid, event, data, messageId);
      }
      return body;
    }, (_group, r) => r.user_id ?? '');
  }

  private async dispatch<G extends unknown[]>(
    requests: G[],
    options: SendOptions,
    build: (group: G, messageId: string) => Record<string, unknown>,
    idOf: (group: G, r: { socket_id?: string; user_id?: string }) => string,
  ): Promise<SendResult> {
    const base = options.messageId ?? newMessageId(this.now());
    checkMessageId(base);
    const results = await mapLimit(requests, 8, async (group, i) => {
      const messageId = splitId(base, i, requests.length);
      const body = build(group, messageId);
      if (options.ack) body.ack = true;
      const res = await this.request<{ results?: Array<Omit<SendTargetResult, 'id' | 'message_id'>> }>(
        'POST',
        '/hubfly/v1/send',
        undefined,
        body,
        true,
      );
      return (res.results ?? []).map((r) => ({ ...r, id: idOf(group, r), message_id: messageId }));
    });
    return { message_id: base, results: results.flat() };
  }

  /** Helpers for one user: `send`, `status`, `terminate` (all their connections). */
  toUser(userId: string) {
    checkUserId(userId);
    return {
      send: (event: string, data: unknown, options?: SendOptions) => this.sendToUsers([userId], event, data, options),
      status: () => this.userStatus(userId),
      isOnline: async () => (await this.userStatus(userId)).online,
      terminate: () => this.terminateUserConnections(userId),
    };
  }

  /** Helpers for one connection id: `send`, `status`, `isOnline`, `terminate`. */
  connection(id: string) {
    parseConnectionId(id);
    return {
      send: (event: string, data: unknown, options?: SendOptions) => this.send(id, event, data, options),
      status: () => this.connectionStatus(id),
      isOnline: () => this.isOnline(id),
      terminate: (options?: TerminateOptions) => this.terminate(id, options),
    };
  }

  /** Helpers for one channel: `publish` (HubFly), `trigger` (Pusher), `history`, `info`, `users`. */
  channel(name: string) {
    checkChannel(name);
    return {
      name,
      publish: (event: string, data: unknown, options?: PublishOptions) => this.publish(name, event, data, options),
      trigger: (event: string, data: unknown, options?: TriggerOptions) => this.trigger(name, event, data, options),
      history: (options?: HistoryOptions) => this.history(name, options),
      info: (options?: { info?: string | string[] }) => this.channelInfo(name, options),
      users: () => this.channelUsers(name),
    };
  }

  /** `GET …/hubfly/v1/connections/<socket_id>`; unknown connections are `{online: false}`. */
  async connectionStatus(id: string): Promise<ConnectionStatus> {
    const { socketId } = parseConnectionId(id);
    try {
      return await this.request<ConnectionStatus>('GET', `/hubfly/v1/connections/${socketId}`);
    } catch (err) {
      if (err instanceof RealtimeApiError && err.status === 404) return { socket_id: socketId, online: false };
      throw err;
    }
  }

  async isOnline(id: string): Promise<boolean> {
    return (await this.connectionStatus(id)).online === true;
  }

  /** `GET …/hubfly/v1/users/<user_id>`. */
  async userStatus(userId: string): Promise<UserStatus> {
    checkUserId(userId);
    try {
      return await this.request<UserStatus>('GET', `/hubfly/v1/users/${userId}`);
    } catch (err) {
      if (err instanceof RealtimeApiError && err.status === 404) return { user_id: userId, online: false, connections: 0, socket_ids: [] };
      throw err;
    }
  }

  /**
   * `POST …/hubfly/v1/connections/<socket_id>/terminate`: `mode: 'terminate'` (default, close
   * 4009, the client stops) or `'disconnect'` (close 4200, the client reconnects at once).
   */
  async terminate(id: string, options: TerminateOptions = {}): Promise<{ terminated: boolean }> {
    const { socketId } = parseConnectionId(id);
    const mode = options.mode ?? 'terminate';
    if (mode !== 'terminate' && mode !== 'disconnect') throw new TypeError('HubFly Realtime: mode must be terminate or disconnect');
    return this.request('POST', `/hubfly/v1/connections/${socketId}/terminate`, undefined, { mode });
  }

  /**
   * `GET …/hubfly/v1/history/<channel>`. `data` is decoded the way client handlers receive it:
   * JSON text parsed, E2E envelopes opened when keys are configured (`encrypted: true`, or
   * `e2e_error` with the envelope left as stored). `raw: true` returns everything as stored.
   */
  async history(channel: string, options: HistoryOptions = {}): Promise<HistoryResult> {
    checkChannel(channel, true);
    const res = await this.request<HistoryResult>('GET', `/hubfly/v1/history/${channel}`, {
      since: options.since,
      epoch: options.epoch,
      limit: options.limit,
    });
    if (options.raw || !Array.isArray(res.messages)) return res;
    for (const m of res.messages) {
      const encrypted = m.event === E2E_EVENT || m.event === CLIENT_E2E_EVENT || this.e2eContext(channel) || channel.startsWith('private-encrypted-');
      if (!encrypted) {
        m.data = decodeData(m.data);
      } else if (this.masters) {
        try {
          const d = this.decrypt(channel, m.event, m.data);
          m.event = d.event;
          m.data = d.encrypted ? d.data : decodeData(d.data);
          if (d.encrypted) m.encrypted = true;
        } catch (err) {
          m.e2e_error = err instanceof E2EError ? err.reason : 'decrypt_failed';
        }
      }
    }
    return res;
  }

  /** `GET …/hubfly/v1/messages/<message_id>`: per-target delivery receipt (null when unknown). */
  async messageReceipt(messageId: string): Promise<MessageReceipt | null> {
    checkMessageId(messageId);
    try {
      return await this.request<MessageReceipt>('GET', `/hubfly/v1/messages/${messageId}`);
    } catch (err) {
      if (err instanceof RealtimeApiError && err.status === 404) return null;
      throw err;
    }
  }
}

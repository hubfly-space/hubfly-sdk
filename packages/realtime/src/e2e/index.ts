/**
 * `@hubfly/realtime/e2e`: end-to-end encryption helpers (docs/E2E.md in hubfly-realtime).
 *
 * - Key derivation: `K(name, kid) = SHA-256(UTF-8(name) || master[kid])` (Pusher's construction).
 * - Pusher envelope `{"nonce","ciphertext"}` for `private-encrypted-*` channels.
 * - HubFly v1 envelope `{"v":1,"kid","nonce","ciphertext"}` whose plaintext is
 *   `{"e","d","to","m","t"}`, for direct/user messages, client events on encrypted channels,
 *   full-E2E channels and sealed presence `user_info`.
 * - Connection ids `<socket_id>~<base64url(k)>`.
 *
 * Encryption is NaCl secretbox (XSalsa20-Poly1305) from `@noble/ciphers`; SHA-256 from
 * `@noble/hashes`. Everything here is synchronous and runs in browsers, React Native, Workers,
 * Bun, Deno and Node.
 */
import { xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils.js';
import {
  E2EError,
  decodeKeyMaterial,
  fromBase64,
  fromBase64Url,
  newMessageId as newId,
  quoteId,
  toBase64,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from './codec';

export { E2EError, fromBase64, fromBase64Url, toBase64, toBase64Url } from './codec';
export type { E2EReason } from './codec';

/** Outer event name of v1 envelopes published by servers. */
export const E2E_EVENT = 'hubfly.e2e';
/** Outer event name of v1 envelopes sent as client events. */
export const CLIENT_E2E_EVENT = 'client-hubfly.e2e';
/** Inner event name of sealed presence `user_info`. */
export const USER_INFO_EVENT = 'presence.user_info';
/** Inner event name of sealed sign-in `user_info` (context `#server-to-user-<id>`). */
export const SIGNIN_USER_INFO_EVENT = 'signin.user_info';
/** Default receiver window: the longest history window (24 h). */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SOCKET_ID_RE = /^\d+\.\d+$/;

/** Cryptographically secure random bytes. */
export function randomBytes(n: number): Uint8Array {
  return nobleRandomBytes(n);
}

/** A new message id (`m_` + 26 Crockford base32 characters, time-ordered). */
export function newMessageId(now: number = Date.now()): string {
  return newId(randomBytes, now);
}

// ---------------------------------------------------------------------------------------------
// Keys

/** A customer master key. `kid` is 1–32 characters from `[A-Za-z0-9_-]`, never `c`. */
export interface MasterKey {
  kid: string;
  key: Uint8Array;
}

/** A derived key as it travels in auth responses (`hubfly.keys`). */
export interface WireKey {
  kid: string;
  /** Standard base64 of the 32-byte derived key. */
  key: string;
}

/**
 * Parses `HUBFLY_REALTIME_E2E_KEYS`: comma-separated `kid:base64` entries, the first is active
 * (encrypts), the rest only decrypt. A bare base64 value means kid `k1`. Keys must be 32 bytes.
 */
export function parseKeyList(value: string): MasterKey[] {
  const out: MasterKey[] = [];
  for (const raw of String(value).split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const i = part.indexOf(':');
    const kid = i < 0 ? 'k1' : part.slice(0, i).trim();
    const material = i < 0 ? part : part.slice(i + 1);
    if (!KID_RE.test(kid) || kid === 'c') {
      throw new Error(`HubFly Realtime: invalid encryption key id "${kid}" (1-32 characters from [A-Za-z0-9_-], not "c")`);
    }
    if (out.some((k) => k.kid === kid)) throw new Error(`HubFly Realtime: duplicate encryption key id "${kid}"`);
    let key: Uint8Array;
    try {
      key = decodeKeyMaterial(material);
    } catch {
      throw new Error(`HubFly Realtime: encryption key "${kid}" is not valid base64`);
    }
    if (key.length !== 32) {
      throw new Error(`HubFly Realtime: encryption key "${kid}" must be 32 bytes (got ${key.length})`);
    }
    out.push({ kid, key });
  }
  if (!out.length) throw new Error('HubFly Realtime: no encryption keys given');
  return out;
}

/** Normalizes the accepted key inputs (env string, parsed list, or `{kid, key: base64}` list). */
export function toMasterKeys(input: string | ReadonlyArray<MasterKey | WireKey>): MasterKey[] {
  if (typeof input === 'string') return parseKeyList(input);
  const out: MasterKey[] = [];
  for (const k of input) {
    const key = typeof k.key === 'string' ? decodeKeyMaterial(k.key) : k.key;
    if (!KID_RE.test(k.kid) || k.kid === 'c' || key.length !== 32 || out.some((o) => o.kid === k.kid)) {
      throw new Error(`HubFly Realtime: invalid encryption key "${k.kid}"`);
    }
    out.push({ kid: k.kid, key });
  }
  if (!out.length) throw new Error('HubFly Realtime: no encryption keys given');
  return out;
}

/** `K(name, master) = SHA-256(UTF-8(name) || master)`. */
export function deriveKey(name: string, master: Uint8Array): Uint8Array {
  const n = utf8Encode(name);
  const buf = new Uint8Array(n.length + master.length);
  buf.set(n);
  buf.set(master, n.length);
  return sha256(buf);
}

/** Derived keys for `name`, active first, in the wire format of `hubfly.keys`. */
export function deriveWireKeys(name: string, masters: ReadonlyArray<MasterKey>): WireKey[] {
  return masters.map((m) => ({ kid: m.kid, key: toBase64(deriveKey(name, m.key)) }));
}

// ---------------------------------------------------------------------------------------------
// Envelopes

/** A parsed, shape-checked envelope. */
export type Envelope =
  | { v: 1; kid: string; nonce: Uint8Array; ciphertext: Uint8Array }
  | { v: 0; nonce: Uint8Array; ciphertext: Uint8Array };

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Parses and shape-checks an envelope (a JSON string or an already-parsed object) exactly like
 * the engine: valid JSON object, exactly the documented members, `v` = 1 and a valid `kid` for
 * v1, `nonce` decoding to 24 bytes, `ciphertext` to at least 16. Throws `E2EError(reason)`.
 */
export function parseEnvelope(input: unknown): Envelope {
  let o: unknown = input;
  if (typeof input === 'string') {
    try {
      o = JSON.parse(input);
    } catch {
      throw new E2EError('not_json');
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new E2EError('not_object');
  const obj = o as Record<string, unknown>;
  const v1 = own(obj, 'v');
  const members = v1 ? ['v', 'kid', 'nonce', 'ciphertext'] : ['nonce', 'ciphertext'];
  for (const m of members) if (!own(obj, m)) throw new E2EError('missing_members');
  for (const k of Object.keys(obj)) if (!members.includes(k)) throw new E2EError('unknown_member');
  if (v1) {
    if (obj.v !== 1) throw new E2EError('bad_version');
    if (typeof obj.kid !== 'string' || !KID_RE.test(obj.kid)) throw new E2EError('bad_kid');
  }
  if (typeof obj.nonce !== 'string') throw new E2EError('bad_nonce');
  const nonce = fromBase64(obj.nonce);
  if (nonce.length !== 24) throw new E2EError('bad_nonce');
  if (typeof obj.ciphertext !== 'string') throw new E2EError('bad_ciphertext');
  const ciphertext = fromBase64(obj.ciphertext);
  if (ciphertext.length < 16) throw new E2EError('short_ciphertext');
  return v1 ? { v: 1, kid: obj.kid as string, nonce, ciphertext } : { v: 0, nonce, ciphertext };
}

/** Non-throwing shape check: `{ok: true, kind}` or `{ok: false, reason}`. */
export function checkEnvelope(
  input: unknown,
): { ok: true; kind: 'pusher' | 'v1'; kid?: string } | { ok: false; reason: string } {
  try {
    const e = parseEnvelope(input);
    return e.v === 1 ? { ok: true, kind: 'v1', kid: e.kid } : { ok: true, kind: 'pusher' };
  } catch (err) {
    return { ok: false, reason: err instanceof E2EError ? err.reason : 'not_json' };
  }
}

function seal(key: Uint8Array, nonce: Uint8Array, plaintext: string): Uint8Array {
  if (key.length !== 32) throw new Error('HubFly Realtime: E2E keys are 32 bytes');
  if (nonce.length !== 24) throw new Error('HubFly Realtime: nonces are 24 bytes');
  return xsalsa20poly1305(key, nonce).encrypt(utf8Encode(plaintext));
}

function unseal(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array | null {
  try {
    return xsalsa20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    return null;
  }
}

const json = (data: unknown) => JSON.stringify(data === undefined ? null : data);

/**
 * Pusher envelope: returns the event `data` string `{"nonce","ciphertext"}` whose plaintext is
 * `JSON.stringify(data)` (what pusher-http-node sends and pusher-js `with-encryption` reads).
 */
export function encryptPusher(key: Uint8Array, data: unknown, nonce: Uint8Array = randomBytes(24)): string {
  return JSON.stringify({ nonce: toBase64(nonce), ciphertext: toBase64(seal(key, nonce, json(data))) });
}

/**
 * Decrypts a Pusher envelope with the first key that opens it; returns the parsed data (or the
 * raw plaintext string when it is not JSON, like pusher-js).
 */
export function decryptPusher(keys: Uint8Array | ReadonlyArray<Uint8Array>, envelope: unknown): unknown {
  return openPusher(keys instanceof Uint8Array ? [keys] : keys, parseEnvelope(envelope));
}

function openPusher(keys: ReadonlyArray<Uint8Array>, env: Envelope): unknown {
  if (env.v !== 0) throw new E2EError('wrong_envelope');
  for (const key of keys) {
    const pt = unseal(key, env.nonce, env.ciphertext);
    if (pt) {
      const text = utf8Decode(pt);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  throw new E2EError('decrypt_failed');
}

/** The plaintext of a v1 envelope. */
export interface V1Message {
  /** The real event name. */
  e: string;
  /** The application data. */
  d: unknown;
  /** The context: channel name, `#server-to-user-<id>` or `#direct-<socket_id>`. */
  to: string;
  /** The message id. */
  m: string;
  /** Sender time, Unix milliseconds. */
  t: number;
}

/** v1 envelope: returns the JSON string `{"v":1,"kid","nonce","ciphertext"}`. */
export function encryptV1(
  key: Uint8Array,
  kid: string,
  message: V1Message,
  nonce: Uint8Array = randomBytes(24),
): string {
  if (!KID_RE.test(kid)) throw new Error(`HubFly Realtime: invalid key id "${kid}"`);
  const plaintext = JSON.stringify({
    e: message.e,
    d: message.d === undefined ? null : message.d,
    to: message.to,
    m: message.m,
    t: message.t,
  });
  return JSON.stringify({ v: 1, kid, nonce: toBase64(nonce), ciphertext: toBase64(seal(key, nonce, plaintext)) });
}

/** Opens a parsed v1 envelope with `key` and validates the plaintext's members. */
export function openV1(key: Uint8Array, env: Envelope): V1Message {
  if (env.v !== 1) throw new E2EError('wrong_envelope');
  const pt = unseal(key, env.nonce, env.ciphertext);
  if (!pt) throw new E2EError('decrypt_failed');
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(utf8Decode(pt));
  } catch {
    throw new E2EError('bad_plaintext');
  }
  if (
    !msg ||
    typeof msg !== 'object' ||
    typeof msg.e !== 'string' ||
    typeof msg.to !== 'string' ||
    typeof msg.m !== 'string' ||
    typeof msg.t !== 'number' ||
    !Number.isFinite(msg.t)
  ) {
    throw new E2EError('bad_plaintext');
  }
  return { e: msg.e, d: msg.d === undefined ? null : msg.d, to: msg.to, m: msg.m, t: msg.t };
}

/**
 * Decrypts a v1 envelope. `keys` maps kid to key (a function, a map, or a single key used for
 * any kid). Does not run receiver checks; use `Receiver` (or `createClientE2E`) for those.
 */
export function decryptV1(
  keys: Uint8Array | Map<string, Uint8Array> | ((kid: string) => Uint8Array | undefined),
  envelope: unknown,
): V1Message & { kid: string } {
  const env = parseEnvelope(envelope);
  if (env.v !== 1) throw new E2EError('wrong_envelope');
  const key = keys instanceof Uint8Array ? keys : typeof keys === 'function' ? keys(env.kid) : keys.get(env.kid);
  if (!key) throw new E2EError('unknown_kid');
  return { ...openV1(key, env), kid: env.kid };
}

/**
 * Receiver checks for v1 messages (E2E.md): `to` must equal the arrival context, `m` must not
 * repeat (last 1,000 ids per context) and `t` must not be older than `maxAgeMs`.
 */
export class Receiver {
  private readonly seen = new Map<string, Set<string>>();
  constructor(
    private readonly maxAgeMs: number = DEFAULT_MAX_AGE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  check(context: string, msg: V1Message): void {
    if (msg.to !== context) throw new E2EError('wrong_context');
    if (this.now() - msg.t > this.maxAgeMs) throw new E2EError('expired');
    let ids = this.seen.get(context);
    if (!ids) this.seen.set(context, (ids = new Set()));
    if (ids.has(msg.m)) throw new E2EError('replayed');
    ids.add(msg.m);
    if (ids.size > 1000) ids.delete(ids.values().next().value as string);
  }
}

// ---------------------------------------------------------------------------------------------
// Connection ids

/** True for Pusher-style socket ids (`<digits>.<digits>`). */
export function isSocketId(s: unknown): s is string {
  return typeof s === 'string' && SOCKET_ID_RE.test(s);
}

/** `<socket_id>~<base64url(k)>` (no padding). */
export function formatConnectionId(socketId: string, key: Uint8Array): string {
  if (!isSocketId(socketId)) throw new Error(`HubFly Realtime: invalid socket id ${quoteId(socketId)}`);
  if (key.length !== 32) throw new Error('HubFly Realtime: connection keys are 32 bytes');
  return socketId + '~' + toBase64Url(key);
}

/** Splits a connection id into its socket id and (for E2E ids) the 32-byte client key. */
export function parseConnectionId(id: string): { socketId: string; key?: Uint8Array } {
  const i = typeof id === 'string' ? id.indexOf('~') : -1;
  const socketId = i < 0 ? id : id.slice(0, i);
  if (!isSocketId(socketId)) throw new Error(`HubFly Realtime: invalid connection id ${quoteId(id)}`);
  if (i < 0) return { socketId };
  let key: Uint8Array;
  try {
    key = fromBase64Url(id.slice(i + 1));
  } catch {
    throw new Error('HubFly Realtime: invalid connection id key');
  }
  if (key.length !== 32) throw new Error('HubFly Realtime: invalid connection id key');
  return { socketId, key };
}

// ---------------------------------------------------------------------------------------------
// Client engine (loaded by the `@hubfly/realtime` core only when `e2e` is enabled)

export interface ClientE2EOptions {
  /** Reject v1 messages older than this (default 24 h). */
  maxAgeMs?: number;
  /** Clock, for tests. */
  now?: () => number;
  /**
   * Accept plaintext in E2E contexts (full-E2E channels, direct and user messages, presence and
   * sign-in `user_info`) and deliver it with `meta.encrypted: false`.
   * This WEAKENS the guarantee: a compromised relay can then inject events the handlers cannot
   * tell apart unless they check `meta.encrypted`. Default false: such plaintext is dropped with
   * `e2e:error` `{reason: 'plaintext'}`. `private-encrypted-*` channels never accept plaintext.
   */
  allowPlaintext?: boolean;
}

/** The interface the client core drives. Exposed for custom integrations and tests. */
export interface ClientE2E {
  /** Generates a fresh 32-byte client key and returns its base64url form (connection id suffix). */
  newKey(): string;
  /** Replaces the keys of a context from an auth response (`hubfly.keys`, `shared_secret`). */
  keys(context: string, keys?: ReadonlyArray<WireKey> | null, sharedSecret?: string | null): void;
  /** Drops a context's keys. */
  forget(context: string): void;
  /** True when keys with a kid are known for the context. */
  has(context: string): boolean;
  /**
   * True when the context accepts only envelopes: direct messages (client key), channels and
   * user contexts with keys from the auth endpoint. False with `allowPlaintext`.
   */
  strict(context: string): boolean;
  /**
   * Decrypts an incoming event; returns `[event, data]` or throws `E2EError` (`plaintext` for
   * a non-envelope event).
   */
  open(context: string, event: string, data: unknown): [string, unknown];
  /**
   * Seals a client event with a v1 envelope. Returns `[outerEvent, data]`, or `null` when the
   * context has no keys and `required` is false.
   */
  seal(context: string, event: string, data: unknown, required: boolean): [string, string] | null;
  /**
   * Opens sealed `user_info`: presence `user_info` of a channel, or sign-in `user_info` when
   * `context` is `#server-to-user-<id>`. Absent info is returned unchanged; plaintext info too,
   * unless the context is `strict` (then it throws `E2EError('plaintext')`).
   */
  info(context: string, userId: string, info: unknown): unknown;
}

interface RingKey {
  kid?: string;
  key: Uint8Array;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Creates the client-side E2E engine. */
export function createClientE2E(options: ClientE2EOptions = {}): ClientE2E {
  const now = options.now ?? Date.now;
  const allowPlaintext = !!options.allowPlaintext;
  const receiver = new Receiver(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS, now);
  const ring = new Map<string, RingKey[]>();
  let clientKey: Uint8Array | undefined;

  const v1Key = (context: string, kid: string): Uint8Array => {
    if (context.startsWith('#direct-')) {
      if (kid !== 'c' || !clientKey) throw new E2EError(kid === 'c' ? 'no_key' : 'unknown_kid');
      return clientKey;
    }
    const keys = ring.get(context);
    if (!keys) throw new E2EError('no_key');
    const k = kid === 'c' ? undefined : keys.find((x) => x.kid === kid);
    if (!k) throw new E2EError('unknown_kid');
    return k.key;
  };

  const has = (context: string) => !!ring.get(context)?.some((k) => k.kid);
  const strict = (context: string) => !allowPlaintext && (context.startsWith('#direct-') ? !!clientKey : has(context));

  return {
    has,
    strict,

    newKey() {
      clientKey = randomBytes(32);
      return toBase64Url(clientKey);
    },

    keys(context, keys, sharedSecret) {
      const list: RingKey[] = [];
      for (const k of keys ?? []) {
        try {
          const key = fromBase64(k.key);
          if (key.length === 32 && KID_RE.test(k.kid) && k.kid !== 'c') list.push({ kid: k.kid, key });
        } catch {
          // ignore malformed entries
        }
      }
      if (sharedSecret) {
        try {
          const s = fromBase64(sharedSecret);
          if (s.length === 32 && !list.some((k) => sameBytes(k.key, s))) list.unshift({ key: s });
        } catch {
          // ignore
        }
      }
      if (list.length) ring.set(context, list);
      else ring.delete(context);
    },

    forget(context) {
      ring.delete(context);
    },

    open(context, event, data) {
      const isV1Event = event === E2E_EVENT || event === CLIENT_E2E_EVENT;
      let env: Envelope;
      try {
        env = parseEnvelope(data);
      } catch (err) {
        // Not an envelope at all: plaintext where only ciphertext is accepted.
        if (isV1Event) throw err;
        throw new E2EError('plaintext');
      }
      if (isV1Event !== (env.v === 1)) throw new E2EError('wrong_envelope');
      if (env.v === 1) {
        const msg = openV1(v1Key(context, env.kid), env);
        if ((event === CLIENT_E2E_EVENT) !== msg.e.startsWith('client-')) throw new E2EError('bad_event');
        receiver.check(context, msg);
        return [msg.e, msg.d];
      }
      if (!context.startsWith('private-encrypted-')) throw new E2EError('wrong_envelope');
      const keys = ring.get(context);
      if (!keys) throw new E2EError('no_key');
      return [event, openPusher(keys.map((k) => k.key), env)];
    },

    seal(context, event, data, required) {
      const k = ring.get(context)?.find((x) => x.kid);
      if (!k) {
        if (required) throw new E2EError('no_key');
        return null;
      }
      const t = now();
      return [CLIENT_E2E_EVENT, encryptV1(k.key, k.kid as string, { e: event, d: data, to: context, m: newMessageId(t), t })];
    },

    info(context, userId, info) {
      if (info == null) return info;
      if (typeof info !== 'object' || !own(info, 'ciphertext')) {
        if (strict(context)) throw new E2EError('plaintext');
        return info;
      }
      const env = parseEnvelope(info);
      if (env.v !== 1) throw new E2EError('wrong_envelope');
      const msg = openV1(v1Key(context, env.kid), env);
      // Sealed user_info is re-sent with every member list (and sign-in), so it is exempt from the
      // replay and age checks; it is bound to the context, the event name and the user id instead.
      if (msg.to !== context) throw new E2EError('wrong_context');
      const e = context.startsWith('#server-to-user-') ? SIGNIN_USER_INFO_EVENT : USER_INFO_EVENT;
      if (msg.e !== e || msg.m !== userId) throw new E2EError('bad_event');
      return msg.d;
    },
  };
}

/**
 * Small, dependency-free codecs shared by the e2e and server entries. Decoders are strict
 * (they reject what Go's base64.StdEncoding / RawURLEncoding reject, except line breaks), so the
 * SDK and the engine agree on which envelopes are well formed.
 */

/** An E2E failure. `reason` is a stable machine-readable code (see `E2EReason`). */
export class E2EError extends Error {
  readonly reason: E2EReason;
  constructor(reason: E2EReason, message?: string) {
    super(message ?? reason);
    this.name = 'E2EError';
    this.reason = reason;
  }
}

/**
 * Quotes an id for an error message without leaking an E2E connection key: everything after `~`
 * is replaced by `…`, and long values are cut.
 */
export function quoteId(id: unknown): string {
  if (typeof id !== 'string') return typeof id;
  const i = id.indexOf('~');
  const s = i < 0 ? id : id.slice(0, i) + '~…';
  return JSON.stringify(s.length > 64 ? s.slice(0, 64) + '…' : s);
}

export type E2EReason =
  // envelope shape (identical to the engine's reasons in testdata/e2e/vectors.json)
  | 'not_json'
  | 'not_object'
  | 'missing_members'
  | 'unknown_member'
  | 'bad_nonce'
  | 'short_ciphertext'
  | 'bad_base64'
  | 'bad_version'
  | 'bad_kid'
  | 'bad_ciphertext'
  // decryption and receiver checks
  | 'wrong_envelope'
  | 'no_key'
  | 'unknown_kid'
  | 'decrypt_failed'
  | 'bad_plaintext'
  | 'bad_event'
  | 'wrong_context'
  | 'replayed'
  | 'expired'
  | 'e2e_disabled'
  // a non-envelope event or unsealed user_info in an E2E context
  | 'plaintext';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STD = ALNUM + '+/';
const URL_SAFE = ALNUM + '-_';
const STD_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const URL_RE = /^[A-Za-z0-9_-]*$/;
const LUT = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  LUT[STD.charCodeAt(i)] = i;
  LUT[URL_SAFE.charCodeAt(i)] = i;
}

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = bytes.length - i;
    const n = (bytes[i] << 16) | ((left > 1 ? bytes[i + 1] : 0) << 8) | (left > 2 ? bytes[i + 2] : 0);
    out += alphabet[n >> 18] + alphabet[(n >> 12) & 63];
    out += left > 1 ? alphabet[(n >> 6) & 63] : pad ? '=' : '';
    out += left > 2 ? alphabet[n & 63] : pad ? '=' : '';
  }
  return out;
}

function decode(s: string): Uint8Array {
  const str = s.replace(/=+$/, '');
  const out = new Uint8Array((str.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < str.length; i++) {
    acc = (acc << 6) | LUT[str.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 255;
    }
  }
  return out;
}

/** Standard base64 with padding (the tweetnacl-util encoding used in envelopes). */
export function toBase64(bytes: Uint8Array): string {
  return encode(bytes, STD, true);
}

/** Strict standard base64 (padding required); throws `E2EError('bad_base64')`. */
export function fromBase64(s: string): Uint8Array {
  if (typeof s !== 'string' || !STD_RE.test(s)) throw new E2EError('bad_base64');
  return decode(s);
}

/** base64url without padding (connection-id keys). */
export function toBase64Url(bytes: Uint8Array): string {
  return encode(bytes, URL_SAFE, false);
}

/** Strict base64url without padding; throws `E2EError('bad_base64')`. */
export function fromBase64Url(s: string): Uint8Array {
  if (typeof s !== 'string' || !URL_RE.test(s) || s.length % 4 === 1) throw new E2EError('bad_base64');
  return decode(s);
}

/** Lenient key decoding for configuration values: standard or URL alphabet, padding optional. */
export function decodeKeyMaterial(s: string): Uint8Array {
  let t = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (t.length % 4) t += '=';
  return fromBase64(t);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

const encoder = /* @__PURE__ */ new TextEncoder();

export function utf8Encode(s: string): Uint8Array {
  return encoder.encode(s);
}

/** Fatal UTF-8 decoding (invalid input throws `E2EError('bad_plaintext')`). */
export function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new E2EError('bad_plaintext');
    }
  }
  // Fallback for runtimes without TextDecoder (some React Native engines).
  const units: number[] = [];
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++];
    let cp: number;
    let n: number;
    if (c < 0x80) {
      cp = c;
      n = 0;
    } else if (c >= 0xc2 && c < 0xe0) {
      cp = c & 0x1f;
      n = 1;
    } else if (c >= 0xe0 && c < 0xf0) {
      cp = c & 0x0f;
      n = 2;
    } else if (c >= 0xf0 && c < 0xf5) {
      cp = c & 0x07;
      n = 3;
    } else throw new E2EError('bad_plaintext');
    for (let k = 0; k < n; k++) {
      const d = bytes[i++];
      if (d === undefined || (d & 0xc0) !== 0x80) throw new E2EError('bad_plaintext');
      cp = (cp << 6) | (d & 0x3f);
    }
    if (
      (n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000))) ||
      (n === 3 && (cp < 0x10000 || cp > 0x10ffff))
    ) {
      throw new E2EError('bad_plaintext');
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else units.push(cp);
    if (units.length > 8192) out += String.fromCharCode(...units.splice(0));
  }
  return out + String.fromCharCode(...units);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A message id in the engine's format: `m_` + 26 Crockford base32 characters (ULID layout:
 * 48-bit millisecond time, then 80 random bits), so ids sort by creation time.
 */
export function newMessageId(random: (n: number) => Uint8Array, now: number = Date.now()): string {
  let t = '';
  let ms = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[ms % 32] + t;
    ms = Math.floor(ms / 32);
  }
  const r = random(16);
  for (let i = 0; i < 16; i++) t += CROCKFORD[r[i] & 31];
  return 'm_' + t;
}

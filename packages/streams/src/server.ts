/**
 * `@hubfly/streams/server`: playback token signing and webhook verification for your backend.
 *
 * Web Crypto only (Node 18+, Bun, Deno, Cloudflare Workers); never ship it to browsers, it
 * handles secrets.
 */

/** Playback token claims (PLAYBACK.md "Playback tokens"). */
export interface PlaybackClaims {
  /** A channel id, or `*` for every channel of the server. */
  ch: string;
  /** Expiry, Unix seconds; at most 31 days ahead. */
  exp: number;
  /** Issued at, Unix seconds. */
  iat?: number;
  /** Not before, Unix seconds. */
  nbf?: number;
  /** A viewer id (≤ 128 characters), used only in stats. */
  sub?: string;
  /** An IPv4 address or CIDR the viewer must come from. */
  ip?: string;
}

/** A playback key of the stream server: its id (`spk_…`) and its secret (base64url, 32 bytes). */
export interface PlaybackKey {
  id: string;
  secret: string;
  /** Revoked keys never verify. Default `active`. */
  status?: 'active' | 'retiring' | 'revoked';
}

export interface SignPlaybackTokenOptions {
  /** Token lifetime in seconds when `exp` is not given; default 3600, at most 31 days. */
  ttlSeconds?: number;
  /** Current Unix time in seconds (tests). */
  now?: number;
}

export interface VerifyPlaybackTokenOptions {
  /** The channel the viewer asked for. */
  channel: string;
  /** The viewer's IPv4 address; required when the token has an `ip` claim. */
  clientIp?: string;
  /** Current Unix time in seconds (tests). */
  now?: number;
}

export interface VerifyWebhookOptions {
  /** Maximum `|now − t|` in seconds; default 300. */
  toleranceSeconds?: number;
  /** Current Unix time in seconds (tests). */
  now?: number;
}

/** A refused playback token. The message never says which check failed (like the node's `401`). */
export class PlaybackTokenError extends Error {
  readonly name = 'PlaybackTokenError';
  constructor() {
    super('Playback token refused');
  }
}

const LEEWAY = 30;
const MAX_LIFETIME = 31 * 86_400;
const CLAIM_ORDER = ['ch', 'exp', 'iat', 'nbf', 'sub', 'ip'] as const;
const utf8 = new TextEncoder();

const unixNow = () => Math.floor(Date.now() / 1000);

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new PlaybackTokenError();
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function hmac(secret: Uint8Array, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8.encode(data)));
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Constant-time comparison of two equal-length strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseIPv4(text: string): number | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) return;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return;
    n = n * 256 + Number(part);
  }
  return n >>> 0;
}

function ipMatches(range: string, client: string): boolean {
  const [address, bitsText = '32', extra] = range.split('/');
  const bits = Number(bitsText);
  const net = parseIPv4(address);
  const ip = parseIPv4(client);
  if (extra !== undefined || !/^\d{1,2}$/.test(bitsText) || bits > 32 || net === undefined || ip === undefined) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((net & mask) >>> 0) === ((ip & mask) >>> 0);
}

/**
 * Signs a playback token (compact JWS, HS256) with a playback key. `claims.exp` defaults to
 * `now + ttlSeconds` (one hour). Claims are serialized in the order ch, exp, iat, nbf, sub, ip.
 *
 * ```ts
 * const token = await signPlaybackToken(key, { ch: 'sch_main0001', sub: 'viewer-42' }, { ttlSeconds: 600 });
 * ```
 */
export async function signPlaybackToken(
  key: Pick<PlaybackKey, 'id' | 'secret'>,
  claims: Omit<PlaybackClaims, 'exp'> & { exp?: number },
  options: SignPlaybackTokenOptions = {},
): Promise<string> {
  const now = options.now ?? unixNow();
  const ttl = options.ttlSeconds ?? 3600;
  if (!key?.id || !key.secret) throw new TypeError('signPlaybackToken: key.id and key.secret are required');
  if (!claims?.ch) throw new TypeError('signPlaybackToken: claims.ch is required');
  if (!(ttl > 0 && ttl <= MAX_LIFETIME)) throw new RangeError('signPlaybackToken: ttlSeconds must be within 31 days');
  const full: Record<string, unknown> = { ...claims, exp: claims.exp ?? now + ttl };
  const ordered: Record<string, unknown> = {};
  for (const name of CLAIM_ORDER) if (full[name] !== undefined) ordered[name] = full[name];
  const header = base64url(utf8.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: key.id })));
  const payload = base64url(utf8.encode(JSON.stringify(ordered)));
  return `${header}.${payload}.${base64url(await hmac(fromBase64url(key.secret), `${header}.${payload}`))}`;
}

/**
 * Verifies a playback token as the stream node does and returns its claims. Throws
 * `PlaybackTokenError` for any refusal without saying which check failed. Useful to check a
 * token in your own backend; the node verifies tokens itself.
 */
export async function verifyPlaybackToken(
  token: string,
  keys: readonly PlaybackKey[],
  options: VerifyPlaybackTokenOptions,
): Promise<PlaybackClaims> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new PlaybackTokenError();
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    if (header?.alg !== 'HS256' || typeof header.kid !== 'string') throw new PlaybackTokenError();
    const key = keys.find((k) => k.id === header.kid && (k.status ?? 'active') !== 'revoked');
    if (!key) throw new PlaybackTokenError();
    const signature = fromBase64url(parts[2]);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(fromBase64url(key.secret)),
      signature as BufferSource,
      utf8.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) throw new PlaybackTokenError();

    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as PlaybackClaims;
    const now = options.now ?? unixNow();
    const int = (v: unknown) => Number.isSafeInteger(v);
    if (typeof claims?.ch !== 'string' || !claims.ch) throw new PlaybackTokenError();
    if (claims.ch !== '*' && claims.ch !== options.channel) throw new PlaybackTokenError();
    if (!int(claims.exp) || claims.exp <= now - LEEWAY || claims.exp - now > MAX_LIFETIME) throw new PlaybackTokenError();
    if (claims.nbf !== undefined && (!int(claims.nbf) || claims.nbf > now + LEEWAY)) throw new PlaybackTokenError();
    if (claims.iat !== undefined && (!int(claims.iat) || claims.exp - claims.iat > MAX_LIFETIME)) throw new PlaybackTokenError();
    if (claims.sub !== undefined && (typeof claims.sub !== 'string' || claims.sub.length > 128)) throw new PlaybackTokenError();
    if (claims.ip !== undefined && !(typeof claims.ip === 'string' && options.clientIp && ipMatches(claims.ip, options.clientIp))) {
      throw new PlaybackTokenError();
    }
    return claims;
  } catch {
    throw new PlaybackTokenError();
  }
}

/**
 * Builds a `HubFly-Signature` header value (`t=<unix>,v1=<hex>`) for `body`. The node signs
 * deliveries itself; use this to test your receiver.
 */
export async function signWebhook(secret: string, body: string, timestamp: number = unixNow()): Promise<string> {
  return `t=${timestamp},v1=${hex(await hmac(utf8.encode(secret), `${timestamp}.${body}`))}`;
}

/**
 * Verifies a webhook delivery: `rawBody` must be the exact bytes received (not a re-encoded
 * object), `header` the `HubFly-Signature` value. True when any `v1` matches and the timestamp
 * is within the tolerance (300 s by default).
 *
 * ```ts
 * const raw = await request.text();
 * if (!(await verifyWebhook(process.env.HUBFLY_WEBHOOK_SECRET!, raw, request.headers.get('HubFly-Signature')))) {
 *   return new Response('bad signature', { status: 400 });
 * }
 * ```
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = header.split(',').map((p) => p.trim());
  const stamps = parts.filter((p) => p.startsWith('t='));
  if (stamps.length !== 1 || !/^t=\d{1,15}$/.test(stamps[0])) return false;
  const t = Number(stamps[0].slice(2));
  if (Math.abs((options.now ?? unixNow()) - t) > (options.toleranceSeconds ?? 300)) return false;
  const expected = hex(await hmac(utf8.encode(secret), `${t}.${rawBody}`));
  let ok = false;
  for (const part of parts) {
    if (part.startsWith('v1=') && safeEqual(part.slice(3), expected)) ok = true;
  }
  return ok;
}

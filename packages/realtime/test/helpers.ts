import { createHash, createHmac } from 'node:crypto';

export interface Captured {
  method: string;
  url: URL;
  path: string;
  body?: string;
  json?: any;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fetch stand-in that records requests and answers with `handler`'s reply. */
export function fakeFetch(handler: (req: Captured, n: number) => FakeReply | void = () => ({ body: {} })) {
  const calls: Captured[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const call: Captured = { method: init?.method ?? 'GET', url, path: url.pathname, body, json: body ? JSON.parse(body) : undefined };
    calls.push(call);
    const r = handler(call, calls.length) ?? {};
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetch, calls };
}

/**
 * Independent implementation of the engine's REST signature check (WIRE.md): decoded query
 * parameters minus auth_signature, lower-cased keys, sorted, `key=value` joined with `&`,
 * HMAC-SHA256-hex(secret, "<METHOD>\n<path>\n<query>"), and body_md5 of the raw body.
 */
export function verifyRestSignature(call: Captured, key: string, secret: string, now = Date.now()): void {
  const params: Record<string, string> = {};
  call.url.searchParams.forEach((v, k) => {
    params[k.toLowerCase()] = v;
  });
  const sig = params.auth_signature;
  delete params.auth_signature;
  if (params.auth_key !== key) throw new Error(`auth_key ${params.auth_key}`);
  if (params.auth_version !== '1.0') throw new Error('auth_version');
  if (Math.abs(Number(params.auth_timestamp) - now / 1000) > 600) throw new Error('auth_timestamp');
  if (call.body) {
    const md5 = createHash('md5').update(call.body, 'utf8').digest('hex');
    if (params.body_md5 !== md5) throw new Error('body_md5');
  } else if (params.body_md5) throw new Error('unexpected body_md5');
  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(`${call.method}\n${call.path}\n${query}`).digest('hex');
  if (expected !== sig) throw new Error(`bad signature for ${call.method} ${call.path}`);
}

export const hmacHex = (secret: string, msg: string | Uint8Array) => createHmac('sha256', secret).update(msg).digest('hex');

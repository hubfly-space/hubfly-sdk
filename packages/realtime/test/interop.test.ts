/**
 * Interop with the official Pusher libraries and tweetnacl:
 * - `pusher` (pusher-http-node): channel/user auth, REST query signing, encrypted triggers,
 *   webhook validation;
 * - `tweetnacl`: secretbox envelopes both ways;
 * - `pusher-js/with-encryption` (worker build, runs in Bun): decrypts what our server publishes,
 *   using the auth response our server signed.
 */
import { afterAll, describe, expect, setSystemTime, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Pusher from 'pusher';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { RealtimeServer } from '../src/server/index';
import {
  createClientE2E,
  decryptPusher,
  decryptV1,
  deriveKey,
  encryptPusher,
  encryptV1,
  fromBase64,
  parseKeyList,
  toBase64,
} from '../src/e2e/index';
import { fakeFetch, verifyRestSignature } from './helpers';

const V = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'vectors.json'), 'utf8'));
const MASTER_B64 = V.master_keys[0].key as string; // kid k1
const APP_ID = '1000001';
const KEY = 'k3n9x2m4q8w1e7r5t6y0';
const SECRET = 'interop-secret-0123456789';
const SOCKET = '1234567890.1234567890';

const pusher = new Pusher({ appId: APP_ID, key: KEY, secret: SECRET, useTLS: true, host: 'example.invalid', encryptionMasterKeyBase64: MASTER_B64 });
const ours = new RealtimeServer({ url: 'https://example.invalid', appId: APP_ID, key: KEY, secret: SECRET, encryptionKeys: `k1:${MASTER_B64}` });

afterAll(() => {
  setSystemTime();
});

describe('pusher-http-node: authorization', () => {
  test('private, presence and encrypted channel auth are identical', async () => {
    const cases: Array<[string, Record<string, unknown> | undefined]> = [
      ['private-orders', undefined],
      ['private-encrypted-orders', undefined],
      ['private-encrypted-cache-prices', undefined],
      ['presence-room-1', { user_id: 'u_42', user_info: { name: 'Ann', tags: ['a', 'b'], n: 1.5 } }],
      ['presence-room-2', { user_id: 'u_43' }],
    ];
    for (const [channel, data] of cases) {
      const theirs = pusher.authorizeChannel(SOCKET, channel, data as never) as unknown as Record<string, unknown>;
      const mine = await ours.authorizeChannel(SOCKET, channel, data as never);
      expect({ auth: mine.auth, channel_data: mine.channel_data, shared_secret: mine.shared_secret }).toEqual({
        auth: theirs.auth,
        channel_data: theirs.channel_data,
        shared_secret: theirs.shared_secret,
      } as never);
    }
  });

  test('user authentication is identical', async () => {
    for (const user of [{ id: 'u_42' }, { id: 'u_42', user_info: { name: 'Ann ✓' } }]) {
      const theirs = pusher.authenticateUser(SOCKET, user) as unknown as Record<string, unknown>;
      const mine = await ours.authenticateUser(SOCKET, user);
      expect({ auth: mine.auth, user_data: mine.user_data }).toEqual(theirs as never);
    }
  });

  test('shared_secret equals K(channel, active kid) from the vectors', () => {
    // channelSharedSecret is public in pusher-http-node but missing from its typings.
    const shared = (pusher as unknown as { channelSharedSecret(c: string): Buffer }).channelSharedSecret('private-encrypted-orders');
    expect(shared.toString('base64')).toBe(V.derive[0].key);
  });
});

describe('pusher-http-node: REST signing', () => {
  test('signed query strings are identical for a fixed timestamp and body', async () => {
    setSystemTime(new Date(1760600000123));
    const fixed = new RealtimeServer({ url: 'https://example.invalid', appId: APP_ID, key: KEY, secret: SECRET, now: () => Date.now() });
    const bodies = ['{"name":"e","channels":["orders"],"data":"{\\"id\\":1}"}', '{"note":"café ✓"}', undefined];
    for (const body of bodies) {
      for (const params of [{}, { info: 'subscription_count', filter_by_prefix: 'presence-' }]) {
        const path = `/apps/${APP_ID}/events`;
        const theirs = pusher.createSignedQueryString({ method: body ? 'POST' : 'GET', path, params, body } as never);
        const mine = await fixed.signQuery(body ? 'POST' : 'GET', path, params, body);
        // pusher-http-node does not URL-encode values; compare decoded parameters.
        const decode = (q: string) => Object.fromEntries(new URLSearchParams(q.replace(/,/g, '%2C')));
        expect(decode(mine)).toEqual(decode(theirs));
        expect(new URLSearchParams(mine).get('auth_signature')).toBe(new URLSearchParams(theirs).get('auth_signature'));
      }
    }
    setSystemTime();
  });

  test("pusher-http-node's requests pass our verifier, and its encrypted trigger opens with our E2E code", async () => {
    const captured: Array<{ method: string; url: URL; body: string }> = [];
    const srv = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        captured.push({ method: req.method, url: new URL(req.url), body: await req.text() });
        return Response.json({});
      },
    });
    try {
      const p = new Pusher({
        appId: APP_ID,
        key: KEY,
        secret: SECRET,
        host: '127.0.0.1',
        port: String(srv.port),
        useTLS: false,
        encryptionMasterKeyBase64: MASTER_B64,
      });
      await p.trigger('private-encrypted-orders', 'order.updated', { id: 1, note: 'café ✓' });
      await p.trigger(['orders', 'presence-room'], 'plain', 'hello');
      await p.get({ path: '/channels', params: { filter_by_prefix: 'presence-', info: 'user_count' } });
      for (const c of captured) {
        verifyRestSignature({ method: c.method, url: c.url, path: c.url.pathname, body: c.body || undefined }, KEY, SECRET);
      }
      const enc = JSON.parse(captured[0].body);
      expect(enc.name).toBe('order.updated');
      expect(decryptPusher(fromBase64(V.derive[0].key), enc.data)).toEqual({ id: 1, note: 'café ✓' });
      // Our client engine reads it with the keys from our auth response.
      const e2e = createClientE2E();
      const auth = await ours.authorizeChannel(SOCKET, 'private-encrypted-orders');
      e2e.keys('private-encrypted-orders', auth.hubfly!.keys, auth.shared_secret);
      expect(e2e.open('private-encrypted-orders', 'order.updated', enc.data)).toEqual(['order.updated', { id: 1, note: 'café ✓' }]);
      // A plain trigger's body is what our server sends for the same call.
      expect(JSON.parse(captured[1].body)).toMatchObject({ name: 'plain', channels: ['orders', 'presence-room'], data: 'hello' });
      const { fetch, calls } = fakeFetch();
      await new RealtimeServer({ url: 'https://x.invalid', appId: APP_ID, key: KEY, secret: SECRET, fetch }).trigger(['orders', 'presence-room'], 'plain', 'hello');
      expect(calls[0].json).toEqual(JSON.parse(captured[1].body));
    } finally {
      srv.stop(true);
    }
  });
});

describe('pusher-http-node: webhooks', () => {
  test('pusher validates the X-Pusher-Signature we verify, and vice versa', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ time_ms: now * 1000, events: [{ name: 'member_added', channel: 'presence-room', user_id: 'u_1' }] });
    const token = (pusher as unknown as { config: { token: { sign(s: string): string } } }).config.token;
    const headers = {
      'content-type': 'application/json',
      'x-pusher-key': KEY,
      'x-pusher-signature': token.sign(body),
      'x-hubfly-signature': `t=${now},v1=${token.sign(`${now}.${body}`)}`,
    };
    expect(pusher.webhook({ headers, rawBody: body }).isValid()).toBe(true);
    expect((await ours.verifyWebhook({ headers, body })).events[0].user_id).toBe('u_1');
    const tampered = body.replace('u_1', 'u_2');
    expect(pusher.webhook({ headers, rawBody: tampered }).isValid()).toBe(false);
    await expect(ours.verifyWebhook({ headers, body: tampered })).rejects.toThrow('bad_signature');
  });
});

describe('tweetnacl', () => {
  const key = fromBase64(V.derive[0].key);

  test('our Pusher envelope opens with nacl.secretbox.open', () => {
    const env = JSON.parse(encryptPusher(key, { id: 1, note: 'café ✓' }));
    const pt = nacl.secretbox.open(naclUtil.decodeBase64(env.ciphertext), naclUtil.decodeBase64(env.nonce), key);
    expect(pt).not.toBeNull();
    expect(JSON.parse(naclUtil.encodeUTF8(pt!))).toEqual({ id: 1, note: 'café ✓' });
  });

  test('nacl.secretbox output opens with our code (Pusher and v1 envelopes)', () => {
    const nonce = nacl.randomBytes(24);
    const ct = nacl.secretbox(naclUtil.decodeUTF8(JSON.stringify([1, 'two', { three: 3 }])), nonce, key);
    const env = JSON.stringify({ nonce: naclUtil.encodeBase64(nonce), ciphertext: naclUtil.encodeBase64(ct) });
    expect(decryptPusher(key, env)).toEqual([1, 'two', { three: 3 }]);
    const msg = { e: 'order.updated', d: { id: 9 }, to: 'private-orders', m: 'm_x', t: 1 };
    const ct2 = nacl.secretbox(naclUtil.decodeUTF8(JSON.stringify(msg)), nonce, key);
    const v1 = JSON.stringify({ v: 1, kid: 'k1', nonce: naclUtil.encodeBase64(nonce), ciphertext: naclUtil.encodeBase64(ct2) });
    expect(decryptV1(key, v1)).toEqual({ ...msg, kid: 'k1' });
  });

  test('every vector envelope opens with tweetnacl', () => {
    for (const v of [...V.pusher, ...V.v1]) {
      const env = JSON.parse(v.envelope);
      const pt = nacl.secretbox.open(naclUtil.decodeBase64(env.ciphertext), naclUtil.decodeBase64(env.nonce), naclUtil.decodeBase64(v.key));
      expect(naclUtil.encodeUTF8(pt!)).toBe(v.plaintext);
    }
    const ours1 = encryptV1(key, 'k1', { e: 'x', d: null, to: 'c', m: 'm', t: 0 }, fromBase64(V.v1[0].nonce));
    expect(JSON.parse(ours1).nonce).toBe(V.v1[0].nonce);
  });
});

describe('pusher-js with-encryption', () => {
  test('decrypts what RealtimeServer publishes on private-encrypted channels', async () => {
    const mod = await import('pusher-js/dist/worker/pusher-with-encryption.worker.js' as string);
    const PusherJS = mod.default?.default ?? mod.default ?? mod;

    // Our server publishes (captured), the fake socket server relays it like the engine would.
    const { fetch, calls } = fakeFetch();
    const server = new RealtimeServer({ url: 'https://x.invalid', appId: APP_ID, key: KEY, secret: SECRET, encryptionKeys: `k1:${MASTER_B64}`, fetch });
    await server.trigger('private-encrypted-orders', 'order.updated', { id: 42, note: 'café ✓' });
    const published = calls[0].json;

    const subscribeAuth: string[] = [];
    const ws = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, s) {
        return s.upgrade(req) ? undefined : new Response('upgrade required', { status: 400 });
      },
      websocket: {
        open(sock) {
          sock.send(JSON.stringify({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: SOCKET, activity_timeout: 120 }) }));
        },
        message(sock, raw) {
          const m = JSON.parse(String(raw));
          if (m.event !== 'pusher:subscribe') return;
          subscribeAuth.push(m.data.auth);
          sock.send(JSON.stringify({ event: 'pusher_internal:subscription_succeeded', channel: m.data.channel, data: '{}' }));
          sock.send(JSON.stringify({ event: published.name, channel: published.channels[0], data: published.data }));
        },
      },
    });
    const client = new PusherJS(KEY, {
      wsHost: '127.0.0.1',
      wsPort: ws.port,
      forceTLS: false,
      enabledTransports: ['ws'],
      cluster: 'local',
      disableStats: true,
      channelAuthorization: {
        customHandler: ({ socketId, channelName }: { socketId: string; channelName: string }, cb: (e: unknown, a: unknown) => void) => {
          server.authorizeChannel(socketId, channelName).then((a) => cb(null, a), (e) => cb(e, null));
        },
      },
    });
    try {
      const received = await new Promise<unknown>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 5000);
        client.subscribe('private-encrypted-orders').bind('order.updated', (data: unknown) => {
          clearTimeout(t);
          resolve(data);
        });
      });
      expect(received).toEqual({ id: 42, note: 'café ✓' });
      expect(subscribeAuth[0]).toBe((await server.authorizeChannel(SOCKET, 'private-encrypted-orders')).auth);
    } finally {
      client.disconnect();
      ws.stop(true);
    }
  });

  test('key derivation matches pusher-js expectations for unicode channel names', () => {
    const k = deriveKey('private-encrypted-ü-unicode', parseKeyList(MASTER_B64)[0].key);
    expect(toBase64(k)).toBe(V.derive[5].key);
  });
});

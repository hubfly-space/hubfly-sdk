import { describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RealtimeApiError,
  RealtimeServer,
  WebhookError,
  type RealtimeServerOptions,
} from '../src/server/index';
import { md5 } from '../src/server/md5';
import {
  createClientE2E,
  decryptPusher,
  decryptV1,
  deriveKey,
  encryptPusher,
  encryptV1,
  fromBase64,
  fromBase64Url,
  newMessageId,
  parseConnectionId,
  parseKeyList,
  toBase64,
} from '../src/e2e/index';
import { fakeFetch, hmacHex, verifyRestSignature } from './helpers';

const V = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'vectors.json'), 'utf8'));
const KEYS = `k1:${V.master_keys[0].key},k0:${V.master_keys[1].key}`;
const masters = parseKeyList(KEYS);
const KEY = 'k3n9x2m4q8w1e7r5t6y0';
const SECRET = 'test-secret-0123456789abcdef';
const SOCKET = '1234567890.1234567890';
const E2E_ID = V.connection_ids[0].id as string;

function server(extra: Partial<RealtimeServerOptions> = {}, handler?: Parameters<typeof fakeFetch>[0]) {
  const ff = fakeFetch(handler);
  const rt = new RealtimeServer({ url: 'https://blue-river.rt.hubfly.app', appId: '1000001', key: KEY, secret: SECRET, fetch: ff.fetch, ...extra });
  return { rt, calls: ff.calls };
}

async function errorOf(p: Promise<unknown> | (() => unknown)): Promise<unknown> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}

describe('md5', () => {
  test('RFC 1321 test suite', () => {
    const cases: [string, string][] = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
      ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
    ];
    for (const [input, hex] of cases) expect(Buffer.from(md5(new TextEncoder().encode(input))).toString('hex')).toBe(hex);
  });

  test('matches node:crypto on random inputs of every block boundary', () => {
    for (let n = 0; n < 200; n++) {
      const b = randomBytes(n);
      expect(Buffer.from(md5(b)).toString('hex')).toBe(createHash('md5').update(b).digest('hex'));
    }
    const big = randomBytes(1 << 20);
    expect(Buffer.from(md5(big)).toString('hex')).toBe(createHash('md5').update(big).digest('hex'));
  });
});

describe('REST signing', () => {
  test('Pusher REST documentation vector', async () => {
    const rt = new RealtimeServer({
      url: 'https://api.pusherapp.com',
      appId: '3',
      key: '278d425bdf160c739803',
      secret: '7ad3773142a6692b25b8',
      now: () => 1353088179 * 1000,
    });
    const body = '{"name":"foo","channels":["project-3"],"data":"{\\"some\\":\\"data\\"}"}';
    const q = await rt.signQuery('POST', '/apps/3/events', {}, body);
    expect(q).toBe(
      'auth_key=278d425bdf160c739803&auth_timestamp=1353088179&auth_version=1.0&body_md5=ec365a775a4cd0599faeb73354201b6f' +
        '&auth_signature=da454824c97ba181a32ccc17a72625ba02771f50b50e1e7430e47a1f3f457e6c',
    );
  });

  test('query parameters are signed unescaped, sorted, lower-cased, and sent escaped', async () => {
    const { rt, calls } = server({}, () => ({ body: { channels: {} } }));
    await rt.channels({ prefix: 'presence-', info: ['user_count', 'subscription_count'] });
    const c = calls[0];
    expect(c.method).toBe('GET');
    expect(c.path).toBe('/apps/1000001/channels');
    expect(c.url.search).toContain('info=user_count%2Csubscription_count');
    expect(c.url.searchParams.get('filter_by_prefix')).toBe('presence-');
    expect(c.url.searchParams.get('body_md5')).toBeNull();
    verifyRestSignature(c, KEY, SECRET);
  });
});

describe('Pusher endpoints', () => {
  test('trigger plaintext', async () => {
    const { rt, calls } = server({}, () => ({ body: { channels: { orders: { subscription_count: 2 } } } }));
    const res = await rt.trigger(['orders', 'presence-room'], 'order.updated', { id: 1 }, { socketId: E2E_ID, info: 'subscription_count' });
    expect(res).toEqual({ channels: { orders: { subscription_count: 2 } } });
    const c = calls[0];
    expect(c.path).toBe('/apps/1000001/events');
    expect(c.json).toEqual({
      name: 'order.updated',
      channels: ['orders', 'presence-room'],
      data: '{"id":1}',
      socket_id: SOCKET,
      info: 'subscription_count',
    });
    verifyRestSignature(c, KEY, SECRET);
    await rt.trigger('orders', 'raw', 'already a string');
    expect(calls[1].json.data).toBe('already a string');
  });

  test('trigger on an encrypted channel sends a Pusher envelope', async () => {
    const { rt, calls } = server({ encryptionKeys: KEYS });
    await rt.trigger('private-encrypted-orders', 'order.updated', { id: 1 });
    const body = calls[0].json;
    expect(body.name).toBe('order.updated');
    expect(typeof body.data).toBe('string');
    expect(decryptPusher(fromBase64(V.derive[0].key), body.data)).toEqual({ id: 1 });
    verifyRestSignature(calls[0], KEY, SECRET);
  });

  test('encrypted channels need keys and cannot opt out', async () => {
    const { rt } = server();
    expect(String(await errorOf(() => rt.trigger('private-encrypted-orders', 'x', 1)))).toContain('encryptionKeys');
    const { rt: rt2 } = server({ encryptionKeys: KEYS });
    expect(String(await errorOf(() => rt2.trigger('private-encrypted-orders', 'x', 1, { encrypt: false })))).toContain('always encrypted');
  });

  test('multi-channel trigger with per-channel keys becomes a batch', async () => {
    const { rt, calls } = server({ encryptionKeys: KEYS }, () => ({ body: { batch: [{ subscription_count: 1 }, { subscription_count: 2 }] } }));
    const res = await rt.trigger(['private-encrypted-orders', 'orders'], 'e', { a: 1 }, { info: 'subscription_count' });
    expect(calls[0].path).toBe('/apps/1000001/batch_events');
    const [enc, plain] = calls[0].json.batch;
    expect(enc.channel).toBe('private-encrypted-orders');
    expect(decryptPusher(fromBase64(V.derive[0].key), enc.data)).toEqual({ a: 1 });
    expect(plain).toEqual({ channel: 'orders', name: 'e', data: '{"a":1}', info: 'subscription_count' });
    expect(res).toEqual({ channels: { 'private-encrypted-orders': { subscription_count: 1 }, orders: { subscription_count: 2 } } });
  });

  test('fullE2E seals private and presence channels with v1', async () => {
    const { rt, calls } = server({ encryptionKeys: KEYS, fullE2E: true });
    await rt.trigger('private-orders', 'order.updated', { id: 1 });
    await rt.trigger('orders', 'order.updated', { id: 1 });
    await rt.trigger('orders', 'forced', 2, { encrypt: true });
    const sealed = calls[0].json;
    expect(sealed.name).toBe('hubfly.e2e');
    const msg = decryptV1(deriveKey('private-orders', masters[0].key), sealed.data);
    expect(msg).toMatchObject({ kid: 'k1', e: 'order.updated', d: { id: 1 }, to: 'private-orders' });
    expect(calls[1].json).toMatchObject({ name: 'order.updated', data: '{"id":1}' });
    expect(calls[2].json.name).toBe('hubfly.e2e');
  });

  test('triggerBatch, channel info, users, terminate', async () => {
    const { rt, calls } = server({}, (c) => ({ body: c.path.endsWith('/users') ? { users: [{ id: 'u_1' }] } : { occupied: true } }));
    await rt.triggerBatch([
      { channel: 'a', name: 'x', data: 1 },
      { channel: 'b', name: 'y', data: 'two', socketId: SOCKET },
    ]);
    expect(calls[0].json).toEqual({
      batch: [
        { channel: 'a', name: 'x', data: '1' },
        { channel: 'b', name: 'y', data: 'two', socket_id: SOCKET },
      ],
    });
    expect(await rt.channelInfo('presence-room', { info: 'user_count' })).toEqual({ occupied: true });
    expect(calls[1].path).toBe('/apps/1000001/channels/presence-room');
    expect(await rt.channelUsers('presence-room')).toEqual({ users: [{ id: 'u_1' }] });
    await rt.terminateUserConnections('u_1');
    expect(calls[3]).toMatchObject({ method: 'POST', path: '/apps/1000001/users/u_1/terminate_connections', json: {} });
    for (const c of calls) verifyRestSignature(c, KEY, SECRET);
  });

  test('names are validated', async () => {
    const { rt } = server();
    expect(await errorOf(() => rt.trigger('bad channel', 'x', 1))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.trigger('ok', 'pusher:internal', 1))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.trigger('ok', 'hubfly:x', 1))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.channelInfo('#server-to-user-u1'))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.channelInfo('a/b'))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.trigger([], 'x', 1))).toBeInstanceOf(TypeError);
  });
});

describe('HubFly endpoints', () => {
  test('publish with idempotency key and positions', async () => {
    const { rt, calls } = server({}, () => ({ body: { message_id: 'mid', channels: { orders: { epoch: 'e7k2m9', offset: 43 } } } }));
    const res = await rt.channel('orders').publish('order.updated', { id: 1 }, { messageId: 'order-1-v2', socketId: SOCKET });
    expect(calls[0].path).toBe('/apps/1000001/hubfly/v1/publish');
    expect(calls[0].json).toEqual({ channels: ['orders'], event: 'order.updated', data: { id: 1 }, message_id: 'order-1-v2', socket_id: SOCKET });
    expect(res).toEqual({ message_id: 'order-1-v2', channels: { orders: { epoch: 'e7k2m9', offset: 43 } } });
    await rt.publish(['a', 'b'], 'x', 1);
    expect(calls[1].json.message_id).toMatch(/^m_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(calls[1].json.channels).toEqual(['a', 'b']);
    for (const c of calls) verifyRestSignature(c, KEY, SECRET);
    expect(await errorOf(() => rt.publish('a', 'x', 1, { messageId: 'bad id' }))).toBeInstanceOf(TypeError);
  });

  test('encrypted publish is split per channel with derived ids', async () => {
    const { rt, calls } = server({ encryptionKeys: KEYS }, (c) => ({
      body: { message_id: c.json.message_id, channels: { [c.json.channels[0]]: { epoch: 'e', offset: 1 } } },
    }));
    const res = await rt.publish(['private-encrypted-orders', 'orders'], 'created', { id: 7 }, { messageId: 'abc' });
    expect(calls.map((c) => c.json.message_id).sort()).toEqual(['abc.0', 'abc.1']);
    const enc = calls.find((c) => c.json.channels[0] === 'private-encrypted-orders')!.json;
    expect(enc.event).toBe('created');
    expect(decryptPusher(fromBase64(V.derive[0].key), enc.data)).toEqual({ id: 7 });
    expect(calls.find((c) => c.json.channels[0] === 'orders')!.json.data).toEqual({ id: 7 });
    expect(res.message_id).toBe('abc');
    expect(res.message_ids).toEqual({ 'private-encrypted-orders': 'abc.0', orders: 'abc.1' });
    expect(Object.keys(res.channels).sort()).toEqual(['orders', 'private-encrypted-orders']);
  });

  test('send to plain and E2E connection ids', async () => {
    const { rt, calls } = server({}, (c) => ({
      body: { message_id: c.json.message_id, results: c.json.socket_ids.map((s: string) => ({ socket_id: s, status: 'delivered' })) },
    }));
    const plainIds = ['1111111111.2222222222', '3333333333.4444444444'];
    const res = await rt.send([...plainIds, E2E_ID], 'order.updated', { orderId: 'o_9' }, { messageId: 'send-1', ack: true });
    expect(calls.length).toBe(2);
    const plain = calls.find((c) => c.json.socket_ids.length === 2)!.json;
    expect(plain).toEqual({ socket_ids: plainIds, event: 'order.updated', data: { orderId: 'o_9' }, message_id: 'send-1.0', ack: true });
    const sealed = calls.find((c) => c.json.socket_ids[0] === SOCKET)!.json;
    expect(sealed.event).toBe('hubfly.e2e');
    expect(sealed.message_id).toBe('send-1.1');
    const msg = decryptV1(fromBase64Url(V.connection_ids[0].key), sealed.data);
    expect(msg).toMatchObject({ kid: 'c', e: 'order.updated', d: { orderId: 'o_9' }, to: `#direct-${SOCKET}`, m: 'send-1.1' });
    expect(res.message_id).toBe('send-1');
    expect(res.results.map((r) => [r.id, r.status, r.message_id]).sort()).toEqual(
      [
        [plainIds[0], 'delivered', 'send-1.0'],
        [plainIds[1], 'delivered', 'send-1.0'],
        [E2E_ID, 'delivered', 'send-1.1'],
      ].sort(),
    );
    for (const c of calls) verifyRestSignature(c, KEY, SECRET);
  });

  test('send options: single request keeps the id, encrypt false/true', async () => {
    const { rt, calls } = server({}, (c) => ({ body: { results: c.json.socket_ids.map((s: string) => ({ socket_id: s, status: 'offline' })) } }));
    await rt.connection(E2E_ID).send('x', 1, { messageId: 'only' });
    expect(calls[0].json.message_id).toBe('only');
    expect(calls[0].json.ack).toBeUndefined();
    await rt.send(E2E_ID, 'x', 1, { encrypt: false });
    expect(calls[1].json).toMatchObject({ event: 'x', data: 1, socket_ids: [SOCKET] });
    expect(await errorOf(() => rt.send(SOCKET, 'x', 1, { encrypt: true }))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.send('not-an-id', 'x', 1))).toBeInstanceOf(Error);
  });

  test('user messages are sealed per user with the active key', async () => {
    const { rt, calls } = server({ encryptionKeys: KEYS }, (c) => ({
      body: { results: c.json.user_ids.map((u: string) => ({ user_id: u, status: 'queued', connections: 0 })) },
    }));
    const res = await rt.sendToUsers(['u_42', 'u_43'], 'notice', { text: 'Hi' }, { messageId: 'n1' });
    expect(calls.length).toBe(2);
    for (const c of calls) {
      const user = c.json.user_ids[0];
      expect(c.json.event).toBe('hubfly.e2e');
      const ctx = `#server-to-user-${user}`;
      const e2e = createClientE2E();
      e2e.keys(ctx, [{ kid: 'k1', key: toBase64(deriveKey(ctx, masters[0].key)) }]);
      expect(e2e.open(ctx, 'hubfly.e2e', c.json.data)).toEqual(['notice', { text: 'Hi' }]);
    }
    expect(res.results.map((r) => r.id).sort()).toEqual(['u_42', 'u_43']);
    await rt.toUser('u_42').send('plain', 1, { encrypt: false });
    expect(calls[2].json).toMatchObject({ user_ids: ['u_42'], event: 'plain', data: 1 });
  });

  test('user messages without keys are plaintext; encrypt: true needs keys', async () => {
    const { rt, calls } = server({}, () => ({ body: { results: [] } }));
    await rt.toUser('u_1').send('notice', { a: 1 });
    expect(calls[0].json).toMatchObject({ user_ids: ['u_1'], event: 'notice', data: { a: 1 } });
    expect(String(await errorOf(() => rt.toUser('u_1').send('n', 1, { encrypt: true })))).toContain('encryptionKeys');
  });

  test('status, terminate, receipts and 404 handling', async () => {
    const { rt, calls } = server({}, (c) => {
      if (c.path.includes('/connections/1111111111.1111111111')) return { status: 404, body: { online: false } };
      if (c.path.includes('/connections/')) {
        return c.method === 'POST' ? { body: { terminated: true } } : { body: { socket_id: SOCKET, online: true, state: 'connected' } };
      }
      if (c.path.includes('/users/u_gone')) return { status: 404, body: { error: 'not found' } };
      if (c.path.includes('/users/')) return { body: { user_id: 'u_1', online: true, connections: 2, socket_ids: [SOCKET] } };
      if (c.path.includes('/messages/m_unknown')) return { status: 404, body: { error: 'not found' } };
      return { body: { message_id: 'm_1', created_at: 'now', event: 'x', targets: [] } };
    });
    expect(await rt.isOnline(E2E_ID)).toBe(true);
    expect(calls[0].path).toBe(`/apps/1000001/hubfly/v1/connections/${SOCKET}`);
    expect(await rt.connectionStatus('1111111111.1111111111')).toEqual({ socket_id: '1111111111.1111111111', online: false });
    expect(await rt.terminate(E2E_ID)).toEqual({ terminated: true });
    expect(calls[2].json).toEqual({ mode: 'terminate' });
    await rt.connection(E2E_ID).terminate({ mode: 'disconnect' });
    expect(calls[3]).toMatchObject({ method: 'POST', path: `/apps/1000001/hubfly/v1/connections/${SOCKET}/terminate`, json: { mode: 'disconnect' } });
    expect(String(await errorOf(() => rt.terminate(E2E_ID, { mode: 'close' as 'terminate' })))).toContain('mode');
    expect((await rt.toUser('u_1').status()).connections).toBe(2);
    expect(await rt.userStatus('u_gone')).toEqual({ user_id: 'u_gone', online: false, connections: 0, socket_ids: [] });
    expect(await rt.messageReceipt('m_1')).toMatchObject({ message_id: 'm_1' });
    expect(await rt.messageReceipt('m_unknown')).toBeNull();
    for (const c of calls) verifyRestSignature(c, KEY, SECRET);
  });

  test('history decrypts envelopes', async () => {
    const ctx = 'private-encrypted-orders';
    const v1 = encryptV1(deriveKey(ctx, masters[1].key), 'k0', { e: 'client-typing', d: { t: 1 }, to: ctx, m: 'x1', t: 1 });
    const { rt, calls } = server({ encryptionKeys: KEYS }, () => ({
      body: {
        channel: ctx,
        epoch: 'e1',
        head: 3,
        oldest: 1,
        truncated: false,
        gap: false,
        messages: [
          { offset: 1, event: 'order.updated', data: V.pusher[0].envelope, message_id: 'a', published_at: 't' },
          { offset: 2, event: 'client-hubfly.e2e', data: v1, message_id: 'b', published_at: 't' },
          { offset: 3, event: 'order.updated', data: '{"nonce":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY","ciphertext":"AgMEBQYHCAkKCwwNDg8QEQ=="}', message_id: 'c', published_at: 't' },
        ],
      },
    }));
    const { rt: plain } = server({}, () => ({
      body: {
        channel: 'orders',
        epoch: 'e1',
        head: 3,
        oldest: 1,
        truncated: false,
        gap: false,
        messages: [
          { offset: 1, event: 'a', data: '{"id":1}', message_id: 'a', published_at: 't' },
          { offset: 2, event: 'b', data: 'plain text', message_id: 'b', published_at: 't' },
          { offset: 3, event: 'c', data: '42', message_id: 'c', published_at: 't', user_id: 'u_1' },
        ],
      },
    }));
    // Plaintext is decoded like client handlers receive it; raw keeps the stored text.
    expect((await plain.history('orders')).messages.map((m) => m.data)).toEqual([{ id: 1 }, 'plain text', 42]);
    expect((await plain.history('orders', { raw: true })).messages.map((m) => m.data)).toEqual(['{"id":1}', 'plain text', '42']);
    const h = await rt.channel(ctx).history({ since: 0, epoch: 'e1', limit: 10 });
    expect(calls[0].url.searchParams.get('limit')).toBe('10');
    expect(calls[0].url.searchParams.get('since')).toBe('0');
    expect(h.messages[0]).toMatchObject({ event: 'order.updated', data: V.pusher[0].data, encrypted: true });
    expect(h.messages[1]).toMatchObject({ event: 'client-typing', data: { t: 1 }, encrypted: true });
    expect(h.messages[2].e2e_error).toBe('decrypt_failed');
    const raw = await rt.history(ctx, { raw: true });
    expect(raw.messages[0].data).toBe(V.pusher[0].envelope);
  });

  test('idempotent POSTs retry once on 503; GETs do not', async () => {
    const { rt, calls } = server({}, (c, n) => (n === 1 ? { status: 503, headers: { 'retry-after': '0' }, body: { error: 'draining' } } : { body: { message_id: c.json?.message_id, channels: {} } }));
    const res = await rt.publish('a', 'x', 1, { messageId: 'retry-me' });
    expect(res.message_id).toBe('retry-me');
    expect(calls.length).toBe(2);
    expect(calls[1].json.message_id).toBe('retry-me');
    const { rt: rt2, calls: calls2 } = server({}, () => ({ status: 503, body: { error: 'draining' } }));
    const err = (await errorOf(() => rt2.channelInfo('a'))) as RealtimeApiError;
    expect(err).toBeInstanceOf(RealtimeApiError);
    expect(err.status).toBe(503);
    expect(calls2.length).toBe(1);
  });

  test('API errors carry status, body, reason and Retry-After', async () => {
    const { rt } = server({}, () => ({ status: 403, body: { error: 'Plaintext rejected', reason: 'e2e_required' } }));
    const err = (await errorOf(() => rt.trigger('a', 'x', 1))) as RealtimeApiError;
    expect(err.status).toBe(403);
    expect(err.reason).toBe('e2e_required');
    expect(err.message).toContain('Plaintext rejected');
    const { rt: rt2 } = server({}, () => ({ status: 429, headers: { 'retry-after': '3' }, body: { error: 'Too many' } }));
    expect(((await errorOf(() => rt2.trigger('a', 'x', 1))) as RealtimeApiError).retryAfter).toBe(3);
  });
});

describe('authorization', () => {
  const docs = () =>
    new RealtimeServer({ url: 'https://example.com', appId: '1', key: '278d425bdf160c739803', secret: '7ad3773142a6692b25b8' });

  test('Pusher documentation vectors', async () => {
    expect(await docs().authorizeChannel('1234.1234', 'private-foobar')).toEqual({
      auth: '278d425bdf160c739803:58df8b0c36d6982b82c3ecf6b4662e34fe8c25bba48f5369f135bf843651c3a4',
    });
    expect(await docs().authorizeChannel('1234.1234', 'presence-foobar', { user_id: 10, user_info: { name: 'Mr. Channels' } })).toEqual({
      auth: '278d425bdf160c739803:31935e7d86dba64c2a90aed31fdc61869f9b22ba9d8863bba239c03ca481bc80',
      channel_data: '{"user_id":10,"user_info":{"name":"Mr. Channels"}}',
    });
    // pusher-http-go's TestAuthenticatePresenceChannel
    expect((await docs().authorizeChannel('1234.1234', 'presence-foobar', { user_id: '10', user_info: { name: 'Mr. Pusher' } })).auth).toBe(
      '278d425bdf160c739803:48dac51d2d7569e1e9c0f48c227d4b26f238fa68e5c0bb04222c966909c4f7c4',
    );
  });

  test('encrypted channels get shared_secret and every kid', async () => {
    const { rt } = server({ encryptionKeys: KEYS });
    const res = await rt.authorizeChannel(SOCKET, 'private-encrypted-orders');
    expect(res.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}:private-encrypted-orders`)}`);
    expect(res.shared_secret).toBe(V.derive[0].key);
    expect(res.hubfly).toEqual({ keys: [{ kid: 'k1', key: V.derive[0].key }, { kid: 'k0', key: V.derive[1].key }] });
    // Other private/presence channels get keys (so clients accept only envelopes) with fullE2E only.
    const priv = await rt.authorizeChannel(SOCKET, 'private-orders');
    expect(priv.shared_secret).toBeUndefined();
    expect(priv.hubfly).toBeUndefined();
    const full = await server({ encryptionKeys: KEYS, fullE2E: true }).rt.authorizeChannel(SOCKET, 'private-orders');
    expect(full.hubfly!.keys[0]).toEqual({ kid: 'k1', key: toBase64(deriveKey('private-orders', masters[0].key)) });
    expect(String(await errorOf(() => server().rt.authorizeChannel(SOCKET, 'private-encrypted-orders')))).toContain('encryptionKeys');
  });

  test('fullE2E seals presence user_info', async () => {
    const { rt } = server({ encryptionKeys: KEYS, fullE2E: true });
    const res = await rt.authorizeChannel(SOCKET, 'presence-room-1', { user_id: 'u_42', user_info: { name: 'Ann' } });
    const cd = JSON.parse(res.channel_data!);
    expect(cd.user_id).toBe('u_42');
    expect(cd.user_info.v).toBe(1);
    expect(res.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}:presence-room-1:${res.channel_data}`)}`);
    const e2e = createClientE2E();
    e2e.keys('presence-room-1', res.hubfly!.keys);
    expect(e2e.info('presence-room-1', 'u_42', cd.user_info)).toEqual({ name: 'Ann' });
    const plain = await server({ encryptionKeys: KEYS }).rt.authorizeChannel(SOCKET, 'presence-room-1', { user_id: 'u_42', user_info: { name: 'Ann' } });
    expect(JSON.parse(plain.channel_data!).user_info).toEqual({ name: 'Ann' });
  });

  test('fullE2E seals sign-in user_info with K(#server-to-user-<id>)', async () => {
    const { rt } = server({ encryptionKeys: KEYS, fullE2E: true });
    const res = await rt.authenticateUser(SOCKET, { id: 'u_42', user_info: { name: 'Ann' } });
    const ud = JSON.parse(res.user_data);
    expect(ud.id).toBe('u_42');
    expect(Object.keys(ud.user_info).sort()).toEqual(['ciphertext', 'kid', 'nonce', 'v']);
    expect(ud.user_info.kid).toBe('k1');
    expect(res.user_data).not.toContain('Ann');
    expect(res.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}::user::${res.user_data}`)}`);
    const inner = decryptV1(deriveKey('#server-to-user-u_42', masters[0].key), ud.user_info);
    expect(inner).toMatchObject({ e: 'signin.user_info', d: { name: 'Ann' }, to: '#server-to-user-u_42', m: 'u_42' });
    const e2e = createClientE2E();
    e2e.keys('#server-to-user-u_42', res.hubfly!.keys);
    expect(e2e.info('#server-to-user-u_42', 'u_42', ud.user_info)).toEqual({ name: 'Ann' });
    expect(() => e2e.info('#server-to-user-u_42', 'u_7', ud.user_info)).toThrow('bad_event');
    // A sealed presence user_info is not accepted as sign-in user_info (and vice versa).
    const pres = await rt.authorizeChannel(SOCKET, 'presence-room-1', { user_id: 'u_42', user_info: { name: 'Ann' } });
    e2e.keys('presence-room-1', pres.hubfly!.keys);
    expect(() => e2e.info('presence-room-1', 'u_42', ud.user_info)).toThrow('decrypt_failed');
    // Absent user_info stays absent; without fullE2E it stays plaintext.
    expect((await rt.authenticateUser(SOCKET, { id: 'u_42' })).user_data).toBe('{"id":"u_42"}');
    const plain = await server({ encryptionKeys: KEYS }).rt.authenticateUser(SOCKET, { id: 'u_42', user_info: { name: 'Ann' } });
    expect(plain.user_data).toBe('{"id":"u_42","user_info":{"name":"Ann"}}');
    // authHandler seals too.
    const h = rt.authHandler({ getUser: () => ({ id: 'u_42', info: { name: 'Ann' } }) });
    const body = await (await h(new Request('https://a/auth', { method: 'POST', body: new URLSearchParams({ socket_id: SOCKET }) }))).json();
    expect(JSON.parse(body.user_data).user_info.v).toBe(1);
  });

  test('input validation', async () => {
    const { rt } = server();
    expect(await errorOf(() => rt.authorizeChannel('nope', 'private-a'))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.authorizeChannel(SOCKET, 'presence-a'))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.authorizeChannel(SOCKET, 'bad name'))).toBeInstanceOf(TypeError);
    expect(await errorOf(() => rt.authenticateUser(SOCKET, { id: '' }))).toBeInstanceOf(TypeError);
  });

  test('authenticateUser', async () => {
    const { rt } = server({ encryptionKeys: KEYS });
    const res = await rt.authenticateUser(SOCKET, { id: 'u_42', user_info: { name: 'Ann' } });
    expect(res.user_data).toBe('{"id":"u_42","user_info":{"name":"Ann"}}');
    expect(res.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}::user::${res.user_data}`)}`);
    expect(res.hubfly!.keys).toEqual([
      { kid: 'k1', key: V.derive[3].key },
      { kid: 'k0', key: toBase64(deriveKey('#server-to-user-u_42', masters[1].key)) },
    ]);
  });
});

describe('authHandler', () => {
  const form = (body: Record<string, string>, headers: Record<string, string> = {}) =>
    new Request('https://app.example/api/realtime/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
    });

  const handler = (extra: Partial<RealtimeServerOptions> = {}, canAccess?: (u: unknown, c: string) => boolean) =>
    server(extra).rt.authHandler({
      getUser: (req) => (req.headers.get('x-user') ? { id: req.headers.get('x-user')!, info: { name: 'Ann' } } : null),
      canAccess: canAccess as never,
    });

  test('channel auth for signed-in users', async () => {
    const h = handler({ encryptionKeys: KEYS });
    const res = await h(form({ socket_id: SOCKET, channel_name: 'private-encrypted-orders' }, { 'x-user': 'u_1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}:private-encrypted-orders`)}`);
    expect(body.shared_secret).toBe(V.derive[0].key);
    expect(body.hubfly.keys.length).toBe(2);
  });

  test('presence channel data comes from getUser', async () => {
    const res = await handler()(form({ socket_id: SOCKET, channel_name: 'presence-room' }, { 'x-user': 'u_1' }));
    const body = await res.json();
    expect(body.channel_data).toBe('{"user_id":"u_1","user_info":{"name":"Ann"}}');
    expect(body.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}:presence-room:${body.channel_data}`)}`);
  });

  test('user auth when channel_name is absent; JSON bodies', async () => {
    const res = await handler()(
      new Request('https://app.example/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'u_7' },
        body: JSON.stringify({ socket_id: SOCKET }),
      }),
    );
    const body = await res.json();
    expect(body.user_data).toBe('{"id":"u_7","user_info":{"name":"Ann"}}');
    expect(body.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET}::user::${body.user_data}`)}`);
  });

  test('refusals', async () => {
    const h = handler();
    expect((await h(form({ socket_id: SOCKET, channel_name: 'private-a' }))).status).toBe(403);
    expect((await h(form({ socket_id: SOCKET }))).status).toBe(403);
    expect((await h(form({ socket_id: 'x', channel_name: 'private-a' }, { 'x-user': 'u' }))).status).toBe(400);
    expect((await h(form({ socket_id: SOCKET, channel_name: 'public' }, { 'x-user': 'u' }))).status).toBe(400);
    expect((await h(form({ socket_id: SOCKET, channel_name: 'private-encrypted-x' }, { 'x-user': 'u' }))).status).toBe(403);
    const bad = new Request('https://a/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect((await h(bad)).status).toBe(400);
    const denied = handler({}, (_u, c) => c !== 'private-secret');
    expect((await denied(form({ socket_id: SOCKET, channel_name: 'private-secret' }, { 'x-user': 'u' }))).status).toBe(403);
    expect((await denied(form({ socket_id: SOCKET, channel_name: 'private-open' }, { 'x-user': 'u' }))).status).toBe(200);
    const anonymous = handler({}, () => true);
    expect((await anonymous(form({ socket_id: SOCKET, channel_name: 'private-open' }))).status).toBe(200);
    expect((await anonymous(form({ socket_id: SOCKET, channel_name: 'presence-open' }))).status).toBe(403);
  });
});

describe('verifyWebhook', () => {
  const NOW = 1760600000;
  const body = JSON.stringify({ time_ms: NOW * 1000, events: [{ name: 'channel_occupied', channel: 'orders' }] });
  const headers = (b = body, t = NOW, secret = SECRET, key = KEY) => ({
    'Content-Type': 'application/json',
    'X-Pusher-Key': key,
    'X-Pusher-Signature': hmacHex(secret, b),
    'X-HubFly-Signature': `t=${t},v1=${hmacHex(secret, `${t}.${b}`)}`,
    'X-HubFly-Delivery-Id': 'wd_1',
  });
  const rt = () => server({ now: () => NOW * 1000 }).rt;

  test('accepts valid requests and plain inputs', async () => {
    const req = new Request('https://app.example/hook', { method: 'POST', headers: headers(), body });
    expect(await rt().verifyWebhook(req)).toEqual(JSON.parse(body));
    expect((await rt().verifyWebhook({ headers: headers(), body })).events[0].name).toBe('channel_occupied');
    const lower = Object.fromEntries(Object.entries(headers()).map(([k, v]) => [k.toLowerCase(), [v]]));
    expect((await rt().verifyWebhook({ headers: lower, body: new TextEncoder().encode(body) })).time_ms).toBe(NOW * 1000);
  });

  test('rejections', async () => {
    const r = rt();
    const reason = async (input: Parameters<RealtimeServer['verifyWebhook']>[0], o?: Parameters<RealtimeServer['verifyWebhook']>[1]) =>
      ((await errorOf(() => r.verifyWebhook(input, o))) as WebhookError).reason;
    expect(await reason({ headers: headers(), body: body + ' ' })).toBe('bad_signature');
    expect(await reason({ headers: headers(body, NOW - 301), body })).toBe('timestamp_out_of_tolerance');
    expect(await reason({ headers: headers(body, NOW + 301), body })).toBe('timestamp_out_of_tolerance');
    expect(await r.verifyWebhook({ headers: headers(body, NOW - 1000), body }, { toleranceSeconds: 2000 })).toBeTruthy();
    // `t` in the future: a small clock skew (60 s) is fine, more is refused whatever the tolerance.
    expect(await r.verifyWebhook({ headers: headers(body, NOW + 60), body })).toBeTruthy();
    expect(await reason({ headers: headers(body, NOW + 61), body })).toBe('timestamp_out_of_tolerance');
    expect(await reason({ headers: headers(body, NOW + 1000), body }, { toleranceSeconds: 2000 })).toBe('timestamp_out_of_tolerance');
    expect(await reason({ headers: headers(body, NOW, 'other-secret'), body })).toBe('bad_signature');
    const { 'X-HubFly-Signature': _drop, ...pusherOnly } = headers();
    expect(await reason({ headers: pusherOnly, body })).toBe('missing_hubfly_signature');
    expect((await r.verifyWebhook({ headers: pusherOnly, body }, { allowPusherSignature: true })).events.length).toBe(1);
    expect(await reason({ headers: {}, body })).toBe('missing_signature');
    const wrongPusher = { ...headers(), 'X-Pusher-Signature': hmacHex('x', body) };
    expect(await reason({ headers: wrongPusher, body })).toBe('bad_signature');
    expect(await reason({ headers: headers(body, NOW, 'rotated-secret', 'rotatedkey0000000000'), body })).toBe('unknown_key');
    expect(
      (await r.verifyWebhook({ headers: headers(body, NOW, 'rotated-secret', 'rotatedkey0000000000'), body }, {
        extraKeys: [{ key: 'rotatedkey0000000000', secret: 'rotated-secret' }],
      })).events.length,
    ).toBe(1);
    expect(await reason({ headers: headers('nope'), body: 'nope' })).toBe('bad_body');
    const multi = { ...headers(), 'X-HubFly-Signature': `t=${NOW},v1=${'0'.repeat(64)},v1=${hmacHex(SECRET, `${NOW}.${body}`)}` };
    expect((await r.verifyWebhook({ headers: multi, body })).events.length).toBe(1);
  });
});

describe('construction and fromEnv', () => {
  test('url normalization and validation', () => {
    const base = { appId: '1', key: 'k', secret: 's' };
    expect(new RealtimeServer({ ...base, url: 'wss://a.rt.hubfly.app/' }).url).toBe('https://a.rt.hubfly.app');
    expect(new RealtimeServer({ ...base, url: 'http://127.0.0.1:6001' }).url).toBe('http://127.0.0.1:6001');
    expect(() => new RealtimeServer({ ...base, url: 'ftp://x' })).toThrow();
    expect(() => new RealtimeServer({ ...base, url: 'nope' })).toThrow();
    expect(() => new RealtimeServer({ ...base, url: 'https://x', appId: '1/2' })).toThrow();
    expect(() => new RealtimeServer({ ...base, url: 'https://x', secret: '' })).toThrow();
    expect(new RealtimeServer({ ...base, url: 'https://x', encryptionKeys: '' }).encryption).toBe(false);
    expect(() => new RealtimeServer({ ...base, url: 'https://x', encryptionKeys: 'k1:AAAA' })).toThrow(/32 bytes/);
  });

  test('canonical names', () => {
    const rt = RealtimeServer.fromEnv({
      HUBFLY_REALTIME_URL: 'https://blue.rt.hubfly.app',
      HUBFLY_REALTIME_APP_ID: '1000001',
      HUBFLY_REALTIME_KEY: KEY,
      HUBFLY_REALTIME_SECRET: SECRET,
      HUBFLY_REALTIME_E2E_KEYS: KEYS,
    });
    expect([rt.url, rt.appId, rt.key, rt.encryption]).toEqual(['https://blue.rt.hubfly.app', '1000001', KEY, true]);
  });

  test('Laravel/Pusher fallbacks and overrides', () => {
    const rt = RealtimeServer.fromEnv(
      { PUSHER_HOST: 'blue.rt.hubfly.app', PUSHER_PORT: '443', PUSHER_SCHEME: 'https', PUSHER_APP_ID: '7', PUSHER_APP_KEY: 'pk', PUSHER_APP_SECRET: 'ps' },
      { timeoutMs: 5 },
    );
    expect([rt.url, rt.appId, rt.key, rt.encryption]).toEqual(['https://blue.rt.hubfly.app', '7', 'pk', false]);
    expect(RealtimeServer.fromEnv({ PUSHER_HOST: '127.0.0.1', PUSHER_PORT: '6001', PUSHER_SCHEME: 'http', PUSHER_APP_ID: '7', PUSHER_APP_KEY: 'k', PUSHER_APP_SECRET: 's' }).url).toBe(
      'http://127.0.0.1:6001',
    );
  });

  test('missing variables are listed', () => {
    expect(() => RealtimeServer.fromEnv({ HUBFLY_REALTIME_URL: 'https://x' })).toThrow(
      'missing environment variables: HUBFLY_REALTIME_APP_ID, HUBFLY_REALTIME_KEY, HUBFLY_REALTIME_SECRET',
    );
  });

  test('defaults to process.env', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        HUBFLY_REALTIME_URL: 'https://env.rt.hubfly.app',
        HUBFLY_REALTIME_APP_ID: '42',
        HUBFLY_REALTIME_KEY: 'kk',
        HUBFLY_REALTIME_SECRET: 'ss',
      });
      expect(RealtimeServer.fromEnv().appId).toBe('42');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    }
  });
});

describe('secret hygiene', () => {
  test('JSON.stringify and util.inspect never show the secret or the keys', async () => {
    const { inspect } = await import('node:util');
    const { rt } = server({ encryptionKeys: KEYS });
    const json = JSON.stringify(rt);
    expect(JSON.parse(json)).toEqual({ url: 'https://blue-river.rt.hubfly.app', appId: '1000001', key: KEY, secret: '[redacted]', encryption: true });
    for (const out of [json, inspect(rt), inspect(rt, { showHidden: true, depth: 10 }), inspect({ nested: [rt] }), `${rt}`]) {
      expect(out).not.toContain(SECRET);
      for (const m of masters) expect(out).not.toContain(Buffer.from(m.key).toString('base64'));
    }
  });

  test('authHandler answers server-side failures with a generic error', async () => {
    const { rt } = server();
    const handler = rt.authHandler({ getUser: () => ({ id: 'secret internal~value' }) });
    const res = await handler(new Request('https://app.example/auth', { method: 'POST', body: new URLSearchParams({ socket_id: '1.2' }) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Authorization failed' });
  });

  test('id errors never include the key of an E2E connection id', async () => {
    const { rt } = server();
    const k = 'A'.repeat(43);
    const bad = `bad.id~${k}`;
    const messages = [
      String(await errorOf(() => rt.send(bad, 'x', 1))),
      String(await errorOf(() => parseConnectionId(bad))),
      String(await errorOf(() => rt.authorizeChannel(`1.2~${k}`, 'private-x'))),
      String(await errorOf(() => rt.authenticateUser(`1.2~${k}`, { id: 'u' }))),
      String(await errorOf(() => rt.toUser(`1.2~${k}`).send('x', 1))),
    ];
    for (const m of messages) {
      expect(m).toContain('invalid');
      expect(m).not.toContain(k);
    }
    expect(messages[1]).toContain('"bad.id~…"');
  });
});

describe('decrypt helper', () => {
  test('v1 and Pusher envelopes, wrong context', () => {
    const { rt } = server({ encryptionKeys: KEYS });
    const ctx = 'private-encrypted-orders';
    expect(rt.decrypt(ctx, 'order.updated', V.pusher[0].envelope)).toEqual({ event: 'order.updated', data: V.pusher[0].data, encrypted: true });
    expect(rt.decrypt(ctx, 'client-hubfly.e2e', V.v1[5].envelope)).toEqual({ event: 'client-typing', data: { typing: true }, encrypted: true });
    expect(() => rt.decrypt('private-encrypted-other', 'client-hubfly.e2e', V.v1[5].envelope)).toThrow();
    expect(rt.decrypt('orders', 'x', 1)).toEqual({ event: 'x', data: 1, encrypted: false });
    const env = encryptPusher(deriveKey(ctx, masters[1].key), { old: true });
    expect(rt.decrypt(ctx, 'x', env).data).toEqual({ old: true });
    expect(newMessageId()).toMatch(/^m_/);
  });

  test('plaintext in E2E contexts throws E2EError(plaintext) unless allowPlaintext (H3)', () => {
    const reasonOf = (f: () => unknown) => {
      try {
        f();
      } catch (err) {
        return (err as { reason?: string }).reason;
      }
      return 'no error';
    };
    const { rt: full } = server({ encryptionKeys: KEYS, fullE2E: true });
    const { rt: keys } = server({ encryptionKeys: KEYS });
    // A forged client_event webhook on a full-E2E channel, a user context or an encrypted channel.
    expect(reasonOf(() => full.decrypt('private-orders', 'client-order.paid', '{"amount":0}'))).toBe('plaintext');
    expect(reasonOf(() => full.decrypt('presence-room', 'client-x', { a: 1 }))).toBe('plaintext');
    for (const rt of [full, keys]) {
      expect(reasonOf(() => rt.decrypt('#server-to-user-u_1', 'notice', '{"a":1}'))).toBe('plaintext');
      expect(reasonOf(() => rt.decrypt('private-encrypted-orders', 'client-x', '{"a":1}'))).toBe('plaintext');
    }
    // Contexts that are not E2E keep returning plaintext unchanged.
    expect(keys.decrypt('private-orders', 'client-x', '{"a":1}')).toEqual({ event: 'client-x', data: '{"a":1}', encrypted: false });
    expect(full.decrypt('orders', 'x', 1)).toEqual({ event: 'x', data: 1, encrypted: false });
    // Sealed events still open.
    const sealed = full.decrypt('private-encrypted-orders', 'order.updated', V.pusher[0].envelope);
    expect(sealed.encrypted).toBe(true);
    // allowPlaintext: passed through with encrypted: false (encrypted channels still refuse it).
    const { rt: lax } = server({ encryptionKeys: KEYS, fullE2E: true, allowPlaintext: true });
    expect(lax.decrypt('private-orders', 'client-order.paid', '{"amount":0}')).toEqual({ event: 'client-order.paid', data: '{"amount":0}', encrypted: false });
    expect(lax.decrypt('#server-to-user-u_1', 'notice', 1)).toEqual({ event: 'notice', data: 1, encrypted: false });
    expect(reasonOf(() => lax.decrypt('private-encrypted-orders', 'client-x', '{"a":1}'))).toBe('plaintext');
  });

  test('history flags plaintext in full-E2E channels; allowPlaintext decodes it', async () => {
    const body = () => ({
      body: {
        channel: 'private-orders',
        epoch: 'e1',
        head: 1,
        oldest: 1,
        truncated: false,
        gap: false,
        messages: [{ offset: 1, event: 'order.paid', data: '{"amount":0}', message_id: 'a', published_at: 't' }],
      },
    });
    const strict = (await server({ encryptionKeys: KEYS, fullE2E: true }, body).rt.history('private-orders')).messages[0];
    expect(strict).toMatchObject({ event: 'order.paid', data: '{"amount":0}', e2e_error: 'plaintext' });
    expect(strict.encrypted).toBeUndefined();
    const lax = (await server({ encryptionKeys: KEYS, fullE2E: true, allowPlaintext: true }, body).rt.history('private-orders')).messages[0];
    expect(lax).toMatchObject({ event: 'order.paid', data: { amount: 0 } });
    expect(lax.encrypted).toBeUndefined();
    expect(lax.e2e_error).toBeUndefined();
  });
});

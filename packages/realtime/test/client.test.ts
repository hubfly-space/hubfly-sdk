/**
 * Client protocol tests against an in-process fake server (test/fake-server.ts): hello/resume,
 * recovery, dedupe, acks, backoff and close codes, fallback to /app/{key}, planned reconnects,
 * keep-alive, presence, client events, sign-in, auth requests and E2E.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Realtime, VERSION, type RealtimeOptions } from '../src/index';
import * as e2eModule from '../src/e2e/index';
import { encryptV1, fromBase64Url } from '../src/e2e/index';
import { RealtimeServer } from '../src/server/index';
import { FakeServer, once, sleep, type FakeConn } from './fake-server';
import { fakeFetch, hmacHex } from './helpers';

const V = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'vectors.json'), 'utf8'));
const KEYS = `k1:${V.master_keys[0].key},k0:${V.master_keys[1].key}`;
const KEY = 'k3n9x2m4q8w1e7r5t6y0';
const SECRET = 'client-test-secret-0123';
const SOCKET_A = '1111111111.1111111111';
const SOCKET_B = '2222222222.2222222222';

let srv: FakeServer;
const clients: Realtime[] = [];

beforeEach(() => {
  srv = new FakeServer();
});

afterEach(() => {
  for (const rt of clients.splice(0)) rt.disconnect();
  srv.stop();
});

function make(o: Partial<RealtimeOptions> = {}): Realtime {
  const rt = new Realtime({ url: srv.url, key: KEY, backoff: { minMs: 10, maxMs: 40 }, ...o });
  clients.push(rt);
  return rt;
}

async function connectHub(rt: Realtime, socketId = SOCKET_A, token = 'tok1') {
  const p = rt.connect();
  const conn = await srv.nextConn();
  const hello = await conn.next('hubfly:hello');
  conn.establish(socketId, { session_token: token, resumed: false });
  const res = await p;
  return { conn, hello, res };
}

async function waitFor(cond: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timeout');
    await sleep(5);
  }
}

function serverSdk(extra: Partial<ConstructorParameters<typeof RealtimeServer>[0]> = {}) {
  const ff = fakeFetch((c) => ({
    body: {
      message_id: c.json?.message_id,
      results: (c.json?.socket_ids ?? []).map((s: string) => ({ socket_id: s, status: 'delivered' })),
    },
  }));
  const server = new RealtimeServer({ url: 'https://x.invalid', appId: '1000001', key: KEY, secret: SECRET, fetch: ff.fetch, ...extra });
  return { server, calls: ff.calls };
}

describe('connecting', () => {
  test('speaks first with hubfly:hello and resolves the connection id', async () => {
    const rt = make();
    const states: string[] = [];
    rt.on('state', (s) => states.push(s.current));
    const { conn, hello, res } = await connectHub(rt);
    expect(conn.path).toBe(`/hubfly/v1/app/${KEY}?protocol=7&client=hubfly-js&version=${VERSION}&flash=false`);
    expect(conn.frames[0].event).toBe('hubfly:hello');
    expect(hello.data).toEqual({ v: 1, features: ['ack', 'offsets'] });
    expect(res).toEqual({ id: SOCKET_A, socketId: SOCKET_A });
    expect([rt.id, rt.socketId, rt.state, rt.hubfly]).toEqual([SOCKET_A, SOCKET_A, 'connected', true]);
    expect(states).toEqual(['connecting', 'connected']);
    expect(await rt.connect()).toEqual(res);
  });

  test('version matches package.json', () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')).version);
  });

  test('wss:// urls and an injected WebSocket constructor', async () => {
    const urls: string[] = [];
    class Spy extends WebSocket {
      constructor(url: string) {
        urls.push(url);
        super(url);
      }
    }
    const rt = make({ url: `${srv.url.replace('http', 'ws')}/`, WebSocket: Spy as never });
    await connectHub(rt);
    expect(urls[0].startsWith(`ws://127.0.0.1:${srv.server.port}/hubfly/v1/app/${KEY}?`)).toBe(true);
  });

  test('channels subscribed before connect() are subscribed once connected', async () => {
    const rt = make();
    rt.subscribe('a');
    rt.channel('b');
    expect(rt.subscribe('a')).toBe(rt.channel('a'));
    const { conn } = await connectHub(rt);
    const subs = [await conn.next('pusher:subscribe'), await conn.next('pusher:subscribe')].map((f) => f.data.channel);
    expect(subs.sort()).toEqual(['a', 'b']);
  });

  test('connect() rejects when disconnect() is called first', async () => {
    const rt = make();
    const p = rt.connect();
    await srv.nextConn();
    rt.disconnect();
    await expect(p).rejects.toThrow('disconnected');
  });
});

describe('sessions and recovery', () => {
  test('resumes after an abnormal close without resubscribing', async () => {
    const rt = make();
    const { conn } = await connectHub(rt, SOCKET_A, 'tok1');
    const ch = rt.subscribe('orders');
    expect((await conn.next('pusher:subscribe')).data).toEqual({ channel: 'orders' });
    conn.subscribed('orders', { hubfly: { epoch: 'E1', head: 4 } });
    const got: unknown[] = [];
    ch.bind('order.updated', (d) => got.push(d));
    conn.event('order.updated', { id: 5 }, { channel: 'orders', hubfly: { e: 'E1', o: 5, m: 'm5' } });
    await waitFor(() => got.length === 1);
    const idEvents: unknown[] = [];
    rt.on('id', (e) => idEvents.push(e));

    const reconnecting = once(rt, 'reconnecting');
    conn.kill();
    expect((await reconnecting).code).toBe(1006);
    const conn2 = await srv.nextConn();
    expect((await conn2.next('hubfly:hello')).data).toEqual({
      v: 1,
      features: ['ack', 'offsets'],
      resume: { socket_id: SOCKET_A, token: 'tok1' },
      channels: { orders: { epoch: 'E1', offset: 5 } },
    });
    const connected = once(rt, 'connected');
    conn2.establish(SOCKET_A, { session_token: 'tok2', resumed: true });
    expect(await connected).toEqual({ id: SOCKET_A, resumed: true });
    conn2.event('order.updated', { id: 6 }, { channel: 'orders', hubfly: { e: 'E1', o: 6, m: 'm6' } });
    const resumed = once(rt, 'resumed');
    const recovery = once(ch, 'recovery');
    conn2.send({
      event: 'hubfly:resumed',
      data: JSON.stringify({ channels: { orders: { status: 'recovered', from: 5, to: 6 } }, messages: { replayed: 1, dropped: 0 } }),
    });
    expect((await resumed).messages).toEqual({ replayed: 1, dropped: 0 });
    expect(await recovery).toMatchObject({ status: 'recovered', from: 5, to: 6 });
    await sleep(30);
    expect(conn2.all('pusher:subscribe')).toEqual([]);
    expect(idEvents).toEqual([]);
    expect(got).toEqual([{ id: 5 }, { id: 6 }]);

    // The rotated token and the advanced position are used next time.
    conn2.kill();
    const conn3 = await srv.nextConn();
    const hello3 = await conn3.next('hubfly:hello');
    expect(hello3.data.resume.token).toBe('tok2');
    expect(hello3.data.channels.orders).toEqual({ epoch: 'E1', offset: 6 });
  });

  test('a lost session resubscribes with recovery positions and reports the new id', async () => {
    const rt = make();
    const { conn } = await connectHub(rt, SOCKET_A, 'tok1');
    const ch = rt.subscribe('orders');
    await conn.next('pusher:subscribe');
    conn.subscribed('orders', { hubfly: { epoch: 'E1', head: 4 } });
    await once(ch, 'pusher:subscription_succeeded');
    expect(ch.pos).toEqual({ epoch: 'E1', offset: 4 });

    conn.close(4200, 'restart');
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    const idChange = once(rt, 'id');
    conn2.establish(SOCKET_B, { session_token: 'tok-new', resumed: false });
    expect(await idChange).toEqual({ id: SOCKET_B, previous: SOCKET_A });
    expect(rt.id).toBe(SOCKET_B);
    expect((await conn2.next('pusher:subscribe')).data).toEqual({ channel: 'orders', hubfly: { since: { epoch: 'E1', offset: 4 } } });

    const got: unknown[] = [];
    ch.bind('order.updated', (d) => got.push(d));
    const recovery = once(ch, 'recovery');
    conn2.subscribed('orders', { hubfly: { epoch: 'E1', head: 6, recovery: 'recovered', reason: null, replayed: 2 } });
    conn2.event('order.updated', { id: 5 }, { channel: 'orders', hubfly: { e: 'E1', o: 5, m: 'm5' } });
    conn2.event('order.updated', { id: 6 }, { channel: 'orders', hubfly: { e: 'E1', o: 6, m: 'm6' } });
    conn2.event('order.updated', { id: 6 }, { channel: 'orders', hubfly: { e: 'E1', o: 6, m: 'm6-other' } });
    conn2.event('order.updated', { id: 5 }, { channel: 'orders', hubfly: { e: 'E1', o: 5, m: 'm5-other' } });
    expect(await recovery).toMatchObject({ status: 'recovered', replayed: 2 });
    await waitFor(() => got.length >= 2);
    await sleep(30);
    expect(got).toEqual([{ id: 5 }, { id: 6 }]);
    expect(ch.pos).toEqual({ epoch: 'E1', offset: 6 });
  });

  test('failed recovery emits recovery:failed and restarts from the head', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('orders');
    await conn.next('pusher:subscribe');
    conn.subscribed('orders', { hubfly: { epoch: 'E1', head: 4 } });
    await once(ch, 'pusher:subscription_succeeded');
    conn.close(4200);
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    conn2.establish(SOCKET_B, { session_token: 't', resumed: false });
    await conn2.next('pusher:subscribe');
    const failed = once(ch, 'recovery:failed');
    conn2.subscribed('orders', { hubfly: { epoch: 'E2', head: 10, recovery: 'failed', reason: 'epoch_changed' } });
    expect(await failed).toEqual({ reason: 'epoch_changed' });
    expect(ch.pos).toEqual({ epoch: 'E2', offset: 10 });
    // history_off: no position at all
    const failed2 = once(ch, 'recovery:failed');
    conn2.subscribed('orders', { hubfly: { epoch: null, head: null, recovery: 'failed', reason: 'history_off' } });
    expect(await failed2).toEqual({ reason: 'history_off' });
    expect(ch.pos).toBeUndefined();
    // also reported through hubfly:resumed
    const failed3 = once(ch, 'recovery:failed');
    conn2.send({ event: 'hubfly:resumed', data: JSON.stringify({ channels: { orders: { status: 'failed', reason: 'overflow' } } }) });
    expect(await failed3).toEqual({ reason: 'overflow' });
  });

  test('unconfirmed subscriptions are sent again after a resume', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    rt.subscribe('orders');
    await conn.next('pusher:subscribe'); // never confirmed
    conn.kill();
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    conn2.establish(SOCKET_A, { session_token: 't2', resumed: true });
    expect((await conn2.next('pusher:subscribe')).data).toEqual({ channel: 'orders' });
  });

  test('dedupes by message id per channel; duplicates are acked again', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    const a = rt.subscribe('a');
    const b = rt.subscribe('b');
    const got: string[] = [];
    a.bind('x', () => got.push('a'));
    b.bind('x', () => got.push('b'));
    rt.on('x', () => got.push('direct'));
    conn.event('x', 1, { channel: 'a', hubfly: { m: 'm1' } });
    conn.event('x', 1, { channel: 'a', hubfly: { m: 'm1' } });
    conn.event('x', 1, { channel: 'b', hubfly: { m: 'm1' } }); // same publish to another channel
    conn.event('x', 1, { hubfly: { k: 'direct', m: 'd1', ack: true } });
    conn.event('x', 1, { hubfly: { k: 'direct', m: 'd1', ack: true } });
    await waitFor(() => conn.all('hubfly:ack').length > 0);
    await sleep(20);
    expect(got).toEqual(['a', 'b', 'direct']);
    expect(conn.all('hubfly:ack').flatMap((f) => f.data.m)).toEqual(['d1', 'd1']);
  });

  test('acks after handlers settle, batched, at most 100 ids per frame', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const handled: string[] = [];
    rt.on('notice', async (d: { n: string }, meta) => {
      expect(meta).toMatchObject({ event: 'notice', kind: 'direct', encrypted: false });
      await gate;
      handled.push(d.n);
    });
    for (const n of ['1', '2', '3']) conn.event('notice', { n }, { hubfly: { k: 'direct', m: `m${n}`, ack: true } });
    conn.event('notice', { n: '4' }, { hubfly: { k: 'direct', m: 'm4' } });
    await sleep(50);
    expect(conn.all('hubfly:ack')).toEqual([]);
    release();
    expect((await conn.next('hubfly:ack')).data.m).toEqual(['m1', 'm2', 'm3']);
    expect(handled.sort()).toEqual(['1', '2', '3', '4']);

    for (let i = 0; i < 150; i++) conn.event('bulk', i, { hubfly: { k: 'direct', m: `b${i}`, ack: true } });
    const f1 = await conn.next('hubfly:ack');
    const f2 = await conn.next('hubfly:ack');
    expect([f1.data.m.length, f2.data.m.length]).toEqual([100, 50]);
  });

  test('acks pending during a drop are sent after a resume, dropped after a new session', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    rt.on('n', () => gate);
    conn.event('n', 1, { hubfly: { k: 'direct', m: 'p1', ack: true } });
    await sleep(10);
    conn.kill();
    await once(rt, 'reconnecting');
    release();
    await sleep(10);
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    conn2.establish(SOCKET_A, { session_token: 't2', resumed: true });
    expect((await conn2.next('hubfly:ack')).data).toEqual({ m: ['p1'] });
  });
});

describe('close codes, backoff and fallback', () => {
  test('4000-4099 stops reconnecting', async () => {
    const rt = make();
    const p = rt.connect();
    const conn = await srv.nextConn();
    await conn.next('hubfly:hello');
    const err = once(rt, 'error');
    conn.close(4001, 'Unknown app key');
    await expect(p).rejects.toMatchObject({ code: 4001 });
    expect((await err).code).toBe(4001);
    expect(rt.state).toBe('disconnected');
    await sleep(100);
    expect(srv.conns.length).toBe(1);
  });

  test('4100-4199 backs off; 4200-4299 reconnects immediately', async () => {
    const rt = make({ backoff: { minMs: 50, maxMs: 1000 } });
    const { conn } = await connectHub(rt);
    const random = Math.random;
    Math.random = () => 1;
    try {
      const rec = once(rt, 'reconnecting');
      const t0 = Date.now();
      conn.close(4100, 'Over capacity');
      expect(await rec).toEqual({ code: 4100, delay: 200, attempt: 1 });
      const conn2 = await srv.nextConn();
      expect(Date.now() - t0).toBeGreaterThanOrEqual(180);
      await conn2.next('hubfly:hello');
      conn2.establish(SOCKET_A, { session_token: 't2', resumed: true });
      await once(rt, 'connected');
      const rec2 = once(rt, 'reconnecting');
      conn2.close(4200, 'restart');
      expect(await rec2).toEqual({ code: 4200, delay: 0, attempt: 1 });
      await srv.nextConn();
    } finally {
      Math.random = random;
    }
  });

  test('exponential backoff with full jitter, capped, reset after connecting', async () => {
    const rt = make({ backoff: { minMs: 10, maxMs: 40 } });
    const random = Math.random;
    Math.random = () => 1;
    const delays: number[] = [];
    rt.on('reconnecting', (r) => delays.push(r.delay));
    try {
      rt.connect().catch(() => {});
      for (let i = 0; i < 5; i++) (await srv.nextConn()).close(1011, 'boom');
      const conn = await srv.nextConn();
      await conn.next('hubfly:hello');
      conn.establish(SOCKET_A, { session_token: 't', resumed: false });
      await once(rt, 'connected');
      conn.close(1011);
      await srv.nextConn();
      expect(delays).toEqual([10, 20, 40, 40, 40, 10]);
    } finally {
      Math.random = random;
    }
    Math.random = () => 0.5;
    try {
      const d: number[] = [];
      rt.on('reconnecting', (r) => d.push(r.delay));
      srv.conns.at(-1)!.close(1011); // second failure in a row: 0.5 * min(40, 10 * 2^1)
      await srv.nextConn();
      expect(d[0]).toBe(10);
    } finally {
      Math.random = random;
    }
  });

  test('falls back to /app/{key} when the HubFly path is unavailable', async () => {
    srv.hubflyPath = false;
    const rt = make();
    const p = rt.connect();
    const conn = await srv.nextConn();
    expect(srv.attempts[0].path.startsWith(`/hubfly/v1/app/${KEY}?`)).toBe(true);
    expect(conn.path).toBe(`/app/${KEY}?protocol=7&client=hubfly-js&version=${VERSION}&flash=false`);
    conn.establish(SOCKET_A);
    expect((await p).id).toBe(SOCKET_A);
    expect(rt.hubfly).toBe(false);
    const ch = rt.subscribe('orders');
    expect((await conn.next('pusher:subscribe')).data).toEqual({ channel: 'orders' });
    const got = once(ch, 'e');
    conn.event('e', { a: 1 }, { channel: 'orders' });
    expect(await got).toEqual({ a: 1 });
    await sleep(20);
    expect(conn.all('hubfly:hello')).toEqual([]);
  });

  test('when both paths fail it backs off and tries the HubFly path first again', async () => {
    srv.hubflyPath = false;
    srv.pusherPath = false;
    const rt = make({ backoff: { minMs: 5, maxMs: 10 } });
    rt.connect().catch(() => {});
    await waitFor(() => srv.attempts.length >= 4);
    const kinds = srv.attempts.slice(0, 4).map((a) => (a.path.startsWith('/hubfly/') ? 'hubfly' : 'pusher'));
    expect(kinds).toEqual(['hubfly', 'pusher', 'hubfly', 'pusher']);
    srv.hubflyPath = true;
    const conn = await srv.nextConn();
    expect(conn.path.startsWith('/hubfly/v1/app/')).toBe(true);
  });

  test('while a detached session can be resumed it retries only the HubFly path, then falls back again', async () => {
    const rt = make({ backoff: { minMs: 5, maxMs: 10 } });
    const p = rt.connect();
    const conn = await srv.nextConn();
    await conn.next('hubfly:hello');
    conn.establish(SOCKET_A, { session_token: 't1', resumed: false, detach_ttl: 1 });
    await p;
    srv.hubflyPath = false;
    srv.pusherPath = false;
    const before = srv.attempts.length;
    conn.close(1006);
    await waitFor(() => srv.attempts.length >= before + 4);
    expect(srv.attempts.slice(before).every((a) => a.path.startsWith('/hubfly/'))).toBe(true);
    // After detach_ttl the session is gone anyway: the Pusher path is tried again.
    await sleep(1050);
    const later = srv.attempts.length;
    await waitFor(() => srv.attempts.length >= later + 2);
    expect(srv.attempts.slice(later).some((a) => a.path.startsWith('/app/'))).toBe(true);
    srv.hubflyPath = true;
    srv.pusherPath = true;
    rt.disconnect();
  });

  test("transport 'hubfly' never falls back; transport 'pusher' never tries HubFly", async () => {
    srv.hubflyPath = false;
    const rt = make({ transport: 'hubfly', backoff: { minMs: 5, maxMs: 10 } });
    rt.connect().catch(() => {});
    await waitFor(() => srv.attempts.length >= 3);
    expect(srv.attempts.every((a) => a.path.startsWith('/hubfly/'))).toBe(true);
    rt.disconnect();
    const rt2 = make({ transport: 'pusher' });
    const p = rt2.connect();
    const conn = await srv.nextConn();
    expect(conn.path.startsWith('/app/')).toBe(true);
    conn.establish(SOCKET_B);
    await p;
  });

  test('hubfly:reconnect closes with 4200 after after_ms and resumes', async () => {
    const rt = make();
    const { conn } = await connectHub(rt, SOCKET_A, 'tok1');
    const t0 = Date.now();
    conn.send({ event: 'hubfly:reconnect', data: JSON.stringify({ after_ms: 80, reason: 'restart' }) });
    expect((await conn.waitClose()).code).toBe(4200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    const conn2 = await srv.nextConn();
    expect((await conn2.next('hubfly:hello')).data.resume).toEqual({ socket_id: SOCKET_A, token: 'tok1' });
  });

  test('pings after silence, answers server pings, reconnects when a pong is missing', async () => {
    const rt = make({ activityTimeoutMs: 60, pongTimeoutMs: 60 });
    const { conn } = await connectHub(rt);
    conn.send({ event: 'pusher:ping', data: {} });
    expect((await conn.next('pusher:pong')).data).toEqual({});
    expect((await conn.next('pusher:ping')).data).toEqual({});
    conn.send({ event: 'pusher:pong', data: {} });
    await conn.next('pusher:ping');
    expect((await conn.waitClose()).code).toBe(4201);
    const conn2 = await srv.nextConn();
    expect((await conn2.next('hubfly:hello')).data.resume.socket_id).toBe(SOCKET_A);
  });

  test('a connection attempt that never establishes times out', async () => {
    const rt = make({ connectTimeoutMs: 80 });
    rt.connect().catch(() => {});
    const conn = await srv.nextConn();
    await conn.next('hubfly:hello');
    expect((await conn.waitClose()).code).toBe(4201);
    await srv.nextConn();
  });

  test('disconnect() closes with 1000; a later connect() starts a new session', async () => {
    const rt = make();
    const { conn } = await connectHub(rt, SOCKET_A, 'tok1');
    rt.subscribe('orders');
    await conn.next('pusher:subscribe');
    rt.disconnect();
    expect((await conn.waitClose()).code).toBe(1000);
    expect(rt.state).toBe('disconnected');
    await sleep(50);
    expect(srv.conns.length).toBe(1);
    const p = rt.connect();
    const conn2 = await srv.nextConn();
    expect((await conn2.next('hubfly:hello')).data.resume).toBeUndefined();
    conn2.establish(SOCKET_B, { session_token: 'tok2', resumed: false });
    await p;
    expect((await conn2.next('pusher:subscribe')).data.channel).toBe('orders');
  });
});

describe('channels', () => {
  test('presence members, me and member events', async () => {
    const server = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET });
    const rt = make({
      authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName, { user_id: 'u_1', user_info: { name: 'Ann' } }),
    });
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('presence-room');
    const sub = await conn.next('pusher:subscribe');
    expect(sub.data.channel_data).toBe('{"user_id":"u_1","user_info":{"name":"Ann"}}');
    expect(sub.data.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET_A}:presence-room:${sub.data.channel_data}`)}`);
    const ok = once(ch, 'pusher:subscription_succeeded');
    conn.subscribed('presence-room', { presence: { ids: ['u_1', 'u_2'], hash: { u_1: { name: 'Ann' }, u_2: { name: 'Bob' } }, count: 2 } });
    expect(await ok).toBe(ch.members);
    expect(ch.members!.count).toBe(2);
    expect(ch.members!.me).toEqual({ id: 'u_1', info: { name: 'Ann' } });
    expect(ch.members!.get('u_2')).toEqual({ id: 'u_2', info: { name: 'Bob' } });
    expect(ch.members!.get('nobody')).toBeNull();
    const added = once(ch, 'pusher:member_added');
    conn.send({ event: 'pusher_internal:member_added', channel: 'presence-room', data: JSON.stringify({ user_id: 'u_3', user_info: { name: 'Cy' } }) });
    expect(await added).toEqual({ id: 'u_3', info: { name: 'Cy' } });
    const removed = once(ch, 'pusher:member_removed');
    conn.send({ event: 'pusher_internal:member_removed', channel: 'presence-room', data: JSON.stringify({ user_id: 'u_2' }) });
    expect(await removed).toEqual({ id: 'u_2', info: { name: 'Bob' } });
    const ids: string[] = [];
    ch.members!.each((m) => ids.push(m.id));
    expect(ids.sort()).toEqual(['u_1', 'u_3']);
  });

  test('sealed presence user_info is opened with E2E', async () => {
    const server = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: KEYS, fullE2E: true });
    const rt = make({
      e2e: { module: e2eModule },
      authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName, { user_id: 'u_1', user_info: { name: 'Ann' } }),
    });
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('presence-room');
    const sub = await conn.next('pusher:subscribe');
    const sealedMe = JSON.parse(sub.data.channel_data).user_info;
    expect(sealedMe.v).toBe(1);
    const other = await server.authorizeChannel(SOCKET_B, 'presence-room', { user_id: 'u_2', user_info: { name: 'Bob' } });
    const sealedBob = JSON.parse(other.channel_data!).user_info;
    conn.subscribed('presence-room', { presence: { ids: ['u_1', 'u_2'], hash: { u_1: sealedMe, u_2: sealedBob }, count: 2 } });
    await once(ch, 'pusher:subscription_succeeded');
    expect(ch.members!.me).toEqual({ id: 'u_1', info: { name: 'Ann' } });
    expect(ch.members!.get('u_2')).toEqual({ id: 'u_2', info: { name: 'Bob' } });
    const err = once(rt, 'e2e:error');
    conn.send({ event: 'pusher_internal:member_added', channel: 'presence-room', data: JSON.stringify({ user_id: 'u_3', user_info: sealedBob }) });
    expect(await err).toMatchObject({ reason: 'bad_event', user_id: 'u_3' });
  });

  test('client events: plaintext, sealed with E2E keys, and refused when not allowed', async () => {
    const server = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: KEYS, fullE2E: true });
    const rt = make({ e2e: { module: e2eModule }, authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName) });
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('private-chat');
    await conn.next('pusher:subscribe');
    expect(ch.trigger('client-typing', { on: true })).toBe(false);
    conn.subscribed('private-chat');
    await once(ch, 'pusher:subscription_succeeded');
    expect(ch.trigger('client-typing', { on: true })).toBe(true);
    const f = await conn.next('client-hubfly.e2e');
    expect(f.channel).toBe('private-chat');
    expect(server.decrypt('private-chat', f.event, f.data)).toEqual({ event: 'client-typing', data: { on: true }, encrypted: true });

    const got = new Promise((r) => ch.bind('client-typing', (d, meta) => r([d, meta])));
    conn.send({ event: f.event, channel: 'private-chat', data: f.data, user_id: 'u_9' });
    expect(await got).toEqual([{ on: true }, { event: 'client-typing', channel: 'private-chat', id: undefined, user_id: 'u_9', kind: undefined, encrypted: true }]);
    expect(() => ch.trigger('typing', 1)).toThrow('client-');

    const plain = make({ authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName) });
    const { conn: c2 } = await connectHub(plain, SOCKET_B);
    const pch = plain.subscribe('private-chat');
    await c2.next('pusher:subscribe');
    c2.subscribed('private-chat');
    await once(pch, 'pusher:subscription_succeeded');
    pch.trigger('client-typing', { on: false });
    expect(await c2.next('client-typing')).toEqual({ event: 'client-typing', channel: 'private-chat', data: { on: false } });
    expect(() => plain.subscribe('private-encrypted-x').trigger('client-x', 1)).toThrow('need e2e');
  });

  test('encrypted channels: Pusher envelopes from the server SDK, rotation, errors', async () => {
    const oldKeys = `k1:${V.master_keys[0].key}`;
    const rotated = `k2:${V.master_keys[1].key},${oldKeys}`;
    const authServer = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: rotated });
    const rt = make({ e2e: { module: e2eModule }, authorizer: ({ socketId, channelName }) => authServer.authorizeChannel(socketId, channelName) });
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('private-encrypted-orders');
    expect((await conn.next('pusher:subscribe')).data.auth).toStartWith(`${KEY}:`);
    conn.subscribed('private-encrypted-orders');
    await once(ch, 'pusher:subscription_succeeded');
    const got: unknown[] = [];
    ch.bind('order.updated', (d, meta) => got.push([d, meta.encrypted]));
    for (const keys of [oldKeys, rotated]) {
      const { server, calls } = serverSdk({ encryptionKeys: keys });
      await server.trigger('private-encrypted-orders', 'order.updated', { keys });
      const body = calls[0].json;
      conn.event(body.name, body.data, { channel: 'private-encrypted-orders' });
    }
    await waitFor(() => got.length === 2);
    expect(got).toEqual([
      [{ keys: oldKeys }, true],
      [{ keys: rotated }, true],
    ]);
    const err = once(ch, 'e2e:error');
    conn.event('order.updated', { plaintext: true }, { channel: 'private-encrypted-orders' });
    expect(await err).toMatchObject({ reason: 'plaintext', channel: 'private-encrypted-orders' });
  });

  test('subscription_count, cache_miss, errors and unsubscribe', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('orders');
    await conn.next('pusher:subscribe');
    const count = once(ch, 'pusher:subscription_count');
    conn.send({ event: 'pusher_internal:subscription_count', channel: 'orders', data: JSON.stringify({ subscription_count: 3 }) });
    expect(await count).toEqual({ subscription_count: 3 });
    const miss = once(ch, 'pusher:cache_miss');
    conn.send({ event: 'pusher:cache_miss', channel: 'orders', data: '{}' });
    expect(await miss).toEqual({});
    const subErr = once(ch, 'pusher:subscription_error');
    conn.send({ event: 'pusher:subscription_error', channel: 'orders', data: { type: 'LimitReached', error: 'Too many', status: 429 } });
    expect(await subErr).toEqual({ type: 'LimitReached', error: 'Too many', status: 429 });
    expect(ch.subscribed).toBe(false);
    const err = once(rt, 'error');
    conn.send({ event: 'pusher:error', data: { code: 4301, message: 'Client event rejected due to rate limit' } });
    expect(await err).toEqual({ code: 4301, message: 'Client event rejected due to rate limit' });
    const got: unknown[] = [];
    ch.bind('x', (d) => got.push(d));
    ch.unsubscribe();
    expect((await conn.next('pusher:unsubscribe')).data).toEqual({ channel: 'orders' });
    conn.event('x', 1, { channel: 'orders' });
    await sleep(20);
    expect(got).toEqual([]);
  });

  test('data parsing: JSON strings, raw strings and objects', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    const got: unknown[] = [];
    rt.on('d', (d) => got.push(d));
    conn.send({ event: 'd', data: '{"a":1}' });
    conn.send({ event: 'd', data: 'plain text' });
    conn.send({ event: 'd', data: { b: 2 } });
    conn.send({ event: 'd', data: '"quoted"' });
    await waitFor(() => got.length === 4);
    expect(got).toEqual([{ a: 1 }, 'plain text', { b: 2 }, 'quoted']);
  });
});

describe('auth and sign-in', () => {
  test('auth requests are pusher-js compatible form posts with custom headers', async () => {
    const server = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET });
    const seen: Array<{ ct: string | null; body: string }> = [];
    const handler = server.authHandler({ getUser: (req) => (req.headers.get('authorization') === 'Bearer t1' ? { id: 'u_1' } : null) });
    const http = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        seen.push({ ct: req.headers.get('content-type'), body: await req.clone().text() });
        return handler(req);
      },
    });
    try {
      const endpoint = `http://127.0.0.1:${http.port}/api/realtime/auth`;
      const rt = make({ authEndpoint: endpoint, auth: { headers: async () => ({ Authorization: 'Bearer t1' }), params: { extra: '1' } } });
      const { conn } = await connectHub(rt);
      rt.subscribe('private-orders');
      expect((await conn.next('pusher:subscribe')).data.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET_A}:private-orders`)}`);
      expect(seen[0].ct).toBe('application/x-www-form-urlencoded');
      expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toEqual({ extra: '1', socket_id: SOCKET_A, channel_name: 'private-orders' });

      const denied = make({ authEndpoint: endpoint, auth: { headers: { Authorization: 'Bearer nope' } } });
      const { conn: c2 } = await connectHub(denied, SOCKET_B);
      const ch2 = denied.subscribe('private-orders');
      expect(await once(ch2, 'pusher:subscription_error')).toMatchObject({ type: 'AuthError', status: 403 });
      expect(c2.all('pusher:subscribe')).toEqual([]);
      const noEndpoint = make();
      const { conn: c3 } = await connectHub(noEndpoint, '3333333333.3333333333');
      expect((await once(noEndpoint.subscribe('private-x'), 'pusher:subscription_error')).error).toContain('authEndpoint');
      expect(c3.all('pusher:subscribe')).toEqual([]);
    } finally {
      http.stop(true);
    }
  });

  test('signin subscribes to the user channel; sealed user messages arrive on rt.on', async () => {
    const { server, calls } = serverSdk({ encryptionKeys: KEYS });
    const rt = make({
      e2e: { module: e2eModule },
      userAuthorizer: ({ socketId }) => server.authenticateUser(socketId, { id: 'u_42', user_info: { name: 'Ann' } }),
    });
    const { conn } = await connectHub(rt);
    const p = rt.signin();
    const si = await conn.next('pusher:signin');
    expect(si.data.user_data).toBe('{"id":"u_42","user_info":{"name":"Ann"}}');
    expect(si.data.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET_A}::user::${si.data.user_data}`)}`);
    conn.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si.data.user_data }) });
    expect(await p).toEqual({ id: 'u_42', info: { name: 'Ann' } });
    expect((await conn.next('pusher:subscribe')).data).toEqual({ channel: '#server-to-user-u_42' });
    conn.subscribed('#server-to-user-u_42');

    await server.toUser('u_42').send('notice', { text: 'Hi' }, { messageId: 'mu1' });
    const body = calls.at(-1)!.json;
    const got = new Promise<unknown[]>((r) => rt.on('notice', (d, meta) => r([d, meta])));
    conn.event(body.event, body.data, { channel: '#server-to-user-u_42', hubfly: { k: 'user', m: 'mu1', ack: true } });
    const [d, meta] = await got;
    expect(d).toEqual({ text: 'Hi' });
    expect(meta).toMatchObject({ kind: 'user', id: 'mu1', encrypted: true, channel: '#server-to-user-u_42' });
    expect((await conn.next('hubfly:ack')).data).toEqual({ m: ['mu1'] });
    expect(await rt.signin()).toEqual({ id: 'u_42', info: { name: 'Ann' } });
    expect(conn.all('pusher:signin').length).toBe(1);

    // A lost session signs in again on the new socket.
    conn.close(4200);
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    conn2.establish(SOCKET_B, { session_token: 't2', resumed: false });
    const si2 = await conn2.next('pusher:signin');
    expect(si2.data.auth).toBe(`${KEY}:${hmacHex(SECRET, `${SOCKET_B}::user::${si2.data.user_data}`)}`);
    conn2.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si2.data.user_data }) });
    expect((await conn2.next('pusher:subscribe')).data).toEqual({ channel: '#server-to-user-u_42' });
  });

  test('sealed sign-in user_info is opened with the sign-in keys; never exposed as ciphertext', async () => {
    const { server } = serverSdk({ encryptionKeys: KEYS, fullE2E: true });
    const user = { id: 'u_42', user_info: { name: 'Ann' } };
    const rt = make({ e2e: { module: e2eModule }, userAuthorizer: ({ socketId }) => server.authenticateUser(socketId, user) });
    const { conn } = await connectHub(rt);
    const p = rt.signin();
    const si = await conn.next('pusher:signin');
    expect(JSON.parse(si.data.user_data).user_info.v).toBe(1);
    conn.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si.data.user_data }) });
    expect(await p).toEqual({ id: 'u_42', info: { name: 'Ann' } });
    expect(rt.user).toEqual({ id: 'u_42', info: { name: 'Ann' } });

    // Without E2E the client cannot open it: e2e:error and no info.
    const rt2 = make({ userAuthorizer: ({ socketId }) => server.authenticateUser(socketId, user) });
    const { conn: c2 } = await connectHub(rt2);
    const err = once(rt2, 'e2e:error');
    const p2 = rt2.signin();
    const si2 = await c2.next('pusher:signin');
    c2.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si2.data.user_data }) });
    expect(await p2).toEqual({ id: 'u_42', info: undefined });
    expect(await err).toEqual({ reason: 'e2e_disabled', context: '#server-to-user-u_42', user_id: 'u_42' });

    // Sealed for another user's context (by the auth endpoint): refused.
    const forged = JSON.parse((await server.authenticateUser(SOCKET_A, { id: 'u_7', user_info: { name: 'Eve' } })).user_data).user_info;
    const rt3 = make({
      e2e: { module: e2eModule },
      userAuthorizer: async ({ socketId }) => ({ ...(await server.authenticateUser(socketId, user)), user_data: JSON.stringify({ id: 'u_42', user_info: forged }) }),
    });
    const { conn: c3 } = await connectHub(rt3);
    const err3 = once(rt3, 'e2e:error');
    const p3 = rt3.signin();
    const si3 = await c3.next('pusher:signin');
    c3.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si3.data.user_data }) });
    expect((await p3).info).toBeUndefined();
    expect(await err3).toMatchObject({ reason: 'decrypt_failed', user_id: 'u_42' });

    // The relay's echo of user_data is ignored (it could forge it, sealed or plaintext): the user
    // comes from our own auth response.
    const rt4 = make({ e2e: { module: e2eModule }, userAuthorizer: ({ socketId }) => server.authenticateUser(socketId, user) });
    const { conn: c4 } = await connectHub(rt4);
    const errs: unknown[] = [];
    rt4.on('e2e:error', (e) => errs.push(e));
    const p4 = rt4.signin();
    await c4.next('pusher:signin');
    for (const info of [forged, { name: 'Eve' }]) {
      c4.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: JSON.stringify({ id: 'u_7', user_info: info }) }) });
    }
    expect(await p4).toEqual({ id: 'u_42', info: { name: 'Ann' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(rt4.user).toEqual({ id: 'u_42', info: { name: 'Ann' } });
    expect(errs).toEqual([]);
  });

  test('a refused sign-in rejects and the 4009 close stops the client', async () => {
    const rt = make({ userAuthorizer: async () => ({ auth: `${KEY}:bad`, user_data: '{"id":"u_1"}' }) });
    const { conn } = await connectHub(rt);
    const p = rt.signin();
    await conn.next('pusher:signin');
    conn.send({ event: 'pusher:error', data: { code: 4009, message: 'Invalid signature' } });
    await expect(p).rejects.toThrow('Invalid signature');
    conn.close(4009);
    await once(rt, 'disconnected');
  });
});

describe('end-to-end encryption', () => {
  test('E2E connection id; direct messages are decrypted and acked', async () => {
    const rt = make({ e2e: { module: e2eModule } });
    const { conn, res } = await connectHub(rt);
    const [sid, k] = res.id.split('~');
    expect(sid).toBe(SOCKET_A);
    expect(fromBase64Url(k).length).toBe(32);
    expect(rt.socketId).toBe(SOCKET_A);

    const { server, calls } = serverSdk();
    const sent = await server.send(res.id, 'order.updated', { orderId: 'o_9' }, { ack: true, messageId: 'm_direct_1' });
    expect(sent.results[0]).toMatchObject({ id: res.id, status: 'delivered' });
    const body = calls[0].json;
    const got = new Promise<unknown[]>((r) => rt.on('order.updated', (d, meta) => r([d, meta])));
    conn.event(body.event, body.data, { hubfly: { k: 'direct', m: body.message_id, ack: body.ack } });
    const [d, meta] = await got;
    expect(d).toEqual({ orderId: 'o_9' });
    expect(meta).toEqual({ event: 'order.updated', channel: undefined, id: 'm_direct_1', user_id: undefined, kind: 'direct', encrypted: true });
    expect((await conn.next('hubfly:ack')).data).toEqual({ m: ['m_direct_1'] });
  });

  test('the connection key survives a resume and changes with a new session', async () => {
    const rt = make({ e2e: { module: e2eModule } });
    const { conn, res } = await connectHub(rt);
    conn.kill();
    const conn2 = await srv.nextConn();
    await conn2.next('hubfly:hello');
    conn2.establish(SOCKET_A, { session_token: 't2', resumed: true });
    await once(rt, 'connected');
    expect(rt.id).toBe(res.id);
    conn2.close(4200);
    const conn3 = await srv.nextConn();
    await conn3.next('hubfly:hello');
    const change = once(rt, 'id');
    conn3.establish(SOCKET_B, { session_token: 't3', resumed: false });
    const { id, previous } = await change;
    expect(previous).toBe(res.id);
    expect(id.startsWith(`${SOCKET_B}~`)).toBe(true);
    expect(id.split('~')[1]).not.toBe(res.id.split('~')[1]);
  });

  test('undecryptable messages emit e2e:error and are neither delivered nor acked', async () => {
    const rt = make({ e2e: { module: e2eModule } });
    const { conn } = await connectHub(rt);
    const errs: any[] = [];
    rt.on('e2e:error', (e) => errs.push(e));
    const delivered: unknown[] = [];
    rt.on('order.updated', (d) => delivered.push(d));
    const env = encryptV1(new Uint8Array(32), 'c', { e: 'order.updated', d: 1, to: `#direct-${SOCKET_A}`, m: 'mx', t: Date.now() });
    conn.event('hubfly.e2e', env, { hubfly: { k: 'direct', m: 'mx', ack: true } });
    conn.event('hubfly.e2e', '{"v":1}', { hubfly: { k: 'direct', m: 'my', ack: true } });
    await waitFor(() => errs.length === 2);
    expect(errs.map((e) => e.reason)).toEqual(['decrypt_failed', 'missing_members']);
    expect(errs[0]).toMatchObject({ context: `#direct-${SOCKET_A}`, event: 'hubfly.e2e' });
    await sleep(30);
    expect(delivered).toEqual([]);
    expect(conn.all('hubfly:ack')).toEqual([]);
  });

  test('without e2e, encrypted payloads are reported, not delivered', async () => {
    const rt = make();
    const { conn } = await connectHub(rt);
    const err = once(rt, 'e2e:error');
    conn.event('hubfly.e2e', V.v1[3].envelope, { hubfly: { k: 'direct', m: 'z' } });
    expect(await err).toMatchObject({ reason: 'e2e_disabled' });
  });

  test("e2e: true loads '@hubfly/realtime/e2e' lazily", async () => {
    const rt = make({ e2e: true });
    const { res } = await connectHub(rt);
    expect(res.id).toMatch(new RegExp(`^${SOCKET_A.replace('.', '\\.')}~[A-Za-z0-9_-]{43}$`));
  });

  test('key rotation: an unknown kid refreshes the channel keys once and the message is delivered', async () => {
    let keys = `k1:${V.master_keys[0].key}`;
    let auths = 0;
    const rt = make({
      e2e: { module: e2eModule },
      authorizer: ({ socketId, channelName }) => {
        auths++;
        return new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: keys, fullE2E: true }).authorizeChannel(
          socketId,
          channelName,
        );
      },
    });
    const { conn } = await connectHub(rt);
    const ch = rt.subscribe('private-chat');
    await conn.next('pusher:subscribe');
    conn.subscribed('private-chat');
    await once(ch, 'pusher:subscription_succeeded');
    expect(auths).toBe(1);

    keys = `k2:${V.master_keys[1].key},${keys}`; // the customer rotates
    const { server, calls } = serverSdk({ encryptionKeys: keys, fullE2E: true });
    const got: unknown[] = [];
    ch.bind('msg', (d) => got.push(d));
    await server.trigger('private-chat', 'msg', { n: 1 });
    await server.trigger('private-chat', 'msg', { n: 2 });
    for (const c of calls) conn.event(c.json.name, c.json.data, { channel: 'private-chat' });
    await waitFor(() => got.length === 2);
    expect(got).toEqual([{ n: 1 }, { n: 2 }]);
    expect(auths).toBe(2); // one refresh shared by both messages

    // A key the auth endpoint does not know either: one more retry within 30 s, then e2e:error.
    const stranger = serverSdk({ encryptionKeys: `k9:${Buffer.alloc(32, 9).toString('base64')}`, fullE2E: true });
    await stranger.server.trigger('private-chat', 'msg', { n: 3 });
    const err = once(ch, 'e2e:error');
    conn.event(stranger.calls[0].json.name, stranger.calls[0].json.data, { channel: 'private-chat' });
    expect((await err).reason).toBe('unknown_kid');
    expect(auths).toBe(2);

    // reauthorize() fetches fresh auth for every private/presence channel.
    await rt.reauthorize();
    expect(auths).toBe(3);
  });

  test('direct messages are never retried (no auth endpoint holds client keys)', async () => {
    let auths = 0;
    const rt = make({ e2e: { module: e2eModule }, authorizer: async () => (auths++, { auth: 'x' }) });
    const { conn } = await connectHub(rt);
    const err = once(rt, 'e2e:error');
    conn.event('hubfly.e2e', V.v1[3].envelope, { hubfly: { k: 'direct', m: 'q' } });
    expect((await err).reason).toBe('decrypt_failed');
    expect(auths).toBe(0);
  });
});

describe('plaintext in E2E contexts (security review H3)', () => {
  const fullServer = () => new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: KEYS, fullE2E: true });
  const collect = (target: { on(ev: string, h: (d: any, m?: any) => unknown): unknown }, ...events: string[]) => {
    const got: unknown[] = [];
    for (const ev of events) target.on(ev, (d, meta) => void got.push([ev, d, meta && meta.encrypted]));
    return got;
  };

  async function fullE2EChannel(o: Partial<RealtimeOptions> = {}, name = 'private-orders') {
    const server = fullServer();
    const rt = make({
      e2e: { module: e2eModule },
      authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName, { user_id: 'u_1', user_info: { name: 'Ann' } }),
      ...o,
    });
    const { conn, res } = await connectHub(rt);
    const ch = rt.subscribe(name);
    await conn.next('pusher:subscribe');
    return { rt, ch, conn, res, server };
  }

  test('PoC: a forged plaintext order.paid on a full-E2E private channel is dropped with e2e:error', async () => {
    const { rt, ch, conn } = await fullE2EChannel();
    conn.subscribed('private-orders');
    await once(ch, 'pusher:subscription_succeeded');
    const got = collect(ch, 'order.paid', 'created');
    const rtErrs = collect(rt, 'e2e:error');
    const err = once(ch, 'e2e:error');
    // What a compromised engine or HubProxy would inject.
    conn.send({ event: 'order.paid', channel: 'private-orders', data: '{"amount":0}' });
    expect(await err).toEqual({ reason: 'plaintext', context: 'private-orders', event: 'order.paid', channel: 'private-orders' });
    // A Pusher envelope (or a raw string) is not accepted either.
    const { server, calls } = serverSdk({ encryptionKeys: KEYS });
    await server.trigger('private-encrypted-x', 'order.paid', { amount: 0 });
    conn.event('order.paid', calls[0].json.data, { channel: 'private-orders' });
    conn.event('order.paid', 'just text', { channel: 'private-orders' });
    // Protocol events are unaffected, and sealed publishes still arrive.
    const count = once(ch, 'pusher:subscription_count');
    conn.send({ event: 'pusher:subscription_count', channel: 'private-orders', data: '{"subscription_count":3}' });
    expect(await count).toEqual({ subscription_count: 3 });
    const full = serverSdk({ encryptionKeys: KEYS, fullE2E: true });
    await full.server.trigger('private-orders', 'created', { n: 1 });
    conn.event(full.calls[0].json.name, full.calls[0].json.data, { channel: 'private-orders' });
    await waitFor(() => got.length === 1);
    expect(got).toEqual([['created', { n: 1 }, true]]);
    expect(rtErrs.map((e: any) => e[1].reason)).toEqual(['plaintext', 'wrong_envelope', 'plaintext']);
  });

  test('PoC: a plaintext direct message is dropped with e2e:error and not acked', async () => {
    const rt = make({ e2e: { module: e2eModule } });
    const { conn } = await connectHub(rt);
    const got = collect(rt, 'order.paid');
    const err = once(rt, 'e2e:error');
    conn.event('order.paid', { amount: 0 }, { hubfly: { k: 'direct', m: 'forged1', ack: true } });
    expect(await err).toEqual({ reason: 'plaintext', context: `#direct-${SOCKET_A}`, event: 'order.paid', channel: undefined });
    // The client does not ack it (a later real message is the first ack).
    const { server, calls } = serverSdk();
    await server.send(rt.id!, 'order.paid', { amount: 5 }, { ack: true, messageId: 'm_real' });
    conn.event(calls[0].json.event, calls[0].json.data, { hubfly: { k: 'direct', m: 'm_real', ack: true } });
    expect((await conn.next('hubfly:ack')).data).toEqual({ m: ['m_real'] });
    expect(got).toEqual([['order.paid', { amount: 5 }, true]]);
  });

  test('plaintext user messages are dropped when the sign-in gave keys', async () => {
    const { server, calls } = serverSdk({ encryptionKeys: KEYS });
    const rt = make({ e2e: { module: e2eModule }, userAuthorizer: ({ socketId }) => server.authenticateUser(socketId, { id: 'u_42' }) });
    const { conn } = await connectHub(rt);
    const p = rt.signin();
    const si = await conn.next('pusher:signin');
    conn.send({ event: 'pusher:signin_success', data: JSON.stringify({ user_data: si.data.user_data }) });
    await p;
    await conn.next('pusher:subscribe');
    conn.subscribed('#server-to-user-u_42');
    const got = collect(rt, 'notice');
    const err = once(rt, 'e2e:error');
    conn.event('notice', { text: 'forged' }, { channel: '#server-to-user-u_42', hubfly: { k: 'user', m: 'f1' } });
    expect(await err).toMatchObject({ reason: 'plaintext', context: '#server-to-user-u_42', event: 'notice' });
    await server.toUser('u_42').send('notice', { text: 'real' }, { messageId: 'mu1' });
    const body = calls.at(-1)!.json;
    conn.event(body.event, body.data, { channel: '#server-to-user-u_42', hubfly: { k: 'user', m: 'mu1' } });
    await waitFor(() => got.length === 1);
    expect(got).toEqual([['notice', { text: 'real' }, true]]);
  });

  test('plaintext presence user_info on a full-E2E channel counts as absent', async () => {
    const { rt, ch, conn } = await fullE2EChannel({}, 'presence-room');
    const errs = collect(rt, 'e2e:error');
    conn.subscribed('presence-room', { presence: { ids: ['u_1', 'u_2'], hash: { u_1: null, u_2: { name: 'Eve' } }, count: 2 } });
    await once(ch, 'pusher:subscription_succeeded');
    expect(ch.members!.me).toEqual({ id: 'u_1', info: { name: 'Ann' } }); // sealed by the auth endpoint
    expect(ch.members!.get('u_1')).toEqual({ id: 'u_1', info: null });
    expect(ch.members!.get('u_2')).toEqual({ id: 'u_2', info: undefined });
    const added = once(ch, 'pusher:member_added');
    conn.send({ event: 'pusher_internal:member_added', channel: 'presence-room', data: JSON.stringify({ user_id: 'u_3', user_info: 'Mallory' }) });
    expect(await added).toEqual({ id: 'u_3', info: undefined });
    expect(errs.map((e: any) => [e[1].reason, e[1].user_id, e[1].context])).toEqual([
      ['plaintext', 'u_2', 'presence-room'],
      ['plaintext', 'u_3', 'presence-room'],
    ]);
  });

  test('contexts without keys keep accepting plaintext (encrypted: false)', async () => {
    // Keys configured but no fullE2E: private channels get no keys, so they are not E2E contexts.
    const server = new RealtimeServer({ url: srv.url, appId: '1', key: KEY, secret: SECRET, encryptionKeys: KEYS });
    const rt = make({ e2e: { module: e2eModule }, authorizer: ({ socketId, channelName }) => server.authorizeChannel(socketId, channelName) });
    const { conn } = await connectHub(rt);
    const priv = rt.subscribe('private-orders');
    const pub = rt.subscribe('orders');
    await conn.next('pusher:subscribe');
    conn.subscribed('private-orders');
    conn.subscribed('orders');
    await once(priv, 'pusher:subscription_succeeded');
    const got = collect(priv, 'order.paid');
    pub.bind('order.paid', (d, meta) => void got.push(['public', d, meta.encrypted]));
    conn.event('order.paid', { a: 1 }, { channel: 'private-orders' });
    conn.event('order.paid', { a: 2 }, { channel: 'orders' });
    await waitFor(() => got.length === 2);
    expect(got).toEqual([
      ['order.paid', { a: 1 }, false],
      ['public', { a: 2 }, false],
    ]);
    // Without e2e nothing is an E2E context: plaintext direct messages arrive as before.
    const plain = make();
    const { conn: c2 } = await connectHub(plain, SOCKET_B);
    const d = new Promise((r) => plain.on('notice', (data, meta) => r([data, meta.encrypted])));
    c2.event('notice', { n: 1 }, { hubfly: { k: 'direct', m: 'p1' } });
    expect(await d).toEqual([{ n: 1 }, false]);
  });

  test('e2e.allowPlaintext restores plaintext delivery (encrypted: false); encrypted channels still refuse it', async () => {
    const { rt, ch, conn } = await fullE2EChannel({ e2e: { module: e2eModule, allowPlaintext: true } }, 'presence-room');
    const errs = collect(rt, 'e2e:error');
    conn.subscribed('presence-room', { presence: { ids: ['u_2'], hash: { u_2: { name: 'Bob' } }, count: 1 } });
    await once(ch, 'pusher:subscription_succeeded');
    expect(ch.members!.get('u_2')).toEqual({ id: 'u_2', info: { name: 'Bob' } });
    const got = collect(ch, 'order.paid', 'created');
    const direct = collect(rt, 'notice');
    conn.event('order.paid', { amount: 0 }, { channel: 'presence-room' });
    conn.event('notice', { n: 1 }, { hubfly: { k: 'direct', m: 'd1' } });
    const full = serverSdk({ encryptionKeys: KEYS, fullE2E: true });
    await full.server.trigger('presence-room', 'created', { n: 1 });
    conn.event(full.calls[0].json.name, full.calls[0].json.data, { channel: 'presence-room' });
    await waitFor(() => got.length === 2 && direct.length === 1);
    expect(got).toEqual([
      ['order.paid', { amount: 0 }, false],
      ['created', { n: 1 }, true],
    ]);
    expect(direct).toEqual([['notice', { n: 1 }, false]]);
    expect(errs).toEqual([]);

    const enc = rt.subscribe('private-encrypted-orders');
    await conn.next('pusher:subscribe');
    conn.subscribed('private-encrypted-orders');
    await once(enc, 'pusher:subscription_succeeded');
    const err = once(enc, 'e2e:error');
    conn.event('order.paid', { amount: 0 }, { channel: 'private-encrypted-orders' });
    expect(await err).toMatchObject({ reason: 'plaintext' });
  });
});

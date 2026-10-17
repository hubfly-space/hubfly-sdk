/**
 * Live tests against a running HubFly Realtime instance or `rt-devserver`
 * (hubfly-realtime/cmd/rt-devserver). Skipped unless these are set:
 *
 *   HUBFLY_REALTIME_TEST_URL      http://127.0.0.1:6001 (or https://<host>)
 *   HUBFLY_REALTIME_TEST_APP_ID   an app with client events on, history kept (memory or durable),
 *                                 the offline queue on and a detach TTL of at least 10 s
 *   HUBFLY_REALTIME_TEST_KEY      and the `optional` (or `off`) encryption policy
 *   HUBFLY_REALTIME_TEST_SECRET
 *
 * Optional, for the `required` encryption policy block (same instance):
 *
 *   HUBFLY_REALTIME_TEST_REQUIRED_APP_ID / _KEY / _SECRET   an app with `encryption: required`
 *                                                          and client events on
 *
 * Optional: HUBFLY_REALTIME_TEST_RESTART, a shell command that restarts the instance (SIGTERM,
 * same address and data directory) and returns once it is ready, for the planned-restart test.
 *
 * The apps must allow connections without an Origin header (empty `allowed_origins`). E2E
 * master keys are generated here; the instance never sees them. Run:
 *
 *   HUBFLY_REALTIME_TEST_URL=http://127.0.0.1:6001 HUBFLY_REALTIME_TEST_APP_ID=1000001 \
 *   HUBFLY_REALTIME_TEST_KEY=… HUBFLY_REALTIME_TEST_SECRET=… bun test test/live.test.ts
 *
 * Webhooks are not covered: the instance only delivers them to public https URLs.
 */
import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { Realtime, type RealtimeOptions } from '../src/index';
import * as e2eModule from '../src/e2e/index';
import { RealtimeApiError, RealtimeServer, type RealtimeServerOptions, type RealtimeUser } from '../src/server/index';
import { once, sleep } from './fake-server';

const env = process.env;
const URL_ = env.HUBFLY_REALTIME_TEST_URL ?? '';
const MAIN = { appId: env.HUBFLY_REALTIME_TEST_APP_ID ?? '', key: env.HUBFLY_REALTIME_TEST_KEY ?? '', secret: env.HUBFLY_REALTIME_TEST_SECRET ?? '' };
const REQUIRED = {
  appId: env.HUBFLY_REALTIME_TEST_REQUIRED_APP_ID ?? '',
  key: env.HUBFLY_REALTIME_TEST_REQUIRED_KEY ?? '',
  secret: env.HUBFLY_REALTIME_TEST_REQUIRED_SECRET ?? '',
};
const enabled = !!(URL_ && MAIN.appId && MAIN.key && MAIN.secret);
// Live round trips wait for throttled engine events (subscription counts: at most 1/s).
setDefaultTimeout(20_000);
const requiredEnabled = enabled && !!(REQUIRED.appId && REQUIRED.key && REQUIRED.secret);

type App = typeof MAIN;
const E2E_KEYS = `k1:${randomBytes(32).toString('base64')}`;
const run = Math.random().toString(36).slice(2, 8);
const clients: Realtime[] = [];
const stops: Array<() => void> = [];

function server(extra: Partial<RealtimeServerOptions> = {}, app: App = MAIN): RealtimeServer {
  return new RealtimeServer({ url: URL_, ...app, encryptionKeys: E2E_KEYS, ...extra });
}

/** A client that authorizes through `s` directly (as an auth endpoint would). */
function client(o: Partial<RealtimeOptions> = {}, user: RealtimeUser = { id: 'u_live', info: { name: 'Live' } }, s = server(), app: App = MAIN): Realtime {
  const rt = new Realtime({
    url: URL_,
    key: app.key,
    e2e: { module: e2eModule },
    authorizer: ({ socketId, channelName }) =>
      s.authorizeChannel(socketId, channelName, channelName.startsWith('presence-') ? { user_id: user.id, user_info: user.info } : undefined),
    userAuthorizer: ({ socketId }) => s.authenticateUser(socketId, { id: user.id, ...(user.info === undefined ? {} : { user_info: user.info }) }),
    backoff: { minMs: 50, maxMs: 500 },
    ...o,
  });
  clients.push(rt);
  return rt;
}

type EmitterLike = { on(e: string, f: (d: any, m?: any) => unknown): unknown; off(e: string, f: any): unknown };

/** Every emission of `event` (data and meta). */
function collect(target: EmitterLike, event: string): Array<{ data: any; meta: any }> {
  const out: Array<{ data: any; meta: any }> = [];
  target.on(event, (data, meta) => void out.push({ data, meta }));
  return out;
}

async function until(cond: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(10);
  }
}

async function subscribed(rt: Realtime, name: string) {
  const ch = rt.subscribe(name);
  if (!ch.subscribed) await once(ch, 'pusher:subscription_succeeded', 5000);
  return ch;
}

/** Waits until the engine reports `n` subscribers (fan-out to them is then guaranteed). */
async function subscribers(s: RealtimeServer, name: string, n: number) {
  await until(async () => (await s.channelInfo(name, { info: 'subscription_count' })).subscription_count === n, `${n} subscribers on ${name}`);
}

/**
 * A WebSocket proxy that serves only the Pusher path (`/app/{key}`) and answers 404 for
 * `/hubfly/v1/…`, like an older server or a proxy that does not know the HubFly path.
 */
function pusherOnlyProxy(target: string): { url: string; paths: string[] } {
  type D = { path: string; up?: WebSocket; queue: string[] };
  const paths: string[] = [];
  const passCode = (code: number) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);
  const srv = Bun.serve<D, never>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, s) {
      const u = new URL(req.url);
      paths.push(u.pathname);
      if (!u.pathname.startsWith('/app/')) return new Response('Not found', { status: 404 });
      return s.upgrade(req, { data: { path: u.pathname + u.search, queue: [] } }) ? undefined : new Response('Upgrade required', { status: 426 });
    },
    websocket: {
      open(ws) {
        const up = new WebSocket(target.replace(/^http/, 'ws') + ws.data.path);
        ws.data.up = up;
        up.onopen = () => {
          for (const m of ws.data.queue.splice(0)) up.send(m);
        };
        up.onmessage = (e) => ws.send(String(e.data));
        up.onclose = (e) => ws.close(passCode(e.code));
      },
      message(ws, msg) {
        const up = ws.data.up!;
        if (up.readyState === 1) up.send(String(msg));
        else ws.data.queue.push(String(msg));
      },
      close(ws, code) {
        ws.data.up?.close(passCode(code));
      },
    },
  });
  stops.push(() => srv.stop(true));
  return { url: `http://127.0.0.1:${srv.port}`, paths };
}

/**
 * A WebSocket whose connections fail while `open` is false (a network outage seen from the
 * client): attempts go to a closed port instead of the server.
 */
function gatedWebSocket() {
  const g = { open: true, urls: [] as string[], WS: undefined as unknown as NonNullable<RealtimeOptions['WebSocket']> };
  g.WS = class extends WebSocket {
    constructor(url: string | URL) {
      g.urls.push(String(url));
      super(g.open ? url : 'ws://127.0.0.1:9/');
    }
  } as unknown as NonNullable<RealtimeOptions['WebSocket']>;
  return g;
}

afterEach(() => {
  for (const rt of clients.splice(0)) rt.disconnect();
});

afterAll(() => {
  for (const stop of stops.splice(0)) stop();
});

describe.skipIf(!enabled)('live: connection', () => {
  test('connect resolves with the socket id over the HubFly socket; status endpoints see it', async () => {
    const rt = client({ e2e: false });
    const connected = once(rt, 'connected', 5000);
    const { id, socketId } = await rt.connect();
    expect(id).toMatch(/^[1-9]\d{9}\.[1-9]\d{9}$/);
    expect(id).toBe(socketId);
    expect(rt.hubfly).toBe(true);
    expect(rt.state).toBe('connected');
    expect(await connected).toEqual({ id, resumed: false });
    const s = server();
    expect(await s.connectionStatus(id)).toMatchObject({ socket_id: id, online: true, state: 'connected', protocol: 'hubfly' });
    expect(await s.isOnline('1000000001.1000000001')).toBe(false);
  });

  test('with E2E the connection id is <socket_id>~<key>; direct messages are sealed and acknowledged', async () => {
    const rt = client();
    const { id, socketId } = await rt.connect();
    expect(id).toMatch(/^[1-9]\d{9}\.[1-9]\d{9}~[A-Za-z0-9_-]{43}$/);
    expect(id.split('~')[0]).toBe(socketId);
    const s = server();
    const got = collect(rt, 'order.updated');
    const sent = await s.send(id, 'order.updated', { orderId: `o_${run}`, note: 'café ✓' }, { ack: true });
    expect(sent.results).toEqual([{ id, socket_id: socketId, status: 'delivered', message_id: sent.message_id }]);
    await until(() => got.length === 1, 'the direct message');
    expect(got[0].data).toEqual({ orderId: `o_${run}`, note: 'café ✓' });
    expect(got[0].meta).toMatchObject({ event: 'order.updated', kind: 'direct', encrypted: true, id: sent.message_id });
    // The engine only saw the envelope; the client acknowledged after its handler ran.
    await until(async () => (await s.messageReceipt(sent.message_id))?.targets[0].status === 'acked', 'the ack');
    const receipt = await s.messageReceipt(sent.message_id);
    expect(receipt).toMatchObject({ message_id: sent.message_id, event: 'hubfly.e2e', targets: [{ socket_id: socketId, status: 'acked' }] });
  });

  test('acks are sent after async handlers settle', async () => {
    const rt = client({ e2e: false });
    const { id } = await rt.connect();
    let release!: () => void;
    const handled = new Promise<void>((r) => (release = r));
    rt.on('job.done', () => handled);
    const s = server();
    const sent = await s.send(id, 'job.done', { ok: true }, { ack: true });
    await sleep(300);
    expect((await s.messageReceipt(sent.message_id))!.targets[0].status).toBe('delivered');
    release();
    await until(async () => (await s.messageReceipt(sent.message_id))!.targets[0].status === 'acked', 'the ack');
    // Without ack: true the receipt stays delivered.
    const quiet = await s.send(id, 'job.done', { ok: true });
    await sleep(200);
    expect((await s.messageReceipt(quiet.message_id))!.targets[0].status).toBe('delivered');
  });

  test('sends to a missing connection report offline; plaintext and E2E ids can be mixed', async () => {
    const a = client({ e2e: false });
    const b = client();
    const [{ id: ida }, { id: idb }] = await Promise.all([a.connect(), b.connect()]);
    const gotA = collect(a, 'ping');
    const gotB = collect(b, 'ping');
    const res = await server().send([ida, idb, '1000000001.1000000001'], 'ping', { n: 1 });
    const byId = Object.fromEntries(res.results.map((r) => [r.id, r.status]));
    expect(byId).toEqual({ [ida]: 'delivered', [idb]: 'delivered', '1000000001.1000000001': 'offline' });
    await until(() => gotA.length === 1 && gotB.length === 1, 'both deliveries');
    expect(gotA[0].meta).toMatchObject({ kind: 'direct', encrypted: false });
    expect(gotB[0].meta).toMatchObject({ kind: 'direct', encrypted: true });
  });

  test('a server "disconnect" (4200) resumes the session: same id, hubfly:resumed, channel replay without gaps', async () => {
    const rt = client({ e2e: false });
    const { id: first } = await rt.connect();
    const name = `live-reconnect-${run}`;
    const ch = await subscribed(rt, name);
    const s = server();
    await subscribers(s, name, 1);
    const ticks = collect(ch, 'tick');
    const subs = collect(ch, 'pusher:subscription_succeeded');
    await s.channel(name).publish('tick', { n: 1 });
    await until(() => ticks.length === 1, 'tick 1');
    const reconnecting = once(rt, 'reconnecting', 5000);
    const connected = once(rt, 'connected', 5000);
    const resumed = once(rt, 'resumed', 5000);
    const recovery = once(ch, 'recovery', 5000);
    await s.terminate(first, { mode: 'disconnect' });
    await s.channel(name).publish('tick', { n: 2 });
    await s.channel(name).publish('tick', { n: 3 });
    expect(await reconnecting).toMatchObject({ code: 4200, delay: 0 });
    expect(await connected).toEqual({ id: first, resumed: true });
    expect(rt.id).toBe(first);
    expect(await resumed).toMatchObject({ channels: { [name]: { status: 'recovered' } }, messages: { dropped: 0 } });
    expect((await recovery).status).toBe('recovered');
    await until(() => ticks.length >= 3, 'ticks 2 and 3');
    await sleep(200);
    expect(ticks.map((t) => t.data.n)).toEqual([1, 2, 3]);
    // A resumed session keeps its subscriptions: nothing was resubscribed.
    expect(subs.length).toBe(0);
  });

  test('sends while the session is detached are buffered and delivered on resume (sealed, acknowledged)', async () => {
    const user = { id: `u_buf_${run}`, info: { name: 'Buffered' } };
    const gate = gatedWebSocket();
    const rt = client({ WebSocket: gate.WS }, user);
    const { id } = await rt.connect();
    await rt.signin();
    const name = `live-buffered-${run}`;
    const ch = await subscribed(rt, name);
    const s = server();
    await subscribers(s, name, 1);
    const direct = collect(rt, 'dm');
    const notes = collect(rt, 'note');
    const ticks = collect(ch, 'tick');
    // The network goes away: the server detaches the session, every reconnect attempt fails.
    gate.open = false;
    await s.terminate(id, { mode: 'disconnect' });
    await until(async () => (await s.connectionStatus(id)).state === 'detached', 'the detached session');
    expect(await s.connectionStatus(id)).toMatchObject({ online: false, state: 'detached', expires_at: expect.any(String) });
    const dm = await s.send(id, 'dm', { n: 1 }, { ack: true });
    const note = await s.toUser(user.id).send('note', { n: 2 }, { ack: true });
    expect(dm.results.map((r) => r.status)).toEqual(['buffered']);
    expect(note.results.map((r) => r.status)).toEqual(['buffered']);
    await s.channel(name).publish('tick', { n: 3 });
    expect((await s.messageReceipt(dm.message_id))!.targets[0].status).toBe('buffered');
    await sleep(300);
    expect(rt.state).toBe('reconnecting');
    // The network comes back: the client resumes the HubFly session (not the Pusher fallback).
    const connected = once(rt, 'connected', 10_000);
    const resumed = once(rt, 'resumed', 10_000);
    gate.open = true;
    expect(await connected).toEqual({ id, resumed: true });
    expect(rt.hubfly).toBe(true);
    expect(await resumed).toMatchObject({ messages: { replayed: 2, dropped: 0 }, channels: { [name]: { status: 'recovered' } } });
    await until(() => direct.length === 1 && notes.length === 1 && ticks.length === 1, 'the buffered messages');
    expect(direct[0]).toMatchObject({ data: { n: 1 }, meta: { kind: 'direct', encrypted: true, id: dm.message_id } });
    expect(notes[0]).toMatchObject({ data: { n: 2 }, meta: { kind: 'user', encrypted: true, id: note.message_id } });
    expect(ticks[0].data).toEqual({ n: 3 });
    await until(async () => (await s.messageReceipt(dm.message_id))!.targets[0].status === 'acked', 'the direct ack');
    await until(async () => (await s.messageReceipt(note.message_id))!.targets[0].status === 'acked', 'the user ack');
    // Every attempt went to the HubFly path (no Pusher fallback while the session was resumable).
    expect(gate.urls.length).toBeGreaterThan(2);
    expect(gate.urls.every((u) => new URL(u).pathname.startsWith('/hubfly/v1/app/'))).toBe(true);
    // The sign-in survived: user messages still arrive without a new sign-in.
    await s.toUser(user.id).send('note', { n: 4 });
    await until(() => notes.length === 2, 'a live user message');
  });

  test('a session that ended while detached cannot be resumed: new id, channels recovered with since', async () => {
    const gate = gatedWebSocket();
    const rt = client({ e2e: false, WebSocket: gate.WS });
    const { id: first } = await rt.connect();
    const name = `live-newsession-${run}`;
    const ch = await subscribed(rt, name);
    const s = server();
    await subscribers(s, name, 1);
    const ticks = collect(ch, 'tick');
    await s.channel(name).publish('tick', { n: 1 });
    await until(() => ticks.length === 1, 'tick 1');
    gate.open = false;
    await s.terminate(first, { mode: 'disconnect' });
    await until(async () => (await s.connectionStatus(first)).state === 'detached', 'the detached session');
    await s.channel(name).publish('tick', { n: 2 });
    // The detached session ends (like an expired detach TTL).
    await s.terminate(first);
    await until(async () => (await s.connectionStatus(first)).state === undefined, 'the ended session');
    const connected = once(rt, 'connected', 10_000);
    const idChange = once(rt, 'id', 10_000);
    const recovery = once(ch, 'recovery', 10_000);
    gate.open = true;
    const c = await connected;
    expect(c.resumed).toBe(false);
    expect(c.id).not.toBe(first);
    expect(await idChange).toEqual({ id: c.id, previous: first });
    expect(await recovery).toMatchObject({ status: 'recovered', replayed: 1 });
    await until(() => ticks.length === 2, 'tick 2');
    expect(ticks.map((t) => t.data.n)).toEqual([1, 2]);
  });

  test('a clean disconnect ends the session; connect() gets a new id and recovers missed messages', async () => {
    const rt = client({ e2e: false });
    const { id: first } = await rt.connect();
    const name = `live-recovery-${run}`;
    const ch = await subscribed(rt, name);
    const s = server();
    const ticks = collect(ch, 'tick');
    await s.channel(name).publish('tick', { n: 1 });
    await until(() => ticks.length === 1, 'tick 1');
    rt.disconnect();
    expect(rt.state).toBe('disconnected');
    await s.channel(name).publish('tick', { n: 2 });
    await s.channel(name).publish('tick', { n: 3 });
    const idChange = once(rt, 'id', 5000);
    const recovery = once(ch, 'recovery', 5000);
    const { id } = await rt.connect();
    expect(id).not.toBe(first);
    expect(await idChange).toEqual({ id, previous: first });
    expect(await recovery).toMatchObject({ status: 'recovered', replayed: 2 });
    await until(() => ticks.length === 3, 'the replay');
    await sleep(100);
    expect(ticks.map((t) => [t.data.n, t.meta.id])).toEqual([
      [1, expect.stringMatching(/^m_/)],
      [2, expect.stringMatching(/^m_/)],
      [3, expect.stringMatching(/^m_/)],
    ]);
  });

  test('recovery from an unknown epoch fails and tells the application to refetch', async () => {
    const name = `live-epoch-${run}`;
    await server().channel(name).publish('x', 0);
    const rt = client({ e2e: false });
    const ch = rt.subscribe(name); // subscribed on connect, with this (stale) position
    ch.pos = { epoch: 'gone00', offset: 5 };
    const failed = once(ch, 'recovery:failed', 5000);
    const recovery = once(ch, 'recovery', 5000);
    await rt.connect();
    expect(await recovery).toMatchObject({ status: 'failed', reason: 'epoch_changed', epoch: expect.any(String) });
    expect((await failed).reason).toBe('epoch_changed');
    // The channel continues from the head.
    const got = collect(ch, 'x');
    await server().channel(name).publish('x', 1);
    await until(() => got.length === 1, 'the live message');
  });

  test('falls back to the Pusher socket when the HubFly path is unavailable', async () => {
    const proxy = pusherOnlyProxy(URL_);
    const rt = client({ url: proxy.url, e2e: false });
    const { id } = await rt.connect();
    expect(rt.hubfly).toBe(false);
    expect(proxy.paths.some((p) => p.startsWith('/hubfly/v1/app/'))).toBe(true);
    expect(proxy.paths.at(-1)).toBe(`/app/${MAIN.key}`);
    const s = server();
    expect((await s.connectionStatus(id)).protocol).toBe('pusher');
    const ch = await subscribed(rt, `private-fallback-${run}`);
    const events = collect(ch, 'created');
    await s.channel(ch.name).publish('created', { ok: 1 });
    const direct = collect(rt, 'hello');
    await s.send(id, 'hello', 'there', { ack: true });
    await until(() => events.length === 1 && direct.length === 1, 'channel and direct messages');
    // The Pusher socket carries no HubFly metadata (ids, kinds, offsets).
    expect(events[0].data).toEqual({ ok: 1 });
    expect(events[0].meta.id).toBeUndefined();
    expect(direct[0].data).toBe('there');
    expect(direct[0].meta.kind).toBeUndefined();
  });

  test('transport: "pusher" works with E2E direct messages and encrypted channels', async () => {
    const rt = client({ transport: 'pusher' });
    const { id } = await rt.connect();
    expect(rt.hubfly).toBe(false);
    expect(id).toContain('~');
    const s = server();
    const direct = collect(rt, 'secret');
    await s.send(id, 'secret', { pin: 1234 });
    const ch = await subscribed(rt, `private-encrypted-pusher-${run}`);
    const events = collect(ch, 'created');
    await s.channel(ch.name).publish('created', { n: 1 });
    await until(() => direct.length === 1 && events.length === 1, 'both messages');
    expect(direct[0]).toMatchObject({ data: { pin: 1234 }, meta: { encrypted: true } });
    expect(events[0]).toMatchObject({ data: { n: 1 }, meta: { encrypted: true } });
  });
});

describe.skipIf(!enabled)('live: channels', () => {
  test('publish with a message id is idempotent and returns the channel offsets', async () => {
    const rt = client({ e2e: false });
    await rt.connect();
    const name = `live-idem-${run}`;
    const ch = await subscribed(rt, name);
    const got = collect(ch, 'created');
    const s = server();
    const messageId = `order-${run}-1`;
    const first = await s.channel(name).publish('created', { id: 1 }, { messageId });
    expect(first).toEqual({ message_id: messageId, channels: { [name]: { epoch: expect.any(String), offset: expect.any(Number) } } });
    const again = await s.publish(name, 'created', { id: 1 }, { messageId });
    expect(again).toEqual(first);
    const other = await s.publish(name, 'created', { id: 2 });
    expect(other.message_id).toMatch(/^m_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((other.channels[name] as { offset: number }).offset).toBe((first.channels[name] as { offset: number }).offset + 1);
    await until(() => got.length === 2, 'two deliveries');
    await sleep(200);
    expect(got.map((g) => [g.data.id, g.meta.id])).toEqual([
      [1, messageId],
      [2, other.message_id],
    ]);
  });

  test('history returns decoded data with offsets; since and limit page through it', async () => {
    const s = server();
    const name = `live-history-${run}`;
    const pub = [];
    for (const d of [{ n: 1 }, 'two', 3]) pub.push(await s.channel(name).publish('step', d));
    const h = await s.channel(name).history();
    const head = (pub[2].channels[name] as { offset: number }).offset;
    expect(h).toMatchObject({ channel: name, head, truncated: false, gap: false });
    expect(h.messages.map((m) => [m.offset, m.event, m.data, m.message_id])).toEqual([
      [head - 2, 'step', { n: 1 }, pub[0].message_id],
      [head - 1, 'step', 'two', pub[1].message_id],
      [head, 'step', 3, pub[2].message_id],
    ]);
    const later = await s.history(name, { since: head - 2, epoch: h.epoch!, limit: 1 });
    expect(later.messages.map((m) => m.offset)).toEqual([head - 1]);
    const raw = await s.history(name, { raw: true });
    expect(raw.messages[0].data).toBe('{"n":1}');
    // Channels without messages answer without an epoch.
    expect(await s.history(`live-empty-${run}`)).toMatchObject({ epoch: null, head: null, messages: [] });
  });

  test('Pusher REST: trigger excludes a socket, channel info, users and subscription counts', async () => {
    const a = client({ e2e: false }, { id: 'u_a', info: { name: 'A' } });
    const b = client({ e2e: false }, { id: 'u_b', info: { name: 'B' } });
    const [{ id: ida }] = await Promise.all([a.connect(), b.connect()]);
    const name = `live-rest-${run}`;
    const ca = await subscribed(a, name);
    const counts = collect(ca, 'pusher:subscription_count');
    const cb = await subscribed(b, name);
    const s = server();
    await subscribers(s, name, 2);
    const gotA = collect(ca, 'plain');
    const gotB = collect(cb, 'plain');
    const res = await s.trigger(name, 'plain', { ok: true }, { socketId: ida, info: ['subscription_count'] });
    expect(res).toEqual({ channels: { [name]: { subscription_count: 2 } } });
    await until(() => gotB.length === 1, 'the trigger');
    await sleep(200);
    expect(gotA.length).toBe(0);
    expect(gotB[0].data).toEqual({ ok: true });
    await until(() => counts.some((c) => c.data.subscription_count === 2), 'the subscription_count event');

    const presence = `presence-rest-${run}`;
    await subscribed(a, presence);
    expect(await s.channelInfo(presence, { info: ['user_count', 'subscription_count'] })).toEqual({ occupied: true, user_count: 1, subscription_count: 1 });
    expect(await s.channelUsers(presence)).toEqual({ users: [{ id: 'u_a' }] });
    const list = await s.channels({ prefix: 'presence-rest-', info: 'user_count' });
    expect(list.channels[presence]).toEqual({ user_count: 1 });
    // A trigger to several channels and a batch.
    const multi = collect(cb, 'multi');
    const b1 = collect(cb, 'b1');
    const b2 = collect(cb, 'b2');
    expect(await s.trigger([name, `${name}-2`], 'multi', 1)).toEqual({});
    expect(await s.triggerBatch([{ channel: name, name: 'b1', data: 1 }, { channel: name, name: 'b2', data: 'x' }])).toEqual({});
    await until(() => multi.length === 1 && b1.length === 1 && b2.length === 1, 'the multi-channel and batch events');
    expect([multi[0].data, b1[0].data, b2[0].data]).toEqual([1, 1, 'x']);
  });

  test('presence members, me, member events and sealed client events', async () => {
    // fullE2E: the auth endpoint hands out the channel keys (and seals user_info).
    const s = server({ fullE2E: true });
    const a = client({}, { id: 'u_a', info: { name: 'Ann' } }, s);
    const b = client({}, { id: 'u_b', info: { name: 'Bob' } }, s);
    await Promise.all([a.connect(), b.connect()]);
    const name = `presence-live-${run}`;
    const ca = await subscribed(a, name);
    expect(ca.members!.count).toBe(1);
    expect(ca.members!.me).toEqual({ id: 'u_a', info: { name: 'Ann' } });
    const joined = once(ca, 'pusher:member_added', 5000);
    const cb = await subscribed(b, name);
    expect(await joined).toEqual({ id: 'u_b', info: { name: 'Bob' } });
    expect(cb.members!.count).toBe(2);
    expect(cb.members!.get('u_a')).toEqual({ id: 'u_a', info: { name: 'Ann' } });
    const ids: string[] = [];
    cb.members!.each((m) => ids.push(m.id));
    expect(ids.sort()).toEqual(['u_a', 'u_b']);

    // With E2E keys from the auth endpoint, client events are sealed (v1 envelope).
    const typing = collect(ca, 'client-typing');
    const echo = collect(cb, 'client-typing');
    expect(cb.trigger('client-typing', { on: true })).toBe(true);
    await until(() => typing.length === 1, 'the client event');
    expect(typing[0]).toEqual({ data: { on: true }, meta: expect.objectContaining({ user_id: 'u_b', encrypted: true, channel: name }) });
    await sleep(100);
    expect(echo.length).toBe(0); // not echoed to the sender
    // The engine stored and relayed only the envelope (history keeps client events).
    const raw = await server().history(name, { raw: true });
    expect(raw.messages.at(-1)).toMatchObject({ event: 'client-hubfly.e2e', user_id: 'u_b' });
    expect((await server().history(name)).messages.at(-1)).toMatchObject({ event: 'client-typing', data: { on: true }, encrypted: true });

    const left = once(ca, 'pusher:member_removed', 5000);
    b.unsubscribe(name);
    expect(await left).toEqual({ id: 'u_b', info: { name: 'Bob' } });
    expect(ca.members!.count).toBe(1);
  });

  test('plaintext client events on private channels without E2E', async () => {
    const s = server({ encryptionKeys: undefined });
    const a = client({ e2e: false }, undefined, s);
    const b = client({ e2e: false }, undefined, s);
    await Promise.all([a.connect(), b.connect()]);
    const name = `private-chat-${run}`;
    const ca = await subscribed(a, name);
    const cb = await subscribed(b, name);
    await subscribers(s, name, 2);
    const got = collect(cb, 'client-msg');
    expect(ca.trigger('client-msg', { text: 'hi' })).toBe(true);
    await until(() => got.length === 1, 'the client event');
    expect(got[0]).toMatchObject({ data: { text: 'hi' }, meta: { encrypted: false } });
    expect(() => ca.trigger('msg', 1)).toThrow('client-');
  });

  test('encrypted channels: Pusher envelopes, sealed client events, history and key refresh', async () => {
    const a = client();
    const b = client();
    await Promise.all([a.connect(), b.connect()]);
    const name = `private-encrypted-live-${run}`;
    const ca = await subscribed(a, name);
    const cb = await subscribed(b, name);
    const s = server();
    await subscribers(s, name, 2);
    const got = collect(ca, 'created');
    const res = await s.channel(name).publish('created', { n: 1, note: 'café ✓' });
    await until(() => got.length === 1, 'the encrypted publish');
    expect(got[0]).toMatchObject({ data: { n: 1, note: 'café ✓' }, meta: { encrypted: true, id: res.message_id } });
    const typing = collect(ca, 'client-typing');
    expect(cb.trigger('client-typing', { on: 1 })).toBe(true);
    await until(() => typing.length === 1, 'the sealed client event');
    expect(typing[0]).toMatchObject({ data: { on: 1 }, meta: { encrypted: true } });
    // History holds ciphertext; the server SDK opens it with the master keys.
    const raw = await s.history(name, { raw: true });
    expect(JSON.parse(raw.messages[0].data as string)).toEqual({ nonce: expect.any(String), ciphertext: expect.any(String) });
    const h = await s.history(name);
    expect(h.messages[0]).toMatchObject({ event: 'created', data: { n: 1, note: 'café ✓' }, encrypted: true });
  });

  test('key rotation: a message under a new key makes the client re-authorize once and read it', async () => {
    let auth = server({ fullE2E: true }); // what the customer's auth endpoint signs with
    const rt = client({ authorizer: ({ socketId, channelName }) => auth.authorizeChannel(socketId, channelName) });
    await rt.connect();
    const enc = await subscribed(rt, `private-encrypted-rot-${run}`);
    const full = await subscribed(rt, `private-rot-${run}`);
    const got = collect(enc, 'created');
    const gotFull = collect(full, 'created');
    const errors = collect(rt, 'e2e:error');
    // Step 1 of E2E.md "Rotation": the new key goes first on every server, the old one after it.
    auth = server({ encryptionKeys: `k2:${randomBytes(32).toString('base64')},${E2E_KEYS}`, fullE2E: true });
    await auth.channel(enc.name).publish('created', { n: 1 }); // Pusher envelope under K(channel, k2)
    await auth.channel(full.name).publish('created', { n: 2 }); // v1 envelope, kid k2
    await until(() => got.length === 1 && gotFull.length === 1, 'both messages after the key refresh');
    expect([got[0].data, gotFull[0].data]).toEqual([{ n: 1 }, { n: 2 }]);
    expect(errors).toEqual([]);
    // Old messages (kid k1) stay readable after the refresh: the client now holds both keys.
    await server({ fullE2E: true }).channel(full.name).publish('created', { n: 3 });
    await until(() => gotFull.length === 2, 'the k1 message');
    expect(gotFull[1].data).toEqual({ n: 3 });
  });

  test('full E2E (fullE2E) hides event names on private channels and seals presence user_info', async () => {
    const s = server({ fullE2E: true });
    const a = client({}, { id: 'u_a', info: { name: 'Ann' } }, s);
    const b = client({}, { id: 'u_b', info: { name: 'Bob' } }, s);
    await Promise.all([a.connect(), b.connect()]);
    const name = `presence-full-${run}`;
    const ca = await subscribed(a, name);
    const joined = once(ca, 'pusher:member_added', 5000);
    await subscribed(b, name);
    expect(await joined).toEqual({ id: 'u_b', info: { name: 'Bob' } });
    // The engine only has the sealed user_info.
    const auth = await s.authorizeChannel(b.socketId!, name, { user_id: 'u_b', user_info: { name: 'Bob' } });
    expect(JSON.parse(auth.channel_data!).user_info).toMatchObject({ v: 1, kid: 'k1' });
    const got = collect(ca, 'order.updated');
    await s.channel(name).publish('order.updated', { id: 7 });
    await until(() => got.length === 1, 'the sealed publish');
    expect(got[0]).toMatchObject({ data: { id: 7 }, meta: { encrypted: true } });
    const raw = await s.history(name, { raw: true });
    expect(raw.messages.at(-1)!.event).toBe('hubfly.e2e');
    expect((await s.history(name)).messages.at(-1)).toMatchObject({ event: 'order.updated', data: { id: 7 }, encrypted: true });
  });
});

describe.skipIf(!enabled)('live: users', () => {
  test('signin, then toUser().send reaches every connection of the user (sealed, acknowledged)', async () => {
    const s = server();
    const a1 = client({}, { id: `u_${run}` }, s);
    const a2 = client({ e2e: false }, { id: `u_${run}` }, server({ encryptionKeys: undefined }));
    await Promise.all([a1.connect(), a2.connect()]);
    expect(await a1.signin()).toEqual({ id: `u_${run}`, info: undefined });
    await a2.signin();
    expect(a1.user).toEqual({ id: `u_${run}`, info: undefined });
    await until(async () => (await s.toUser(`u_${run}`).status()).connections === 2, 'both connections signed in');
    const st = await s.userStatus(`u_${run}`);
    expect(st.socket_ids!.sort()).toEqual([a1.socketId!, a2.socketId!].sort());
    expect((await s.connectionStatus(a1.id!)).user_id).toBe(`u_${run}`);

    // With keys the user message is sealed under K(#server-to-user-<id>): a2 has no E2E and reports it.
    const got1 = collect(a1, 'notice');
    const errors2 = collect(a2, 'e2e:error');
    const res = await s.toUser(`u_${run}`).send('notice', { text: 'Hi' }, { ack: true });
    expect(res.results).toEqual([{ id: `u_${run}`, user_id: `u_${run}`, status: 'delivered', connections: 2, message_id: res.message_id }]);
    await until(() => got1.length === 1 && errors2.length === 1, 'the user message');
    expect(got1[0]).toMatchObject({ data: { text: 'Hi' }, meta: { kind: 'user', encrypted: true, id: res.message_id, channel: `#server-to-user-u_${run}` } });
    expect(errors2[0].data).toEqual({ reason: 'e2e_disabled', context: `#server-to-user-u_${run}`, event: 'hubfly.e2e', channel: `#server-to-user-u_${run}` });
    await until(async () => (await s.messageReceipt(res.message_id))!.targets.some((t) => t.status === 'acked'), 'the ack');
    const receipt = await s.messageReceipt(res.message_id);
    expect(receipt!.targets.find((t) => t.socket_id === a1.socketId)).toMatchObject({ user_id: `u_${run}`, status: 'acked' });
    expect(receipt!.targets.find((t) => t.socket_id === a2.socketId)).toMatchObject({ status: 'delivered' });

    // Plaintext (encrypt: false) reaches a2; a1 got keys at sign-in, so it accepts only sealed
    // user messages and reports it (security review H3).
    const got2 = collect(a2, 'plain');
    const errors1 = collect(a1, 'e2e:error');
    await s.toUser(`u_${run}`).send('plain', { x: 1 }, { encrypt: false });
    await until(() => got2.length === 1 && errors1.length === 1, 'the plaintext user message');
    expect(got2[0].meta).toMatchObject({ kind: 'user', encrypted: false });
    expect(errors1[0].data).toMatchObject({ reason: 'plaintext', context: `#server-to-user-u_${run}`, event: 'plain' });
    // Offline users.
    const off = await s.sendToUsers([`u_${run}`, `u_nobody_${run}`], 'n', 1, { encrypt: false });
    expect(off.results.map((r) => [r.id, r.status])).toEqual([
      [`u_${run}`, 'delivered'],
      [`u_nobody_${run}`, expect.stringMatching(/^(offline|queued)$/)],
    ]);
    expect(await s.toUser(`u_nobody_${run}`).isOnline()).toBe(false);
  });

  test('terminateUserConnections and terminate close with 4009; the client stops', async () => {
    const s = server();
    const a = client({ e2e: false }, { id: `u_t_${run}` }, s);
    const b = client({ e2e: false }, { id: `u_t2_${run}` }, s);
    await Promise.all([a.connect(), b.connect()]);
    await a.signin();
    const stopped = once(a, 'disconnected', 5000);
    await s.toUser(`u_t_${run}`).terminate();
    expect((await stopped) as { code: number }).toMatchObject({ code: 4009 });
    expect(a.state).toBe('disconnected');
    const stoppedB = once(b, 'disconnected', 5000);
    expect(await s.connection(b.id!).terminate()).toEqual({ terminated: true });
    expect((await stoppedB) as { code: number }).toMatchObject({ code: 4009 });
    await sleep(300);
    expect(b.state).toBe('disconnected');
    await expect(s.terminate(b.id!)).rejects.toMatchObject({ status: 404 });
  });

  test('an HTTP auth endpoint (authHandler) authorizes channels and sign-in, form-encoded like pusher-js', async () => {
    const s = server({ encryptionKeys: undefined });
    const users: Record<string, RealtimeUser> = { t_ann: { id: `u_http_${run}`, info: { name: 'Ann' } } };
    const handler = s.authHandler({
      getUser: (req) => users[req.headers.get('authorization')?.replace('Bearer ', '') ?? ''] ?? null,
      canAccess: (user, channel) => !!user && !channel.includes('-admin-'),
    });
    const seen: string[] = [];
    const http = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        seen.push(`${req.headers.get('content-type')} ${await req.clone().text()}`);
        return handler(req);
      },
    });
    stops.push(() => http.stop(true));
    const endpoint = `http://127.0.0.1:${http.port}/api/realtime/auth`;
    const rt = new Realtime({ url: URL_, key: MAIN.key, authEndpoint: endpoint, userAuthEndpoint: endpoint, auth: { headers: () => ({ authorization: 'Bearer t_ann' }) } });
    clients.push(rt);
    await rt.connect();
    const ch = await subscribed(rt, `presence-http-${run}`);
    expect(ch.members!.me).toEqual({ id: `u_http_${run}`, info: { name: 'Ann' } });
    expect(seen[0]).toBe(`application/x-www-form-urlencoded socket_id=${encodeURIComponent(rt.socketId!)}&channel_name=presence-http-${run}`);
    const denied = rt.subscribe(`private-admin-${run}`);
    expect(await once(denied, 'pusher:subscription_error', 5000)).toMatchObject({ status: 403 });
    expect(denied.subscribed).toBe(false);
    expect(await rt.signin()).toEqual({ id: `u_http_${run}`, info: { name: 'Ann' } });
    const got = collect(rt, 'hello');
    await s.toUser(`u_http_${run}`).send('hello', { to: 'Ann' });
    await until(() => got.length === 1, 'the user message');
    // Anonymous requests are refused.
    const anon = new Realtime({ url: URL_, key: MAIN.key, authEndpoint: endpoint });
    clients.push(anon);
    await anon.connect();
    const refused = anon.subscribe(`private-x-${run}`);
    expect(await once(refused, 'pusher:subscription_error', 5000)).toMatchObject({ status: 403 });
  });

  test('pusher-js (with-encryption) reads what RealtimeServer publishes through the engine', async () => {
    const mod = await import('pusher-js/dist/worker/pusher-with-encryption.worker.js' as string);
    const PusherJS = mod.default?.default ?? mod.default ?? mod;
    const s = server();
    const u = new URL(URL_);
    const pusher = new PusherJS(MAIN.key, {
      wsHost: u.hostname,
      wsPort: Number(u.port || 80),
      forceTLS: false,
      enabledTransports: ['ws'],
      cluster: 'hubfly',
      disableStats: true,
      channelAuthorization: {
        customHandler: (p: { socketId: string; channelName: string }, cb: (e: unknown, a: unknown) => void) =>
          s.authorizeChannel(p.socketId, p.channelName, { user_id: 'u_pjs' }).then((a) => cb(null, a), (e) => cb(e, null)),
      },
    });
    try {
      const got: unknown[] = [];
      const sub = (name: string) =>
        new Promise<any>((resolve) => {
          const c = pusher.subscribe(name);
          c.bind('pusher:subscription_succeeded', () => resolve(c));
        });
      const enc = await sub(`private-encrypted-pjs-${run}`);
      const pub = await sub(`pjs-${run}`);
      enc.bind('created', (d: unknown) => got.push(['enc', d]));
      pub.bind('created', (d: unknown) => got.push(['pub', d]));
      await subscribers(s, `pjs-${run}`, 1);
      await s.channel(`private-encrypted-pjs-${run}`).publish('created', { n: 1, note: 'café ✓' });
      await s.channel(`pjs-${run}`).trigger('created', { n: 2 });
      await until(() => got.length === 2, 'pusher-js deliveries');
      expect(got).toContainEqual(['enc', { n: 1, note: 'café ✓' }]);
      expect(got).toContainEqual(['pub', { n: 2 }]);
    } finally {
      pusher.disconnect();
    }
  });

  test('the offline queue keeps user messages (queued) and delivers them after sign-in', async () => {
    const s = server();
    const uid = `u_queue_${run}`;
    const q1 = await s.toUser(uid).send('queued.note', { n: 1 }, { ack: true });
    const q2 = await s.toUser(uid).send('queued.note', { n: 2 }, { ack: true });
    expect(q1.results).toEqual([{ id: uid, user_id: uid, status: 'queued', connections: 0, message_id: q1.message_id }]);
    expect(q2.results[0].status).toBe('queued');
    expect((await s.messageReceipt(q1.message_id))!.targets[0]).toMatchObject({ status: 'queued' });
    const rt = client({}, { id: uid });
    const got = collect(rt, 'queued.note');
    await rt.connect();
    await rt.signin();
    await until(() => got.length === 2, 'the queued messages');
    expect(got.map((g) => [g.data.n, g.meta.id, g.meta.kind, g.meta.encrypted])).toEqual([
      [1, q1.message_id, 'user', true],
      [2, q2.message_id, 'user', true],
    ]);
    await until(async () => (await s.messageReceipt(q2.message_id))!.targets.every((t) => t.status === 'acked'), 'the acks');
  });
});

describe.skipIf(!requiredEnabled)('live: encryption policy "required"', () => {
  const s = () => server({ fullE2E: true }, REQUIRED);

  test('SDK envelopes pass the engine shape checks; plaintext is refused with e2e_required', async () => {
    const srv = s();
    const a = client({}, { id: 'u_req', info: { name: 'Sealed' } }, srv, REQUIRED);
    const b = client({}, { id: 'u_req2', info: { name: 'Sealed 2' } }, srv, REQUIRED);
    const [{ id }] = await Promise.all([a.connect(), b.connect()]);
    // Direct message to the E2E connection id (v1, kid c).
    const direct = collect(a, 'd');
    expect((await srv.send(id, 'd', { ok: 1 })).results[0].status).toBe('delivered');
    // User message (v1 under the user key); sign-in user_info is sealed and opened by the client.
    expect(await a.signin()).toEqual({ id: 'u_req', info: { name: 'Sealed' } });
    const user = collect(a, 'u');
    expect((await srv.toUser('u_req').send('u', { ok: 2 })).results[0].status).toBe('delivered');
    // Encrypted channel (Pusher envelope), full-E2E private channel (v1), sealed presence user_info.
    const enc = await subscribed(a, `private-encrypted-req-${run}`);
    const priv = await subscribed(a, `private-req-${run}`);
    const pres = await subscribed(a, `presence-req-${run}`);
    const joined = once(pres, 'pusher:member_added', 5000);
    const presB = await subscribed(b, `presence-req-${run}`);
    expect(await joined).toEqual({ id: 'u_req2', info: { name: 'Sealed 2' } });
    const got = collect(enc, 'e');
    const gotPriv = collect(priv, 'p');
    await srv.channel(enc.name).publish('e', { ok: 3 });
    await srv.channel(priv.name).trigger('p', { ok: 4 });
    // Sealed client events are accepted.
    const typing = collect(pres, 'client-typing');
    expect(presB.trigger('client-typing', { ok: 5 })).toBe(true);
    await until(() => direct.length + user.length + got.length + gotPriv.length + typing.length === 5, 'all sealed deliveries');
    expect([direct[0].data, user[0].data, got[0].data, gotPriv[0].data, typing[0].data]).toEqual([{ ok: 1 }, { ok: 2 }, { ok: 3 }, { ok: 4 }, { ok: 5 }]);

    // Plaintext is refused.
    const plain = server({ encryptionKeys: undefined }, REQUIRED);
    for (const call of [
      () => plain.publish(`req-${run}`, 'x', 1),
      () => plain.trigger(`req-${run}`, 'x', 1),
      () => plain.send(a.socketId!, 'x', 1),
      () => plain.toUser('u_req').send('x', 1),
    ]) {
      const err = (await call().then(
        () => null,
        (e) => e,
      )) as RealtimeApiError;
      expect(err).toBeInstanceOf(RealtimeApiError);
      expect(err).toMatchObject({ status: 403, reason: 'e2e_required' });
    }
    // A public channel publish with encrypt: true is a v1 envelope and accepted.
    expect((await srv.publish(`req-${run}`, 'x', 1, { encrypt: true })).message_id).toMatch(/^m_/);
  });

  test('sign-in user_info: sealed is accepted and opened, absent is accepted, plaintext is refused (4009)', async () => {
    const sealed = client({}, { id: 'u_si', info: { name: 'Sealed' } }, s(), REQUIRED);
    await sealed.connect();
    expect(await sealed.signin()).toEqual({ id: 'u_si', info: { name: 'Sealed' } });
    const plain = server({ encryptionKeys: undefined }, REQUIRED);
    const absent = client({ e2e: false }, { id: 'u_si2' }, plain, REQUIRED);
    await absent.connect();
    expect(await absent.signin()).toEqual({ id: 'u_si2', info: undefined });
    const refused = client({ e2e: false }, { id: 'u_si3', info: { name: 'Plain' } }, plain, REQUIRED);
    await refused.connect();
    const disconnected = once(refused, 'disconnected', 5000);
    const err = (await refused.signin().then(
      () => null,
      (e) => e,
    )) as { code?: number; message?: string } | null;
    expect(err).toMatchObject({ code: 4009, message: expect.stringMatching(/user_info/) });
    await disconnected;
    expect(refused.state).toBe('disconnected');
    expect(refused.user).toBeNull();
  });

  test('plaintext client events and plaintext presence user_info are refused', async () => {
    const plain = server({ encryptionKeys: undefined }, REQUIRED);
    const a = client({ e2e: false }, { id: 'u_p', info: { name: 'Plain' } }, plain, REQUIRED);
    await a.connect();
    const denied = a.subscribe(`presence-req-plain-${run}`);
    expect(await once(denied, 'pusher:subscription_error', 5000)).toMatchObject({ status: 403 });
    const priv = await subscribed(a, `private-req-plain-${run}`);
    const errors = collect(a, 'error');
    expect(priv.trigger('client-x', { a: 1 })).toBe(true);
    await until(() => errors.length === 1, 'the pusher:error');
    expect(errors[0].data).toMatchObject({ message: expect.stringMatching(/e2e|encrypt/i) });
  });
});

// Planned restart (SIGTERM drain) of the server: needs HUBFLY_REALTIME_TEST_RESTART, a command that
// restarts the instance on the same address with the same data directory and returns once it is
// ready (e.g. rt-devserver -data-dir … restarted with SIGTERM). Runs last.
const RESTART = env.HUBFLY_REALTIME_TEST_RESTART ?? '';

describe.skipIf(!enabled || !RESTART)('live: planned restart', () => {
  test('sessions, sign-ins, receipts and offline queues survive a planned restart', async () => {
    const s = server();
    const uid = `u_restart_${run}`;
    const rt = client({}, { id: uid });
    const { id } = await rt.connect();
    await rt.signin();
    const name = `live-restart-${run}`;
    const ch = await subscribed(rt, name);
    await subscribers(s, name, 1);
    const dms = collect(rt, 'dm');
    const acked = await s.send(id, 'dm', { n: 1 }, { ack: true });
    await until(async () => (await s.messageReceipt(acked.message_id))!.targets[0].status === 'acked', 'the ack');
    const quid = `u_restart_q_${run}`;
    const queued = await s.toUser(quid).send('later', { n: 2 });
    expect(queued.results[0].status).toBe('queued');

    const reconnect = once(rt, 'reconnecting', 10_000);
    const connected = once(rt, 'connected', 20_000);
    const resumed = once(rt, 'resumed', 20_000);
    const proc = Bun.spawn(['sh', '-c', RESTART], { stdout: 'ignore', stderr: 'inherit' });
    // The draining server asks the client to reconnect (hubfly:reconnect → 4200).
    expect((await reconnect).code).toBe(4200);
    expect(await proc.exited).toBe(0);
    expect(await connected).toEqual({ id, resumed: true });
    await resumed;
    expect(rt.hubfly).toBe(true);

    // Receipts and the offline queue were persisted.
    expect((await s.messageReceipt(acked.message_id))!.targets[0].status).toBe('acked');
    expect((await s.messageReceipt(queued.message_id))!.targets[0].status).toBe('queued');
    const later = client({}, { id: quid });
    const got = collect(later, 'later');
    await later.connect();
    await later.signin();
    await until(() => got.length === 1, 'the queued message after the restart');
    expect(got[0]).toMatchObject({ data: { n: 2 }, meta: { id: queued.message_id, kind: 'user' } });

    // The restored session still has its sign-in and subscription.
    const notes = collect(rt, 'note');
    await s.toUser(uid).send('note', { n: 3 });
    await until(() => notes.length === 1, 'a user message on the restored session');
    const ticks = collect(ch, 'tick');
    await subscribers(s, name, 1);
    await s.channel(name).publish('tick', { n: 4 });
    await until(() => ticks.length === 1, 'a channel message on the restored session');
    expect(dms.length).toBe(1);
  });
});

describe.skipIf(!enabled)('live: plaintext in E2E contexts (security review H3)', () => {
  test('plaintext on a full-E2E channel and plaintext direct messages are dropped; allowPlaintext delivers them', async () => {
    const s = server({ fullE2E: true });
    const injector = server({ encryptionKeys: undefined }); // stands in for a relay that injects plaintext
    const strict = client({}, undefined, s);
    const lax = client({ e2e: { module: e2eModule, allowPlaintext: true } }, undefined, s);
    await Promise.all([strict.connect(), lax.connect()]);
    const name = `private-h3-${run}`;
    const cs = await subscribed(strict, name);
    const cl = await subscribed(lax, name);
    await subscribers(s, name, 2);
    const strictGot = collect(cs, 'order.paid');
    const laxGot = collect(cl, 'order.paid');
    const strictErrors = collect(strict, 'e2e:error');
    const laxErrors = collect(lax, 'e2e:error');

    await injector.trigger(name, 'order.paid', { amount: 0 });
    await s.channel(name).publish('order.paid', { amount: 10 }); // the real, sealed one
    await until(() => laxGot.length === 2 && strictGot.length === 1 && strictErrors.length === 1, 'the channel events');
    expect(strictGot.map((g) => [g.data, g.meta.encrypted])).toEqual([[{ amount: 10 }, true]]);
    expect(strictErrors[0].data).toEqual({ reason: 'plaintext', context: name, event: 'order.paid', channel: name });
    expect(laxGot.map((g) => [g.data, g.meta.encrypted])).toEqual([
      [{ amount: 0 }, false],
      [{ amount: 10 }, true],
    ]);

    const strictDm = collect(strict, 'order.paid');
    const laxDm = collect(lax, 'order.paid');
    await injector.send([strict.id!, lax.id!], 'order.paid', { amount: 0 }, { encrypt: false });
    await s.send(strict.id!, 'order.paid', { amount: 20 });
    await until(() => laxDm.length === 1 && strictDm.length === 1 && strictErrors.length === 2, 'the direct messages');
    expect(strictDm.map((g) => [g.data, g.meta.encrypted])).toEqual([[{ amount: 20 }, true]]);
    expect(strictErrors[1].data).toEqual({ reason: 'plaintext', context: `#direct-${strict.socketId}`, event: 'order.paid' });
    expect(laxDm.map((g) => [g.data, g.meta.kind, g.meta.encrypted])).toEqual([[{ amount: 0 }, 'direct', false]]);
    expect(laxErrors).toEqual([]);

    // The server SDK flags the injected event in history the same way.
    const h = (await s.history(name)).messages.filter((m) => m.event === 'order.paid' || m.event === 'hubfly.e2e');
    expect(h.map((m) => m.e2e_error ?? m.data)).toEqual(['plaintext', { amount: 10 }]);
  });
});

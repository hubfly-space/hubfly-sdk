import { afterEach, describe, expect, it } from 'bun:test';
import type { Server, ServerWebSocket } from 'bun';
import { HubflyClient, RealtimeInspectorError, describeInspectorClose } from '../src/index.js';
import type { InspectorEvent } from '../src/index.js';

// In-process fake of the engine's inspector socket (WIRE.md "Inspector").
interface FakeInspector {
  server: Server;
  origins: string[];
  urls: string[];
  frames: Array<Record<string, unknown>>;
  sockets: Array<ServerWebSocket<unknown>>;
}

const TOKEN = 'eyJhbGciOiJFZERTQSJ9.eyJhdWQiOiJpbnNwZWN0In0.c2ln';
let fake: FakeInspector | undefined;

function startFakeInspector(onAuth: (ws: ServerWebSocket<unknown>, token: unknown) => void): FakeInspector {
  const state: Omit<FakeInspector, 'server'> = { origins: [], urls: [], frames: [], sockets: [] };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, srv) {
      state.origins.push(request.headers.get('origin') ?? '');
      state.urls.push(request.url);
      if (srv.upgrade(request)) return undefined;
      return new Response('expected a WebSocket', { status: 400 });
    },
    websocket: {
      open(ws) {
        state.sockets.push(ws);
      },
      message(ws, message) {
        const frame = JSON.parse(String(message)) as Record<string, unknown>;
        state.frames.push(frame);
        if (frame.type === 'auth') onAuth(ws, frame.token);
        else if (frame.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      },
    },
  });
  fake = { server, ...state };
  return fake;
}

afterEach(() => {
  fake?.server.stop(true);
  fake = undefined;
});

function clientFor(inspector: FakeInspector) {
  const tokenRequests: unknown[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    tokenRequests.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    const data = {
      token: TOKEN,
      url: `ws://127.0.0.1:${inspector.server.port}/hubfly/v1/inspect`,
      expiresAt: '2026-10-17T10:00:00.000Z',
      origin: 'https://api.example.test',
      apps: ['1000001'],
      payloadPreview: false,
    };
    return new Response(JSON.stringify({ ok: true, data, meta: { requestId: 'r', timestamp: 't' } }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { client: new HubflyClient({ token: 't', baseUrl: 'https://api.example.test', fetch: fetchImpl }), tokenRequests };
}

function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('inspector socket', () => {
  it('authenticates with the first frame, filters and streams events', async () => {
    const inspector = startFakeInspector((ws, token) => {
      if (token !== TOKEN) return ws.close(4401, 'bad token');
      ws.send(JSON.stringify({ type: 'ready', session_id: 'is_1', apps: ['1000001'], expires_at: '2026-10-17T11:00:00Z', sampling: 1 }));
    });
    const { client, tokenRequests } = clientFor(inspector);
    const events: InspectorEvent[] = [];
    const sampling: number[] = [];
    const dropped: number[] = [];
    const session = await client.managed.realtime.openInspector('proj_1', 'inst_1', {
      apps: ['1000001'],
      filter: { apps: ['1000001'], families: ['msg'], channelPrefix: 'orders' },
      onEvent: (event) => events.push(event),
      onSampling: (rate) => sampling.push(rate),
      onDropped: (count) => dropped.push(count),
      keepAliveMs: 0,
    });
    expect(session.ready).toEqual({ sessionId: 'is_1', apps: ['1000001'], expiresAt: '2026-10-17T11:00:00Z', sampling: 1 });
    expect(tokenRequests).toEqual([{ apps: ['1000001'] }]);
    // The token travels in the first frame only, never in the URL; the Origin is the token's.
    expect(inspector.urls[0]).not.toContain(TOKEN);
    expect(inspector.origins[0]).toBe('https://api.example.test');
    await waitFor(() => inspector.frames.length >= 2);
    expect(inspector.frames[0]).toEqual({ type: 'auth', token: TOKEN });
    expect(inspector.frames[1]).toEqual({ type: 'filter', apps: ['1000001'], families: ['msg'], channel_prefix: 'orders' });

    const ws = inspector.sockets[0];
    ws.send(JSON.stringify({ type: 'event', seq: 42, t: 1760600000000, app_id: '1000001', family: 'msg', kind: 'msg.publish', channels: ['orders'], event: 'order.updated', size: 120, recipients: 4, source: 'api', encrypted: false }));
    ws.send(JSON.stringify({ type: 'sampling', rate: 0.25 }));
    ws.send(JSON.stringify({ type: 'dropped', count: 120 }));
    await waitFor(() => dropped.length === 1);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('msg.publish');
    expect(events[0].recipients).toBe(4);
    expect(sampling).toEqual([0.25]);

    session.setFilter({});
    session.ping();
    await waitFor(() => inspector.frames.length >= 4);
    expect(inspector.frames[2]).toEqual({ type: 'filter' });
    expect(inspector.frames[3]).toEqual({ type: 'ping' });

    session.close();
    const closed = await session.closed;
    expect(closed.code).toBe(1000);
  });

  it('rejects with the close code when the server refuses the session', async () => {
    const inspector = startFakeInspector((ws) => ws.close(4401, 'invalid token'));
    const { client } = clientFor(inspector);
    const error = await client.managed.realtime.openInspector('proj_1', 'inst_1', { keepAliveMs: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RealtimeInspectorError);
    expect((error as RealtimeInspectorError).closeCode).toBe(4401);
    expect((error as RealtimeInspectorError).message).toContain('inspector token');
  });

  it('reports server-side closes after ready (expiry, draining)', async () => {
    const inspector = startFakeInspector((ws) => {
      ws.send(JSON.stringify({ type: 'ready', session_id: 'is_2', apps: ['*'], expires_at: 'x', sampling: 1 }));
      setTimeout(() => ws.close(4000, 'expired'), 10);
    });
    const { client } = clientFor(inspector);
    const closes: number[] = [];
    const session = await client.managed.realtime.openInspector('proj_1', 'inst_1', { keepAliveMs: 0, onClose: (info) => closes.push(info.code) });
    const info = await session.closed;
    expect(info.code).toBe(4000);
    expect(info.message).toContain('expired');
    expect(closes).toEqual([4000]);
  });
});

describe('describeInspectorClose', () => {
  it('tells callers not to reconnect after being replaced (4409)', () => {
    const info = describeInspectorClose(4409);
    expect(info.code).toBe(4409);
    expect(info.message).toContain('do not reconnect');
  });
});

/**
 * `client.managed.realtime.openInspector` against the REAL inspector socket of
 * hubfly-realtime's rt-devserver; only the Dashboard's token endpoint is faked.
 * Tokens are minted the way the Dashboard does (engine/src/core/managed/
 * realtime/inspector.ts): EdDSA over the same header and claim order, with the
 * public key in the engine's config.sync payload. Skipped unless
 * HUBFLY_REALTIME_DEVSERVER names an rt-devserver binary:
 *
 *   (cd hubfly-realtime && go build -o /tmp/rt-devserver ./cmd/rt-devserver)
 *   HUBFLY_REALTIME_DEVSERVER=/tmp/rt-devserver bun test test/managed-inspector-live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { HubflyClient, RealtimeInspectorError } from '../src/index.js';
import type { InspectorEvent, InspectorSession } from '../src/index.js';

const DEVSERVER = process.env.HUBFLY_REALTIME_DEVSERVER ?? '';
const ORIGIN = 'https://api.hubfly.test';
const INSTANCE = 'msi_sdk';
const KID = 'ik_sdk';
const APP_ID = '1000001';

type Claims = {
  iss: string;
  aud: string;
  sub: string;
  scp: string[];
  apps: string[];
  pv: boolean;
  orn: string;
  iat: number;
  exp: number;
  jti: string;
};

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

class Engine {
  ws = '';
  admin = '';
  private proc?: Subprocess<'pipe', 'ignore', 'inherit'>;
  private dir = '';
  private keys!: CryptoKeyPair;

  async init(): Promise<void> {
    this.dir = mkdtempSync(join(tmpdir(), 'rt-sdk-inspector-'));
    this.keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', this.keys.publicKey));
    writeFileSync(
      join(this.dir, 'config.json'),
      JSON.stringify({
        generation: 1,
        instance: { hostnames: [] },
        inspector: { public_keys: [{ kid: KID, key: b64url(publicKey) }], origins: [ORIGIN] },
        apps: [
          {
            app_id: APP_ID,
            name: 'production',
            enabled: true,
            settings: { inspector_payload_preview: true },
            keys: [{ key: 'sdkinspectorkey00001', secret: 'sdk-inspector-secret-0123456789', status: 'active', expires_at: null }],
            webhooks: [],
          },
        ],
      }),
    );
    await this.start('127.0.0.1:0');
  }

  /** Starts rt-devserver (port 0 first, then the same address). */
  async start(listen: string): Promise<void> {
    const ready = join(this.dir, 'ready.json');
    rmSync(ready, { force: true });
    this.proc = Bun.spawn(
      [DEVSERVER, '-config', join(this.dir, 'config.json'), '-listen', listen, '-admin', '127.0.0.1:0', '-instance-id', INSTANCE,
        '-cpu', '2', '-memory-mib', '4096', '-drain-budget', '1s', '-ready-file', ready, '-exit-with-stdin', '-log-level', 'warn'],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' },
    );
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        const text = readFileSync(ready, 'utf8');
        if (text.endsWith('\n')) {
          const line = JSON.parse(text) as { listeners: string[]; admin: string };
          this.ws = line.listeners[0] ?? '';
          this.admin = line.admin;
          return;
        }
      } catch {
        // not written yet
      }
      if (Date.now() > deadline) throw new Error('rt-devserver did not become ready');
      await Bun.sleep(20);
    }
  }

  /** SIGTERM: drains (inspector sessions close with 4000) and exits. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill('SIGTERM');
    await this.proc.exited;
    this.proc = undefined;
  }

  async dispose(): Promise<void> {
    await this.stop();
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }

  /** A token as mintRealtimeInspectorToken signs it (header and claim order). */
  async mint(edit: (claims: Claims) => void = () => {}): Promise<{ token: string; claims: Claims }> {
    const now = Math.floor(Date.now() / 1000);
    const jti = Buffer.from(crypto.getRandomValues(new Uint8Array(10))).toString('hex');
    const claims: Claims = { iss: 'hubfly', aud: INSTANCE, sub: 'usr_sdk', scp: ['inspect'], apps: ['*'], pv: false, orn: ORIGIN, iat: now, exp: now + 60, jti: `it_${jti}` };
    edit(claims);
    const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
    const input = `${encode({ alg: 'EdDSA', typ: 'JWT', kid: KID })}.${encode(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', this.keys.privateKey, new TextEncoder().encode(input)));
    return { token: `${input}.${b64url(signature)}`, claims };
  }

  async ctl(cmd: string, args: unknown): Promise<unknown> {
    const response = await fetch(`http://${this.admin}/ctl`, { method: 'POST', body: JSON.stringify({ v: 1, id: 'sdk', cmd, args }) });
    const reply = (await response.json()) as { ok: boolean; result?: unknown };
    if (!reply.ok) throw new Error(`ctl ${cmd}: ${JSON.stringify(reply)}`);
    return reply.result;
  }

  publish(channel: string, event: string, data: string): Promise<unknown> {
    return this.ctl('publish', { app_id: APP_ID, event, data, channels: [channel], socket_ids: null, user_id: null });
  }

  /** Offers ~n inspector events within a second (above the 500/s cap). */
  async burst(channel: string, n: number): Promise<void> {
    const worker = async () => {
      for (let i = 0; i < n / 8; i++) await this.publish(channel, 'burst', 'x').catch(() => undefined);
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }
}

/** A HubflyClient whose Dashboard token endpoint mints real engine tokens. */
function clientFor(engine: Engine, edit?: (claims: Claims) => void) {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
    requests.push(body);
    const { token, claims } = await engine.mint((c) => {
      c.pv = body.payloadPreview === true;
      if (Array.isArray(body.apps) && body.apps.length > 0) c.apps = body.apps.map(String);
      edit?.(c);
    });
    const data = {
      token,
      url: `ws://${engine.ws}/hubfly/v1/inspect`,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      origin: claims.orn,
      apps: claims.apps,
      payloadPreview: claims.pv,
    };
    return new Response(JSON.stringify({ ok: true, data, meta: { requestId: 'r', timestamp: 't' } }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { client: new HubflyClient({ token: 't', baseUrl: ORIGIN, fetch: fetchImpl }), requests };
}

async function waitFor(check: () => boolean, ms = 5000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

describe.skipIf(!DEVSERVER)('inspector socket (real engine)', () => {
  const engine = new Engine();
  beforeAll(() => engine.init());
  afterAll(() => engine.dispose());

  it('first-frame auth, filter, events with previews, sampling and dropped frames', async () => {
    const { client, requests } = clientFor(engine);
    const events: InspectorEvent[] = [];
    const sampling: number[] = [];
    const dropped: number[] = [];
    const session = await client.managed.realtime.openInspector('prj_1', INSTANCE, {
      apps: [APP_ID],
      payloadPreview: true,
      filter: { families: ['msg'], channelPrefix: 'orders' },
      onEvent: (event) => events.push(event),
      onSampling: (rate) => sampling.push(rate),
      onDropped: (count) => dropped.push(count),
      keepAliveMs: 0,
    });
    expect(requests).toEqual([{ apps: [APP_ID], payloadPreview: true }]);
    expect(session.ready.sessionId).toMatch(/^is_/);
    expect(session.ready.apps).toEqual([APP_ID]);
    expect(session.ready.sampling).toBe(1);
    expect(Date.parse(session.ready.expiresAt)).toBeGreaterThan(Date.now());
    // The filter frame follows `ready`; give the engine a moment to apply it.
    await Bun.sleep(50);
    await engine.publish('orders-1', 'first', '{"n":1}');
    await engine.publish('misc', 'filtered-out', '{"n":2}');
    await engine.publish('orders-2', 'second', '{"n":3}');
    await waitFor(() => events.some((event) => event.event === 'second'), 5000, 'events');
    expect(events.map((event) => event.event)).toEqual(['first', 'second']);
    expect(events[0]).toMatchObject({
      type: 'event',
      app_id: APP_ID,
      family: 'msg',
      kind: 'msg.publish',
      channels: ['orders-1'],
      event: 'first',
      source: 'console',
      encrypted: false,
      preview: '{"n":1}',
    });
    expect(typeof events[0]?.seq).toBe('number');
    expect(typeof events[0]?.t).toBe('number');

    await engine.burst('orders-burst', 2400);
    // The engine announces sampling on the first event of the next window
    // (if it comes within 2 s); tick until both frames have arrived.
    for (let i = 0; i < 50 && !(dropped.length > 0 && sampling.some((rate) => rate < 1)); i++) {
      await engine.publish('orders-tick', 'tick', '{}');
      await Bun.sleep(150);
    }
    expect(dropped.every((count) => Number.isInteger(count) && count > 0)).toBe(true);
    expect(sampling.every((rate) => rate > 0 && rate <= 1)).toBe(true);
    expect(sampling.some((rate) => rate < 1)).toBe(true);
    // After an idle window the engine announces rate 1 again.
    await Bun.sleep(2100);
    await engine.publish('orders-4', 'idle-again', '{}');
    await waitFor(() => sampling.at(-1) === 1, 5000, 'sampling back to 1');
    session.close();
    expect((await session.closed).code).toBe(1000);
  }, 30_000);

  it('without a preview grant, msg events carry no preview', async () => {
    const { client } = clientFor(engine);
    const events: InspectorEvent[] = [];
    const session = await client.managed.realtime.openInspector('prj_1', INSTANCE, {
      filter: { families: ['msg'] },
      onEvent: (event) => events.push(event),
      keepAliveMs: 0,
    });
    await Bun.sleep(50);
    await engine.publish('plain', 'no-preview', '{"secret":1}');
    await waitFor(() => events.some((event) => event.event === 'no-preview'), 5000, 'the event');
    expect(events.find((event) => event.event === 'no-preview')).not.toHaveProperty('preview');
    session.close();
    await session.closed;
  }, 15_000);

  it('a drain closes with 4000; a new session gets a fresh token after the restart', async () => {
    const { client, requests } = clientFor(engine);
    const closes: number[] = [];
    let session: InspectorSession = await client.managed.realtime.openInspector('prj_1', INSTANCE, {
      onClose: (info) => closes.push(info.code),
      keepAliveMs: 0,
    });
    const listen = engine.ws;
    await engine.stop();
    const info = await session.closed;
    expect(info.code).toBe(4000);
    expect(info.message).toContain('draining');
    expect(closes).toEqual([4000]);
    await engine.start(listen);
    const events: InspectorEvent[] = [];
    session = await client.managed.realtime.openInspector('prj_1', INSTANCE, { onEvent: (event) => events.push(event), keepAliveMs: 0 });
    expect(requests).toHaveLength(2);
    await engine.publish('again', 'after-restart', '{}');
    await waitFor(() => events.some((event) => event.event === 'after-restart'), 5000, 'an event after the restart');
    session.close();
    await session.closed;
  }, 30_000);

  it('refusals reject with the documented close codes', async () => {
    const evil = clientFor(engine, (c) => {
      c.orn = 'https://evil.hubfly.test';
    }).client;
    const refused = await evil.managed.realtime.openInspector('prj_1', INSTANCE, { keepAliveMs: 0 }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RealtimeInspectorError);
    expect((refused as RealtimeInspectorError).closeCode).toBe(4403);

    const expired = clientFor(engine, (c) => {
      c.iat -= 300;
      c.exp = c.iat + 60;
    }).client;
    const rejected = await expired.managed.realtime.openInspector('prj_1', INSTANCE, { keepAliveMs: 0 }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(RealtimeInspectorError);
    expect((rejected as RealtimeInspectorError).closeCode).toBe(4401);

    const { client } = clientFor(engine);
    const open: InspectorSession[] = [];
    for (let i = 0; i < 5; i++) open.push(await client.managed.realtime.openInspector('prj_1', INSTANCE, { keepAliveMs: 0 }));
    const sixth = await client.managed.realtime.openInspector('prj_1', INSTANCE, { keepAliveMs: 0 }).catch((error: unknown) => error);
    expect(sixth).toBeInstanceOf(RealtimeInspectorError);
    expect((sixth as RealtimeInspectorError).closeCode).toBe(4429);
    for (const session of open) session.close();
    await Promise.all(open.map((session) => session.closed));
  }, 30_000);
});

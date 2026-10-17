/**
 * In-process fake of a HubFly Realtime instance (Bun WebSocket server on 127.0.0.1:0). Tests
 * drive it frame by frame: wait for a connection, read client frames, send server frames.
 */
import type { Server, ServerWebSocket } from 'bun';

type Frame = { event: string; channel?: string; data?: any; [k: string]: unknown };

interface ConnData {
  path: string;
  conn?: FakeConn;
}

export class FakeConn {
  readonly frames: Frame[] = [];
  closed?: { code: number; reason: string };
  private waiters: Array<{ match: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
  private closeWaiters: Array<(c: { code: number; reason: string }) => void> = [];
  private consumed = new Set<number>();

  constructor(
    readonly ws: ServerWebSocket<ConnData>,
    readonly path: string,
  ) {}

  /** @internal */
  push(raw: string) {
    const f = JSON.parse(raw) as Frame;
    this.frames.push(f);
    const i = this.waiters.findIndex((w) => w.match(f));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      this.consumed.add(this.frames.length - 1);
      w.resolve(f);
    }
  }

  /** @internal */
  onClose(code: number, reason: string) {
    this.closed = { code, reason };
    for (const w of this.closeWaiters.splice(0)) w(this.closed);
  }

  /** The first client frame (optionally with this event) not returned before. */
  next(event?: string, timeoutMs = 3000): Promise<Frame> {
    const match = (f: Frame) => !event || f.event === event;
    for (let i = 0; i < this.frames.length; i++) {
      if (!this.consumed.has(i) && match(this.frames[i])) {
        this.consumed.add(i);
        return Promise.resolve(this.frames[i]);
      }
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${event ?? 'a frame'} on ${this.path}`)), timeoutMs);
      this.waiters.push({ match, resolve: (f) => (clearTimeout(t), resolve(f)) });
    });
  }

  /** All frames received so far with this event. */
  all(event: string): Frame[] {
    return this.frames.filter((f) => f.event === event);
  }

  waitClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.closeWaiters.push((c) => (clearTimeout(t), resolve(c)));
    });
  }

  send(frame: Frame) {
    this.ws.send(JSON.stringify(frame));
  }

  /** Server event with `data` JSON-encoded as a string (as the engine sends app events). */
  event(event: string, data: unknown, extra: Record<string, unknown> = {}) {
    this.send({ event, data: typeof data === 'string' ? data : JSON.stringify(data), ...extra });
  }

  establish(socketId: string, hubfly?: Record<string, unknown>, activityTimeout = 120) {
    const data: Record<string, unknown> = { socket_id: socketId, activity_timeout: activityTimeout };
    if (hubfly) data.hubfly = { v: 1, detach_ttl: 60, server_time: Date.now(), ...hubfly };
    this.send({ event: 'pusher:connection_established', data: JSON.stringify(data) });
  }

  subscribed(channel: string, data: Record<string, unknown> = {}) {
    this.send({ event: 'pusher_internal:subscription_succeeded', channel, data: JSON.stringify(data) });
  }

  close(code = 1000, reason = '') {
    this.ws.close(code, reason);
  }

  /** Drops the TCP connection without a close frame (client sees 1006). */
  kill() {
    this.ws.terminate();
  }
}

export class FakeServer {
  readonly server: Server<ConnData>;
  readonly conns: FakeConn[] = [];
  /** Request paths of every upgrade attempt, including refused ones. */
  readonly attempts: Array<{ path: string; at: number }> = [];
  hubflyPath = true;
  pusherPath = true;
  private waiters: Array<(c: FakeConn) => void> = [];
  private seen = 0;

  constructor(options: { hubflyPath?: boolean } = {}) {
    this.hubflyPath = options.hubflyPath ?? true;
    const self = this;
    this.server = Bun.serve<ConnData, never>({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, server) {
        const url = new URL(req.url);
        self.attempts.push({ path: url.pathname + url.search, at: Date.now() });
        if (url.pathname.startsWith('/hubfly/v1/app/') && !self.hubflyPath) return new Response('Not found', { status: 404 });
        if (url.pathname.startsWith('/app/') && !self.pusherPath) return new Response('Unavailable', { status: 503 });
        if (server.upgrade(req, { data: { path: url.pathname + url.search } })) return undefined;
        return new Response('Upgrade required', { status: 426 });
      },
      websocket: {
        open(ws) {
          const conn = new FakeConn(ws, ws.data.path);
          ws.data.conn = conn;
          self.conns.push(conn);
          const w = self.waiters.shift();
          if (w) {
            self.seen++;
            w(conn);
          }
        },
        message(ws, msg) {
          ws.data.conn!.push(String(msg));
        },
        close(ws, code, reason) {
          ws.data.conn!.onClose(code, reason);
        },
      },
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  /** The next connection that was not returned yet. */
  nextConn(timeoutMs = 3000): Promise<FakeConn> {
    if (this.seen < this.conns.length) return Promise.resolve(this.conns[this.seen++]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for a connection')), timeoutMs);
      this.waiters.push((c) => (clearTimeout(t), resolve(c)));
    });
  }

  stop() {
    this.server.stop(true);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves with the next emission of `event` on an emitter-like object. */
export function once<T = any>(target: { on(e: string, fn: (d: any, m?: any) => unknown): unknown; off(e: string, fn: any): unknown }, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    const fn = (d: T) => {
      clearTimeout(t);
      target.off(event, fn);
      resolve(d);
    };
    target.on(event, fn);
  });
}

// Inspector socket client (WIRE.md "Inspector", `wss://<host>/hubfly/v1/inspect`):
// the live event stream of a realtime server for debugging. The token comes
// from the Dashboard (createManagedRealtimeInspectorToken); it travels only in
// the first frame, never in the URL.

import type { CreateManagedRealtimeInspectorTokenResponse } from './managed-types.js';

/** The `ready` frame of an inspector session. */
export interface InspectorReady {
  sessionId: string;
  /** App ids the session may see (`["*"]` for all). */
  apps: string[];
  expiresAt: string;
  /** Fraction of events delivered (1 = all). */
  sampling: number;
}

/** Event families of the inspector stream. */
export type InspectorFamily = 'conn' | 'sub' | 'member' | 'msg' | 'api' | 'err' | 'webhook';

/**
 * One inspector event, e.g. `{ kind: "msg.publish", channels, event, size, recipients, source, encrypted }`.
 * Fields beyond the common ones depend on `kind` (WIRE.md "Inspector"). `preview` (first 1 KiB of
 * `data`) appears on `msg.*` events only with a payload-preview token on an app that allows it.
 */
export interface InspectorEvent {
  type: 'event';
  seq: number;
  /** Unix time in milliseconds. */
  t: number;
  app_id: string;
  family: InspectorFamily;
  kind: string;
  [field: string]: unknown;
}

/** Narrows the stream; every field is optional and an empty filter shows everything the token allows. */
export interface InspectorFilter {
  apps?: string[];
  families?: InspectorFamily[];
  channelPrefix?: string;
}

/** The subset of the WebSocket API the inspector uses. */
export interface InspectorWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
}

/**
 * Opens the socket. `origin` is the origin the token was minted for; outside
 * browsers it must be sent as the `Origin` header.
 */
export type InspectorWebSocketFactory = (url: string, origin: string) => InspectorWebSocket;

export interface InspectorCallbacks {
  onEvent?: (event: InspectorEvent) => void;
  /** The server samples (rate < 1) above 500 events/s. */
  onSampling?: (rate: number) => void;
  /** Events dropped because this client read too slowly. */
  onDropped?: (count: number) => void;
  /**
   * The session ended (expired after 1 hour, instance draining, closed by you, …). Reconnecting
   * with a fresh token is fine after 4000; after 4409 a newer session of the same user replaced
   * this one, so do not reconnect automatically or two sessions keep replacing each other.
   */
  onClose?: (info: InspectorCloseInfo) => void;
}

export interface InspectorConnectOptions extends InspectorCallbacks {
  filter?: InspectorFilter;
  /**
   * WebSocket factory. Default: `globalThis.WebSocket` (browsers, Bun, Node ≥ 22). Outside browsers
   * it is called as `new WebSocket(url, { headers: { Origin } })`, which Bun, Node's built-in
   * WebSocket and the `ws` package accept.
   */
  webSocket?: InspectorWebSocketFactory;
  /** Sends `{"type":"ping"}` this often (default 30000 ms; 0 disables). */
  keepAliveMs?: number;
  /** Fails when no `ready` frame arrives in time (default 10000 ms). */
  readyTimeoutMs?: number;
}

export interface InspectorCloseInfo {
  code: number;
  reason: string;
  /** What the close code means (WIRE.md "Inspector"). */
  message: string;
}

const CLOSE_MESSAGES: Record<number, string> = {
  1000: 'Closed',
  4000: 'Session expired (1 hour) or the realtime server is draining',
  4401: 'Missing, invalid, expired or replayed inspector token',
  4403: 'Origin not allowed for the inspector',
  4408: 'No auth frame within 5 s',
  4409: 'Replaced by a newer inspector session of the same user (do not reconnect automatically)',
  4429: 'More than 5 inspector sessions on this realtime server',
};

export function describeInspectorClose(code: number, reason = ''): InspectorCloseInfo {
  return { code, reason, message: CLOSE_MESSAGES[code] ?? (reason || `Inspector socket closed (${code})`) };
}

/** The socket closed before the session was ready (bad token, origin, limits, …). */
export class RealtimeInspectorError extends Error {
  public readonly closeCode: number;
  public readonly reason: string;

  constructor(info: InspectorCloseInfo) {
    super(`${info.message} (close ${info.code})`);
    this.name = 'RealtimeInspectorError';
    this.closeCode = info.code;
    this.reason = info.reason;
    Object.setPrototypeOf(this, RealtimeInspectorError.prototype);
  }
}

function defaultWebSocket(url: string, origin: string): InspectorWebSocket {
  const WebSocketImpl = (globalThis as { WebSocket?: new (url: string, options?: unknown) => InspectorWebSocket }).WebSocket;
  if (!WebSocketImpl) throw new Error('No WebSocket implementation: pass options.webSocket');
  // Browsers send their own Origin; elsewhere it has to be set explicitly.
  const inBrowser = typeof (globalThis as { document?: unknown }).document !== 'undefined';
  return inBrowser ? new WebSocketImpl(url) : new WebSocketImpl(url, { headers: { Origin: origin } });
}

function filterFrame(filter: InspectorFilter): string {
  const frame: Record<string, unknown> = { type: 'filter' };
  if (filter.apps) frame.apps = filter.apps;
  if (filter.families) frame.families = filter.families;
  if (filter.channelPrefix !== undefined) frame.channel_prefix = filter.channelPrefix;
  return JSON.stringify(frame);
}

/** A live inspector session. */
export class InspectorSession {
  /** Resolves when the socket closes. */
  public readonly closed: Promise<InspectorCloseInfo>;
  private resolveClosed!: (info: InspectorCloseInfo) => void;
  private keepAlive?: ReturnType<typeof setInterval>;

  private constructor(
    private readonly socket: InspectorWebSocket,
    public readonly ready: InspectorReady,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  /**
   * Connects to the URL of an inspector token and authenticates with the
   * first frame. Resolves on `ready`; rejects with RealtimeInspectorError when
   * the server closes first.
   */
  public static connect(grant: CreateManagedRealtimeInspectorTokenResponse, options: InspectorConnectOptions = {}): Promise<InspectorSession> {
    const socket = (options.webSocket ?? defaultWebSocket)(grant.url, grant.origin);
    return new Promise<InspectorSession>((resolve, reject) => {
      let session: InspectorSession | undefined;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(new Error('Inspector socket: no ready frame in time'));
        try {
          socket.close(1000, 'ready timeout');
        } catch {
          // already closed
        }
      }, options.readyTimeoutMs ?? 10_000);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'auth', token: grant.token }));
      });
      socket.addEventListener('message', (event: { data: unknown }) => {
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        switch (frame.type) {
          case 'ready': {
            if (session) return;
            session = new InspectorSession(socket, {
              sessionId: String(frame.session_id ?? ''),
              apps: Array.isArray(frame.apps) ? frame.apps.map(String) : [],
              expiresAt: String(frame.expires_at ?? ''),
              sampling: typeof frame.sampling === 'number' ? frame.sampling : 1,
            });
            session.start(options);
            settled = true;
            clearTimeout(timer);
            resolve(session);
            return;
          }
          case 'event':
            options.onEvent?.(frame as unknown as InspectorEvent);
            return;
          case 'sampling':
            if (typeof frame.rate === 'number') options.onSampling?.(frame.rate);
            return;
          case 'dropped':
            if (typeof frame.count === 'number') options.onDropped?.(frame.count);
            return;
          default:
            return; // pong and future frames
        }
      });
      socket.addEventListener('close', (event: { code?: number; reason?: string }) => {
        const info = describeInspectorClose(event.code ?? 1006, event.reason ?? '');
        if (!session) {
          fail(new RealtimeInspectorError(info));
          return;
        }
        session.stop(info);
        options.onClose?.(info);
      });
      socket.addEventListener('error', () => {
        // A close event follows; before `open` some runtimes only report the error.
        if (!session) setTimeout(() => fail(new RealtimeInspectorError(describeInspectorClose(1006, 'connection failed'))), 100);
      });
    });
  }

  private start(options: InspectorConnectOptions): void {
    if (options.filter) this.socket.send(filterFrame(options.filter));
    const every = options.keepAliveMs ?? 30_000;
    if (every > 0) this.keepAlive = setInterval(() => this.ping(), every);
  }

  private stop(info: InspectorCloseInfo): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.resolveClosed(info);
  }

  /** Replaces the filter (an empty filter shows everything the token allows). */
  public setFilter(filter: InspectorFilter): void {
    this.socket.send(filterFrame(filter));
  }

  public ping(): void {
    try {
      this.socket.send(JSON.stringify({ type: 'ping' }));
    } catch {
      // closing
    }
  }

  /** Ends the session. */
  public close(): void {
    this.socket.close(1000, 'client closed');
  }
}

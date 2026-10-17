import type { ClientE2E, ClientE2EOptions, WireKey } from '../e2e/index';

export type { ClientE2E, WireKey };

export type ConnectionState = 'initialized' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** The parts of a WebSocket the client uses (browser, Node `ws`, Bun, Deno, React Native). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: any) => any) | null;
  onmessage: ((ev: { data: any }) => any) | null;
  onclose: ((ev: { code: number; reason?: string }) => any) | null;
  onerror?: ((ev: any) => any) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Channel authorization response (pusher-js compatible, plus `hubfly.keys`). */
export interface ChannelAuth {
  auth: string;
  channel_data?: string;
  shared_secret?: string;
  hubfly?: { keys?: WireKey[] };
}

/** User authentication response for `pusher:signin`. */
export interface UserAuth {
  auth: string;
  user_data: string;
  hubfly?: { keys?: WireKey[] };
}

export interface AuthRequestOptions {
  /** Extra request headers (or a function returning them, e.g. a fresh bearer token). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Extra form parameters. */
  params?: Record<string, string>;
  /** fetch `credentials` (e.g. `include` for a cross-origin auth endpoint with cookies). */
  credentials?: 'omit' | 'same-origin' | 'include';
}

/** What `import('@hubfly/realtime/e2e')` provides to the client. */
export interface E2EModule {
  createClientE2E(options?: ClientE2EOptions): ClientE2E;
}

export interface E2EOptions extends ClientE2EOptions {
  /**
   * The `@hubfly/realtime/e2e` module (or a loader). Default: `import('@hubfly/realtime/e2e')`,
   * loaded on the first `connect()`; pass it explicitly where dynamic imports are unavailable.
   */
  module?: E2EModule | (() => Promise<E2EModule>);
}

export interface RealtimeOptions {
  /** Instance URL: `https://<host>` (or `wss://<host>`). */
  url: string;
  /** App key. */
  key: string;
  /** Channel auth endpoint (POST, `application/x-www-form-urlencoded` `socket_id` + `channel_name`). */
  authEndpoint?: string;
  /** Custom channel authorization instead of `authEndpoint`. */
  authorizer?: (request: { socketId: string; channelName: string }) => Promise<ChannelAuth>;
  /** User auth endpoint for `signin()` (POST `socket_id`). */
  userAuthEndpoint?: string;
  /** Custom user authentication instead of `userAuthEndpoint`. */
  userAuthorizer?: (request: { socketId: string }) => Promise<UserAuth>;
  /** Headers, params and credentials for both auth endpoints. */
  auth?: AuthRequestOptions;
  /** End-to-end encryption (loads `@hubfly/realtime/e2e` lazily). */
  e2e?: boolean | E2EOptions;
  /** WebSocket implementation (default: `globalThis.WebSocket`; Node < 22: `ws`). */
  WebSocket?: WebSocketConstructor;
  /** fetch implementation for auth requests (default: `globalThis.fetch`). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** `auto` (default: HubFly socket, falling back to the Pusher socket), `hubfly` or `pusher`. */
  transport?: 'auto' | 'hubfly' | 'pusher';
  /** Reconnect backoff: full jitter between 0 and min(maxMs, minMs * 2^attempt). Defaults 1000 / 30000. */
  backoff?: { minMs?: number; maxMs?: number };
  /** Ping after this much silence (default: the server's `activity_timeout`, 120 s). */
  activityTimeoutMs?: number;
  /** Reconnect when a ping is not answered within this time (default 30 s). */
  pongTimeoutMs?: number;
  /** Give up on a connection attempt after this time (default 10 s). */
  connectTimeoutMs?: number;
}

/** Second argument of event handlers. */
export interface MessageMeta {
  event: string;
  channel?: string;
  /** HubFly message id (HubFly socket). */
  id?: string;
  /** Sender of a client event on a presence channel. */
  user_id?: string;
  /** `direct` or `user` for direct and user messages. */
  kind?: string;
  /** True when the payload was end-to-end encrypted. */
  encrypted?: boolean;
}

export type Handler = (data: any, meta?: any) => unknown;

/** Recovery outcome of a channel (subscribe with `since`, or resume). */
export interface RecoveryInfo {
  status: 'recovered' | 'gap' | 'failed';
  reason?: string | null;
  epoch?: string | null;
  head?: number | null;
  replayed?: number;
  from?: number;
  to?: number;
}

export interface E2EErrorInfo {
  reason: string;
  context: string;
  event?: string;
  channel?: string;
  user_id?: string;
}

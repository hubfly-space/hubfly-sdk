/**
 * `@hubfly/analytics/server`: send pageviews and events from your servers
 * (`POST /api/v1/events`, hubfly-analytics/docs/COLLECT.md §6). Runs on Node >= 18, Bun, Deno and
 * Cloudflare Workers with only `fetch`. Server-side events are billed like browser events.
 */
import type { Props } from './tracker/types';
import type { Revenue } from './index';

export { VERSION } from './version';
export type { Props } from './tracker/types';
export type { Revenue } from './index';

export interface AnalyticsServerOptions {
  /** Site ingest key, `hfak_…` (`HUBFLY_ANALYTICS_INGEST_KEY`). Secret: keep it on the server. */
  key: string;
  /**
   * Collector base URL (`HUBFLY_ANALYTICS_HOST`): `https://hfa.<region>.hubfly.app`, or
   * `https://<your domain>/.hubfly/a` on a domain hosted on HubFly.
   */
  host: string;
  /** Custom fetch (defaults to the global `fetch`). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
}

export type EnvLike = Record<string, string | undefined>;

/** What the visitor's request tells about them; used to count unique visitors and sessions. */
export interface VisitorInfo {
  /** Page URL, absolute `http(s)`. Its host must be one of the site's domains. */
  url: string;
  props?: Props;
  /** The visitor's IP address. With `userAgent`, gives the same cookieless visitor as the browser tracker. */
  ip?: string;
  userAgent?: string;
  /** Your own stable visitor id; takes precedence over `ip` + `userAgent`. */
  visitorId?: string;
  /** Your user id (up to 128 characters). */
  userId?: string;
  referrer?: string;
  /** Event time, from 24 hours ago to 5 minutes ahead. Default: now. */
  timestamp?: Date | string | number;
}

export interface ServerEventOptions extends VisitorInfo {
  revenue?: Revenue;
}

/** One event of `send()`. */
export interface ServerEvent extends ServerEventOptions {
  type: 'event' | 'pageview';
  /** Event name (up to 120 characters); required for `event`. */
  name?: string;
}

export interface SendResult {
  accepted: number;
  rejected: number;
}

/** A non-2xx answer of the events API: 400 invalid body, 401 missing or revoked key, 413 too large. */
export class AnalyticsApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${status}`;
    super(`HubFly Analytics API: ${msg}`);
    this.name = 'AnalyticsApiError';
    this.status = status;
    this.body = body;
  }
}

const KEY_RE = /^hfak_[a-z2-7]{32}$/;
const MAX_EVENTS = 100;

export class AnalyticsServer {
  private readonly key: string;
  private readonly endpoint: string;
  private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  /** Reads `HUBFLY_ANALYTICS_INGEST_KEY` and `HUBFLY_ANALYTICS_HOST` (default `process.env`). */
  static fromEnv(env?: EnvLike, overrides: Partial<AnalyticsServerOptions> = {}): AnalyticsServer {
    const e: EnvLike = env ?? (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
    const opts = { key: e.HUBFLY_ANALYTICS_INGEST_KEY, host: e.HUBFLY_ANALYTICS_HOST, ...overrides };
    const missing = [!opts.key && 'HUBFLY_ANALYTICS_INGEST_KEY', !opts.host && 'HUBFLY_ANALYTICS_HOST'].filter(Boolean);
    if (missing.length) throw new Error(`HubFly Analytics: missing environment variables: ${missing.join(', ')}`);
    return new AnalyticsServer(opts as AnalyticsServerOptions);
  }

  constructor(o: AnalyticsServerOptions) {
    if (!KEY_RE.test(o.key ?? '')) throw new TypeError('HubFly Analytics: key must be a site ingest key (hfak_ and 32 characters of a-z2-7)');
    let url: URL;
    try {
      url = new URL(o.host);
    } catch {
      throw new TypeError(`HubFly Analytics: invalid host ${JSON.stringify(o.host)}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError(`HubFly Analytics: host must be https:// (got ${url.protocol})`);
    const fetchFn = o.fetch ?? (globalThis.fetch as AnalyticsServerOptions['fetch']);
    if (!fetchFn) throw new Error('HubFly Analytics: no fetch available (Node >= 18, or pass `fetch`)');
    this.key = o.key;
    this.endpoint = `${url.origin}${url.pathname.replace(/\/+$/, '')}/api/v1/events`;
    this.fetchFn = fetchFn;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  /** Sends a custom event: `track('Purchase', { url, revenue: { amount: '29.99', currency: 'USD' }, ip, userAgent })`. */
  track(name: string, options: ServerEventOptions): Promise<SendResult> {
    return this.send([{ ...options, type: 'event', name }]);
  }

  /** Sends a pageview. */
  pageview(options: VisitorInfo): Promise<SendResult> {
    return this.send([{ ...options, type: 'pageview' }]);
  }

  /**
   * Sends up to 100 events per request (larger arrays are split). Events the collector refuses
   * (wrong domain, malformed, filtered) are counted in `rejected`; the request does not fail.
   */
  async send(events: ReadonlyArray<ServerEvent>): Promise<SendResult> {
    const total: SendResult = { accepted: 0, rejected: 0 };
    for (let i = 0; i < events.length; i += MAX_EVENTS) {
      const r = await this.post(events.slice(i, i + MAX_EVENTS).map(toWire));
      total.accepted += r.accepted;
      total.rejected += r.rejected;
    }
    return total;
  }

  private async post(events: Record<string, unknown>[]): Promise<SendResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {}
      if (!res.ok) throw new AnalyticsApiError(res.status, body);
      const b = (body ?? {}) as Partial<SendResult>;
      return { accepted: Number(b.accepted) || 0, rejected: Number(b.rejected) || 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}

function toWire(e: ServerEvent): Record<string, unknown> {
  if (e.type === 'event' && !e.name) throw new TypeError('HubFly Analytics: an event needs a name');
  const ts = e.timestamp;
  return strip({
    type: e.type,
    name: e.name,
    url: e.url,
    props: e.props,
    revenue: e.revenue && strip({ amount: String(e.revenue.amount), currency: e.revenue.currency?.toUpperCase() }),
    ip: e.ip,
    user_agent: e.userAgent,
    visitor_id: e.visitorId,
    user_id: e.userId,
    referrer: e.referrer,
    timestamp: ts === undefined ? undefined : new Date(ts).toISOString(),
  });
}

function strip<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

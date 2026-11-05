/** `@hubfly/analytics/server` against a fake fetch: wire format (COLLECT.md §6), batching, errors. */
import { describe, expect, test } from 'bun:test';
import { AnalyticsApiError, AnalyticsServer } from '../src/server';

const KEY = 'hfak_' + 'a2'.repeat(16);

function fake(respond: (body: any) => { status?: number; body?: unknown } = (b) => ({ body: { accepted: b.events.length, rejected: 0 } })) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    calls.push({ url, init: init!, body });
    const r = respond(body);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 202 });
  };
  return { calls, fetch };
}

describe('AnalyticsServer', () => {
  test('track sends one event with snake_case fields and the bearer key', async () => {
    const f = fake();
    const a = new AnalyticsServer({ key: KEY, host: 'https://hfa.eu-north.hubfly.app/', fetch: f.fetch });
    const res = await a.track('Purchase', {
      url: 'https://example.com/checkout',
      props: { plan: 'pro' },
      revenue: { amount: 29.99, currency: 'usd' },
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
      visitorId: 'abc123',
      userId: 'user-42',
      referrer: 'https://news.ycombinator.com/',
      timestamp: Date.UTC(2026, 9, 29, 10),
    });
    expect(res).toEqual({ accepted: 1, rejected: 0 });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0];
    expect(c.url).toBe('https://hfa.eu-north.hubfly.app/api/v1/events');
    expect(c.init.method).toBe('POST');
    expect(c.init.headers).toMatchObject({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' });
    expect(c.body).toEqual({
      events: [
        {
          type: 'event',
          name: 'Purchase',
          url: 'https://example.com/checkout',
          props: { plan: 'pro' },
          revenue: { amount: '29.99', currency: 'USD' },
          ip: '203.0.113.9',
          user_agent: 'Mozilla/5.0',
          visitor_id: 'abc123',
          user_id: 'user-42',
          referrer: 'https://news.ycombinator.com/',
          timestamp: '2026-10-29T10:00:00.000Z',
        },
      ],
    });
  });

  test('pageview, a first-party host path, and splitting at 100 events', async () => {
    const f = fake((b) => ({ body: { accepted: b.events.length - 1, rejected: 1 } }));
    const a = new AnalyticsServer({ key: KEY, host: 'https://example.com/.hubfly/a', fetch: f.fetch });
    await a.pageview({ url: 'https://example.com/' });
    expect(f.calls[0].url).toBe('https://example.com/.hubfly/a/api/v1/events');
    expect(f.calls[0].body.events).toEqual([{ type: 'pageview', url: 'https://example.com/' }]);

    const many = Array.from({ length: 230 }, (_, i) => ({ type: 'event' as const, name: `E${i}`, url: 'https://example.com/' }));
    expect(await a.send(many)).toEqual({ accepted: 227, rejected: 3 });
    expect(f.calls.slice(1).map((c) => c.body.events.length)).toEqual([100, 100, 30]);
  });

  test('API errors carry the status', async () => {
    const f = fake(() => ({ status: 401, body: { error: 'invalid ingest key' } }));
    const a = new AnalyticsServer({ key: KEY, host: 'https://hfa.eu-north.hubfly.app', fetch: f.fetch });
    const err = await a.track('X', { url: 'https://example.com/' }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyticsApiError);
    expect([err.status, err.message]).toEqual([401, 'HubFly Analytics API: invalid ingest key']);
    const tooBig = new AnalyticsServer({ key: KEY, host: 'https://h.example', fetch: fake(() => ({ status: 413 })).fetch });
    expect(await tooBig.pageview({ url: 'https://example.com/' }).catch((e) => e.message)).toBe('HubFly Analytics API: HTTP 413');
  });

  test('validates options and events', () => {
    const f = fake();
    expect(() => new AnalyticsServer({ key: 'hfa_abcdefghijklmnop', host: 'https://h.example', fetch: f.fetch })).toThrow('ingest key');
    expect(() => new AnalyticsServer({ key: KEY, host: 'not a url', fetch: f.fetch })).toThrow('invalid host');
    expect(() => new AnalyticsServer({ key: KEY, host: 'ftp://h.example', fetch: f.fetch })).toThrow('https://');
    const a = new AnalyticsServer({ key: KEY, host: 'https://h.example', fetch: f.fetch });
    expect(a.send([{ type: 'event', url: 'https://example.com/' }])).rejects.toThrow('needs a name');
  });

  test('fromEnv', () => {
    const f = fake();
    expect(AnalyticsServer.fromEnv({ HUBFLY_ANALYTICS_INGEST_KEY: KEY, HUBFLY_ANALYTICS_HOST: 'https://hfa.eu-north.hubfly.app' }, { fetch: f.fetch })).toBeInstanceOf(AnalyticsServer);
    expect(() => AnalyticsServer.fromEnv({})).toThrow('HUBFLY_ANALYTICS_INGEST_KEY, HUBFLY_ANALYTICS_HOST');
  });
});

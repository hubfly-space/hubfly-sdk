import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { ANALYTICS_OPERATIONS, AnalyticsErrorCodes, HubflyApiError, HubflyClient } from '../src/index.js';
import type { AnalyticsOperationId } from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
  auth: string | null;
}

type Responder = (request: Recorded) => { status?: number; body: unknown };

const ok = (data: unknown) => ({ body: { ok: true, data, meta: { requestId: 'req_1', timestamp: 't' } } });

function fakeClient(responder: Responder = () => ok({ sites: [] }), token: string | null = 't') {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const headers = new Headers(init?.headers);
    const recorded: Recorded = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: raw ? JSON.parse(raw) : undefined,
      auth: headers.get('authorization'),
    };
    requests.push(recorded);
    const { status = 200, body } = responder(recorded);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = new HubflyClient({ token: token ?? undefined, baseUrl: 'https://api.example.test', fetch: fetchImpl });
  return { client, requests };
}

const P = 'proj_1';
const S = 'site_1';

/** One call per operation: the operationId it must hit and how to make it. */
function calls(client: HubflyClient): Array<[AnalyticsOperationId, () => Promise<unknown>]> {
  const a = client.analytics;
  return [
    ['getAnalyticsRegions', () => a.regions()],
    ['getProjectAnalytics', () => a.get(P)],
    ['updateProjectAnalytics', () => a.setEventCap(P, 5_000_000)],
    ['getProjectAnalyticsUsage', () => a.usage(P)],
    ['listProjectAnalyticsRoutes', () => a.routes(P)],
    ['verifyProjectAnalyticsDomain', () => a.verifyDomain(P, 'example.com')],
    ['createProjectAnalyticsSite', () => a.sites.create(P, { source: 'external', domain: 'example.com' })],
    ['getProjectAnalyticsSite', () => a.sites.get(P, S)],
    ['updateProjectAnalyticsSite', () => a.sites.update(P, S, { retentionDays: 90 })],
    ['deleteProjectAnalyticsSite', () => a.sites.delete(P, S)],
    ['getProjectAnalyticsSiteStatus', () => a.sites.status(P, S)],
    ['exportProjectAnalyticsData', () => a.sites.export(P, S, { from: '2026-10-01', to: '2026-10-28', format: 'ndjson' })],
    ['runProjectAnalyticsQuery', () => a.sites.query(P, S, { type: 'aggregate', range: { period: '30d' }, metrics: ['visitors'] })],
    ['listProjectAnalyticsGoals', () => a.goals.list(P, S)],
    ['createProjectAnalyticsGoal', () => a.goals.create(P, S, { name: 'Signup', kind: 'event', match: 'Signup' })],
    ['updateProjectAnalyticsGoal', () => a.goals.update(P, S, 'gl_1', { name: 'Thanks', kind: 'pageview', match: '/thanks/**' })],
    ['deleteProjectAnalyticsGoal', () => a.goals.delete(P, S, 'gl_1')],
    ['listProjectAnalyticsFunnels', () => a.funnels.list(P, S)],
    [
      'createProjectAnalyticsFunnel',
      () =>
        a.funnels.create(P, S, {
          name: 'Checkout',
          steps: [
            { kind: 'pageview', match: '/cart', label: 'Cart' },
            { kind: 'event', match: 'Purchase', label: 'Paid' },
          ],
        }),
    ],
    ['updateProjectAnalyticsFunnel', () => a.funnels.update(P, S, 'fn_1', { name: 'Checkout', steps: [], windowMinutes: 60 })],
    ['deleteProjectAnalyticsFunnel', () => a.funnels.delete(P, S, 'fn_1')],
    ['listProjectAnalyticsSegments', () => a.segments.list(P, S)],
    ['createProjectAnalyticsSegment', () => a.segments.create(P, S, { name: 'DE', filters: [{ dim: 'country', op: 'is', values: ['DE'] }] })],
    ['deleteProjectAnalyticsSegment', () => a.segments.delete(P, S, 'sg_1')],
    ['listProjectAnalyticsShares', () => a.shares.list(P, S)],
    ['createProjectAnalyticsShare', () => a.shares.create(P, S)],
    ['revokeProjectAnalyticsShare', () => a.shares.revoke(P, S, 'sh_1')],
    ['listProjectAnalyticsIngestKeys', () => a.keys.list(P, S)],
    ['createProjectAnalyticsIngestKey', () => a.keys.create(P, S, 'backend')],
    ['revokeProjectAnalyticsIngestKey', () => a.keys.revoke(P, S, 'key_1')],
    ['getSharedAnalyticsSite', () => a.shared.get('slug_1')],
    ['unlockSharedAnalytics', () => a.shared.unlock('slug_1', 'pw')],
    ['runSharedAnalyticsQuery', () => a.shared.query('slug_1', { type: 'realtime' })],
  ];
}

function pathPattern(template: string): RegExp {
  return new RegExp(`^${template.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`);
}

describe('analytics module', () => {
  it('covers every Web Analytics operation of the spec exactly once', async () => {
    const { client, requests } = fakeClient();
    const table = calls(client);
    const ids = table.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(ANALYTICS_OPERATIONS).sort());

    for (const [id, call] of table) {
      const before = requests.length;
      await call();
      expect(requests.length).toBe(before + 1);
      const request = requests[before];
      const op = ANALYTICS_OPERATIONS[id];
      expect(`${id} ${request.method}`).toBe(`${id} ${op.method}`);
      expect(request.url.pathname).toMatch(pathPattern(op.path));
      if (op.body === 'none') expect(request.body).toBeUndefined();
      if (op.body === 'empty') expect(request.body).toEqual({});
      if (op.body === 'json') expect(typeof request.body).toBe('object');
      for (const name of request.url.searchParams.keys()) expect(op.query as readonly string[]).toContain(name);
    }
  });

  it('encodes path parameters, queries and bodies', async () => {
    const { client, requests } = fakeClient();
    await client.analytics.goals.delete(P, 'site/1', 'gl 1');
    await client.analytics.sites.export(P, S, { from: '2026-10-01', to: '2026-10-07', kind: 'sessions', format: 'csv' });
    await client.analytics.setEventCap(P, null);
    await client.analytics.sites.pause(P, S);
    await client.analytics.shared.get('slug_1', 'tok');
    await client.analytics.sites.realtime(P, S);
    expect(requests[0].url.pathname).toBe(`/api/v1/projects/${P}/analytics/sites/site%2F1/goals/gl%201/delete`);
    expect(Object.fromEntries(requests[1].url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-07', kind: 'sessions', format: 'csv' });
    expect(requests[2].body).toEqual({ monthlyEventCap: null });
    expect(requests[3].body).toEqual({ state: 'paused' });
    expect(requests[3].method).toBe('PUT');
    expect(requests[4].url.searchParams.get('token')).toBe('tok');
    expect(requests[5].body).toEqual({ type: 'realtime' });
    await expect(client.analytics.sites.get(P, '')).rejects.toThrow(/siteId/);
  });

  it('lists sites from the project overview', async () => {
    const { client } = fakeClient(() => ok({ projectId: P, sites: [{ id: S, name: 'Docs' }] }));
    const sites = await client.analytics.sites.list(P);
    expect(sites.data.map((site) => site.id)).toEqual([S]);
  });

  it('narrows a report to the member of its type', async () => {
    const { client } = fakeClient(() =>
      ok({ type: 'breakdown', results: [{ value: '/pricing', values: { visitors: 12 } }], meta: { partial: false, totalValues: 1 } }),
    );
    const response = await client.analytics.sites.query(P, S, { type: 'breakdown', dim: 'page', limit: 10 });
    // Typed as AnalyticsBreakdownResult: results are rows, not a metric map.
    expect(response.data.results[0].value).toBe('/pricing');
    expect(response.data.results[0].values.visitors).toBe(12);
  });

  it('reads shared dashboards without a token', async () => {
    const { client, requests } = fakeClient(() => ok({ slug: 'slug_1', passwordRequired: true, unlocked: false }), null);
    await client.analytics.shared.get('slug_1');
    expect(requests[0].auth).toBeNull();
    expect(requests[0].url.search).toBe('');
  });

  it('surfaces gate errors with their reason', async () => {
    const { client } = fakeClient(() => ({
      status: 409,
      body: {
        ok: false,
        error: { code: AnalyticsErrorCodes.UNAVAILABLE, message: 'Web Analytics is not open yet.', details: { reason: 'disabled' } },
      },
    }));
    const error = await client.analytics.sites.create(P, { source: 'external', domain: 'example.com' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HubflyApiError);
    expect((error as HubflyApiError).statusCode).toBe(409);
    expect((error as HubflyApiError).code).toBe('ANALYTICS_UNAVAILABLE');
    expect((error as HubflyApiError).details).toEqual({ reason: 'disabled' });
  });
});

// The operation table is generated from the Dashboard's openapi.json; when the
// spec is next to this repo, check that the table still matches it.
const specPath = process.env.OPENAPI_PATH ?? path.resolve(import.meta.dir, '../../../../hubfly-dashboard/openapi.json');
const specHasAnalytics = fs.existsSync(specPath) && fs.readFileSync(specPath, 'utf8').includes('/analytics/sites/');
describe.skipIf(!specHasAnalytics)('spec', () => {
  it('ANALYTICS_OPERATIONS matches openapi.json', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as { paths: Record<string, Record<string, { operationId: string }>> };
    const fromSpec: Record<string, string> = {};
    for (const [route, methods] of Object.entries(spec.paths)) {
      if (!/^\/api\/v1\/(projects\/:projectId\/)?analytics(\/|$)/.test(route)) continue;
      for (const [method, op] of Object.entries(methods)) fromSpec[op.operationId] = `${method.toUpperCase()} ${route}`;
    }
    const fromTable = Object.fromEntries(Object.entries(ANALYTICS_OPERATIONS).map(([id, op]) => [id, `${op.method} ${op.path}`]));
    expect(fromTable).toEqual(fromSpec);
  });
});

import { describe, expect, it } from 'bun:test';
import { HubflyClient } from '../src/index.js';

// State-changing endpoints are POST on the engine (a GET mutation is a CSRF
// hole); these calls must not fall back to the client's GET default.
describe('mutating endpoints use POST', () => {
  const calls: Array<{ method: string; path: string }> = [];
  const client = new HubflyClient({
    token: 'test-token',
    baseUrl: 'http://localhost:8787',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      calls.push({ method: init?.method ?? 'GET', path: url.pathname });
      return new Response(
        JSON.stringify({ ok: true, data: {}, meta: { requestId: 'r', timestamp: '' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  it.each([
    ['github refresh', () => client.github.refreshToken(), '/api/v1/github/refresh-token'],
    ['hibernate', () => client.projects.hibernation.hibernate('p1'), '/api/v1/projects/p1/hibernation/hibernate'],
    ['restore', () => client.projects.hibernation.restore('p1'), '/api/v1/projects/p1/hibernation/restore'],
    ['lb sync', () => client.projects.loadBalancers.sync('p1', 'lb1'), '/api/v1/projects/p1/load-balancers/lb1/sync'],
    ['scan trigger', () => client.projects.registry.triggerScan('p1', 'img1'), '/api/v1/projects/p1/registry/images/img1/scan/trigger'],
    ['subaccount update', () => client.subaccounts.update('sub1', { name: 'x' }), '/api/v1/subaccounts/sub1/update'],
  ] as const)('%s', async (_name, call, path) => {
    calls.length = 0;
    await call();
    expect(calls).toEqual([{ method: 'POST', path }]);
  });
});

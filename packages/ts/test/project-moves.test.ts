import { describe, expect, it } from 'bun:test';
import { HubflyApiError, HubflyClient, transferBundleConfirmText } from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
}

function fakeClient(status = 200, payload: unknown = { ok: true, data: {}, meta: { requestId: 'req_1', timestamp: 't' } }) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    requests.push({ method: init?.method ?? 'GET', url: new URL(String(input)), body: raw ? JSON.parse(raw) : undefined });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { client: new HubflyClient({ token: 't', baseUrl: 'https://api.example.test', fetch: fetchImpl }), requests };
}

const P = 'proj_1';
const T = `hub_project_transfer_${'ab'.repeat(32)}.v1`;
const OFFER = `/api/v1/project-transfers/${T}`;

describe('client.projects.transfers', () => {
  // The Dashboard derives the HTTP method from the handler name: get, list
  // and preview are GET; create, cancel, accept and decline are POST.
  const cases: Array<[string, (c: HubflyClient) => Promise<unknown>, string, string, Record<string, string | string[]>, unknown]> = [
    ['get', (c) => c.projects.transfers.get(P), 'GET', `/api/v1/projects/${P}/transfer`, {}, undefined],
    ['preview', (c) => c.projects.transfers.preview(P), 'GET', `/api/v1/projects/${P}/transfer/preview`, {}, undefined],
    ['createOtp', (c) => c.projects.transfers.createOtp(P, { recipientEmail: 'bob@example.test' }), 'POST', `/api/v1/projects/${P}/transfer/otp/create`, {}, { recipientEmail: 'bob@example.test' }],
    [
      'create',
      (c) => c.projects.transfers.create(P, { recipientEmail: 'bob@example.test', confirmName: 'web', otp: '123456', options: { credentialPolicy: 'rotate' } }),
      'POST',
      `/api/v1/projects/${P}/transfer/create`,
      {},
      { recipientEmail: 'bob@example.test', confirmName: 'web', otp: '123456', options: { credentialPolicy: 'rotate' } },
    ],
    ['cancel', (c) => c.projects.transfers.cancel(P), 'POST', `/api/v1/projects/${P}/transfer/cancel`, {}, {}],
    ['list', (c) => c.projects.transfers.list(), 'GET', '/api/v1/project-transfers', {}, undefined],
    ['getOffer', (c) => c.projects.transfers.getOffer(T), 'GET', OFFER, {}, undefined],
    ['previewAcceptance personal', (c) => c.projects.transfers.previewAcceptance(T, { destinationType: 'user' }), 'GET', `${OFFER}/preview`, { destinationType: 'user' }, undefined],
    [
      'previewAcceptance bundle subset',
      (c) => c.projects.transfers.previewAcceptance(T, { destinationType: 'organization', destinationId: 'org_1', transferIds: ['ptr_1', 'ptr_2'] }),
      'GET',
      `${OFFER}/preview`,
      { destinationType: 'organization', destinationId: 'org_1', transferIds: ['ptr_1', 'ptr_2'] },
      undefined,
    ],
    [
      'accept',
      (c) => c.projects.transfers.accept(T, { destinationType: 'organization', destinationId: 'org_1', keepMembers: [{ transferId: 'ptr_1', userIds: ['u_2'] }] }),
      'POST',
      `${OFFER}/accept`,
      {},
      { destinationType: 'organization', destinationId: 'org_1', keepMembers: [{ transferId: 'ptr_1', userIds: ['u_2'] }] },
    ],
    ['decline', (c) => c.projects.transfers.decline(T), 'POST', `${OFFER}/decline`, {}, {}],
    [
      'createBundleOtp',
      (c) => c.projects.transfers.createBundleOtp({ projectIds: ['p1', 'p2'], recipientEmail: 'bob@example.test' }),
      'POST',
      '/api/v1/project-transfers/bundles/otp/create',
      {},
      { projectIds: ['p1', 'p2'], recipientEmail: 'bob@example.test' },
    ],
    [
      'createBundle',
      (c) => c.projects.transfers.createBundle({ projectIds: ['p1', 'p2'], recipientEmail: 'bob@example.test', confirmText: transferBundleConfirmText(2), otp: '123456' }),
      'POST',
      '/api/v1/project-transfers/bundles/create',
      {},
      { projectIds: ['p1', 'p2'], recipientEmail: 'bob@example.test', confirmText: 'TRANSFER 2 PROJECTS', otp: '123456' },
    ],
    ['projects.history', (c) => c.projects.history(P), 'GET', `/api/v1/projects/${P}/history`, {}, undefined],
  ];

  it.each(cases)('%s', async (_name, call, method, path, query, body) => {
    const { client, requests } = fakeClient();
    await call(client);
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r.method).toBe(method);
    expect(r.url.pathname).toBe(path);
    const seen: Record<string, string | string[]> = {};
    for (const key of new Set(r.url.searchParams.keys())) {
      const values = r.url.searchParams.getAll(key);
      seen[key] = values.length === 1 ? values[0]! : values;
    }
    expect(seen).toEqual(query);
    expect(r.body).toEqual(body);
  });

  it('returns a null transfer when the project never had one', async () => {
    const { client } = fakeClient(200, { ok: true, data: null, meta: { requestId: 'r', timestamp: 't' } });
    const res = await client.projects.transfers.get(P);
    expect(res.data).toBeNull();
  });

  it('exposes MOVE_SESSION_REQUIRED for token-authenticated writes', async () => {
    const { client } = fakeClient(403, {
      ok: false,
      error: { code: 'MOVE_SESSION_REQUIRED', message: 'Sign in to the dashboard to transfer a project.' },
      meta: { requestId: 'r', timestamp: 't' },
    });
    const err = await client.projects.transfers.createOtp(P, { recipientEmail: 'bob@example.test' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubflyApiError);
    expect((err as HubflyApiError).statusCode).toBe(403);
    expect((err as HubflyApiError).code).toBe('MOVE_SESSION_REQUIRED');
  });

  it('carries preflight blockers in the error details', async () => {
    const blockers = [{ code: 'TRANSFER_WORK_IN_PROGRESS', severity: 'blocker', message: 'A build is running.' }];
    const { client } = fakeClient(409, { ok: false, error: { code: 'TRANSFER_BLOCKED', message: 'Blocked', details: { blockers } }, meta: { requestId: 'r', timestamp: 't' } });
    const err = (await client.projects.transfers.create(P, { recipientEmail: 'bob@example.test', confirmName: 'web', otp: '1' }).catch((e: unknown) => e)) as HubflyApiError;
    expect(err.code).toBe('TRANSFER_BLOCKED');
    expect(err.details).toEqual({ blockers });
  });

  it('builds the bundle confirmation text', () => {
    expect(transferBundleConfirmText(3)).toBe('TRANSFER 3 PROJECTS');
  });
});

import { describe, expect, it } from 'bun:test';
import { HubflyApiError, HubflyClient } from '../src/index.js';

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
const M = `/api/v1/projects/${P}/mail`;

describe('client.mail (Dashboard mailbox administration)', () => {
  // The Dashboard derives the HTTP method from the handler name: get → GET,
  // create/add/post → POST, update/put → PUT, delete/remove → DELETE.
  const cases: Array<[string, (c: HubflyClient) => Promise<unknown>, string, string, Record<string, string>, unknown]> = [
    ['mailboxes.list', (c) => c.mail.mailboxes.list(P), 'GET', `${M}/mailboxes`, {}, undefined],
    ['mailboxes.enable', (c) => c.mail.mailboxes.enable(P), 'POST', `${M}/mailboxes/enable`, {}, undefined],
    ['mailboxes.create', (c) => c.mail.mailboxes.create(P, { name: 'Support', kind: 'shared', capBytes: null, addresses: ['help@acme.test'] }), 'POST', `${M}/mailboxes/create`, {}, { name: 'Support', kind: 'shared', capBytes: null, addresses: ['help@acme.test'] }],
    ['mailboxes.update', (c) => c.mail.mailboxes.update(P, 'mbx_1', { color: '#0f766e' }), 'PUT', `${M}/mailboxes/mbx_1/update`, {}, { color: '#0f766e' }],
    ['mailboxes.delete', (c) => c.mail.mailboxes.delete(P, 'mbx_1'), 'DELETE', `${M}/mailboxes/mbx_1/delete`, {}, undefined],
    ['setAddressDelivery', (c) => c.mail.setAddressDelivery(P, 'help@acme.test', { mailboxIds: ['mbx_1'], forwardTo: '' }), 'PUT', `${M}/addresses/help%40acme.test/delivery`, {}, { mailboxIds: ['mbx_1'], forwardTo: '' }],
    ['people.list', (c) => c.mail.people.list(P), 'GET', `${M}/people`, {}, undefined],
    ['people.create', (c) => c.mail.people.create(P, { kind: 'standalone', email: 'ann@acme.test', grants: [{ mailboxId: 'mbx_1', role: 'full' }], sendInvite: true }), 'POST', `${M}/people/create`, {}, { kind: 'standalone', email: 'ann@acme.test', grants: [{ mailboxId: 'mbx_1', role: 'full' }], sendInvite: true }],
    ['people.update', (c) => c.mail.people.update(P, 'mu_1', { state: 'disabled' }), 'PUT', `${M}/people/mu_1/update`, {}, { state: 'disabled' }],
    ['people.delete', (c) => c.mail.people.delete(P, 'mu_1'), 'DELETE', `${M}/people/mu_1/delete`, {}, undefined],
    ['people.reset', (c) => c.mail.people.reset(P, 'mu_1', { email: true }), 'POST', `${M}/people/mu_1/reset`, {}, { email: true }],
    ['identities.list', (c) => c.mail.identities.list(P), 'GET', `${M}/identities`, {}, undefined],
    ['identities.create', (c) => c.mail.identities.create(P, { address: 'help@acme.test', displayName: 'Acme Help' }), 'POST', `${M}/identities/create`, {}, { address: 'help@acme.test', displayName: 'Acme Help' }],
    ['identities.update', (c) => c.mail.identities.update(P, 'idn_1', { mailboxId: null }), 'PUT', `${M}/identities/idn_1/update`, {}, { mailboxId: null }],
    ['identities.delete', (c) => c.mail.identities.delete(P, 'idn_1'), 'DELETE', `${M}/identities/idn_1/delete`, {}, undefined],
    ['getBrand', (c) => c.mail.getBrand(P), 'GET', `${M}/brand`, {}, undefined],
    ['updateBrand', (c) => c.mail.updateBrand(P, { productName: 'Acme Mail', themePreset: 'paper' }), 'PUT', `${M}/brand/update`, {}, { brand: { productName: 'Acme Mail', themePreset: 'paper' } }],
    ['getStorage', (c) => c.mail.getStorage(P), 'GET', `${M}/storage`, {}, undefined],
    ['getStorage refresh', (c) => c.mail.getStorage(P, { refresh: true }), 'GET', `${M}/storage`, { refresh: 'true' }, undefined],
    ['getAiSettings', (c) => c.mail.getAiSettings(P), 'GET', `${M}/ai`, {}, undefined],
    ['updateAiSettings', (c) => c.mail.updateAiSettings(P, { enabled: true, features: ['summarize'] }), 'PUT', `${M}/ai/update`, {}, { enabled: true, features: ['summarize'] }],
    ['mailboxKeys.list', (c) => c.mail.mailboxKeys.list(P), 'GET', `${M}/mailbox-keys`, {}, undefined],
    ['mailboxKeys.create', (c) => c.mail.mailboxKeys.create(P, { name: 'helpdesk', scopes: ['read', 'send'], mailboxRoles: { mbx_1: 'full' }, identityIds: ['idn_1'] }), 'POST', `${M}/mailbox-keys/create`, {}, { name: 'helpdesk', scopes: ['read', 'send'], mailboxRoles: { mbx_1: 'full' }, identityIds: ['idn_1'] }],
    ['mailboxKeys.revoke', (c) => c.mail.mailboxKeys.revoke(P, 'key_1'), 'POST', `${M}/mailbox-keys/key_1/revoke`, {}, undefined],
  ];

  it.each(cases)('%s', async (_name, call, method, path, query, body) => {
    const { client, requests } = fakeClient();
    await call(client);
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r.method).toBe(method);
    expect(r.url.pathname).toBe(path);
    expect(Object.fromEntries(r.url.searchParams)).toEqual(query);
    expect(r.body).toEqual(body);
  });

  it('returns the envelope data', async () => {
    const data = { key: { id: 'key_1', name: 'helpdesk' }, secret: 'hfmb_secret' };
    const { client } = fakeClient(200, { ok: true, data, meta: { requestId: 'r', timestamp: 't' } });
    const res = await client.mail.mailboxKeys.create(P, { name: 'helpdesk', scopes: ['read'], mailboxRoles: { mbx_1: 'read' } });
    expect(res.data.secret).toBe('hfmb_secret');
  });

  it('throws HubflyApiError with the Dashboard error code', async () => {
    const { client } = fakeClient(403, { ok: false, error: { code: 'FORBIDDEN', message: 'Missing permission' }, meta: { requestId: 'r', timestamp: 't' } });
    const err = await client.mail.people.list(P).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubflyApiError);
    expect((err as HubflyApiError).statusCode).toBe(403);
    expect((err as HubflyApiError).code).toBe('FORBIDDEN');
  });
});

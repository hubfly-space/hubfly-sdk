import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  HubflyApiError,
  HubflyClient,
  MANAGED_OPERATIONS,
  ManagedErrorCodes,
  isManagedApiError,
  toSocketId,
} from '../src/index.js';
import type { ManagedOperationId } from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
  raw: string;
}

type Responder = (request: Recorded) => { status?: number; body: unknown };

function fakeClient(responder: Responder = () => ({ body: { ok: true, data: {}, meta: { requestId: 'req_1', timestamp: 't' } } })) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const recorded: Recorded = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      body: raw ? JSON.parse(raw) : undefined,
      raw: `${String(input)} ${raw}`,
    };
    requests.push(recorded);
    const { status = 200, body } = responder(recorded);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = new HubflyClient({ token: 't', baseUrl: 'https://api.example.test', fetch: fetchImpl });
  return { client, requests };
}

const P = 'proj_1';
const I = 'inst_1';
const A = '1000001';

/** One call per operation: the operationId it must hit and how to make it. */
function calls(client: HubflyClient): Array<[ManagedOperationId, () => Promise<unknown>]> {
  const m = client.managed;
  const ins = m.instances;
  const db = m.databases;
  const rt = m.realtime;
  return [
    ['getManagedCatalog', () => m.catalog()],
    ['getManagedClientIp', () => m.clientIp()],
    ['getManagedPricing', () => m.pricing()],
    ['getManagedPriceEstimate', () => m.estimatePrice({ cpu: 0.5, memoryMib: 512, storageGib: 10 })],
    ['getManagedWorkspace', () => m.workspace(P)],
    ['getManagedOperations', () => m.listOperations(P, { limit: 5 })],
    ['getManagedInstances', () => ins.list(P)],
    ['getManagedInstance', () => ins.get(P, I)],
    ['createManagedInstance', () => ins.create(P, { name: 'rt', service: 'realtime', size: { cpu: 0.5, memoryMib: 512 }, quotedHourlyTotal: 0.01, idempotencyKey: 'k1' })],
    ['updateManagedInstance', () => ins.update(P, I, { name: 'renamed' })],
    ['deleteManagedInstance', () => ins.delete(P, I, { confirmName: 'rt' })],
    ['updateManagedInstanceDeletionProtection', () => ins.updateDeletionProtection(P, I, { enabled: true })],
    ['postManagedInstanceStart', () => ins.start(P, I)],
    ['postManagedInstanceStop', () => ins.stop(P, I)],
    ['postManagedInstanceRestart', () => ins.restart(P, I)],
    ['postManagedInstanceResize', () => ins.resize(P, I, { memoryMib: 1024, quotedHourlyTotal: 0.02 })],
    ['postManagedInstanceUpgrade', () => ins.upgrade(P, I)],
    ['getManagedInstanceOperations', () => ins.listOperations(P, I)],
    ['getManagedInstanceOperation', () => ins.getOperation(P, I, 'op_1')],
    ['getManagedInstanceMetrics', () => ins.metrics(P, I, { windowSeconds: 3600 })],
    ['getManagedInstanceLogs', () => ins.logs(P, I)],
    ['getManagedInstanceAudit', () => ins.audit(P, I)],
    ['getManagedInstanceNetwork', () => ins.getNetwork(P, I)],
    ['updateManagedInstanceAllowlist', () => ins.updateAllowlist(P, I, { entries: [], revision: 3 })],
    ['updateManagedInstancePublicAccess', () => ins.updatePublicAccess(P, I, { enabled: false })],
    ['getManagedInstanceAlerts', () => ins.getAlerts(P, I)],
    ['updateManagedInstanceAlerts', () => ins.updateAlerts(P, I, { storagePercent: 80, connectionsPercent: 80, instanceDown: true, email: true })],
    ['getManagedInstanceConnection', () => db.getConnection(P, I)],
    ['getManagedInstanceCertificate', () => db.getCertificate(P, I)],
    ['getManagedInstanceBackups', () => db.getBackups(P, I)],
    ['postManagedInstanceCredentialReveal', () => db.revealCredentials(P, I)],
    ['postManagedInstanceCredentialRotate', () => db.rotateCredentials(P, I)],
    ['getManagedInstanceBindings', () => db.listBindings(P, I)],
    ['createManagedInstanceBinding', () => db.createBinding(P, I, { targetProjectId: 'proj_2' })],
    ['deleteManagedInstanceBinding', () => db.deleteBinding(P, I, 'bind_1', { removeVariable: false })],
    ['getManagedInstanceDatabases', () => db.listDatabases(P, I)],
    ['createManagedInstanceDatabase', () => db.createDatabase(P, I, { name: 'app' })],
    ['deleteManagedInstanceDatabase', () => db.deleteDatabase(P, I, 'app', { confirmName: 'app' })],
    ['getManagedInstanceUsers', () => db.listUsers(P, I)],
    ['createManagedInstanceUser', () => db.createUser(P, I, { name: 'reader', preset: 'read_only' })],
    ['updateManagedInstanceUser', () => db.updateUser(P, I, 'reader', { preset: 'read_write' })],
    ['deleteManagedInstanceUser', () => db.deleteUser(P, I, 'reader')],
    ['postManagedInstanceUserPasswordRotate', () => db.rotateUserPassword(P, I, 'reader')],
    ['getManagedInstanceExtensions', () => db.listExtensions(P, I)],
    ['postManagedInstanceExtensionInstall', () => db.installExtension(P, I, { name: 'pgcrypto' })],
    ['deleteManagedInstanceExtension', () => db.deleteExtension(P, I, 'pgcrypto', { cascade: true })],
    ['getManagedInstanceExports', () => db.listExports(P, I)],
    ['createManagedInstanceExport', () => db.createExport(P, I)],
    ['postManagedInstanceExportDownload', () => db.downloadExport(P, I, 'exp_1')],
    ['postManagedInstanceImportUpload', () => db.uploadImport(P, I, { fileName: 'dump.sql', sizeBytes: 10 })],
    ['postManagedInstanceImportStart', () => db.startImport(P, I, 'imp_1')],
    ['getManagedInstanceConfig', () => db.getConfig(P, I)],
    ['getManagedInstanceConfigHistory', () => db.getConfigHistory(P, I)],
    ['postManagedInstanceConfigValidate', () => db.validateConfig(P, I, { changes: { work_mem: '8MB' } })],
    ['postManagedInstanceConfigApply', () => db.applyConfig(P, I, { generation: 2, changes: { work_mem: null }, restart: 'later' })],
    ['postManagedInstanceConfigRevert', () => db.revertConfig(P, I, { revisionId: 'rev_1', generation: 2, restart: 'now' })],
    ['getManagedInstanceInsights', () => db.getInsights(P, I, { orderBy: 'calls' })],
    ['postManagedInstanceInsightsReset', () => db.resetInsights(P, I)],
    ['getManagedInstanceSessions', () => db.listSessions(P, I)],
    ['postManagedInstanceSessionCancel', () => db.cancelSession(P, I, '42')],
    ['postManagedInstanceSessionTerminate', () => db.terminateSession(P, I, '42')],
    ['postManagedInstanceQuery', () => db.query(P, I, { sql: 'select 1', readOnly: true })],
    ['getManagedInstanceSchema', () => db.getSchema(P, I)],
    ['getManagedInstanceTableRows', () => db.getTableRows(P, I, { schema: 'public', table: 'users', limit: 10 })],
    ['postManagedInstanceTableRowsChange', () => db.changeTableRows(P, I, { schema: 'public', table: 'users', action: 'delete', keys: [{ id: '1' }] })],
    ['getManagedInstanceTokens', () => db.listTokens(P, I)],
    ['createManagedInstanceToken', () => db.createToken(P, I, { name: 'ci', access: 'read_only' })],
    ['deleteManagedInstanceToken', () => db.deleteToken(P, I, 'tok_1')],
    ['postManagedInstanceShellSession', () => db.createShellSession(P, I)],
    ['getManagedRealtimeApps', () => rt.listApps(P, I)],
    ['getManagedRealtimeApp', () => rt.getApp(P, I, A)],
    ['createManagedRealtimeApp', () => rt.createApp(P, I, { name: 'chat' })],
    ['updateManagedRealtimeApp', () => rt.updateApp(P, I, A, { enabled: false })],
    ['updateManagedRealtimeAppSettings', () => rt.updateAppSettings(P, I, A, { settings: { allowedOrigins: [] }, revision: 1 })],
    ['deleteManagedRealtimeApp', () => rt.deleteApp(P, I, A, { confirmName: 'chat' })],
    ['getManagedRealtimeKeys', () => rt.listKeys(P, I, A)],
    ['createManagedRealtimeKey', () => rt.createKey(P, I, A)],
    ['postManagedRealtimeKeyRotate', () => rt.rotateKey(P, I, A, 'key_1', { graceSeconds: 600 })],
    ['postManagedRealtimeKeyRevoke', () => rt.revokeKey(P, I, A, 'key_1')],
    ['postManagedRealtimeKeyReveal', () => rt.revealKey(P, I, A, 'key_1')],
    ['getManagedRealtimeWebhooks', () => rt.listWebhooks(P, I, A)],
    ['createManagedRealtimeWebhook', () => rt.createWebhook(P, I, A, { url: 'https://example.com/hook', events: ['channel_occupied'] })],
    ['updateManagedRealtimeWebhook', () => rt.updateWebhook(P, I, A, 'wh_1', { enabled: false })],
    ['deleteManagedRealtimeWebhook', () => rt.deleteWebhook(P, I, A, 'wh_1')],
    ['postManagedRealtimeWebhookTest', () => rt.testWebhook(P, I, A, 'wh_1')],
    ['getManagedRealtimeWebhookDeliveries', () => rt.getWebhookDeliveries(P, I, A, { status: 'dead' })],
    ['postManagedRealtimeWebhookRedeliver', () => rt.redeliverWebhook(P, I, A, 'dlv_1')],
    ['postManagedRealtimePublish', () => rt.publish(P, I, A, { event: 'order.created', data: { id: 42 }, channels: ['orders'] })],
    ['postManagedRealtimeSend', () => rt.send(P, I, A, { event: 'ping', data: 'hi', userId: 'u1' })],
    ['getManagedRealtimeChannels', () => rt.listChannels(P, I, A, { prefix: 'presence-' })],
    ['getManagedRealtimeChannel', () => rt.inspectChannel(P, I, A, { channel: 'presence-room' })],
    ['getManagedRealtimeConnections', () => rt.listConnections(P, I, { appId: A })],
    ['postManagedRealtimeConnectionTerminate', () => rt.terminateConnection(P, I, A, { socketId: '1234567890.1234567890', mode: 'disconnect' })],
    ['postManagedRealtimeUserTerminate', () => rt.terminateUser(P, I, A, { userId: 'u1' })],
    ['getManagedRealtimeHistory', () => rt.getHistory(P, I, A, { channel: 'orders', since: 0 })],
    ['postManagedRealtimeHistoryPurge', () => rt.purgeHistory(P, I, A)],
    ['getManagedRealtimeInsights', () => rt.getInsights(P, I, { windowSeconds: 3600 })],
    ['getManagedRealtimeUsage', () => rt.getUsage(P, I)],
    ['createManagedRealtimeInspectorToken', () => rt.createInspectorToken(P, I)],
    ['getManagedRealtimeInspectorRecent', () => rt.getInspectorRecent(P, I, { afterSeq: 0, payloadPreview: false })],
    ['getManagedRealtimeBindings', () => rt.listBindings(P, I)],
    ['createManagedRealtimeBinding', () => rt.createBinding(P, I, { appId: A, targetProjectId: 'proj_2', clientPrefix: 'NEXT_PUBLIC_' })],
    ['deleteManagedRealtimeBinding', () => rt.deleteBinding(P, I, 'bind_1', { removeVariables: false })],
    ['getManagedRealtimeConnection', () => rt.getConnection(P, I)],
  ];
}

function pathPattern(template: string): RegExp {
  return new RegExp(`^${template.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`);
}

describe('managed modules', () => {
  it('cover every Managed Services operation of the spec exactly once', async () => {
    const { client, requests } = fakeClient();
    const table = calls(client);
    const ids = table.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(MANAGED_OPERATIONS).sort());

    for (const [id, call] of table) {
      const before = requests.length;
      await call();
      expect(requests.length).toBe(before + 1);
      const request = requests[before];
      const op = MANAGED_OPERATIONS[id];
      expect(`${id} ${request.method}`).toBe(`${id} ${op.method}`);
      expect(request.url.pathname).toMatch(pathPattern(op.path));
      // Bodies: none for GET/DELETE, `{}` for empty POSTs, an object otherwise.
      if (op.body === 'none') expect(request.body).toBeUndefined();
      if (op.body === 'empty') expect(request.body).toEqual({});
      if (op.body === 'json') expect(typeof request.body).toBe('object');
      for (const name of request.url.searchParams.keys()) expect(op.query as readonly string[]).toContain(name);
    }
  });

  it('encodes path parameters and keeps false/0 query values', async () => {
    const { client, requests } = fakeClient();
    await client.managed.databases.deleteDatabase(P, I, 'my db/x', { confirmName: 'my db/x', force: false });
    await client.managed.realtime.deleteBinding(P, I, 'bind_1', { removeVariables: false });
    await client.managed.realtime.getHistory(P, I, A, { channel: 'private-orders', since: 0, limit: 50 });
    expect(requests[0].url.pathname).toBe(`/api/v1/projects/${P}/managed/instances/${I}/databases/my%20db%2Fx/delete`);
    expect(requests[0].url.searchParams.get('confirmName')).toBe('my db/x');
    expect(requests[0].url.searchParams.get('force')).toBe('false');
    expect(requests[1].url.searchParams.get('removeVariables')).toBe('false');
    expect(Object.fromEntries(requests[2].url.searchParams)).toEqual({ channel: 'private-orders', since: '0', limit: '50' });
    expect(requests[2].method).toBe('GET');
    await expect(client.managed.instances.get(P, '')).rejects.toThrow(/instanceId/);
  });

  it('sends the documented bodies', async () => {
    const { client, requests } = fakeClient();
    await client.managed.realtime.publish(P, I, A, { event: 'order.created', data: { id: 42 }, channels: ['orders'] });
    await client.managed.realtime.publish(P, I, A, { event: 'raw', data: '{"a":1}', channels: ['a', 'b'], messageId: 'm-1' });
    await client.managed.realtime.updateAppSettings(P, I, A, { settings: { allowedOrigins: [], history: { mode: 'durable' } }, revision: 7 });
    expect(requests[0].body).toEqual({ event: 'order.created', data: '{"id":42}', channels: ['orders'] });
    expect(requests[1].body).toEqual({ event: 'raw', data: '{"a":1}', channels: ['a', 'b'], messageId: 'm-1' });
    expect(requests[2].body).toEqual({ settings: { allowedOrigins: [], history: { mode: 'durable' } }, revision: 7 });
    expect(requests[2].method).toBe('PUT');
  });
});

describe('end-to-end connection ids', () => {
  const KEY = 'c2VjcmV0LWNsaWVudC1rZXktbXVzdC1uZXZlci1sZWF2ZQ';
  const E2E_ID = `1234567890.1234567890~${KEY}`;

  it('strips the key from every request', async () => {
    const { client, requests } = fakeClient();
    const rt = client.managed.realtime;
    await rt.send(P, I, A, { event: 'hubfly.e2e', data: '{"v":1}', socketIds: [E2E_ID, '1234567890.1234567890', '2234567890.1234567890'] });
    await rt.terminateConnection(P, I, A, { socketId: E2E_ID });
    await rt.listConnections(P, I, { connectionId: E2E_ID });
    await rt.publish(P, I, A, { event: 'x', data: 'y', channels: ['c'], excludeSocketId: E2E_ID });
    for (const request of requests) {
      expect(request.raw).not.toContain(KEY);
      expect(request.raw).not.toContain('~');
    }
    expect((requests[0].body as { socketIds: string[] }).socketIds).toEqual(['1234567890.1234567890', '2234567890.1234567890']);
    expect((requests[1].body as { socketId: string }).socketId).toBe('1234567890.1234567890');
    expect(requests[2].url.searchParams.get('connectionId')).toBe('1234567890.1234567890');
    expect((requests[3].body as { excludeSocketId: string }).excludeSocketId).toBe('1234567890.1234567890');
  });

  it('refuses plaintext to an E2E connection id before any request', async () => {
    const { client, requests } = fakeClient();
    const attempt = client.managed.realtime.send(P, I, A, { event: 'chat.message', data: { text: 'hi' }, socketIds: [E2E_ID] });
    const error = await attempt.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HubflyApiError);
    expect((error as HubflyApiError).statusCode).toBe(400);
    expect((error as HubflyApiError).code).toBe(ManagedErrorCodes.REALTIME_E2E_CONNECTION_ID);
    expect((error as HubflyApiError).message).not.toContain(KEY);
    expect(requests).toHaveLength(0);
  });

  it('toSocketId keeps plain socket ids', () => {
    expect(toSocketId('1234567890.1234567890')).toBe('1234567890.1234567890');
    expect(toSocketId(E2E_ID)).toBe('1234567890.1234567890');
  });
});

describe('errors', () => {
  const cases: Array<[number, string]> = [
    [409, 'MANAGED_REALTIME_ENGINE_UNSUPPORTED'],
    [403, 'MANAGED_REALTIME_E2E_REQUIRED'],
    [413, 'MANAGED_REALTIME_PAYLOAD_TOO_LARGE'],
    [400, 'MANAGED_REALTIME_E2E_CONNECTION_ID'],
    [409, 'MANAGED_FEATURE_UNSUPPORTED'],
  ];
  for (const [status, code] of cases) {
    it(`surfaces ${status} ${code}`, async () => {
      const { client } = fakeClient(() => ({
        status,
        body: { ok: false, error: { code, message: `message for ${code}`, details: { reason: 'x' } }, meta: { requestId: 'req_9', timestamp: 't' } },
      }));
      const error = await client.managed.realtime.getInsights(P, I).catch((e: unknown) => e);
      expect(isManagedApiError(error, code)).toBe(true);
      const apiError = error as HubflyApiError;
      expect(apiError.statusCode).toBe(status);
      expect(apiError.code).toBe(code);
      expect(apiError.message).toBe(`message for ${code}`);
      expect(apiError.details).toEqual({ reason: 'x' });
      expect(apiError.requestId).toBe('req_9');
    });
  }

  it('keeps errorId of 5xx errors and accepts string errors', async () => {
    const { client } = fakeClient(() => ({ status: 500, body: { ok: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error', errorId: 'err_1' }, meta: { requestId: 'r', timestamp: 't' } } }));
    const error = (await client.managed.catalog().catch((e: unknown) => e)) as HubflyApiError;
    expect(error.errorId).toBe('err_1');
    const legacy = fakeClient(() => ({ status: 401, body: { ok: false, error: 'Unauthorized' } }));
    const legacyError = (await legacy.client.managed.catalog().catch((e: unknown) => e)) as HubflyApiError;
    expect(legacyError.message).toBe('Unauthorized');
    expect(legacyError.code).toBeUndefined();
    expect(isManagedApiError(legacyError)).toBe(true);
    expect(isManagedApiError(new Error('x'))).toBe(false);
  });
});

describe('helpers', () => {
  it('waitForOperation polls until the operation finishes', async () => {
    let polls = 0;
    const { client } = fakeClient(() => {
      polls += 1;
      const status = polls < 3 ? 'running' : 'succeeded';
      return { body: { ok: true, data: { id: 'op_1', instanceId: I, kind: 'create', status, steps: [], error: null, actorUserId: null, createdAt: 't', finishedAt: null }, meta: {} } };
    });
    const seen: string[] = [];
    const op = await client.managed.instances.waitForOperation(P, I, 'op_1', { intervalMs: 1, onProgress: (o) => seen.push(o.status) });
    expect(op.status).toBe('succeeded');
    expect(seen).toEqual(['running', 'running', 'succeeded']);
  });

  it('waitForOperation times out with 408', async () => {
    const { client } = fakeClient(() => ({ body: { ok: true, data: { id: 'op_1', status: 'running', steps: [] }, meta: {} } }));
    const error = (await client.managed.instances
      .waitForOperation(P, I, 'op_1', { intervalMs: 5, timeoutMs: 1 })
      .catch((e: unknown) => e)) as HubflyApiError;
    expect(error.statusCode).toBe(408);
  });

  it('iterators follow nextCursor', async () => {
    const { client, requests } = fakeClient((request) => {
      const cursor = request.url.searchParams.get('cursor');
      const page = cursor === null ? { items: [{ name: 'a' }, { name: 'b' }], nextCursor: 'c2', total: null } : { items: [{ name: 'c' }], nextCursor: null, total: null };
      return { body: { ok: true, data: page, meta: {} } };
    });
    const names: string[] = [];
    for await (const channel of client.managed.realtime.iterateChannels(P, I, A, { limit: 2 })) names.push(channel.name);
    expect(names).toEqual(['a', 'b', 'c']);
    expect(requests.map((r) => r.url.searchParams.get('cursor'))).toEqual([null, 'c2']);
    expect(requests.every((r) => r.url.searchParams.get('limit') === '2')).toBe(true);
  });
});

// The operation table is generated from the Dashboard's openapi.json; when the
// spec is next to this repo, check that the table still matches it.
const specPath = process.env.OPENAPI_PATH ?? path.resolve(import.meta.dir, '../../../../hubfly-dashboard/openapi.json');
describe.skipIf(!fs.existsSync(specPath))('spec', () => {
  it('MANAGED_OPERATIONS matches openapi.json', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as { paths: Record<string, Record<string, { operationId: string }>> };
    const fromSpec: Record<string, string> = {};
    for (const [route, methods] of Object.entries(spec.paths)) {
      if (!/\/managed(\/|$)/.test(route)) continue;
      for (const [method, op] of Object.entries(methods)) fromSpec[op.operationId] = `${method.toUpperCase()} ${route}`;
    }
    const fromTable = Object.fromEntries(Object.entries(MANAGED_OPERATIONS).map(([id, op]) => [id, `${op.method} ${op.path}`]));
    expect(fromTable).toEqual(fromSpec);
  });
});

import { describe, expect, it } from 'bun:test';
import { HubflyApiError, HubflyClient, ManagedErrorCodes, isManagedApiError } from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  body: unknown;
}

function fakeClient(status = 200, body: unknown = { ok: true, data: {}, meta: { requestId: 'req_1', timestamp: 't' } }) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    requests.push({ method: init?.method ?? 'GET', url: new URL(String(input)), body: raw ? JSON.parse(raw) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { client: new HubflyClient({ token: 't', baseUrl: 'https://api.example.test', fetch: fetchImpl }), requests };
}

const P = 'proj_1';
const I = 'inst_1';
const base = `/api/v1/projects/${P}/managed/instances/${I}/stream`;

describe('client.managed.streams', () => {
  it('sends typed bodies, queries and path parameters', async () => {
    const { client, requests } = fakeClient();
    const st = client.managed.streams;
    await st.createInput(P, I, { name: 'Studio A cam', kind: 'push', backupKey: true, protocols: ['rtmp', 'srt'] });
    await st.rotateInputKey(P, I, 'sin_cam1abcd', { role: 'backup', remove: true });
    await st.getUsage(P, I, { month: '2026-11' });
    await st.revealInputKeys(P, I, 'sin_cam1abcd');
    await st.createPlaybackToken(P, I, 'sch_main0001', { ttlSeconds: 3600, sub: 'viewer-42' });
    await st.deleteRecording(P, I, 'srec 1/x', { deleteObject: false });
    await st.estimatePrice({ speedMbps: 100 });

    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `POST ${base}/inputs/create`,
      `POST ${base}/inputs/sin_cam1abcd/keys/rotate`,
      `GET ${base}/usage`,
      `POST ${base}/inputs/sin_cam1abcd/keys/reveal`,
      `POST ${base}/channels/sch_main0001/token/create`,
      `DELETE ${base}/recordings/srec%201%2Fx/delete`,
      'GET /api/v1/managed/streams/price',
    ]);
    expect(requests[0].body).toEqual({ name: 'Studio A cam', kind: 'push', backupKey: true, protocols: ['rtmp', 'srt'] });
    expect(requests[1].body).toEqual({ role: 'backup', remove: true });
    expect(requests[2].url.searchParams.get('month')).toBe('2026-11');
    expect(requests[3].body).toEqual({});
    expect(requests[4].body).toEqual({ ttlSeconds: 3600, sub: 'viewer-42' });
    expect(requests[5].url.searchParams.get('deleteObject')).toBe('false');
    expect(requests[6].url.searchParams.get('speedMbps')).toBe('100');
  });

  it('exposes STREAM_* error codes', async () => {
    const { client } = fakeClient(409, {
      ok: false,
      error: { code: 'STREAM_REVISION_CONFLICT', message: 'Changed since you read it' },
      meta: { requestId: 'req_9', timestamp: 't' },
    });
    const error = await client.managed.streams.updateChannel(P, I, 'sch_main0001', { revision: 3 } as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HubflyApiError);
    expect(isManagedApiError(error, ManagedErrorCodes.STREAM_REVISION_CONFLICT)).toBe(true);
    expect((error as HubflyApiError).statusCode).toBe(409);
  });

  it('refuses empty path parameters before sending', async () => {
    const { client, requests } = fakeClient();
    await expect(client.managed.streams.getChannel(P, I, '')).rejects.toThrow(/channelId/);
    expect(requests.length).toBe(0);
  });
});

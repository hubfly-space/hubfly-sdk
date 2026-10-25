import { describe, expect, it } from 'bun:test';
import { MailboxApiError, MailboxClient, MailboxErrorCodes, isMailboxApiError } from '../src/index.js';

interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  bytes?: Uint8Array;
}

interface Reply {
  status?: number;
  body?: unknown;
  /** Sent as-is (not JSON-encoded). */
  raw?: BodyInit | null;
  headers?: Record<string, string>;
}

const BASE = 'https://mail.example.test';

function fakeMailbox(responder: (request: Recorded) => Reply = () => ({ body: {} }), options: { timeout?: number } = {}) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    let body: unknown;
    let bytes: Uint8Array | undefined;
    if (typeof init?.body === 'string' && headers.get('content-type') === 'application/json') {
      body = JSON.parse(init.body);
    } else if (init?.body != null) {
      bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    }
    const recorded: Recorded = { method: init?.method ?? 'GET', url: new URL(String(input)), headers, body, bytes };
    requests.push(recorded);
    const reply = responder(recorded);
    const status = reply.status ?? 200;
    if (reply.raw !== undefined) return new Response(reply.raw, { status, headers: reply.headers });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof fetch;
  const mailbox = new MailboxClient({ apiKey: 'hfmb_test', baseUrl: `${BASE}/`, fetch: fetchImpl, ...options });
  return { mailbox, requests };
}

function query(r: Recorded): Record<string, string> {
  return Object.fromEntries(r.url.searchParams);
}

describe('MailboxClient', () => {
  it('requires an API key and defaults to the public Mail node', () => {
    expect(() => new MailboxClient({ apiKey: '' })).toThrow(TypeError);
    expect(new MailboxClient({ apiKey: 'hfmb_x' }).baseUrl).toBe('https://mail.hubmail.space');
  });

  it('sends the key as a bearer token under /client/v1', async () => {
    const { mailbox, requests } = fakeMailbox(() => ({ body: { state: 42 } }));
    expect(await mailbox.state()).toEqual({ state: 42 });
    expect(requests[0]!.url.href).toBe(`${BASE}/client/v1/state`);
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer hfmb_test');
    expect(requests[0]!.headers.has('content-type')).toBe(false);
  });

  // Every JSON endpoint: the call, then the method, path, query and body it must produce.
  const cases: Array<[string, (m: MailboxClient) => Promise<unknown>, string, string, Record<string, string>, unknown]> = [
    ['me', (m) => m.me(), 'GET', '/me', {}, undefined],
    ['changes', (m) => m.changes({ since: 10, limit: 100 }), 'GET', '/changes', { since: '10', limit: '100' }, undefined],
    ['folders.list', (m) => m.folders.list({ mailboxId: 'mbx_1' }), 'GET', '/folders', { mailbox: 'mbx_1' }, undefined],
    ['folders.create', (m) => m.folders.create({ mailboxId: 'mbx_1', name: 'Clients' }), 'POST', '/folders', {}, { mailbox_id: 'mbx_1', name: 'Clients' }],
    ['folders.rename', (m) => m.folders.rename('fld_1', 'VIP'), 'PATCH', '/folders/fld_1', {}, { name: 'VIP' }],
    ['folders.delete', (m) => m.folders.delete('fld_1'), 'DELETE', '/folders/fld_1', {}, undefined],
    ['folders.empty', (m) => m.folders.empty('fld_trash'), 'POST', '/folders/fld_trash/empty', {}, undefined],
    ['threads.get', (m) => m.threads.get('thr_1'), 'GET', '/threads/thr_1', {}, undefined],
    ['threads.update', (m) => m.threads.update({ ids: ['thr_1'], seen: true, moveTo: 'archive' }), 'POST', '/threads/update', {}, { ids: ['thr_1'], seen: true, move_to: 'archive' }],
    ['threads.assign', (m) => m.threads.assign('thr_1', { id: 'u1', name: 'Ann' }), 'POST', '/threads/thr_1/assign', {}, { assignee: { id: 'u1', name: 'Ann' } }],
    ['threads.unassign', (m) => m.threads.assign('thr_1', null), 'POST', '/threads/thr_1/assign', {}, { assignee: null }],
    ['threads.setStatus', (m) => m.threads.setStatus('thr_1', 'done'), 'POST', '/threads/thr_1/status', {}, { status: 'done' }],
    ['threads.addNote', (m) => m.threads.addNote('thr_1', 'call them'), 'POST', '/threads/thr_1/notes', {}, { body: 'call them' }],
    ['threads.deleteNote', (m) => m.threads.deleteNote('note_1'), 'DELETE', '/notes/note_1', {}, undefined],
    ['threads.presence', (m) => m.threads.presence('thr_1', 'replying'), 'POST', '/threads/thr_1/presence', {}, { kind: 'replying' }],
    ['messages.get', (m) => m.messages.get('msg_1'), 'GET', '/messages/msg_1', {}, undefined],
    ['messages.get without body', (m) => m.messages.get('msg_1', { body: false }), 'GET', '/messages/msg_1', { body: 'false' }, undefined],
    ['messages.update', (m) => m.messages.update({ ids: ['msg_1'], flagged: false }), 'POST', '/messages/update', {}, { ids: ['msg_1'], flagged: false }],
    ['messages.delete', (m) => m.messages.delete(['msg_1', 'msg_2']), 'POST', '/messages/delete', {}, { ids: ['msg_1', 'msg_2'] }],
    ['messages.cancelSend', (m) => m.messages.cancelSend('msg_1'), 'POST', '/messages/msg_1/cancel-send', {}, undefined],
    ['contacts', (m) => m.contacts({ q: 'bo', limit: 5 }), 'GET', '/contacts', { q: 'bo', limit: '5' }, undefined],
    ['storage', (m) => m.storage({ mailboxId: 'mbx_1' }), 'GET', '/storage', { mailbox: 'mbx_1' }, undefined],
    ['blocked.list', (m) => m.blocked.list('mbx_1'), 'GET', '/blocked', { mailbox_id: 'mbx_1' }, undefined],
    ['blocked.add', (m) => m.blocked.add('mbx_1', '@spam.test'), 'POST', '/blocked', {}, { mailbox_id: 'mbx_1', email: '@spam.test' }],
    ['blocked.remove', (m) => m.blocked.remove('mbx_1', '@spam.test'), 'DELETE', '/blocked', { mailbox_id: 'mbx_1', email: '@spam.test' }, undefined],
  ];

  it.each(cases)('%s', async (_name, call, method, path, q, body) => {
    const { mailbox, requests } = fakeMailbox();
    await call(mailbox);
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r.method).toBe(method);
    expect(r.url.pathname).toBe(`/client/v1${path}`);
    expect(query(r)).toEqual(q);
    expect(r.body).toEqual(body);
  });

  it('resolves 204 answers to undefined', async () => {
    const { mailbox } = fakeMailbox(() => ({ status: 204 }));
    expect(await mailbox.folders.rename('fld_1', 'x')).toBeUndefined();
  });

  it('escapes path ids and rejects empty ones', async () => {
    const { mailbox, requests } = fakeMailbox();
    await mailbox.threads.get('a/b');
    expect(requests[0]!.url.pathname).toBe('/client/v1/threads/a%2Fb');
    expect(() => mailbox.threads.get('')).toThrow(TypeError);
  });

  it('maps every list filter and omits false booleans', async () => {
    const { mailbox, requests } = fakeMailbox(() => ({ body: { threads: [], next_cursor: '', state: 1 } }));
    await mailbox.threads.list({
      mailboxId: 'mbx_1', folder: 'anywhere', q: 'from:bob', assigned: 'me', status: 'open', unread: true, flagged: false, cursor: 'c1', limit: 20,
    });
    expect(query(requests[0]!)).toEqual({
      mailbox: 'mbx_1', folder: 'anywhere', q: 'from:bob', assigned: 'me', status: 'open', unread: 'true', cursor: 'c1', limit: '20',
    });
  });

  it('defaults a page with no items to an empty array', async () => {
    // The node omits empty `threads`/`messages` arrays (omitempty).
    const { mailbox } = fakeMailbox(() => ({ body: { next_cursor: '', state: 7 } }));
    expect(await mailbox.threads.list()).toEqual({ threads: [], next_cursor: '', state: 7 });
    expect(await mailbox.messages.list()).toEqual({ messages: [], next_cursor: '', state: 7 });
  });

  it('iterates threads and messages across cursor pages', async () => {
    const pages: Record<string, { ids: string[]; next: string }> = {
      '': { ids: ['t1', 't2'], next: 'c1' },
      c1: { ids: ['t3'], next: 'c2' },
      c2: { ids: [], next: '' },
    };
    const { mailbox, requests } = fakeMailbox((r) => {
      const page = pages[r.url.searchParams.get('cursor') ?? '']!;
      const items = page.ids.map((id) => ({ id }));
      const key = r.url.pathname.endsWith('/threads') ? 'threads' : 'messages';
      return { body: { [key]: items, next_cursor: page.next, state: 1 } };
    });
    const threads: string[] = [];
    for await (const t of mailbox.threads.iterate({ folder: 'inbox', limit: 2 })) threads.push(t.id);
    expect(threads).toEqual(['t1', 't2', 't3']);
    expect(requests.map((r) => r.url.searchParams.get('cursor'))).toEqual([null, 'c1', 'c2']);
    expect(requests.every((r) => r.url.searchParams.get('limit') === '2')).toBe(true);

    const messages: string[] = [];
    for await (const m of mailbox.messages.iterate()) messages.push(m.id);
    expect(messages).toEqual(['t1', 't2', 't3']);
  });

  it('stops iterating when the caller breaks', async () => {
    const { mailbox, requests } = fakeMailbox(() => ({ body: { threads: [{ id: 'a' }, { id: 'b' }], next_cursor: 'more', state: 1 } }));
    for await (const t of mailbox.threads.iterate()) {
      if (t.id === 'a') break;
    }
    expect(requests).toHaveLength(1);
  });

  it('saves drafts with the snake_case composer body', async () => {
    const { mailbox, requests } = fakeMailbox(() => ({ body: { id: 'msg_d' } }));
    await mailbox.drafts.save({
      mailboxId: 'mbx_1',
      draftId: 'msg_d',
      from: 'support@acme.test',
      to: ['bob@example.net', { name: 'Ann', email: 'ann@example.net' }],
      cc: [{ email: 'cc@example.net' }],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      replyToMessageId: 'msg_0',
      attachments: [{ uploadId: 'upl_1' }, { messageId: 'msg_0', index: 0 }, { uploadId: 'upl_2', inline: true, contentId: 'img1' }],
    });
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url.pathname).toBe('/client/v1/drafts');
    expect(requests[0]!.body).toEqual({
      mailbox_id: 'mbx_1',
      draft_id: 'msg_d',
      from: 'support@acme.test',
      to: [{ name: '', email: 'bob@example.net' }, { name: 'Ann', email: 'ann@example.net' }],
      cc: [{ name: '', email: 'cc@example.net' }],
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
      reply_to_message_id: 'msg_0',
      attachments: [{ upload_id: 'upl_1' }, { message_id: 'msg_0', index: 0 }, { upload_id: 'upl_2', inline: true, content_id: 'img1' }],
    });
  });

  it('sends with undo_seconds, send_at and an idempotency key', async () => {
    const result = { outbound_id: 'out_1', status: 'queued', send_at: '2026-10-23T10:00:30Z', message: { id: 'msg_s' } };
    const { mailbox, requests } = fakeMailbox(() => ({ status: 202, body: result }));
    const sent = await mailbox.send({ mailboxId: 'mbx_1', from: 'a@acme.test', to: ['b@example.net'], subject: 'Re: hi', undoSeconds: 10, idempotencyKey: 'k1' });
    expect(sent).toEqual(result as never);
    expect(requests[0]!.url.pathname).toBe('/client/v1/send');
    expect(requests[0]!.headers.get('idempotency-key')).toBe('k1');
    expect(requests[0]!.body).toEqual({ mailbox_id: 'mbx_1', from: 'a@acme.test', to: [{ name: '', email: 'b@example.net' }], subject: 'Re: hi', undo_seconds: 10 });

    await mailbox.send({ mailboxId: 'mbx_1', from: 'a@acme.test', to: ['b@example.net'], sendAt: new Date('2026-11-01T09:00:00Z') });
    expect((requests[1]!.body as { send_at: string }).send_at).toBe('2026-11-01T09:00:00.000Z');
    expect(requests[1]!.headers.has('idempotency-key')).toBe(false);
  });

  it('uploads raw bytes with Content-Type and a percent-encoded X-Filename', async () => {
    const upload = { id: 'upl_1', filename: 'résumé 1.pdf', content_type: 'application/pdf', size: 3, expires_at: 't' };
    const { mailbox, requests } = fakeMailbox(() => ({ status: 201, body: upload }));
    expect(await mailbox.uploads.create(new Uint8Array([1, 2, 3]), { filename: 'résumé 1.pdf', contentType: 'application/pdf' })).toEqual(upload);
    const r = requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.url.pathname).toBe('/client/v1/uploads');
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('x-filename')).toBe('r%C3%A9sum%C3%A9%201.pdf');
    expect([...r.bytes!]).toEqual([1, 2, 3]);

    // A File supplies its own name and type.
    await mailbox.uploads.create(new File(['hi'], 'note.txt', { type: 'text/plain' }));
    expect(requests[1]!.headers.get('content-type')).toStartWith('text/plain');
    expect(requests[1]!.headers.get('x-filename')).toBe('note.txt');

    // Without a name or type.
    await mailbox.uploads.create(new ArrayBuffer(1));
    expect(requests[2]!.headers.get('content-type')).toBe('application/octet-stream');
    expect(requests[2]!.headers.has('x-filename')).toBe(false);
  });

  it('downloads the raw message and attachments as files', async () => {
    const { mailbox, requests } = fakeMailbox((r) =>
      r.url.pathname.endsWith('/raw')
        ? { raw: 'From: a\r\n\r\nhi', headers: { 'content-type': 'message/rfc822', 'content-disposition': 'attachment; filename="Hello there.eml"' } }
        : {
            raw: new Uint8Array([137, 80, 78, 71]),
            headers: { 'content-type': 'image/png', 'content-disposition': "inline; filename*=utf-8''ph%C3%B6to.png" },
          },
    );
    const raw = await mailbox.messages.raw('msg_1');
    expect(requests[0]!.url.pathname).toBe('/client/v1/messages/msg_1/raw');
    expect(raw.filename).toBe('Hello there.eml');
    expect(raw.contentType).toBe('message/rfc822');
    expect(new TextDecoder().decode(raw.data)).toBe('From: a\r\n\r\nhi');
    expect(raw.size).toBe(13);

    const image = await mailbox.messages.attachment('msg_1', 2, { inline: true });
    expect(requests[1]!.url.pathname).toBe('/client/v1/messages/msg_1/attachments/2');
    expect(query(requests[1]!)).toEqual({ inline: '1' });
    expect(image.filename).toBe('phöto.png');
    const blob = image.blob();
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(4);

    await mailbox.messages.attachment('msg_1', 0);
    expect(query(requests[2]!)).toEqual({});
    expect(() => mailbox.messages.attachment('msg_1', -1)).toThrow(TypeError);
  });

  describe('errors', () => {
    it('carries scope, limit and usage for 507 storage_full', async () => {
      const { mailbox } = fakeMailbox(() => ({
        status: 507,
        body: { error: { code: 'storage_full', message: 'mail storage is full', scope: 'mailbox', mailbox_id: 'mbx_1', limit_bytes: 1000, used_bytes: 990 } },
      }));
      const err = await mailbox.send({ mailboxId: 'mbx_1', from: 'a@acme.test', to: ['b@example.net'] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MailboxApiError);
      expect(isMailboxApiError(err, MailboxErrorCodes.STORAGE_FULL)).toBe(true);
      const e = err as MailboxApiError;
      expect(e.status).toBe(507);
      expect(e.code).toBe('storage_full');
      expect(e.message).toBe('mail storage is full');
      expect(e.scope).toBe('mailbox');
      expect(e.mailboxId).toBe('mbx_1');
      expect(e.limitBytes).toBe(1000);
      expect(e.usedBytes).toBe(990);
    });

    it('reads Retry-After and reset_at on 429', async () => {
      const { mailbox } = fakeMailbox(() => ({
        status: 429,
        headers: { 'retry-after': '2' },
        body: { error: { code: 'send_limit_reached', message: 'hourly limit', reset_at: '2026-10-23T11:00:00Z' } },
      }));
      const e = (await mailbox.me().catch((x: unknown) => x)) as MailboxApiError;
      expect(e.code).toBe(MailboxErrorCodes.SEND_LIMIT_REACHED);
      expect(e.retryAfter).toBe(2);
      expect(e.resetAt).toBe('2026-10-23T11:00:00Z');
      expect(e.scope).toBeUndefined();
    });

    it('handles errors that are not JSON', async () => {
      const { mailbox } = fakeMailbox(() => ({ status: 502, raw: 'gateway unavailable\n', headers: { 'content-type': 'text/plain' } }));
      const e = (await mailbox.me().catch((x: unknown) => x)) as MailboxApiError;
      expect(e.status).toBe(502);
      expect(e.code).toBe('http_error');
      expect(e.message).toBe('gateway unavailable');
    });

    it('turns network failures and timeouts into MailboxApiError', async () => {
      const failing = new MailboxClient({ apiKey: 'hfmb_x', fetch: (async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch });
      const e = (await failing.me().catch((x: unknown) => x)) as MailboxApiError;
      expect(e.status).toBe(0);
      expect(e.code).toBe('network_error');

      const hanging = new MailboxClient({
        apiKey: 'hfmb_x',
        timeout: 10,
        fetch: ((_input: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          })) as typeof fetch,
      });
      const t = (await hanging.me().catch((x: unknown) => x)) as MailboxApiError;
      expect(t.status).toBe(408);
      expect(t.code).toBe('timeout');
    });
  });
});

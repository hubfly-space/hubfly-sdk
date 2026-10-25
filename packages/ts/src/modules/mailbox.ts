// HubFly Mail mailbox client API: the regional Mail node's `/client/v1`.
//
// Customers call it directly with a Mailbox API key (`hfmb_…`) created in the
// Dashboard (`client.mail.mailboxKeys.create()`). A key carries scopes
// (`read`, `organize`, `send`) and a role per mailbox (`read`, `full`,
// `owner`). Responses are plain JSON (no `{ok, data}` envelope) and keep the
// node's snake_case field names; method options are camelCase.

/** Role of a person or key in one mailbox. `owner` is the same as `full` today. */
export type MailboxRole = 'owner' | 'full' | 'read';
/** Standard folder roles; custom folders have no role. */
export type MailboxFolderRole = 'inbox' | 'drafts' | 'sent' | 'archive' | 'spam' | 'trash';
/** Shared-inbox status of a conversation. New inbound mail reopens `done`. */
export type MailboxThreadStatus = 'open' | 'pending' | 'done';
/** Where a Sent copy is in the delivery queue. */
export type MailboxSendState = 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
/** Presence kinds; `left` removes the caller's entry. */
export type MailboxPresenceKind = 'viewing' | 'replying' | 'left';

export interface MailboxAddress {
  name: string;
  email: string;
}

/** A recipient: an address string or `{ name?, email }`. */
export type MailboxRecipient = string | { name?: string; email: string };

export interface MailboxIdentity {
  email: string;
  name: string;
}

/** A mailbox the caller can open, with its role (from `me()`). */
export interface MailboxGranted {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  color: string;
  cap_bytes: number | null;
  used_bytes: number;
  message_count: number;
  created_at: string;
  role: MailboxRole;
}

export interface MailboxFolder {
  id: string;
  mailbox_id: string;
  name: string;
  /** `null` for custom folders. */
  role: MailboxFolderRole | null;
  sort: number;
  total: number;
  unread: number;
}

export interface MailboxMe {
  /** `kind` is `api` for a Mailbox API key. */
  user: { id: string; name: string; kind: 'member' | 'standalone' | 'api' };
  mailboxes: MailboxGranted[];
  folders: MailboxFolder[];
  /** Addresses the caller may send as; empty without the `send` scope. */
  identities: MailboxIdentity[];
  can_send: boolean;
  storage: { quota_bytes: number; used_bytes: number };
  policy: {
    max_attachment_bytes: number;
    remote_images: 'block' | 'ask' | 'allow';
    trash_retention_days: number;
    spam_retention_days: number;
    footer_text: string;
  };
  state: number;
}

export interface MailboxPerson {
  id: string;
  name: string;
}

export interface MailboxAttachment {
  index: number;
  filename: string;
  content_type: string;
  size: number;
  inline: boolean;
  content_id?: string;
}

/** Readable content of a message. `html` is sanitised on the node; still render it sandboxed. */
export interface MailboxBody {
  text: string;
  html: string;
  has_remote_images: boolean;
  attachments: MailboxAttachment[];
}

export interface MailboxThreadSummary {
  id: string;
  mailbox_id: string;
  subject: string;
  snippet: string;
  last_at: string;
  message_count: number;
  unread_count: number;
  flagged: boolean;
  has_attachments: boolean;
  has_draft: boolean;
  from: MailboxAddress;
  participants: MailboxAddress[];
  folder_ids: string[];
  assignee: MailboxPerson | null;
  status: MailboxThreadStatus;
  note_count: number;
  message_ids: string[];
}

export interface MailboxMessage {
  id: string;
  thread_id: string;
  mailbox_id: string;
  folder_id: string;
  folder_role: MailboxFolderRole | '';
  subject: string;
  from: MailboxAddress;
  to: MailboxAddress[];
  cc: MailboxAddress[];
  bcc: MailboxAddress[];
  reply_to: string;
  date: string;
  received_at: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  /** RFC 5322 size in bytes; this is what counts toward storage. */
  size: number;
  snippet: string;
  has_attachments: boolean;
  attachments: MailboxAttachment[];
  spam: { score: number; reason: string } | null;
  /** Set on Sent copies. */
  send: { outbound_id: string; send_at: string; state: MailboxSendState } | null;
  message_id: string;
  in_reply_to: string;
  identity: string;
  /** Present on `messages.get()` (unless `body: false`) and in `threads.get()`. */
  body?: MailboxBody;
}

export interface MailboxNote {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface MailboxPresence {
  user_id: string;
  user_name: string;
  kind: 'viewing' | 'replying';
  expires_at: string;
}

export interface MailboxThread extends MailboxThreadSummary {
  messages: MailboxMessage[];
  notes: MailboxNote[];
  presence: MailboxPresence[];
}

export interface MailboxThreadPage {
  threads: MailboxThreadSummary[];
  /** Empty on the last page. */
  next_cursor: string;
  state: number;
}

export interface MailboxMessagePage {
  messages: MailboxMessage[];
  /** Empty on the last page. */
  next_cursor: string;
  state: number;
}

export interface MailboxChange {
  modseq: number;
  mailbox_id: string;
  kind: string;
  object_id: string;
  op: string;
}

export interface MailboxChanges {
  changes: MailboxChange[];
  state: number;
  /** More changes are waiting: call again with `since: state`. */
  more: boolean;
  /** The cursor is older than the retained change log: reload everything. */
  reset: boolean;
}

export interface MailboxContact {
  email: string;
  name: string;
  uses: number;
}

export interface MailboxUpload {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  /** Uploads are valid for 24 hours. */
  expires_at: string;
}

export interface MailboxStorage {
  quota_bytes: number;
  used_bytes: number;
  mailboxes: Array<{ id: string; name: string; cap_bytes: number | null; used_bytes: number; message_count: number }>;
  folders: Array<{ mailbox_id: string; folder_id: string; name: string; role: string; bytes: number; count: number }>;
  /** The 30 largest messages. */
  largest: MailboxMessage[];
}

export interface MailboxSendResult {
  outbound_id: string;
  status: string;
  /** RFC 3339 time the message leaves (undo window or schedule); empty when sent now. */
  send_at: string;
  /** The Sent copy; `null` only if storing it failed after the message was queued. */
  message: MailboxMessage | null;
}

export interface MailboxUpdateResult {
  updated: string[];
  state: number;
}

/** A downloaded file (raw message or attachment). */
export interface MailboxFile {
  data: ArrayBuffer;
  contentType: string;
  filename: string | null;
  size: number;
  blob(): Blob;
}

/** Filters of `threads.list()` and `messages.list()`. */
export interface MailboxListQuery {
  /** A mailbox id; omit for every granted mailbox (unified inbox). */
  mailboxId?: string;
  /** A folder role, a folder id, `all` (not Spam/Trash) or `anywhere`. Default `inbox`. */
  folder?: MailboxFolderRole | 'all' | 'anywhere' | (string & {});
  /** Search: words, "phrases", from: to: subject: has:attachment is:unread in: before: after: larger: smaller:. */
  q?: string;
  /** `me`, `none` or a person id. */
  assigned?: string;
  status?: MailboxThreadStatus;
  unread?: boolean;
  flagged?: boolean;
  cursor?: string;
  /** 1–100, default 50. */
  limit?: number;
}

/** Flag and move changes for `threads.update()` and `messages.update()`. */
export interface MailboxPatch {
  ids: string[];
  seen?: boolean;
  flagged?: boolean;
  /** A folder role or a folder id in the same mailbox. */
  moveTo?: string;
}

/** An attachment of a draft or send: a fresh upload or an attachment of an existing message. */
export type MailboxAttachmentRef =
  | { uploadId: string; inline?: boolean; contentId?: string }
  | { messageId: string; index: number; inline?: boolean; contentId?: string };

/** The composer body of `drafts.save()` and `send()`. */
export interface MailboxComposeInput {
  mailboxId: string;
  /** Replace this draft (its id stays the same); on send, the draft is replaced by the Sent copy. */
  draftId?: string;
  /** An identity address from `me().identities`. Drafts default to the first one. */
  from?: string;
  to?: MailboxRecipient[];
  cc?: MailboxRecipient[];
  bcc?: MailboxRecipient[];
  subject?: string;
  text?: string;
  html?: string;
  /** Threads the message and sets In-Reply-To/References. */
  replyToMessageId?: string;
  attachments?: MailboxAttachmentRef[];
}

export interface MailboxSendInput extends MailboxComposeInput {
  from: string;
  /** Schedule up to 60 days ahead (RFC 3339 string or Date). Takes precedence over `undoSeconds`. */
  sendAt?: Date | string;
  /** Hold the message 0–30 seconds so `messages.cancelSend()` can stop it. */
  undoSeconds?: number;
  /** Sent as the `Idempotency-Key` header; reuse it when retrying the same send. */
  idempotencyKey?: string;
}

export interface MailboxClientOptions {
  /** A Mailbox API key (`hfmb_…`). */
  apiKey: string;
  /** The Mail node. Defaults to "https://mail.hubmail.space". */
  baseUrl?: string;
  /** Custom fetch (proxies, tests). */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds (default 30000). */
  timeout?: number;
}

/** Error codes of the mailbox client API worth branching on (`MailboxApiError.code`). */
export const MailboxErrorCodes = {
  /** 401: the key is unknown, revoked or malformed. */
  UNAUTHORIZED: 'unauthorized',
  /** 403: the key lacks the scope or mailbox role. */
  FORBIDDEN: 'forbidden',
  /** 403: the key may not send as this address. */
  SENDER_NOT_ALLOWED: 'sender_not_allowed',
  /** 404: not found, or not in a mailbox the key can read. */
  NOT_FOUND: 'not_found',
  /** 400: the request was rejected; `message` says why. */
  INVALID_REQUEST: 'invalid_request',
  /** 409: mailboxes are not enabled for the project. */
  MAILBOXES_NOT_ENABLED: 'mailboxes_not_enabled',
  /** 409: the sender's domain cannot send yet. */
  SENDER_NOT_READY: 'sender_not_ready',
  /** 409: the message already left; it can no longer be cancelled. */
  TOO_LATE: 'too_late',
  /** 409: the message is not waiting to be sent. */
  NOT_CANCELLABLE: 'not_cancellable',
  /** 413: attachments are larger than the policy allows. */
  ATTACHMENT_TOO_LARGE: 'attachment_too_large',
  /** 413: the composed message is too large. */
  MESSAGE_TOO_LARGE: 'message_too_large',
  /** 429: too many requests (30/s, bursts of 90); see `retryAfter`. */
  RATE_LIMITED: 'rate_limited',
  /** 429: the person's hourly or daily sending limit. */
  SEND_LIMIT_REACHED: 'send_limit_reached',
  /** 507: the storage pool or the mailbox cap is full; see `scope`, `limitBytes`, `usedBytes`. */
  STORAGE_FULL: 'storage_full',
} as const;

export type MailboxErrorCode = (typeof MailboxErrorCodes)[keyof typeof MailboxErrorCodes];

/** Error thrown by {@link MailboxClient} for any non-2xx answer, timeout or network failure. */
export class MailboxApiError extends Error {
  /** HTTP status; 0 for a network failure, 408 for a client-side timeout. */
  public readonly status: number;
  /** Machine-readable code (`error.code`), e.g. `storage_full`. */
  public readonly code: string;
  /** For `storage_full`: which limit was hit. */
  public readonly scope?: 'pool' | 'mailbox';
  /** For `storage_full` with scope `mailbox`: the mailbox at its cap. */
  public readonly mailboxId?: string;
  /** For `storage_full`: the limit in bytes. */
  public readonly limitBytes?: number;
  /** For `storage_full`: the bytes in use. */
  public readonly usedBytes?: number;
  /** Seconds from the `Retry-After` header (rate limits). */
  public readonly retryAfter?: number;
  /** When a sending limit resets, if the node said so. */
  public readonly resetAt?: string;
  /** The parsed error body. */
  public readonly body?: unknown;

  constructor(
    message: string,
    status: number,
    code: string,
    extra: {
      scope?: 'pool' | 'mailbox';
      mailboxId?: string;
      limitBytes?: number;
      usedBytes?: number;
      retryAfter?: number;
      resetAt?: string;
      body?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'MailboxApiError';
    this.status = status;
    this.code = code;
    if (extra.scope !== undefined) this.scope = extra.scope;
    if (extra.mailboxId !== undefined) this.mailboxId = extra.mailboxId;
    if (extra.limitBytes !== undefined) this.limitBytes = extra.limitBytes;
    if (extra.usedBytes !== undefined) this.usedBytes = extra.usedBytes;
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    if (extra.resetAt !== undefined) this.resetAt = extra.resetAt;
    if (extra.body !== undefined) this.body = extra.body;
    Object.setPrototypeOf(this, MailboxApiError.prototype);
  }
}

/** True when `error` is a MailboxApiError, optionally with the given `code`. */
export function isMailboxApiError(error: unknown, code?: string): error is MailboxApiError {
  return error instanceof MailboxApiError && (code === undefined || error.code === code);
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  /** JSON body. */
  json?: unknown;
  /** Raw body (uploads). */
  raw?: BodyInit;
  headers?: Record<string, string>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

async function errorFromResponse(response: Response): Promise<MailboxApiError> {
  const text = await response.text().catch(() => '');
  let body: unknown = text || undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON (a proxy page); keep the text.
  }
  const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const error = envelope.error;
  const payload = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const message =
    str(payload.message) ?? (typeof error === 'string' ? error : undefined) ?? (text && !text.startsWith('{') ? text.trim() : '');
  const retry = Number(response.headers.get('retry-after'));
  const scope = str(payload.scope);
  return new MailboxApiError(message || `HTTP ${response.status} Request Failed`, response.status, str(payload.code) ?? 'http_error', {
    scope: scope === 'pool' || scope === 'mailbox' ? scope : undefined,
    mailboxId: str(payload.mailbox_id) || undefined,
    limitBytes: num(payload.limit_bytes),
    usedBytes: num(payload.used_bytes),
    retryAfter: response.headers.has('retry-after') && Number.isFinite(retry) ? retry : undefined,
    resetAt: str(payload.reset_at) ?? str(envelope.reset_at),
    body,
  });
}

/** The filename of a Content-Disposition header (`filename*=` RFC 2231 first). */
function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[2]!.trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;\s]+))/i.exec(header);
  if (!plain) return null;
  return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2]!;
}

function recipients(list: MailboxRecipient[] | undefined): MailboxAddress[] | undefined {
  return list?.map((r) => (typeof r === 'string' ? { name: '', email: r } : { name: r.name ?? '', email: r.email }));
}

function composeBody(input: MailboxComposeInput): Record<string, unknown> {
  return {
    mailbox_id: input.mailboxId,
    draft_id: input.draftId,
    from: input.from,
    to: recipients(input.to),
    cc: recipients(input.cc),
    bcc: recipients(input.bcc),
    subject: input.subject,
    text: input.text,
    html: input.html,
    reply_to_message_id: input.replyToMessageId,
    attachments: input.attachments?.map((a) =>
      'uploadId' in a
        ? { upload_id: a.uploadId, inline: a.inline, content_id: a.contentId }
        : { message_id: a.messageId, index: a.index, inline: a.inline, content_id: a.contentId },
    ),
  };
}

function listQuery(query: MailboxListQuery): Query {
  return {
    mailbox: query.mailboxId,
    folder: query.folder,
    q: query.q,
    assigned: query.assigned,
    status: query.status,
    // The node only reads "true"; false means "no filter".
    unread: query.unread ? true : undefined,
    flagged: query.flagged ? true : undefined,
    cursor: query.cursor,
    limit: query.limit,
  };
}

function patchBody(patch: MailboxPatch) {
  return { ids: patch.ids, seen: patch.seen, flagged: patch.flagged, move_to: patch.moveTo };
}

/** Walks a cursor-paged list, yielding every item until `next_cursor` is empty. */
async function* cursorItems<T>(
  start: string | undefined,
  page: (cursor: string | undefined) => Promise<{ items: T[]; next_cursor: string }>,
): AsyncGenerator<T, void, undefined> {
  let cursor = start;
  for (;;) {
    const result = await page(cursor);
    for (const item of result.items) yield item;
    if (!result.next_cursor || result.next_cursor === cursor) return;
    cursor = result.next_cursor;
  }
}

function seg(value: string, name: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${name} must be a non-empty string`);
  return encodeURIComponent(value);
}

/** Custom folders: `mailbox.folders`. */
export class MailboxFoldersApi {
  constructor(private readonly client: MailboxClient) {}

  /** Folders with counts, of one mailbox or of every granted mailbox (`read`). */
  public list(options: { mailboxId?: string } = {}): Promise<MailboxFolder[]> {
    return this.client.request('GET', '/folders', { query: { mailbox: options.mailboxId } });
  }

  /** Creates a custom folder (`organize`). */
  public create(input: { mailboxId: string; name: string }): Promise<MailboxFolder> {
    return this.client.request('POST', '/folders', { json: { mailbox_id: input.mailboxId, name: input.name } });
  }

  /** Renames a custom folder (`organize`). */
  public async rename(folderId: string, name: string): Promise<void> {
    await this.client.request('PATCH', `/folders/${seg(folderId, 'folderId')}`, { json: { name } });
  }

  /** Deletes a custom folder; its mail moves to Archive (`organize`). */
  public async delete(folderId: string): Promise<void> {
    await this.client.request('DELETE', `/folders/${seg(folderId, 'folderId')}`);
  }

  /** Permanently empties Trash or Spam (`organize`). */
  public empty(folderId: string): Promise<{ deleted: number }> {
    return this.client.request('POST', `/folders/${seg(folderId, 'folderId')}/empty`);
  }
}

/** Conversations: `mailbox.threads`. */
export class MailboxThreadsApi {
  constructor(private readonly client: MailboxClient) {}

  /** One page of conversations, newest first (`read`). Defaults to the Inbox of every granted mailbox. */
  public async list(query: MailboxListQuery = {}): Promise<MailboxThreadPage> {
    const page = await this.client.request<Partial<MailboxThreadPage>>('GET', '/threads', { query: listQuery(query) });
    return { threads: page.threads ?? [], next_cursor: page.next_cursor ?? '', state: page.state ?? 0 };
  }

  /** Every conversation matching `query`, fetching pages as you iterate. */
  public iterate(query: MailboxListQuery = {}): AsyncGenerator<MailboxThreadSummary, void, undefined> {
    return cursorItems(query.cursor, async (cursor) => {
      const page = await this.list({ ...query, cursor });
      return { items: page.threads, next_cursor: page.next_cursor };
    });
  }

  /** A conversation with sanitised bodies, internal notes and presence (`read`). */
  public get(threadId: string): Promise<MailboxThread> {
    return this.client.request('GET', `/threads/${seg(threadId, 'threadId')}`);
  }

  /** Flags or moves whole conversations (`organize`). Sent and Drafts copies stay put, except for Trash. */
  public update(patch: MailboxPatch): Promise<MailboxUpdateResult> {
    return this.client.request('POST', '/threads/update', { json: patchBody(patch) });
  }

  /** Assigns a conversation, or unassigns it with `null` (`organize`, role `full`). */
  public async assign(threadId: string, assignee: MailboxPerson | null): Promise<void> {
    await this.client.request('POST', `/threads/${seg(threadId, 'threadId')}/assign`, { json: { assignee } });
  }

  /** Sets the shared-inbox status (`organize`, role `full`). */
  public async setStatus(threadId: string, status: MailboxThreadStatus): Promise<void> {
    await this.client.request('POST', `/threads/${seg(threadId, 'threadId')}/status`, { json: { status } });
  }

  /** Adds an internal note; notes are never sent (`read`). */
  public addNote(threadId: string, body: string): Promise<MailboxNote> {
    return this.client.request('POST', `/threads/${seg(threadId, 'threadId')}/notes`, { json: { body } });
  }

  /** Deletes an internal note: your own, or any with role `full` (`read`). */
  public async deleteNote(noteId: string): Promise<void> {
    await this.client.request('DELETE', `/notes/${seg(noteId, 'noteId')}`);
  }

  /** Reports viewing/replying (or `left`) and returns who is there; entries expire after 45 s (`read`). */
  public presence(threadId: string, kind: MailboxPresenceKind): Promise<MailboxPresence[]> {
    return this.client.request('POST', `/threads/${seg(threadId, 'threadId')}/presence`, { json: { kind } });
  }
}

/** Single messages: `mailbox.messages`. */
export class MailboxMessagesApi {
  constructor(private readonly client: MailboxClient) {}

  /** One page of messages, newest first (`read`). Same filters as `threads.list()`. */
  public async list(query: MailboxListQuery = {}): Promise<MailboxMessagePage> {
    const page = await this.client.request<Partial<MailboxMessagePage>>('GET', '/messages', { query: listQuery(query) });
    return { messages: page.messages ?? [], next_cursor: page.next_cursor ?? '', state: page.state ?? 0 };
  }

  /** Every message matching `query`, fetching pages as you iterate. */
  public iterate(query: MailboxListQuery = {}): AsyncGenerator<MailboxMessage, void, undefined> {
    return cursorItems(query.cursor, async (cursor) => {
      const page = await this.list({ ...query, cursor });
      return { items: page.messages, next_cursor: page.next_cursor };
    });
  }

  /** One message with its body; `{ body: false }` skips the body (`read`). */
  public get(messageId: string, options: { body?: boolean } = {}): Promise<MailboxMessage> {
    return this.client.request('GET', `/messages/${seg(messageId, 'messageId')}`, {
      query: { body: options.body === false ? false : undefined },
    });
  }

  /** The original `.eml` (`read`). */
  public raw(messageId: string): Promise<MailboxFile> {
    return this.client.download(`/messages/${seg(messageId, 'messageId')}/raw`);
  }

  /**
   * One attachment by its `index` (`read`). The node serves bytes as
   * `application/octet-stream` unless `inline` is set for a PNG, JPEG, GIF or
   * WebP; the original type is in the message's `attachments[]`.
   */
  public attachment(messageId: string, index: number, options: { inline?: boolean } = {}): Promise<MailboxFile> {
    if (!Number.isInteger(index) || index < 0) throw new TypeError('index must be a non-negative integer');
    return this.client.download(`/messages/${seg(messageId, 'messageId')}/attachments/${index}`, {
      inline: options.inline ? 1 : undefined,
    });
  }

  /** Flags or moves messages (`organize`). */
  public update(patch: MailboxPatch): Promise<MailboxUpdateResult> {
    return this.client.request('POST', '/messages/update', { json: patchBody(patch) });
  }

  /** Permanently deletes messages in Trash, Spam or Drafts (`organize`); 1–500 ids. */
  public delete(ids: string[]): Promise<{ deleted: number }> {
    return this.client.request('POST', '/messages/delete', { json: { ids } });
  }

  /**
   * Stops a send during its undo window or before `sendAt` and returns the
   * message as a draft again (`send`). Fails with 409 `too_late` once it left.
   */
  public cancelSend(messageId: string): Promise<MailboxMessage> {
    return this.client.request('POST', `/messages/${seg(messageId, 'messageId')}/cancel-send`);
  }
}

/** Drafts: `mailbox.drafts`. */
export class MailboxDraftsApi {
  constructor(private readonly client: MailboxClient) {}

  /** Saves a draft, or replaces `draftId` keeping its id (`organize`). Needs room in storage. */
  public save(input: MailboxComposeInput): Promise<MailboxMessage> {
    return this.client.request('POST', '/drafts', { json: composeBody(input) });
  }
}

/** Attachment uploads: `mailbox.uploads`. */
export class MailboxUploadsApi {
  constructor(private readonly client: MailboxClient) {}

  /**
   * Uploads a file to attach to a draft or send within 24 hours (`organize`).
   * The type defaults to the Blob's type and the name to the File's name.
   */
  public create(
    content: Blob | ArrayBuffer | ArrayBufferView | string,
    options: { filename?: string; contentType?: string } = {},
  ): Promise<MailboxUpload> {
    const blob = typeof Blob !== 'undefined' && content instanceof Blob ? content : undefined;
    const filename = options.filename ?? (blob && 'name' in blob && typeof blob.name === 'string' ? blob.name : undefined);
    const contentType = options.contentType || blob?.type || 'application/octet-stream';
    const headers: Record<string, string> = { 'Content-Type': contentType };
    // The node percent-decodes X-Filename, so any name (non-ASCII included) survives the header.
    if (filename) headers['X-Filename'] = encodeURIComponent(filename);
    return this.client.request('POST', '/uploads', { raw: content as BodyInit, headers });
  }
}

/** Blocked senders of a mailbox: `mailbox.blocked`. */
export class MailboxBlockedApi {
  constructor(private readonly client: MailboxClient) {}

  /** Blocked addresses and `@domain`s of a mailbox (`read`). */
  public list(mailboxId: string): Promise<string[]> {
    return this.client.request('GET', '/blocked', { query: { mailbox_id: mailboxId } });
  }

  /** Blocks an address or `@domain`; its mail lands in Spam (`organize`, role `full`). */
  public async add(mailboxId: string, email: string): Promise<void> {
    await this.client.request('POST', '/blocked', { json: { mailbox_id: mailboxId, email } });
  }

  /** Unblocks an address or `@domain` (`organize`, role `full`). */
  public async remove(mailboxId: string, email: string): Promise<void> {
    await this.client.request('DELETE', '/blocked', { query: { mailbox_id: mailboxId, email } });
  }
}

/**
 * Client of a HubFly Mail node's mailbox API, authenticated with a Mailbox
 * API key. Every non-2xx answer throws a {@link MailboxApiError}.
 *
 * ```ts
 * const mailbox = new MailboxClient({ apiKey: process.env.HUBFLY_MAILBOX_KEY! });
 * for await (const thread of mailbox.threads.iterate({ unread: true })) console.log(thread.subject);
 * ```
 */
export class MailboxClient {
  public readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly customFetch: typeof fetch;
  private readonly timeout: number;

  public readonly folders: MailboxFoldersApi;
  public readonly threads: MailboxThreadsApi;
  public readonly messages: MailboxMessagesApi;
  public readonly drafts: MailboxDraftsApi;
  public readonly uploads: MailboxUploadsApi;
  public readonly blocked: MailboxBlockedApi;

  constructor(options: MailboxClientOptions) {
    if (!options || typeof options.apiKey !== 'string' || options.apiKey === '') {
      throw new TypeError('MailboxClient: apiKey is required (a Mailbox API key, hfmb_…)');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://mail.hubmail.space').replace(/\/+$/, '');
    this.customFetch = options.fetch || globalThis.fetch;
    this.timeout = options.timeout || 30000;
    this.folders = new MailboxFoldersApi(this);
    this.threads = new MailboxThreadsApi(this);
    this.messages = new MailboxMessagesApi(this);
    this.drafts = new MailboxDraftsApi(this);
    this.uploads = new MailboxUploadsApi(this);
    this.blocked = new MailboxBlockedApi(this);
  }

  /** The caller, granted mailboxes with roles, folders, identities, pool usage, policy and `state` (`read`). */
  public me(): Promise<MailboxMe> {
    return this.request('GET', '/me');
  }

  /** The sync cursor; poll it cheaply and reload when it changes (`read`). */
  public state(): Promise<{ state: number }> {
    return this.request('GET', '/state');
  }

  /** The change log since a state (`read`). `limit` is 1–1000, default 500. */
  public changes(options: { since?: number; limit?: number } = {}): Promise<MailboxChanges> {
    return this.request('GET', '/changes', { query: { since: options.since, limit: options.limit } });
  }

  /**
   * Sends a message (`send`, role `full`, `from` must be a granted identity).
   * Resolves on 202 once the message is queued. A full mailbox cannot send
   * (507 `storage_full`) until space is freed.
   */
  public send(input: MailboxSendInput): Promise<MailboxSendResult> {
    const sendAt = input.sendAt instanceof Date ? input.sendAt.toISOString() : input.sendAt;
    const headers: Record<string, string> = {};
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey;
    return this.request('POST', '/send', {
      json: { ...composeBody(input), send_at: sendAt, undo_seconds: input.undoSeconds },
      headers,
    });
  }

  /** Address suggestions from mail sent and received (`read`). `limit` is 1–50, default 10. */
  public contacts(options: { q?: string; limit?: number } = {}): Promise<MailboxContact[]> {
    return this.request('GET', '/contacts', { query: { q: options.q, limit: options.limit } });
  }

  /** Pool, per-mailbox and per-folder usage and the 30 largest messages (`read`). */
  public storage(options: { mailboxId?: string } = {}): Promise<MailboxStorage> {
    return this.request('GET', '/storage', { query: { mailbox: options.mailboxId } });
  }

  private url(path: string, query?: Query): string {
    let url = `${this.baseUrl}/client/v1${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  private async call(method: string, path: string, options: RequestOptions, accept: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      Authorization: `Bearer ${this.apiKey}`,
      ...options.headers,
    };
    let body: BodyInit | undefined = options.raw;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await this.customFetch(this.url(path, options.query), { method, headers, body, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new MailboxApiError(`Request timed out after ${this.timeout}ms`, 408, 'timeout');
      }
      throw new MailboxApiError((err as Error)?.message || 'Network error connecting to the HubFly Mail node', 0, 'network_error');
    }
    clearTimeout(timer);
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  }

  /**
   * Calls one JSON endpoint under `/client/v1`. 204 answers resolve to `undefined`.
   * @internal Used by the mailbox APIs; prefer their methods.
   */
  public async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.call(method, path, options, 'application/json');
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Downloads a binary endpoint under `/client/v1`.
   * @internal Used by `messages.raw()` and `messages.attachment()`.
   */
  public async download(path: string, query?: Query): Promise<MailboxFile> {
    const response = await this.call('GET', path, { query }, '*/*');
    const data = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return {
      data,
      contentType,
      filename: dispositionFilename(response.headers.get('content-disposition')),
      size: data.byteLength,
      blob: () => new Blob([data], { type: contentType }),
    };
  }
}

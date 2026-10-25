// Package mailbox is the Go client of the HubFly Mail mailbox API: the
// regional Mail node's /client/v1, authenticated with a Mailbox API key
// (hfmb_…) created in the Dashboard (hubfly.Client.Mail.MailboxKeys.Create).
//
// A key carries scopes (read, organize, send) and a role per mailbox (read,
// full, owner). Every non-2xx answer is returned as an *APIError; a full
// mailbox or storage pool answers 507 storage_full with Scope, LimitBytes and
// UsedBytes.
//
//	mb := mailbox.NewClient(os.Getenv("HUBFLY_MAILBOX_KEY"))
//	it := mb.IterateThreads(mailbox.ListQuery{Unread: true})
//	for it.Next(ctx) {
//		fmt.Println(it.Value().Subject)
//	}
//	if err := it.Err(); err != nil {
//		log.Fatal(err)
//	}
package mailbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is the public HubFly Mail node.
const DefaultBaseURL = "https://mail.hubmail.space"

// Error codes worth branching on (APIError.Code); see IsErrorCode.
const (
	ErrCodeUnauthorized        = "unauthorized"          // 401: unknown, revoked or malformed key
	ErrCodeForbidden           = "forbidden"             // 403: missing scope or mailbox role
	ErrCodeSenderNotAllowed    = "sender_not_allowed"    // 403: the key may not send as this address
	ErrCodeNotFound            = "not_found"             // 404
	ErrCodeInvalidRequest      = "invalid_request"       // 400: Message says why
	ErrCodeMailboxesNotEnabled = "mailboxes_not_enabled" // 409
	ErrCodeSenderNotReady      = "sender_not_ready"      // 409: the identity's domain cannot send
	ErrCodeTooLate             = "too_late"              // 409: the message already left
	ErrCodeNotCancellable      = "not_cancellable"       // 409: the message is not waiting to be sent
	ErrCodeAttachmentTooLarge  = "attachment_too_large"  // 413
	ErrCodeMessageTooLarge     = "message_too_large"     // 413
	ErrCodeRateLimited         = "rate_limited"          // 429: 30 requests/s, bursts of 90; see RetryAfter
	ErrCodeSendLimitReached    = "send_limit_reached"    // 429: personal hourly or daily sending limit
	ErrCodeStorageFull         = "storage_full"          // 507: see Scope, LimitBytes, UsedBytes
)

// APIError is a non-2xx answer of the mailbox API.
type APIError struct {
	StatusCode int
	Code       string
	Message    string
	// Scope is "pool" or "mailbox" for storage_full.
	Scope string
	// MailboxID is the mailbox at its cap for storage_full with scope "mailbox".
	MailboxID string
	// LimitBytes and UsedBytes are set for storage_full.
	LimitBytes int64
	UsedBytes  int64
	// RetryAfter comes from the Retry-After header (rate limits).
	RetryAfter time.Duration
	// ResetAt is when a sending limit resets, if the node said so.
	ResetAt string
	// Body is the raw error body.
	Body []byte
}

func (e *APIError) Error() string {
	return fmt.Sprintf("hubfly mailbox api error [HTTP %d %s]: %s", e.StatusCode, e.Code, e.Message)
}

// IsErrorCode reports whether err is (or wraps) an *APIError with the given code.
func IsErrorCode(err error, code string) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Code == code
}

func parseError(res *http.Response, body []byte) *APIError {
	e := &APIError{StatusCode: res.StatusCode, Code: "http_error", Body: body}
	var envelope struct {
		Error   json.RawMessage `json:"error"`
		ResetAt string          `json:"reset_at"`
	}
	var payload struct {
		Code       string `json:"code"`
		Message    string `json:"message"`
		Scope      string `json:"scope"`
		MailboxID  string `json:"mailbox_id"`
		LimitBytes int64  `json:"limit_bytes"`
		UsedBytes  int64  `json:"used_bytes"`
		ResetAt    string `json:"reset_at"`
	}
	if json.Unmarshal(body, &envelope) == nil && json.Unmarshal(envelope.Error, &payload) == nil {
		if payload.Code != "" {
			e.Code = payload.Code
		}
		e.Message, e.Scope, e.MailboxID = payload.Message, payload.Scope, payload.MailboxID
		e.LimitBytes, e.UsedBytes = payload.LimitBytes, payload.UsedBytes
		e.ResetAt = payload.ResetAt
		if e.ResetAt == "" {
			e.ResetAt = envelope.ResetAt
		}
	} else if text := strings.TrimSpace(string(body)); text != "" && !strings.HasPrefix(text, "{") {
		e.Message = text
	}
	if e.Message == "" {
		e.Message = http.StatusText(res.StatusCode)
	}
	if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil {
		e.RetryAfter = time.Duration(s) * time.Second
	}
	return e
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURL overrides the Mail node (default DefaultBaseURL).
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") } }

// WithHTTPClient sets the http.Client.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.httpClient = h } }

// WithTimeout sets the request timeout (default 30 s).
func WithTimeout(d time.Duration) Option { return func(c *Client) { c.httpClient.Timeout = d } }

// Client calls one Mail node with a Mailbox API key. It is safe for concurrent use.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient returns a client for the Mailbox API key apiKey (hfmb_…).
func NewClient(apiKey string, opts ...Option) *Client {
	c := &Client{baseURL: DefaultBaseURL, apiKey: apiKey, httpClient: &http.Client{Timeout: 30 * time.Second}}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// String never prints the key.
func (c *Client) String() string { return fmt.Sprintf("mailbox.Client{baseURL: %q}", c.baseURL) }

func seg(name, v string) (string, error) {
	if v == "" {
		return "", fmt.Errorf("mailbox: %s is required", name)
	}
	return url.PathEscape(v), nil
}

type request struct {
	method  string
	path    string
	query   url.Values
	json    any
	raw     io.Reader
	headers map[string]string
}

func (c *Client) do(ctx context.Context, r request) (*http.Response, []byte, error) {
	u := c.baseURL + "/client/v1" + r.path
	if len(r.query) > 0 {
		u += "?" + r.query.Encode()
	}
	body := r.raw
	if r.json != nil {
		encoded, err := json.Marshal(r.json)
		if err != nil {
			return nil, nil, fmt.Errorf("mailbox: encode request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, r.method, u, body)
	if err != nil {
		return nil, nil, fmt.Errorf("mailbox: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	if r.json != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("mailbox: request failed: %w", err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("mailbox: read response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, nil, parseError(res, data)
	}
	return res, data, nil
}

// call sends a JSON request and decodes the answer into out (unless out is nil or the answer is empty).
func (c *Client) call(ctx context.Context, r request, out any) error {
	_, data, err := c.do(ctx, r)
	if err != nil {
		return err
	}
	if out == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("mailbox: decode response: %w", err)
	}
	return nil
}

// callT is call for a single object result: nil on error.
func callT[T any](ctx context.Context, c *Client, r request) (*T, error) {
	var out T
	if err := c.call(ctx, r, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) download(ctx context.Context, path string, query url.Values) (*File, error) {
	res, data, err := c.do(ctx, request{method: http.MethodGet, path: path, query: query})
	if err != nil {
		return nil, err
	}
	f := &File{Data: data, ContentType: res.Header.Get("Content-Type")}
	if _, params, err := mime.ParseMediaType(res.Header.Get("Content-Disposition")); err == nil {
		f.Filename = params["filename"]
	}
	return f, nil
}

// Me returns the caller, granted mailboxes with roles, folders, identities, pool usage, policy and state (read).
func (c *Client) Me(ctx context.Context) (*Me, error) {
	return callT[Me](ctx, c, request{method: http.MethodGet, path: "/me"})
}

// State returns the sync cursor; poll it cheaply and reload when it changes (read).
func (c *Client) State(ctx context.Context) (int64, error) {
	var out struct {
		State int64 `json:"state"`
	}
	err := c.call(ctx, request{method: http.MethodGet, path: "/state"}, &out)
	return out.State, err
}

// Changes returns the change log after since (read). limit is 1-1000; 0 means 500.
func (c *Client) Changes(ctx context.Context, since int64, limit int) (*Changes, error) {
	q := url.Values{"since": {strconv.FormatInt(since, 10)}}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	return callT[Changes](ctx, c, request{method: http.MethodGet, path: "/changes", query: q})
}

// Folders lists the folders of mailboxID, or of every granted mailbox when it is empty (read).
func (c *Client) Folders(ctx context.Context, mailboxID string) ([]Folder, error) {
	q := url.Values{}
	if mailboxID != "" {
		q.Set("mailbox", mailboxID)
	}
	var out []Folder
	return out, c.call(ctx, request{method: http.MethodGet, path: "/folders", query: q}, &out)
}

// CreateFolder creates a custom folder (organize).
func (c *Client) CreateFolder(ctx context.Context, mailboxID, name string) (*Folder, error) {
	body := map[string]string{"mailbox_id": mailboxID, "name": name}
	return callT[Folder](ctx, c, request{method: http.MethodPost, path: "/folders", json: body})
}

// RenameFolder renames a custom folder (organize).
func (c *Client) RenameFolder(ctx context.Context, folderID, name string) error {
	id, err := seg("folderID", folderID)
	if err != nil {
		return err
	}
	return c.call(ctx, request{method: http.MethodPatch, path: "/folders/" + id, json: map[string]string{"name": name}}, nil)
}

// DeleteFolder deletes a custom folder; its mail moves to Archive (organize).
func (c *Client) DeleteFolder(ctx context.Context, folderID string) error {
	id, err := seg("folderID", folderID)
	if err != nil {
		return err
	}
	return c.call(ctx, request{method: http.MethodDelete, path: "/folders/" + id}, nil)
}

// EmptyFolder permanently empties Trash or Spam and returns how many messages it deleted (organize).
func (c *Client) EmptyFolder(ctx context.Context, folderID string) (int, error) {
	id, err := seg("folderID", folderID)
	if err != nil {
		return 0, err
	}
	var out struct {
		Deleted int `json:"deleted"`
	}
	err = c.call(ctx, request{method: http.MethodPost, path: "/folders/" + id + "/empty"}, &out)
	return out.Deleted, err
}

func (q ListQuery) values() url.Values {
	v := url.Values{}
	set := func(k, s string) {
		if s != "" {
			v.Set(k, s)
		}
	}
	set("mailbox", q.MailboxID)
	set("folder", q.Folder)
	set("q", q.Q)
	set("assigned", q.Assigned)
	set("status", q.Status)
	set("cursor", q.Cursor)
	if q.Unread {
		v.Set("unread", "true")
	}
	if q.Flagged {
		v.Set("flagged", "true")
	}
	if q.Limit > 0 {
		v.Set("limit", strconv.Itoa(q.Limit))
	}
	return v
}

// ListThreads returns one page of conversations, newest first (read). The
// zero ListQuery lists the Inbox of every granted mailbox.
func (c *Client) ListThreads(ctx context.Context, query ListQuery) (*ThreadPage, error) {
	var out ThreadPage
	if err := c.call(ctx, request{method: http.MethodGet, path: "/threads", query: query.values()}, &out); err != nil {
		return nil, err
	}
	if out.Threads == nil {
		out.Threads = []ThreadSummary{}
	}
	return &out, nil
}

// Thread returns a conversation with sanitised bodies, notes and presence (read).
func (c *Client) Thread(ctx context.Context, threadID string) (*Thread, error) {
	id, err := seg("threadID", threadID)
	if err != nil {
		return nil, err
	}
	return callT[Thread](ctx, c, request{method: http.MethodGet, path: "/threads/" + id})
}

// UpdateThreads flags or moves whole conversations (organize). Sent and
// Drafts copies stay put, except for Trash.
func (c *Client) UpdateThreads(ctx context.Context, patch Patch) (*UpdateResult, error) {
	return callT[UpdateResult](ctx, c, request{method: http.MethodPost, path: "/threads/update", json: patch})
}

// AssignThread assigns a conversation, or unassigns it with nil (organize, role full).
func (c *Client) AssignThread(ctx context.Context, threadID string, assignee *Person) error {
	id, err := seg("threadID", threadID)
	if err != nil {
		return err
	}
	body := struct {
		Assignee *Person `json:"assignee"`
	}{assignee}
	return c.call(ctx, request{method: http.MethodPost, path: "/threads/" + id + "/assign", json: body}, nil)
}

// SetThreadStatus sets open, pending or done (organize, role full).
func (c *Client) SetThreadStatus(ctx context.Context, threadID, status string) error {
	id, err := seg("threadID", threadID)
	if err != nil {
		return err
	}
	return c.call(ctx, request{method: http.MethodPost, path: "/threads/" + id + "/status", json: map[string]string{"status": status}}, nil)
}

// AddNote adds an internal note to a conversation (read).
func (c *Client) AddNote(ctx context.Context, threadID, body string) (*Note, error) {
	id, err := seg("threadID", threadID)
	if err != nil {
		return nil, err
	}
	return callT[Note](ctx, c, request{method: http.MethodPost, path: "/threads/" + id + "/notes", json: map[string]string{"body": body}})
}

// DeleteNote deletes an internal note: your own, or any with role full (read).
func (c *Client) DeleteNote(ctx context.Context, noteID string) error {
	id, err := seg("noteID", noteID)
	if err != nil {
		return err
	}
	return c.call(ctx, request{method: http.MethodDelete, path: "/notes/" + id}, nil)
}

// Presence reports viewing, replying or left and returns who is on the conversation (read).
func (c *Client) Presence(ctx context.Context, threadID, kind string) ([]Presence, error) {
	id, err := seg("threadID", threadID)
	if err != nil {
		return nil, err
	}
	var out []Presence
	return out, c.call(ctx, request{method: http.MethodPost, path: "/threads/" + id + "/presence", json: map[string]string{"kind": kind}}, &out)
}

// ListMessages returns one page of messages, newest first (read). Same filters as ListThreads.
func (c *Client) ListMessages(ctx context.Context, query ListQuery) (*MessagePage, error) {
	var out MessagePage
	if err := c.call(ctx, request{method: http.MethodGet, path: "/messages", query: query.values()}, &out); err != nil {
		return nil, err
	}
	if out.Messages == nil {
		out.Messages = []Message{}
	}
	return &out, nil
}

// Message returns one message; withBody false skips the body (read).
func (c *Client) Message(ctx context.Context, messageID string, withBody bool) (*Message, error) {
	id, err := seg("messageID", messageID)
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	if !withBody {
		q.Set("body", "false")
	}
	return callT[Message](ctx, c, request{method: http.MethodGet, path: "/messages/" + id, query: q})
}

// RawMessage downloads the original .eml (read).
func (c *Client) RawMessage(ctx context.Context, messageID string) (*File, error) {
	id, err := seg("messageID", messageID)
	if err != nil {
		return nil, err
	}
	return c.download(ctx, "/messages/"+id+"/raw", nil)
}

// Attachment downloads attachment index of a message (read). The node serves
// application/octet-stream unless inline is set for a PNG, JPEG, GIF or WebP;
// the original type is in Message.Attachments.
func (c *Client) Attachment(ctx context.Context, messageID string, index int, inline bool) (*File, error) {
	id, err := seg("messageID", messageID)
	if err != nil {
		return nil, err
	}
	if index < 0 {
		return nil, errors.New("mailbox: attachment index must not be negative")
	}
	q := url.Values{}
	if inline {
		q.Set("inline", "1")
	}
	return c.download(ctx, "/messages/"+id+"/attachments/"+strconv.Itoa(index), q)
}

// UpdateMessages flags or moves messages (organize).
func (c *Client) UpdateMessages(ctx context.Context, patch Patch) (*UpdateResult, error) {
	return callT[UpdateResult](ctx, c, request{method: http.MethodPost, path: "/messages/update", json: patch})
}

// DeleteMessages permanently deletes messages in Trash, Spam or Drafts (organize; 1-500 ids).
func (c *Client) DeleteMessages(ctx context.Context, ids []string) (int, error) {
	var out struct {
		Deleted int `json:"deleted"`
	}
	err := c.call(ctx, request{method: http.MethodPost, path: "/messages/delete", json: map[string][]string{"ids": ids}}, &out)
	return out.Deleted, err
}

// CancelSend stops a send during its undo window or before its scheduled
// time and returns it as a draft (send). It fails with 409 too_late once the message left.
func (c *Client) CancelSend(ctx context.Context, messageID string) (*Message, error) {
	id, err := seg("messageID", messageID)
	if err != nil {
		return nil, err
	}
	return callT[Message](ctx, c, request{method: http.MethodPost, path: "/messages/" + id + "/cancel-send"})
}

// SaveDraft saves a draft, or replaces Compose.DraftID keeping its id (organize). Needs room in storage.
func (c *Client) SaveDraft(ctx context.Context, draft Compose) (*Message, error) {
	return callT[Message](ctx, c, request{method: http.MethodPost, path: "/drafts", json: draft})
}

// Send sends a message (send, role full; From must be a granted identity) and
// returns once it is queued. A full mailbox cannot send (507 storage_full)
// until space is freed. opts may be nil.
func (c *Client) Send(ctx context.Context, message Compose, opts *SendOptions) (*SendResult, error) {
	body := struct {
		Compose
		SendAt      string `json:"send_at,omitempty"`
		UndoSeconds int    `json:"undo_seconds,omitempty"`
	}{Compose: message}
	headers := map[string]string{}
	if opts != nil {
		if !opts.SendAt.IsZero() {
			body.SendAt = opts.SendAt.UTC().Format(time.RFC3339)
		}
		body.UndoSeconds = opts.UndoSeconds
		if opts.IdempotencyKey != "" {
			headers["Idempotency-Key"] = opts.IdempotencyKey
		}
	}
	return callT[SendResult](ctx, c, request{method: http.MethodPost, path: "/send", json: body, headers: headers})
}

// Upload uploads an attachment to use in a draft or send within 24 hours
// (organize). contentType defaults to application/octet-stream.
func (c *Client) Upload(ctx context.Context, content io.Reader, filename, contentType string) (*Upload, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	headers := map[string]string{"Content-Type": contentType}
	if filename != "" {
		// The node percent-decodes X-Filename, so any name survives the header.
		headers["X-Filename"] = url.PathEscape(filename)
	}
	return callT[Upload](ctx, c, request{method: http.MethodPost, path: "/uploads", raw: content, headers: headers})
}

// Contacts suggests addresses from mail sent and received (read). limit is 1-50; 0 means 10.
func (c *Client) Contacts(ctx context.Context, q string, limit int) ([]Contact, error) {
	v := url.Values{}
	if q != "" {
		v.Set("q", q)
	}
	if limit > 0 {
		v.Set("limit", strconv.Itoa(limit))
	}
	var out []Contact
	return out, c.call(ctx, request{method: http.MethodGet, path: "/contacts", query: v}, &out)
}

// Storage returns pool, per-mailbox and per-folder usage and the 30 largest
// messages (of mailboxID when set) (read).
func (c *Client) Storage(ctx context.Context, mailboxID string) (*Storage, error) {
	q := url.Values{}
	if mailboxID != "" {
		q.Set("mailbox", mailboxID)
	}
	return callT[Storage](ctx, c, request{method: http.MethodGet, path: "/storage", query: q})
}

// BlockedSenders lists the blocked addresses and @domains of a mailbox (read).
func (c *Client) BlockedSenders(ctx context.Context, mailboxID string) ([]string, error) {
	var out []string
	return out, c.call(ctx, request{method: http.MethodGet, path: "/blocked", query: url.Values{"mailbox_id": {mailboxID}}}, &out)
}

// BlockSender blocks an address or @domain; its mail lands in Spam (organize, role full).
func (c *Client) BlockSender(ctx context.Context, mailboxID, email string) error {
	return c.call(ctx, request{method: http.MethodPost, path: "/blocked", json: map[string]string{"mailbox_id": mailboxID, "email": email}}, nil)
}

// UnblockSender unblocks an address or @domain (organize, role full).
func (c *Client) UnblockSender(ctx context.Context, mailboxID, email string) error {
	return c.call(ctx, request{method: http.MethodDelete, path: "/blocked", query: url.Values{"mailbox_id": {mailboxID}, "email": {email}}}, nil)
}

// Iterator walks a cursor-paged list:
//
//	for it.Next(ctx) { use(it.Value()) }
//	if err := it.Err(); err != nil { … }
type Iterator[T any] struct {
	fetch  func(ctx context.Context, cursor string) ([]T, string, error)
	cursor string
	buf    []T
	cur    T
	done   bool
	err    error
}

// Next advances to the next item, fetching the next page when needed. It
// returns false at the end or on an error (see Err).
func (it *Iterator[T]) Next(ctx context.Context) bool {
	for len(it.buf) == 0 {
		if it.done || it.err != nil {
			return false
		}
		items, next, err := it.fetch(ctx, it.cursor)
		if err != nil {
			it.err = err
			return false
		}
		it.buf = items
		if next == "" || next == it.cursor {
			it.done = true
		}
		it.cursor = next
	}
	it.cur, it.buf = it.buf[0], it.buf[1:]
	return true
}

// Value is the current item.
func (it *Iterator[T]) Value() T { return it.cur }

// Err is the error that stopped the iteration, if any.
func (it *Iterator[T]) Err() error { return it.err }

// IterateThreads walks every conversation matching query, page by page.
func (c *Client) IterateThreads(query ListQuery) *Iterator[ThreadSummary] {
	return &Iterator[ThreadSummary]{cursor: query.Cursor, fetch: func(ctx context.Context, cursor string) ([]ThreadSummary, string, error) {
		q := query
		q.Cursor = cursor
		page, err := c.ListThreads(ctx, q)
		if err != nil {
			return nil, "", err
		}
		return page.Threads, page.NextCursor, nil
	}}
}

// IterateMessages walks every message matching query, page by page.
func (c *Client) IterateMessages(query ListQuery) *Iterator[Message] {
	return &Iterator[Message]{cursor: query.Cursor, fetch: func(ctx context.Context, cursor string) ([]Message, string, error) {
		q := query
		q.Cursor = cursor
		page, err := c.ListMessages(ctx, q)
		if err != nil {
			return nil, "", err
		}
		return page.Messages, page.NextCursor, nil
	}}
}

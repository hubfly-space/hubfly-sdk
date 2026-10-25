package mailbox_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hubfly/hubfly-sdk/go/mailbox"
)

type recorded struct {
	Method  string
	Path    string // escaped
	Query   map[string]string
	Header  http.Header
	Body    []byte
	JSONMap map[string]any
}

type reply struct {
	status  int
	body    string
	headers map[string]string
}

type fakeNode struct {
	mu       sync.Mutex
	requests []recorded
}

func (f *fakeNode) all() []recorded {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recorded(nil), f.requests...)
}

func newFake(t *testing.T, respond func(r recorded) reply) (*fakeNode, *mailbox.Client) {
	t.Helper()
	fake := &fakeNode{}
	if respond == nil {
		respond = func(r recorded) reply {
			switch {
			case r.Method == "GET" && (r.Path == "/client/v1/folders" || r.Path == "/client/v1/contacts" || r.Path == "/client/v1/blocked"),
				strings.HasSuffix(r.Path, "/presence"):
				return reply{body: `[]`}
			}
			return reply{body: `{}`}
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec := recorded{Method: r.Method, Path: r.URL.EscapedPath(), Query: map[string]string{}, Header: r.Header.Clone(), Body: body}
		for k := range r.URL.Query() {
			rec.Query[k] = r.URL.Query().Get(k)
		}
		if r.Header.Get("Content-Type") == "application/json" {
			_ = json.Unmarshal(body, &rec.JSONMap)
		}
		fake.mu.Lock()
		fake.requests = append(fake.requests, rec)
		fake.mu.Unlock()
		rep := respond(rec)
		if rep.status == 0 {
			rep.status = 200
		}
		if rep.headers == nil {
			rep.headers = map[string]string{"Content-Type": "application/json"}
		}
		for k, v := range rep.headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(rep.status)
		_, _ = io.WriteString(w, rep.body)
	}))
	t.Cleanup(server.Close)
	return fake, mailbox.NewClient("hfmb_test", mailbox.WithBaseURL(server.URL+"/"))
}

func jsonOf(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("bad test json %s: %v", s, err)
	}
	return m
}

func TestEndpoints(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name   string
		call   func(c *mailbox.Client) error
		method string
		path   string
		query  map[string]string
		body   string // expected JSON body, "" for none
	}{
		{"me", func(c *mailbox.Client) error { _, err := c.Me(ctx); return err }, "GET", "/me", nil, ""},
		{"state", func(c *mailbox.Client) error { _, err := c.State(ctx); return err }, "GET", "/state", nil, ""},
		{"changes", func(c *mailbox.Client) error { _, err := c.Changes(ctx, 10, 100); return err }, "GET", "/changes", map[string]string{"since": "10", "limit": "100"}, ""},
		{"folders", func(c *mailbox.Client) error { _, err := c.Folders(ctx, "mbx_1"); return err }, "GET", "/folders", map[string]string{"mailbox": "mbx_1"}, ""},
		{"create folder", func(c *mailbox.Client) error { _, err := c.CreateFolder(ctx, "mbx_1", "Clients"); return err }, "POST", "/folders", nil, `{"mailbox_id":"mbx_1","name":"Clients"}`},
		{"rename folder", func(c *mailbox.Client) error { return c.RenameFolder(ctx, "fld_1", "VIP") }, "PATCH", "/folders/fld_1", nil, `{"name":"VIP"}`},
		{"delete folder", func(c *mailbox.Client) error { return c.DeleteFolder(ctx, "fld_1") }, "DELETE", "/folders/fld_1", nil, ""},
		{"empty folder", func(c *mailbox.Client) error { _, err := c.EmptyFolder(ctx, "fld_t"); return err }, "POST", "/folders/fld_t/empty", nil, ""},
		{"thread", func(c *mailbox.Client) error { _, err := c.Thread(ctx, "thr_1"); return err }, "GET", "/threads/thr_1", nil, ""},
		{"update threads", func(c *mailbox.Client) error {
			_, err := c.UpdateThreads(ctx, mailbox.Patch{IDs: []string{"thr_1"}, Seen: mailbox.Bool(true), MoveTo: "archive"})
			return err
		}, "POST", "/threads/update", nil, `{"ids":["thr_1"],"seen":true,"move_to":"archive"}`},
		{"assign", func(c *mailbox.Client) error {
			return c.AssignThread(ctx, "thr_1", &mailbox.Person{ID: "u1", Name: "Ann"})
		}, "POST", "/threads/thr_1/assign", nil, `{"assignee":{"id":"u1","name":"Ann"}}`},
		{"unassign", func(c *mailbox.Client) error { return c.AssignThread(ctx, "thr_1", nil) }, "POST", "/threads/thr_1/assign", nil, `{"assignee":null}`},
		{"status", func(c *mailbox.Client) error { return c.SetThreadStatus(ctx, "thr_1", mailbox.StatusDone) }, "POST", "/threads/thr_1/status", nil, `{"status":"done"}`},
		{"add note", func(c *mailbox.Client) error { _, err := c.AddNote(ctx, "thr_1", "call them"); return err }, "POST", "/threads/thr_1/notes", nil, `{"body":"call them"}`},
		{"delete note", func(c *mailbox.Client) error { return c.DeleteNote(ctx, "note_1") }, "DELETE", "/notes/note_1", nil, ""},
		{"presence", func(c *mailbox.Client) error {
			_, err := c.Presence(ctx, "thr_1", mailbox.PresenceReplying)
			return err
		}, "POST", "/threads/thr_1/presence", nil, `{"kind":"replying"}`},
		{"message", func(c *mailbox.Client) error { _, err := c.Message(ctx, "msg_1", true); return err }, "GET", "/messages/msg_1", nil, ""},
		{"message without body", func(c *mailbox.Client) error { _, err := c.Message(ctx, "msg_1", false); return err }, "GET", "/messages/msg_1", map[string]string{"body": "false"}, ""},
		{"update messages", func(c *mailbox.Client) error {
			_, err := c.UpdateMessages(ctx, mailbox.Patch{IDs: []string{"msg_1"}, Flagged: mailbox.Bool(false)})
			return err
		}, "POST", "/messages/update", nil, `{"ids":["msg_1"],"flagged":false}`},
		{"delete messages", func(c *mailbox.Client) error { _, err := c.DeleteMessages(ctx, []string{"msg_1"}); return err }, "POST", "/messages/delete", nil, `{"ids":["msg_1"]}`},
		{"cancel send", func(c *mailbox.Client) error { _, err := c.CancelSend(ctx, "msg_1"); return err }, "POST", "/messages/msg_1/cancel-send", nil, ""},
		{"contacts", func(c *mailbox.Client) error { _, err := c.Contacts(ctx, "bo", 5); return err }, "GET", "/contacts", map[string]string{"q": "bo", "limit": "5"}, ""},
		{"storage", func(c *mailbox.Client) error { _, err := c.Storage(ctx, "mbx_1"); return err }, "GET", "/storage", map[string]string{"mailbox": "mbx_1"}, ""},
		{"blocked", func(c *mailbox.Client) error { _, err := c.BlockedSenders(ctx, "mbx_1"); return err }, "GET", "/blocked", map[string]string{"mailbox_id": "mbx_1"}, ""},
		{"block", func(c *mailbox.Client) error { return c.BlockSender(ctx, "mbx_1", "@spam.test") }, "POST", "/blocked", nil, `{"mailbox_id":"mbx_1","email":"@spam.test"}`},
		{"unblock", func(c *mailbox.Client) error { return c.UnblockSender(ctx, "mbx_1", "@spam.test") }, "DELETE", "/blocked", map[string]string{"mailbox_id": "mbx_1", "email": "@spam.test"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake, c := newFake(t, nil)
			if err := tc.call(c); err != nil {
				t.Fatalf("call: %v", err)
			}
			reqs := fake.all()
			if len(reqs) != 1 {
				t.Fatalf("got %d requests", len(reqs))
			}
			r := reqs[0]
			if r.Method != tc.method || r.Path != "/client/v1"+tc.path {
				t.Errorf("got %s %s, want %s /client/v1%s", r.Method, r.Path, tc.method, tc.path)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer hfmb_test" {
				t.Errorf("authorization %q", got)
			}
			want := tc.query
			if want == nil {
				want = map[string]string{}
			}
			if !reflect.DeepEqual(r.Query, want) {
				t.Errorf("query %v, want %v", r.Query, want)
			}
			if tc.body == "" {
				if len(r.Body) != 0 {
					t.Errorf("unexpected body %s", r.Body)
				}
			} else if !reflect.DeepEqual(r.JSONMap, jsonOf(t, tc.body)) {
				t.Errorf("body %s, want %s", r.Body, tc.body)
			}
		})
	}
}

func TestEmptyIDsAreRejected(t *testing.T) {
	_, c := newFake(t, nil)
	if _, err := c.Thread(context.Background(), ""); err == nil {
		t.Fatal("expected an error for an empty thread id")
	}
	if _, err := c.Attachment(context.Background(), "msg_1", -1, false); err == nil {
		t.Fatal("expected an error for a negative index")
	}
}

func TestPathIDsAreEscaped(t *testing.T) {
	fake, c := newFake(t, nil)
	if _, err := c.Thread(context.Background(), "a/b"); err != nil {
		t.Fatal(err)
	}
	if got := fake.all()[0].Path; got != "/client/v1/threads/a%2Fb" {
		t.Fatalf("path %s", got)
	}
}

func TestListQueryAndEmptyPages(t *testing.T) {
	fake, c := newFake(t, func(recorded) reply { return reply{body: `{"next_cursor":"","state":7}`} })
	page, err := c.ListThreads(context.Background(), mailbox.ListQuery{
		MailboxID: "mbx_1", Folder: "anywhere", Q: "from:bob", Assigned: "me", Status: mailbox.StatusOpen, Unread: true, Cursor: "c1", Limit: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	// The node omits an empty threads array; the SDK still returns a non-nil slice.
	if page.Threads == nil || len(page.Threads) != 0 || page.State != 7 {
		t.Fatalf("page %+v", page)
	}
	want := map[string]string{"mailbox": "mbx_1", "folder": "anywhere", "q": "from:bob", "assigned": "me", "status": "open", "unread": "true", "cursor": "c1", "limit": "20"}
	if got := fake.all()[0].Query; !reflect.DeepEqual(got, want) {
		t.Fatalf("query %v, want %v", got, want)
	}
	msgs, err := c.ListMessages(context.Background(), mailbox.ListQuery{})
	if err != nil || msgs.Messages == nil {
		t.Fatalf("messages %+v, %v", msgs, err)
	}
	if got := fake.all()[1]; got.Path != "/client/v1/messages" || len(got.Query) != 0 {
		t.Fatalf("messages request %+v", got)
	}
}

func TestIterators(t *testing.T) {
	pages := map[string]struct {
		ids  []string
		next string
	}{
		"":   {[]string{"t1", "t2"}, "c1"},
		"c1": {[]string{}, "c2"}, // an empty page in the middle must not end the walk
		"c2": {[]string{"t3"}, ""},
	}
	fake, c := newFake(t, func(r recorded) reply {
		p := pages[r.Query["cursor"]]
		items := []map[string]string{}
		for _, id := range p.ids {
			items = append(items, map[string]string{"id": id})
		}
		key := "threads"
		if strings.HasSuffix(r.Path, "/messages") {
			key = "messages"
		}
		body, _ := json.Marshal(map[string]any{key: items, "next_cursor": p.next, "state": 1})
		return reply{body: string(body)}
	})
	ctx := context.Background()
	var threads []string
	it := c.IterateThreads(mailbox.ListQuery{Limit: 2})
	for it.Next(ctx) {
		threads = append(threads, it.Value().ID)
	}
	if it.Err() != nil || !reflect.DeepEqual(threads, []string{"t1", "t2", "t3"}) {
		t.Fatalf("threads %v, err %v", threads, it.Err())
	}
	var cursors []string
	for _, r := range fake.all() {
		cursors = append(cursors, r.Query["cursor"]+"|"+r.Query["limit"])
	}
	if !reflect.DeepEqual(cursors, []string{"|2", "c1|2", "c2|2"}) {
		t.Fatalf("cursors %v", cursors)
	}

	var messages []string
	mit := c.IterateMessages(mailbox.ListQuery{})
	for mit.Next(ctx) {
		messages = append(messages, mit.Value().ID)
	}
	if mit.Err() != nil || !reflect.DeepEqual(messages, []string{"t1", "t2", "t3"}) {
		t.Fatalf("messages %v, err %v", messages, mit.Err())
	}
}

func TestIteratorStopsOnError(t *testing.T) {
	_, c := newFake(t, func(recorded) reply {
		return reply{status: 401, body: `{"error":{"code":"unauthorized","message":"sign in again to continue"}}`}
	})
	it := c.IterateThreads(mailbox.ListQuery{})
	if it.Next(context.Background()) {
		t.Fatal("expected no items")
	}
	if !mailbox.IsErrorCode(it.Err(), mailbox.ErrCodeUnauthorized) {
		t.Fatalf("err %v", it.Err())
	}
}

func TestComposeDraftAndSend(t *testing.T) {
	fake, c := newFake(t, func(r recorded) reply {
		if r.Path == "/client/v1/send" {
			return reply{status: 202, body: `{"outbound_id":"out_1","status":"queued","send_at":"2026-11-01T09:00:00Z","message":{"id":"msg_s","send":{"outbound_id":"out_1","send_at":"2026-11-01T09:00:00Z","state":"scheduled"}}}`}
		}
		return reply{body: `{"id":"msg_d","draft":true}`}
	})
	ctx := context.Background()
	compose := mailbox.Compose{
		MailboxID:        "mbx_1",
		DraftID:          "msg_d",
		From:             "support@acme.test",
		To:               []mailbox.Address{{Name: "Bob", Email: "bob@example.net"}},
		Subject:          "Re: hi",
		Text:             "Hello",
		ReplyToMessageID: "msg_0",
		Attachments: []mailbox.AttachmentRef{
			mailbox.UploadRef("upl_1"),
			mailbox.MessageAttachmentRef("msg_0", 0),
			{UploadID: "upl_2", Inline: true, ContentID: "img1"},
		},
	}
	draft, err := c.SaveDraft(ctx, compose)
	if err != nil || draft.ID != "msg_d" || !draft.Draft {
		t.Fatalf("draft %+v, %v", draft, err)
	}
	wantDraft := `{"mailbox_id":"mbx_1","draft_id":"msg_d","from":"support@acme.test","to":[{"name":"Bob","email":"bob@example.net"}],
		"subject":"Re: hi","text":"Hello","reply_to_message_id":"msg_0",
		"attachments":[{"upload_id":"upl_1"},{"message_id":"msg_0","index":0},{"upload_id":"upl_2","inline":true,"content_id":"img1"}]}`
	if got := fake.all()[0]; got.Path != "/client/v1/drafts" || !reflect.DeepEqual(got.JSONMap, jsonOf(t, wantDraft)) {
		t.Fatalf("draft request %s %s", got.Path, got.Body)
	}

	at := time.Date(2026, 11, 1, 10, 0, 0, 0, time.FixedZone("CET", 3600))
	res, err := c.Send(ctx, mailbox.Compose{MailboxID: "mbx_1", From: "a@acme.test", To: []mailbox.Address{{Email: "b@example.net"}}}, &mailbox.SendOptions{SendAt: at, UndoSeconds: 5, IdempotencyKey: "k1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OutboundID != "out_1" || res.Message == nil || res.Message.Send == nil || res.Message.Send.State != "scheduled" {
		t.Fatalf("send result %+v", res)
	}
	sent := fake.all()[1]
	if sent.Header.Get("Idempotency-Key") != "k1" {
		t.Errorf("idempotency key %q", sent.Header.Get("Idempotency-Key"))
	}
	wantSend := `{"mailbox_id":"mbx_1","from":"a@acme.test","to":[{"name":"","email":"b@example.net"}],"send_at":"2026-11-01T09:00:00Z","undo_seconds":5}`
	if !reflect.DeepEqual(sent.JSONMap, jsonOf(t, wantSend)) {
		t.Fatalf("send body %s", sent.Body)
	}

	if _, err := c.Send(ctx, mailbox.Compose{MailboxID: "mbx_1", From: "a@acme.test"}, nil); err != nil {
		t.Fatal(err)
	}
	if got := fake.all()[2]; got.Header.Get("Idempotency-Key") != "" || got.JSONMap["send_at"] != nil || got.JSONMap["undo_seconds"] != nil {
		t.Fatalf("plain send %s %v", got.Body, got.Header)
	}
}

func TestUpload(t *testing.T) {
	fake, c := newFake(t, func(recorded) reply {
		return reply{status: 201, body: `{"id":"upl_1","filename":"résumé 1.pdf","content_type":"application/pdf","size":3,"expires_at":"t"}`}
	})
	up, err := c.Upload(context.Background(), bytes.NewReader([]byte{1, 2, 3}), "résumé 1.pdf", "application/pdf")
	if err != nil || up.ID != "upl_1" || up.Size != 3 {
		t.Fatalf("upload %+v, %v", up, err)
	}
	r := fake.all()[0]
	if r.Method != "POST" || r.Path != "/client/v1/uploads" {
		t.Fatalf("got %s %s", r.Method, r.Path)
	}
	if r.Header.Get("Content-Type") != "application/pdf" || r.Header.Get("X-Filename") != "r%C3%A9sum%C3%A9%201.pdf" {
		t.Fatalf("headers %v", r.Header)
	}
	if !bytes.Equal(r.Body, []byte{1, 2, 3}) {
		t.Fatalf("body %v", r.Body)
	}

	if _, err := c.Upload(context.Background(), strings.NewReader("x"), "", ""); err != nil {
		t.Fatal(err)
	}
	if r := fake.all()[1]; r.Header.Get("Content-Type") != "application/octet-stream" || r.Header.Get("X-Filename") != "" {
		t.Fatalf("defaults %v", r.Header)
	}
}

func TestDownloads(t *testing.T) {
	fake, c := newFake(t, func(r recorded) reply {
		if strings.HasSuffix(r.Path, "/raw") {
			return reply{body: "From: a\r\n\r\nhi", headers: map[string]string{"Content-Type": "message/rfc822", "Content-Disposition": `attachment; filename="Hello there.eml"`}}
		}
		return reply{body: "\x89PNG", headers: map[string]string{"Content-Type": "image/png", "Content-Disposition": `inline; filename*=utf-8''ph%C3%B6to.png`}}
	})
	ctx := context.Background()
	raw, err := c.RawMessage(ctx, "msg_1")
	if err != nil || raw.Filename != "Hello there.eml" || raw.ContentType != "message/rfc822" || string(raw.Data) != "From: a\r\n\r\nhi" {
		t.Fatalf("raw %+v, %v", raw, err)
	}
	img, err := c.Attachment(ctx, "msg_1", 2, true)
	if err != nil || img.Filename != "phöto.png" || img.ContentType != "image/png" || len(img.Data) != 4 {
		t.Fatalf("attachment %+v, %v", img, err)
	}
	reqs := fake.all()
	if reqs[0].Path != "/client/v1/messages/msg_1/raw" || reqs[1].Path != "/client/v1/messages/msg_1/attachments/2" || reqs[1].Query["inline"] != "1" {
		t.Fatalf("requests %+v", reqs)
	}
}

func TestErrors(t *testing.T) {
	ctx := context.Background()
	t.Run("storage full", func(t *testing.T) {
		_, c := newFake(t, func(recorded) reply {
			return reply{status: 507, body: `{"error":{"code":"storage_full","message":"mail storage is full","scope":"mailbox","mailbox_id":"mbx_1","limit_bytes":1000,"used_bytes":990}}`}
		})
		_, err := c.SaveDraft(ctx, mailbox.Compose{MailboxID: "mbx_1"})
		var apiErr *mailbox.APIError
		if !errors.As(err, &apiErr) {
			t.Fatalf("err %T %v", err, err)
		}
		if apiErr.StatusCode != 507 || apiErr.Code != mailbox.ErrCodeStorageFull || apiErr.Message != "mail storage is full" ||
			apiErr.Scope != "mailbox" || apiErr.MailboxID != "mbx_1" || apiErr.LimitBytes != 1000 || apiErr.UsedBytes != 990 {
			t.Fatalf("apiErr %+v", apiErr)
		}
		if !mailbox.IsErrorCode(err, mailbox.ErrCodeStorageFull) || !strings.Contains(err.Error(), "storage_full") {
			t.Fatalf("Error() %q", err.Error())
		}
	})
	t.Run("rate limited", func(t *testing.T) {
		_, c := newFake(t, func(recorded) reply {
			return reply{status: 429, body: `{"error":{"code":"send_limit_reached","message":"hourly limit","reset_at":"2026-10-23T11:00:00Z"}}`,
				headers: map[string]string{"Content-Type": "application/json", "Retry-After": "2"}}
		})
		_, err := c.Me(ctx)
		var apiErr *mailbox.APIError
		if !errors.As(err, &apiErr) || apiErr.RetryAfter != 2*time.Second || apiErr.ResetAt != "2026-10-23T11:00:00Z" || apiErr.Code != mailbox.ErrCodeSendLimitReached {
			t.Fatalf("apiErr %+v", apiErr)
		}
	})
	t.Run("not json", func(t *testing.T) {
		_, c := newFake(t, func(recorded) reply {
			return reply{status: 502, body: "gateway unavailable\n", headers: map[string]string{"Content-Type": "text/plain"}}
		})
		_, err := c.Me(ctx)
		var apiErr *mailbox.APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != 502 || apiErr.Code != "http_error" || apiErr.Message != "gateway unavailable" {
			t.Fatalf("apiErr %+v", apiErr)
		}
	})
}

func TestDefaultsAndStringer(t *testing.T) {
	c := mailbox.NewClient("hfmb_secret")
	if s := c.String(); strings.Contains(s, "hfmb_secret") || !strings.Contains(s, mailbox.DefaultBaseURL) {
		t.Fatalf("String() %q", s)
	}
}

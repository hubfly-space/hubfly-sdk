package mailbox

import "time"

// Response shapes of the Mail node's client API. JSON tags match the node
// (hubfly-mail internal/mailstore and internal/service/mailbox_*.go).

// Role is a person's or key's role in one mailbox: read, full or owner
// (owner is the same as full today).
type Role string

const (
	RoleRead  Role = "read"
	RoleFull  Role = "full"
	RoleOwner Role = "owner"
)

// Thread statuses of the shared inbox. New inbound mail reopens done.
const (
	StatusOpen    = "open"
	StatusPending = "pending"
	StatusDone    = "done"
)

// Presence kinds; PresenceLeft removes the caller's entry.
const (
	PresenceViewing  = "viewing"
	PresenceReplying = "replying"
	PresenceLeft     = "left"
)

// Address is a mail address with an optional display name.
type Address struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Identity is an address the caller may send as.
type Identity struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// GrantedMailbox is a mailbox the caller can open, with its role.
type GrantedMailbox struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"` // personal | shared
	Color        string `json:"color"`
	CapBytes     *int64 `json:"cap_bytes"`
	UsedBytes    int64  `json:"used_bytes"`
	MessageCount int64  `json:"message_count"`
	CreatedAt    string `json:"created_at"`
	Role         Role   `json:"role"`
}

// Folder is a standard (Role set) or custom (Role nil) folder with counts.
type Folder struct {
	ID        string  `json:"id"`
	MailboxID string  `json:"mailbox_id"`
	Name      string  `json:"name"`
	Role      *string `json:"role"` // inbox, drafts, sent, archive, spam, trash
	Sort      int     `json:"sort"`
	Total     int64   `json:"total"`
	Unread    int64   `json:"unread"`
}

// Me describes the caller: granted mailboxes, folders, identities, pool usage, policy and state.
type Me struct {
	User struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Kind string `json:"kind"` // member | standalone | api
	} `json:"user"`
	Mailboxes []GrantedMailbox `json:"mailboxes"`
	Folders   []Folder         `json:"folders"`
	// Identities is empty without the send scope.
	Identities []Identity `json:"identities"`
	CanSend    bool       `json:"can_send"`
	Storage    struct {
		QuotaBytes int64 `json:"quota_bytes"`
		UsedBytes  int64 `json:"used_bytes"`
	} `json:"storage"`
	Policy struct {
		MaxAttachmentBytes int64  `json:"max_attachment_bytes"`
		RemoteImages       string `json:"remote_images"` // block | ask | allow
		TrashRetentionDays int    `json:"trash_retention_days"`
		SpamRetentionDays  int    `json:"spam_retention_days"`
		FooterText         string `json:"footer_text"`
	} `json:"policy"`
	State int64 `json:"state"`
}

// Person is a thread assignee.
type Person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Attachment describes one attachment of a message.
type Attachment struct {
	Index       int    `json:"index"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Inline      bool   `json:"inline"`
	ContentID   string `json:"content_id,omitempty"`
}

// Body is the readable content of a message. HTML is sanitised on the node;
// still render it in a sandboxed iframe.
type Body struct {
	Text            string       `json:"text"`
	HTML            string       `json:"html"`
	HasRemoteImages bool         `json:"has_remote_images"`
	Attachments     []Attachment `json:"attachments"`
}

// SpamInfo is the spam score of a message delivered to Spam.
type SpamInfo struct {
	Score  float64 `json:"score"`
	Reason string  `json:"reason"`
}

// SendInfo is set on Sent copies. State is scheduled, sending, sent, failed or cancelled.
type SendInfo struct {
	OutboundID string `json:"outbound_id"`
	SendAt     string `json:"send_at"`
	State      string `json:"state"`
}

// ThreadSummary is one conversation in a list.
type ThreadSummary struct {
	ID             string    `json:"id"`
	MailboxID      string    `json:"mailbox_id"`
	Subject        string    `json:"subject"`
	Snippet        string    `json:"snippet"`
	LastAt         string    `json:"last_at"`
	MessageCount   int       `json:"message_count"`
	UnreadCount    int       `json:"unread_count"`
	Flagged        bool      `json:"flagged"`
	HasAttachments bool      `json:"has_attachments"`
	HasDraft       bool      `json:"has_draft"`
	From           Address   `json:"from"`
	Participants   []Address `json:"participants"`
	FolderIDs      []string  `json:"folder_ids"`
	Assignee       *Person   `json:"assignee"`
	Status         string    `json:"status"`
	NoteCount      int       `json:"note_count"`
	MessageIDs     []string  `json:"message_ids"`
}

// Message is one stored message. Body is set by Message (unless skipped) and Thread.
type Message struct {
	ID             string       `json:"id"`
	ThreadID       string       `json:"thread_id"`
	MailboxID      string       `json:"mailbox_id"`
	FolderID       string       `json:"folder_id"`
	FolderRole     string       `json:"folder_role"`
	Subject        string       `json:"subject"`
	From           Address      `json:"from"`
	To             []Address    `json:"to"`
	Cc             []Address    `json:"cc"`
	Bcc            []Address    `json:"bcc"`
	ReplyTo        string       `json:"reply_to"`
	Date           string       `json:"date"`
	ReceivedAt     string       `json:"received_at"`
	Seen           bool         `json:"seen"`
	Flagged        bool         `json:"flagged"`
	Answered       bool         `json:"answered"`
	Draft          bool         `json:"draft"`
	Size           int64        `json:"size"` // RFC 5322 size; counts toward storage
	Snippet        string       `json:"snippet"`
	HasAttachments bool         `json:"has_attachments"`
	Attachments    []Attachment `json:"attachments"`
	Spam           *SpamInfo    `json:"spam"`
	Send           *SendInfo    `json:"send"`
	MessageID      string       `json:"message_id"`
	InReplyTo      string       `json:"in_reply_to"`
	Identity       string       `json:"identity"`
	Body           *Body        `json:"body,omitempty"`
}

// Note is an internal note on a conversation; notes are never sent.
type Note struct {
	ID         string `json:"id"`
	ThreadID   string `json:"thread_id"`
	AuthorID   string `json:"author_id"`
	AuthorName string `json:"author_name"`
	Body       string `json:"body"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// Presence says who is viewing or replying to a conversation; entries expire after 45 s.
type Presence struct {
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	Kind      string `json:"kind"`
	ExpiresAt string `json:"expires_at"`
}

// Thread is a conversation with bodies, notes and presence.
type Thread struct {
	ThreadSummary
	Messages []Message  `json:"messages"`
	Notes    []Note     `json:"notes"`
	Presence []Presence `json:"presence"`
}

// ThreadPage is one page of ListThreads. NextCursor is empty on the last page.
type ThreadPage struct {
	Threads    []ThreadSummary `json:"threads"`
	NextCursor string          `json:"next_cursor"`
	State      int64           `json:"state"`
}

// MessagePage is one page of ListMessages. NextCursor is empty on the last page.
type MessagePage struct {
	Messages   []Message `json:"messages"`
	NextCursor string    `json:"next_cursor"`
	State      int64     `json:"state"`
}

// Change is one entry of the change log.
type Change struct {
	Modseq    int64  `json:"modseq"`
	MailboxID string `json:"mailbox_id"`
	Kind      string `json:"kind"`
	ObjectID  string `json:"object_id"`
	Op        string `json:"op"`
}

// Changes is the change log since a state. With More, call again with Since =
// State; with Reset, the cursor is too old and the client must reload.
type Changes struct {
	Changes []Change `json:"changes"`
	State   int64    `json:"state"`
	More    bool     `json:"more"`
	Reset   bool     `json:"reset"`
}

// Contact is an autocomplete suggestion.
type Contact struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Uses  int    `json:"uses"`
}

// Upload is a pending attachment, valid for 24 hours.
type Upload struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	ExpiresAt   string `json:"expires_at"`
}

// MailboxUsage is the usage of one mailbox.
type MailboxUsage struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CapBytes     *int64 `json:"cap_bytes"`
	UsedBytes    int64  `json:"used_bytes"`
	MessageCount int64  `json:"message_count"`
}

// FolderUsage is the usage of one folder.
type FolderUsage struct {
	MailboxID string `json:"mailbox_id"`
	FolderID  string `json:"folder_id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Bytes     int64  `json:"bytes"`
	Count     int64  `json:"count"`
}

// Storage is pool, per-mailbox and per-folder usage and the 30 largest messages.
type Storage struct {
	QuotaBytes int64          `json:"quota_bytes"`
	UsedBytes  int64          `json:"used_bytes"`
	Mailboxes  []MailboxUsage `json:"mailboxes"`
	Folders    []FolderUsage  `json:"folders"`
	Largest    []Message      `json:"largest"`
}

// SendResult is the 202 answer of Send. SendAt is empty when the message
// leaves now; Message is nil only if storing the Sent copy failed.
type SendResult struct {
	OutboundID string   `json:"outbound_id"`
	Status     string   `json:"status"`
	SendAt     string   `json:"send_at"`
	Message    *Message `json:"message"`
}

// UpdateResult lists the ids a patch changed and the new state.
type UpdateResult struct {
	Updated []string `json:"updated"`
	State   int64    `json:"state"`
}

// File is a downloaded raw message or attachment.
type File struct {
	Data        []byte
	ContentType string
	Filename    string
}

// ListQuery filters ListThreads and ListMessages.
type ListQuery struct {
	// MailboxID limits to one mailbox; empty means every granted mailbox (unified inbox).
	MailboxID string
	// Folder is a role, a folder id, "all" (not Spam/Trash) or "anywhere". Default inbox.
	Folder string
	// Q is a search: words, "phrases", from: to: subject: has:attachment is:unread in: before: after: larger: smaller:.
	Q string
	// Assigned is "me", "none" or a person id.
	Assigned string
	// Status is open, pending or done.
	Status  string
	Unread  bool
	Flagged bool
	Cursor  string
	// Limit is 1-100, default 50.
	Limit int
}

// Patch changes flags or the folder of threads or messages.
type Patch struct {
	IDs     []string `json:"ids"`
	Seen    *bool    `json:"seen,omitempty"`
	Flagged *bool    `json:"flagged,omitempty"`
	// MoveTo is a folder role or a folder id in the same mailbox.
	MoveTo string `json:"move_to,omitempty"`
}

// AttachmentRef attaches an upload (UploadID) or an attachment of an existing
// message (MessageID and Index). Use UploadRef and MessageAttachmentRef.
type AttachmentRef struct {
	UploadID  string `json:"upload_id,omitempty"`
	MessageID string `json:"message_id,omitempty"`
	Index     *int   `json:"index,omitempty"`
	Inline    bool   `json:"inline,omitempty"`
	ContentID string `json:"content_id,omitempty"`
}

// UploadRef attaches an upload.
func UploadRef(uploadID string) AttachmentRef { return AttachmentRef{UploadID: uploadID} }

// MessageAttachmentRef attaches attachment index of an existing message (for forwards).
func MessageAttachmentRef(messageID string, index int) AttachmentRef {
	return AttachmentRef{MessageID: messageID, Index: &index}
}

// Compose is the composer body of SaveDraft and Send.
type Compose struct {
	MailboxID string `json:"mailbox_id"`
	// DraftID replaces that draft (its id stays the same); on send the draft becomes the Sent copy.
	DraftID string `json:"draft_id,omitempty"`
	// From is a granted identity address. Drafts default to the first identity.
	From    string    `json:"from,omitempty"`
	To      []Address `json:"to,omitempty"`
	Cc      []Address `json:"cc,omitempty"`
	Bcc     []Address `json:"bcc,omitempty"`
	Subject string    `json:"subject,omitempty"`
	Text    string    `json:"text,omitempty"`
	HTML    string    `json:"html,omitempty"`
	// ReplyToMessageID threads the message and sets In-Reply-To/References.
	ReplyToMessageID string          `json:"reply_to_message_id,omitempty"`
	Attachments      []AttachmentRef `json:"attachments,omitempty"`
}

// SendOptions schedule a send or hold it for undo.
type SendOptions struct {
	// SendAt schedules the message up to 60 days ahead; it takes precedence over UndoSeconds.
	SendAt time.Time
	// UndoSeconds (0-30) holds the message so CancelSend can stop it.
	UndoSeconds int
	// IdempotencyKey is sent as the Idempotency-Key header; reuse it when retrying.
	IdempotencyKey string
}

// Bool returns a pointer to b, for Patch fields.
func Bool(b bool) *bool { return &b }

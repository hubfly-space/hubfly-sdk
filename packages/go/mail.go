package hubfly

// HubFly Mail mailbox administration on the Dashboard API:
// /api/v1/projects/{projectId}/mail/… with the normal HubFly API token.
// Reading and sending mail happens on the Mail node with a Mailbox API key;
// see the mailbox package.

import (
	"context"
	"encoding/json"
	"net/url"
)

// MailMailbox is a mailbox as the Dashboard lists it.
type MailMailbox struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Color string `json:"color"`
	// CapBytes is an optional cap inside the project's storage pool; nil means no cap.
	CapBytes     *int64   `json:"capBytes"`
	UsedBytes    int64    `json:"usedBytes"`
	MessageCount int64    `json:"messageCount"`
	Addresses    []string `json:"addresses"`
	People       int      `json:"people"`
	CreatedAt    string   `json:"createdAt"`
}

// MailStorage is the project's storage pool and per-mailbox usage.
type MailStorage struct {
	QuotaBytes   int64   `json:"quotaBytes"`
	UsedBytes    int64   `json:"usedBytes"`
	MessageCount int64   `json:"messageCount"`
	Percent      float64 `json:"percent"`
	// Threshold is the highest warning threshold reached: 0, 80, 95 or 100.
	Threshold   int     `json:"threshold"`
	RefreshedAt *string `json:"refreshedAt"`
	Source      string  `json:"source"`
	Mailboxes   []struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Color        string `json:"color"`
		CapBytes     *int64 `json:"capBytes"`
		UsedBytes    int64  `json:"usedBytes"`
		MessageCount int64  `json:"messageCount"`
	} `json:"mailboxes"`
}

// MailMailboxesOverview is the answer of Mail.Mailboxes.List.
type MailMailboxesOverview struct {
	Enabled       bool          `json:"enabled"`
	State         string        `json:"state"`
	LastErrorCode *string       `json:"lastErrorCode"`
	Mailboxes     []MailMailbox `json:"mailboxes"`
	Storage       MailStorage   `json:"storage"`
	Colors        []string      `json:"colors"`
}

// MailMailboxesState is the setup state of mailboxes (active once enabled).
type MailMailboxesState struct {
	State string `json:"state"`
}

// MailGrant gives a person a role (read, full or owner) in a mailbox.
type MailGrant struct {
	MailboxID string `json:"mailboxId"`
	Role      string `json:"role"`
}

// MailPerson is someone who uses the mail client: a project member or a mailbox-only login.
type MailPerson struct {
	ID            string  `json:"id"`
	Kind          string  `json:"kind"` // member | standalone
	UserID        *string `json:"userId"`
	Email         string  `json:"email"`
	RecoveryEmail *string `json:"recoveryEmail"`
	DisplayName   string  `json:"displayName"`
	Title         string  `json:"title"`
	Phone         string  `json:"phone"`
	State         string  `json:"state"`
	CanSend       bool    `json:"canSend"`
	TotpEnabled   bool    `json:"totpEnabled"`
	LastLoginAt   *string `json:"lastLoginAt"`
	// InviteExpiresAt is set while a mailbox-only person's invite is pending.
	InviteExpiresAt *string     `json:"inviteExpiresAt"`
	Grants          []MailGrant `json:"grants"`
	IdentityIDs     []string    `json:"identityIds"`
	CreatedAt       string      `json:"createdAt"`
}

// MailIdentity is a sender identity (send-as address).
type MailIdentity struct {
	ID            string  `json:"id"`
	Address       string  `json:"address"`
	DisplayName   string  `json:"displayName"`
	ReplyTo       string  `json:"replyTo"`
	SignatureHTML string  `json:"signatureHtml"`
	MailboxID     *string `json:"mailboxId"`
	People        int     `json:"people"`
}

// MailAPIKey is a Mailbox API key, without its secret.
type MailAPIKey struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	KeyHint string   `json:"keyHint"`
	Scopes  []string `json:"scopes"` // read, send, organize
	// MailboxRoles maps mailbox id to role.
	MailboxRoles map[string]string `json:"mailboxRoles"`
	IdentityIDs  []string          `json:"identityIds"`
	CreatedAt    string            `json:"createdAt"`
	RevokedAt    *string           `json:"revokedAt"`
}

// MailBrandSettings are the mail client's branding and policies.
type MailBrandSettings struct {
	ProductName        string `json:"productName"`
	LogoURL            string `json:"logoUrl"`
	LogoDarkURL        string `json:"logoDarkUrl"`
	FaviconURL         string `json:"faviconUrl"`
	ThemePreset        string `json:"themePreset"` // harbor, paper, graphite, meadow, signal, atlas
	AccentColor        string `json:"accentColor"`
	Font               string `json:"font"`    // geist, system, serif, humanist
	Density            string `json:"density"` // comfortable, compact
	Radius             string `json:"radius"`  // sharp, soft, round
	LoginTitle         string `json:"loginTitle"`
	LoginMessage       string `json:"loginMessage"`
	LoginBackground    string `json:"loginBackground"`
	SupportURL         string `json:"supportUrl"`
	LegalURL           string `json:"legalUrl"`
	PrivacyURL         string `json:"privacyUrl"`
	SignatureTemplate  string `json:"signatureTemplate"`
	FooterText         string `json:"footerText"`
	FooterHTML         string `json:"footerHtml"`
	ShowPoweredBy      bool   `json:"showPoweredBy"`
	AllowUserTheme     bool   `json:"allowUserTheme"`
	AllowUserSignature bool   `json:"allowUserSignature"`
	RemoteImages       string `json:"remoteImages"` // block, ask, allow
	MaxAttachmentMb    int    `json:"maxAttachmentMb"`
	TrashRetentionDays int    `json:"trashRetentionDays"`
	SpamRetentionDays  int    `json:"spamRetentionDays"`
	HourlySendLimit    int    `json:"hourlySendLimit"`
	DailySendLimit     int    `json:"dailySendLimit"`
}

// MailAISettings say whether HubFly AI is available in the inboxes.
type MailAISettings struct {
	Enabled  bool     `json:"enabled"`
	Features []string `json:"features"` // summarize, draft_reply, triage
}

// CreateMailMailboxParams creates a mailbox; Addresses start delivering into it.
type CreateMailMailboxParams struct {
	Name      string   `json:"name"`
	Kind      string   `json:"kind,omitempty"` // personal | shared
	Color     string   `json:"color,omitempty"`
	CapBytes  *int64   `json:"capBytes,omitempty"`
	Addresses []string `json:"addresses,omitempty"`
}

// UpdateMailMailboxParams changes a mailbox. Set RemoveCap to send capBytes: null.
type UpdateMailMailboxParams struct {
	Name      string
	Kind      string
	Color     string
	CapBytes  *int64
	RemoveCap bool
}

// MarshalJSON sends only the set fields, and capBytes null when RemoveCap is set.
func (p UpdateMailMailboxParams) MarshalJSON() ([]byte, error) {
	body := map[string]any{}
	if p.Name != "" {
		body["name"] = p.Name
	}
	if p.Kind != "" {
		body["kind"] = p.Kind
	}
	if p.Color != "" {
		body["color"] = p.Color
	}
	if p.RemoveCap {
		body["capBytes"] = nil
	} else if p.CapBytes != nil {
		body["capBytes"] = *p.CapBytes
	}
	return json.Marshal(body)
}

// MailAddressDeliveryParams sets where an address delivers.
type MailAddressDeliveryParams struct {
	MailboxIDs []string `json:"mailboxIds"`
	// ForwardTo is a verified forwarding destination; empty for none.
	ForwardTo string `json:"forwardTo"`
}

// MailAddressDelivery is the delivery an address ended up with.
type MailAddressDelivery struct {
	Address    string   `json:"address"`
	MailboxIDs []string `json:"mailboxIds"`
	ForwardTo  string   `json:"forwardTo"`
}

// CreateMailPersonParams adds a project member (Kind "member", UserID) or a
// mailbox-only login (Kind "standalone", Email).
type CreateMailPersonParams struct {
	Kind          string      `json:"kind"`
	UserID        string      `json:"userId,omitempty"`
	Email         string      `json:"email,omitempty"`
	DisplayName   string      `json:"displayName,omitempty"`
	Title         string      `json:"title,omitempty"`
	Phone         string      `json:"phone,omitempty"`
	RecoveryEmail string      `json:"recoveryEmail,omitempty"`
	Grants        []MailGrant `json:"grants,omitempty"`
	IdentityIDs   []string    `json:"identityIds,omitempty"`
	CanSend       *bool       `json:"canSend,omitempty"`
	SendInvite    *bool       `json:"sendInvite,omitempty"`
}

// MailPersonCreated is the answer of Mail.People.Create; InviteURL is set for standalone logins.
type MailPersonCreated struct {
	Person          MailPerson `json:"person"`
	InviteURL       *string    `json:"inviteUrl"`
	InviteExpiresAt *string    `json:"inviteExpiresAt"`
	Emailed         bool       `json:"emailed"`
}

// UpdateMailPersonParams changes a person; nil fields stay unchanged.
type UpdateMailPersonParams struct {
	DisplayName   *string     `json:"displayName,omitempty"`
	Title         *string     `json:"title,omitempty"`
	Phone         *string     `json:"phone,omitempty"`
	RecoveryEmail *string     `json:"recoveryEmail,omitempty"`
	State         string      `json:"state,omitempty"` // active | disabled
	CanSend       *bool       `json:"canSend,omitempty"`
	Grants        []MailGrant `json:"grants,omitempty"`
	IdentityIDs   []string    `json:"identityIds,omitempty"`
}

// MailPersonReset is a new invite or password-reset link.
type MailPersonReset struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
	Emailed   bool   `json:"emailed"`
}

// CreateMailIdentityParams creates a sender identity.
type CreateMailIdentityParams struct {
	Address       string  `json:"address"`
	DisplayName   string  `json:"displayName,omitempty"`
	ReplyTo       string  `json:"replyTo,omitempty"`
	SignatureHTML string  `json:"signatureHtml,omitempty"`
	MailboxID     *string `json:"mailboxId,omitempty"`
}

// UpdateMailIdentityParams changes a sender identity; nil fields stay unchanged.
type UpdateMailIdentityParams struct {
	DisplayName   *string `json:"displayName,omitempty"`
	ReplyTo       *string `json:"replyTo,omitempty"`
	SignatureHTML *string `json:"signatureHtml,omitempty"`
	MailboxID     *string `json:"mailboxId,omitempty"`
}

// CreateMailMailboxKeyParams creates a Mailbox API key.
type CreateMailMailboxKeyParams struct {
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"` // read, send, organize
	// MailboxRoles maps mailbox id to role (read, full or owner).
	MailboxRoles map[string]string `json:"mailboxRoles"`
	// IdentityIDs are the identities the key may send as.
	IdentityIDs []string `json:"identityIds,omitempty"`
}

// MailMailboxKeyCreated holds the new key; Secret is returned only once.
type MailMailboxKeyCreated struct {
	Key    MailAPIKey `json:"key"`
	Secret string     `json:"secret"`
}

// MailService is HubFly Mail mailbox administration (client.Mail).
type MailService struct {
	client *Client

	// Mailboxes manages mailboxes.
	Mailboxes *MailMailboxesService
	// People manages who uses the mail client.
	People *MailPeopleService
	// Identities manages sender identities.
	Identities *MailIdentitiesService
	// MailboxKeys manages Mailbox API keys (hfmb_…).
	MailboxKeys *MailMailboxKeysService
}

func newMailService(c *Client) *MailService {
	return &MailService{
		client:      c,
		Mailboxes:   &MailMailboxesService{client: c},
		People:      &MailPeopleService{client: c},
		Identities:  &MailIdentitiesService{client: c},
		MailboxKeys: &MailMailboxKeysService{client: c},
	}
}

// mailPath builds /api/v1/projects/{projectID}/mail/<format> with escaped parameters.
func mailPath(projectID, format string, params ...string) string {
	return managedPath("/api/v1/projects/%s/mail/", projectID) + managedPath(format, params...)
}

// SetAddressDelivery sets where an address delivers: one or more mailboxes and/or a verified forward.
func (s *MailService) SetAddressDelivery(ctx context.Context, projectID, address string, params MailAddressDeliveryParams) (*Response[MailAddressDelivery], error) {
	if params.MailboxIDs == nil {
		params.MailboxIDs = []string{}
	}
	return Request[MailAddressDelivery](ctx, s.client, "PUT", mailPath(projectID, "addresses/%s/delivery", address), params)
}

// GetBrand returns the mail client's branding and policies (project:read).
func (s *MailService) GetBrand(ctx context.Context, projectID string) (*Response[MailBrandSettings], error) {
	return Request[MailBrandSettings](ctx, s.client, "GET", mailPath(projectID, "brand"), nil)
}

// UpdateBrand saves branding and client policies and applies them. brand
// holds only the fields to change (camelCase keys of MailBrandSettings).
func (s *MailService) UpdateBrand(ctx context.Context, projectID string, brand map[string]any) (*Response[MailBrandSettings], error) {
	return Request[MailBrandSettings](ctx, s.client, "PUT", mailPath(projectID, "brand/update"), map[string]any{"brand": brand})
}

// GetStorage returns the storage pool and per-mailbox usage (project:read).
// refresh pulls live usage from the Mail node.
func (s *MailService) GetStorage(ctx context.Context, projectID string, refresh bool) (*Response[MailStorage], error) {
	path := mailPath(projectID, "storage")
	if refresh {
		path += encodeManagedQuery(url.Values{"refresh": {"true"}})
	}
	return Request[MailStorage](ctx, s.client, "GET", path, nil)
}

// GetAISettings says whether HubFly AI is available in the inboxes (project:read).
func (s *MailService) GetAISettings(ctx context.Context, projectID string) (*Response[MailAISettings], error) {
	return Request[MailAISettings](ctx, s.client, "GET", mailPath(projectID, "ai"), nil)
}

// UpdateAISettings turns HubFly AI in the inboxes on or off (off by default).
func (s *MailService) UpdateAISettings(ctx context.Context, projectID string, settings MailAISettings) (*Response[MailAISettings], error) {
	return Request[MailAISettings](ctx, s.client, "PUT", mailPath(projectID, "ai/update"), settings)
}

// MailMailboxesService manages mailboxes (client.Mail.Mailboxes).
type MailMailboxesService struct{ client *Client }

// List returns the mailboxes with usage, the setup state and the storage pool (project:read).
func (s *MailMailboxesService) List(ctx context.Context, projectID string) (*Response[MailMailboxesOverview], error) {
	return Request[MailMailboxesOverview](ctx, s.client, "GET", mailPath(projectID, "mailboxes"), nil)
}

// Enable turns on mailboxes for the project; idempotent and also repairs a failed setup.
func (s *MailMailboxesService) Enable(ctx context.Context, projectID string) (*Response[MailMailboxesState], error) {
	return Request[MailMailboxesState](ctx, s.client, "POST", mailPath(projectID, "mailboxes/enable"), nil)
}

// Create creates a mailbox; listed addresses start delivering into it.
func (s *MailMailboxesService) Create(ctx context.Context, projectID string, params CreateMailMailboxParams) (*Response[MailMailbox], error) {
	return Request[MailMailbox](ctx, s.client, "POST", mailPath(projectID, "mailboxes/create"), params)
}

// Update renames, recolours or re-caps a mailbox.
func (s *MailMailboxesService) Update(ctx context.Context, projectID, mailboxID string, params UpdateMailMailboxParams) (*Response[MailMailbox], error) {
	return Request[MailMailbox](ctx, s.client, "PUT", mailPath(projectID, "mailboxes/%s/update", mailboxID), params)
}

// Delete permanently deletes a mailbox and every message in it.
func (s *MailMailboxesService) Delete(ctx context.Context, projectID, mailboxID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "DELETE", mailPath(projectID, "mailboxes/%s/delete", mailboxID), nil)
}

// MailPeopleService manages who uses the mail client (client.Mail.People); needs team:manage.
type MailPeopleService struct{ client *Client }

// List returns people with their mailbox and send-as grants.
func (s *MailPeopleService) List(ctx context.Context, projectID string) (*Response[[]MailPerson], error) {
	return Request[[]MailPerson](ctx, s.client, "GET", mailPath(projectID, "people"), nil)
}

// Create adds a project member or a mailbox-only login (which gets a one-time invite link).
func (s *MailPeopleService) Create(ctx context.Context, projectID string, params CreateMailPersonParams) (*Response[MailPersonCreated], error) {
	return Request[MailPersonCreated](ctx, s.client, "POST", mailPath(projectID, "people/create"), params)
}

// Update changes details, state, mailbox roles and send-as identities.
func (s *MailPeopleService) Update(ctx context.Context, projectID, mailUserID string, params UpdateMailPersonParams) (*Response[MailPerson], error) {
	return Request[MailPerson](ctx, s.client, "PUT", mailPath(projectID, "people/%s/update", mailUserID), params)
}

// Delete removes a person from the mail client; their mail stays in the mailboxes.
func (s *MailPeopleService) Delete(ctx context.Context, projectID, mailUserID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "DELETE", mailPath(projectID, "people/%s/delete", mailUserID), nil)
}

// Reset issues a new invite or password-reset link for a mailbox-only user; email also emails it.
func (s *MailPeopleService) Reset(ctx context.Context, projectID, mailUserID string, email bool) (*Response[MailPersonReset], error) {
	return Request[MailPersonReset](ctx, s.client, "POST", mailPath(projectID, "people/%s/reset", mailUserID), map[string]bool{"email": email})
}

// MailIdentitiesService manages sender identities (client.Mail.Identities).
type MailIdentitiesService struct{ client *Client }

// List returns the project's sender identities (project:read).
func (s *MailIdentitiesService) List(ctx context.Context, projectID string) (*Response[[]MailIdentity], error) {
	return Request[[]MailIdentity](ctx, s.client, "GET", mailPath(projectID, "identities"), nil)
}

// Create creates a sender identity.
func (s *MailIdentitiesService) Create(ctx context.Context, projectID string, params CreateMailIdentityParams) (*Response[MailIdentity], error) {
	return Request[MailIdentity](ctx, s.client, "POST", mailPath(projectID, "identities/create"), params)
}

// Update changes a sender identity.
func (s *MailIdentitiesService) Update(ctx context.Context, projectID, identityID string, params UpdateMailIdentityParams) (*Response[MailIdentity], error) {
	return Request[MailIdentity](ctx, s.client, "PUT", mailPath(projectID, "identities/%s/update", identityID), params)
}

// Delete deletes a sender identity.
func (s *MailIdentitiesService) Delete(ctx context.Context, projectID, identityID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "DELETE", mailPath(projectID, "identities/%s/delete", identityID), nil)
}

// MailMailboxKeysService manages Mailbox API keys (client.Mail.MailboxKeys).
type MailMailboxKeysService struct{ client *Client }

// List returns the keys without their secrets.
func (s *MailMailboxKeysService) List(ctx context.Context, projectID string) (*Response[[]MailAPIKey], error) {
	return Request[[]MailAPIKey](ctx, s.client, "GET", mailPath(projectID, "mailbox-keys"), nil)
}

// Create creates a key. Secret is returned only once: store it now.
func (s *MailMailboxKeysService) Create(ctx context.Context, projectID string, params CreateMailMailboxKeyParams) (*Response[MailMailboxKeyCreated], error) {
	return Request[MailMailboxKeyCreated](ctx, s.client, "POST", mailPath(projectID, "mailbox-keys/create"), params)
}

// Revoke revokes a key immediately.
func (s *MailMailboxKeysService) Revoke(ctx context.Context, projectID, keyID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "POST", mailPath(projectID, "mailbox-keys/%s/revoke", keyID), nil)
}

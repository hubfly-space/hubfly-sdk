import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';
import type { MailboxRole } from './mailbox.js';

// HubFly Mail mailbox administration on the Dashboard API:
// /api/v1/projects/{projectId}/mail/… with the normal HubFly API token.
// Reading mail happens on the Mail node with a Mailbox API key; see
// MailboxClient in ./mailbox.ts.

export type MailApiKeyScope = 'read' | 'send' | 'organize';
export type MailAiFeature = 'summarize' | 'draft_reply' | 'triage';
export type MailThemePresetId = 'harbor' | 'paper' | 'graphite' | 'meadow' | 'signal' | 'atlas';
export type MailFontId = 'geist' | 'system' | 'serif' | 'humanist';

/** A mailbox as the Dashboard lists it. */
export interface MailMailboxView {
  id: string;
  name: string;
  kind: string;
  color: string;
  /** Optional cap inside the project's storage pool; `null` means no cap. */
  capBytes: number | null;
  usedBytes: number;
  messageCount: number;
  /** Addresses that deliver into this mailbox. */
  addresses: string[];
  /** People with access. */
  people: number;
  createdAt: string;
}

export interface MailStorageView {
  quotaBytes: number;
  usedBytes: number;
  messageCount: number;
  percent: number;
  /** Highest warning threshold reached. */
  threshold: 0 | 80 | 95 | 100;
  refreshedAt: string | null;
  source: string;
  mailboxes: Array<{ id: string; name: string; color: string; capBytes: number | null; usedBytes: number; messageCount: number }>;
}

export interface MailMailboxesOverview {
  enabled: boolean;
  state: string;
  lastErrorCode: string | null;
  mailboxes: MailMailboxView[];
  storage: MailStorageView;
  /** Suggested mailbox colours. */
  colors: string[];
}

export interface MailGrant {
  mailboxId: string;
  role: MailboxRole;
}

/** Someone who uses the mail client: a project member or a mailbox-only login. */
export interface MailPersonView {
  id: string;
  kind: 'member' | 'standalone';
  userId: string | null;
  email: string;
  recoveryEmail: string | null;
  displayName: string;
  title: string;
  phone: string;
  state: string;
  canSend: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  /** When a pending invite link stops working (mailbox-only people). */
  inviteExpiresAt: string | null;
  grants: MailGrant[];
  identityIds: string[];
  createdAt: string;
}

/** A sender identity (send-as address). */
export interface MailIdentityView {
  id: string;
  address: string;
  displayName: string;
  replyTo: string;
  signatureHtml: string;
  mailboxId: string | null;
  people: number;
}

/** A Mailbox API key, without its secret. */
export interface MailApiKeyView {
  id: string;
  name: string;
  keyHint: string;
  scopes: MailApiKeyScope[];
  /** Mailbox id to role. */
  mailboxRoles: Record<string, string>;
  identityIds: string[];
  createdAt: string;
  revokedAt: string | null;
}

/** Branding and policies of the mail client. */
export interface MailBrandSettings {
  productName: string;
  logoUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  themePreset: MailThemePresetId;
  accentColor: string;
  font: MailFontId;
  density: 'comfortable' | 'compact';
  radius: 'sharp' | 'soft' | 'round';
  loginTitle: string;
  loginMessage: string;
  loginBackground: string;
  supportUrl: string;
  legalUrl: string;
  privacyUrl: string;
  signatureTemplate: string;
  footerText: string;
  footerHtml: string;
  showPoweredBy: boolean;
  allowUserTheme: boolean;
  allowUserSignature: boolean;
  remoteImages: 'block' | 'ask' | 'allow';
  maxAttachmentMb: number;
  trashRetentionDays: number;
  spamRetentionDays: number;
  hourlySendLimit: number;
  dailySendLimit: number;
}

export interface MailAiSettings {
  enabled: boolean;
  features: MailAiFeature[];
}

export interface CreateMailMailboxParams {
  name: string;
  kind?: 'personal' | 'shared';
  color?: string;
  capBytes?: number | null;
  /** Addresses that start delivering into the new mailbox. */
  addresses?: string[];
}

export interface UpdateMailMailboxParams {
  name?: string;
  kind?: 'personal' | 'shared';
  color?: string;
  /** `null` removes the cap. */
  capBytes?: number | null;
}

export interface MailAddressDeliveryParams {
  mailboxIds: string[];
  /** A verified forwarding destination; empty for none. */
  forwardTo?: string;
}

export interface CreateMailPersonParams {
  kind: 'member' | 'standalone';
  /** Required for `member`. */
  userId?: string;
  /** Required for `standalone`. */
  email?: string;
  displayName?: string;
  title?: string;
  phone?: string;
  recoveryEmail?: string;
  grants?: MailGrant[];
  identityIds?: string[];
  canSend?: boolean;
  sendInvite?: boolean;
}

export interface UpdateMailPersonParams {
  displayName?: string;
  title?: string;
  phone?: string;
  recoveryEmail?: string | null;
  state?: 'active' | 'disabled';
  canSend?: boolean;
  grants?: MailGrant[];
  identityIds?: string[];
}

export interface CreateMailIdentityParams {
  address: string;
  displayName?: string;
  replyTo?: string;
  signatureHtml?: string;
  mailboxId?: string | null;
}

export type UpdateMailIdentityParams = Omit<CreateMailIdentityParams, 'address'>;

export interface CreateMailMailboxKeyParams {
  name: string;
  scopes: MailApiKeyScope[];
  /** Mailbox id to role (`read`, `full` or `owner`). */
  mailboxRoles: Record<string, MailboxRole>;
  /** Identities the key may send as. */
  identityIds?: string[];
}

function mailPath(projectId: string, ...rest: string[]): string {
  return [`/api/v1/projects/${encodeURIComponent(projectId)}/mail`, ...rest].join('/');
}

/** Mailboxes of a Mail project: `client.mail.mailboxes`. */
export class MailMailboxesSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Mailboxes with their usage, the setup state and the storage pool (project:read). */
  public async list(projectId: string): Promise<ApiResponse<MailMailboxesOverview>> {
    return this.client.request<MailMailboxesOverview>(mailPath(projectId, 'mailboxes'));
  }

  /** Turns on mailboxes for the project; idempotent and also repairs a failed setup. */
  public async enable(projectId: string): Promise<ApiResponse<{ state: string }>> {
    return this.client.request<{ state: string }>(mailPath(projectId, 'mailboxes', 'enable'), { method: 'POST' });
  }

  /** Creates a mailbox; listed addresses start delivering into it. */
  public async create(projectId: string, params: CreateMailMailboxParams): Promise<ApiResponse<MailMailboxView>> {
    return this.client.request<MailMailboxView>(mailPath(projectId, 'mailboxes', 'create'), { method: 'POST', body: params });
  }

  /** Renames, recolours or re-caps a mailbox. */
  public async update(projectId: string, mailboxId: string, params: UpdateMailMailboxParams): Promise<ApiResponse<MailMailboxView>> {
    return this.client.request<MailMailboxView>(mailPath(projectId, 'mailboxes', encodeURIComponent(mailboxId), 'update'), {
      method: 'PUT',
      body: params,
    });
  }

  /** Permanently deletes a mailbox and every message in it. */
  public async delete(projectId: string, mailboxId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(mailPath(projectId, 'mailboxes', encodeURIComponent(mailboxId), 'delete'), {
      method: 'DELETE',
    });
  }
}

/** People who use the mail client: `client.mail.people`. */
export class MailPeopleSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** People with their mailbox and send-as grants. */
  public async list(projectId: string): Promise<ApiResponse<MailPersonView[]>> {
    return this.client.request<MailPersonView[]>(mailPath(projectId, 'people'));
  }

  /**
   * Adds a project member (`kind: "member"`) or a mailbox-only login
   * (`kind: "standalone"`, which returns a one-time invite link) (team:manage).
   */
  public async create(
    projectId: string,
    params: CreateMailPersonParams,
  ): Promise<ApiResponse<{ person: MailPersonView; inviteUrl: string | null; inviteExpiresAt: string | null; emailed: boolean }>> {
    return this.client.request(mailPath(projectId, 'people', 'create'), { method: 'POST', body: params });
  }

  /** Updates details, state, mailbox roles and send-as identities (team:manage). */
  public async update(projectId: string, mailUserId: string, params: UpdateMailPersonParams): Promise<ApiResponse<MailPersonView>> {
    return this.client.request<MailPersonView>(mailPath(projectId, 'people', encodeURIComponent(mailUserId), 'update'), {
      method: 'PUT',
      body: params,
    });
  }

  /** Removes a person from the mail client; their mail stays in the mailboxes (team:manage). */
  public async delete(projectId: string, mailUserId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(mailPath(projectId, 'people', encodeURIComponent(mailUserId), 'delete'), {
      method: 'DELETE',
    });
  }

  /** Issues a new invite or password-reset link for a mailbox-only user; `email: true` also emails it (team:manage). */
  public async reset(
    projectId: string,
    mailUserId: string,
    params: { email?: boolean } = {},
  ): Promise<ApiResponse<{ url: string; expiresAt: string; emailed: boolean }>> {
    return this.client.request(mailPath(projectId, 'people', encodeURIComponent(mailUserId), 'reset'), { method: 'POST', body: params });
  }
}

/** Sender identities: `client.mail.identities`. */
export class MailIdentitiesSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<MailIdentityView[]>> {
    return this.client.request<MailIdentityView[]>(mailPath(projectId, 'identities'));
  }

  public async create(projectId: string, params: CreateMailIdentityParams): Promise<ApiResponse<MailIdentityView>> {
    return this.client.request<MailIdentityView>(mailPath(projectId, 'identities', 'create'), { method: 'POST', body: params });
  }

  public async update(projectId: string, identityId: string, params: UpdateMailIdentityParams): Promise<ApiResponse<MailIdentityView>> {
    return this.client.request<MailIdentityView>(mailPath(projectId, 'identities', encodeURIComponent(identityId), 'update'), {
      method: 'PUT',
      body: params,
    });
  }

  public async delete(projectId: string, identityId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(mailPath(projectId, 'identities', encodeURIComponent(identityId), 'delete'), {
      method: 'DELETE',
    });
  }
}

/** Mailbox API keys (`hfmb_…`): `client.mail.mailboxKeys`. */
export class MailMailboxKeysSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Keys without their secrets. */
  public async list(projectId: string): Promise<ApiResponse<MailApiKeyView[]>> {
    return this.client.request<MailApiKeyView[]>(mailPath(projectId, 'mailbox-keys'));
  }

  /** Creates a key. The `secret` is returned only once: store it now. */
  public async create(projectId: string, params: CreateMailMailboxKeyParams): Promise<ApiResponse<{ key: MailApiKeyView; secret: string }>> {
    return this.client.request<{ key: MailApiKeyView; secret: string }>(mailPath(projectId, 'mailbox-keys', 'create'), {
      method: 'POST',
      body: params,
    });
  }

  /** Revokes a key immediately. */
  public async revoke(projectId: string, keyId: string): Promise<ApiResponse<{ revoked: boolean }>> {
    return this.client.request<{ revoked: boolean }>(mailPath(projectId, 'mailbox-keys', encodeURIComponent(keyId), 'revoke'), {
      method: 'POST',
    });
  }
}

/**
 * HubFly Mail mailbox administration: `client.mail`. Methods need the
 * project's mail admin permission unless noted.
 */
export class MailModule {
  public readonly mailboxes: MailMailboxesSubModule;
  public readonly people: MailPeopleSubModule;
  public readonly identities: MailIdentitiesSubModule;
  public readonly mailboxKeys: MailMailboxKeysSubModule;

  constructor(private readonly client: HubflyClient) {
    this.mailboxes = new MailMailboxesSubModule(client);
    this.people = new MailPeopleSubModule(client);
    this.identities = new MailIdentitiesSubModule(client);
    this.mailboxKeys = new MailMailboxKeysSubModule(client);
  }

  /** Sets where an address delivers: one or more mailboxes and/or a verified forward. */
  public async setAddressDelivery(
    projectId: string,
    address: string,
    params: MailAddressDeliveryParams,
  ): Promise<ApiResponse<{ address: string; mailboxIds: string[]; forwardTo: string }>> {
    return this.client.request(mailPath(projectId, 'addresses', encodeURIComponent(address), 'delivery'), {
      method: 'PUT',
      body: params,
    });
  }

  /** The mail client's branding and policies (project:read). */
  public async getBrand(projectId: string): Promise<ApiResponse<MailBrandSettings>> {
    return this.client.request<MailBrandSettings>(mailPath(projectId, 'brand'));
  }

  /** Saves branding and client policies (footer, retention, limits) and applies them. */
  public async updateBrand(projectId: string, brand: Partial<MailBrandSettings>): Promise<ApiResponse<MailBrandSettings>> {
    return this.client.request<MailBrandSettings>(mailPath(projectId, 'brand', 'update'), { method: 'PUT', body: { brand } });
  }

  /** Storage pool and per-mailbox usage (project:read). `refresh: true` pulls live usage from the node. */
  public async getStorage(projectId: string, params: { refresh?: boolean } = {}): Promise<ApiResponse<MailStorageView>> {
    return this.client.request<MailStorageView>(mailPath(projectId, 'storage'), { query: { refresh: params.refresh } });
  }

  /** Whether HubFly AI is available in the project's inboxes (project:read). */
  public async getAiSettings(projectId: string): Promise<ApiResponse<MailAiSettings>> {
    return this.client.request<MailAiSettings>(mailPath(projectId, 'ai'));
  }

  /** Turns HubFly AI in the inboxes on or off (off by default). */
  public async updateAiSettings(projectId: string, params: { enabled: boolean; features?: MailAiFeature[] }): Promise<ApiResponse<MailAiSettings>> {
    return this.client.request<MailAiSettings>(mailPath(projectId, 'ai', 'update'), { method: 'PUT', body: params });
  }
}

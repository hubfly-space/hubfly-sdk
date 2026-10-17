import type { HubflyClient } from '../client.js';
import {
  callManaged,
  e2eConnectionIdError,
  encodeEventData,
  isE2EConnectionId,
  REALTIME_E2E_EVENT,
  toSocketId,
} from './managed-core.js';
import { InspectorSession } from './managed-inspector.js';
import type { InspectorConnectOptions } from './managed-inspector.js';
import type {
  CreateManagedRealtimeAppBody,
  CreateManagedRealtimeBindingBody,
  CreateManagedRealtimeInspectorTokenBody,
  CreateManagedRealtimeWebhookBody,
  DeleteManagedRealtimeAppQuery,
  DeleteManagedRealtimeBindingQuery,
  GetManagedRealtimeChannelQuery,
  GetManagedRealtimeChannelsQuery,
  GetManagedRealtimeConnectionsQuery,
  GetManagedRealtimeHistoryQuery,
  GetManagedRealtimeInsightsQuery,
  GetManagedRealtimeInspectorRecentQuery,
  GetManagedRealtimeUsageQuery,
  GetManagedRealtimeWebhookDeliveriesQuery,
  ManagedRealtimeChannel,
  ManagedRealtimeConnection,
  ManagedRealtimeWebhookDelivery,
  PostManagedRealtimeConnectionTerminateBody,
  PostManagedRealtimeHistoryPurgeBody,
  PostManagedRealtimeKeyRotateBody,
  PostManagedRealtimePublishBody,
  PostManagedRealtimeSendBody,
  PostManagedRealtimeUserTerminateBody,
  UpdateManagedRealtimeAppBody,
  UpdateManagedRealtimeAppSettingsBody,
  UpdateManagedRealtimeWebhookBody,
} from './managed-types.js';

/** Input of {@link ManagedRealtimeSubModule.publish}: `data` may be any JSON value (non-strings are JSON-encoded). */
export type ManagedRealtimePublishInput = Omit<PostManagedRealtimePublishBody, 'data'> & { data: unknown };

/**
 * Input of {@link ManagedRealtimeSubModule.send}: `data` may be any JSON value
 * (non-strings are JSON-encoded). `socketIds` may hold end-to-end connection
 * ids; the SDK drops their key before sending.
 */
export type ManagedRealtimeSendInput = Omit<PostManagedRealtimeSendBody, 'data'> & { data: unknown };

/**
 * HubFly Realtime servers through the Dashboard API: `client.managed.realtime`.
 *
 * Permission levels: `realtime:read` (metadata), `realtime:publish` (events,
 * history, live connections, channel inspect and the inspector) and `realtime:admin` (apps, keys, webhooks, bindings, terminate,
 * purge). A database instance answers these routes with 409
 * MANAGED_FEATURE_UNSUPPORTED. Features the running engine version lacks
 * answer 409 MANAGED_REALTIME_ENGINE_UNSUPPORTED.
 *
 * End-to-end connection ids (`<socket_id>~<key>`) are accepted wherever a
 * socket id is: the key part is removed on this machine before any request
 * (HubFly must never see it), and plaintext `send` to such an id is refused
 * locally with MANAGED_REALTIME_E2E_CONNECTION_ID.
 */
export class ManagedRealtimeSubModule {
  constructor(private readonly client: HubflyClient) {}

  // ---- Apps ----------------------------------------------------------------

  /** Lists the server's apps with their keys (public parts only) (realtime:read). */
  public listApps(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedRealtimeApps', { projectId, instanceId });
  }

  /** One app with its settings and keys (realtime:read). */
  public getApp(projectId: string, instanceId: string, appId: string) {
    return callManaged(this.client, 'getManagedRealtimeApp', { projectId, instanceId, appId });
  }

  /** **Returns a secret:** creates an app and its first key; `secret` is returned once (realtime:admin). */
  public createApp(projectId: string, instanceId: string, body: CreateManagedRealtimeAppBody) {
    return callManaged(this.client, 'createManagedRealtimeApp', { projectId, instanceId }, { body });
  }

  /** Renames, enables or disables an app (realtime:admin). */
  public updateApp(projectId: string, instanceId: string, appId: string, body: UpdateManagedRealtimeAppBody) {
    return callManaged(this.client, 'updateManagedRealtimeApp', { projectId, instanceId, appId }, { body });
  }

  /**
   * Changes app settings (realtime:admin). Pass the app's `settingsRevision`
   * as `revision`; a stale revision answers 409.
   */
  public updateAppSettings(projectId: string, instanceId: string, appId: string, body: UpdateManagedRealtimeAppSettingsBody) {
    return callManaged(this.client, 'updateManagedRealtimeAppSettings', { projectId, instanceId, appId }, { body });
  }

  /** Deletes an app (realtime:admin). `confirmName` must equal the app name. */
  public deleteApp(projectId: string, instanceId: string, appId: string, query: DeleteManagedRealtimeAppQuery) {
    return callManaged(this.client, 'deleteManagedRealtimeApp', { projectId, instanceId, appId }, { query });
  }

  // ---- Keys ----------------------------------------------------------------

  /** Lists an app's keys: public key, secret hint and fingerprint, never the secret (realtime:read). */
  public listKeys(projectId: string, instanceId: string, appId: string) {
    return callManaged(this.client, 'getManagedRealtimeKeys', { projectId, instanceId, appId });
  }

  /** **Returns a secret:** creates a key; `secret` is returned once (realtime:admin). */
  public createKey(projectId: string, instanceId: string, appId: string) {
    return callManaged(this.client, 'createManagedRealtimeKey', { projectId, instanceId, appId });
  }

  /**
   * **Returns a secret:** replaces a key with a new one. The old key keeps
   * working for `graceSeconds` (status `retiring`) (realtime:admin).
   */
  public rotateKey(projectId: string, instanceId: string, appId: string, keyId: string, body: PostManagedRealtimeKeyRotateBody = {}) {
    return callManaged(this.client, 'postManagedRealtimeKeyRotate', { projectId, instanceId, appId, keyId }, { body });
  }

  /** Revokes a key at once; revoked keys are kept, never reused (realtime:admin). */
  public revokeKey(projectId: string, instanceId: string, appId: string, keyId: string) {
    return callManaged(this.client, 'postManagedRealtimeKeyRevoke', { projectId, instanceId, appId, keyId });
  }

  /** **Returns a secret:** the key's secret (realtime:admin; refused for revoked keys). */
  public revealKey(projectId: string, instanceId: string, appId: string, keyId: string) {
    return callManaged(this.client, 'postManagedRealtimeKeyReveal', { projectId, instanceId, appId, keyId });
  }

  // ---- Webhooks ------------------------------------------------------------

  /**
   * Lists an app's webhooks (realtime:read). URLs are returned in full to realtime:admin; other
   * callers see the query string as `?[hidden]`. Treat tokens in URLs as secrets.
   */
  public listWebhooks(projectId: string, instanceId: string, appId: string) {
    return callManaged(this.client, 'getManagedRealtimeWebhooks', { projectId, instanceId, appId });
  }

  /** Adds a webhook: https on port 443 or 8443, public addresses only (realtime:admin). */
  public createWebhook(projectId: string, instanceId: string, appId: string, body: CreateManagedRealtimeWebhookBody) {
    return callManaged(this.client, 'createManagedRealtimeWebhook', { projectId, instanceId, appId }, { body });
  }

  /** Changes a webhook (realtime:admin). */
  public updateWebhook(projectId: string, instanceId: string, appId: string, webhookId: string, body: UpdateManagedRealtimeWebhookBody) {
    return callManaged(this.client, 'updateManagedRealtimeWebhook', { projectId, instanceId, appId, webhookId }, { body });
  }

  /** Deletes a webhook (realtime:admin). */
  public deleteWebhook(projectId: string, instanceId: string, appId: string, webhookId: string) {
    return callManaged(this.client, 'deleteManagedRealtimeWebhook', { projectId, instanceId, appId, webhookId });
  }

  /** Sends a signed test delivery and reports the receiver's answer (realtime:admin). */
  public testWebhook(projectId: string, instanceId: string, appId: string, webhookId: string) {
    return callManaged(this.client, 'postManagedRealtimeWebhookTest', { projectId, instanceId, appId, webhookId });
  }

  /** Recent deliveries, newest first; page with `nextCursor` (realtime:read). */
  public getWebhookDeliveries(projectId: string, instanceId: string, appId: string, query?: GetManagedRealtimeWebhookDeliveriesQuery) {
    return callManaged(this.client, 'getManagedRealtimeWebhookDeliveries', { projectId, instanceId, appId }, { query });
  }

  /** Every delivery, following `nextCursor` (realtime:read). */
  public async *iterateWebhookDeliveries(
    projectId: string,
    instanceId: string,
    appId: string,
    query: Omit<GetManagedRealtimeWebhookDeliveriesQuery, 'cursor'> = {},
  ): AsyncGenerator<ManagedRealtimeWebhookDelivery> {
    let cursor: string | undefined;
    do {
      const { data } = await this.getWebhookDeliveries(projectId, instanceId, appId, { ...query, cursor });
      yield* data.items;
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  }

  /** Delivers a failed or dead delivery again (realtime:admin). */
  public redeliverWebhook(projectId: string, instanceId: string, appId: string, deliveryId: string) {
    return callManaged(this.client, 'postManagedRealtimeWebhookRedeliver', { projectId, instanceId, appId, deliveryId });
  }

  // ---- Events --------------------------------------------------------------

  /**
   * Publishes an event to channels, with the app's limits, E2E policy,
   * history and webhooks applied (realtime:publish). Apps whose encryption
   * policy is `required` refuse plaintext with 403
   * MANAGED_REALTIME_E2E_REQUIRED; payloads over the app limit answer 413.
   */
  public async publish(projectId: string, instanceId: string, appId: string, input: ManagedRealtimePublishInput) {
    const { data, excludeSocketId, ...rest } = input;
    const body: PostManagedRealtimePublishBody = { ...rest, data: encodeEventData(data) };
    if (excludeSocketId !== undefined) body.excludeSocketId = toSocketId(excludeSocketId);
    return callManaged(this.client, 'postManagedRealtimePublish', { projectId, instanceId, appId }, { body });
  }

  /**
   * Sends an event to 1–100 connections or to every connection of one user
   * (realtime:publish). Each target gets a status (delivered, buffered,
   * queued or offline) and `counts` sums them. End-to-end connection ids lose
   * their key here; plaintext to them is refused before any request (send
   * sealed `hubfly.e2e` envelopes from your own server instead).
   */
  public async send(projectId: string, instanceId: string, appId: string, input: ManagedRealtimeSendInput) {
    const { data, socketIds, ...rest } = input;
    const body: PostManagedRealtimeSendBody = { ...rest, data: '' };
    if (socketIds !== undefined) {
      if (socketIds.some(isE2EConnectionId) && input.event !== REALTIME_E2E_EVENT) throw e2eConnectionIdError();
      body.socketIds = [...new Set(socketIds.map(toSocketId))];
    }
    body.data = encodeEventData(data);
    return callManaged(this.client, 'postManagedRealtimeSend', { projectId, instanceId, appId }, { body });
  }

  // ---- Channels, connections, users ---------------------------------------

  /** Occupied channels; page with `nextCursor` (realtime:read). */
  public listChannels(projectId: string, instanceId: string, appId: string, query?: GetManagedRealtimeChannelsQuery) {
    return callManaged(this.client, 'getManagedRealtimeChannels', { projectId, instanceId, appId }, { query });
  }

  /** Every occupied channel, following `nextCursor` (realtime:read). */
  public async *iterateChannels(
    projectId: string,
    instanceId: string,
    appId: string,
    query: Omit<GetManagedRealtimeChannelsQuery, 'cursor'> = {},
  ): AsyncGenerator<ManagedRealtimeChannel> {
    let cursor: string | undefined;
    do {
      const { data } = await this.listChannels(projectId, instanceId, appId, { ...query, cursor });
      yield* data.items;
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  }

  /**
   * One channel: subscribers, presence members (`userInfo` is JSON text),
   * history and cache state (realtime:publish). Not cached.
   */
  public inspectChannel(projectId: string, instanceId: string, appId: string, query: GetManagedRealtimeChannelQuery) {
    return callManaged(this.client, 'getManagedRealtimeChannel', { projectId, instanceId, appId }, { query });
  }

  /**
   * Live connections, filterable by app, user, channel or connection id
   * (realtime:publish). Not cached: holds client IPs and user ids. An end-to-end
   * `connectionId` filter loses its key before the request.
   */
  public listConnections(projectId: string, instanceId: string, query: GetManagedRealtimeConnectionsQuery = {}) {
    const filtered = query.connectionId === undefined ? query : { ...query, connectionId: toSocketId(query.connectionId) };
    return callManaged(this.client, 'getManagedRealtimeConnections', { projectId, instanceId }, { query: filtered });
  }

  /** Every matching connection, following `nextCursor` (realtime:publish). */
  public async *iterateConnections(
    projectId: string,
    instanceId: string,
    query: Omit<GetManagedRealtimeConnectionsQuery, 'cursor'> = {},
  ): AsyncGenerator<ManagedRealtimeConnection> {
    let cursor: string | undefined;
    do {
      const { data } = await this.listConnections(projectId, instanceId, { ...query, cursor });
      yield* data.items;
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  }

  /**
   * Closes one connection (realtime:admin): mode `terminate` (4009, no
   * reconnect) or `disconnect` (4200, the client reconnects at once). An
   * end-to-end connection id loses its key before the request.
   */
  public terminateConnection(projectId: string, instanceId: string, appId: string, body: PostManagedRealtimeConnectionTerminateBody) {
    const request: PostManagedRealtimeConnectionTerminateBody = { ...body, socketId: toSocketId(body.socketId) };
    return callManaged(this.client, 'postManagedRealtimeConnectionTerminate', { projectId, instanceId, appId }, { body: request });
  }

  /** Closes every connection of a signed-in user (realtime:admin). */
  public terminateUser(projectId: string, instanceId: string, appId: string, body: PostManagedRealtimeUserTerminateBody) {
    return callManaged(this.client, 'postManagedRealtimeUserTerminate', { projectId, instanceId, appId }, { body });
  }

  // ---- History -------------------------------------------------------------

  /**
   * A channel's retained messages: the newest `limit`, or those after offset
   * `since` (realtime:publish). `data` is the event's data string (JSON text
   * or a sealed envelope). `gap: true` means messages after `since` were
   * already dropped or the epoch changed. Not cached.
   */
  public getHistory(projectId: string, instanceId: string, appId: string, query: GetManagedRealtimeHistoryQuery) {
    return callManaged(this.client, 'getManagedRealtimeHistory', { projectId, instanceId, appId }, { query });
  }

  /** Deletes retained messages of one channel, or of the whole app without `channel` (realtime:admin). */
  public purgeHistory(projectId: string, instanceId: string, appId: string, body: PostManagedRealtimeHistoryPurgeBody = {}) {
    return callManaged(this.client, 'postManagedRealtimeHistoryPurge', { projectId, instanceId, appId }, { body });
  }

  // ---- Observability -------------------------------------------------------

  /** Traffic, latency, top channels/events, auth failures and webhook health (realtime:read). */
  public getInsights(projectId: string, instanceId: string, query?: GetManagedRealtimeInsightsQuery) {
    return callManaged(this.client, 'getManagedRealtimeInsights', { projectId, instanceId }, { query });
  }

  /** Daily usage: connection minutes, messages and bytes (realtime:read). */
  public getUsage(projectId: string, instanceId: string, query?: GetManagedRealtimeUsageQuery) {
    return callManaged(this.client, 'getManagedRealtimeUsage', { projectId, instanceId }, { query });
  }

  /**
   * **Returns a secret:** a short-lived inspector token (EdDSA JWT, 90 s by
   * default, at most 120 s) and the inspector socket `url` (realtime:publish).
   * Send the token as the socket's first frame (never in the URL). Payload
   * previews need realtime:publish or admin plus `payloadPreview: true`.
   */
  public createInspectorToken(projectId: string, instanceId: string, body: CreateManagedRealtimeInspectorTokenBody = {}) {
    return callManaged(this.client, 'createManagedRealtimeInspectorToken', { projectId, instanceId }, { body });
  }

  /**
   * Opens a live inspector session: mints an inspector token (realtime:publish;
   * see {@link createInspectorToken}), connects to the server's
   * `/hubfly/v1/inspect` socket with the token's origin and sends the token as
   * the first frame. Resolves once the server answers `ready`; rejects with
   * RealtimeInspectorError on close codes 4401/4403/4408/4429. Events arrive
   * through `onEvent`. Needs a realtime engine with the inspector socket.
   */
  public async openInspector(
    projectId: string,
    instanceId: string,
    options: InspectorConnectOptions & CreateManagedRealtimeInspectorTokenBody = {},
  ): Promise<InspectorSession> {
    const { origin, apps, payloadPreview, ...connect } = options;
    const body: CreateManagedRealtimeInspectorTokenBody = {};
    if (origin !== undefined) body.origin = origin;
    if (apps !== undefined) body.apps = apps;
    if (payloadPreview !== undefined) body.payloadPreview = payloadPreview;
    const { data } = await this.createInspectorToken(projectId, instanceId, body);
    return InspectorSession.connect(data, connect);
  }

  /**
   * Polling alternative to the inspector socket: events after `afterSeq`
   * (pass back `nextSeq`) (realtime:publish). Nested values arrive as JSON text;
   * payload previews only with publish or admin plus `payloadPreview`. Not cached.
   */
  public getInspectorRecent(projectId: string, instanceId: string, query?: GetManagedRealtimeInspectorRecentQuery) {
    return callManaged(this.client, 'getManagedRealtimeInspectorRecent', { projectId, instanceId }, { query });
  }

  // ---- Bindings and connection details ---------------------------------------

  /** Projects this server is bound to (realtime:admin). */
  public listBindings(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedRealtimeBindings', { projectId, instanceId });
  }

  /**
   * Binds an app to a project: writes the connection variables, including the
   * key secret, into the target project's environment (realtime:admin +
   * project:edit on the target). The secret is not returned.
   */
  public createBinding(projectId: string, instanceId: string, body: CreateManagedRealtimeBindingBody) {
    return callManaged(this.client, 'createManagedRealtimeBinding', { projectId, instanceId }, { body });
  }

  /** Removes a binding and, unless `removeVariables: false`, its variables (realtime:admin + project:edit on the target). */
  public deleteBinding(projectId: string, instanceId: string, bindingId: string, query?: DeleteManagedRealtimeBindingQuery) {
    return callManaged(this.client, 'deleteManagedRealtimeBinding', { projectId, instanceId, bindingId }, { query });
  }

  /**
   * Host, URLs, public app keys, pusher-js options and the environment
   * variable names (no secrets) (realtime:read).
   */
  public getConnection(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedRealtimeConnection', { projectId, instanceId });
  }
}

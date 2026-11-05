import type { HubflyClient } from '../client.js';
import { callManaged } from './managed-core.js';
import type {
  CreateManagedStreamBindingBody,
  CreateManagedStreamChannelBody,
  CreateManagedStreamClipBody,
  CreateManagedStreamDestinationBody,
  CreateManagedStreamDomainBody,
  CreateManagedStreamInputBody,
  CreateManagedStreamMixerBody,
  CreateManagedStreamPlaybackKeyBody,
  CreateManagedStreamPlaybackTokenBody,
  CreateManagedStreamPlaylistBody,
  CreateManagedStreamScheduleBody,
  CreateManagedStreamStorageLinkBody,
  CreateManagedStreamStudioTokenBody,
  CreateManagedStreamWebhookBody,
  DeleteManagedStreamBindingQuery,
  DeleteManagedStreamRecordingQuery,
  GetManagedStreamStatsQuery,
  GetManagedStreamUsageQuery,
  GetStreamPriceEstimateQuery,
  ListManagedStreamEventsQuery,
  ListManagedStreamRecordingsQuery,
  ListManagedStreamScheduleRunsQuery,
  ListManagedStreamStorageAssetsQuery,
  ListManagedStreamWebhookDeliveriesQuery,
  PostManagedStreamControlBody,
  PreviewManagedStreamScheduleBody,
  RotateManagedStreamInputKeyBody,
  UpdateManagedStreamChannelBody,
  UpdateManagedStreamDestinationBody,
  UpdateManagedStreamGraphicBody,
  UpdateManagedStreamInputBody,
  UpdateManagedStreamMixerBody,
  UpdateManagedStreamPlaylistBody,
  UpdateManagedStreamScheduleBody,
  UpdateManagedStreamSettingsBody,
  UpdateManagedStreamWebhookBody,
  UploadManagedStreamGraphicBody,
} from './managed-types.js';

/**
 * HubFly Managed Streams servers through the Dashboard API: `client.managed.streams`.
 *
 * Create, resize, stop, start and delete stream servers with the shared
 * `client.managed.instances` methods (`service: "stream"`, `stream: {speedMbps}`).
 *
 * Permission levels: `stream:read` (everything except secrets),
 * `stream:operate` (live control, clips, test playback tokens, studio operate
 * scope) and `stream:admin` (every create, update and delete, key reveal and
 * rotation, domains, storage links, bindings). A database or realtime
 * instance answers these routes with 409 MANAGED_FEATURE_UNSUPPORTED.
 *
 * Secrets are write-only: inputs return only `keyHints`, destinations only
 * `streamKeyHint`. Methods marked **Returns a secret** return one once; keep
 * their responses on your server and out of logs. Updates take the
 * `revision` you read; a stale one is 409 STREAM_REVISION_CONFLICT.
 */
export class ManagedStreamsSubModule {
  constructor(private readonly client: HubflyClient) {}

  // ---- Server ----------------------------------------------------------------

  /** The server summary with its offline slate, allowed origins and studio origins (stream:read). */
  public getServer(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedStreamServer', { projectId, instanceId });
  }

  /** Updates the timezone, offline slate, allowed origins or WebRTC session cap (stream:admin). */
  public updateSettings(projectId: string, instanceId: string, body: UpdateManagedStreamSettingsBody = {}) {
    return callManaged(this.client, 'updateManagedStreamSettings', { projectId, instanceId }, { body });
  }

  /** The node's live status (inputs, channels, viewers, destinations), cached for up to 2 s (stream:read). */
  public getLive(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedStreamLive', { projectId, instanceId });
  }

  /** Viewer statistics for a time range, optionally for one channel (stream:read). */
  public getStats(projectId: string, instanceId: string, query?: GetManagedStreamStatsQuery) {
    return callManaged(this.client, 'getManagedStreamStats', { projectId, instanceId }, { query });
  }

  /** Usage and cost of a month (`month` is YYYY-MM; default the current month), with the free allowance and an estimate (stream:read). */
  public getUsage(projectId: string, instanceId: string, query?: GetManagedStreamUsageQuery) {
    return callManaged(this.client, 'getManagedStreamUsage', { projectId, instanceId }, { query });
  }

  /** Server events after a cursor (`nextCursor` pages forward) (stream:read). */
  public listEvents(projectId: string, instanceId: string, query?: ListManagedStreamEventsQuery) {
    return callManaged(this.client, 'listManagedStreamEvents', { projectId, instanceId }, { query });
  }

  /** Runs live control ops (go live, scene switch, destination and recording start/stop, slate) and returns one result per op (stream:operate). */
  public control(projectId: string, instanceId: string, body: PostManagedStreamControlBody) {
    return callManaged(this.client, 'postManagedStreamControl', { projectId, instanceId }, { body });
  }

  /** **Returns a secret:** a short-lived studio token and the studio socket `url`. Send the token as the first frame `{"type":"auth","token":…}`, never in the URL. Operators also get the `operate` scope (stream:read). */
  public createStudioToken(projectId: string, instanceId: string, body: CreateManagedStreamStudioTokenBody = {}) {
    return callManaged(this.client, 'createManagedStreamStudioToken', { projectId, instanceId }, { body });
  }

  /** The hourly and monthly speed price for `speedMbps` (and `processingMbps`); `quotedHourlyTotal` on create and resize is `hourly.speedMicroUsd / 1e6` (a signed-in session). */
  public estimatePrice(query: GetStreamPriceEstimateQuery) {
    return callManaged(this.client, 'getStreamPriceEstimate', {}, { query });
  }

  // ---- Inputs ----------------------------------------------------------------

  /** The server's inputs. Keys are never returned, only `keyHints` (stream:read). */
  public listInputs(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamInputs', { projectId, instanceId });
  }

  /** One input with `connection`: the per-protocol URLs, keys masked (stream:read). */
  public getInput(projectId: string, instanceId: string, inputId: string) {
    return callManaged(this.client, 'getManagedStreamInput', { projectId, instanceId, inputId });
  }

  /** **Returns secrets:** creates an input; `keys.primary` (and `keys.backup`) are returned once. Pull inputs return `keys: null` (stream:admin). */
  public createInput(projectId: string, instanceId: string, body: CreateManagedStreamInputBody) {
    return callManaged(this.client, 'createManagedStreamInput', { projectId, instanceId }, { body });
  }

  /** Updates an input; send the `revision` you read (a stale one is 409 STREAM_REVISION_CONFLICT) (stream:admin). */
  public updateInput(projectId: string, instanceId: string, inputId: string, body: UpdateManagedStreamInputBody) {
    return callManaged(this.client, 'updateManagedStreamInput', { projectId, instanceId, inputId }, { body });
  }

  /** Deletes an input; refused with 409 STREAM_IN_USE while a channel, mixer or destination uses it (stream:admin). */
  public deleteInput(projectId: string, instanceId: string, inputId: string) {
    return callManaged(this.client, 'deleteManagedStreamInput', { projectId, instanceId, inputId });
  }

  /** **Returns secrets:** the input's stream keys (and SRT passphrase, or pull URL). Never log the response (stream:admin). */
  public revealInputKeys(projectId: string, instanceId: string, inputId: string) {
    return callManaged(this.client, 'revealManagedStreamInputKeys', { projectId, instanceId, inputId });
  }

  /** **Returns a secret:** replaces the primary or backup key (or removes the backup with `remove: true`); the publisher on the old key is disconnected (stream:admin). */
  public rotateInputKey(projectId: string, instanceId: string, inputId: string, body: RotateManagedStreamInputKeyBody) {
    return callManaged(this.client, 'rotateManagedStreamInputKey', { projectId, instanceId, inputId }, { body });
  }

  // ---- Channels --------------------------------------------------------------

  /** The server's channels (stream:read). */
  public listChannels(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamChannels', { projectId, instanceId });
  }

  /** One channel with its billed `processingMbps` and playback URLs (stream:read). */
  public getChannel(projectId: string, instanceId: string, channelId: string) {
    return callManaged(this.client, 'getManagedStreamChannel', { projectId, instanceId, channelId });
  }

  /** Creates a channel (source, ladder, latency, playback outputs, access, DVR, recording) (stream:admin). */
  public createChannel(projectId: string, instanceId: string, body: CreateManagedStreamChannelBody) {
    return callManaged(this.client, 'createManagedStreamChannel', { projectId, instanceId }, { body });
  }

  /** Updates a channel; send the `revision` you read (stream:admin). */
  public updateChannel(projectId: string, instanceId: string, channelId: string, body: UpdateManagedStreamChannelBody) {
    return callManaged(this.client, 'updateManagedStreamChannel', { projectId, instanceId, channelId }, { body });
  }

  /** Deletes a channel (stream:admin). */
  public deleteChannel(projectId: string, instanceId: string, channelId: string) {
    return callManaged(this.client, 'deleteManagedStreamChannel', { projectId, instanceId, channelId });
  }

  /** Playback URLs (HLS, WHEP, embed, thumbnail, status, audio, pulls), the embed HTML and whether a token is required (stream:read). */
  public getChannelPlayback(projectId: string, instanceId: string, channelId: string) {
    return callManaged(this.client, 'getManagedStreamChannelPlayback', { projectId, instanceId, channelId });
  }

  /** **Returns a secret:** a test playback token (at most 24 h) signed with the newest active playback key. Mint production tokens on your own server with `@hubfly/streams/server` or Go `streams.SignPlaybackToken` (stream:operate). */
  public createPlaybackToken(projectId: string, instanceId: string, channelId: string, body: CreateManagedStreamPlaybackTokenBody) {
    return callManaged(this.client, 'createManagedStreamPlaybackToken', { projectId, instanceId, channelId }, { body });
  }

  // ---- Mixers ----------------------------------------------------------------

  /** The server's mixers (stream:read). */
  public listMixers(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamMixers', { projectId, instanceId });
  }

  /** One mixer with its canvas, sources and scenes (stream:read). */
  public getMixer(projectId: string, instanceId: string, mixerId: string) {
    return callManaged(this.client, 'getManagedStreamMixer', { projectId, instanceId, mixerId });
  }

  /** Creates a mixer (optionally from a `preset`) (stream:admin). */
  public createMixer(projectId: string, instanceId: string, body: CreateManagedStreamMixerBody) {
    return callManaged(this.client, 'createManagedStreamMixer', { projectId, instanceId }, { body });
  }

  /** Updates a mixer; send the `revision` you read. Switch scenes live with `Control` instead (stream:admin). */
  public updateMixer(projectId: string, instanceId: string, mixerId: string, body: UpdateManagedStreamMixerBody) {
    return callManaged(this.client, 'updateManagedStreamMixer', { projectId, instanceId, mixerId }, { body });
  }

  /** Deletes a mixer (stream:admin). */
  public deleteMixer(projectId: string, instanceId: string, mixerId: string) {
    return callManaged(this.client, 'deleteManagedStreamMixer', { projectId, instanceId, mixerId });
  }

  // ---- Destinations ----------------------------------------------------------

  /** Restream destinations; stream keys are never returned, only `streamKeyHint` (stream:read). */
  public listDestinations(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamDestinations', { projectId, instanceId });
  }

  /** One destination (stream:read). */
  public getDestination(projectId: string, instanceId: string, destinationId: string) {
    return callManaged(this.client, 'getManagedStreamDestination', { projectId, instanceId, destinationId });
  }

  /** Creates a destination (platform preset or custom URL); `streamKey` is write-only (stream:admin). */
  public createDestination(projectId: string, instanceId: string, body: CreateManagedStreamDestinationBody) {
    return callManaged(this.client, 'createManagedStreamDestination', { projectId, instanceId }, { body });
  }

  /** Updates a destination; send the `revision` you read (stream:admin). */
  public updateDestination(projectId: string, instanceId: string, destinationId: string, body: UpdateManagedStreamDestinationBody) {
    return callManaged(this.client, 'updateManagedStreamDestination', { projectId, instanceId, destinationId }, { body });
  }

  /** Deletes a destination (stream:admin). */
  public deleteDestination(projectId: string, instanceId: string, destinationId: string) {
    return callManaged(this.client, 'deleteManagedStreamDestination', { projectId, instanceId, destinationId });
  }

  // ---- Playback keys ---------------------------------------------------------

  /** Playback keys (id, name, status, fingerprint); secrets are never listed (stream:read). */
  public listPlaybackKeys(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamPlaybackKeys', { projectId, instanceId });
  }

  /** **Returns a secret:** creates a playback key; `secret` is returned once (stream:admin). */
  public createPlaybackKey(projectId: string, instanceId: string, body: CreateManagedStreamPlaybackKeyBody) {
    return callManaged(this.client, 'createManagedStreamPlaybackKey', { projectId, instanceId }, { body });
  }

  /** **Returns a secret:** creates a new key and marks the old one `retiring` for 24 h (`retired` names it) (stream:admin). */
  public rotatePlaybackKey(projectId: string, instanceId: string, keyId: string) {
    return callManaged(this.client, 'rotateManagedStreamPlaybackKey', { projectId, instanceId, keyId });
  }

  /** Revokes a playback key: tokens it signed stop working (stream:admin). */
  public deletePlaybackKey(projectId: string, instanceId: string, keyId: string) {
    return callManaged(this.client, 'deleteManagedStreamPlaybackKey', { projectId, instanceId, keyId });
  }

  // ---- Playlists -------------------------------------------------------------

  /** The server's playlists (stream:read). */
  public listPlaylists(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamPlaylists', { projectId, instanceId });
  }

  /** One playlist with its items (stream:read). */
  public getPlaylist(projectId: string, instanceId: string, playlistId: string) {
    return callManaged(this.client, 'getManagedStreamPlaylist', { projectId, instanceId, playlistId });
  }

  /** Creates a playlist; items reference a Storage object or asset, or a URL (stream:admin). */
  public createPlaylist(projectId: string, instanceId: string, body: CreateManagedStreamPlaylistBody) {
    return callManaged(this.client, 'createManagedStreamPlaylist', { projectId, instanceId }, { body });
  }

  /** Updates a playlist; send the `revision` you read (stream:admin). */
  public updatePlaylist(projectId: string, instanceId: string, playlistId: string, body: UpdateManagedStreamPlaylistBody) {
    return callManaged(this.client, 'updateManagedStreamPlaylist', { projectId, instanceId, playlistId }, { body });
  }

  /** Deletes a playlist (stream:admin). */
  public deletePlaylist(projectId: string, instanceId: string, playlistId: string) {
    return callManaged(this.client, 'deleteManagedStreamPlaylist', { projectId, instanceId, playlistId });
  }

  // ---- Schedules -------------------------------------------------------------

  /** The server's schedules (stream:read). */
  public listSchedules(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamSchedules', { projectId, instanceId });
  }

  /** One schedule with its next 10 starts (`upcoming`, UTC) (stream:read). */
  public getSchedule(projectId: string, instanceId: string, scheduleId: string) {
    return callManaged(this.client, 'getManagedStreamSchedule', { projectId, instanceId, scheduleId });
  }

  /** Creates a schedule (start, RRULE, duration, timezone, actions) (stream:admin). */
  public createSchedule(projectId: string, instanceId: string, body: CreateManagedStreamScheduleBody) {
    return callManaged(this.client, 'createManagedStreamSchedule', { projectId, instanceId }, { body });
  }

  /** Updates a schedule; send the `revision` you read (stream:admin). */
  public updateSchedule(projectId: string, instanceId: string, scheduleId: string, body: UpdateManagedStreamScheduleBody) {
    return callManaged(this.client, 'updateManagedStreamSchedule', { projectId, instanceId, scheduleId }, { body });
  }

  /** Deletes a schedule (stream:admin). */
  public deleteSchedule(projectId: string, instanceId: string, scheduleId: string) {
    return callManaged(this.client, 'deleteManagedStreamSchedule', { projectId, instanceId, scheduleId });
  }

  /** The next 20 starts of a start + RRULE in a timezone, or the validation errors (stream:read). */
  public previewSchedule(projectId: string, instanceId: string, body: PreviewManagedStreamScheduleBody) {
    return callManaged(this.client, 'previewManagedStreamSchedule', { projectId, instanceId }, { body });
  }

  /** Past runs of a schedule (stream:read). */
  public listScheduleRuns(projectId: string, instanceId: string, scheduleId: string, query?: ListManagedStreamScheduleRunsQuery) {
    return callManaged(this.client, 'listManagedStreamScheduleRuns', { projectId, instanceId, scheduleId }, { query });
  }

  // ---- Recordings and clips --------------------------------------------------

  /** Recordings and clips with their Storage links (stream:read). */
  public listRecordings(projectId: string, instanceId: string, query?: ListManagedStreamRecordingsQuery) {
    return callManaged(this.client, 'listManagedStreamRecordings', { projectId, instanceId }, { query });
  }

  /** Cuts a clip from a channel's DVR window (409 STREAM_NOT_LIVE without DVR) (stream:operate). */
  public createClip(projectId: string, instanceId: string, body: CreateManagedStreamClipBody) {
    return callManaged(this.client, 'createManagedStreamClip', { projectId, instanceId }, { body });
  }

  /** Removes a recording or clip record; `deleteObject: true` also deletes the Storage object (stream:admin). */
  public deleteRecording(projectId: string, instanceId: string, recordingId: string, query?: DeleteManagedStreamRecordingQuery) {
    return callManaged(this.client, 'deleteManagedStreamRecording', { projectId, instanceId, recordingId }, { query });
  }

  // ---- Webhooks --------------------------------------------------------------

  /** The server's webhooks; secrets are never listed (stream:read). */
  public listWebhooks(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamWebhooks', { projectId, instanceId });
  }

  /** **Returns a secret:** creates a webhook; the `whsec_` secret is returned once. Verify deliveries with `@hubfly/streams/server` `verifyWebhook` or Go `streams.VerifyWebhook` (stream:admin). */
  public createWebhook(projectId: string, instanceId: string, body: CreateManagedStreamWebhookBody) {
    return callManaged(this.client, 'createManagedStreamWebhook', { projectId, instanceId }, { body });
  }

  /** Updates a webhook's URL, events or enabled state (stream:admin). */
  public updateWebhook(projectId: string, instanceId: string, webhookId: string, body: UpdateManagedStreamWebhookBody) {
    return callManaged(this.client, 'updateManagedStreamWebhook', { projectId, instanceId, webhookId }, { body });
  }

  /** Deletes a webhook (stream:admin). */
  public deleteWebhook(projectId: string, instanceId: string, webhookId: string) {
    return callManaged(this.client, 'deleteManagedStreamWebhook', { projectId, instanceId, webhookId });
  }

  /** Delivery attempts of a webhook, newest first (stream:read). */
  public listWebhookDeliveries(projectId: string, instanceId: string, webhookId: string, query?: ListManagedStreamWebhookDeliveriesQuery) {
    return callManaged(this.client, 'listManagedStreamWebhookDeliveries', { projectId, instanceId, webhookId }, { query });
  }

  /** Sends a signed `webhook.test` event from the Dashboard and returns the result (stream:admin). */
  public testWebhook(projectId: string, instanceId: string, webhookId: string) {
    return callManaged(this.client, 'testManagedStreamWebhook', { projectId, instanceId, webhookId });
  }

  // ---- Graphics --------------------------------------------------------------

  /** Graphics (slates, overlays, lower thirds) of the server (stream:read). */
  public listGraphics(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamGraphics', { projectId, instanceId });
  }

  /** Uploads a graphic (`dataBase64`, at most 5 MiB decoded) (stream:admin). */
  public uploadGraphic(projectId: string, instanceId: string, body: UploadManagedStreamGraphicBody) {
    return callManaged(this.client, 'uploadManagedStreamGraphic', { projectId, instanceId }, { body });
  }

  /** Renames a graphic or changes its template variables (stream:admin). */
  public updateGraphic(projectId: string, instanceId: string, graphicId: string, body: UpdateManagedStreamGraphicBody) {
    return callManaged(this.client, 'updateManagedStreamGraphic', { projectId, instanceId, graphicId }, { body });
  }

  /** Deletes a graphic (stream:admin). */
  public deleteGraphic(projectId: string, instanceId: string, graphicId: string) {
    return callManaged(this.client, 'deleteManagedStreamGraphic', { projectId, instanceId, graphicId });
  }

  // ---- Storage links ---------------------------------------------------------

  /** HubFly Storage buckets linked for recordings and playlists; S3 secrets are never returned (stream:read). */
  public listStorageLinks(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamStorageLinks', { projectId, instanceId });
  }

  /** Links a Storage bucket (the caller also needs storage:admin on that project) (stream:admin). */
  public createStorageLink(projectId: string, instanceId: string, body: CreateManagedStreamStorageLinkBody) {
    return callManaged(this.client, 'createManagedStreamStorageLink', { projectId, instanceId }, { body });
  }

  /** Unlinks a Storage bucket (stream:admin). */
  public deleteStorageLink(projectId: string, instanceId: string, linkId: string) {
    return callManaged(this.client, 'deleteManagedStreamStorageLink', { projectId, instanceId, linkId });
  }

  /** Media assets in a linked bucket (needs media:read on the Storage project), newest first (stream:read). */
  public listStorageAssets(projectId: string, instanceId: string, linkId: string, query?: ListManagedStreamStorageAssetsQuery) {
    return callManaged(this.client, 'listManagedStreamStorageAssets', { projectId, instanceId, linkId }, { query });
  }

  // ---- Custom domains --------------------------------------------------------

  /** Custom playback and ingest domains (stream:read). */
  public listDomains(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamDomains', { projectId, instanceId });
  }

  /** Adds a custom domain and returns the CNAME target (stream:admin). */
  public createDomain(projectId: string, instanceId: string, body: CreateManagedStreamDomainBody) {
    return callManaged(this.client, 'createManagedStreamDomain', { projectId, instanceId }, { body });
  }

  /** Checks the domain's DNS and issues its certificate (stream:admin). */
  public verifyDomain(projectId: string, instanceId: string, domainId: string) {
    return callManaged(this.client, 'verifyManagedStreamDomain', { projectId, instanceId, domainId });
  }

  /** Removes a custom domain (stream:admin). */
  public deleteDomain(projectId: string, instanceId: string, domainId: string) {
    return callManaged(this.client, 'deleteManagedStreamDomain', { projectId, instanceId, domainId });
  }

  // ---- Bindings --------------------------------------------------------------

  /** Containers bound to this server (stream:read). */
  public listBindings(projectId: string, instanceId: string) {
    return callManaged(this.client, 'listManagedStreamBindings', { projectId, instanceId });
  }

  /** Writes HUBFLY_STREAM_URL and the playback key variables into a container (stream:admin). */
  public createBinding(projectId: string, instanceId: string, body: CreateManagedStreamBindingBody) {
    return callManaged(this.client, 'createManagedStreamBinding', { projectId, instanceId }, { body });
  }

  /** Removes a binding (`removeVariables` also removes the variables) (stream:admin). */
  public deleteBinding(projectId: string, instanceId: string, bindingId: string, query?: DeleteManagedStreamBindingQuery) {
    return callManaged(this.client, 'deleteManagedStreamBinding', { projectId, instanceId, bindingId }, { query });
  }
}

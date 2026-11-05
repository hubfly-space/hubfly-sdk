package hubfly

import "context"

// ManagedStreamsService manages HubFly Managed Streams servers through the
// Dashboard API: client.Managed.Streams.
//
// Create, resize, stop, start and delete stream servers with the shared
// client.Managed.Instances methods (Service "stream" with Stream.SpeedMbps).
//
// Permission levels: stream:read (everything except secrets), stream:operate
// (live control, clips, test playback tokens, studio operate scope) and
// stream:admin (every create, update and delete, key reveal and rotation,
// domains, storage links, bindings). A database or realtime instance answers
// these routes with 409 MANAGED_FEATURE_UNSUPPORTED.
//
// Secrets are write-only: inputs return only keyHints, destinations only
// streamKeyHint. Methods documented "Returns a secret" return one once; keep
// their responses on your server and out of logs. Updates take the revision
// you read; a stale one is 409 STREAM_REVISION_CONFLICT.
type ManagedStreamsService struct{ client *Client }

// ---- Server ----

// GetServer: the server summary with its offline slate, allowed origins and studio origins (stream:read).
func (s *ManagedStreamsService) GetServer(ctx context.Context, projectID, instanceID string) (*Response[GetManagedStreamServerResponse], error) {
	return getManagedStreamServer(ctx, s.client, projectID, instanceID)
}

// UpdateSettings: updates the timezone, offline slate, allowed origins or WebRTC session cap (stream:admin).
func (s *ManagedStreamsService) UpdateSettings(ctx context.Context, projectID, instanceID string, body UpdateManagedStreamSettingsBody) (*Response[UpdateManagedStreamSettingsResponse], error) {
	return updateManagedStreamSettings(ctx, s.client, projectID, instanceID, body)
}

// GetLive: the node's live status (inputs, channels, viewers, destinations), cached for up to 2 s (stream:read).
func (s *ManagedStreamsService) GetLive(ctx context.Context, projectID, instanceID string) (*Response[GetManagedStreamLiveResponse], error) {
	return getManagedStreamLive(ctx, s.client, projectID, instanceID)
}

// GetStats: viewer statistics for a time range, optionally for one channel (stream:read).
func (s *ManagedStreamsService) GetStats(ctx context.Context, projectID, instanceID string, query *GetManagedStreamStatsQuery) (*Response[GetManagedStreamStatsResponse], error) {
	return getManagedStreamStats(ctx, s.client, projectID, instanceID, query)
}

// GetUsage: usage and cost of a month (month is YYYY-MM; default the current month), with the free allowance and an estimate (stream:read).
func (s *ManagedStreamsService) GetUsage(ctx context.Context, projectID, instanceID string, query *GetManagedStreamUsageQuery) (*Response[GetManagedStreamUsageResponse], error) {
	return getManagedStreamUsage(ctx, s.client, projectID, instanceID, query)
}

// ListEvents: server events after a cursor (nextCursor pages forward) (stream:read).
func (s *ManagedStreamsService) ListEvents(ctx context.Context, projectID, instanceID string, query *ListManagedStreamEventsQuery) (*Response[ListManagedStreamEventsResponse], error) {
	return listManagedStreamEvents(ctx, s.client, projectID, instanceID, query)
}

// Control: runs live control ops (go live, scene switch, destination and recording start/stop, slate) and returns one result per op (stream:operate).
func (s *ManagedStreamsService) Control(ctx context.Context, projectID, instanceID string, body PostManagedStreamControlBody) (*Response[PostManagedStreamControlResponse], error) {
	return postManagedStreamControl(ctx, s.client, projectID, instanceID, body)
}

// CreateStudioToken: Returns a secret: a short-lived studio token and the studio socket url. Send the token as the first frame {"type":"auth","token":…}, never in the URL. Operators also get the operate scope (stream:read).
func (s *ManagedStreamsService) CreateStudioToken(ctx context.Context, projectID, instanceID string, body CreateManagedStreamStudioTokenBody) (*Response[CreateManagedStreamStudioTokenResponse], error) {
	return createManagedStreamStudioToken(ctx, s.client, projectID, instanceID, body)
}

// EstimatePrice: the hourly and monthly speed price for speedMbps (and processingMbps); quotedHourlyTotal on create and resize is hourly.speedMicroUsd / 1e6 (a signed-in session).
func (s *ManagedStreamsService) EstimatePrice(ctx context.Context, query GetStreamPriceEstimateQuery) (*Response[GetStreamPriceEstimateResponse], error) {
	return getStreamPriceEstimate(ctx, s.client, query)
}

// ---- Inputs ----

// ListInputs: the server's inputs. Keys are never returned, only keyHints (stream:read).
func (s *ManagedStreamsService) ListInputs(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamInputsResponse], error) {
	return listManagedStreamInputs(ctx, s.client, projectID, instanceID)
}

// GetInput: one input with connection: the per-protocol URLs, keys masked (stream:read).
func (s *ManagedStreamsService) GetInput(ctx context.Context, projectID, instanceID, inputID string) (*Response[GetManagedStreamInputResponse], error) {
	return getManagedStreamInput(ctx, s.client, projectID, instanceID, inputID)
}

// CreateInput: Returns secrets: creates an input; keys.primary (and keys.backup) are returned once. Pull inputs return keys: null (stream:admin).
func (s *ManagedStreamsService) CreateInput(ctx context.Context, projectID, instanceID string, body CreateManagedStreamInputBody) (*Response[CreateManagedStreamInputResponse], error) {
	return createManagedStreamInput(ctx, s.client, projectID, instanceID, body)
}

// UpdateInput: updates an input; send the revision you read (a stale one is 409 STREAM_REVISION_CONFLICT) (stream:admin).
func (s *ManagedStreamsService) UpdateInput(ctx context.Context, projectID, instanceID, inputID string, body UpdateManagedStreamInputBody) (*Response[UpdateManagedStreamInputResponse], error) {
	return updateManagedStreamInput(ctx, s.client, projectID, instanceID, inputID, body)
}

// DeleteInput: deletes an input; refused with 409 STREAM_IN_USE while a channel, mixer or destination uses it (stream:admin).
func (s *ManagedStreamsService) DeleteInput(ctx context.Context, projectID, instanceID, inputID string) (*Response[DeleteManagedStreamInputResponse], error) {
	return deleteManagedStreamInput(ctx, s.client, projectID, instanceID, inputID)
}

// RevealInputKeys: Returns secrets: the input's stream keys (and SRT passphrase, or pull URL). Never log the response (stream:admin).
func (s *ManagedStreamsService) RevealInputKeys(ctx context.Context, projectID, instanceID, inputID string) (*Response[RevealManagedStreamInputKeysResponse], error) {
	return revealManagedStreamInputKeys(ctx, s.client, projectID, instanceID, inputID)
}

// RotateInputKey: Returns a secret: replaces the primary or backup key (or removes the backup with remove: true); the publisher on the old key is disconnected (stream:admin).
func (s *ManagedStreamsService) RotateInputKey(ctx context.Context, projectID, instanceID, inputID string, body RotateManagedStreamInputKeyBody) (*Response[RotateManagedStreamInputKeyResponse], error) {
	return rotateManagedStreamInputKey(ctx, s.client, projectID, instanceID, inputID, body)
}

// ---- Channels ----

// ListChannels: the server's channels (stream:read).
func (s *ManagedStreamsService) ListChannels(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamChannelsResponse], error) {
	return listManagedStreamChannels(ctx, s.client, projectID, instanceID)
}

// GetChannel: one channel with its billed processingMbps and playback URLs (stream:read).
func (s *ManagedStreamsService) GetChannel(ctx context.Context, projectID, instanceID, channelID string) (*Response[GetManagedStreamChannelResponse], error) {
	return getManagedStreamChannel(ctx, s.client, projectID, instanceID, channelID)
}

// CreateChannel: creates a channel (source, ladder, latency, playback outputs, access, DVR, recording) (stream:admin).
func (s *ManagedStreamsService) CreateChannel(ctx context.Context, projectID, instanceID string, body CreateManagedStreamChannelBody) (*Response[CreateManagedStreamChannelResponse], error) {
	return createManagedStreamChannel(ctx, s.client, projectID, instanceID, body)
}

// UpdateChannel: updates a channel; send the revision you read (stream:admin).
func (s *ManagedStreamsService) UpdateChannel(ctx context.Context, projectID, instanceID, channelID string, body UpdateManagedStreamChannelBody) (*Response[UpdateManagedStreamChannelResponse], error) {
	return updateManagedStreamChannel(ctx, s.client, projectID, instanceID, channelID, body)
}

// DeleteChannel: deletes a channel (stream:admin).
func (s *ManagedStreamsService) DeleteChannel(ctx context.Context, projectID, instanceID, channelID string) (*Response[DeleteManagedStreamChannelResponse], error) {
	return deleteManagedStreamChannel(ctx, s.client, projectID, instanceID, channelID)
}

// GetChannelPlayback: playback URLs (HLS, WHEP, embed, thumbnail, status, audio, pulls), the embed HTML and whether a token is required (stream:read).
func (s *ManagedStreamsService) GetChannelPlayback(ctx context.Context, projectID, instanceID, channelID string) (*Response[GetManagedStreamChannelPlaybackResponse], error) {
	return getManagedStreamChannelPlayback(ctx, s.client, projectID, instanceID, channelID)
}

// CreatePlaybackToken: Returns a secret: a test playback token (at most 24 h) signed with the newest active playback key. Mint production tokens on your own server with streams.SignPlaybackToken (github.com/hubfly/hubfly-sdk/go/streams) (stream:operate).
func (s *ManagedStreamsService) CreatePlaybackToken(ctx context.Context, projectID, instanceID, channelID string, body CreateManagedStreamPlaybackTokenBody) (*Response[CreateManagedStreamPlaybackTokenResponse], error) {
	return createManagedStreamPlaybackToken(ctx, s.client, projectID, instanceID, channelID, body)
}

// ---- Mixers ----

// ListMixers: the server's mixers (stream:read).
func (s *ManagedStreamsService) ListMixers(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamMixersResponse], error) {
	return listManagedStreamMixers(ctx, s.client, projectID, instanceID)
}

// GetMixer: one mixer with its canvas, sources and scenes (stream:read).
func (s *ManagedStreamsService) GetMixer(ctx context.Context, projectID, instanceID, mixerID string) (*Response[GetManagedStreamMixerResponse], error) {
	return getManagedStreamMixer(ctx, s.client, projectID, instanceID, mixerID)
}

// CreateMixer: creates a mixer (optionally from a preset) (stream:admin).
func (s *ManagedStreamsService) CreateMixer(ctx context.Context, projectID, instanceID string, body CreateManagedStreamMixerBody) (*Response[CreateManagedStreamMixerResponse], error) {
	return createManagedStreamMixer(ctx, s.client, projectID, instanceID, body)
}

// UpdateMixer: updates a mixer; send the revision you read. Switch scenes live with Control instead (stream:admin).
func (s *ManagedStreamsService) UpdateMixer(ctx context.Context, projectID, instanceID, mixerID string, body UpdateManagedStreamMixerBody) (*Response[UpdateManagedStreamMixerResponse], error) {
	return updateManagedStreamMixer(ctx, s.client, projectID, instanceID, mixerID, body)
}

// DeleteMixer: deletes a mixer (stream:admin).
func (s *ManagedStreamsService) DeleteMixer(ctx context.Context, projectID, instanceID, mixerID string) (*Response[DeleteManagedStreamMixerResponse], error) {
	return deleteManagedStreamMixer(ctx, s.client, projectID, instanceID, mixerID)
}

// ---- Destinations ----

// ListDestinations: restream destinations; stream keys are never returned, only streamKeyHint (stream:read).
func (s *ManagedStreamsService) ListDestinations(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamDestinationsResponse], error) {
	return listManagedStreamDestinations(ctx, s.client, projectID, instanceID)
}

// GetDestination: one destination (stream:read).
func (s *ManagedStreamsService) GetDestination(ctx context.Context, projectID, instanceID, destinationID string) (*Response[GetManagedStreamDestinationResponse], error) {
	return getManagedStreamDestination(ctx, s.client, projectID, instanceID, destinationID)
}

// CreateDestination: creates a destination (platform preset or custom URL); streamKey is write-only (stream:admin).
func (s *ManagedStreamsService) CreateDestination(ctx context.Context, projectID, instanceID string, body CreateManagedStreamDestinationBody) (*Response[CreateManagedStreamDestinationResponse], error) {
	return createManagedStreamDestination(ctx, s.client, projectID, instanceID, body)
}

// UpdateDestination: updates a destination; send the revision you read (stream:admin).
func (s *ManagedStreamsService) UpdateDestination(ctx context.Context, projectID, instanceID, destinationID string, body UpdateManagedStreamDestinationBody) (*Response[UpdateManagedStreamDestinationResponse], error) {
	return updateManagedStreamDestination(ctx, s.client, projectID, instanceID, destinationID, body)
}

// DeleteDestination: deletes a destination (stream:admin).
func (s *ManagedStreamsService) DeleteDestination(ctx context.Context, projectID, instanceID, destinationID string) (*Response[DeleteManagedStreamDestinationResponse], error) {
	return deleteManagedStreamDestination(ctx, s.client, projectID, instanceID, destinationID)
}

// ---- Playback keys ----

// ListPlaybackKeys: playback keys (id, name, status, fingerprint); secrets are never listed (stream:read).
func (s *ManagedStreamsService) ListPlaybackKeys(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamPlaybackKeysResponse], error) {
	return listManagedStreamPlaybackKeys(ctx, s.client, projectID, instanceID)
}

// CreatePlaybackKey: Returns a secret: creates a playback key; secret is returned once (stream:admin).
func (s *ManagedStreamsService) CreatePlaybackKey(ctx context.Context, projectID, instanceID string, body CreateManagedStreamPlaybackKeyBody) (*Response[CreateManagedStreamPlaybackKeyResponse], error) {
	return createManagedStreamPlaybackKey(ctx, s.client, projectID, instanceID, body)
}

// RotatePlaybackKey: Returns a secret: creates a new key and marks the old one retiring for 24 h (retired names it) (stream:admin).
func (s *ManagedStreamsService) RotatePlaybackKey(ctx context.Context, projectID, instanceID, keyID string) (*Response[RotateManagedStreamPlaybackKeyResponse], error) {
	return rotateManagedStreamPlaybackKey(ctx, s.client, projectID, instanceID, keyID)
}

// DeletePlaybackKey: revokes a playback key: tokens it signed stop working (stream:admin).
func (s *ManagedStreamsService) DeletePlaybackKey(ctx context.Context, projectID, instanceID, keyID string) (*Response[DeleteManagedStreamPlaybackKeyResponse], error) {
	return deleteManagedStreamPlaybackKey(ctx, s.client, projectID, instanceID, keyID)
}

// ---- Playlists ----

// ListPlaylists: the server's playlists (stream:read).
func (s *ManagedStreamsService) ListPlaylists(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamPlaylistsResponse], error) {
	return listManagedStreamPlaylists(ctx, s.client, projectID, instanceID)
}

// GetPlaylist: one playlist with its items (stream:read).
func (s *ManagedStreamsService) GetPlaylist(ctx context.Context, projectID, instanceID, playlistID string) (*Response[GetManagedStreamPlaylistResponse], error) {
	return getManagedStreamPlaylist(ctx, s.client, projectID, instanceID, playlistID)
}

// CreatePlaylist: creates a playlist; items reference a Storage object or asset, or a URL (stream:admin).
func (s *ManagedStreamsService) CreatePlaylist(ctx context.Context, projectID, instanceID string, body CreateManagedStreamPlaylistBody) (*Response[CreateManagedStreamPlaylistResponse], error) {
	return createManagedStreamPlaylist(ctx, s.client, projectID, instanceID, body)
}

// UpdatePlaylist: updates a playlist; send the revision you read (stream:admin).
func (s *ManagedStreamsService) UpdatePlaylist(ctx context.Context, projectID, instanceID, playlistID string, body UpdateManagedStreamPlaylistBody) (*Response[UpdateManagedStreamPlaylistResponse], error) {
	return updateManagedStreamPlaylist(ctx, s.client, projectID, instanceID, playlistID, body)
}

// DeletePlaylist: deletes a playlist (stream:admin).
func (s *ManagedStreamsService) DeletePlaylist(ctx context.Context, projectID, instanceID, playlistID string) (*Response[DeleteManagedStreamPlaylistResponse], error) {
	return deleteManagedStreamPlaylist(ctx, s.client, projectID, instanceID, playlistID)
}

// ---- Schedules ----

// ListSchedules: the server's schedules (stream:read).
func (s *ManagedStreamsService) ListSchedules(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamSchedulesResponse], error) {
	return listManagedStreamSchedules(ctx, s.client, projectID, instanceID)
}

// GetSchedule: one schedule with its next 10 starts (upcoming, UTC) (stream:read).
func (s *ManagedStreamsService) GetSchedule(ctx context.Context, projectID, instanceID, scheduleID string) (*Response[GetManagedStreamScheduleResponse], error) {
	return getManagedStreamSchedule(ctx, s.client, projectID, instanceID, scheduleID)
}

// CreateSchedule: creates a schedule (start, RRULE, duration, timezone, actions) (stream:admin).
func (s *ManagedStreamsService) CreateSchedule(ctx context.Context, projectID, instanceID string, body CreateManagedStreamScheduleBody) (*Response[CreateManagedStreamScheduleResponse], error) {
	return createManagedStreamSchedule(ctx, s.client, projectID, instanceID, body)
}

// UpdateSchedule: updates a schedule; send the revision you read (stream:admin).
func (s *ManagedStreamsService) UpdateSchedule(ctx context.Context, projectID, instanceID, scheduleID string, body UpdateManagedStreamScheduleBody) (*Response[UpdateManagedStreamScheduleResponse], error) {
	return updateManagedStreamSchedule(ctx, s.client, projectID, instanceID, scheduleID, body)
}

// DeleteSchedule: deletes a schedule (stream:admin).
func (s *ManagedStreamsService) DeleteSchedule(ctx context.Context, projectID, instanceID, scheduleID string) (*Response[DeleteManagedStreamScheduleResponse], error) {
	return deleteManagedStreamSchedule(ctx, s.client, projectID, instanceID, scheduleID)
}

// PreviewSchedule: the next 20 starts of a start + RRULE in a timezone, or the validation errors (stream:read).
func (s *ManagedStreamsService) PreviewSchedule(ctx context.Context, projectID, instanceID string, body PreviewManagedStreamScheduleBody) (*Response[PreviewManagedStreamScheduleResponse], error) {
	return previewManagedStreamSchedule(ctx, s.client, projectID, instanceID, body)
}

// ListScheduleRuns: past runs of a schedule (stream:read).
func (s *ManagedStreamsService) ListScheduleRuns(ctx context.Context, projectID, instanceID, scheduleID string, query *ListManagedStreamScheduleRunsQuery) (*Response[ListManagedStreamScheduleRunsResponse], error) {
	return listManagedStreamScheduleRuns(ctx, s.client, projectID, instanceID, scheduleID, query)
}

// ---- Recordings and clips ----

// ListRecordings: recordings and clips with their Storage links (stream:read).
func (s *ManagedStreamsService) ListRecordings(ctx context.Context, projectID, instanceID string, query *ListManagedStreamRecordingsQuery) (*Response[ListManagedStreamRecordingsResponse], error) {
	return listManagedStreamRecordings(ctx, s.client, projectID, instanceID, query)
}

// CreateClip: cuts a clip from a channel's DVR window (409 STREAM_NOT_LIVE without DVR) (stream:operate).
func (s *ManagedStreamsService) CreateClip(ctx context.Context, projectID, instanceID string, body CreateManagedStreamClipBody) (*Response[CreateManagedStreamClipResponse], error) {
	return createManagedStreamClip(ctx, s.client, projectID, instanceID, body)
}

// DeleteRecording: removes a recording or clip record; deleteObject: true also deletes the Storage object (stream:admin).
func (s *ManagedStreamsService) DeleteRecording(ctx context.Context, projectID, instanceID, recordingID string, query *DeleteManagedStreamRecordingQuery) (*Response[DeleteManagedStreamRecordingResponse], error) {
	return deleteManagedStreamRecording(ctx, s.client, projectID, instanceID, recordingID, query)
}

// ---- Webhooks ----

// ListWebhooks: the server's webhooks; secrets are never listed (stream:read).
func (s *ManagedStreamsService) ListWebhooks(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamWebhooksResponse], error) {
	return listManagedStreamWebhooks(ctx, s.client, projectID, instanceID)
}

// CreateWebhook: Returns a secret: creates a webhook; the whsec_ secret is returned once. Verify deliveries with streams.VerifyWebhook (github.com/hubfly/hubfly-sdk/go/streams) (stream:admin).
func (s *ManagedStreamsService) CreateWebhook(ctx context.Context, projectID, instanceID string, body CreateManagedStreamWebhookBody) (*Response[CreateManagedStreamWebhookResponse], error) {
	return createManagedStreamWebhook(ctx, s.client, projectID, instanceID, body)
}

// UpdateWebhook: updates a webhook's URL, events or enabled state (stream:admin).
func (s *ManagedStreamsService) UpdateWebhook(ctx context.Context, projectID, instanceID, webhookID string, body UpdateManagedStreamWebhookBody) (*Response[UpdateManagedStreamWebhookResponse], error) {
	return updateManagedStreamWebhook(ctx, s.client, projectID, instanceID, webhookID, body)
}

// DeleteWebhook: deletes a webhook (stream:admin).
func (s *ManagedStreamsService) DeleteWebhook(ctx context.Context, projectID, instanceID, webhookID string) (*Response[DeleteManagedStreamWebhookResponse], error) {
	return deleteManagedStreamWebhook(ctx, s.client, projectID, instanceID, webhookID)
}

// ListWebhookDeliveries: delivery attempts of a webhook, newest first (stream:read).
func (s *ManagedStreamsService) ListWebhookDeliveries(ctx context.Context, projectID, instanceID, webhookID string, query *ListManagedStreamWebhookDeliveriesQuery) (*Response[ListManagedStreamWebhookDeliveriesResponse], error) {
	return listManagedStreamWebhookDeliveries(ctx, s.client, projectID, instanceID, webhookID, query)
}

// TestWebhook: sends a signed webhook.test event from the Dashboard and returns the result (stream:admin).
func (s *ManagedStreamsService) TestWebhook(ctx context.Context, projectID, instanceID, webhookID string) (*Response[TestManagedStreamWebhookResponse], error) {
	return testManagedStreamWebhook(ctx, s.client, projectID, instanceID, webhookID)
}

// ---- Graphics ----

// ListGraphics: graphics (slates, overlays, lower thirds) of the server (stream:read).
func (s *ManagedStreamsService) ListGraphics(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamGraphicsResponse], error) {
	return listManagedStreamGraphics(ctx, s.client, projectID, instanceID)
}

// UploadGraphic: uploads a graphic (dataBase64, at most 5 MiB decoded) (stream:admin).
func (s *ManagedStreamsService) UploadGraphic(ctx context.Context, projectID, instanceID string, body UploadManagedStreamGraphicBody) (*Response[UploadManagedStreamGraphicResponse], error) {
	return uploadManagedStreamGraphic(ctx, s.client, projectID, instanceID, body)
}

// UpdateGraphic: renames a graphic or changes its template variables (stream:admin).
func (s *ManagedStreamsService) UpdateGraphic(ctx context.Context, projectID, instanceID, graphicID string, body UpdateManagedStreamGraphicBody) (*Response[UpdateManagedStreamGraphicResponse], error) {
	return updateManagedStreamGraphic(ctx, s.client, projectID, instanceID, graphicID, body)
}

// DeleteGraphic: deletes a graphic (stream:admin).
func (s *ManagedStreamsService) DeleteGraphic(ctx context.Context, projectID, instanceID, graphicID string) (*Response[DeleteManagedStreamGraphicResponse], error) {
	return deleteManagedStreamGraphic(ctx, s.client, projectID, instanceID, graphicID)
}

// ---- Storage links ----

// ListStorageLinks: HubFly Storage buckets linked for recordings and playlists; S3 secrets are never returned (stream:read).
func (s *ManagedStreamsService) ListStorageLinks(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamStorageLinksResponse], error) {
	return listManagedStreamStorageLinks(ctx, s.client, projectID, instanceID)
}

// CreateStorageLink: links a Storage bucket (the caller also needs storage:admin on that project) (stream:admin).
func (s *ManagedStreamsService) CreateStorageLink(ctx context.Context, projectID, instanceID string, body CreateManagedStreamStorageLinkBody) (*Response[CreateManagedStreamStorageLinkResponse], error) {
	return createManagedStreamStorageLink(ctx, s.client, projectID, instanceID, body)
}

// DeleteStorageLink: unlinks a Storage bucket (stream:admin).
func (s *ManagedStreamsService) DeleteStorageLink(ctx context.Context, projectID, instanceID, linkID string) (*Response[DeleteManagedStreamStorageLinkResponse], error) {
	return deleteManagedStreamStorageLink(ctx, s.client, projectID, instanceID, linkID)
}

// ListStorageAssets: media assets in a linked bucket (needs media:read on the Storage project), newest first (stream:read).
func (s *ManagedStreamsService) ListStorageAssets(ctx context.Context, projectID, instanceID, linkID string, query *ListManagedStreamStorageAssetsQuery) (*Response[ListManagedStreamStorageAssetsResponse], error) {
	return listManagedStreamStorageAssets(ctx, s.client, projectID, instanceID, linkID, query)
}

// ---- Custom domains ----

// ListDomains: custom playback and ingest domains (stream:read).
func (s *ManagedStreamsService) ListDomains(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamDomainsResponse], error) {
	return listManagedStreamDomains(ctx, s.client, projectID, instanceID)
}

// CreateDomain: adds a custom domain and returns the CNAME target (stream:admin).
func (s *ManagedStreamsService) CreateDomain(ctx context.Context, projectID, instanceID string, body CreateManagedStreamDomainBody) (*Response[CreateManagedStreamDomainResponse], error) {
	return createManagedStreamDomain(ctx, s.client, projectID, instanceID, body)
}

// VerifyDomain: checks the domain's DNS and issues its certificate (stream:admin).
func (s *ManagedStreamsService) VerifyDomain(ctx context.Context, projectID, instanceID, domainID string) (*Response[VerifyManagedStreamDomainResponse], error) {
	return verifyManagedStreamDomain(ctx, s.client, projectID, instanceID, domainID)
}

// DeleteDomain: removes a custom domain (stream:admin).
func (s *ManagedStreamsService) DeleteDomain(ctx context.Context, projectID, instanceID, domainID string) (*Response[DeleteManagedStreamDomainResponse], error) {
	return deleteManagedStreamDomain(ctx, s.client, projectID, instanceID, domainID)
}

// ---- Bindings ----

// ListBindings: containers bound to this server (stream:read).
func (s *ManagedStreamsService) ListBindings(ctx context.Context, projectID, instanceID string) (*Response[ListManagedStreamBindingsResponse], error) {
	return listManagedStreamBindings(ctx, s.client, projectID, instanceID)
}

// CreateBinding: writes HUBFLY_STREAM_URL and the playback key variables into a container (stream:admin).
func (s *ManagedStreamsService) CreateBinding(ctx context.Context, projectID, instanceID string, body CreateManagedStreamBindingBody) (*Response[CreateManagedStreamBindingResponse], error) {
	return createManagedStreamBinding(ctx, s.client, projectID, instanceID, body)
}

// DeleteBinding: removes a binding (removeVariables also removes the variables) (stream:admin).
func (s *ManagedStreamsService) DeleteBinding(ctx context.Context, projectID, instanceID, bindingID string, query *DeleteManagedStreamBindingQuery) (*Response[DeleteManagedStreamBindingResponse], error) {
	return deleteManagedStreamBinding(ctx, s.client, projectID, instanceID, bindingID, query)
}

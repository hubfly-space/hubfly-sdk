package hubfly

import (
	"context"
	"strings"
)

// RealtimeE2EEvent is the event name of the HubFly v1 end-to-end envelope (E2E.md).
const RealtimeE2EEvent = "hubfly.e2e"

// ToSocketID returns the socket id of a connection id. End-to-end connection
// ids are <socket_id>~<base64url(key)>; the key part must never reach HubFly,
// so every realtime method drops it with this function before the request is
// built. Plain socket ids are returned unchanged.
func ToSocketID(connectionID string) string {
	if i := strings.IndexByte(connectionID, '~'); i >= 0 {
		return connectionID[:i]
	}
	return connectionID
}

// IsE2EConnectionID reports whether id is an end-to-end connection id (<socket_id>~<key>).
func IsE2EConnectionID(id string) bool {
	return strings.Contains(id, "~")
}

// e2eConnectionIDError is returned before plaintext would be sent to an
// end-to-end connection id. It never contains the id (the id holds a key).
func e2eConnectionIDError() *APIError {
	return &APIError{
		StatusCode: 400,
		Code:       ErrCodeManagedRealtimeE2EConnectionID,
		Message: "End-to-end connection ids carry a client key after '~' that HubFly never uses, so HubFly cannot send plaintext to them. " +
			"Send end-to-end encrypted direct messages from your own server (github.com/hubfly/hubfly-sdk/go/realtime), or use the socket id alone to send plaintext.",
	}
}

// ManagedRealtimeService manages HubFly Realtime servers through the
// Dashboard API: client.Managed.Realtime.
//
// Permission levels: realtime:read (metadata), realtime:publish (events,
// history, live connections, channel inspect and the inspector) and realtime:admin (apps, keys, webhooks, bindings, terminate,
// purge). A database instance answers these routes with 409
// MANAGED_FEATURE_UNSUPPORTED; features the running engine version lacks
// answer 409 MANAGED_REALTIME_ENGINE_UNSUPPORTED.
//
// End-to-end connection ids (<socket_id>~<key>) are accepted wherever a socket
// id is: the key part is removed on this machine before any request (HubFly
// must never see it), and a plaintext Send to such an id is refused locally
// with MANAGED_REALTIME_E2E_CONNECTION_ID.
type ManagedRealtimeService struct{ client *Client }

// ---- Apps ----

// ListApps lists the server's apps with their keys (public parts only) (realtime:read).
func (s *ManagedRealtimeService) ListApps(ctx context.Context, projectID, instanceID string) (*Response[GetManagedRealtimeAppsResponse], error) {
	return getManagedRealtimeApps(ctx, s.client, projectID, instanceID)
}

// GetApp returns one app with its settings and keys (realtime:read).
func (s *ManagedRealtimeService) GetApp(ctx context.Context, projectID, instanceID, appID string) (*Response[GetManagedRealtimeAppResponse], error) {
	return getManagedRealtimeApp(ctx, s.client, projectID, instanceID, appID)
}

// CreateApp returns a secret: it creates an app and its first key; Secret is
// returned once (realtime:admin).
func (s *ManagedRealtimeService) CreateApp(ctx context.Context, projectID, instanceID string, body CreateManagedRealtimeAppBody) (*Response[CreateManagedRealtimeAppResponse], error) {
	return createManagedRealtimeApp(ctx, s.client, projectID, instanceID, body)
}

// UpdateApp renames, enables or disables an app (realtime:admin).
func (s *ManagedRealtimeService) UpdateApp(ctx context.Context, projectID, instanceID, appID string, body UpdateManagedRealtimeAppBody) (*Response[UpdateManagedRealtimeAppResponse], error) {
	return updateManagedRealtimeApp(ctx, s.client, projectID, instanceID, appID, body)
}

// UpdateAppSettings changes app settings (realtime:admin). Pass the app's
// SettingsRevision as Revision; a stale revision answers 409.
func (s *ManagedRealtimeService) UpdateAppSettings(ctx context.Context, projectID, instanceID, appID string, body UpdateManagedRealtimeAppSettingsBody) (*Response[UpdateManagedRealtimeAppSettingsResponse], error) {
	return updateManagedRealtimeAppSettings(ctx, s.client, projectID, instanceID, appID, body)
}

// DeleteApp deletes an app (realtime:admin). ConfirmName must equal the app name.
func (s *ManagedRealtimeService) DeleteApp(ctx context.Context, projectID, instanceID, appID string, query DeleteManagedRealtimeAppQuery) (*Response[DeleteManagedRealtimeAppResponse], error) {
	return deleteManagedRealtimeApp(ctx, s.client, projectID, instanceID, appID, query)
}

// ---- Keys ----

// ListKeys lists an app's keys: public key, secret hint and fingerprint, never
// the secret (realtime:read).
func (s *ManagedRealtimeService) ListKeys(ctx context.Context, projectID, instanceID, appID string) (*Response[GetManagedRealtimeKeysResponse], error) {
	return getManagedRealtimeKeys(ctx, s.client, projectID, instanceID, appID)
}

// CreateKey returns a secret: it creates a key; Secret is returned once (realtime:admin).
func (s *ManagedRealtimeService) CreateKey(ctx context.Context, projectID, instanceID, appID string) (*Response[CreateManagedRealtimeKeyResponse], error) {
	return createManagedRealtimeKey(ctx, s.client, projectID, instanceID, appID)
}

// RotateKey returns a secret: it replaces a key with a new one. The old key
// keeps working for GraceSeconds (status "retiring") (realtime:admin).
func (s *ManagedRealtimeService) RotateKey(ctx context.Context, projectID, instanceID, appID, keyID string, body PostManagedRealtimeKeyRotateBody) (*Response[PostManagedRealtimeKeyRotateResponse], error) {
	return postManagedRealtimeKeyRotate(ctx, s.client, projectID, instanceID, appID, keyID, body)
}

// RevokeKey revokes a key at once; revoked keys are kept, never reused (realtime:admin).
func (s *ManagedRealtimeService) RevokeKey(ctx context.Context, projectID, instanceID, appID, keyID string) (*Response[PostManagedRealtimeKeyRevokeResponse], error) {
	return postManagedRealtimeKeyRevoke(ctx, s.client, projectID, instanceID, appID, keyID)
}

// RevealKey returns a secret: the key's secret (realtime:admin; refused for revoked keys).
func (s *ManagedRealtimeService) RevealKey(ctx context.Context, projectID, instanceID, appID, keyID string) (*Response[PostManagedRealtimeKeyRevealResponse], error) {
	return postManagedRealtimeKeyReveal(ctx, s.client, projectID, instanceID, appID, keyID)
}

// ---- Webhooks ----

// ListWebhooks lists an app's webhooks (realtime:read). URLs are returned in
// full to realtime:admin; other callers see the query string as ?[hidden].
// Treat tokens in URLs as secrets.
func (s *ManagedRealtimeService) ListWebhooks(ctx context.Context, projectID, instanceID, appID string) (*Response[GetManagedRealtimeWebhooksResponse], error) {
	return getManagedRealtimeWebhooks(ctx, s.client, projectID, instanceID, appID)
}

// CreateWebhook adds a webhook: https on port 443 or 8443, public addresses
// only (realtime:admin).
func (s *ManagedRealtimeService) CreateWebhook(ctx context.Context, projectID, instanceID, appID string, body CreateManagedRealtimeWebhookBody) (*Response[CreateManagedRealtimeWebhookResponse], error) {
	return createManagedRealtimeWebhook(ctx, s.client, projectID, instanceID, appID, body)
}

// UpdateWebhook changes a webhook (realtime:admin).
func (s *ManagedRealtimeService) UpdateWebhook(ctx context.Context, projectID, instanceID, appID, webhookID string, body UpdateManagedRealtimeWebhookBody) (*Response[UpdateManagedRealtimeWebhookResponse], error) {
	return updateManagedRealtimeWebhook(ctx, s.client, projectID, instanceID, appID, webhookID, body)
}

// DeleteWebhook deletes a webhook (realtime:admin).
func (s *ManagedRealtimeService) DeleteWebhook(ctx context.Context, projectID, instanceID, appID, webhookID string) (*Response[DeleteManagedRealtimeWebhookResponse], error) {
	return deleteManagedRealtimeWebhook(ctx, s.client, projectID, instanceID, appID, webhookID)
}

// TestWebhook sends a signed test delivery and reports the receiver's answer (realtime:admin).
func (s *ManagedRealtimeService) TestWebhook(ctx context.Context, projectID, instanceID, appID, webhookID string) (*Response[PostManagedRealtimeWebhookTestResponse], error) {
	return postManagedRealtimeWebhookTest(ctx, s.client, projectID, instanceID, appID, webhookID)
}

// GetWebhookDeliveries returns recent deliveries, newest first; page with
// NextCursor (realtime:read).
func (s *ManagedRealtimeService) GetWebhookDeliveries(ctx context.Context, projectID, instanceID, appID string, query *GetManagedRealtimeWebhookDeliveriesQuery) (*Response[GetManagedRealtimeWebhookDeliveriesResponse], error) {
	return getManagedRealtimeWebhookDeliveries(ctx, s.client, projectID, instanceID, appID, query)
}

// ListAllWebhookDeliveries follows NextCursor and returns every delivery (realtime:read).
func (s *ManagedRealtimeService) ListAllWebhookDeliveries(ctx context.Context, projectID, instanceID, appID string, query *GetManagedRealtimeWebhookDeliveriesQuery) ([]ManagedRealtimeWebhookDelivery, error) {
	page := GetManagedRealtimeWebhookDeliveriesQuery{}
	if query != nil {
		page = *query
	}
	var all []ManagedRealtimeWebhookDelivery
	for {
		resp, err := s.GetWebhookDeliveries(ctx, projectID, instanceID, appID, &page)
		if err != nil {
			return all, err
		}
		all = append(all, resp.Data.Items...)
		if resp.Data.NextCursor == nil || *resp.Data.NextCursor == "" {
			return all, nil
		}
		page.Cursor = *resp.Data.NextCursor
	}
}

// RedeliverWebhook delivers a failed or dead delivery again (realtime:admin).
func (s *ManagedRealtimeService) RedeliverWebhook(ctx context.Context, projectID, instanceID, appID, deliveryID string) (*Response[PostManagedRealtimeWebhookRedeliverResponse], error) {
	return postManagedRealtimeWebhookRedeliver(ctx, s.client, projectID, instanceID, appID, deliveryID)
}

// ---- Events ----

// Publish publishes an event to channels, with the app's limits, E2E policy,
// history and webhooks applied (realtime:publish). Data is the event's data
// string (usually JSON text). Apps whose encryption policy is "required"
// refuse plaintext with 403 MANAGED_REALTIME_E2E_REQUIRED; payloads over the
// app limit answer 413. An end-to-end ExcludeSocketID loses its key first.
func (s *ManagedRealtimeService) Publish(ctx context.Context, projectID, instanceID, appID string, body PostManagedRealtimePublishBody) (*Response[PostManagedRealtimePublishResponse], error) {
	body.ExcludeSocketID = ToSocketID(body.ExcludeSocketID)
	return postManagedRealtimePublish(ctx, s.client, projectID, instanceID, appID, body)
}

// Send sends an event to 1-100 connections or to every connection of one user
// (realtime:publish). Each target gets a status (delivered, buffered, queued
// or offline) and Counts sums them. End-to-end connection ids lose their key
// here; plaintext to them is refused before any request (send sealed
// hubfly.e2e envelopes from your own server instead).
func (s *ManagedRealtimeService) Send(ctx context.Context, projectID, instanceID, appID string, body PostManagedRealtimeSendBody) (*Response[PostManagedRealtimeSendResponse], error) {
	if body.SocketIDs != nil {
		ids := make([]string, 0, len(body.SocketIDs))
		seen := make(map[string]bool, len(body.SocketIDs))
		for _, id := range body.SocketIDs {
			if IsE2EConnectionID(id) && body.Event != RealtimeE2EEvent {
				return nil, e2eConnectionIDError()
			}
			socketID := ToSocketID(id)
			if !seen[socketID] {
				seen[socketID] = true
				ids = append(ids, socketID)
			}
		}
		body.SocketIDs = ids
	}
	return postManagedRealtimeSend(ctx, s.client, projectID, instanceID, appID, body)
}

// ---- Channels, connections, users ----

// ListChannels returns occupied channels; page with NextCursor (realtime:read).
func (s *ManagedRealtimeService) ListChannels(ctx context.Context, projectID, instanceID, appID string, query *GetManagedRealtimeChannelsQuery) (*Response[GetManagedRealtimeChannelsResponse], error) {
	return getManagedRealtimeChannels(ctx, s.client, projectID, instanceID, appID, query)
}

// ListAllChannels follows NextCursor and returns every occupied channel (realtime:read).
func (s *ManagedRealtimeService) ListAllChannels(ctx context.Context, projectID, instanceID, appID string, query *GetManagedRealtimeChannelsQuery) ([]ManagedRealtimeChannel, error) {
	page := GetManagedRealtimeChannelsQuery{}
	if query != nil {
		page = *query
	}
	var all []ManagedRealtimeChannel
	for {
		resp, err := s.ListChannels(ctx, projectID, instanceID, appID, &page)
		if err != nil {
			return all, err
		}
		all = append(all, resp.Data.Items...)
		if resp.Data.NextCursor == nil || *resp.Data.NextCursor == "" {
			return all, nil
		}
		page.Cursor = *resp.Data.NextCursor
	}
}

// InspectChannel returns one channel: subscribers, presence members (UserInfo
// is JSON text), history and cache state (realtime:publish). Not cached.
func (s *ManagedRealtimeService) InspectChannel(ctx context.Context, projectID, instanceID, appID string, query GetManagedRealtimeChannelQuery) (*Response[GetManagedRealtimeChannelResponse], error) {
	return getManagedRealtimeChannel(ctx, s.client, projectID, instanceID, appID, query)
}

// ListConnections returns live connections, filterable by app, user, channel
// or connection id (realtime:publish). Not cached: holds client IPs and user ids.
// An end-to-end ConnectionID filter loses its key before the request.
func (s *ManagedRealtimeService) ListConnections(ctx context.Context, projectID, instanceID string, query *GetManagedRealtimeConnectionsQuery) (*Response[GetManagedRealtimeConnectionsResponse], error) {
	if query != nil && IsE2EConnectionID(query.ConnectionID) {
		filtered := *query
		filtered.ConnectionID = ToSocketID(query.ConnectionID)
		query = &filtered
	}
	return getManagedRealtimeConnections(ctx, s.client, projectID, instanceID, query)
}

// ListAllConnections follows NextCursor and returns every matching connection (realtime:publish).
func (s *ManagedRealtimeService) ListAllConnections(ctx context.Context, projectID, instanceID string, query *GetManagedRealtimeConnectionsQuery) ([]ManagedRealtimeConnection, error) {
	page := GetManagedRealtimeConnectionsQuery{}
	if query != nil {
		page = *query
	}
	var all []ManagedRealtimeConnection
	for {
		resp, err := s.ListConnections(ctx, projectID, instanceID, &page)
		if err != nil {
			return all, err
		}
		all = append(all, resp.Data.Items...)
		if resp.Data.NextCursor == nil || *resp.Data.NextCursor == "" {
			return all, nil
		}
		page.Cursor = *resp.Data.NextCursor
	}
}

// TerminateConnection closes one connection (realtime:admin): Mode
// "terminate" (4009, no reconnect) or "disconnect" (4200, the client
// reconnects at once). An end-to-end connection id loses its key first.
func (s *ManagedRealtimeService) TerminateConnection(ctx context.Context, projectID, instanceID, appID string, body PostManagedRealtimeConnectionTerminateBody) (*Response[PostManagedRealtimeConnectionTerminateResponse], error) {
	body.SocketID = ToSocketID(body.SocketID)
	return postManagedRealtimeConnectionTerminate(ctx, s.client, projectID, instanceID, appID, body)
}

// TerminateUser closes every connection of a signed-in user (realtime:admin).
func (s *ManagedRealtimeService) TerminateUser(ctx context.Context, projectID, instanceID, appID string, body PostManagedRealtimeUserTerminateBody) (*Response[PostManagedRealtimeUserTerminateResponse], error) {
	return postManagedRealtimeUserTerminate(ctx, s.client, projectID, instanceID, appID, body)
}

// ---- History ----

// GetHistory returns a channel's retained messages: the newest Limit, or those
// after offset Since (realtime:publish). Data is the event's data string (JSON
// text or a sealed envelope). Gap reports that messages after Since were
// already dropped or the epoch changed. Not cached.
func (s *ManagedRealtimeService) GetHistory(ctx context.Context, projectID, instanceID, appID string, query GetManagedRealtimeHistoryQuery) (*Response[GetManagedRealtimeHistoryResponse], error) {
	return getManagedRealtimeHistory(ctx, s.client, projectID, instanceID, appID, query)
}

// PurgeHistory deletes retained messages of one channel, or of the whole app
// without Channel (realtime:admin).
func (s *ManagedRealtimeService) PurgeHistory(ctx context.Context, projectID, instanceID, appID string, body PostManagedRealtimeHistoryPurgeBody) (*Response[PostManagedRealtimeHistoryPurgeResponse], error) {
	return postManagedRealtimeHistoryPurge(ctx, s.client, projectID, instanceID, appID, body)
}

// ---- Observability ----

// GetInsights returns traffic, latency, top channels/events, auth failures and
// webhook health (realtime:read).
func (s *ManagedRealtimeService) GetInsights(ctx context.Context, projectID, instanceID string, query *GetManagedRealtimeInsightsQuery) (*Response[GetManagedRealtimeInsightsResponse], error) {
	return getManagedRealtimeInsights(ctx, s.client, projectID, instanceID, query)
}

// GetUsage returns daily usage: connection minutes, messages and bytes (realtime:read).
func (s *ManagedRealtimeService) GetUsage(ctx context.Context, projectID, instanceID string, query *GetManagedRealtimeUsageQuery) (*Response[GetManagedRealtimeUsageResponse], error) {
	return getManagedRealtimeUsage(ctx, s.client, projectID, instanceID, query)
}

// CreateInspectorToken returns a secret: a short-lived inspector token (EdDSA
// JWT, 90 s by default, at most 120 s) and the inspector socket URL
// (realtime:publish). Send the token as the socket's first frame (never in the
// URL). Payload previews need realtime:publish or admin plus PayloadPreview.
func (s *ManagedRealtimeService) CreateInspectorToken(ctx context.Context, projectID, instanceID string, body CreateManagedRealtimeInspectorTokenBody) (*Response[CreateManagedRealtimeInspectorTokenResponse], error) {
	return createManagedRealtimeInspectorToken(ctx, s.client, projectID, instanceID, body)
}

// GetInspectorRecent is the polling alternative to the inspector socket:
// events after AfterSeq (pass back NextSeq) (realtime:publish). Nested values
// arrive as JSON text; payload previews only with publish or admin plus
// PayloadPreview. Not cached.
func (s *ManagedRealtimeService) GetInspectorRecent(ctx context.Context, projectID, instanceID string, query *GetManagedRealtimeInspectorRecentQuery) (*Response[GetManagedRealtimeInspectorRecentResponse], error) {
	return getManagedRealtimeInspectorRecent(ctx, s.client, projectID, instanceID, query)
}

// ---- Bindings and connection details ----

// ListBindings returns the projects this server is bound to (realtime:admin).
func (s *ManagedRealtimeService) ListBindings(ctx context.Context, projectID, instanceID string) (*Response[GetManagedRealtimeBindingsResponse], error) {
	return getManagedRealtimeBindings(ctx, s.client, projectID, instanceID)
}

// CreateBinding writes an app's connection variables, including the key
// secret, into the target project's environment (realtime:admin +
// project:edit on the target). The secret is not returned.
func (s *ManagedRealtimeService) CreateBinding(ctx context.Context, projectID, instanceID string, body CreateManagedRealtimeBindingBody) (*Response[CreateManagedRealtimeBindingResponse], error) {
	return createManagedRealtimeBinding(ctx, s.client, projectID, instanceID, body)
}

// DeleteBinding removes a binding and, unless RemoveVariables is false, its
// variables (realtime:admin + project:edit on the target).
func (s *ManagedRealtimeService) DeleteBinding(ctx context.Context, projectID, instanceID, bindingID string, query *DeleteManagedRealtimeBindingQuery) (*Response[DeleteManagedRealtimeBindingResponse], error) {
	return deleteManagedRealtimeBinding(ctx, s.client, projectID, instanceID, bindingID, query)
}

// GetConnection returns host, URLs, public app keys, pusher-js options and the
// environment variable names (no secrets) (realtime:read).
func (s *ManagedRealtimeService) GetConnection(ctx context.Context, projectID, instanceID string) (*Response[GetManagedRealtimeConnectionResponse], error) {
	return getManagedRealtimeConnection(ctx, s.client, projectID, instanceID)
}

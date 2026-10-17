package hubfly

// Managed Services (Databases + Realtime) of the Dashboard API.
//
// Every request and response type comes from managed_types.go, which
// scripts/generate-managed.ts generates from the Dashboard's openapi.json.
// Each method names the permission it needs. Shared lifecycle routes are
// level-based: read, operate and admin mean database:read, database:query and
// database:admin on a database, and realtime:read, realtime:publish and
// realtime:admin on a realtime server. Database-only routes answer a realtime
// server with 409 MANAGED_FEATURE_UNSUPPORTED (and realtime routes answer a
// database the same way).

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// Error codes of the Managed Services API worth branching on (APIError.Code);
// see IsAPIErrorCode.
const (
	// ErrCodeManagedFeatureUnsupported (409): the route belongs to the other
	// service (a database route on a realtime server or the reverse).
	ErrCodeManagedFeatureUnsupported = "MANAGED_FEATURE_UNSUPPORTED"
	// ErrCodeManagedInstanceNotRunning (409): the instance must be running.
	ErrCodeManagedInstanceNotRunning = "MANAGED_INSTANCE_NOT_RUNNING"
	// ErrCodeManagedPriceChanged (409): the quoted price no longer matches.
	ErrCodeManagedPriceChanged = "MANAGED_PRICE_CHANGED"
	// ErrCodeManagedConfirmationMismatch (400): the confirmation name does not match.
	ErrCodeManagedConfirmationMismatch = "MANAGED_CONFIRMATION_MISMATCH"
	// ErrCodeManagedRateLimited (429): too many requests.
	ErrCodeManagedRateLimited = "MANAGED_RATE_LIMITED"
	// ErrCodeManagedRealtimeEngineUnsupported (409): the running realtime
	// engine version does not support this feature yet.
	ErrCodeManagedRealtimeEngineUnsupported = "MANAGED_REALTIME_ENGINE_UNSUPPORTED"
	// ErrCodeManagedRealtimeE2ERequired (403): the app requires end-to-end
	// encryption, so HubFly cannot send plaintext.
	ErrCodeManagedRealtimeE2ERequired = "MANAGED_REALTIME_E2E_REQUIRED"
	// ErrCodeManagedRealtimePayloadTooLarge (413): the payload is larger than the app allows.
	ErrCodeManagedRealtimePayloadTooLarge = "MANAGED_REALTIME_PAYLOAD_TOO_LARGE"
	// ErrCodeManagedRealtimeE2EConnectionID (400): plaintext addressed to an
	// end-to-end connection id (<socket_id>~<key>).
	ErrCodeManagedRealtimeE2EConnectionID = "MANAGED_REALTIME_E2E_CONNECTION_ID"
	// ErrCodeManagedRealtimeConnectionNotFound (404): no such connection.
	ErrCodeManagedRealtimeConnectionNotFound = "MANAGED_REALTIME_CONNECTION_NOT_FOUND"
)

// Ptr returns a pointer to v, for optional request fields:
// hubfly.Ptr(true), hubfly.Ptr(50.0).
func Ptr[T any](v T) *T { return &v }

// Float returns a pointer to v, for optional numeric fields: hubfly.Float(50).
func Float(v float64) *float64 { return &v }

// managedPath fills a Managed API path template, escaping each parameter.
func managedPath(format string, params ...string) string {
	args := make([]any, len(params))
	for i, param := range params {
		args[i] = url.PathEscape(param)
	}
	return fmt.Sprintf(format, args...)
}

func formatManagedNumber(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func formatManagedBool(v bool) string {
	return strconv.FormatBool(v)
}

func encodeManagedQuery(v url.Values) string {
	if len(v) == 0 {
		return ""
	}
	return "?" + v.Encode()
}

// ManagedService is the entry point of Managed Services (client.Managed).
type ManagedService struct {
	client *Client

	// Instances manages the lifecycle of databases and realtime servers.
	Instances *ManagedInstancesService
	// Databases holds the database-only endpoints.
	Databases *ManagedDatabasesService
	// Realtime holds the realtime-server endpoints.
	Realtime *ManagedRealtimeService
}

func newManagedService(c *Client) *ManagedService {
	return &ManagedService{
		client:    c,
		Instances: &ManagedInstancesService{client: c},
		Databases: &ManagedDatabasesService{client: c},
		Realtime:  &ManagedRealtimeService{client: c},
	}
}

// Catalog returns engines, versions, sizes and the realtime catalog (any signed-in user).
func (s *ManagedService) Catalog(ctx context.Context) (*Response[GetManagedCatalogResponse], error) {
	return getManagedCatalog(ctx, s.client)
}

// ClientIP returns the caller's public IP as the API sees it, for allowlists (any signed-in user).
func (s *ManagedService) ClientIP(ctx context.Context) (*Response[GetManagedClientIpResponse], error) {
	return getManagedClientIp(ctx, s.client)
}

// Pricing returns unit prices (public).
func (s *ManagedService) Pricing(ctx context.Context) (*Response[GetManagedPricingResponse], error) {
	return getManagedPricing(ctx, s.client)
}

// EstimatePrice prices a size (public). Pass Hourly.Total as QuotedHourlyTotal to create or resize.
func (s *ManagedService) EstimatePrice(ctx context.Context, query GetManagedPriceEstimateQuery) (*Response[GetManagedPriceEstimateResponse], error) {
	return getManagedPriceEstimate(ctx, s.client, query)
}

// Workspace returns the project's managed workspace: counts, cost and limits
// (project read level of either service).
func (s *ManagedService) Workspace(ctx context.Context, projectID string) (*Response[GetManagedWorkspaceResponse], error) {
	return getManagedWorkspace(ctx, s.client, projectID)
}

// ListOperations returns recent operations across the project's instances (project read level).
func (s *ManagedService) ListOperations(ctx context.Context, projectID string, query *GetManagedOperationsQuery) (*Response[GetManagedOperationsResponse], error) {
	return getManagedOperations(ctx, s.client, projectID, query)
}

// ManagedInstancesService manages the lifecycle of managed instances
// (databases and realtime servers): client.Managed.Instances.
type ManagedInstancesService struct{ client *Client }

// List returns the project's instances the caller can read (project read level of either service).
func (s *ManagedInstancesService) List(ctx context.Context, projectID string) (*Response[GetManagedInstancesResponse], error) {
	return getManagedInstances(ctx, s.client, projectID)
}

// Get returns an instance's detail (level read). Realtime servers carry a Realtime block.
func (s *ManagedInstancesService) Get(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceResponse], error) {
	return getManagedInstance(ctx, s.client, projectID, instanceID)
}

// Create creates a database or realtime server (database:admin, or
// realtime:admin when Service is "realtime"). Quote the price first with
// Managed.EstimatePrice and pass its hourly total as QuotedHourlyTotal; reuse
// IdempotencyKey when retrying. Wait for OperationID with WaitForOperation. A
// realtime InitialApp returns its public key only; reveal the secret with
// Managed.Realtime.RevealKey.
func (s *ManagedInstancesService) Create(ctx context.Context, projectID string, body CreateManagedInstanceBody) (*Response[CreateManagedInstanceResponse], error) {
	return createManagedInstance(ctx, s.client, projectID, body)
}

// Update renames an instance (level admin).
func (s *ManagedInstancesService) Update(ctx context.Context, projectID, instanceID string, body UpdateManagedInstanceBody) (*Response[UpdateManagedInstanceResponse], error) {
	return updateManagedInstance(ctx, s.client, projectID, instanceID, body)
}

// Delete deletes an instance (level admin). ConfirmName must equal its name;
// deletion protection blocks it.
func (s *ManagedInstancesService) Delete(ctx context.Context, projectID, instanceID string, query DeleteManagedInstanceQuery) (*Response[DeleteManagedInstanceResponse], error) {
	return deleteManagedInstance(ctx, s.client, projectID, instanceID, query)
}

// UpdateDeletionProtection turns deletion protection on or off (level admin).
func (s *ManagedInstancesService) UpdateDeletionProtection(ctx context.Context, projectID, instanceID string, body UpdateManagedInstanceDeletionProtectionBody) (*Response[UpdateManagedInstanceDeletionProtectionResponse], error) {
	return updateManagedInstanceDeletionProtection(ctx, s.client, projectID, instanceID, body)
}

// Start starts a stopped instance (level admin). Returns the operation id.
func (s *ManagedInstancesService) Start(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceStartResponse], error) {
	return postManagedInstanceStart(ctx, s.client, projectID, instanceID)
}

// Stop stops an instance (level admin). Returns the operation id.
func (s *ManagedInstancesService) Stop(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceStopResponse], error) {
	return postManagedInstanceStop(ctx, s.client, projectID, instanceID)
}

// Restart restarts an instance (level admin); realtime clients reconnect and
// resume. Returns the operation id.
func (s *ManagedInstancesService) Restart(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceRestartResponse], error) {
	return postManagedInstanceRestart(ctx, s.client, projectID, instanceID)
}

// Resize changes CPU, memory or storage (level admin). Pass the newly quoted QuotedHourlyTotal.
func (s *ManagedInstancesService) Resize(ctx context.Context, projectID, instanceID string, body PostManagedInstanceResizeBody) (*Response[PostManagedInstanceResizeResponse], error) {
	return postManagedInstanceResize(ctx, s.client, projectID, instanceID, body)
}

// Upgrade upgrades to the latest engine version of the line (level admin). Returns the operation id.
func (s *ManagedInstancesService) Upgrade(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceUpgradeResponse], error) {
	return postManagedInstanceUpgrade(ctx, s.client, projectID, instanceID)
}

// ListOperations returns an instance's recent operations (level read).
func (s *ManagedInstancesService) ListOperations(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceOperationsQuery) (*Response[GetManagedInstanceOperationsResponse], error) {
	return getManagedInstanceOperations(ctx, s.client, projectID, instanceID, query)
}

// GetOperation returns one operation with its steps (level read).
func (s *ManagedInstancesService) GetOperation(ctx context.Context, projectID, instanceID, operationID string) (*Response[GetManagedInstanceOperationResponse], error) {
	return getManagedInstanceOperation(ctx, s.client, projectID, instanceID, operationID)
}

// WaitForOperationOptions configures WaitForOperation.
type WaitForOperationOptions struct {
	// Interval between polls (default 2 s).
	Interval time.Duration
	// Timeout gives up after this long (default 15 minutes).
	Timeout time.Duration
	// OnProgress is called after every poll.
	OnProgress func(ManagedOperation)
}

// WaitForOperation polls an operation until it succeeds, fails or is canceled
// and returns its final state (level read). A failed operation is not an
// error: check Status and Error.
func (s *ManagedInstancesService) WaitForOperation(ctx context.Context, projectID, instanceID, operationID string, opts *WaitForOperationOptions) (*ManagedOperation, error) {
	interval, timeout := 2*time.Second, 15*time.Minute
	var onProgress func(ManagedOperation)
	if opts != nil {
		if opts.Interval > 0 {
			interval = opts.Interval
		}
		if opts.Timeout > 0 {
			timeout = opts.Timeout
		}
		onProgress = opts.OnProgress
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		resp, err := s.GetOperation(ctx, projectID, instanceID, operationID)
		if err != nil {
			return nil, err
		}
		op := resp.Data
		if onProgress != nil {
			onProgress(op)
		}
		switch op.Status {
		case "succeeded", "failed", "canceled":
			return &op, nil
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, fmt.Errorf("operation %s did not finish (last status %q): %w", operationID, op.Status, ctx.Err())
		case <-timer.C:
		}
	}
}

// Metrics returns current and historical metrics (level read); realtime
// servers add a Realtime block.
func (s *ManagedInstancesService) Metrics(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceMetricsQuery) (*Response[GetManagedInstanceMetricsResponse], error) {
	return getManagedInstanceMetrics(ctx, s.client, projectID, instanceID, query)
}

// Logs returns container logs (database:query on a database, realtime:read on
// a realtime server). Not cached.
func (s *ManagedInstancesService) Logs(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceLogsQuery) (*Response[GetManagedInstanceLogsResponse], error) {
	return getManagedInstanceLogs(ctx, s.client, projectID, instanceID, query)
}

// Audit returns the instance's audit log (level admin).
func (s *ManagedInstancesService) Audit(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceAuditQuery) (*Response[GetManagedInstanceAuditResponse], error) {
	return getManagedInstanceAudit(ctx, s.client, projectID, instanceID, query)
}

// GetNetwork returns endpoint, public access and allowlist (level read).
func (s *ManagedInstancesService) GetNetwork(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceNetworkResponse], error) {
	return getManagedInstanceNetwork(ctx, s.client, projectID, instanceID)
}

// UpdateAllowlist replaces the IP allowlist (level admin). Pass the Revision
// from GetNetwork; on a realtime server the allowlist covers the server API
// only (WebSocket clients are never filtered).
func (s *ManagedInstancesService) UpdateAllowlist(ctx context.Context, projectID, instanceID string, body UpdateManagedInstanceAllowlistBody) (*Response[UpdateManagedInstanceAllowlistResponse], error) {
	return updateManagedInstanceAllowlist(ctx, s.client, projectID, instanceID, body)
}

// UpdatePublicAccess turns public access on or off (level admin; databases
// only: realtime servers are always public).
func (s *ManagedInstancesService) UpdatePublicAccess(ctx context.Context, projectID, instanceID string, body UpdateManagedInstancePublicAccessBody) (*Response[UpdateManagedInstancePublicAccessResponse], error) {
	return updateManagedInstancePublicAccess(ctx, s.client, projectID, instanceID, body)
}

// GetAlerts returns alert settings and firing alerts (level read).
func (s *ManagedInstancesService) GetAlerts(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceAlertsResponse], error) {
	return getManagedInstanceAlerts(ctx, s.client, projectID, instanceID)
}

// UpdateAlerts updates alert settings (level admin). WebhookFailures applies to realtime servers only.
func (s *ManagedInstancesService) UpdateAlerts(ctx context.Context, projectID, instanceID string, body UpdateManagedInstanceAlertsBody) (*Response[UpdateManagedInstanceAlertsResponse], error) {
	return updateManagedInstanceAlerts(ctx, s.client, projectID, instanceID, body)
}

// ManagedDatabasesService holds the database-only endpoints (PostgreSQL,
// MySQL, libSQL): client.Managed.Databases. A realtime server answers them
// with 409 MANAGED_FEATURE_UNSUPPORTED.
type ManagedDatabasesService struct{ client *Client }

// GetConnection returns host, port, database and username; no password (database:read).
func (s *ManagedDatabasesService) GetConnection(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceConnectionResponse], error) {
	return getManagedInstanceConnection(ctx, s.client, projectID, instanceID)
}

// GetCertificate returns the CA certificate (PEM) for TLS verification (database:read).
func (s *ManagedDatabasesService) GetCertificate(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceCertificateResponse], error) {
	return getManagedInstanceCertificate(ctx, s.client, projectID, instanceID)
}

// GetBackups returns the backup status (database:read).
func (s *ManagedDatabasesService) GetBackups(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceBackupsResponse], error) {
	return getManagedInstanceBackups(ctx, s.client, projectID, instanceID)
}

// RevealCredentials returns a secret: the admin password (database:admin;
// audited). libSQL answers 409 MANAGED_USE_TOKENS.
func (s *ManagedDatabasesService) RevealCredentials(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceCredentialRevealResponse], error) {
	return postManagedInstanceCredentialReveal(ctx, s.client, projectID, instanceID)
}

// RotateCredentials returns a secret: it rotates the admin password and
// returns the new one (database:admin). On libSQL it rotates the token
// signing key instead (Kind "signing_key", every token revoked, no secret).
func (s *ManagedDatabasesService) RotateCredentials(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceCredentialRotateResponse], error) {
	return postManagedInstanceCredentialRotate(ctx, s.client, projectID, instanceID)
}

// ListBindings returns the projects this database is bound to (database:admin).
func (s *ManagedDatabasesService) ListBindings(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceBindingsResponse], error) {
	return getManagedInstanceBindings(ctx, s.client, projectID, instanceID)
}

// CreateBinding writes the database's connection URL into the target
// project's environment (database:admin + project:edit on the target). The
// URL is not returned.
func (s *ManagedDatabasesService) CreateBinding(ctx context.Context, projectID, instanceID string, body CreateManagedInstanceBindingBody) (*Response[CreateManagedInstanceBindingResponse], error) {
	return createManagedInstanceBinding(ctx, s.client, projectID, instanceID, body)
}

// DeleteBinding removes a binding and, unless RemoveVariable is false, its
// variable (database:admin + project:edit on the target).
func (s *ManagedDatabasesService) DeleteBinding(ctx context.Context, projectID, instanceID, bindingID string, query *DeleteManagedInstanceBindingQuery) (*Response[DeleteManagedInstanceBindingResponse], error) {
	return deleteManagedInstanceBinding(ctx, s.client, projectID, instanceID, bindingID, query)
}

// ListDatabases lists databases (database:read; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) ListDatabases(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceDatabasesResponse], error) {
	return getManagedInstanceDatabases(ctx, s.client, projectID, instanceID)
}

// CreateDatabase creates a database (database:admin; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) CreateDatabase(ctx context.Context, projectID, instanceID string, body CreateManagedInstanceDatabaseBody) (*Response[CreateManagedInstanceDatabaseResponse], error) {
	return createManagedInstanceDatabase(ctx, s.client, projectID, instanceID, body)
}

// DeleteDatabase drops a database (database:admin; PostgreSQL/MySQL).
// ConfirmName must equal the database name.
func (s *ManagedDatabasesService) DeleteDatabase(ctx context.Context, projectID, instanceID, databaseName string, query DeleteManagedInstanceDatabaseQuery) (*Response[DeleteManagedInstanceDatabaseResponse], error) {
	return deleteManagedInstanceDatabase(ctx, s.client, projectID, instanceID, databaseName, query)
}

// ListUsers lists database users (database:read; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) ListUsers(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceUsersResponse], error) {
	return getManagedInstanceUsers(ctx, s.client, projectID, instanceID)
}

// CreateUser returns a secret: it creates a user and returns its password
// once (database:admin; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) CreateUser(ctx context.Context, projectID, instanceID string, body CreateManagedInstanceUserBody) (*Response[CreateManagedInstanceUserResponse], error) {
	return createManagedInstanceUser(ctx, s.client, projectID, instanceID, body)
}

// UpdateUser changes a user's access preset and databases (database:admin; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) UpdateUser(ctx context.Context, projectID, instanceID, userName string, body UpdateManagedInstanceUserBody) (*Response[UpdateManagedInstanceUserResponse], error) {
	return updateManagedInstanceUser(ctx, s.client, projectID, instanceID, userName, body)
}

// DeleteUser drops a user (database:admin; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) DeleteUser(ctx context.Context, projectID, instanceID, userName string, query *DeleteManagedInstanceUserQuery) (*Response[DeleteManagedInstanceUserResponse], error) {
	return deleteManagedInstanceUser(ctx, s.client, projectID, instanceID, userName, query)
}

// RotateUserPassword returns a secret: it rotates a user's password and
// returns the new one (database:admin; not the primary user).
func (s *ManagedDatabasesService) RotateUserPassword(ctx context.Context, projectID, instanceID, userName string) (*Response[PostManagedInstanceUserPasswordRotateResponse], error) {
	return postManagedInstanceUserPasswordRotate(ctx, s.client, projectID, instanceID, userName)
}

// ListExtensions returns available and installed extensions (database:read; PostgreSQL).
func (s *ManagedDatabasesService) ListExtensions(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceExtensionsQuery) (*Response[GetManagedInstanceExtensionsResponse], error) {
	return getManagedInstanceExtensions(ctx, s.client, projectID, instanceID, query)
}

// InstallExtension installs an extension (database:admin; PostgreSQL).
func (s *ManagedDatabasesService) InstallExtension(ctx context.Context, projectID, instanceID string, body PostManagedInstanceExtensionInstallBody) (*Response[PostManagedInstanceExtensionInstallResponse], error) {
	return postManagedInstanceExtensionInstall(ctx, s.client, projectID, instanceID, body)
}

// DeleteExtension drops an extension (database:admin; PostgreSQL).
func (s *ManagedDatabasesService) DeleteExtension(ctx context.Context, projectID, instanceID, extensionName string, query *DeleteManagedInstanceExtensionQuery) (*Response[DeleteManagedInstanceExtensionResponse], error) {
	return deleteManagedInstanceExtension(ctx, s.client, projectID, instanceID, extensionName, query)
}

// ListExports returns exports and imports (database:admin).
func (s *ManagedDatabasesService) ListExports(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceExportsResponse], error) {
	return getManagedInstanceExports(ctx, s.client, projectID, instanceID)
}

// CreateExport starts an export (database:admin).
func (s *ManagedDatabasesService) CreateExport(ctx context.Context, projectID, instanceID string, body CreateManagedInstanceExportBody) (*Response[CreateManagedInstanceExportResponse], error) {
	return createManagedInstanceExport(ctx, s.client, projectID, instanceID, body)
}

// DownloadExport returns a secret: a presigned download URL valid for 10
// minutes (database:admin).
func (s *ManagedDatabasesService) DownloadExport(ctx context.Context, projectID, instanceID, exportID string) (*Response[PostManagedInstanceExportDownloadResponse], error) {
	return postManagedInstanceExportDownload(ctx, s.client, projectID, instanceID, exportID)
}

// UploadImport returns a secret: a presigned upload URL valid for 1 hour
// (database:admin). Upload the file, then call StartImport.
func (s *ManagedDatabasesService) UploadImport(ctx context.Context, projectID, instanceID string, body PostManagedInstanceImportUploadBody) (*Response[PostManagedInstanceImportUploadResponse], error) {
	return postManagedInstanceImportUpload(ctx, s.client, projectID, instanceID, body)
}

// StartImport starts restoring an uploaded import (database:admin).
func (s *ManagedDatabasesService) StartImport(ctx context.Context, projectID, instanceID, importID string) (*Response[PostManagedInstanceImportStartResponse], error) {
	return postManagedInstanceImportStart(ctx, s.client, projectID, instanceID, importID)
}

// GetConfig returns the engine configuration and its generation (database:read).
func (s *ManagedDatabasesService) GetConfig(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceConfigResponse], error) {
	return getManagedInstanceConfig(ctx, s.client, projectID, instanceID)
}

// GetConfigHistory returns configuration revisions (database:read).
func (s *ManagedDatabasesService) GetConfigHistory(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceConfigHistoryQuery) (*Response[GetManagedInstanceConfigHistoryResponse], error) {
	return getManagedInstanceConfigHistory(ctx, s.client, projectID, instanceID, query)
}

// ValidateConfig validates configuration changes without applying them (database:admin).
func (s *ManagedDatabasesService) ValidateConfig(ctx context.Context, projectID, instanceID string, body PostManagedInstanceConfigValidateBody) (*Response[PostManagedInstanceConfigValidateResponse], error) {
	return postManagedInstanceConfigValidate(ctx, s.client, projectID, instanceID, body)
}

// ApplyConfig applies configuration changes; pass the current Generation (database:admin).
func (s *ManagedDatabasesService) ApplyConfig(ctx context.Context, projectID, instanceID string, body PostManagedInstanceConfigApplyBody) (*Response[PostManagedInstanceConfigApplyResponse], error) {
	return postManagedInstanceConfigApply(ctx, s.client, projectID, instanceID, body)
}

// RevertConfig reverts to an earlier configuration revision (database:admin).
func (s *ManagedDatabasesService) RevertConfig(ctx context.Context, projectID, instanceID string, body PostManagedInstanceConfigRevertBody) (*Response[PostManagedInstanceConfigRevertResponse], error) {
	return postManagedInstanceConfigRevert(ctx, s.client, projectID, instanceID, body)
}

// GetInsights returns query statistics (database:query; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) GetInsights(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceInsightsQuery) (*Response[GetManagedInstanceInsightsResponse], error) {
	return getManagedInstanceInsights(ctx, s.client, projectID, instanceID, query)
}

// ResetInsights resets query statistics (database:admin; PostgreSQL/MySQL).
func (s *ManagedDatabasesService) ResetInsights(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceInsightsResetResponse], error) {
	return postManagedInstanceInsightsReset(ctx, s.client, projectID, instanceID)
}

// ListSessions returns active sessions with their SQL text (database:query;
// PostgreSQL/MySQL). Not cached.
func (s *ManagedDatabasesService) ListSessions(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceSessionsResponse], error) {
	return getManagedInstanceSessions(ctx, s.client, projectID, instanceID)
}

// CancelSession cancels a session's running query (database:admin).
func (s *ManagedDatabasesService) CancelSession(ctx context.Context, projectID, instanceID, sessionID string) (*Response[PostManagedInstanceSessionCancelResponse], error) {
	return postManagedInstanceSessionCancel(ctx, s.client, projectID, instanceID, sessionID)
}

// TerminateSession terminates a session (database:admin).
func (s *ManagedDatabasesService) TerminateSession(ctx context.Context, projectID, instanceID, sessionID string) (*Response[PostManagedInstanceSessionTerminateResponse], error) {
	return postManagedInstanceSessionTerminate(ctx, s.client, projectID, instanceID, sessionID)
}

// Query runs SQL (database:query, also with ReadOnly false). Results are
// customer data; not cached.
func (s *ManagedDatabasesService) Query(ctx context.Context, projectID, instanceID string, body PostManagedInstanceQueryBody) (*Response[PostManagedInstanceQueryResponse], error) {
	return postManagedInstanceQuery(ctx, s.client, projectID, instanceID, body)
}

// GetSchema returns schemas, tables and columns (database:read).
func (s *ManagedDatabasesService) GetSchema(ctx context.Context, projectID, instanceID string, query *GetManagedInstanceSchemaQuery) (*Response[GetManagedInstanceSchemaResponse], error) {
	return getManagedInstanceSchema(ctx, s.client, projectID, instanceID, query)
}

// GetTableRows reads table rows (database:query). Customer data; not cached.
func (s *ManagedDatabasesService) GetTableRows(ctx context.Context, projectID, instanceID string, query GetManagedInstanceTableRowsQuery) (*Response[GetManagedInstanceTableRowsResponse], error) {
	return getManagedInstanceTableRows(ctx, s.client, projectID, instanceID, query)
}

// ChangeTableRows inserts, updates or deletes table rows (database:query).
func (s *ManagedDatabasesService) ChangeTableRows(ctx context.Context, projectID, instanceID string, body PostManagedInstanceTableRowsChangeBody) (*Response[PostManagedInstanceTableRowsChangeResponse], error) {
	return postManagedInstanceTableRowsChange(ctx, s.client, projectID, instanceID, body)
}

// ListTokens lists access tokens (database:read; libSQL).
func (s *ManagedDatabasesService) ListTokens(ctx context.Context, projectID, instanceID string) (*Response[GetManagedInstanceTokensResponse], error) {
	return getManagedInstanceTokens(ctx, s.client, projectID, instanceID)
}

// CreateToken returns a secret: an access token (JWT) shown once
// (database:admin; libSQL).
func (s *ManagedDatabasesService) CreateToken(ctx context.Context, projectID, instanceID string, body CreateManagedInstanceTokenBody) (*Response[CreateManagedInstanceTokenResponse], error) {
	return createManagedInstanceToken(ctx, s.client, projectID, instanceID, body)
}

// DeleteToken deletes a token; this rotates the signing key, so every token
// is revoked (database:admin; libSQL).
func (s *ManagedDatabasesService) DeleteToken(ctx context.Context, projectID, instanceID, tokenID string) (*Response[DeleteManagedInstanceTokenResponse], error) {
	return deleteManagedInstanceToken(ctx, s.client, projectID, instanceID, tokenID)
}

// CreateShellSession returns a secret: a short-lived terminal ConnectToken
// and ConnectURL (database:query; PostgreSQL/MySQL; audited).
func (s *ManagedDatabasesService) CreateShellSession(ctx context.Context, projectID, instanceID string) (*Response[PostManagedInstanceShellSessionResponse], error) {
	return postManagedInstanceShellSession(ctx, s.client, projectID, instanceID)
}

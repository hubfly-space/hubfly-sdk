import { HubflyApiError } from '../client.js';
import type { HubflyClient } from '../client.js';
import { callManaged } from './managed-core.js';
import type {
  CreateManagedInstanceBindingBody,
  CreateManagedInstanceBody,
  CreateManagedInstanceDatabaseBody,
  CreateManagedInstanceExportBody,
  CreateManagedInstanceTokenBody,
  CreateManagedInstanceUserBody,
  DeleteManagedInstanceBindingQuery,
  DeleteManagedInstanceDatabaseQuery,
  DeleteManagedInstanceExtensionQuery,
  DeleteManagedInstanceQuery,
  DeleteManagedInstanceUserQuery,
  GetManagedInstanceAuditQuery,
  GetManagedInstanceConfigHistoryQuery,
  GetManagedInstanceExtensionsQuery,
  GetManagedInstanceInsightsQuery,
  GetManagedInstanceLogsQuery,
  GetManagedInstanceMetricsQuery,
  GetManagedInstanceOperationsQuery,
  GetManagedInstanceSchemaQuery,
  GetManagedInstanceTableRowsQuery,
  GetManagedOperationsQuery,
  GetManagedPriceEstimateQuery,
  ManagedOperation,
  PostManagedInstanceConfigApplyBody,
  PostManagedInstanceConfigRevertBody,
  PostManagedInstanceConfigValidateBody,
  PostManagedInstanceExtensionInstallBody,
  PostManagedInstanceImportUploadBody,
  PostManagedInstanceQueryBody,
  PostManagedInstanceResizeBody,
  PostManagedInstanceTableRowsChangeBody,
  UpdateManagedInstanceAlertsBody,
  UpdateManagedInstanceAllowlistBody,
  UpdateManagedInstanceBody,
  UpdateManagedInstanceDeletionProtectionBody,
  UpdateManagedInstancePublicAccessBody,
  UpdateManagedInstanceUserBody,
} from './managed-types.js';
import { ManagedRealtimeSubModule } from './managed-realtime.js';

// Managed Services (Databases + Realtime) of the Dashboard API.
//
// Every request and response type comes from managed-types.ts, which
// scripts/generate-managed.ts generates from the Dashboard's openapi.json.
// Each method names the permission it needs. Shared lifecycle routes are
// level-based: `read`, `operate` and `admin` mean database:read,
// database:query and database:admin on a database, and realtime:read,
// realtime:publish and realtime:admin on a realtime server. Database-only
// routes answer a realtime server with 409 MANAGED_FEATURE_UNSUPPORTED (and
// realtime routes answer a database the same way).

/** Options of {@link ManagedInstancesSubModule.waitForOperation}. */
export interface WaitForOperationOptions {
  /** Poll interval (default 2000 ms). */
  intervalMs?: number;
  /** Give up after this long (default 15 minutes); throws a HubflyApiError with status 408. */
  timeoutMs?: number;
  /** Called after every poll. */
  onProgress?: (operation: ManagedOperation) => void;
  /** Aborts the wait. */
  signal?: AbortSignal;
}

const FINISHED_OPERATION_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Lifecycle of managed instances (databases and realtime servers):
 * `client.managed.instances`.
 */
export class ManagedInstancesSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists the project's instances the caller can read (project `read` level of either service). */
  public list(projectId: string) {
    return callManaged(this.client, 'getManagedInstances', { projectId });
  }

  /** Instance detail (level `read`). Realtime servers carry a `realtime` block. */
  public get(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstance', { projectId, instanceId });
  }

  /**
   * Creates a database or realtime server (database:admin, or realtime:admin
   * when `service` is `"realtime"`). Quote the price first with
   * `client.managed.estimatePrice()` and pass its hourly total as
   * `quotedHourlyTotal`; reuse `idempotencyKey` when retrying. Poll
   * `operationId` with {@link waitForOperation}. A realtime `initialApp`
   * returns its public key only; reveal the secret with
   * `client.managed.realtime.revealKey()`.
   */
  public create(projectId: string, body: CreateManagedInstanceBody) {
    return callManaged(this.client, 'createManagedInstance', { projectId }, { body });
  }

  /** Renames an instance (level `admin`). */
  public update(projectId: string, instanceId: string, body: UpdateManagedInstanceBody) {
    return callManaged(this.client, 'updateManagedInstance', { projectId, instanceId }, { body });
  }

  /** Deletes an instance (level `admin`). `confirmName` must equal its name; deletion protection blocks it. */
  public delete(projectId: string, instanceId: string, query: DeleteManagedInstanceQuery) {
    return callManaged(this.client, 'deleteManagedInstance', { projectId, instanceId }, { query });
  }

  /** Turns deletion protection on or off (level `admin`). */
  public updateDeletionProtection(projectId: string, instanceId: string, body: UpdateManagedInstanceDeletionProtectionBody) {
    return callManaged(this.client, 'updateManagedInstanceDeletionProtection', { projectId, instanceId }, { body });
  }

  /** Starts a stopped instance (level `admin`). Returns the operation id. */
  public start(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceStart', { projectId, instanceId });
  }

  /** Stops an instance (level `admin`). Returns the operation id. */
  public stop(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceStop', { projectId, instanceId });
  }

  /** Restarts an instance (level `admin`). Realtime clients reconnect and resume. Returns the operation id. */
  public restart(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceRestart', { projectId, instanceId });
  }

  /** Changes CPU, memory or storage (level `admin`). Pass the newly quoted `quotedHourlyTotal`. */
  public resize(projectId: string, instanceId: string, body: PostManagedInstanceResizeBody) {
    return callManaged(this.client, 'postManagedInstanceResize', { projectId, instanceId }, { body });
  }

  /** Upgrades to the latest engine version of the line (level `admin`). Returns the operation id. */
  public upgrade(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceUpgrade', { projectId, instanceId });
  }

  /** Recent operations of an instance (level `read`). */
  public listOperations(projectId: string, instanceId: string, query?: GetManagedInstanceOperationsQuery) {
    return callManaged(this.client, 'getManagedInstanceOperations', { projectId, instanceId }, { query });
  }

  /** One operation with its steps (level `read`). */
  public getOperation(projectId: string, instanceId: string, operationId: string) {
    return callManaged(this.client, 'getManagedInstanceOperation', { projectId, instanceId, operationId });
  }

  /**
   * Polls an operation until it succeeds, fails or is canceled, and returns
   * its final state (level `read`). It does not throw when the operation
   * failed: check `status` and `error`.
   */
  public async waitForOperation(
    projectId: string,
    instanceId: string,
    operationId: string,
    options: WaitForOperationOptions = {},
  ): Promise<ManagedOperation> {
    const intervalMs = options.intervalMs ?? 2000;
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
    for (;;) {
      const { data } = await this.getOperation(projectId, instanceId, operationId);
      options.onProgress?.(data);
      if (FINISHED_OPERATION_STATUSES.has(data.status)) return data;
      if (Date.now() + intervalMs > deadline) {
        throw new HubflyApiError(`Operation ${operationId} did not finish in time (last status: ${data.status})`, 408);
      }
      await sleep(intervalMs, options.signal);
    }
  }

  /** Current and historical metrics (level `read`); realtime servers add a `realtime` block. */
  public metrics(projectId: string, instanceId: string, query?: GetManagedInstanceMetricsQuery) {
    return callManaged(this.client, 'getManagedInstanceMetrics', { projectId, instanceId }, { query });
  }

  /** Container logs (database:query on a database, realtime:read on a realtime server). Not cached. */
  public logs(projectId: string, instanceId: string, query?: GetManagedInstanceLogsQuery) {
    return callManaged(this.client, 'getManagedInstanceLogs', { projectId, instanceId }, { query });
  }

  /** Audit log of the instance (level `admin`). */
  public audit(projectId: string, instanceId: string, query?: GetManagedInstanceAuditQuery) {
    return callManaged(this.client, 'getManagedInstanceAudit', { projectId, instanceId }, { query });
  }

  /** Network settings: endpoint, public access, allowlist (level `read`). */
  public getNetwork(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceNetwork', { projectId, instanceId });
  }

  /**
   * Replaces the IP allowlist (level `admin`). Pass the `revision` from
   * {@link getNetwork}; on a realtime server the allowlist covers the server
   * API only (WebSocket clients are never filtered).
   */
  public updateAllowlist(projectId: string, instanceId: string, body: UpdateManagedInstanceAllowlistBody) {
    return callManaged(this.client, 'updateManagedInstanceAllowlist', { projectId, instanceId }, { body });
  }

  /** Turns public access on or off (level `admin`; databases only: realtime servers are always public). */
  public updatePublicAccess(projectId: string, instanceId: string, body: UpdateManagedInstancePublicAccessBody) {
    return callManaged(this.client, 'updateManagedInstancePublicAccess', { projectId, instanceId }, { body });
  }

  /** Alert settings and firing alerts (level `read`). */
  public getAlerts(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceAlerts', { projectId, instanceId });
  }

  /** Updates alert settings (level `admin`). `webhookFailures` applies to realtime servers only. */
  public updateAlerts(projectId: string, instanceId: string, body: UpdateManagedInstanceAlertsBody) {
    return callManaged(this.client, 'updateManagedInstanceAlerts', { projectId, instanceId }, { body });
  }
}

/**
 * Database-only endpoints (PostgreSQL, MySQL, libSQL): `client.managed.databases`.
 * A realtime server answers them with 409 MANAGED_FEATURE_UNSUPPORTED.
 */
export class ManagedDatabasesSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Host, port, database and username; no password (database:read). */
  public getConnection(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceConnection', { projectId, instanceId });
  }

  /** The CA certificate (PEM) for TLS verification (database:read). */
  public getCertificate(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceCertificate', { projectId, instanceId });
  }

  /** Backup status (database:read). */
  public getBackups(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceBackups', { projectId, instanceId });
  }

  /** **Returns a secret:** the admin password (database:admin; audited). libSQL answers 409 MANAGED_USE_TOKENS. */
  public revealCredentials(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceCredentialReveal', { projectId, instanceId });
  }

  /**
   * **Returns a secret:** rotates the admin password and returns the new one
   * (database:admin). On libSQL it rotates the token signing key instead
   * (`kind: "signing_key"`, every token revoked, no secret returned).
   */
  public rotateCredentials(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceCredentialRotate', { projectId, instanceId });
  }

  /** Projects this database is bound to (database:admin). */
  public listBindings(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceBindings', { projectId, instanceId });
  }

  /**
   * Binds the database to a project: writes its connection URL into the
   * target project's environment (database:admin + project:edit on the
   * target). The URL is not returned.
   */
  public createBinding(projectId: string, instanceId: string, body: CreateManagedInstanceBindingBody) {
    return callManaged(this.client, 'createManagedInstanceBinding', { projectId, instanceId }, { body });
  }

  /** Removes a binding and, unless `removeVariable: false`, its variable (database:admin + project:edit on the target). */
  public deleteBinding(projectId: string, instanceId: string, bindingId: string, query?: DeleteManagedInstanceBindingQuery) {
    return callManaged(this.client, 'deleteManagedInstanceBinding', { projectId, instanceId, bindingId }, { query });
  }

  /** Lists databases (database:read; PostgreSQL/MySQL). */
  public listDatabases(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceDatabases', { projectId, instanceId });
  }

  /** Creates a database (database:admin; PostgreSQL/MySQL). */
  public createDatabase(projectId: string, instanceId: string, body: CreateManagedInstanceDatabaseBody) {
    return callManaged(this.client, 'createManagedInstanceDatabase', { projectId, instanceId }, { body });
  }

  /** Drops a database (database:admin; PostgreSQL/MySQL). `confirmName` must equal the database name. */
  public deleteDatabase(projectId: string, instanceId: string, databaseName: string, query: DeleteManagedInstanceDatabaseQuery) {
    return callManaged(this.client, 'deleteManagedInstanceDatabase', { projectId, instanceId, databaseName }, { query });
  }

  /** Lists database users (database:read; PostgreSQL/MySQL). */
  public listUsers(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceUsers', { projectId, instanceId });
  }

  /** **Returns a secret:** creates a user and returns its password once (database:admin; PostgreSQL/MySQL). */
  public createUser(projectId: string, instanceId: string, body: CreateManagedInstanceUserBody) {
    return callManaged(this.client, 'createManagedInstanceUser', { projectId, instanceId }, { body });
  }

  /** Changes a user's access preset and databases (database:admin; PostgreSQL/MySQL). */
  public updateUser(projectId: string, instanceId: string, userName: string, body: UpdateManagedInstanceUserBody) {
    return callManaged(this.client, 'updateManagedInstanceUser', { projectId, instanceId, userName }, { body });
  }

  /** Drops a user (database:admin; PostgreSQL/MySQL). */
  public deleteUser(projectId: string, instanceId: string, userName: string, query?: DeleteManagedInstanceUserQuery) {
    return callManaged(this.client, 'deleteManagedInstanceUser', { projectId, instanceId, userName }, { query });
  }

  /** **Returns a secret:** rotates a user's password and returns the new one (database:admin; not the primary user). */
  public rotateUserPassword(projectId: string, instanceId: string, userName: string) {
    return callManaged(this.client, 'postManagedInstanceUserPasswordRotate', { projectId, instanceId, userName });
  }

  /** Available and installed extensions (database:read; PostgreSQL). */
  public listExtensions(projectId: string, instanceId: string, query?: GetManagedInstanceExtensionsQuery) {
    return callManaged(this.client, 'getManagedInstanceExtensions', { projectId, instanceId }, { query });
  }

  /** Installs an extension (database:admin; PostgreSQL). */
  public installExtension(projectId: string, instanceId: string, body: PostManagedInstanceExtensionInstallBody) {
    return callManaged(this.client, 'postManagedInstanceExtensionInstall', { projectId, instanceId }, { body });
  }

  /** Drops an extension (database:admin; PostgreSQL). */
  public deleteExtension(projectId: string, instanceId: string, extensionName: string, query?: DeleteManagedInstanceExtensionQuery) {
    return callManaged(this.client, 'deleteManagedInstanceExtension', { projectId, instanceId, extensionName }, { query });
  }

  /** Exports and imports (database:admin). */
  public listExports(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceExports', { projectId, instanceId });
  }

  /** Starts an export (database:admin). */
  public createExport(projectId: string, instanceId: string, body: CreateManagedInstanceExportBody = {}) {
    return callManaged(this.client, 'createManagedInstanceExport', { projectId, instanceId }, { body });
  }

  /** **Returns a secret:** a presigned download URL valid for 10 minutes (database:admin). */
  public downloadExport(projectId: string, instanceId: string, exportId: string) {
    return callManaged(this.client, 'postManagedInstanceExportDownload', { projectId, instanceId, exportId });
  }

  /** **Returns a secret:** a presigned upload URL valid for 1 hour (database:admin). Upload, then {@link startImport}. */
  public uploadImport(projectId: string, instanceId: string, body: PostManagedInstanceImportUploadBody) {
    return callManaged(this.client, 'postManagedInstanceImportUpload', { projectId, instanceId }, { body });
  }

  /** Starts restoring an uploaded import (database:admin). */
  public startImport(projectId: string, instanceId: string, importId: string) {
    return callManaged(this.client, 'postManagedInstanceImportStart', { projectId, instanceId, importId });
  }

  /** Engine configuration and its generation (database:read). */
  public getConfig(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceConfig', { projectId, instanceId });
  }

  /** Configuration revisions (database:read). */
  public getConfigHistory(projectId: string, instanceId: string, query?: GetManagedInstanceConfigHistoryQuery) {
    return callManaged(this.client, 'getManagedInstanceConfigHistory', { projectId, instanceId }, { query });
  }

  /** Validates configuration changes without applying them (database:admin). */
  public validateConfig(projectId: string, instanceId: string, body: PostManagedInstanceConfigValidateBody) {
    return callManaged(this.client, 'postManagedInstanceConfigValidate', { projectId, instanceId }, { body });
  }

  /** Applies configuration changes; pass the current `generation` (database:admin). */
  public applyConfig(projectId: string, instanceId: string, body: PostManagedInstanceConfigApplyBody) {
    return callManaged(this.client, 'postManagedInstanceConfigApply', { projectId, instanceId }, { body });
  }

  /** Reverts to an earlier configuration revision (database:admin). */
  public revertConfig(projectId: string, instanceId: string, body: PostManagedInstanceConfigRevertBody) {
    return callManaged(this.client, 'postManagedInstanceConfigRevert', { projectId, instanceId }, { body });
  }

  /** Query statistics (database:query; PostgreSQL/MySQL). */
  public getInsights(projectId: string, instanceId: string, query?: GetManagedInstanceInsightsQuery) {
    return callManaged(this.client, 'getManagedInstanceInsights', { projectId, instanceId }, { query });
  }

  /** Resets query statistics (database:admin; PostgreSQL/MySQL). */
  public resetInsights(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceInsightsReset', { projectId, instanceId });
  }

  /** Active sessions with their SQL text (database:query; PostgreSQL/MySQL). Not cached. */
  public listSessions(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceSessions', { projectId, instanceId });
  }

  /** Cancels a session's running query (database:admin). */
  public cancelSession(projectId: string, instanceId: string, sessionId: string) {
    return callManaged(this.client, 'postManagedInstanceSessionCancel', { projectId, instanceId, sessionId });
  }

  /** Terminates a session (database:admin). */
  public terminateSession(projectId: string, instanceId: string, sessionId: string) {
    return callManaged(this.client, 'postManagedInstanceSessionTerminate', { projectId, instanceId, sessionId });
  }

  /** Runs SQL (database:query, also for `readOnly: false`). Results are customer data; not cached. */
  public query(projectId: string, instanceId: string, body: PostManagedInstanceQueryBody) {
    return callManaged(this.client, 'postManagedInstanceQuery', { projectId, instanceId }, { body });
  }

  /** Schemas, tables and columns (database:read). */
  public getSchema(projectId: string, instanceId: string, query?: GetManagedInstanceSchemaQuery) {
    return callManaged(this.client, 'getManagedInstanceSchema', { projectId, instanceId }, { query });
  }

  /** Reads table rows (database:query). Customer data; not cached. */
  public getTableRows(projectId: string, instanceId: string, query: GetManagedInstanceTableRowsQuery) {
    return callManaged(this.client, 'getManagedInstanceTableRows', { projectId, instanceId }, { query });
  }

  /** Inserts, updates or deletes table rows (database:query). */
  public changeTableRows(projectId: string, instanceId: string, body: PostManagedInstanceTableRowsChangeBody) {
    return callManaged(this.client, 'postManagedInstanceTableRowsChange', { projectId, instanceId }, { body });
  }

  /** Lists access tokens (database:read; libSQL). */
  public listTokens(projectId: string, instanceId: string) {
    return callManaged(this.client, 'getManagedInstanceTokens', { projectId, instanceId });
  }

  /** **Returns a secret:** creates an access token (JWT) shown once (database:admin; libSQL). */
  public createToken(projectId: string, instanceId: string, body: CreateManagedInstanceTokenBody) {
    return callManaged(this.client, 'createManagedInstanceToken', { projectId, instanceId }, { body });
  }

  /** Deletes a token; this rotates the signing key, so every token is revoked (database:admin; libSQL). */
  public deleteToken(projectId: string, instanceId: string, tokenId: string) {
    return callManaged(this.client, 'deleteManagedInstanceToken', { projectId, instanceId, tokenId });
  }

  /** **Returns a secret:** a short-lived terminal `connectToken` and `connectUrl` (database:query; PostgreSQL/MySQL; audited). */
  public createShellSession(projectId: string, instanceId: string) {
    return callManaged(this.client, 'postManagedInstanceShellSession', { projectId, instanceId });
  }
}

/**
 * Managed Services (Databases + Realtime): `client.managed`.
 * See {@link ManagedInstancesSubModule}, {@link ManagedDatabasesSubModule}
 * and {@link ManagedRealtimeSubModule}.
 */
export class ManagedModule {
  public readonly instances: ManagedInstancesSubModule;
  public readonly databases: ManagedDatabasesSubModule;
  public readonly realtime: ManagedRealtimeSubModule;

  constructor(private readonly client: HubflyClient) {
    this.instances = new ManagedInstancesSubModule(client);
    this.databases = new ManagedDatabasesSubModule(client);
    this.realtime = new ManagedRealtimeSubModule(client);
  }

  /** Engines, versions, sizes and the realtime catalog (any signed-in user). */
  public catalog() {
    return callManaged(this.client, 'getManagedCatalog', {});
  }

  /** The caller's public IP as the API sees it, for allowlists (any signed-in user). */
  public clientIp() {
    return callManaged(this.client, 'getManagedClientIp', {});
  }

  /** Unit prices (public). */
  public pricing() {
    return callManaged(this.client, 'getManagedPricing', {});
  }

  /** Price of a size (public). Pass `hourly.total` as `quotedHourlyTotal` to create or resize. */
  public estimatePrice(query: GetManagedPriceEstimateQuery) {
    return callManaged(this.client, 'getManagedPriceEstimate', {}, { query });
  }

  /** The project's managed workspace: counts, cost and limits (project `read` level of either service). */
  public workspace(projectId: string) {
    return callManaged(this.client, 'getManagedWorkspace', { projectId });
  }

  /** Recent operations across the project's instances (project `read` level). */
  public listOperations(projectId: string, query?: GetManagedOperationsQuery) {
    return callManaged(this.client, 'getManagedOperations', { projectId }, { query });
  }
}

/**
 * Hubfly API Standard Meta object included in all responses
 */
export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

/**
 * Standard Hubfly API Successful Response Wrapper
 */
export interface ApiResponse<T> {
  ok: true;
  data: T;
  meta: ApiMeta;
}

/**
 * Hubfly API Error Payload
 */
export interface ApiErrorPayload {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  /** Server-side error id (5xx errors only). */
  errorId?: string;
}

/**
 * Standard Hubfly API Error Response Wrapper
 */
export interface ApiErrorResponse {
  ok: false;
  error: string | ApiErrorPayload;
  meta?: ApiMeta;
}

/**
 * Options for initializing HubflyClient
 */
export interface HubflyClientOptions {
  /**
   * API Token / Bearer Token. Can also be set via HUBFLY_TOKEN env variable.
   */
  token?: string;
  /**
   * Base URL for Hubfly API. Defaults to "https://api.hubfly.space"
   */
  baseUrl?: string;
  /**
   * Custom fetch function (useful for custom proxies or test suites)
   */
  fetch?: typeof fetch;
  /**
   * Default timeout in milliseconds (default: 30000)
   */
  timeout?: number;
  subaccountId?: string;
}

export interface Subaccount {
  id: string;
  name: string;
  externalRef?: string | null;
  status: "active" | "suspended" | "closing" | "closed";
  backingOrganizationId: string;
  parentType: "user" | "organization";
  parentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubaccountKey {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  token?: string;
}

// ==========================================
// Authentication Models
// ==========================================
export interface LoginParams {
  email?: string;
  password?: string;
}

export interface LoginResult {
  ok: boolean;
  requiresVerification?: boolean;
  email?: string;
  token?: string;
  error?: string;
}

export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  tokenMasked: string;
  createdAt: string;
  expiresAt?: string;
}

export interface CreateTokenParams {
  name: string;
  expiresInDays?: number;
}

// ==========================================
// Projects & Containers Models
// ==========================================
export interface Project {
  id: string;
  name: string;
  organizationId?: string;
  region: string;
  status: "active" | "suspended" | "deleted";
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectParams {
  name: string;
  organizationId?: string;
  region?: string;
}

export interface PortMapping {
  container: number;
  protocol: "tcp" | "udp";
  publicPort?: number;
}

export interface VolumeMount {
  id?: string;
  name: string;
  mountPoint: string;
  dockerVolumeName?: string;
}

export interface EnvVar {
  id?: string;
  key: string;
  value?: string;
  isSecret?: boolean;
}

export interface ContainerResources {
  cpuLimit?: number;
  memoryMb?: number;
}

export interface ContainerRuntime {
  autoSleep?: boolean;
  autoScale?: boolean;
  is24x7?: boolean;
  autoScaleMode?: string;
}

export interface Container {
  id: string;
  name: string;
  projectId: string;
  projectName?: string;
  status: "RUNNING" | "STOPPED" | "BUILDING" | "CRASHED";
  sourceType: string;
  sourceImageDisplay: string;
  actualImageDisplay?: string;
  resources?: ContainerResources;
  runtime?: ContainerRuntime;
  ports?: PortMapping[];
  volumes?: VolumeMount[];
  environment?: EnvVar[];
  restartPolicy?: string;
  createdAt?: string;
}

export interface CreateContainerParams {
  projectId: string;
  name: string;
  image: string;
  ports?: PortMapping[];
  environment?: EnvVar[];
  volumes?: VolumeMount[];
  resources?: ContainerResources;
}

// ==========================================
// Load Balancers Models
// ==========================================
export interface LoadBalancerTarget {
  id: string;
  targetId: string;
  port: number;
  weight?: number;
  status?: string;
}

export interface LoadBalancerDomain {
  id: string;
  domainName: string;
  sslEnabled?: boolean;
  redirectUrl?: string;
}

export interface LoadBalancer {
  id: string;
  name: string;
  projectId: string;
  algorithm?: string;
  domains?: LoadBalancerDomain[];
  targets?: LoadBalancerTarget[];
  createdAt: string;
}

export interface CreateLoadBalancerParams {
  projectId: string;
  name: string;
  algorithm?: string;
}

export interface UpdateLoadBalancerParams {
  name?: string;
  algorithm?: string;
}

export interface CreateLoadBalancerTargetParams {
  targetId: string;
  port: number;
  weight?: number;
}

export interface CreateLoadBalancerDomainParams {
  domainName: string;
  sslEnabled?: boolean;
}

// ==========================================
// Network & Firewall Models
// ==========================================
export interface NetworkAccess {
  projectId: string;
  enabled: boolean;
  privateIp?: string;
  vpnSubnet?: string;
}

export interface NetworkAccessKey {
  id: string;
  name: string;
  keyMasked: string;
  createdAt: string;
  expiresAt?: string;
}

export interface NetworkFirewallRule {
  id: string;
  direction: "inbound" | "outbound";
  protocol: "tcp" | "udp" | "icmp" | "all";
  portRange?: string;
  cidr: string;
  action: "allow" | "deny";
}

export interface NetworkFirewall {
  projectId: string;
  enabled: boolean;
  rules: NetworkFirewallRule[];
}

export interface NetworkLog {
  timestamp: string;
  sourceIp: string;
  destPort: number;
  action: "allow" | "deny";
  bytes?: number;
}

export interface NetworkProxy {
  proxyUrl: string;
  status: "active" | "inactive";
}

export type ChallengeMode =
  "always" | "adaptive" | "sensitive_paths" | "under_attack";
export type ChallengeFailureMode = "risk_based" | "fail_open" | "fail_closed";
export type ChallengeRouteType =
  | "container_endpoint"
  | "custom_domain"
  | "load_balancer_domain"
  | "load_balancer_custom_domain";
export interface ChallengePathRule {
  path: string;
  match: "exact" | "prefix";
  methods?: string[];
}
export interface ChallengeBypassKey {
  id: string;
  name: string;
  tokenPrefix: string;
  status: string;
  allowedPaths: string[];
  expiresAt?: string | null;
  lastUsedAt?: string | null;
}
export interface RouteChallengePolicy {
  id: string;
  projectId: string;
  routeType: ChallengeRouteType;
  routeId: string;
  domainName: string;
  enabled: boolean;
  mode: ChallengeMode;
  policyRevision: number;
  clearanceTtlSeconds: number;
  failureMode: ChallengeFailureMode;
  allowVerifiedCrawlers: boolean;
  protectedRules: ChallengePathRule[];
  bypassRules: ChallengePathRule[];
  bypassCidrs: string[];
  injectHeaders: boolean;
  syncStatus: "pending" | "active" | "error" | "unsupported";
  syncError?: string | null;
  bypassKeys?: ChallengeBypassKey[];
}
export interface UpdateChallengePolicyParams {
  enabled: boolean;
  mode?: ChallengeMode;
  clearanceTtlSeconds?: number;
  failureMode?: ChallengeFailureMode;
  allowVerifiedCrawlers?: boolean;
  protectedRules?: ChallengePathRule[];
  bypassRules?: ChallengePathRule[];
  bypassCidrs?: string[];
  injectHeaders?: boolean;
}
export interface ChallengeRoute {
  routeType: ChallengeRouteType;
  routeId: string;
  hostname: string;
  label: string;
  challengePolicy: RouteChallengePolicy | null;
}
export interface CreatedChallengeBypassKey {
  id: string;
  name: string;
  prefix: string;
  token: string;
  allowedPaths: string[];
  expiresAt?: string | null;
}
export interface ChallengeAnalytics {
  range: "24h" | "7d" | "30d";
  sampledRequests: number;
  counts: Record<string, number>;
  solveRate: number | null;
  averageProofLatencyMs: number | null;
  topChallengedPaths: Array<{ path: string; count: number }>;
  truncated: boolean;
}

// ==========================================
// Port Reservations Models
// ==========================================
export interface PortReservation {
  reservationId: string;
  port: number;
  protocol: "tcp" | "udp";
  status: "reserved" | "mapped";
  mappedContainerId?: string;
  mappedContainerPort?: number;
}

export interface ReservePortParams {
  protocol: "tcp" | "udp";
  port?: number;
}

export interface MapPortParams {
  containerId: string;
  containerPort: number;
}

// ==========================================
// Container Registry Models
// ==========================================
export interface RegistryCredential {
  credentialId: string;
  name: string;
  registryUrl: string;
  username: string;
  createdAt: string;
}

export interface CreateRegistryCredentialParams {
  name: string;
  registryUrl: string;
  username: string;
  password?: string;
}

export interface RegistryImage {
  imageId: string;
  name: string;
  tag: string;
  digest: string;
  sizeBytes: number;
  createdAt: string;
}

export interface RegistryToken {
  tokenId: string;
  name: string;
  scopes: string[];
  expiresAt?: string;
}

export interface RegistryWebhook {
  webhookId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface ImageScanResult {
  imageId: string;
  status: "clean" | "vulnerabilities_found" | "scanning" | "failed";
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  scannedAt: string;
}

// ==========================================
// Subdomains Models
// ==========================================
export interface SubdomainReservation {
  subdomainId: string;
  subdomain: string;
  fullDomain: string;
  status: "active" | "pending";
  createdAt: string;
}

export interface CreateSubdomainParams {
  subdomain: string;
}

// ==========================================
// Team & Invitations Models
// ==========================================
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  permissions?: string[];
  joinedAt: string;
}

export interface TeamInvitation {
  invitationId: string;
  email: string;
  role: "admin" | "member" | "viewer";
  status: "pending" | "accepted" | "declined" | "expired";
  createdAt: string;
}

export interface CreateTeamInvitationParams {
  email: string;
  role?: "admin" | "member" | "viewer";
}

// ==========================================
// Tunnels Models
// ==========================================
export interface ProjectTunnel {
  tunnelId: string;
  name: string;
  targetPort: number;
  publicUrl: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface CreateTunnelParams {
  name: string;
  targetPort: number;
}

// ==========================================
// Volumes Models
// ==========================================
export interface Volume {
  id: string;
  name: string;
  sizeGb: number;
  mountPoint?: string;
  status: "bound" | "unbound";
  labels?: Record<string, string>;
  createdAt: string;
}

export interface CreateVolumeParams {
  projectId: string;
  name: string;
  sizeGb: number;
}

// ==========================================
// Webhooks Models
// ==========================================
export interface ProjectWebhook {
  webhookId: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookParams {
  url: string;
  events: string[];
  secret?: string;
}

// ==========================================
// Hibernation Models
// ==========================================
export interface HibernationStatus {
  projectId: string;
  hibernated: boolean;
  hibernatedAt?: string;
  reason?: string;
}

export interface HibernationPreview {
  projectId: string;
  eligible: boolean;
  estimatedDiskSavedMb?: number;
}

// ==========================================
// Project Moves (transfers, region migration, history)
// ==========================================
// Shapes of hubfly-dashboard/shared/project-moves.ts. Region migration types
// join this section.

export type ProjectJobKind =
  | "project_transfer"
  | "project_migration"
  | "migration_reverse"
  | "metadata_rehome";

export type ProjectJobStatus =
  | "queued"
  | "running"
  | "waiting"
  | "rolling_back"
  | "succeeded"
  | "failed"
  | "canceled"
  | "needs_attention";

export type ProjectJobStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

/** `config` pauses changes to the project; `full` also stops its workloads. */
export type ProjectLockLevel = "config" | "full";

/** The long-running job behind a transfer or a region move. */
export interface ProjectJobView {
  id: string;
  kind: ProjectJobKind;
  status: ProjectJobStatus;
  phase: "forward" | "compensation";
  lock: ProjectLockLevel | null;
  step: string | null;
  stepLabel: string | null;
  stepIndex: number;
  stepCount: number;
  steps: {
    key: string;
    label: string;
    status: ProjectJobStepStatus;
    phase: "forward" | "compensation";
    startedAt: string | null;
    finishedAt: string | null;
  }[];
  progress: number | null;
  etaSeconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  remediationCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
}

/** A personal account or an organization that owns projects. */
export interface OwnerRef {
  type: "user" | "organization";
  id: string;
  name: string;
}

export type MoveIssueSeverity = "blocker" | "warning" | "info";

/** A blocker, warning or note of a transfer or migration preview. */
export interface MoveIssue {
  /** e.g. `TRANSFER_WORK_IN_PROGRESS`, `TRANSFER_ENV_VISIBLE`. */
  code: string;
  severity: MoveIssueSeverity;
  message: string;
  detail?: Record<string, string | number | boolean | null | string[]>;
}

/** A count of one kind of resource that moves or is revoked. */
export interface MoveCount {
  kind: string;
  label: string;
  count: number;
}

export type ProjectTransferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "canceled"
  | "expired"
  | "completed"
  | "failed";

export interface ProjectTransferView {
  id: string;
  /** null once the project was deleted. */
  projectId: string | null;
  projectName: string;
  projectType: string;
  status: ProjectTransferStatus;
  recipientEmail: string;
  from: OwnerRef;
  /** Set once the offer is accepted. */
  to: OwnerRef | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  /** The full hour at which the owner changes. */
  handoverAt: string | null;
  job: ProjectJobView | null;
  failureCode: string | null;
  failureMessage: string | null;
}

/** What a transfer would move and revoke, and what blocks it (sender only). */
export interface ProjectTransferPreview {
  projectId: string;
  projectName: string;
  projectType: string;
  canTransfer: boolean;
  blockers: MoveIssue[];
  warnings: MoveIssue[];
  moves: MoveCount[];
  revokedIfSenderLosesAccess: MoveCount[];
  envValueCount: number;
  requiresOtp: true;
}

/** Where the transfer confirmation code was sent. */
export interface ProjectTransferOtp {
  sentTo: string;
  expiresAt: string;
}

/** An offer waiting for you. The token is only in the offer email. */
export interface ProjectTransferOfferSummary {
  token: null;
  transferId: string;
  batchId: string | null;
  projectName: string;
  projectType: string;
  senderName: string;
  expiresAt: string;
  status: ProjectTransferStatus;
}

export interface ProjectTransferList {
  incoming: ProjectTransferOfferSummary[];
  outgoing: ProjectTransferView[];
}

export interface ProjectTransferOfferView {
  batchId: string | null;
  senderName: string;
  expiresAt: string;
  status: ProjectTransferStatus;
  projects: {
    transferId: string;
    projectName: string;
    projectType: string;
    hosting: {
      hostnames: string[];
      customDomains: string[];
      mailDomains: string[];
      buckets: number;
      containers: number;
      volumes: number;
      boxes: number;
    };
    /** Direct members; they lose access unless kept with `keepMembers`. */
    members: {
      userId: string;
      name: string;
      email: string;
      permissions: string[];
      credentials: string[];
    }[];
  }[];
  destinations: {
    type: "user" | "organization";
    id: string;
    name: string;
    eligible: boolean;
    reason: string | null;
  }[];
}

/** What accepting into a destination costs and requires (recipient only). */
export interface ProjectTransferAcceptancePreview {
  eligible: boolean;
  blockers: MoveIssue[];
  warnings: MoveIssue[];
  balanceMicroUsd: number;
  requiredBalanceMicroUsd: number;
  hourlyBurnMicroUsd: number;
  billedPlans: {
    kind: string;
    label: string;
    amountMicroUsd: number;
    period: string;
  }[];
  credentialPolicy: "rotate" | "keep";
  revoked: MoveCount[];
}

export interface ProjectTransferOptions {
  /** `rotate` revokes every project credential at the handover; `auto` (default) only those of people who lose access. */
  credentialPolicy?: "auto" | "rotate";
}

export interface CreateProjectTransferOtpParams {
  recipientEmail: string;
}

export interface CreateProjectTransferParams {
  recipientEmail: string;
  /** The project name, typed to confirm. */
  confirmName: string;
  /** The code from `transfers.createOtp`. */
  otp: string;
  options?: ProjectTransferOptions;
}

export interface CreateProjectTransferBundleOtpParams {
  projectIds: string[];
  recipientEmail: string;
}

export interface CreateProjectTransferBundleParams {
  projectIds: string[];
  recipientEmail: string;
  /** `TRANSFER <n> PROJECTS`; see `transferBundleConfirmText`. */
  confirmText: string;
  otp: string;
  options?: ProjectTransferOptions;
}

export interface ProjectTransferBundle {
  batchId: string;
  transfers: ProjectTransferView[];
}

export interface ProjectTransferDestinationParams {
  destinationType: "user" | "organization";
  /** The organization id (or your user id) to accept into. */
  destinationId?: string;
  /** A subset of a bundle; every open project of the offer when omitted. */
  transferIds?: string[];
}

export interface AcceptProjectTransferParams extends ProjectTransferDestinationParams {
  /** Direct members who keep their access; everyone else is removed. */
  keepMembers?: { transferId: string; userIds: string[] }[];
}

export interface ProjectHistoryEntry {
  id: string;
  kind: "transfer" | "migration" | "reverse" | "rehome" | "evacuation";
  status: string;
  title: string;
  detail: string | null;
  actor: string | null;
  at: string;
  href: string | null;
}

// ==========================================
// Regions & Templates Models
// ==========================================
export interface Region {
  id: string;
  name: string;
  code: string;
  country: string;
  available: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl?: string;
  recommendedResources?: ContainerResources;
}

// ==========================================
// Organizations & Teams Models
// ==========================================
export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  userId: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

// ==========================================
// Domains & DNS Models
// ==========================================
export interface Domain {
  id: string;
  domainName: string;
  verified: boolean;
  verificationHost?: string;
  verificationToken?: string;
  createdAt: string;
}

export interface CreateDomainParams {
  domainName: string;
}

// ==========================================
// GPU Computing Models
// ==========================================
export interface GpuInstance {
  id: string;
  name: string;
  gpuType: string;
  gpuCount: number;
  status: "RUNNING" | "PROVISIONING" | "STOPPED";
  ipAddress?: string;
  createdAt: string;
}

// ==========================================
// System Models
// ==========================================
export interface SystemHealth {
  status: "ok" | "degraded" | "down";
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

// Region migrations. Writes accept only unrestricted personal access tokens or browser sessions.
export type ProjectMigrationMode = "cold" | "warm";
export type ProjectMigrationKind = "migration" | "reverse" | "rehome";
export type ProjectMigrationStatus = "scheduled" | "preparing" | "syncing" | "awaiting_window" | "awaiting_decision" | "frozen" | "verifying" | "cutting_over" | "watching" | "completed" | "failed" | "rolled_back" | "canceled" | "needs_attention";

export type RegionRef = { id: string; name: string; location: string };
export type FreezeEstimate = {
	seconds: number;
	lowSeconds: number;
	highSeconds: number;
	basis: string;
};
export type UrlMapEntry = {
	kind: "http" | "tcp" | "lb" | "subdomain" | "registry";
	old: string;
	new: string;
	editable: boolean;
};
export type DnsRecordPlan = {
	name: string;
	type: "CNAME" | "A";
	current: string;
	next: string;
	ttlSeconds: number | null;
	wildcard: boolean;
	status: "pending" | "switched" | "unknown";
	checkedAt: string | null;
	certificateReady: boolean;
};
export type DnsPlan = {
	records: DnsRecordPlan[];
	registryHost: { old: string; new: string } | null;
	tcpEndpoints: { old: string; new: string }[];
	egress: { old: string[]; new: string[] };
};
export type ChecklistItem = {
	id: string;
	title: string;
	detail: string;
	copy: string | null;
	severity: MoveIssueSeverity;
};
export type MigrationTargetRegion = RegionRef & {
	eligible: boolean;
	reason: string | null;
	latencyHint: string | null;
};
export type ProjectMigrationPreview = {
	projectId: string;
	source: RegionRef;
	target: RegionRef;
	canMigrate: boolean;
	blockers: MoveIssue[];
	warnings: MoveIssue[];
	recommendedMode: ProjectMigrationMode;
	estimates: { cold: FreezeEstimate; warm: FreezeEstimate };
	data: { volumeBytes: number; rootfsBytes: number; imageBytes: number };
	bandwidth: { bytesPerSecond: number; measuredAt: string } | null;
	feeMicroUsd: number;
	feeWaived: boolean;
	urlMap: UrlMapEntry[];
	dnsPlan: DnsPlan;
	checklist: ChecklistItem[];
};
export type MigrationPassView = {
	pass: number;
	startedAt: string;
	finishedAt: string | null;
	bytesTransferred: number;
	changedChunks: number;
	seconds: number;
	freezeEstimateSeconds: number;
};
export type MigrationItemView = {
	resourceType: string;
	resourceId: string;
	label: string;
	state: string;
	bytesTotal: number;
	bytesDone: number;
	rateBytesPerSecond: number | null;
	etaSeconds: number | null;
};
export type VerificationCheck = {
	id: string;
	label: string;
	status: "pending" | "passed" | "failed" | "skipped" | "info";
	detail: string | null;
};
export type ProjectMigrationView = {
	id: string;
	projectId: string | null;
	projectName: string;
	kind: ProjectMigrationKind;
	status: ProjectMigrationStatus;
	mode: ProjectMigrationMode;
	initiatedBy: "customer" | "evacuation" | "operator";
	source: RegionRef;
	target: RegionRef;
	scheduledAt: string | null;
	maxFreezeSeconds: number | null;
	estimates: {
		cold?: FreezeEstimate;
		warm?: FreezeEstimate;
		current?: FreezeEstimate;
	};
	bytesTotal: number;
	bytesDone: number;
	passes: MigrationPassView[];
	items: MigrationItemView[];
	freezeStartedAt: string | null;
	freezeEndedAt: string | null;
	cutoverAt: string | null;
	completedAt: string | null;
	urlMap: UrlMapEntry[];
	dnsPlan: DnsPlan;
	checklist: ChecklistItem[];
	verification: { checks: VerificationCheck[]; passed: boolean | null };
	bridge: {
		status: "none" | "active" | "removed";
		until: string | null;
		trafficOnTargetPercent: number | null;
	};
	sourceRetainedUntil: string | null;
	sourceCleanedAt: string | null;
	feeMicroUsd: number;
	refunded: boolean;
	canCancel: boolean;
	canMoveBack: boolean;
	decisionPending: boolean;
	job: ProjectJobView | null;
	failureCode: string | null;
	failureMessage: string | null;
	createdAt: string;
};
export type ProjectMigrationDnsStatus = {
	records: DnsRecordPlan[];
	checkedAt: string | null;
	bridgeUntil: string | null;
};
export type MigrationAttestation = {
	attestation: {
		version: 1;
		migrationId: string;
		projectId: string | null;
		source: string;
		target: string;
		objects: {
			kind: string;
			name: string;
			sizeBytes: number;
			merkleRoot: string;
		}[];
		images: { reference: string; digest: string }[];
		freezeStartedAt: string | null;
		cutoverAt: string | null;
		sourceCleanedAt: string | null;
		issuedAt: string;
	};
	signature: string;
	keyId: string;
};
export type MigrationBatchView = {
	id: string;
	kind: "customer_migration" | "evacuation";
	status: string;
	target: RegionRef | null;
	source: RegionRef | null;
	concurrency: number;
	deadlineAt: string | null;
	counters: Record<string, number>;
	migrations: ProjectMigrationView[];
	createdAt: string;
};
export type ProjectMoveNotice = {
	id: string;
	kind: "transfer_offer" | "evacuation" | "migration_decision" | "dns_pending";
	title: string;
	detail: string;
	href: string;
	deadlineAt: string | null;
	projectId: string | null;
};


export interface CreateProjectMigrationParams {targetRegionId:string;mode:ProjectMigrationMode;confirmName:string;scheduledAt?:string|null;maxFreezeSeconds?:number|null;hostnameOverrides?:{old:string;new:string}[];managedAllowlistConsent?:boolean;}
export interface CreateMigrationBatchParams {projectIds:string[];targetRegionId:string;mode:ProjectMigrationMode;confirmText:string;scheduledAt?:string|null;maxFreezeSeconds?:number|null;}
export interface MigrationBandwidthProbe {bytesPerSecond:number;measuredAt:string;observedEgressIp:string|null;}

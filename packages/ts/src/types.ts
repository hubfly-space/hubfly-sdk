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
  status: 'active' | 'suspended' | 'deleted';
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
  protocol: 'tcp' | 'udp';
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
  status: 'RUNNING' | 'STOPPED' | 'BUILDING' | 'CRASHED';
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
  direction: 'inbound' | 'outbound';
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  portRange?: string;
  cidr: string;
  action: 'allow' | 'deny';
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
  action: 'allow' | 'deny';
  bytes?: number;
}

export interface NetworkProxy {
  proxyUrl: string;
  status: 'active' | 'inactive';
}

// ==========================================
// Port Reservations Models
// ==========================================
export interface PortReservation {
  reservationId: string;
  port: number;
  protocol: 'tcp' | 'udp';
  status: 'reserved' | 'mapped';
  mappedContainerId?: string;
  mappedContainerPort?: number;
}

export interface ReservePortParams {
  protocol: 'tcp' | 'udp';
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
  status: 'clean' | 'vulnerabilities_found' | 'scanning' | 'failed';
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
  status: 'active' | 'pending';
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
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions?: string[];
  joinedAt: string;
}

export interface TeamInvitation {
  invitationId: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
}

export interface CreateTeamInvitationParams {
  email: string;
  role?: 'admin' | 'member' | 'viewer';
}

// ==========================================
// Tunnels Models
// ==========================================
export interface ProjectTunnel {
  tunnelId: string;
  name: string;
  targetPort: number;
  publicUrl: string;
  status: 'active' | 'inactive';
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
  status: 'bound' | 'unbound';
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
  role: 'owner' | 'admin' | 'member';
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
  status: 'RUNNING' | 'PROVISIONING' | 'STOPPED';
  ipAddress?: string;
  createdAt: string;
}

// ==========================================
// System Models
// ==========================================
export interface SystemHealth {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

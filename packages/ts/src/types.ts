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

export interface Volume {
  id: string;
  name: string;
  sizeGb: number;
  mountPoint?: string;
  status: 'bound' | 'unbound';
  createdAt: string;
}

export interface CreateVolumeParams {
  projectId: string;
  name: string;
  sizeGb: number;
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

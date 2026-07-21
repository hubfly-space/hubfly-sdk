import type { HubflyClient } from '../client.js';
import type {
  ApiResponse,
  Project,
  CreateProjectParams,
  Container,
  CreateContainerParams,
  Volume,
  CreateVolumeParams,
  EnvVar,
} from '../types.js';

export class ContainersSubModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List all containers under a project
   */
  public async list(projectId: string): Promise<ApiResponse<Container[]>> {
    return this.client.request<Container[]>(`/api/v1/projects/${projectId}/containers`);
  }

  /**
   * Get container details by ID
   */
  public async get(projectId: string, containerId: string): Promise<ApiResponse<Container>> {
    return this.client.request<Container>(`/api/v1/projects/${projectId}/containers/${containerId}`);
  }

  /**
   * Deploy a new container under a project
   */
  public async create(params: CreateContainerParams): Promise<ApiResponse<Container>> {
    return this.client.request<Container>(`/api/v1/projects/${params.projectId}/containers`, {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Delete a container
   */
  public async delete(projectId: string, containerId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(`/api/v1/projects/${projectId}/containers/${containerId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Restart a container
   */
  public async restart(projectId: string, containerId: string): Promise<ApiResponse<{ restarted: boolean }>> {
    return this.client.request<{ restarted: boolean }>(
      `/api/v1/projects/${projectId}/containers/${containerId}/restart`,
      { method: 'POST' }
    );
  }
}

export class ProjectsModule {
  public readonly containers: ContainersSubModule;

  constructor(private readonly client: HubflyClient) {
    this.containers = new ContainersSubModule(client);
  }

  /**
   * List all projects for current account
   */
  public async list(): Promise<ApiResponse<Project[]>> {
    return this.client.request<Project[]>('/api/v1/projects');
  }

  /**
   * Get project by ID
   */
  public async get(projectId: string): Promise<ApiResponse<Project>> {
    return this.client.request<Project>(`/api/v1/projects/${projectId}`);
  }

  /**
   * Create a new project
   */
  public async create(params: CreateProjectParams): Promise<ApiResponse<Project>> {
    return this.client.request<Project>('/api/v1/projects', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Delete a project
   */
  public async delete(projectId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(`/api/v1/projects/${projectId}/delete`, {
      method: 'POST',
    });
  }

  /**
   * List volumes attached to a project
   */
  public async listVolumes(projectId: string): Promise<ApiResponse<Volume[]>> {
    return this.client.request<Volume[]>(`/api/v1/projects/${projectId}/volumes`);
  }

  /**
   * Create a new volume for a project
   */
  public async createVolume(params: CreateVolumeParams): Promise<ApiResponse<Volume>> {
    return this.client.request<Volume>(`/api/v1/projects/${params.projectId}/volumes`, {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Get project environment variables
   */
  public async getEnv(projectId: string): Promise<ApiResponse<EnvVar[]>> {
    return this.client.request<EnvVar[]>(`/api/v1/projects/${projectId}/env`);
  }

  /**
   * Update project environment variables
   */
  public async updateEnv(projectId: string, env: EnvVar[]): Promise<ApiResponse<EnvVar[]>> {
    return this.client.request<EnvVar[]>(`/api/v1/projects/${projectId}/env`, {
      method: 'PUT',
      body: { environment: env },
    });
  }
}

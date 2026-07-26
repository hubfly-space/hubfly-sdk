import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';

export class CliModule {
  constructor(private readonly client: HubflyClient) {}

  public async getContainerSnapshot(containerId: string): Promise<ApiResponse<unknown>> {
    return this.client.request<unknown>(`/api/v1/cli/deploy/containers/${containerId}`);
  }

  public async createDeploySession(body?: unknown): Promise<ApiResponse<unknown>> {
    return this.client.request<unknown>('/api/v1/cli/deploy/sessions', {
      method: 'POST',
      body,
    });
  }

  public async getDeploySession(buildId: string): Promise<ApiResponse<unknown>> {
    return this.client.request<unknown>(`/api/v1/cli/deploy/sessions/${buildId}`);
  }

  public async failDeploySession(buildId: string, reason?: string): Promise<ApiResponse<{ failed: boolean }>> {
    return this.client.request<{ failed: boolean }>(`/api/v1/cli/deploy/sessions/${buildId}/fail`, {
      method: 'POST',
      body: { reason },
    });
  }
}

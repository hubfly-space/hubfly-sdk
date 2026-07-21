import type { HubflyClient } from '../client.js';
import type { ApiResponse, GpuInstance } from '../types.js';

export class GpuModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List GPU instances
   */
  public async list(): Promise<ApiResponse<GpuInstance[]>> {
    return this.client.request<GpuInstance[]>('/api/v1/gpu');
  }
}

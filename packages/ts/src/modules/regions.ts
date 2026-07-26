import type { HubflyClient } from '../client.js';
import type { ApiResponse, Region } from '../types.js';

export class RegionsModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List all available regions
   */
  public async list(): Promise<ApiResponse<Region[]>> {
    return this.client.request<Region[]>('/api/v1/regions');
  }
}

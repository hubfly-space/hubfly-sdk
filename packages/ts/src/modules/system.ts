import type { HubflyClient } from '../client.js';
import type { ApiResponse, SystemHealth } from '../types.js';

export class SystemModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * Health check endpoint
   */
  public async getHealth(): Promise<ApiResponse<SystemHealth>> {
    return this.client.request<SystemHealth>('/api/v1/system');
  }
}

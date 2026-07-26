import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';

export class MarketplaceModule {
  constructor(private readonly client: HubflyClient) {}

  public async getTemplates(): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/marketplace/templates');
  }
}

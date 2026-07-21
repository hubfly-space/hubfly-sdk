import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';

export class BillingModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * Create checkout session
   */
  public async createCheckoutSession(params: { planId: string; returnUrl: string }): Promise<ApiResponse<{ url: string }>> {
    return this.client.request<{ url: string }>('/api/v1/billing/checkout', {
      method: 'POST',
      body: params,
    });
  }
}

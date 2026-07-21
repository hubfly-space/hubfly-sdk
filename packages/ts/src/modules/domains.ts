import type { HubflyClient } from '../client.js';
import type { ApiResponse, Domain, CreateDomainParams } from '../types.js';

export class DomainsModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List custom domains
   */
  public async list(): Promise<ApiResponse<Domain[]>> {
    return this.client.request<Domain[]>('/api/v1/domains');
  }

  /**
   * Register a custom domain
   */
  public async create(params: CreateDomainParams): Promise<ApiResponse<Domain>> {
    return this.client.request<Domain>('/api/v1/domains/create', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Trigger DNS verification check for a domain
   */
  public async verify(domainId: string): Promise<ApiResponse<{ verified: boolean }>> {
    return this.client.request<{ verified: boolean }>(`/api/v1/domains/${domainId}/verify`, {
      method: 'POST',
    });
  }

  /**
   * Remove a custom domain
   */
  public async remove(domainId: string): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(`/api/v1/domains/${domainId}/remove`, {
      method: 'POST',
    });
  }
}

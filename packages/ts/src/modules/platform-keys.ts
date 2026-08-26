import type { HubflyClient } from '../client.js';
import type { ApiResponse, SubaccountKey } from '../types.js';

export class PlatformKeysModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(parentType: 'user' | 'organization', parentId?: string): Promise<ApiResponse<SubaccountKey[]>> {
    return this.client.request<SubaccountKey[]>('/api/v1/platform/api-keys', { query: { parentType, parentId } });
  }

  public async create(params: { parentType: 'user' | 'organization'; parentId?: string; name?: string; scopes?: string[]; expiresAt?: string | null }): Promise<ApiResponse<SubaccountKey>> {
    return this.client.request<SubaccountKey>('/api/v1/platform/api-keys/create', { method: 'POST', body: params });
  }

  public async revoke(keyId: string): Promise<ApiResponse<{ ok: boolean }>> {
    return this.client.request<{ ok: boolean }>(`/api/v1/platform/api-keys/${keyId}/revoke`, { method: 'POST' });
  }
}

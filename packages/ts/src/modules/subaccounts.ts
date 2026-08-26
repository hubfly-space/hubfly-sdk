import type { HubflyClient } from '../client.js';
import type { ApiResponse, Subaccount, SubaccountKey } from '../types.js';

export class SubaccountsModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(): Promise<ApiResponse<Subaccount[]>> {
    return this.client.request<Subaccount[]>('/api/v1/subaccounts');
  }

  public async create(params: { name: string; externalRef?: string; metadata?: Record<string, string>; parentType?: 'user' | 'organization'; parentId?: string }): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>('/api/v1/subaccounts/create', { method: 'POST', body: params });
  }

  public async get(subaccountId: string): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>(`/api/v1/subaccounts/${subaccountId}`);
  }

  public async update(subaccountId: string, params: { name?: string; metadata?: Record<string, string>; maxProjects?: number | null; spendLimitMicroUsd?: string | null }): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>(`/api/v1/subaccounts/${subaccountId}`, { method: 'POST', body: params });
  }

  public async suspend(subaccountId: string): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>(`/api/v1/subaccounts/${subaccountId}/suspend`, { method: 'POST' });
  }

  public async resume(subaccountId: string): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>(`/api/v1/subaccounts/${subaccountId}/resume`, { method: 'POST' });
  }

  public async close(subaccountId: string): Promise<ApiResponse<Subaccount>> {
    return this.client.request<Subaccount>(`/api/v1/subaccounts/${subaccountId}/close`, { method: 'POST' });
  }

  public async listKeys(subaccountId: string): Promise<ApiResponse<SubaccountKey[]>> {
    return this.client.request<SubaccountKey[]>(`/api/v1/subaccounts/${subaccountId}/api-keys`);
  }

  public async createKey(subaccountId: string, params: { name?: string; scopes?: string[]; expiresAt?: string | null } = {}): Promise<ApiResponse<SubaccountKey>> {
    return this.client.request<SubaccountKey>(`/api/v1/subaccounts/${subaccountId}/api-keys/create`, { method: 'POST', body: params });
  }

  public async revokeKey(subaccountId: string, keyId: string): Promise<ApiResponse<{ ok: boolean }>> {
    return this.client.request<{ ok: boolean }>(`/api/v1/subaccounts/${subaccountId}/api-keys/${keyId}/revoke`, { method: 'POST' });
  }

  public async wallet(subaccountId: string): Promise<ApiResponse<{ subaccountId: string; balanceMicroUsd: string; status: string }>> {
    return this.client.request(`/api/v1/subaccounts/${subaccountId}/wallet`);
  }

  public async transfer(subaccountId: string, amountMicroUsd: string, idempotencyKey: string): Promise<ApiResponse<{ id: string; subaccountId: string; amountMicroUsd: string; status: string }>> {
    return this.client.request(`/api/v1/subaccounts/${subaccountId}/wallet/transfers`, { method: 'POST', body: { amountMicroUsd, idempotencyKey } });
  }
}

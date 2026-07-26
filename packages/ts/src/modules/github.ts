import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';

export class GithubModule {
  constructor(private readonly client: HubflyClient) {}

  public async getStatus(): Promise<ApiResponse<unknown>> {
    return this.client.request<unknown>('/api/v1/github/status');
  }

  public async getRepos(): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/github/repos');
  }

  public async getBranches(repo?: string): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/github/branches', {
      query: repo ? { repo } : undefined,
    });
  }

  public async getCommits(repo?: string, branch?: string): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/github/commits', {
      query: { repo, branch },
    });
  }

  public async refreshToken(): Promise<ApiResponse<{ refreshed: boolean }>> {
    return this.client.request<{ refreshed: boolean }>('/api/v1/github/refresh-token');
  }
}

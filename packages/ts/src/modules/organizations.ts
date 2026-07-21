import type { HubflyClient } from '../client.js';
import type { ApiResponse, Organization, OrgMember } from '../types.js';

export class OrganizationsModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List user's organizations
   */
  public async list(): Promise<ApiResponse<Organization[]>> {
    return this.client.request<Organization[]>('/api/v1/organizations');
  }

  /**
   * Get organization by ID
   */
  public async get(orgId: string): Promise<ApiResponse<Organization>> {
    return this.client.request<Organization>(`/api/v1/organizations/${orgId}`);
  }

  /**
   * Create a new organization
   */
  public async create(name: string): Promise<ApiResponse<Organization>> {
    return this.client.request<Organization>('/api/v1/organizations', {
      method: 'POST',
      body: { name },
    });
  }

  /**
   * List members of an organization
   */
  public async listMembers(orgId: string): Promise<ApiResponse<OrgMember[]>> {
    return this.client.request<OrgMember[]>(`/api/v1/organizations/${orgId}/members`);
  }
}

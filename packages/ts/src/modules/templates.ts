import type { HubflyClient } from '../client.js';
import type { ApiResponse, Template } from '../types.js';

export class TemplatesModule {
  constructor(private readonly client: HubflyClient) {}

  /**
   * List available application templates
   */
  public async list(): Promise<ApiResponse<Template[]>> {
    return this.client.request<Template[]>('/api/v1/templates');
  }
}

import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';

export class CoursesModule {
  constructor(private readonly client: HubflyClient) {}

  public async getAssignments(courseId: string): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>(`/api/v1/courses/${courseId}/assignments`);
  }

  public async createAssignment(courseId: string, params: unknown): Promise<ApiResponse<unknown>> {
    return this.client.request<unknown>(`/api/v1/courses/${courseId}/assignments/create`, {
      method: 'POST',
      body: params,
    });
  }
}

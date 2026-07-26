import type { HubflyClient } from '../client.js';
import type {
  ApiResponse,
  LoginParams,
  LoginResult,
  RegisterParams,
  UserProfile,
  ApiToken,
  CreateTokenParams,
} from '../types.js';

export class AuthModule {
  constructor(private readonly client: HubflyClient) {}

  public async login(params: LoginParams): Promise<ApiResponse<LoginResult>> {
    return this.client.request<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      body: params,
    });
  }

  public async register(params: RegisterParams): Promise<ApiResponse<UserProfile>> {
    return this.client.request<UserProfile>('/api/v1/auth/register', {
      method: 'POST',
      body: params,
    });
  }

  public async getProfile(): Promise<ApiResponse<UserProfile>> {
    return this.client.request<UserProfile>('/api/v1/auth/profile');
  }

  public async me(): Promise<ApiResponse<UserProfile>> {
    return this.client.request<UserProfile>('/api/v1/auth/me');
  }

  public async logout(): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/logout', {
      method: 'POST',
    });
  }

  public async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  }

  public async forgotPassword(email: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  }

  public async resetPassword(token: string, newPassword: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword },
    });
  }

  public async verifyEmail(code: string): Promise<ApiResponse<{ verified: boolean }>> {
    return this.client.request<{ verified: boolean }>('/api/v1/auth/verify-email', {
      method: 'POST',
      body: { code },
    });
  }

  public async resendCode(): Promise<ApiResponse<{ sent: boolean }>> {
    return this.client.request<{ sent: boolean }>('/api/v1/auth/resend-code', {
      method: 'POST',
    });
  }

  public async listSessions(): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/auth/sessions');
  }

  public async revokeSession(sessionId: string): Promise<ApiResponse<{ revoked: boolean }>> {
    return this.client.request<{ revoked: boolean }>('/api/v1/auth/sessions/revoke', {
      method: 'POST',
      body: { sessionId },
    });
  }

  public async listAccounts(): Promise<ApiResponse<unknown[]>> {
    return this.client.request<unknown[]>('/api/v1/auth/accounts');
  }

  public async unlinkAccount(provider: string): Promise<ApiResponse<{ unlinked: boolean }>> {
    return this.client.request<{ unlinked: boolean }>('/api/v1/auth/accounts/unlink', {
      method: 'POST',
      body: { provider },
    });
  }

  public async listTokens(): Promise<ApiResponse<ApiToken[]>> {
    return this.client.request<ApiToken[]>('/api/v1/auth/tokens');
  }

  public async createToken(params: CreateTokenParams): Promise<ApiResponse<ApiToken>> {
    return this.client.request<ApiToken>('/api/v1/auth/tokens/create', {
      method: 'POST',
      body: params,
    });
  }

  public async revokeToken(tokenId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/tokens/revoke', {
      method: 'POST',
      body: { tokenId },
    });
  }
}

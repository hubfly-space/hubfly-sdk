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

  /**
   * Log in user with email and password
   */
  public async login(params: LoginParams): Promise<ApiResponse<LoginResult>> {
    return this.client.request<LoginResult>('/api/v1/auth/login', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Register a new user account
   */
  public async register(params: RegisterParams): Promise<ApiResponse<UserProfile>> {
    return this.client.request<UserProfile>('/api/v1/auth/register', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Get current authenticated user profile
   */
  public async getProfile(): Promise<ApiResponse<UserProfile>> {
    return this.client.request<UserProfile>('/api/v1/auth/profile');
  }

  /**
   * List API Tokens for the user
   */
  public async listTokens(): Promise<ApiResponse<ApiToken[]>> {
    return this.client.request<ApiToken[]>('/api/v1/auth/tokens');
  }

  /**
   * Create a new API Token
   */
  public async createToken(params: CreateTokenParams): Promise<ApiResponse<ApiToken>> {
    return this.client.request<ApiToken>('/api/v1/auth/tokens/create', {
      method: 'POST',
      body: params,
    });
  }

  /**
   * Revoke an existing API token
   */
  public async revokeToken(tokenId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.client.request<{ success: boolean }>('/api/v1/auth/tokens/revoke', {
      method: 'POST',
      body: { tokenId },
    });
  }
}

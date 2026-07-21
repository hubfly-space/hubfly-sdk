package hubfly

import "context"

type AuthService struct {
	client *Client
}

// Login authenticates a user with email and password
func (s *AuthService) Login(ctx context.Context, params LoginParams) (*Response[LoginResult], error) {
	return Request[LoginResult](ctx, s.client, "POST", "/api/v1/auth/login", params)
}

// Register creates a new user account
func (s *AuthService) Register(ctx context.Context, params RegisterParams) (*Response[UserProfile], error) {
	return Request[UserProfile](ctx, s.client, "POST", "/api/v1/auth/register", params)
}

// Profile gets the current user profile
func (s *AuthService) Profile(ctx context.Context) (*Response[UserProfile], error) {
	return Request[UserProfile](ctx, s.client, "GET", "/api/v1/auth/profile", nil)
}

// ListTokens lists API tokens created by the user
func (s *AuthService) ListTokens(ctx context.Context) (*Response[[]APIToken], error) {
	return Request[[]APIToken](ctx, s.client, "GET", "/api/v1/auth/tokens", nil)
}

// CreateToken creates a new API Token
func (s *AuthService) CreateToken(ctx context.Context, params CreateTokenParams) (*Response[APIToken], error) {
	return Request[APIToken](ctx, s.client, "POST", "/api/v1/auth/tokens/create", params)
}

// RevokeToken revokes an API token by ID
func (s *AuthService) RevokeToken(ctx context.Context, tokenID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "POST", "/api/v1/auth/tokens/revoke", map[string]string{
		"tokenId": tokenID,
	})
}

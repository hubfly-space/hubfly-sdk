package hubfly

import "context"

type GithubService struct {
	client *Client
}

func (s *GithubService) GetStatus(ctx context.Context) (*Response[interface{}], error) {
	return Request[interface{}](ctx, s.client, "GET", "/api/v1/github/status", nil)
}

func (s *GithubService) GetRepos(ctx context.Context) (*Response[[]interface{}], error) {
	return Request[[]interface{}](ctx, s.client, "GET", "/api/v1/github/repos", nil)
}

func (s *GithubService) RefreshToken(ctx context.Context) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "GET", "/api/v1/github/refresh-token", nil)
}

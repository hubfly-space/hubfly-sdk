package hubfly

import (
	"context"
	"fmt"
)

type DomainsService struct {
	client *Client
}

func (s *DomainsService) List(ctx context.Context) (*Response[[]Domain], error) {
	return Request[[]Domain](ctx, s.client, "GET", "/api/v1/domains", nil)
}

func (s *DomainsService) Create(ctx context.Context, params CreateDomainParams) (*Response[Domain], error) {
	return Request[Domain](ctx, s.client, "POST", "/api/v1/domains/create", params)
}

func (s *DomainsService) Verify(ctx context.Context, domainID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/domains/%s/verify", domainID)
	return Request[map[string]bool](ctx, s.client, "POST", path, nil)
}

func (s *DomainsService) Remove(ctx context.Context, domainID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/domains/%s/remove", domainID)
	return Request[map[string]bool](ctx, s.client, "POST", path, nil)
}

package hubfly

import (
	"context"
	"fmt"
)

type OrganizationsService struct {
	client *Client
}

func (s *OrganizationsService) List(ctx context.Context) (*Response[[]Organization], error) {
	return Request[[]Organization](ctx, s.client, "GET", "/api/v1/organizations", nil)
}

func (s *OrganizationsService) Get(ctx context.Context, orgID string) (*Response[Organization], error) {
	path := fmt.Sprintf("/api/v1/organizations/%s", orgID)
	return Request[Organization](ctx, s.client, "GET", path, nil)
}

func (s *OrganizationsService) Create(ctx context.Context, name string) (*Response[Organization], error) {
	return Request[Organization](ctx, s.client, "POST", "/api/v1/organizations", map[string]string{
		"name": name,
	})
}

func (s *OrganizationsService) ListMembers(ctx context.Context, orgID string) (*Response[[]OrgMember], error) {
	path := fmt.Sprintf("/api/v1/organizations/%s/members", orgID)
	return Request[[]OrgMember](ctx, s.client, "GET", path, nil)
}

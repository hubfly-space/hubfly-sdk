package hubfly

import "context"

type TemplatesService struct {
	client *Client
}

// List returns all available application templates
func (s *TemplatesService) List(ctx context.Context) (*Response[[]Template], error) {
	return Request[[]Template](ctx, s.client, "GET", "/api/v1/templates", nil)
}

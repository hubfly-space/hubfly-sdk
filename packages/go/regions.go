package hubfly

import "context"

type RegionsService struct {
	client *Client
}

// List returns all available regions
func (s *RegionsService) List(ctx context.Context) (*Response[[]Region], error) {
	return Request[[]Region](ctx, s.client, "GET", "/api/v1/regions", nil)
}

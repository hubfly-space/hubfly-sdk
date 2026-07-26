package hubfly

import "context"

type MarketplaceService struct {
	client *Client
}

func (s *MarketplaceService) GetTemplates(ctx context.Context) (*Response[[]interface{}], error) {
	return Request[[]interface{}](ctx, s.client, "GET", "/api/v1/marketplace/templates", nil)
}

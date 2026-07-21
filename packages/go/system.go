package hubfly

import "context"

type SystemService struct {
	client *Client
}

func (s *SystemService) Health(ctx context.Context) (*Response[SystemHealth], error) {
	return Request[SystemHealth](ctx, s.client, "GET", "/api/v1/system", nil)
}

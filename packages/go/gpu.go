package hubfly

import "context"

type GpuService struct {
	client *Client
}

func (s *GpuService) List(ctx context.Context) (*Response[[]GpuInstance], error) {
	return Request[[]GpuInstance](ctx, s.client, "GET", "/api/v1/gpu", nil)
}

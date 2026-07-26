package hubfly

import (
	"context"
	"fmt"
)

type CliService struct {
	client *Client
}

func (s *CliService) GetContainerSnapshot(ctx context.Context, containerID string) (*Response[interface{}], error) {
	path := fmt.Sprintf("/api/v1/cli/deploy/containers/%s", containerID)
	return Request[interface{}](ctx, s.client, "GET", path, nil)
}

func (s *CliService) CreateDeploySession(ctx context.Context, body interface{}) (*Response[interface{}], error) {
	return Request[interface{}](ctx, s.client, "POST", "/api/v1/cli/deploy/sessions", body)
}

func (s *CliService) GetDeploySession(ctx context.Context, buildID string) (*Response[interface{}], error) {
	path := fmt.Sprintf("/api/v1/cli/deploy/sessions/%s", buildID)
	return Request[interface{}](ctx, s.client, "GET", path, nil)
}

func (s *CliService) FailDeploySession(ctx context.Context, buildID, reason string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/cli/deploy/sessions/%s/fail", buildID)
	return Request[map[string]bool](ctx, s.client, "POST", path, map[string]string{"reason": reason})
}

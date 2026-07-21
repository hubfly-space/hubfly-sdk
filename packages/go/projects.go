package hubfly

import (
	"context"
	"fmt"
)

type ProjectsService struct {
	client *Client
}

type ContainersService struct {
	client *Client
}

// List returns all projects
func (s *ProjectsService) List(ctx context.Context) (*Response[[]Project], error) {
	return Request[[]Project](ctx, s.client, "GET", "/api/v1/projects", nil)
}

// Get returns project details by ID
func (s *ProjectsService) Get(ctx context.Context, projectID string) (*Response[Project], error) {
	path := fmt.Sprintf("/api/v1/projects/%s", projectID)
	return Request[Project](ctx, s.client, "GET", path, nil)
}

// Create creates a new project
func (s *ProjectsService) Create(ctx context.Context, params CreateProjectParams) (*Response[Project], error) {
	return Request[Project](ctx, s.client, "POST", "/api/v1/projects", params)
}

// Delete removes a project
func (s *ProjectsService) Delete(ctx context.Context, projectID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/delete", projectID)
	return Request[map[string]bool](ctx, s.client, "POST", path, nil)
}

// ListVolumes returns all volumes for a project
func (s *ProjectsService) ListVolumes(ctx context.Context, projectID string) (*Response[[]Volume], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/volumes", projectID)
	return Request[[]Volume](ctx, s.client, "GET", path, nil)
}

// CreateVolume provisions a new volume for a project
func (s *ProjectsService) CreateVolume(ctx context.Context, params CreateVolumeParams) (*Response[Volume], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/volumes", params.ProjectID)
	return Request[Volume](ctx, s.client, "POST", path, params)
}

// List returns containers under a project
func (s *ContainersService) List(ctx context.Context, projectID string) (*Response[[]Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers", projectID)
	return Request[[]Container](ctx, s.client, "GET", path, nil)
}

// Get returns container details
func (s *ContainersService) Get(ctx context.Context, projectID, containerID string) (*Response[Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s", projectID, containerID)
	return Request[Container](ctx, s.client, "GET", path, nil)
}

// Create provisions a container under a project
func (s *ContainersService) Create(ctx context.Context, params CreateContainerParams) (*Response[Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers", params.ProjectID)
	return Request[Container](ctx, s.client, "POST", path, params)
}

// Delete removes a container
func (s *ContainersService) Delete(ctx context.Context, projectID, containerID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s", projectID, containerID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

// Restart restarts a container
func (s *ContainersService) Restart(ctx context.Context, projectID, containerID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s/restart", projectID, containerID)
	return Request[map[string]bool](ctx, s.client, "POST", path, nil)
}

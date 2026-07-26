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

type LoadBalancersService struct {
	client *Client
}

type NetworkService struct {
	client *Client
}

type PortsService struct {
	client *Client
}

type RegistryService struct {
	client *Client
}

type SubdomainsService struct {
	client *Client
}

type TeamService struct {
	client *Client
}

type TunnelsService struct {
	client *Client
}

type VolumesService struct {
	client *Client
}

type WebhooksService struct {
	client *Client
}

type HibernationService struct {
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
	return Request[Project](ctx, s.client, "POST", "/api/v1/projects/create", params)
}

// Delete removes a project
func (s *ProjectsService) Delete(ctx context.Context, projectID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/delete", projectID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

// --- Containers ---

func (s *ContainersService) List(ctx context.Context, projectID string) (*Response[[]Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers", projectID)
	return Request[[]Container](ctx, s.client, "GET", path, nil)
}

func (s *ContainersService) Get(ctx context.Context, projectID, containerID string) (*Response[Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s", projectID, containerID)
	return Request[Container](ctx, s.client, "GET", path, nil)
}

func (s *ContainersService) Create(ctx context.Context, params CreateContainerParams) (*Response[Container], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers", params.ProjectID)
	return Request[Container](ctx, s.client, "POST", path, params)
}

func (s *ContainersService) Delete(ctx context.Context, projectID, containerID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s", projectID, containerID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

func (s *ContainersService) Restart(ctx context.Context, projectID, containerID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/containers/%s/restart", projectID, containerID)
	return Request[map[string]bool](ctx, s.client, "POST", path, nil)
}

// --- Load Balancers ---

func (s *LoadBalancersService) List(ctx context.Context, projectID string) (*Response[[]LoadBalancer], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/load-balancers", projectID)
	return Request[[]LoadBalancer](ctx, s.client, "GET", path, nil)
}

func (s *LoadBalancersService) Get(ctx context.Context, projectID, lbID string) (*Response[LoadBalancer], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/load-balancers/%s", projectID, lbID)
	return Request[LoadBalancer](ctx, s.client, "GET", path, nil)
}

func (s *LoadBalancersService) Create(ctx context.Context, params CreateLoadBalancerParams) (*Response[LoadBalancer], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/load-balancers/create", params.ProjectID)
	return Request[LoadBalancer](ctx, s.client, "POST", path, params)
}

func (s *LoadBalancersService) Delete(ctx context.Context, projectID, lbID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/load-balancers/%s/delete", projectID, lbID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

// --- Network ---

func (s *NetworkService) Get(ctx context.Context, projectID string) (*Response[NetworkAccess], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network", projectID)
	return Request[NetworkAccess](ctx, s.client, "GET", path, nil)
}

func (s *NetworkService) GetFirewall(ctx context.Context, projectID string) (*Response[NetworkFirewall], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/firewall", projectID)
	return Request[NetworkFirewall](ctx, s.client, "GET", path, nil)
}

// --- Ports ---

func (s *PortsService) List(ctx context.Context, projectID string) (*Response[[]PortReservation], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/ports", projectID)
	return Request[[]PortReservation](ctx, s.client, "GET", path, nil)
}

func (s *PortsService) Reserve(ctx context.Context, projectID string, params ReservePortParams) (*Response[PortReservation], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/ports/reserve", projectID)
	return Request[PortReservation](ctx, s.client, "POST", path, params)
}

func (s *PortsService) Remove(ctx context.Context, projectID, reservationID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/ports/%s", projectID, reservationID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

// --- Volumes ---

func (s *VolumesService) List(ctx context.Context, projectID string) (*Response[[]Volume], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/volumes", projectID)
	return Request[[]Volume](ctx, s.client, "GET", path, nil)
}

func (s *VolumesService) Create(ctx context.Context, params CreateVolumeParams) (*Response[Volume], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/volumes/create", params.ProjectID)
	return Request[Volume](ctx, s.client, "POST", path, params)
}

func (s *VolumesService) Remove(ctx context.Context, projectID, volumeID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/volumes/%s/remove", projectID, volumeID)
	return Request[map[string]bool](ctx, s.client, "DELETE", path, nil)
}

// --- Hibernation ---

func (s *HibernationService) Hibernate(ctx context.Context, projectID string) (*Response[HibernationStatus], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/hibernation/hibernate", projectID)
	return Request[HibernationStatus](ctx, s.client, "GET", path, nil)
}

func (s *HibernationService) Preview(ctx context.Context, projectID string) (*Response[HibernationPreview], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/hibernation/preview", projectID)
	return Request[HibernationPreview](ctx, s.client, "GET", path, nil)
}

func (s *HibernationService) Restore(ctx context.Context, projectID string) (*Response[HibernationStatus], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/hibernation/restore", projectID)
	return Request[HibernationStatus](ctx, s.client, "GET", path, nil)
}

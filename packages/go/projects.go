package hubfly

import (
	"context"
	"fmt"
	"net/url"
	"time"
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

// ProjectTransfersService gives a project to another HubFly account or an
// organization. The sender previews, gets an emailed code (CreateOTP) and
// creates the offer; the recipient opens the emailed token (GetOffer),
// previews a destination and accepts. The owner changes at the next full hour.
//
// Writes (CreateOTP, Create, Cancel, Accept, Decline and the bundle calls)
// need a signed-in dashboard session: API keys and access tokens get
// 403 MOVE_SESSION_REQUIRED (check with IsAPIErrorCode). Reads accept tokens.
type ProjectTransfersService struct {
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

// History lists the project's transfers and region moves, newest first.
func (s *ProjectsService) History(ctx context.Context, projectID string) (*Response[ProjectHistory], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/history", url.PathEscape(projectID))
	return Request[ProjectHistory](ctx, s.client, "GET", path, nil)
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

func (s *NetworkService) ListChallengeRoutes(ctx context.Context, projectID string) (*Response[struct {
	Routes []ChallengeRoute `json:"routes"`
}], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/routes", projectID)
	return Request[struct {
		Routes []ChallengeRoute `json:"routes"`
	}](ctx, s.client, "GET", path, nil)
}

func (s *NetworkService) GetChallengePolicy(ctx context.Context, projectID, routeType, routeID string) (*Response[struct {
	Policy *RouteChallengePolicy `json:"policy"`
}], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge?routeType=%s&routeId=%s", projectID, url.QueryEscape(routeType), url.QueryEscape(routeID))
	return Request[struct {
		Policy *RouteChallengePolicy `json:"policy"`
	}](ctx, s.client, "GET", path, nil)
}

func (s *NetworkService) UpdateChallengePolicy(ctx context.Context, projectID, routeType, routeID string, config UpdateChallengePolicyParams) (*Response[RouteChallengePolicy], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/update", projectID)
	return Request[RouteChallengePolicy](ctx, s.client, "PUT", path, map[string]any{"routeType": routeType, "routeId": routeID, "config": config})
}

func (s *NetworkService) CreateChallengeBypassKey(ctx context.Context, projectID, policyID, name string, allowedPaths []string, expiresAt *time.Time) (*Response[CreatedChallengeBypassKey], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/keys/create", projectID)
	return Request[CreatedChallengeBypassKey](ctx, s.client, "POST", path, map[string]any{"policyId": policyID, "name": name, "allowedPaths": allowedPaths, "expiresAt": expiresAt})
}

func (s *NetworkService) RevokeChallengeBypassKey(ctx context.Context, projectID, policyID, keyID string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/keys/revoke", projectID)
	return Request[map[string]bool](ctx, s.client, "POST", path, map[string]string{"policyId": policyID, "keyId": keyID})
}

func (s *NetworkService) RetryChallengePolicy(ctx context.Context, projectID, policyID string) (*Response[RouteChallengePolicy], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/retry", projectID)
	return Request[RouteChallengePolicy](ctx, s.client, "POST", path, map[string]string{"policyId": policyID})
}

func (s *NetworkService) GetChallengeAnalytics(ctx context.Context, projectID, domain, window string) (*Response[ChallengeAnalytics], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/network/challenge/analytics?domain=%s&range=%s", projectID, url.QueryEscape(domain), url.QueryEscape(window))
	return Request[ChallengeAnalytics](ctx, s.client, "GET", path, nil)
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
	return Request[HibernationStatus](ctx, s.client, "POST", path, nil)
}

func (s *HibernationService) Preview(ctx context.Context, projectID string) (*Response[HibernationPreview], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/hibernation/preview", projectID)
	return Request[HibernationPreview](ctx, s.client, "GET", path, nil)
}

func (s *HibernationService) Restore(ctx context.Context, projectID string) (*Response[HibernationStatus], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/hibernation/restore", projectID)
	return Request[HibernationStatus](ctx, s.client, "POST", path, nil)
}

// --- Project transfers ---

// TransferBundleConfirmText is the text a bundle transfer must be confirmed
// with: "TRANSFER <n> PROJECTS".
func TransferBundleConfirmText(projectCount int) string {
	return fmt.Sprintf("TRANSFER %d PROJECTS", projectCount)
}

// Get returns the project's open transfer, or its latest one; Data is nil
// when the project never had one.
func (s *ProjectTransfersService) Get(ctx context.Context, projectID string) (*Response[*ProjectTransferView], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/transfer", url.PathEscape(projectID))
	return Request[*ProjectTransferView](ctx, s.client, "GET", path, nil)
}

// Preview shows what a transfer would move and revoke, and what blocks it (sender only).
func (s *ProjectTransfersService) Preview(ctx context.Context, projectID string) (*Response[ProjectTransferPreview], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/transfer/preview", url.PathEscape(projectID))
	return Request[ProjectTransferPreview](ctx, s.client, "GET", path, nil)
}

// CreateOTP emails the sender a confirmation code bound to this project and recipient.
func (s *ProjectTransfersService) CreateOTP(ctx context.Context, projectID, recipientEmail string) (*Response[ProjectTransferOTP], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/transfer/otp/create", url.PathEscape(projectID))
	return Request[ProjectTransferOTP](ctx, s.client, "POST", path, map[string]string{"recipientEmail": recipientEmail})
}

// Create offers the project to an email address. The response is the same
// whether or not the address has a HubFly account.
func (s *ProjectTransfersService) Create(ctx context.Context, projectID string, params CreateProjectTransferParams) (*Response[ProjectTransferView], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/transfer/create", url.PathEscape(projectID))
	return Request[ProjectTransferView](ctx, s.client, "POST", path, params)
}

// Cancel cancels the open offer, or an accepted transfer whose owner change
// has not started. An accepted transfer may still read "accepted" while its
// job rolls back; poll Get.
func (s *ProjectTransfersService) Cancel(ctx context.Context, projectID string) (*Response[ProjectTransferView], error) {
	path := fmt.Sprintf("/api/v1/projects/%s/transfer/cancel", url.PathEscape(projectID))
	return Request[ProjectTransferView](ctx, s.client, "POST", path, struct{}{})
}

// List returns offers waiting for you (without tokens) and transfers you started.
func (s *ProjectTransfersService) List(ctx context.Context) (*Response[ProjectTransferList], error) {
	return Request[ProjectTransferList](ctx, s.client, "GET", "/api/v1/project-transfers", nil)
}

// GetOffer returns the offer behind an emailed token. Unknown tokens, offers
// for another email address and closed offers all answer 404 TRANSFER_NOT_FOUND.
func (s *ProjectTransfersService) GetOffer(ctx context.Context, token string) (*Response[ProjectTransferOfferView], error) {
	path := fmt.Sprintf("/api/v1/project-transfers/%s", url.PathEscape(token))
	return Request[ProjectTransferOfferView](ctx, s.client, "GET", path, nil)
}

// PreviewAcceptance shows what accepting into a destination costs and requires (recipient only).
func (s *ProjectTransfersService) PreviewAcceptance(ctx context.Context, token string, params ProjectTransferDestinationParams) (*Response[ProjectTransferAcceptancePreview], error) {
	query := url.Values{}
	query.Set("destinationType", params.DestinationType)
	if params.DestinationID != "" {
		query.Set("destinationId", params.DestinationID)
	}
	for _, id := range params.TransferIDs {
		query.Add("transferIds", id)
	}
	path := fmt.Sprintf("/api/v1/project-transfers/%s/preview?%s", url.PathEscape(token), query.Encode())
	return Request[ProjectTransferAcceptancePreview](ctx, s.client, "GET", path, nil)
}

// Accept accepts the offer (or part of a bundle) into your account or an organization.
func (s *ProjectTransfersService) Accept(ctx context.Context, token string, params AcceptProjectTransferParams) (*Response[[]ProjectTransferView], error) {
	path := fmt.Sprintf("/api/v1/project-transfers/%s/accept", url.PathEscape(token))
	return Request[[]ProjectTransferView](ctx, s.client, "POST", path, params)
}

// Decline declines every open project of the offer.
func (s *ProjectTransfersService) Decline(ctx context.Context, token string) (*Response[map[string]bool], error) {
	path := fmt.Sprintf("/api/v1/project-transfers/%s/decline", url.PathEscape(token))
	return Request[map[string]bool](ctx, s.client, "POST", path, struct{}{})
}

// CreateBundleOTP emails the sender a code bound to these projects and recipient.
func (s *ProjectTransfersService) CreateBundleOTP(ctx context.Context, params CreateProjectTransferBundleOTPParams) (*Response[ProjectTransferOTP], error) {
	return Request[ProjectTransferOTP](ctx, s.client, "POST", "/api/v1/project-transfers/bundles/otp/create", params)
}

// CreateBundle offers several projects to one address with a single token.
func (s *ProjectTransfersService) CreateBundle(ctx context.Context, params CreateProjectTransferBundleParams) (*Response[ProjectTransferBundle], error) {
	return Request[ProjectTransferBundle](ctx, s.client, "POST", "/api/v1/project-transfers/bundles/create", params)
}

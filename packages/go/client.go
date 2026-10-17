package hubfly

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// APIError represents an error returned by the Hubfly API
type APIError struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	RawPayload string `json:"rawPayload,omitempty"`
	// Code is the machine-readable error code (error.code), e.g. "MANAGED_REALTIME_ENGINE_UNSUPPORTED".
	Code string `json:"code,omitempty"`
	// Details holds extra error details the API chose to expose (error.details).
	Details json.RawMessage `json:"details,omitempty"`
	// ErrorID identifies a 5xx error on the server; quote it when contacting support.
	ErrorID string `json:"errorId,omitempty"`
	// RequestID is the request id from the error envelope's meta.
	RequestID string `json:"requestId,omitempty"`
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("hubfly api error [HTTP %d %s]: %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("hubfly api error [HTTP %d]: %s", e.StatusCode, e.Message)
}

// IsAPIErrorCode reports whether err is (or wraps) an *APIError with the given code.
func IsAPIErrorCode(err error, code string) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Code == code
}

// parseAPIError reads an error envelope: {"ok":false,"error":"text"} or
// {"ok":false,"error":{"code","message","details","errorId"},"meta":{"requestId"}}.
func parseAPIError(statusCode int, body []byte) *APIError {
	apiErr := &APIError{StatusCode: statusCode, RawPayload: string(body)}
	var envelope struct {
		Error json.RawMessage `json:"error"`
		Meta  Meta            `json:"meta"`
	}
	if json.Unmarshal(body, &envelope) == nil {
		apiErr.RequestID = envelope.Meta.RequestID
		var text string
		var payload struct {
			Code    string          `json:"code"`
			Message string          `json:"message"`
			Details json.RawMessage `json:"details"`
			ErrorID string          `json:"errorId"`
		}
		if json.Unmarshal(envelope.Error, &text) == nil {
			apiErr.Message = text
		} else if json.Unmarshal(envelope.Error, &payload) == nil {
			apiErr.Message = payload.Message
			apiErr.Code = payload.Code
			apiErr.Details = payload.Details
			apiErr.ErrorID = payload.ErrorID
		}
	}
	if apiErr.Message == "" {
		apiErr.Message = http.StatusText(statusCode)
	}
	return apiErr
}

// Option configures a Client
type Option func(*Client)

// WithToken sets the Bearer token for authentication
func WithToken(token string) Option {
	return func(c *Client) {
		c.token = token
	}
}

// WithSubaccount routes resource requests to a specific sub-account when using a platform key.
func WithSubaccount(subaccountID string) Option {
	return func(c *Client) { c.subaccountID = subaccountID }
}

// WithBaseURL overrides the default API base URL
func WithBaseURL(url string) Option {
	return func(c *Client) {
		c.baseURL = strings.TrimRight(url, "/")
	}
}

// WithHTTPClient specifies a custom http.Client
func WithHTTPClient(httpClient *http.Client) Option {
	return func(c *Client) {
		c.httpClient = httpClient
	}
}

// WithTimeout sets custom HTTP request timeout
func WithTimeout(timeout time.Duration) Option {
	return func(c *Client) {
		c.httpClient.Timeout = timeout
	}
}

// Client is the primary Hubfly API Client
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
	subaccountID string

	// Services
	Auth          *AuthService
	Projects      *ProjectsService
	Containers    *ContainersService
	Organizations *OrganizationsService
	Subaccounts   *SubaccountsService
	PlatformKeys  *PlatformKeysService
	Domains       *DomainsService
	Gpu           *GpuService
	System        *SystemService
	Regions       *RegionsService
	Templates     *TemplatesService
	LoadBalancers *LoadBalancersService
	Network       *NetworkService
	Ports         *PortsService
	Registry      *RegistryService
	Subdomains    *SubdomainsService
	Team          *TeamService
	Tunnels       *TunnelsService
	Volumes       *VolumesService
	Webhooks      *WebhooksService
	Hibernation   *HibernationService
	Cli           *CliService
	Github        *GithubService
	Marketplace   *MarketplaceService
	Courses       *CoursesService
	// Managed holds the Managed Services (databases and realtime servers):
	// Managed.Instances, Managed.Databases and Managed.Realtime.
	Managed *ManagedService
}

// NewClient initializes a new Hubfly API Client
func NewClient(opts ...Option) *Client {
	c := &Client{
		baseURL: "https://api.hubfly.space",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	// Read token from environment variable if set
	if envToken := os.Getenv("HUBFLY_TOKEN"); envToken != "" {
		c.token = envToken
	}

	for _, opt := range opts {
		opt(c)
	}

	// Wire up Services
	c.Auth = &AuthService{client: c}
	c.Projects = &ProjectsService{client: c}
	c.Containers = &ContainersService{client: c}
	c.Organizations = &OrganizationsService{client: c}
	c.Subaccounts = &SubaccountsService{client: c}
	c.PlatformKeys = &PlatformKeysService{client: c}
	c.Domains = &DomainsService{client: c}
	c.Gpu = &GpuService{client: c}
	c.System = &SystemService{client: c}
	c.Regions = &RegionsService{client: c}
	c.Templates = &TemplatesService{client: c}
	c.LoadBalancers = &LoadBalancersService{client: c}
	c.Network = &NetworkService{client: c}
	c.Ports = &PortsService{client: c}
	c.Registry = &RegistryService{client: c}
	c.Subdomains = &SubdomainsService{client: c}
	c.Team = &TeamService{client: c}
	c.Tunnels = &TunnelsService{client: c}
	c.Volumes = &VolumesService{client: c}
	c.Webhooks = &WebhooksService{client: c}
	c.Hibernation = &HibernationService{client: c}
	c.Cli = &CliService{client: c}
	c.Github = &GithubService{client: c}
	c.Marketplace = &MarketplaceService{client: c}
	c.Courses = &CoursesService{client: c}
	c.Managed = newManagedService(c)

	return c
}

// Request executes an HTTP request and decodes the JSON response
func Request[T any](ctx context.Context, c *Client, method, path string, body interface{}) (*Response[T], error) {
	url := fmt.Sprintf("%s%s", c.baseURL, path)

	var bodyReader io.Reader
	if body != nil {
		jsonBytes, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewBuffer(jsonBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.token))
	}
	if c.subaccountID != "" {
		req.Header.Set("X-HubFly-Subaccount", c.subaccountID)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, parseAPIError(resp.StatusCode, respBytes)
	}

	var result Response[T]
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON response: %w", err)
	}

	return &result, nil
}

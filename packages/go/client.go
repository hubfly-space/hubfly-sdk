package hubfly

import (
	"bytes"
	"context"
	"encoding/json"
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
}

func (e *APIError) Error() string {
	return fmt.Sprintf("hubfly api error [HTTP %d]: %s", e.StatusCode, e.Message)
}

// Option configures a Client
type Option func(*Client)

// WithToken sets the Bearer token for authentication
func WithToken(token string) Option {
	return func(c *Client) {
		c.token = token
	}
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

	// Services
	Auth          *AuthService
	Projects      *ProjectsService
	Containers    *ContainersService
	Organizations *OrganizationsService
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
		var errResp ErrorResponse
		_ = json.Unmarshal(respBytes, &errResp)
		errMsg := errResp.Error
		if errMsg == "" {
			errMsg = http.StatusText(resp.StatusCode)
		}
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    errMsg,
			RawPayload: string(respBytes),
		}
	}

	var result Response[T]
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON response: %w", err)
	}

	return &result, nil
}

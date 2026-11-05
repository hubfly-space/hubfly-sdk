package hubfly

// Web Analytics of the Dashboard API: sites, reports, goals, funnels,
// segments, shared dashboards and ingest keys.
//
// Every request and response type comes from analytics_types.go, which
// scripts/generate-managed.ts generates from the Dashboard's openapi.json.
// Reading sites, reports, exports and usage needs project:read; every change
// needs project:edit, and sites on HubFly domains (Source "hubfly_route") also
// need network:manage. The monthly event cap needs billing:manage. Browsers
// send events with the @hubfly/analytics tracker, not this package.

import (
	"context"
	"encoding/json"
	"fmt"
)

// Error codes of the Web Analytics API worth branching on (APIError.Code);
// see IsAPIErrorCode.
const (
	// ErrCodeAnalyticsUnavailable (409): new sites cannot be created in the
	// region now; the error details carry the reason (disabled,
	// billing_not_live, region_unavailable, scheduler_not_ready).
	ErrCodeAnalyticsUnavailable = "ANALYTICS_UNAVAILABLE"
	// ErrCodeAnalyticsDomainUnverified (409): an external site's domain is not
	// covered by a verified custom domain; verify it with VerifyDomain.
	ErrCodeAnalyticsDomainUnverified = "ANALYTICS_DOMAIN_UNVERIFIED"
	// ErrCodeAnalyticsDomainTaken (409): another live site tracks the domain.
	ErrCodeAnalyticsDomainTaken = "ANALYTICS_DOMAIN_TAKEN"
	// ErrCodeAnalyticsSiteLimit (409): the project or owner reached its site limit.
	ErrCodeAnalyticsSiteLimit = "ANALYTICS_SITE_LIMIT"
	// ErrCodeAnalyticsSiteNotFound (404): no such site in the project.
	ErrCodeAnalyticsSiteNotFound = "ANALYTICS_SITE_NOT_FOUND"
	// ErrCodeAnalyticsRetentionRequiresBalance (402): raising retention needs a positive balance.
	ErrCodeAnalyticsRetentionRequiresBalance = "ANALYTICS_RETENTION_REQUIRES_BALANCE"
	// ErrCodeAnalyticsInvalidQuery (400): unknown dimension, metric or filter.
	ErrCodeAnalyticsInvalidQuery = "ANALYTICS_INVALID_QUERY"
	// ErrCodeAnalyticsQueryTimeout (504): narrow the range or raise TimeoutMs.
	ErrCodeAnalyticsQueryTimeout = "ANALYTICS_QUERY_TIMEOUT"
	// ErrCodeAnalyticsQueryTooLarge (422): the query would read too much data.
	ErrCodeAnalyticsQueryTooLarge = "ANALYTICS_QUERY_TOO_LARGE"
	// ErrCodeAnalyticsUnreachable (503): the site's region cannot be reached right now.
	ErrCodeAnalyticsUnreachable = "ANALYTICS_UNREACHABLE"
	// ErrCodeAnalyticsShareLocked (401): the shared dashboard needs an unlock token.
	ErrCodeAnalyticsShareLocked = "ANALYTICS_SHARE_LOCKED"
)

// AnalyticsService is the entry point of Web Analytics (client.Analytics).
type AnalyticsService struct {
	client *Client

	// Sites manages sites, their reports and exports.
	Sites *AnalyticsSitesService
	// Goals manages conversion goals.
	Goals *AnalyticsGoalsService
	// Funnels manages saved funnels.
	Funnels *AnalyticsFunnelsService
	// Segments manages saved segments (filter sets).
	Segments *AnalyticsSegmentsService
	// Shares manages shared dashboard links.
	Shares *AnalyticsSharesService
	// Keys manages ingest keys for the server-side events API.
	Keys *AnalyticsKeysService
	// Shared reads public shared dashboards by slug (no sign-in needed).
	Shared *AnalyticsSharedService
}

func newAnalyticsService(c *Client) *AnalyticsService {
	return &AnalyticsService{
		client:   c,
		Sites:    &AnalyticsSitesService{client: c},
		Goals:    &AnalyticsGoalsService{client: c},
		Funnels:  &AnalyticsFunnelsService{client: c},
		Segments: &AnalyticsSegmentsService{client: c},
		Shares:   &AnalyticsSharesService{client: c},
		Keys:     &AnalyticsKeysService{client: c},
		Shared:   &AnalyticsSharedService{client: c},
	}
}

// Regions returns the regions where Web Analytics can be used (any signed-in user).
func (s *AnalyticsService) Regions(ctx context.Context) (*Response[GetAnalyticsRegionsResponse], error) {
	return getAnalyticsRegions(ctx, s.client)
}

// Get returns the project's analytics: availability in its region, monthly
// event cap, every site with its install snippet, and what the caller may
// change (project:read).
func (s *AnalyticsService) Get(ctx context.Context, projectID string) (*Response[GetProjectAnalyticsResponse], error) {
	return getProjectAnalytics(ctx, s.client, projectID)
}

// SetEventCap sets the project's monthly event cap, or clears it with nil
// (billing:manage). The cap stops every event, free ones included.
func (s *AnalyticsService) SetEventCap(ctx context.Context, projectID string, monthlyEventCap *float64) (*Response[UpdateProjectAnalyticsResponse], error) {
	return updateProjectAnalytics(ctx, s.client, projectID, UpdateProjectAnalyticsBody{MonthlyEventCap: monthlyEventCap})
}

// Usage returns this month's events, allowance, collection state and (with
// billing:view) cost (project:read).
func (s *AnalyticsService) Usage(ctx context.Context, projectID string) (*Response[GetProjectAnalyticsUsageResponse], error) {
	return getProjectAnalyticsUsage(ctx, s.client, projectID)
}

// Routes lists the domains the project serves through HubFly that a
// hubfly_route site can track (project:read).
func (s *AnalyticsService) Routes(ctx context.Context, projectID string) (*Response[ListProjectAnalyticsRoutesResponse], error) {
	return listProjectAnalyticsRoutes(ctx, s.client, projectID)
}

// VerifyDomain starts or checks the TXT verification of a domain for external
// sites (project:edit). While Status is "pending", publish TxtValue at TxtHost
// and call again. A verified domain covers its subdomains.
func (s *AnalyticsService) VerifyDomain(ctx context.Context, projectID, domain string) (*Response[VerifyProjectAnalyticsDomainResponse], error) {
	return verifyProjectAnalyticsDomain(ctx, s.client, projectID, VerifyProjectAnalyticsDomainBody{Domain: domain})
}

// AnalyticsSitesService manages sites, reports and exports: client.Analytics.Sites.
type AnalyticsSitesService struct{ client *Client }

// List returns the project's sites (project:read).
func (s *AnalyticsSitesService) List(ctx context.Context, projectID string) ([]AnalyticsSite, error) {
	resp, err := getProjectAnalytics(ctx, s.client, projectID)
	if err != nil {
		return nil, err
	}
	return resp.Data.Sites, nil
}

// Create creates a site (project:edit). Source "external" tracks any website
// whose Domain/Domains are verified custom domains of the caller;
// "hubfly_route" tracks a domain the project serves (RouteType and RouteID
// from Routes, needs network:manage) and can inject the script. The response
// carries Install.Snippet.
func (s *AnalyticsSitesService) Create(ctx context.Context, projectID string, body CreateProjectAnalyticsSiteBody) (*Response[CreateProjectAnalyticsSiteResponse], error) {
	return createProjectAnalyticsSite(ctx, s.client, projectID, body)
}

// Get returns one site with its settings, sync state and install snippet (project:read).
func (s *AnalyticsSitesService) Get(ctx context.Context, projectID, siteID string) (*Response[GetProjectAnalyticsSiteResponse], error) {
	return getProjectAnalyticsSite(ctx, s.client, projectID, siteID)
}

// Update changes a site (project:edit). Only the fields set change; Settings merges.
func (s *AnalyticsSitesService) Update(ctx context.Context, projectID, siteID string, body UpdateProjectAnalyticsSiteBody) (*Response[UpdateProjectAnalyticsSiteResponse], error) {
	return updateProjectAnalyticsSite(ctx, s.client, projectID, siteID, body)
}

// Pause stops collecting while keeping the data (project:edit).
func (s *AnalyticsSitesService) Pause(ctx context.Context, projectID, siteID string) (*Response[UpdateProjectAnalyticsSiteResponse], error) {
	return s.Update(ctx, projectID, siteID, UpdateProjectAnalyticsSiteBody{State: "paused"})
}

// Resume collects again (project:edit). Answers 409 ANALYTICS_UNAVAILABLE
// while the region is closed.
func (s *AnalyticsSitesService) Resume(ctx context.Context, projectID, siteID string) (*Response[UpdateProjectAnalyticsSiteResponse], error) {
	return s.Update(ctx, projectID, siteID, UpdateProjectAnalyticsSiteBody{State: "active"})
}

// Delete deletes a site and its data (project:edit). Pending is true while
// the region removal is retried.
func (s *AnalyticsSitesService) Delete(ctx context.Context, projectID, siteID string) (*Response[DeleteProjectAnalyticsSiteResponse], error) {
	return deleteProjectAnalyticsSite(ctx, s.client, projectID, siteID)
}

// Status reports whether the tracker is installed (an event arrived), with
// today's events and storage (project:read).
func (s *AnalyticsSitesService) Status(ctx context.Context, projectID, siteID string) (*Response[GetProjectAnalyticsSiteStatusResponse], error) {
	return getProjectAnalyticsSiteStatus(ctx, s.client, projectID, siteID)
}

// Export returns raw events, sessions or daily summaries as CSV or NDJSON, up
// to 8 MB per call (Truncated beyond it); export longer ranges in pieces
// (project:read). From and To are site-local dates.
func (s *AnalyticsSitesService) Export(ctx context.Context, projectID, siteID string, query ExportProjectAnalyticsDataQuery) (*Response[ExportProjectAnalyticsDataResponse], error) {
	return exportProjectAnalyticsData(ctx, s.client, projectID, siteID, query)
}

// Query runs a report (project:read). Type is aggregate, timeseries,
// breakdown (needs Dim), realtime, goals, funnel (Funnel or FunnelID),
// journeys, vitals, errors or props (needs an "event is <name>" filter). The
// site's goals are attached for you; SegmentID applies a saved segment. Read
// Results with the typed accessors of AnalyticsQueryResult.
func (s *AnalyticsSitesService) Query(ctx context.Context, projectID, siteID string, query AnalyticsQuery) (*Response[RunProjectAnalyticsQueryResponse], error) {
	return runProjectAnalyticsQuery(ctx, s.client, projectID, siteID, query)
}

// Realtime returns visitors in the last 5 minutes, the last 30 minutes per
// minute and the latest events (project:read).
func (s *AnalyticsSitesService) Realtime(ctx context.Context, projectID, siteID string) (*Response[RunProjectAnalyticsQueryResponse], error) {
	return s.Query(ctx, projectID, siteID, AnalyticsQuery{Type: "realtime"})
}

// decodeAnalyticsResults decodes Results after checking the report type.
func decodeAnalyticsResults[T any](r AnalyticsQueryResult, want string) (T, error) {
	var out T
	if r.Type != want {
		return out, fmt.Errorf("hubfly: %s report has no %s results", r.Type, want)
	}
	if len(r.Results) == 0 {
		return out, nil
	}
	err := json.Unmarshal(r.Results, &out)
	return out, err
}

// AggregateResults returns the metrics of an aggregate report.
func (r AnalyticsQueryResult) AggregateResults() (map[string]AnalyticsMetricValue, error) {
	return decodeAnalyticsResults[map[string]AnalyticsMetricValue](r, "aggregate")
}

// TimeseriesResults returns the periods of a timeseries report (Comparison
// holds the comparison periods).
func (r AnalyticsQueryResult) TimeseriesResults() ([]AnalyticsTimeseriesPoint, error) {
	return decodeAnalyticsResults[[]AnalyticsTimeseriesPoint](r, "timeseries")
}

// BreakdownResults returns the rows of a breakdown report.
func (r AnalyticsQueryResult) BreakdownResults() ([]AnalyticsBreakdownRow, error) {
	return decodeAnalyticsResults[[]AnalyticsBreakdownRow](r, "breakdown")
}

// GoalsResults returns one row per goal of a goals report.
func (r AnalyticsQueryResult) GoalsResults() ([]AnalyticsGoalRow, error) {
	return decodeAnalyticsResults[[]AnalyticsGoalRow](r, "goals")
}

// VitalsResults returns the rows of a vitals report (Summary holds the totals).
func (r AnalyticsQueryResult) VitalsResults() ([]AnalyticsVitalsRow, error) {
	return decodeAnalyticsResults[[]AnalyticsVitalsRow](r, "vitals")
}

// ErrorsResults returns the error groups of an errors report.
func (r AnalyticsQueryResult) ErrorsResults() ([]AnalyticsErrorGroup, error) {
	return decodeAnalyticsResults[[]AnalyticsErrorGroup](r, "errors")
}

// PropsResults returns the prop keys of a props report.
func (r AnalyticsQueryResult) PropsResults() ([]AnalyticsPropKey, error) {
	return decodeAnalyticsResults[[]AnalyticsPropKey](r, "props")
}

// AnalyticsGoalsService manages conversion goals: client.Analytics.Goals.
// Pageview goals match a path glob; event goals an event name.
type AnalyticsGoalsService struct{ client *Client }

// List returns a site's goals (project:read).
func (s *AnalyticsGoalsService) List(ctx context.Context, projectID, siteID string) (*Response[ListProjectAnalyticsGoalsResponse], error) {
	return listProjectAnalyticsGoals(ctx, s.client, projectID, siteID)
}

// Create creates a goal (project:edit).
func (s *AnalyticsGoalsService) Create(ctx context.Context, projectID, siteID string, body CreateProjectAnalyticsGoalBody) (*Response[CreateProjectAnalyticsGoalResponse], error) {
	return createProjectAnalyticsGoal(ctx, s.client, projectID, siteID, body)
}

// Update replaces a goal (project:edit).
func (s *AnalyticsGoalsService) Update(ctx context.Context, projectID, siteID, goalID string, body UpdateProjectAnalyticsGoalBody) (*Response[UpdateProjectAnalyticsGoalResponse], error) {
	return updateProjectAnalyticsGoal(ctx, s.client, projectID, siteID, goalID, body)
}

// Delete deletes a goal (project:edit).
func (s *AnalyticsGoalsService) Delete(ctx context.Context, projectID, siteID, goalID string) (*Response[DeleteProjectAnalyticsGoalResponse], error) {
	return deleteProjectAnalyticsGoal(ctx, s.client, projectID, siteID, goalID)
}

// AnalyticsFunnelsService manages saved funnels (2–8 steps): client.Analytics.Funnels.
type AnalyticsFunnelsService struct{ client *Client }

// List returns a site's funnels (project:read).
func (s *AnalyticsFunnelsService) List(ctx context.Context, projectID, siteID string) (*Response[ListProjectAnalyticsFunnelsResponse], error) {
	return listProjectAnalyticsFunnels(ctx, s.client, projectID, siteID)
}

// Create creates a funnel (project:edit).
func (s *AnalyticsFunnelsService) Create(ctx context.Context, projectID, siteID string, body CreateProjectAnalyticsFunnelBody) (*Response[CreateProjectAnalyticsFunnelResponse], error) {
	return createProjectAnalyticsFunnel(ctx, s.client, projectID, siteID, body)
}

// Update replaces a funnel (project:edit).
func (s *AnalyticsFunnelsService) Update(ctx context.Context, projectID, siteID, funnelID string, body UpdateProjectAnalyticsFunnelBody) (*Response[UpdateProjectAnalyticsFunnelResponse], error) {
	return updateProjectAnalyticsFunnel(ctx, s.client, projectID, siteID, funnelID, body)
}

// Delete deletes a funnel (project:edit).
func (s *AnalyticsFunnelsService) Delete(ctx context.Context, projectID, siteID, funnelID string) (*Response[DeleteProjectAnalyticsFunnelResponse], error) {
	return deleteProjectAnalyticsFunnel(ctx, s.client, projectID, siteID, funnelID)
}

// AnalyticsSegmentsService manages saved segments: client.Analytics.Segments.
// Use one in a report with SegmentID.
type AnalyticsSegmentsService struct{ client *Client }

// List returns a site's segments (project:read).
func (s *AnalyticsSegmentsService) List(ctx context.Context, projectID, siteID string) (*Response[ListProjectAnalyticsSegmentsResponse], error) {
	return listProjectAnalyticsSegments(ctx, s.client, projectID, siteID)
}

// Create creates a segment (project:edit).
func (s *AnalyticsSegmentsService) Create(ctx context.Context, projectID, siteID string, body CreateProjectAnalyticsSegmentBody) (*Response[CreateProjectAnalyticsSegmentResponse], error) {
	return createProjectAnalyticsSegment(ctx, s.client, projectID, siteID, body)
}

// Delete deletes a segment (project:edit).
func (s *AnalyticsSegmentsService) Delete(ctx context.Context, projectID, siteID, segmentID string) (*Response[DeleteProjectAnalyticsSegmentResponse], error) {
	return deleteProjectAnalyticsSegment(ctx, s.client, projectID, siteID, segmentID)
}

// AnalyticsSharesService manages shared dashboard links:
// client.Analytics.Shares. The slug is the secret: anyone holding the link
// (and its password, if set) can read the site's reports.
type AnalyticsSharesService struct{ client *Client }

// List returns a site's links, revoked ones included (project:read).
func (s *AnalyticsSharesService) List(ctx context.Context, projectID, siteID string) (*Response[ListProjectAnalyticsSharesResponse], error) {
	return listProjectAnalyticsShares(ctx, s.client, projectID, siteID)
}

// Create creates a link, optionally with a password and an expiry (project:edit).
func (s *AnalyticsSharesService) Create(ctx context.Context, projectID, siteID string, body CreateProjectAnalyticsShareBody) (*Response[CreateProjectAnalyticsShareResponse], error) {
	return createProjectAnalyticsShare(ctx, s.client, projectID, siteID, body)
}

// Revoke revokes a link at once (project:edit).
func (s *AnalyticsSharesService) Revoke(ctx context.Context, projectID, siteID, shareID string) (*Response[RevokeProjectAnalyticsShareResponse], error) {
	return revokeProjectAnalyticsShare(ctx, s.client, projectID, siteID, shareID)
}

// AnalyticsKeysService manages ingest keys (hfak_…) for the server-side
// events API: client.Analytics.Keys. HubFly keeps only a hash: the key is
// returned once, by Create.
type AnalyticsKeysService struct{ client *Client }

// List returns a site's keys by prefix (project:read).
func (s *AnalyticsKeysService) List(ctx context.Context, projectID, siteID string) (*Response[ListProjectAnalyticsIngestKeysResponse], error) {
	return listProjectAnalyticsIngestKeys(ctx, s.client, projectID, siteID)
}

// Create creates a key (project:edit). Store Key now: it is never shown again.
func (s *AnalyticsKeysService) Create(ctx context.Context, projectID, siteID, name string) (*Response[CreateProjectAnalyticsIngestKeyResponse], error) {
	return createProjectAnalyticsIngestKey(ctx, s.client, projectID, siteID, CreateProjectAnalyticsIngestKeyBody{Name: name})
}

// Revoke revokes a key (project:edit).
func (s *AnalyticsKeysService) Revoke(ctx context.Context, projectID, siteID, keyID string) (*Response[RevokeProjectAnalyticsIngestKeyResponse], error) {
	return revokeProjectAnalyticsIngestKey(ctx, s.client, projectID, siteID, keyID)
}

// AnalyticsSharedService reads public shared dashboards:
// client.Analytics.Shared. No sign-in is needed; the slug is the credential.
// Password-protected links need the token from Unlock (valid 24 hours).
// Shared dashboards cannot use saved segments or funnels and cannot export.
type AnalyticsSharedService struct{ client *Client }

// Get returns the shared site: name, domain, time zone and whether it is
// locked. token may be empty.
func (s *AnalyticsSharedService) Get(ctx context.Context, slug, token string) (*Response[GetSharedAnalyticsSiteResponse], error) {
	return getSharedAnalyticsSite(ctx, s.client, slug, &GetSharedAnalyticsSiteQuery{Token: token})
}

// Unlock exchanges the link's password for a token.
func (s *AnalyticsSharedService) Unlock(ctx context.Context, slug, password string) (*Response[UnlockSharedAnalyticsResponse], error) {
	return unlockSharedAnalytics(ctx, s.client, slug, UnlockSharedAnalyticsBody{Password: password})
}

// Query runs a report on a shared dashboard; set Token for a protected link.
func (s *AnalyticsSharedService) Query(ctx context.Context, slug string, query RunSharedAnalyticsQueryBody) (*Response[RunSharedAnalyticsQueryResponse], error) {
	return runSharedAnalyticsQuery(ctx, s.client, slug, query)
}

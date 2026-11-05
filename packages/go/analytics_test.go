package hubfly

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

const tS = "site_1"

// analyticsCalls makes one call per operation and names the operationId it must hit.
func analyticsCalls(c *Client) []struct {
	id   string
	call func(ctx context.Context) error
} {
	a := c.Analytics
	type call = struct {
		id   string
		call func(ctx context.Context) error
	}
	return []call{
		{"getAnalyticsRegions", func(ctx context.Context) error { return errOf(a.Regions(ctx)) }},
		{"getProjectAnalytics", func(ctx context.Context) error { return errOf(a.Get(ctx, tP)) }},
		{"updateProjectAnalytics", func(ctx context.Context) error { return errOf(a.SetEventCap(ctx, tP, Float(5e6))) }},
		{"getProjectAnalyticsUsage", func(ctx context.Context) error { return errOf(a.Usage(ctx, tP)) }},
		{"listProjectAnalyticsRoutes", func(ctx context.Context) error { return errOf(a.Routes(ctx, tP)) }},
		{"verifyProjectAnalyticsDomain", func(ctx context.Context) error { return errOf(a.VerifyDomain(ctx, tP, "example.com")) }},
		{"createProjectAnalyticsSite", func(ctx context.Context) error {
			return errOf(a.Sites.Create(ctx, tP, CreateProjectAnalyticsSiteBody{Source: "external", Domain: "example.com"}))
		}},
		{"getProjectAnalyticsSite", func(ctx context.Context) error { return errOf(a.Sites.Get(ctx, tP, tS)) }},
		{"updateProjectAnalyticsSite", func(ctx context.Context) error {
			return errOf(a.Sites.Update(ctx, tP, tS, UpdateProjectAnalyticsSiteBody{RetentionDays: Float(90)}))
		}},
		{"deleteProjectAnalyticsSite", func(ctx context.Context) error { return errOf(a.Sites.Delete(ctx, tP, tS)) }},
		{"getProjectAnalyticsSiteStatus", func(ctx context.Context) error { return errOf(a.Sites.Status(ctx, tP, tS)) }},
		{"exportProjectAnalyticsData", func(ctx context.Context) error {
			return errOf(a.Sites.Export(ctx, tP, tS, ExportProjectAnalyticsDataQuery{From: "2026-10-01", To: "2026-10-28"}))
		}},
		{"runProjectAnalyticsQuery", func(ctx context.Context) error {
			return errOf(a.Sites.Query(ctx, tP, tS, AnalyticsQuery{Type: "aggregate", Range: &AnalyticsRangeInput{Period: "30d"}}))
		}},
		{"listProjectAnalyticsGoals", func(ctx context.Context) error { return errOf(a.Goals.List(ctx, tP, tS)) }},
		{"createProjectAnalyticsGoal", func(ctx context.Context) error {
			return errOf(a.Goals.Create(ctx, tP, tS, CreateProjectAnalyticsGoalBody{Name: "Signup", Kind: "event", Match: "Signup"}))
		}},
		{"updateProjectAnalyticsGoal", func(ctx context.Context) error {
			return errOf(a.Goals.Update(ctx, tP, tS, "gl_1", UpdateProjectAnalyticsGoalBody{Name: "Thanks", Kind: "pageview", Match: "/thanks/**"}))
		}},
		{"deleteProjectAnalyticsGoal", func(ctx context.Context) error { return errOf(a.Goals.Delete(ctx, tP, tS, "gl_1")) }},
		{"listProjectAnalyticsFunnels", func(ctx context.Context) error { return errOf(a.Funnels.List(ctx, tP, tS)) }},
		{"createProjectAnalyticsFunnel", func(ctx context.Context) error {
			return errOf(a.Funnels.Create(ctx, tP, tS, CreateProjectAnalyticsFunnelBody{Name: "Checkout", Steps: []AnalyticsFunnelStepInput{
				{Kind: "pageview", Match: "/cart", Label: "Cart"}, {Kind: "event", Match: "Purchase", Label: "Paid"},
			}}))
		}},
		{"updateProjectAnalyticsFunnel", func(ctx context.Context) error {
			return errOf(a.Funnels.Update(ctx, tP, tS, "fn_1", UpdateProjectAnalyticsFunnelBody{Name: "Checkout", WindowMinutes: Float(60)}))
		}},
		{"deleteProjectAnalyticsFunnel", func(ctx context.Context) error { return errOf(a.Funnels.Delete(ctx, tP, tS, "fn_1")) }},
		{"listProjectAnalyticsSegments", func(ctx context.Context) error { return errOf(a.Segments.List(ctx, tP, tS)) }},
		{"createProjectAnalyticsSegment", func(ctx context.Context) error {
			return errOf(a.Segments.Create(ctx, tP, tS, CreateProjectAnalyticsSegmentBody{Name: "DE", Filters: []AnalyticsFilterInput{{Dim: "country", Op: "is", Values: []string{"DE"}}}}))
		}},
		{"deleteProjectAnalyticsSegment", func(ctx context.Context) error { return errOf(a.Segments.Delete(ctx, tP, tS, "sg_1")) }},
		{"listProjectAnalyticsShares", func(ctx context.Context) error { return errOf(a.Shares.List(ctx, tP, tS)) }},
		{"createProjectAnalyticsShare", func(ctx context.Context) error {
			return errOf(a.Shares.Create(ctx, tP, tS, CreateProjectAnalyticsShareBody{}))
		}},
		{"revokeProjectAnalyticsShare", func(ctx context.Context) error { return errOf(a.Shares.Revoke(ctx, tP, tS, "sh_1")) }},
		{"listProjectAnalyticsIngestKeys", func(ctx context.Context) error { return errOf(a.Keys.List(ctx, tP, tS)) }},
		{"createProjectAnalyticsIngestKey", func(ctx context.Context) error { return errOf(a.Keys.Create(ctx, tP, tS, "backend")) }},
		{"revokeProjectAnalyticsIngestKey", func(ctx context.Context) error { return errOf(a.Keys.Revoke(ctx, tP, tS, "key_1")) }},
		{"getSharedAnalyticsSite", func(ctx context.Context) error { return errOf(a.Shared.Get(ctx, "slug_1", "")) }},
		{"unlockSharedAnalytics", func(ctx context.Context) error { return errOf(a.Shared.Unlock(ctx, "slug_1", "pw")) }},
		{"runSharedAnalyticsQuery", func(ctx context.Context) error {
			return errOf(a.Shared.Query(ctx, "slug_1", RunSharedAnalyticsQueryBody{Type: "realtime"}))
		}},
	}
}

func TestAnalyticsCoversEveryOperation(t *testing.T) {
	// List routes answer arrays: a null data fits every response type.
	fake, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 200, `{"ok":true,"data":null,"meta":{"requestId":"req_1","timestamp":"t"}}`
	})
	ctx := context.Background()
	ops := map[string]managedOperation{}
	for _, op := range analyticsOperations {
		ops[op.ID] = op
	}
	seen := map[string]bool{}
	for _, c := range analyticsCalls(client) {
		op, ok := ops[c.id]
		if !ok {
			t.Fatalf("%s is not an analytics operation", c.id)
		}
		if seen[c.id] {
			t.Fatalf("%s called twice", c.id)
		}
		seen[c.id] = true
		before := len(fake.all())
		if err := c.call(ctx); err != nil {
			t.Fatalf("%s: %v", c.id, err)
		}
		reqs := fake.all()
		if len(reqs) != before+1 {
			t.Fatalf("%s: %d requests, want 1", c.id, len(reqs)-before)
		}
		req := reqs[before]
		if req.Method != op.Method || !pathPattern(op.Path).MatchString(req.Path) {
			t.Errorf("%s: got %s %s, want %s %s", c.id, req.Method, req.Path, op.Method, op.Path)
		}
		if op.Method == "GET" || op.Method == "DELETE" {
			if req.Body != "" {
				t.Errorf("%s: unexpected body %q", c.id, req.Body)
			}
		} else if !strings.HasPrefix(req.Body, "{") {
			t.Errorf("%s: body %q is not a JSON object", c.id, req.Body)
		}
	}
	var missing []string
	for id := range ops {
		if !seen[id] {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("operations without a method: %v", missing)
	}
}

func TestAnalyticsRequestEncoding(t *testing.T) {
	fake, client := newFakeManagedAPI(t, nil)
	ctx := context.Background()
	a := client.Analytics

	if _, err := a.Goals.Delete(ctx, tP, "site/1", "gl 1"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SetEventCap(ctx, tP, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Sites.Pause(ctx, tP, tS); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Sites.Export(ctx, tP, tS, ExportProjectAnalyticsDataQuery{From: "2026-10-01", To: "2026-10-07", Format: "ndjson"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Shared.Get(ctx, "slug_1", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Sites.Query(ctx, tP, tS, AnalyticsQuery{Type: "breakdown", Dim: "page", Limit: Float(10), Filters: []AnalyticsFilterInput{{Dim: "country", Op: "is", Values: []string{"DE"}}}}); err != nil {
		t.Fatal(err)
	}

	reqs := fake.all()
	if got, want := reqs[0].Path, "/api/v1/projects/proj_1/analytics/sites/site%2F1/goals/gl%201/delete"; got != want {
		t.Errorf("path = %s, want %s", got, want)
	}
	if reqs[1].Body != `{"monthlyEventCap":null}` {
		t.Errorf("event cap body = %s", reqs[1].Body)
	}
	if reqs[2].Method != "PUT" || reqs[2].Body != `{"state":"paused"}` {
		t.Errorf("pause = %s %s", reqs[2].Method, reqs[2].Body)
	}
	if q := reqs[3].Query; q["from"][0] != "2026-10-01" || q["to"][0] != "2026-10-07" || q["format"][0] != "ndjson" || q["kind"] != nil {
		t.Errorf("export query = %v", q)
	}
	if len(reqs[4].Query) != 0 {
		t.Errorf("shared query = %v, want none", reqs[4].Query)
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(reqs[5].Body), &body); err != nil {
		t.Fatal(err)
	}
	if body["type"] != "breakdown" || body["dim"] != "page" || body["limit"] != 10.0 || body["range"] != nil {
		t.Errorf("query body = %s", reqs[5].Body)
	}
}

func TestAnalyticsQueryResults(t *testing.T) {
	payloads := map[string]string{
		"aggregate":  `{"type":"aggregate","results":{"visitors":{"value":1234,"comparisonValue":1100,"change":12.2}},"meta":{"partial":false}}`,
		"breakdown":  `{"type":"breakdown","results":[{"value":"/pricing","values":{"visitors":120}}],"meta":{"totalValues":512}}`,
		"timeseries": `{"type":"timeseries","results":[{"date":"2026-10-01","values":{"visitors":10}}],"comparison":[],"meta":{"interval":"day"}}`,
		"realtime":   `{"type":"realtime","visitors":12,"pageviews":140,"perMinute":[],"topPages":[{"value":"/","visitors":5}],"topSources":[],"topCountries":[],"recent":[]}`,
	}
	_, client := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		var body struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal([]byte(r.Body), &body)
		return 200, `{"ok":true,"data":` + payloads[body.Type] + `,"meta":{"requestId":"req_1","timestamp":"t"}}`
	})
	ctx := context.Background()
	sites := client.Analytics.Sites

	agg, err := sites.Query(ctx, tP, tS, AnalyticsQuery{Type: "aggregate"})
	if err != nil {
		t.Fatal(err)
	}
	metrics, err := agg.Data.AggregateResults()
	if err != nil || metrics["visitors"].Value != 1234.0 || *metrics["visitors"].Change != 12.2 {
		t.Errorf("aggregate = %+v, %v", metrics, err)
	}
	if _, err := agg.Data.BreakdownResults(); err == nil {
		t.Error("BreakdownResults of an aggregate report: want an error")
	}

	breakdown, err := sites.Query(ctx, tP, tS, AnalyticsQuery{Type: "breakdown", Dim: "page"})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := breakdown.Data.BreakdownResults()
	if err != nil || len(rows) != 1 || rows[0].Value != "/pricing" || rows[0].Values["visitors"] != 120.0 || *breakdown.Data.Meta.TotalValues != 512 {
		t.Errorf("breakdown = %+v, %v", rows, err)
	}

	series, err := sites.Query(ctx, tP, tS, AnalyticsQuery{Type: "timeseries"})
	if err != nil {
		t.Fatal(err)
	}
	points, err := series.Data.TimeseriesResults()
	if err != nil || len(points) != 1 || points[0].Date != "2026-10-01" {
		t.Errorf("timeseries = %+v, %v", points, err)
	}

	live, err := sites.Realtime(ctx, tP, tS)
	if err != nil {
		t.Fatal(err)
	}
	if live.Data.Visitors != 12 || len(live.Data.TopPages) != 1 || live.Data.TopPages[0].Value != "/" {
		t.Errorf("realtime = %+v", live.Data)
	}
}

func TestAnalyticsErrors(t *testing.T) {
	_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 409, `{"ok":false,"error":{"code":"ANALYTICS_UNAVAILABLE","message":"Web Analytics is not open yet.","details":{"reason":"disabled"}}}`
	})
	_, err := client.Analytics.Sites.Create(context.Background(), tP, CreateProjectAnalyticsSiteBody{Source: "external", Domain: "example.com"})
	if !IsAPIErrorCode(err, ErrCodeAnalyticsUnavailable) {
		t.Fatalf("err = %v, want %s", err, ErrCodeAnalyticsUnavailable)
	}
}

func TestAnalyticsOperationsMatchSpec(t *testing.T) {
	specPath := os.Getenv("OPENAPI_PATH")
	if specPath == "" {
		specPath = filepath.Join("..", "..", "..", "hubfly-dashboard", "openapi.json")
	}
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Skipf("spec not found: %v", err)
	}
	var spec struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	analytics := regexp.MustCompile(`^/api/v1/(projects/:projectId/)?analytics(/|$)`)
	fromSpec := map[string]string{}
	for route, methods := range spec.Paths {
		if !analytics.MatchString(route) {
			continue
		}
		for method, op := range methods {
			fromSpec[op.OperationID] = strings.ToUpper(method) + " " + route
		}
	}
	if len(fromSpec) == 0 {
		t.Skipf("%s has no Web Analytics operations yet", specPath)
	}
	fromTable := map[string]string{}
	for _, op := range analyticsOperations {
		fromTable[op.ID] = op.Method + " " + op.Path
	}
	if len(fromSpec) != len(fromTable) {
		t.Errorf("spec has %d analytics operations, table has %d (run make generate-managed)", len(fromSpec), len(fromTable))
	}
	for id, want := range fromSpec {
		if fromTable[id] != want {
			t.Errorf("%s: table %q, spec %q (run make generate-managed)", id, fromTable[id], want)
		}
	}
}

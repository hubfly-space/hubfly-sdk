package hubfly

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const tTransferToken = "hub_project_transfer_abababababababababababababababababababababababababababababababab.v1"

// The Dashboard derives the HTTP method from the handler name: get, list and
// preview are GET; create, cancel, accept and decline are POST.
func TestProjectTransferEndpoints(t *testing.T) {
	const offer = "/api/v1/project-transfers/" + tTransferToken
	cases := []struct {
		name   string
		call   func(ctx context.Context, c *Client) error
		method string
		path   string
		query  map[string][]string
		body   string // expected JSON, "" for none
	}{
		{"get", func(ctx context.Context, c *Client) error { return errOf(c.ProjectTransfers.Get(ctx, tP)) }, "GET", "/api/v1/projects/" + tP + "/transfer", nil, ""},
		{"preview", func(ctx context.Context, c *Client) error { return errOf(c.ProjectTransfers.Preview(ctx, tP)) }, "GET", "/api/v1/projects/" + tP + "/transfer/preview", nil, ""},
		{"create otp", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.CreateOTP(ctx, tP, "bob@example.test"))
		}, "POST", "/api/v1/projects/" + tP + "/transfer/otp/create", nil, `{"recipientEmail":"bob@example.test"}`},
		{"create", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.Create(ctx, tP, CreateProjectTransferParams{RecipientEmail: "bob@example.test", ConfirmName: "web", OTP: "123456"}))
		}, "POST", "/api/v1/projects/" + tP + "/transfer/create", nil, `{"recipientEmail":"bob@example.test","confirmName":"web","otp":"123456"}`},
		{"create rotate", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.Create(ctx, tP, CreateProjectTransferParams{RecipientEmail: "bob@example.test", ConfirmName: "web", OTP: "123456", Options: &ProjectTransferOptions{CredentialPolicy: "rotate"}}))
		}, "POST", "/api/v1/projects/" + tP + "/transfer/create", nil, `{"recipientEmail":"bob@example.test","confirmName":"web","otp":"123456","options":{"credentialPolicy":"rotate"}}`},
		{"cancel", func(ctx context.Context, c *Client) error { return errOf(c.ProjectTransfers.Cancel(ctx, tP)) }, "POST", "/api/v1/projects/" + tP + "/transfer/cancel", nil, `{}`},
		{"list", func(ctx context.Context, c *Client) error { return errOf(c.ProjectTransfers.List(ctx)) }, "GET", "/api/v1/project-transfers", nil, ""},
		{"get offer", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.GetOffer(ctx, tTransferToken))
		}, "GET", offer, nil, ""},
		{"preview acceptance personal", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.PreviewAcceptance(ctx, tTransferToken, ProjectTransferDestinationParams{DestinationType: "user"}))
		}, "GET", offer + "/preview", map[string][]string{"destinationType": {"user"}}, ""},
		{"preview acceptance subset", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.PreviewAcceptance(ctx, tTransferToken, ProjectTransferDestinationParams{DestinationType: "organization", DestinationID: "org_1", TransferIDs: []string{"ptr_1", "ptr_2"}}))
		}, "GET", offer + "/preview", map[string][]string{"destinationType": {"organization"}, "destinationId": {"org_1"}, "transferIds": {"ptr_1", "ptr_2"}}, ""},
		{"accept", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.Accept(ctx, tTransferToken, AcceptProjectTransferParams{DestinationType: "organization", DestinationID: "org_1", KeepMembers: []ProjectTransferKeepMembers{{TransferID: "ptr_1", UserIDs: []string{"u_2"}}}}))
		}, "POST", offer + "/accept", nil, `{"destinationType":"organization","destinationId":"org_1","keepMembers":[{"transferId":"ptr_1","userIds":["u_2"]}]}`},
		{"accept personal", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.Accept(ctx, tTransferToken, AcceptProjectTransferParams{DestinationType: "user"}))
		}, "POST", offer + "/accept", nil, `{"destinationType":"user"}`},
		{"decline", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.Decline(ctx, tTransferToken))
		}, "POST", offer + "/decline", nil, `{}`},
		{"bundle otp", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.CreateBundleOTP(ctx, CreateProjectTransferBundleOTPParams{ProjectIDs: []string{"p1", "p2"}, RecipientEmail: "bob@example.test"}))
		}, "POST", "/api/v1/project-transfers/bundles/otp/create", nil, `{"projectIds":["p1","p2"],"recipientEmail":"bob@example.test"}`},
		{"bundle create", func(ctx context.Context, c *Client) error {
			return errOf(c.ProjectTransfers.CreateBundle(ctx, CreateProjectTransferBundleParams{ProjectIDs: []string{"p1", "p2"}, RecipientEmail: "bob@example.test", ConfirmText: TransferBundleConfirmText(2), OTP: "123456"}))
		}, "POST", "/api/v1/project-transfers/bundles/create", nil, `{"projectIds":["p1","p2"],"recipientEmail":"bob@example.test","confirmText":"TRANSFER 2 PROJECTS","otp":"123456"}`},
		{"history", func(ctx context.Context, c *Client) error { return errOf(c.Projects.History(ctx, tP)) }, "GET", "/api/v1/projects/" + tP + "/history", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake, c := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
				data := "{}"
				if strings.HasSuffix(r.Path, "/accept") {
					data = "[]"
				}
				return 200, `{"ok":true,"data":` + data + `,"meta":{"requestId":"req_1","timestamp":"t"}}`
			})
			if err := tc.call(context.Background(), c); err != nil {
				t.Fatalf("call: %v", err)
			}
			reqs := fake.all()
			if len(reqs) != 1 {
				t.Fatalf("got %d requests", len(reqs))
			}
			r := reqs[0]
			if r.Method != tc.method || r.Path != tc.path {
				t.Errorf("got %s %s, want %s %s", r.Method, r.Path, tc.method, tc.path)
			}
			query := tc.query
			if query == nil {
				query = map[string][]string{}
			}
			if !reflect.DeepEqual(r.Query, query) {
				t.Errorf("query %v, want %v", r.Query, query)
			}
			if tc.body == "" {
				if r.Body != "" {
					t.Errorf("unexpected body %s", r.Body)
				}
				return
			}
			var got, want any
			if err := json.Unmarshal([]byte(r.Body), &got); err != nil {
				t.Fatalf("body %q: %v", r.Body, err)
			}
			_ = json.Unmarshal([]byte(tc.body), &want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("body %s, want %s", r.Body, tc.body)
			}
		})
	}
}

func TestProjectTransferDecodesViewsAndErrors(t *testing.T) {
	_, c := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.Path, "/transfer"):
			return 200, `{"ok":true,"data":null,"meta":{"requestId":"r","timestamp":"t"}}`
		case r.Method == "POST" && strings.HasSuffix(r.Path, "/accept"):
			return 200, `{"ok":true,"data":[{"id":"ptr_1","projectId":"p1","projectName":"web","projectType":"cell","status":"accepted","recipientEmail":"bob@example.test","from":{"type":"user","id":"u1","name":"Alice"},"to":{"type":"organization","id":"org_1","name":"Acme"},"expiresAt":"t","createdAt":"t","acceptedAt":"t","completedAt":null,"handoverAt":"2026-10-26T10:00:00Z","job":{"id":"pj_1","kind":"project_transfer","status":"waiting","phase":"forward","lock":"config","step":"settle","stepLabel":"Settling billing","stepIndex":1,"stepCount":8,"steps":[],"progress":null,"etaSeconds":null,"errorCode":null,"errorMessage":null,"remediationCode":null,"startedAt":"t","finishedAt":null,"nextRunAt":"t"},"failureCode":null,"failureMessage":null}],"meta":{"requestId":"r","timestamp":"t"}}`
		}
		return 403, `{"ok":false,"error":{"code":"MOVE_SESSION_REQUIRED","message":"Sign in to the dashboard to transfer a project."},"meta":{"requestId":"req_9"}}`
	})
	ctx := context.Background()

	current, err := c.ProjectTransfers.Get(ctx, tP)
	if err != nil || current.Data != nil {
		t.Fatalf("get %+v, %v", current, err)
	}

	accepted, err := c.ProjectTransfers.Accept(ctx, tTransferToken, AcceptProjectTransferParams{DestinationType: "organization", DestinationID: "org_1"})
	if err != nil || len(accepted.Data) != 1 {
		t.Fatalf("accept %+v, %v", accepted, err)
	}
	view := accepted.Data[0]
	if view.To == nil || view.To.ID != "org_1" || view.Job == nil || *view.Job.StepLabel != "Settling billing" || *view.Job.Lock != "config" || view.CompletedAt != nil {
		t.Fatalf("view %+v", view)
	}

	_, err = c.ProjectTransfers.CreateOTP(ctx, tP, "bob@example.test")
	if !IsAPIErrorCode(err, "MOVE_SESSION_REQUIRED") {
		t.Fatalf("err %v", err)
	}
}

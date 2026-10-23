package hubfly_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hubfly/hubfly-sdk/go"
)

// State-changing endpoints are POST on the engine (a GET mutation is a CSRF
// hole), so the SDK must call them with POST.
func TestMutatingEndpointsUsePOST(t *testing.T) {
	var method, path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{},"meta":{"requestId":"r","timestamp":""}}`))
	}))
	defer server.Close()

	client := hubfly.NewClient(hubfly.WithToken("t"), hubfly.WithBaseURL(server.URL))
	ctx := context.Background()

	cases := []struct {
		name string
		call func() error
		path string
	}{
		{"hibernate", func() error { _, err := client.Hibernation.Hibernate(ctx, "p1"); return err }, "/api/v1/projects/p1/hibernation/hibernate"},
		{"restore", func() error { _, err := client.Hibernation.Restore(ctx, "p1"); return err }, "/api/v1/projects/p1/hibernation/restore"},
		{"github refresh", func() error { _, err := client.Github.RefreshToken(ctx); return err }, "/api/v1/github/refresh-token"},
	}
	for _, tc := range cases {
		method, path = "", ""
		if err := tc.call(); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if method != http.MethodPost || path != tc.path {
			t.Errorf("%s: got %s %s, want POST %s", tc.name, method, path, tc.path)
		}
	}
}

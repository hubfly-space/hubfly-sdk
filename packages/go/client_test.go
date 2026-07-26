package hubfly_test

import (
	"testing"

	"github.com/hubfly/hubfly-sdk/go"
)

func TestNewClient(t *testing.T) {
	client := hubfly.NewClient(
		hubfly.WithToken("test-token"),
		hubfly.WithBaseURL("http://localhost:8787"),
	)

	if client == nil {
		t.Fatal("expected non-nil client")
	}

	if client.Auth == nil {
		t.Error("expected Auth service to be initialized")
	}
	if client.Projects == nil {
		t.Error("expected Projects service to be initialized")
	}
	if client.Containers == nil {
		t.Error("expected Containers service to be initialized")
	}
	if client.Regions == nil {
		t.Error("expected Regions service to be initialized")
	}
	if client.Templates == nil {
		t.Error("expected Templates service to be initialized")
	}
	if client.LoadBalancers == nil {
		t.Error("expected LoadBalancers service to be initialized")
	}
	if client.Network == nil {
		t.Error("expected Network service to be initialized")
	}
	if client.Ports == nil {
		t.Error("expected Ports service to be initialized")
	}
	if client.Registry == nil {
		t.Error("expected Registry service to be initialized")
	}
	if client.Subdomains == nil {
		t.Error("expected Subdomains service to be initialized")
	}
	if client.Team == nil {
		t.Error("expected Team service to be initialized")
	}
	if client.Tunnels == nil {
		t.Error("expected Tunnels service to be initialized")
	}
	if client.Volumes == nil {
		t.Error("expected Volumes service to be initialized")
	}
	if client.Webhooks == nil {
		t.Error("expected Webhooks service to be initialized")
	}
	if client.Hibernation == nil {
		t.Error("expected Hibernation service to be initialized")
	}
}

package hubfly

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The insights and usage views as the Dashboard builds them from a real
// engine's replies (testdata/realtime-engine-views.json, captured by
// hubfly-dashboard's engine-integration.test.ts against rt-devserver) decode
// into the generated types without losing or changing a field.
func TestManagedRealtimeEngineViewsDecode(t *testing.T) {
	raw, err := os.ReadFile("testdata/realtime-engine-views.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	_, client := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		if strings.HasSuffix(r.Path, "/realtime/insights") {
			return 200, string(fixture["insights"])
		}
		return 200, string(fixture["usage"])
	})
	insights, err := client.Managed.Realtime.GetInsights(context.Background(), tP, tI, nil)
	if err != nil {
		t.Fatal(err)
	}
	usage, err := client.Managed.Realtime.GetUsage(context.Background(), tP, tI, nil)
	if err != nil {
		t.Fatal(err)
	}
	for name, decoded := range map[string]any{"insights": insights.Data, "usage": usage.Data} {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(fixture[name], &envelope)
		var want, got any
		_ = json.Unmarshal(envelope.Data, &want)
		again, _ := json.Marshal(decoded)
		_ = json.Unmarshal(again, &got)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s round trip differs:\n got %s\nwant %s", name, again, envelope.Data)
		}
	}
	if len(insights.Data.TopChannels) == 0 || insights.Data.ConnectionsPeak < 1 || len(insights.Data.Libraries) == 0 ||
		insights.Data.Webhooks.SuccessRate == nil {
		t.Fatalf("insights = %+v", insights.Data)
	}
	if len(usage.Data.Days) == 0 || usage.Data.Days[0].AppID == "" || usage.Data.Days[0].MessagesIn <= 0 {
		t.Fatalf("usage = %+v", usage.Data)
	}
}

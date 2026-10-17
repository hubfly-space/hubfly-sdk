package hubfly

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordedRequest struct {
	Method string
	Path   string // escaped path, as sent
	Query  map[string][]string
	Body   string
}

type fakeManagedAPI struct {
	mu       sync.Mutex
	requests []recordedRequest
	respond  func(r recordedRequest) (int, string)
}

func newFakeManagedAPI(t *testing.T, respond func(r recordedRequest) (int, string)) (*fakeManagedAPI, *Client) {
	t.Helper()
	fake := &fakeManagedAPI{respond: respond}
	if fake.respond == nil {
		fake.respond = func(recordedRequest) (int, string) {
			return 200, `{"ok":true,"data":{},"meta":{"requestId":"req_1","timestamp":"t"}}`
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec := recordedRequest{Method: r.Method, Path: r.URL.EscapedPath(), Query: r.URL.Query(), Body: string(body)}
		fake.mu.Lock()
		fake.requests = append(fake.requests, rec)
		fake.mu.Unlock()
		status, payload := fake.respond(rec)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, payload)
	}))
	t.Cleanup(server.Close)
	return fake, NewClient(WithToken("t"), WithBaseURL(server.URL))
}

func (f *fakeManagedAPI) all() []recordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recordedRequest(nil), f.requests...)
}

func errOf[T any](_ *Response[T], err error) error { return err }

const (
	tP = "proj_1"
	tI = "inst_1"
	tA = "1000001"
)

// managedCalls makes one call per operation and names the operationId it must hit.
func managedCalls(c *Client) []struct {
	id   string
	call func(ctx context.Context) error
} {
	m, ins, db, rt := c.Managed, c.Managed.Instances, c.Managed.Databases, c.Managed.Realtime
	type call = struct {
		id   string
		call func(ctx context.Context) error
	}
	return []call{
		{"getManagedCatalog", func(ctx context.Context) error { return errOf(m.Catalog(ctx)) }},
		{"getManagedClientIp", func(ctx context.Context) error { return errOf(m.ClientIP(ctx)) }},
		{"getManagedPricing", func(ctx context.Context) error { return errOf(m.Pricing(ctx)) }},
		{"getManagedPriceEstimate", func(ctx context.Context) error {
			return errOf(m.EstimatePrice(ctx, GetManagedPriceEstimateQuery{CPU: 0.5, MemoryMib: 512, StorageGib: 10}))
		}},
		{"getManagedWorkspace", func(ctx context.Context) error { return errOf(m.Workspace(ctx, tP)) }},
		{"getManagedOperations", func(ctx context.Context) error { return errOf(m.ListOperations(ctx, tP, nil)) }},
		{"getManagedInstances", func(ctx context.Context) error { return errOf(ins.List(ctx, tP)) }},
		{"getManagedInstance", func(ctx context.Context) error { return errOf(ins.Get(ctx, tP, tI)) }},
		{"createManagedInstance", func(ctx context.Context) error {
			return errOf(ins.Create(ctx, tP, CreateManagedInstanceBody{Name: "rt", Service: "realtime", Size: ManagedInstanceSizeInput{CPU: 0.5, MemoryMib: 512}, QuotedHourlyTotal: 0.01, IdempotencyKey: "k1"}))
		}},
		{"updateManagedInstance", func(ctx context.Context) error {
			return errOf(ins.Update(ctx, tP, tI, UpdateManagedInstanceBody{Name: "renamed"}))
		}},
		{"deleteManagedInstance", func(ctx context.Context) error {
			return errOf(ins.Delete(ctx, tP, tI, DeleteManagedInstanceQuery{ConfirmName: "rt"}))
		}},
		{"updateManagedInstanceDeletionProtection", func(ctx context.Context) error {
			return errOf(ins.UpdateDeletionProtection(ctx, tP, tI, UpdateManagedInstanceDeletionProtectionBody{Enabled: true}))
		}},
		{"postManagedInstanceStart", func(ctx context.Context) error { return errOf(ins.Start(ctx, tP, tI)) }},
		{"postManagedInstanceStop", func(ctx context.Context) error { return errOf(ins.Stop(ctx, tP, tI)) }},
		{"postManagedInstanceRestart", func(ctx context.Context) error { return errOf(ins.Restart(ctx, tP, tI)) }},
		{"postManagedInstanceResize", func(ctx context.Context) error {
			return errOf(ins.Resize(ctx, tP, tI, PostManagedInstanceResizeBody{MemoryMib: Float(1024), QuotedHourlyTotal: 0.02}))
		}},
		{"postManagedInstanceUpgrade", func(ctx context.Context) error { return errOf(ins.Upgrade(ctx, tP, tI)) }},
		{"getManagedInstanceOperations", func(ctx context.Context) error { return errOf(ins.ListOperations(ctx, tP, tI, nil)) }},
		{"getManagedInstanceOperation", func(ctx context.Context) error { return errOf(ins.GetOperation(ctx, tP, tI, "op_1")) }},
		{"getManagedInstanceMetrics", func(ctx context.Context) error {
			return errOf(ins.Metrics(ctx, tP, tI, &GetManagedInstanceMetricsQuery{WindowSeconds: Float(3600)}))
		}},
		{"getManagedInstanceLogs", func(ctx context.Context) error { return errOf(ins.Logs(ctx, tP, tI, nil)) }},
		{"getManagedInstanceAudit", func(ctx context.Context) error { return errOf(ins.Audit(ctx, tP, tI, nil)) }},
		{"getManagedInstanceNetwork", func(ctx context.Context) error { return errOf(ins.GetNetwork(ctx, tP, tI)) }},
		{"updateManagedInstanceAllowlist", func(ctx context.Context) error {
			return errOf(ins.UpdateAllowlist(ctx, tP, tI, UpdateManagedInstanceAllowlistBody{Revision: 3}))
		}},
		{"updateManagedInstancePublicAccess", func(ctx context.Context) error {
			return errOf(ins.UpdatePublicAccess(ctx, tP, tI, UpdateManagedInstancePublicAccessBody{Enabled: false}))
		}},
		{"getManagedInstanceAlerts", func(ctx context.Context) error { return errOf(ins.GetAlerts(ctx, tP, tI)) }},
		{"updateManagedInstanceAlerts", func(ctx context.Context) error {
			return errOf(ins.UpdateAlerts(ctx, tP, tI, UpdateManagedInstanceAlertsBody{StoragePercent: 80, ConnectionsPercent: 80, InstanceDown: true, Email: true}))
		}},
		{"getManagedInstanceConnection", func(ctx context.Context) error { return errOf(db.GetConnection(ctx, tP, tI)) }},
		{"getManagedInstanceCertificate", func(ctx context.Context) error { return errOf(db.GetCertificate(ctx, tP, tI)) }},
		{"getManagedInstanceBackups", func(ctx context.Context) error { return errOf(db.GetBackups(ctx, tP, tI)) }},
		{"postManagedInstanceCredentialReveal", func(ctx context.Context) error { return errOf(db.RevealCredentials(ctx, tP, tI)) }},
		{"postManagedInstanceCredentialRotate", func(ctx context.Context) error { return errOf(db.RotateCredentials(ctx, tP, tI)) }},
		{"getManagedInstanceBindings", func(ctx context.Context) error { return errOf(db.ListBindings(ctx, tP, tI)) }},
		{"createManagedInstanceBinding", func(ctx context.Context) error {
			return errOf(db.CreateBinding(ctx, tP, tI, CreateManagedInstanceBindingBody{TargetProjectID: "proj_2"}))
		}},
		{"deleteManagedInstanceBinding", func(ctx context.Context) error {
			return errOf(db.DeleteBinding(ctx, tP, tI, "bind_1", &DeleteManagedInstanceBindingQuery{RemoveVariable: Ptr(false)}))
		}},
		{"getManagedInstanceDatabases", func(ctx context.Context) error { return errOf(db.ListDatabases(ctx, tP, tI)) }},
		{"createManagedInstanceDatabase", func(ctx context.Context) error {
			return errOf(db.CreateDatabase(ctx, tP, tI, CreateManagedInstanceDatabaseBody{Name: "app"}))
		}},
		{"deleteManagedInstanceDatabase", func(ctx context.Context) error {
			return errOf(db.DeleteDatabase(ctx, tP, tI, "app", DeleteManagedInstanceDatabaseQuery{ConfirmName: "app"}))
		}},
		{"getManagedInstanceUsers", func(ctx context.Context) error { return errOf(db.ListUsers(ctx, tP, tI)) }},
		{"createManagedInstanceUser", func(ctx context.Context) error {
			return errOf(db.CreateUser(ctx, tP, tI, CreateManagedInstanceUserBody{Name: "reader", Preset: "read_only"}))
		}},
		{"updateManagedInstanceUser", func(ctx context.Context) error {
			return errOf(db.UpdateUser(ctx, tP, tI, "reader", UpdateManagedInstanceUserBody{Preset: "read_write"}))
		}},
		{"deleteManagedInstanceUser", func(ctx context.Context) error { return errOf(db.DeleteUser(ctx, tP, tI, "reader", nil)) }},
		{"postManagedInstanceUserPasswordRotate", func(ctx context.Context) error { return errOf(db.RotateUserPassword(ctx, tP, tI, "reader")) }},
		{"getManagedInstanceExtensions", func(ctx context.Context) error { return errOf(db.ListExtensions(ctx, tP, tI, nil)) }},
		{"postManagedInstanceExtensionInstall", func(ctx context.Context) error {
			return errOf(db.InstallExtension(ctx, tP, tI, PostManagedInstanceExtensionInstallBody{Name: "pgcrypto"}))
		}},
		{"deleteManagedInstanceExtension", func(ctx context.Context) error {
			return errOf(db.DeleteExtension(ctx, tP, tI, "pgcrypto", &DeleteManagedInstanceExtensionQuery{Cascade: Ptr(true)}))
		}},
		{"getManagedInstanceExports", func(ctx context.Context) error { return errOf(db.ListExports(ctx, tP, tI)) }},
		{"createManagedInstanceExport", func(ctx context.Context) error {
			return errOf(db.CreateExport(ctx, tP, tI, CreateManagedInstanceExportBody{}))
		}},
		{"postManagedInstanceExportDownload", func(ctx context.Context) error { return errOf(db.DownloadExport(ctx, tP, tI, "exp_1")) }},
		{"postManagedInstanceImportUpload", func(ctx context.Context) error {
			return errOf(db.UploadImport(ctx, tP, tI, PostManagedInstanceImportUploadBody{FileName: "dump.sql", SizeBytes: 10}))
		}},
		{"postManagedInstanceImportStart", func(ctx context.Context) error { return errOf(db.StartImport(ctx, tP, tI, "imp_1")) }},
		{"getManagedInstanceConfig", func(ctx context.Context) error { return errOf(db.GetConfig(ctx, tP, tI)) }},
		{"getManagedInstanceConfigHistory", func(ctx context.Context) error { return errOf(db.GetConfigHistory(ctx, tP, tI, nil)) }},
		{"postManagedInstanceConfigValidate", func(ctx context.Context) error {
			return errOf(db.ValidateConfig(ctx, tP, tI, PostManagedInstanceConfigValidateBody{Changes: map[string]*string{"work_mem": Ptr("8MB")}}))
		}},
		{"postManagedInstanceConfigApply", func(ctx context.Context) error {
			return errOf(db.ApplyConfig(ctx, tP, tI, PostManagedInstanceConfigApplyBody{Generation: 2, Changes: map[string]*string{"work_mem": nil}, Restart: "later"}))
		}},
		{"postManagedInstanceConfigRevert", func(ctx context.Context) error {
			return errOf(db.RevertConfig(ctx, tP, tI, PostManagedInstanceConfigRevertBody{RevisionID: "rev_1", Generation: 2, Restart: "now"}))
		}},
		{"getManagedInstanceInsights", func(ctx context.Context) error {
			return errOf(db.GetInsights(ctx, tP, tI, &GetManagedInstanceInsightsQuery{OrderBy: "calls"}))
		}},
		{"postManagedInstanceInsightsReset", func(ctx context.Context) error { return errOf(db.ResetInsights(ctx, tP, tI)) }},
		{"getManagedInstanceSessions", func(ctx context.Context) error { return errOf(db.ListSessions(ctx, tP, tI)) }},
		{"postManagedInstanceSessionCancel", func(ctx context.Context) error { return errOf(db.CancelSession(ctx, tP, tI, "42")) }},
		{"postManagedInstanceSessionTerminate", func(ctx context.Context) error { return errOf(db.TerminateSession(ctx, tP, tI, "42")) }},
		{"postManagedInstanceQuery", func(ctx context.Context) error {
			return errOf(db.Query(ctx, tP, tI, PostManagedInstanceQueryBody{SQL: "select 1", ReadOnly: true}))
		}},
		{"getManagedInstanceSchema", func(ctx context.Context) error { return errOf(db.GetSchema(ctx, tP, tI, nil)) }},
		{"getManagedInstanceTableRows", func(ctx context.Context) error {
			return errOf(db.GetTableRows(ctx, tP, tI, GetManagedInstanceTableRowsQuery{Schema: "public", Table: "users", Limit: Float(10)}))
		}},
		{"postManagedInstanceTableRowsChange", func(ctx context.Context) error {
			return errOf(db.ChangeTableRows(ctx, tP, tI, PostManagedInstanceTableRowsChangeBody{Schema: "public", Table: "users", Action: "delete", Keys: []map[string]*string{{"id": Ptr("1")}}}))
		}},
		{"getManagedInstanceTokens", func(ctx context.Context) error { return errOf(db.ListTokens(ctx, tP, tI)) }},
		{"createManagedInstanceToken", func(ctx context.Context) error {
			return errOf(db.CreateToken(ctx, tP, tI, CreateManagedInstanceTokenBody{Name: "ci", Access: "read_only"}))
		}},
		{"deleteManagedInstanceToken", func(ctx context.Context) error { return errOf(db.DeleteToken(ctx, tP, tI, "tok_1")) }},
		{"postManagedInstanceShellSession", func(ctx context.Context) error { return errOf(db.CreateShellSession(ctx, tP, tI)) }},
		{"getManagedRealtimeApps", func(ctx context.Context) error { return errOf(rt.ListApps(ctx, tP, tI)) }},
		{"getManagedRealtimeApp", func(ctx context.Context) error { return errOf(rt.GetApp(ctx, tP, tI, tA)) }},
		{"createManagedRealtimeApp", func(ctx context.Context) error {
			return errOf(rt.CreateApp(ctx, tP, tI, CreateManagedRealtimeAppBody{Name: "chat"}))
		}},
		{"updateManagedRealtimeApp", func(ctx context.Context) error {
			return errOf(rt.UpdateApp(ctx, tP, tI, tA, UpdateManagedRealtimeAppBody{Enabled: Ptr(false)}))
		}},
		{"updateManagedRealtimeAppSettings", func(ctx context.Context) error {
			return errOf(rt.UpdateAppSettings(ctx, tP, tI, tA, UpdateManagedRealtimeAppSettingsBody{Settings: ManagedRealtimeAppSettingsInput{AllowedOrigins: []string{}}, Revision: 1}))
		}},
		{"deleteManagedRealtimeApp", func(ctx context.Context) error {
			return errOf(rt.DeleteApp(ctx, tP, tI, tA, DeleteManagedRealtimeAppQuery{ConfirmName: "chat"}))
		}},
		{"getManagedRealtimeKeys", func(ctx context.Context) error { return errOf(rt.ListKeys(ctx, tP, tI, tA)) }},
		{"createManagedRealtimeKey", func(ctx context.Context) error { return errOf(rt.CreateKey(ctx, tP, tI, tA)) }},
		{"postManagedRealtimeKeyRotate", func(ctx context.Context) error {
			return errOf(rt.RotateKey(ctx, tP, tI, tA, "key_1", PostManagedRealtimeKeyRotateBody{GraceSeconds: Float(600)}))
		}},
		{"postManagedRealtimeKeyRevoke", func(ctx context.Context) error { return errOf(rt.RevokeKey(ctx, tP, tI, tA, "key_1")) }},
		{"postManagedRealtimeKeyReveal", func(ctx context.Context) error { return errOf(rt.RevealKey(ctx, tP, tI, tA, "key_1")) }},
		{"getManagedRealtimeWebhooks", func(ctx context.Context) error { return errOf(rt.ListWebhooks(ctx, tP, tI, tA)) }},
		{"createManagedRealtimeWebhook", func(ctx context.Context) error {
			return errOf(rt.CreateWebhook(ctx, tP, tI, tA, CreateManagedRealtimeWebhookBody{URL: "https://example.com/hook", Events: []string{"channel_occupied"}}))
		}},
		{"updateManagedRealtimeWebhook", func(ctx context.Context) error {
			return errOf(rt.UpdateWebhook(ctx, tP, tI, tA, "wh_1", UpdateManagedRealtimeWebhookBody{Enabled: Ptr(false)}))
		}},
		{"deleteManagedRealtimeWebhook", func(ctx context.Context) error { return errOf(rt.DeleteWebhook(ctx, tP, tI, tA, "wh_1")) }},
		{"postManagedRealtimeWebhookTest", func(ctx context.Context) error { return errOf(rt.TestWebhook(ctx, tP, tI, tA, "wh_1")) }},
		{"getManagedRealtimeWebhookDeliveries", func(ctx context.Context) error {
			return errOf(rt.GetWebhookDeliveries(ctx, tP, tI, tA, &GetManagedRealtimeWebhookDeliveriesQuery{Status: "dead"}))
		}},
		{"postManagedRealtimeWebhookRedeliver", func(ctx context.Context) error { return errOf(rt.RedeliverWebhook(ctx, tP, tI, tA, "dlv_1")) }},
		{"postManagedRealtimePublish", func(ctx context.Context) error {
			return errOf(rt.Publish(ctx, tP, tI, tA, PostManagedRealtimePublishBody{Event: "order.created", Data: `{"id":42}`, Channels: []string{"orders"}}))
		}},
		{"postManagedRealtimeSend", func(ctx context.Context) error {
			return errOf(rt.Send(ctx, tP, tI, tA, PostManagedRealtimeSendBody{Event: "ping", Data: "hi", UserID: "u1"}))
		}},
		{"getManagedRealtimeChannels", func(ctx context.Context) error {
			return errOf(rt.ListChannels(ctx, tP, tI, tA, &GetManagedRealtimeChannelsQuery{Prefix: "presence-"}))
		}},
		{"getManagedRealtimeChannel", func(ctx context.Context) error {
			return errOf(rt.InspectChannel(ctx, tP, tI, tA, GetManagedRealtimeChannelQuery{Channel: "presence-room"}))
		}},
		{"getManagedRealtimeConnections", func(ctx context.Context) error {
			return errOf(rt.ListConnections(ctx, tP, tI, &GetManagedRealtimeConnectionsQuery{AppID: tA}))
		}},
		{"postManagedRealtimeConnectionTerminate", func(ctx context.Context) error {
			return errOf(rt.TerminateConnection(ctx, tP, tI, tA, PostManagedRealtimeConnectionTerminateBody{SocketID: "1234567890.1234567890", Mode: "disconnect"}))
		}},
		{"postManagedRealtimeUserTerminate", func(ctx context.Context) error {
			return errOf(rt.TerminateUser(ctx, tP, tI, tA, PostManagedRealtimeUserTerminateBody{UserID: "u1"}))
		}},
		{"getManagedRealtimeHistory", func(ctx context.Context) error {
			return errOf(rt.GetHistory(ctx, tP, tI, tA, GetManagedRealtimeHistoryQuery{Channel: "orders", Since: Float(0)}))
		}},
		{"postManagedRealtimeHistoryPurge", func(ctx context.Context) error {
			return errOf(rt.PurgeHistory(ctx, tP, tI, tA, PostManagedRealtimeHistoryPurgeBody{}))
		}},
		{"getManagedRealtimeInsights", func(ctx context.Context) error { return errOf(rt.GetInsights(ctx, tP, tI, nil)) }},
		{"getManagedRealtimeUsage", func(ctx context.Context) error { return errOf(rt.GetUsage(ctx, tP, tI, nil)) }},
		{"createManagedRealtimeInspectorToken", func(ctx context.Context) error {
			return errOf(rt.CreateInspectorToken(ctx, tP, tI, CreateManagedRealtimeInspectorTokenBody{}))
		}},
		{"getManagedRealtimeInspectorRecent", func(ctx context.Context) error {
			return errOf(rt.GetInspectorRecent(ctx, tP, tI, &GetManagedRealtimeInspectorRecentQuery{AfterSeq: Float(0), PayloadPreview: Ptr(false)}))
		}},
		{"getManagedRealtimeBindings", func(ctx context.Context) error { return errOf(rt.ListBindings(ctx, tP, tI)) }},
		{"createManagedRealtimeBinding", func(ctx context.Context) error {
			return errOf(rt.CreateBinding(ctx, tP, tI, CreateManagedRealtimeBindingBody{AppID: tA, TargetProjectID: "proj_2", ClientPrefix: "NEXT_PUBLIC_"}))
		}},
		{"deleteManagedRealtimeBinding", func(ctx context.Context) error {
			return errOf(rt.DeleteBinding(ctx, tP, tI, "bind_1", &DeleteManagedRealtimeBindingQuery{RemoveVariables: Ptr(false)}))
		}},
		{"getManagedRealtimeConnection", func(ctx context.Context) error { return errOf(rt.GetConnection(ctx, tP, tI)) }},
	}
}

func pathPattern(template string) *regexp.Regexp {
	return regexp.MustCompile("^" + regexp.MustCompile(`:[A-Za-z0-9_]+`).ReplaceAllString(template, `[^/]+`) + "$")
}

func TestManagedCoversEveryOperation(t *testing.T) {
	fake, client := newFakeManagedAPI(t, nil)
	ctx := context.Background()
	ops := map[string]managedOperation{}
	for _, op := range managedOperations {
		ops[op.ID] = op
	}
	calls := managedCalls(client)
	seen := map[string]bool{}
	for _, c := range calls {
		op, ok := ops[c.id]
		if !ok {
			t.Fatalf("%s is not a managed operation", c.id)
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
		t.Fatalf("operations without a method: %v", missing)
	}
	if len(managedOperations) != 104 {
		t.Logf("note: %d managed operations (104 when this test was written)", len(managedOperations))
	}
}

func TestManagedRequestEncoding(t *testing.T) {
	fake, client := newFakeManagedAPI(t, nil)
	ctx := context.Background()
	db, rt := client.Managed.Databases, client.Managed.Realtime

	if _, err := db.DeleteDatabase(ctx, tP, tI, "my db/x", DeleteManagedInstanceDatabaseQuery{ConfirmName: "my db/x", Force: Ptr(false)}); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.GetHistory(ctx, tP, tI, tA, GetManagedRealtimeHistoryQuery{Channel: "private-orders", Since: Float(0), Limit: Float(50)}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Managed.Instances.Restart(ctx, tP, tI); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.UpdateAppSettings(ctx, tP, tI, tA, UpdateManagedRealtimeAppSettingsBody{
		Settings: ManagedRealtimeAppSettingsInput{AllowedOrigins: []string{}, ClientEvents: Ptr(false), History: &ManagedRealtimeHistorySettingsInput{Mode: "durable"}},
		Revision: 7,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.Publish(ctx, tP, tI, tA, PostManagedRealtimePublishBody{Event: "e", Data: "d"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ApplyConfig(ctx, tP, tI, PostManagedInstanceConfigApplyBody{Generation: 2, Changes: map[string]*string{"work_mem": nil}, Restart: "later"}); err != nil {
		t.Fatal(err)
	}

	reqs := fake.all()
	if got, want := reqs[0].Path, "/api/v1/projects/proj_1/managed/instances/inst_1/databases/my%20db%2Fx/delete"; got != want {
		t.Errorf("path = %s, want %s", got, want)
	}
	if reqs[0].Query["confirmName"][0] != "my db/x" || reqs[0].Query["force"][0] != "false" {
		t.Errorf("query = %v", reqs[0].Query)
	}
	if q := reqs[1].Query; q["channel"][0] != "private-orders" || q["since"][0] != "0" || q["limit"][0] != "50" || len(q) != 3 {
		t.Errorf("history query = %v", q)
	}
	if reqs[2].Body != "{}" {
		t.Errorf("empty POST body = %q, want {}", reqs[2].Body)
	}
	assertJSON(t, reqs[3].Body, `{"revision":7,"settings":{"allowedOrigins":[],"clientEvents":false,"history":{"mode":"durable"}}}`)
	// Required arrays are sent as [] even when nil.
	assertJSON(t, reqs[4].Body, `{"channels":[],"data":"d","event":"e"}`)
	// Nullable map values are sent as null.
	assertJSON(t, reqs[5].Body, `{"changes":{"work_mem":null},"generation":2,"restart":"later"}`)
}

func assertJSON(t *testing.T, got, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal([]byte(got), &g); err != nil {
		t.Fatalf("invalid JSON %q: %v", got, err)
	}
	_ = json.Unmarshal([]byte(want), &w)
	gb, _ := json.Marshal(g)
	wb, _ := json.Marshal(w)
	if string(gb) != string(wb) {
		t.Errorf("body = %s, want %s", gb, wb)
	}
}

func TestManagedE2EConnectionIDs(t *testing.T) {
	const key = "c2VjcmV0LWNsaWVudC1rZXktbXVzdC1uZXZlci1sZWF2ZQ"
	e2eID := "1234567890.1234567890~" + key
	fake, client := newFakeManagedAPI(t, nil)
	ctx := context.Background()
	rt := client.Managed.Realtime

	_, err := rt.Send(ctx, tP, tI, tA, PostManagedRealtimeSendBody{Event: "chat.message", Data: `{"text":"hi"}`, SocketIDs: []string{e2eID}})
	if !IsAPIErrorCode(err, ErrCodeManagedRealtimeE2EConnectionID) {
		t.Fatalf("plaintext send to an E2E id: err = %v", err)
	}
	if strings.Contains(err.Error(), key) {
		t.Fatal("error message contains the client key")
	}
	if n := len(fake.all()); n != 0 {
		t.Fatalf("%d requests sent for a refused send", n)
	}

	if _, err := rt.Send(ctx, tP, tI, tA, PostManagedRealtimeSendBody{Event: RealtimeE2EEvent, Data: `{"v":1}`, SocketIDs: []string{e2eID, "1234567890.1234567890", "2234567890.1234567890"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.TerminateConnection(ctx, tP, tI, tA, PostManagedRealtimeConnectionTerminateBody{SocketID: e2eID}); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.ListConnections(ctx, tP, tI, &GetManagedRealtimeConnectionsQuery{ConnectionID: e2eID}); err != nil {
		t.Fatal(err)
	}
	if _, err := rt.Publish(ctx, tP, tI, tA, PostManagedRealtimePublishBody{Event: "x", Data: "y", Channels: []string{"c"}, ExcludeSocketID: e2eID}); err != nil {
		t.Fatal(err)
	}
	reqs := fake.all()
	for _, r := range reqs {
		all := r.Path + " " + r.Body
		for _, values := range r.Query {
			all += " " + strings.Join(values, " ")
		}
		if strings.Contains(all, key) || strings.Contains(all, "~") {
			t.Fatalf("request leaks the client key: %s", all)
		}
	}
	assertJSON(t, reqs[0].Body, `{"data":"{\"v\":1}","event":"hubfly.e2e","socketIds":["1234567890.1234567890","2234567890.1234567890"]}`)
	assertJSON(t, reqs[1].Body, `{"socketId":"1234567890.1234567890"}`)
	if reqs[2].Query["connectionId"][0] != "1234567890.1234567890" {
		t.Errorf("connectionId = %v", reqs[2].Query["connectionId"])
	}
	if ToSocketID("1234567890.1234567890") != "1234567890.1234567890" {
		t.Error("ToSocketID changed a plain socket id")
	}
}

func TestManagedErrors(t *testing.T) {
	cases := []struct {
		status int
		code   string
	}{
		{409, ErrCodeManagedRealtimeEngineUnsupported},
		{403, ErrCodeManagedRealtimeE2ERequired},
		{413, ErrCodeManagedRealtimePayloadTooLarge},
		{400, ErrCodeManagedRealtimeE2EConnectionID},
		{409, ErrCodeManagedFeatureUnsupported},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
				return tc.status, `{"ok":false,"error":{"code":"` + tc.code + `","message":"message for ` + tc.code + `","details":{"reason":"x"}},"meta":{"requestId":"req_9","timestamp":"t"}}`
			})
			_, err := client.Managed.Realtime.GetInsights(context.Background(), tP, tI, nil)
			if !IsAPIErrorCode(err, tc.code) {
				t.Fatalf("err = %v", err)
			}
			apiErr := err.(*APIError)
			if apiErr.StatusCode != tc.status || apiErr.Message != "message for "+tc.code || apiErr.RequestID != "req_9" || string(apiErr.Details) != `{"reason":"x"}` {
				t.Errorf("APIError = %+v", apiErr)
			}
		})
	}
	t.Run("5xx errorId and string errors", func(t *testing.T) {
		_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
			return 500, `{"ok":false,"error":{"code":"INTERNAL_SERVER_ERROR","message":"Unexpected server error","errorId":"err_1"},"meta":{"requestId":"r","timestamp":"t"}}`
		})
		_, err := client.Managed.Catalog(context.Background())
		if apiErr, ok := err.(*APIError); !ok || apiErr.ErrorID != "err_1" || apiErr.Code != "INTERNAL_SERVER_ERROR" {
			t.Fatalf("err = %#v", err)
		}
		_, legacy := newFakeManagedAPI(t, func(recordedRequest) (int, string) { return 401, `{"ok":false,"error":"Unauthorized"}` })
		_, err = legacy.Managed.Catalog(context.Background())
		if apiErr, ok := err.(*APIError); !ok || apiErr.Message != "Unauthorized" || apiErr.Code != "" {
			t.Fatalf("legacy err = %#v", err)
		}
		if err.Error() != "hubfly api error [HTTP 401]: Unauthorized" {
			t.Errorf("Error() = %q", err.Error())
		}
	})
}

func TestManagedResponseDecoding(t *testing.T) {
	_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 200, `{"ok":true,"data":{"messageId":"m1","results":[{"socketId":"1234567890.1234567890","userId":null,"status":"delivered","connections":null}],"counts":{"delivered":1,"buffered":0,"queued":0,"offline":0},"bytes":12.5,"notice":null},"meta":{"requestId":"r","timestamp":"t"}}`
	})
	resp, err := client.Managed.Realtime.Send(context.Background(), tP, tI, tA, PostManagedRealtimeSendBody{Event: "e", Data: "d", UserID: "u"})
	if err != nil {
		t.Fatal(err)
	}
	d := resp.Data
	if d.MessageID != "m1" || d.Counts.Delivered != 1 || d.Bytes != 12.5 || d.Notice != nil || len(d.Results) != 1 {
		t.Fatalf("data = %+v", d)
	}
	if r := d.Results[0]; r.SocketID == nil || *r.SocketID != "1234567890.1234567890" || r.UserID != nil || r.Status != "delivered" || r.Connections != nil {
		t.Fatalf("result = %+v", r)
	}
}

func TestManagedWaitForOperation(t *testing.T) {
	polls := 0
	var mu sync.Mutex
	_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		mu.Lock()
		defer mu.Unlock()
		polls++
		status := "running"
		if polls >= 3 {
			status = "succeeded"
		}
		return 200, `{"ok":true,"data":{"id":"op_1","instanceId":"inst_1","kind":"create","status":"` + status + `","steps":[],"error":null,"actorUserId":null,"createdAt":"t","finishedAt":null},"meta":{}}`
	})
	var seen []string
	op, err := client.Managed.Instances.WaitForOperation(context.Background(), tP, tI, "op_1", &WaitForOperationOptions{
		Interval:   time.Millisecond,
		OnProgress: func(o ManagedOperation) { seen = append(seen, o.Status) },
	})
	if err != nil || op.Status != "succeeded" || strings.Join(seen, ",") != "running,running,succeeded" {
		t.Fatalf("op = %+v, err = %v, seen = %v", op, err, seen)
	}

	_, stuck := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 200, `{"ok":true,"data":{"id":"op_1","status":"running","steps":[]},"meta":{}}`
	})
	_, err = stuck.Managed.Instances.WaitForOperation(context.Background(), tP, tI, "op_1", &WaitForOperationOptions{Interval: 5 * time.Millisecond, Timeout: 20 * time.Millisecond})
	if err == nil || !strings.Contains(err.Error(), "did not finish") {
		t.Fatalf("err = %v", err)
	}
}

func TestManagedListAllChannels(t *testing.T) {
	fake, client := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		if len(r.Query["cursor"]) == 0 {
			return 200, `{"ok":true,"data":{"items":[{"name":"a","type":"public","subscriptionCount":1,"userCount":null,"occupiedAt":null},{"name":"b","type":"public","subscriptionCount":1,"userCount":null,"occupiedAt":null}],"nextCursor":"c2","total":null},"meta":{}}`
		}
		return 200, `{"ok":true,"data":{"items":[{"name":"c","type":"public","subscriptionCount":1,"userCount":null,"occupiedAt":null}],"nextCursor":null,"total":null},"meta":{}}`
	})
	channels, err := client.Managed.Realtime.ListAllChannels(context.Background(), tP, tI, tA, &GetManagedRealtimeChannelsQuery{Limit: Float(2)})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, c := range channels {
		names = append(names, c.Name)
	}
	if strings.Join(names, ",") != "a,b,c" {
		t.Fatalf("names = %v", names)
	}
	reqs := fake.all()
	if len(reqs) != 2 || reqs[1].Query["cursor"][0] != "c2" || reqs[1].Query["limit"][0] != "2" {
		t.Fatalf("requests = %+v", reqs)
	}
}

// The operation table is generated from the Dashboard's openapi.json; when the
// spec is next to this repo, check that the table still matches it.
func TestManagedOperationsMatchSpec(t *testing.T) {
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
	managed := regexp.MustCompile(`/managed(/|$)`)
	fromSpec := map[string]string{}
	for route, methods := range spec.Paths {
		if !managed.MatchString(route) {
			continue
		}
		for method, op := range methods {
			fromSpec[op.OperationID] = strings.ToUpper(method) + " " + route
		}
	}
	fromTable := map[string]string{}
	for _, op := range managedOperations {
		fromTable[op.ID] = op.Method + " " + op.Path
	}
	if len(fromSpec) != len(fromTable) {
		t.Errorf("spec has %d managed operations, table has %d (run make generate-managed)", len(fromSpec), len(fromTable))
	}
	for id, want := range fromSpec {
		if fromTable[id] != want {
			t.Errorf("%s: table %q, spec %q (run make generate-managed)", id, fromTable[id], want)
		}
	}
}

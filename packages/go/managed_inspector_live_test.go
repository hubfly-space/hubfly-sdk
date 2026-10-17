package hubfly

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sync"
	"syscall"
	"testing"
	"time"
)

// Client.Managed.Realtime.OpenInspector against the REAL inspector socket of
// hubfly-realtime's rt-devserver; only the Dashboard's token endpoint is
// faked. Tokens are minted the way the Dashboard does (engine/src/core/
// managed/realtime/inspector.ts): EdDSA over the same header and claim order,
// with the public key in the engine's config.sync payload. Skipped unless
// HUBFLY_REALTIME_DEVSERVER names an rt-devserver binary:
//
//	(cd hubfly-realtime && go build -o /tmp/rt-devserver ./cmd/rt-devserver)
//	HUBFLY_REALTIME_DEVSERVER=/tmp/rt-devserver go test -run Live .

const (
	liveOrigin   = "https://api.hubfly.test"
	liveKid      = "ik_go"
	liveInstance = "msi_go"
	liveApp      = "1000001"
)

type liveEngine struct {
	t       *testing.T
	bin     string
	dir     string
	private ed25519.PrivateKey
	mu      sync.Mutex
	ws      string
	admin   string
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	exited  chan struct{}
}

func startLiveEngine(t *testing.T) *liveEngine {
	t.Helper()
	bin := os.Getenv("HUBFLY_REALTIME_DEVSERVER")
	if bin == "" {
		t.Skip("HUBFLY_REALTIME_DEVSERVER is not set (path to hubfly-realtime's rt-devserver)")
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(map[string]any{
		"generation": 1,
		"inspector": map[string]any{
			"public_keys": []map[string]string{{"kid": liveKid, "key": base64.RawURLEncoding.EncodeToString(public)}},
			"origins":     []string{liveOrigin},
		},
		"apps": []map[string]any{{
			"app_id": liveApp, "name": "production", "enabled": true,
			"settings": map[string]any{"inspector_payload_preview": true},
			"keys":     []map[string]any{{"key": "goinspectorkey000001", "secret": "go-inspector-secret-0123456789", "status": "active", "expires_at": nil}},
			"webhooks": []any{},
		}},
	})
	e := &liveEngine{t: t, bin: bin, dir: t.TempDir(), private: private}
	if err := os.WriteFile(filepath.Join(e.dir, "config.json"), config, 0o600); err != nil {
		t.Fatal(err)
	}
	e.start("127.0.0.1:0")
	t.Cleanup(e.stop)
	return e
}

func (e *liveEngine) start(listen string) {
	e.t.Helper()
	ready := filepath.Join(e.dir, "ready.json")
	_ = os.Remove(ready)
	cmd := exec.Command(e.bin, "-config", filepath.Join(e.dir, "config.json"), "-listen", listen, "-admin", "127.0.0.1:0",
		"-instance-id", liveInstance, "-cpu", "2", "-memory-mib", "4096", "-drain-budget", "1s",
		"-ready-file", ready, "-exit-with-stdin", "-log-level", "warn")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		e.t.Fatal(err)
	}
	cmd.Stdout, cmd.Stderr = io.Discard, os.Stderr
	if err := cmd.Start(); err != nil {
		e.t.Fatal(err)
	}
	e.cmd, e.stdin, e.exited = cmd, stdin, make(chan struct{})
	go func(done chan struct{}) { _ = cmd.Wait(); close(done) }(e.exited)
	deadline := time.Now().Add(10 * time.Second)
	for {
		raw, err := os.ReadFile(ready)
		if err == nil && bytes.HasSuffix(raw, []byte("\n")) {
			var line struct {
				Listeners []string `json:"listeners"`
				Admin     string   `json:"admin"`
			}
			if json.Unmarshal(raw, &line) == nil && len(line.Listeners) == 1 {
				e.mu.Lock()
				e.ws, e.admin = line.Listeners[0], line.Admin
				e.mu.Unlock()
				return
			}
		}
		if time.Now().After(deadline) {
			e.t.Fatal("rt-devserver did not become ready")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// stop drains (SIGTERM: inspector sessions close with 4000) and waits.
func (e *liveEngine) stop() {
	if e.cmd == nil {
		return
	}
	select {
	case <-e.exited:
		return
	default:
	}
	_ = e.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-e.exited:
	case <-time.After(10 * time.Second):
		_ = e.cmd.Process.Kill()
		<-e.exited
	}
	_ = e.stdin.Close()
}

func (e *liveEngine) addrs() (ws, admin string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ws, e.admin
}

type liveClaims struct {
	Iss  string   `json:"iss"`
	Aud  string   `json:"aud"`
	Sub  string   `json:"sub"`
	Scp  []string `json:"scp"`
	Apps []string `json:"apps"`
	Pv   bool     `json:"pv"`
	Orn  string   `json:"orn"`
	Iat  int64    `json:"iat"`
	Exp  int64    `json:"exp"`
	Jti  string   `json:"jti"`
}

func (e *liveEngine) mint(edit func(*liveClaims)) liveClaimsToken {
	jti := make([]byte, 10)
	_, _ = rand.Read(jti)
	now := time.Now().Unix()
	claims := liveClaims{Iss: "hubfly", Aud: liveInstance, Sub: "usr_go", Scp: []string{"inspect"}, Apps: []string{"*"},
		Orn: liveOrigin, Iat: now, Exp: now + 60, Jti: "it_" + hex.EncodeToString(jti)}
	if edit != nil {
		edit(&claims)
	}
	body, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"EdDSA","typ":"JWT","kid":"`+liveKid+`"}`)) + "." +
		base64.RawURLEncoding.EncodeToString(body)
	return liveClaimsToken{token: input + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(e.private, []byte(input))), claims: claims}
}

type liveClaimsToken struct {
	token  string
	claims liveClaims
}

func (e *liveEngine) publish(channel, event, data string) {
	e.t.Helper()
	_, admin := e.addrs()
	raw, _ := json.Marshal(map[string]any{"v": 1, "id": "go", "cmd": "publish", "args": map[string]any{
		"app_id": liveApp, "event": event, "data": data, "channels": []string{channel}, "socket_ids": nil, "user_id": nil}})
	response, err := http.Post("http://"+admin+"/ctl", "application/json", bytes.NewReader(raw))
	if err != nil {
		e.t.Fatalf("publish: %v", err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
}

// burst offers ~n inspector events within a second (above the 500/s cap).
func (e *liveEngine) burst(channel string, n int) {
	_, admin := e.addrs()
	client := &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: 8}}
	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < n/8; i++ {
				raw, _ := json.Marshal(map[string]any{"v": 1, "id": "b", "cmd": "publish", "args": map[string]any{
					"app_id": liveApp, "event": "burst", "data": "x", "channels": []string{channel}, "socket_ids": nil, "user_id": nil}})
				if response, err := client.Post("http://"+admin+"/ctl", "application/json", bytes.NewReader(raw)); err == nil {
					_, _ = io.Copy(io.Discard, response.Body)
					response.Body.Close()
				}
			}
		}()
	}
	wg.Wait()
}

// liveClient is a Client whose Dashboard token endpoint mints real engine tokens.
func liveClient(t *testing.T, e *liveEngine, edit func(*liveClaims)) (*Client, *fakeManagedAPI) {
	api, client := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		var body struct {
			Apps           []string `json:"apps"`
			PayloadPreview bool     `json:"payloadPreview"`
		}
		_ = json.Unmarshal([]byte(r.Body), &body)
		minted := e.mint(func(c *liveClaims) {
			c.Pv = body.PayloadPreview
			if len(body.Apps) > 0 {
				c.Apps = body.Apps
			}
			if edit != nil {
				edit(c)
			}
		})
		ws, _ := e.addrs()
		data, _ := json.Marshal(CreateManagedRealtimeInspectorTokenResponse{
			Token: minted.token, URL: "ws://" + ws + "/hubfly/v1/inspect", ExpiresAt: time.Unix(minted.claims.Exp, 0).UTC().Format(time.RFC3339),
			Origin: minted.claims.Orn, Apps: minted.claims.Apps, PayloadPreview: minted.claims.Pv,
		})
		return 200, `{"ok":true,"data":` + string(data) + `,"meta":{}}`
	})
	return client, api
}

type liveRecorder struct {
	mu       sync.Mutex
	events   []InspectorEvent
	sampling []float64
	dropped  []int64
	closes   []int
}

func (r *liveRecorder) options() InspectorOptions {
	return InspectorOptions{
		OnEvent:    func(e InspectorEvent) { r.mu.Lock(); r.events = append(r.events, e); r.mu.Unlock() },
		OnSampling: func(rate float64) { r.mu.Lock(); r.sampling = append(r.sampling, rate); r.mu.Unlock() },
		OnDropped:  func(count int64) { r.mu.Lock(); r.dropped = append(r.dropped, count); r.mu.Unlock() },
		OnClose:    func(info InspectorCloseInfo) { r.mu.Lock(); r.closes = append(r.closes, info.Code); r.mu.Unlock() },
		KeepAlive:  -1,
	}
}

func (r *liveRecorder) event(name string) *InspectorEvent {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range r.events {
		if r.events[i].Fields["event"] == name {
			return &r.events[i]
		}
	}
	return nil
}

func liveWait(t *testing.T, what string, within time.Duration, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestInspectorLiveEventsFilterSamplingDropped(t *testing.T) {
	engine := startLiveEngine(t)
	client, api := liveClient(t, engine, nil)
	rec := &liveRecorder{}
	opts := rec.options()
	opts.Apps, opts.PayloadPreview = []string{liveApp}, true
	opts.Filter = &InspectorFilter{Families: []string{"msg"}, ChannelPrefix: "orders"}
	session, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &opts)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	assertJSON(t, api.all()[0].Body, `{"apps":["1000001"],"payloadPreview":true}`)
	if session.Ready.SessionID == "" || session.Ready.Sampling != 1 || len(session.Ready.Apps) != 1 || session.Ready.Apps[0] != liveApp {
		t.Fatalf("ready = %+v", session.Ready)
	}
	time.Sleep(50 * time.Millisecond) // the filter frame follows ready
	engine.publish("orders-1", "first", `{"n":1}`)
	engine.publish("misc", "filtered-out", `{"n":2}`)
	engine.publish("orders-2", "second", `{"n":3}`)
	liveWait(t, "events", 5*time.Second, func() bool { return rec.event("second") != nil })
	if rec.event("filtered-out") != nil {
		t.Fatal("the filter frame was not applied")
	}
	first := rec.event("first")
	if first.Kind != "msg.publish" || first.Family != "msg" || first.AppID != liveApp || first.Seq == 0 || first.T == 0 {
		t.Fatalf("event = %+v", first)
	}
	if first.Fields["preview"] != `{"n":1}` || first.Fields["source"] != "console" || first.Fields["encrypted"] != false {
		t.Fatalf("fields = %v", first.Fields)
	}
	if channels, _ := first.Fields["channels"].([]any); len(channels) != 1 || channels[0] != "orders-1" {
		t.Fatalf("channels = %v", first.Fields["channels"])
	}
	if !json.Valid(first.Raw) {
		t.Fatalf("raw = %s", first.Raw)
	}

	engine.burst("orders-burst", 2400)
	// The engine announces sampling on the first event of the next window
	// (if it comes within 2 s); tick until both frames have arrived.
	liveWait(t, "dropped and sampling frames", 8*time.Second, func() bool {
		rec.mu.Lock()
		seen := len(rec.dropped) > 0 && slices.ContainsFunc(rec.sampling, func(rate float64) bool { return rate < 1 })
		rec.mu.Unlock()
		if !seen {
			engine.publish("orders-tick", "tick", "{}")
			time.Sleep(140 * time.Millisecond)
		}
		return seen
	})
	rec.mu.Lock()
	for _, count := range rec.dropped {
		if count <= 0 {
			t.Errorf("dropped count %d", count)
		}
	}
	lowest := 1.0
	for _, rate := range rec.sampling {
		lowest = min(lowest, rate)
	}
	rec.mu.Unlock()
	if lowest <= 0 || lowest >= 1 {
		t.Fatalf("sampling rates %v", rec.sampling)
	}
	time.Sleep(2100 * time.Millisecond)
	engine.publish("orders-4", "idle-again", "{}")
	liveWait(t, "sampling back to 1", 5*time.Second, func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return rec.sampling[len(rec.sampling)-1] == 1
	})
}

func TestInspectorLiveDrainAndFreshToken(t *testing.T) {
	engine := startLiveEngine(t)
	client, api := liveClient(t, engine, nil)
	rec := &liveRecorder{}
	opts := rec.options()
	session, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &opts)
	if err != nil {
		t.Fatal(err)
	}
	listen, _ := engine.addrs()
	engine.stop()
	select {
	case <-session.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the session did not end on drain")
	}
	if info := session.CloseInfo(); info.Code != 4000 {
		t.Fatalf("close = %+v", info)
	}
	if len(rec.closes) != 1 || rec.closes[0] != 4000 {
		t.Fatalf("OnClose = %v", rec.closes)
	}
	engine.start(listen)
	rec2 := &liveRecorder{}
	opts2 := rec2.options()
	again, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &opts2)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if len(api.all()) != 2 {
		t.Fatalf("token requests = %d, want a fresh token", len(api.all()))
	}
	engine.publish("again", "after-restart", "{}")
	liveWait(t, "an event after the restart", 5*time.Second, func() bool { return rec2.event("after-restart") != nil })
	if rec2.event("after-restart").Fields["preview"] != nil {
		t.Fatal("no preview without the grant")
	}
}

func TestInspectorLiveRefusals(t *testing.T) {
	engine := startLiveEngine(t)
	closeCode := func(err error) int {
		var closeErr *InspectorCloseError
		if errors.As(err, &closeErr) {
			return closeErr.Code
		}
		t.Fatalf("err = %v, want *InspectorCloseError", err)
		return 0
	}
	evil, _ := liveClient(t, engine, func(c *liveClaims) { c.Orn = "https://evil.hubfly.test" })
	_, err := evil.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &InspectorOptions{KeepAlive: -1})
	if code := closeCode(err); code != 4403 {
		t.Fatalf("origin: close %d, want 4403", code)
	}
	expired, _ := liveClient(t, engine, func(c *liveClaims) { c.Iat, c.Exp = c.Iat-300, c.Iat-240 })
	_, err = expired.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &InspectorOptions{KeepAlive: -1})
	if code := closeCode(err); code != 4401 {
		t.Fatalf("expired: close %d, want 4401", code)
	}
	client, _ := liveClient(t, engine, nil)
	for i := 0; i < 5; i++ {
		session, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &InspectorOptions{KeepAlive: -1})
		if err != nil {
			t.Fatalf("session %d: %v", i, err)
		}
		defer session.Close()
	}
	_, err = client.Managed.Realtime.OpenInspector(context.Background(), tP, liveInstance, &InspectorOptions{KeepAlive: -1})
	if code := closeCode(err); code != 4429 {
		t.Fatalf("sixth session: close %d, want 4429", code)
	}
}

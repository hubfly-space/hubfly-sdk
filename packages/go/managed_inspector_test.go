package hubfly

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// In-process fake of the engine's inspector socket (WIRE.md "Inspector").
type fakeInspector struct {
	server  *httptest.Server
	mu      sync.Mutex
	origins []string
	uris    []string
	frames  []map[string]any
}

type fakeWSConn struct {
	conn   net.Conn
	reader *InspectorSession // reuses the client's frame reader (it unmasks)
	mu     sync.Mutex
}

func (c *fakeWSConn) write(opcode byte, payload []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	header := []byte{0x80 | opcode}
	if len(payload) < 126 {
		header = append(header, byte(len(payload)))
	} else {
		header = append(header, 126, byte(len(payload)>>8), byte(len(payload)))
	}
	_, _ = c.conn.Write(append(header, payload...))
}

func (c *fakeWSConn) sendJSON(v any) {
	data, _ := json.Marshal(v)
	c.write(wsOpText, data)
}

func (c *fakeWSConn) close(code int, reason string) {
	payload := binary.BigEndian.AppendUint16(nil, uint16(code))
	c.write(wsOpClose, append(payload, reason...))
}

// newFakeInspector serves the socket; onAuth runs after the auth frame.
func newFakeInspector(t *testing.T, onAuth func(c *fakeWSConn, token string)) *fakeInspector {
	t.Helper()
	f := &fakeInspector{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.origins = append(f.origins, r.Header.Get("Origin"))
		f.uris = append(f.uris, r.URL.RequestURI())
		f.mu.Unlock()
		key := r.Header.Get("Sec-WebSocket-Key")
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || key == "" {
			http.Error(w, "expected a WebSocket", http.StatusBadRequest)
			return
		}
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		sum := sha1.Sum([]byte(key + wsAcceptGUID))
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
			base64.StdEncoding.EncodeToString(sum[:]) + "\r\n\r\n")
		_ = rw.Flush()
		c := &fakeWSConn{conn: conn, reader: &InspectorSession{conn: conn, reader: bufio.NewReader(rw.Reader)}}
		go func() {
			defer conn.Close()
			for {
				op, data, err := c.reader.readMessage()
				if err != nil {
					return
				}
				if op == wsOpClose {
					c.write(wsOpClose, data)
					return
				}
				var frame map[string]any
				if json.Unmarshal(data, &frame) != nil {
					continue
				}
				f.mu.Lock()
				f.frames = append(f.frames, frame)
				f.mu.Unlock()
				switch frame["type"] {
				case "auth":
					token, _ := frame["token"].(string)
					onAuth(c, token)
				case "ping":
					c.sendJSON(map[string]string{"type": "pong"})
				}
			}
		}()
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeInspector) snapshot() (origins, uris []string, frames []map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.origins...), append([]string(nil), f.uris...), append([]map[string]any(nil), f.frames...)
}

const testInspectorToken = "eyJhbGciOiJFZERTQSJ9.eyJhdWQiOiJpbnNwZWN0In0.c2ln"

func inspectorClient(t *testing.T, f *fakeInspector) (*Client, *fakeManagedAPI) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(f.server.URL, "http") + "/hubfly/v1/inspect"
	api, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 200, `{"ok":true,"data":{"token":"` + testInspectorToken + `","url":"` + wsURL + `","expiresAt":"x","origin":"https://api.example.test","apps":["1000001"],"payloadPreview":false},"meta":{}}`
	})
	return client, api
}

func waitUntil(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestInspectorSession(t *testing.T) {
	f := newFakeInspector(t, func(c *fakeWSConn, token string) {
		if token != testInspectorToken {
			c.close(4401, "bad token")
			return
		}
		c.sendJSON(map[string]any{"type": "ready", "session_id": "is_1", "apps": []string{"1000001"}, "expires_at": "2026-10-17T11:00:00Z", "sampling": 1})
	})
	client, api := inspectorClient(t, f)

	session, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, tI, &InspectorOptions{
		Apps:      []string{"1000001"},
		Filter:    &InspectorFilter{Apps: []string{"1000001"}, Families: []string{"msg"}, ChannelPrefix: "orders"},
		KeepAlive: -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if session.Ready.SessionID != "is_1" || session.Ready.Sampling != 1 || len(session.Ready.Apps) != 1 {
		t.Fatalf("ready = %+v", session.Ready)
	}
	assertJSON(t, api.all()[0].Body, `{"apps":["1000001"]}`)
	origins, uris, _ := f.snapshot()
	if origins[0] != "https://api.example.test" {
		t.Errorf("Origin = %q", origins[0])
	}
	if strings.Contains(uris[0], testInspectorToken) || uris[0] != "/hubfly/v1/inspect" {
		t.Errorf("URI = %q", uris[0])
	}
	waitUntil(t, func() bool { _, _, frames := f.snapshot(); return len(frames) >= 2 })
	_, _, frames := f.snapshot()
	if frames[0]["type"] != "auth" || frames[0]["token"] != testInspectorToken {
		t.Errorf("first frame = %v", frames[0])
	}
	filter, _ := json.Marshal(frames[1])
	assertJSON(t, string(filter), `{"type":"filter","apps":["1000001"],"families":["msg"],"channel_prefix":"orders"}`)

	// The server streams events; ping/filter go out.
	if err := session.Ping(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { _, _, frames := f.snapshot(); return len(frames) >= 3 })
	_ = session.SetFilter(InspectorFilter{})
	waitUntil(t, func() bool { _, _, frames := f.snapshot(); return len(frames) >= 4 })
	_, _, frames = f.snapshot()
	if frames[2]["type"] != "ping" || len(frames[3]) != 1 || frames[3]["type"] != "filter" {
		t.Errorf("frames = %v", frames[2:])
	}

	if err := session.Close(); err != nil {
		t.Fatal(err)
	}
	if info := session.CloseInfo(); info.Code != 1000 {
		t.Errorf("close info = %+v", info)
	}
	if err := session.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
}

func TestInspectorStreamsEvents(t *testing.T) {
	f := newFakeInspector(t, func(c *fakeWSConn, token string) {
		c.sendJSON(map[string]any{"type": "ready", "session_id": "is_3", "apps": []string{"*"}, "expires_at": "x", "sampling": 1})
		c.sendJSON(map[string]any{"type": "event", "seq": 42, "t": int64(1760600000000), "app_id": "1000001", "family": "msg", "kind": "msg.publish", "channels": []string{"orders"}, "event": "order.updated", "size": 120, "recipients": 4, "source": "api", "encrypted": false})
		c.sendJSON(map[string]any{"type": "sampling", "rate": 0.25})
		c.sendJSON(map[string]any{"type": "dropped", "count": 120})
		c.close(4000, "expired")
	})
	client, _ := inspectorClient(t, f)
	var events []InspectorEvent
	var rates []float64
	var dropped []int64
	var closes []InspectorCloseInfo
	session, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, tI, &InspectorOptions{
		KeepAlive:  -1,
		OnEvent:    func(e InspectorEvent) { events = append(events, e) },
		OnSampling: func(rate float64) { rates = append(rates, rate) },
		OnDropped:  func(count int64) { dropped = append(dropped, count) },
		OnClose:    func(info InspectorCloseInfo) { closes = append(closes, info) },
	})
	if err != nil {
		t.Fatal(err)
	}
	<-session.Done()
	// Callbacks run on the reader goroutine before Done closes.
	if len(events) != 1 || events[0].Seq != 42 || events[0].Kind != "msg.publish" || events[0].AppID != "1000001" || events[0].T != 1760600000000 {
		t.Fatalf("events = %+v", events)
	}
	if events[0].Fields["recipients"] != float64(4) || events[0].Fields["event"] != "order.updated" {
		t.Errorf("fields = %v", events[0].Fields)
	}
	if len(rates) != 1 || rates[0] != 0.25 || len(dropped) != 1 || dropped[0] != 120 {
		t.Errorf("rates = %v dropped = %v", rates, dropped)
	}
	if len(closes) != 1 || closes[0].Code != 4000 || !strings.Contains(closes[0].Message, "expired") {
		t.Errorf("closes = %+v", closes)
	}
}

func TestInspectorRefused(t *testing.T) {
	f := newFakeInspector(t, func(c *fakeWSConn, token string) { c.close(4401, "invalid token") })
	client, _ := inspectorClient(t, f)
	_, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, tI, &InspectorOptions{KeepAlive: -1})
	var closeErr *InspectorCloseError
	if !errors.As(err, &closeErr) || closeErr.Code != 4401 || !strings.Contains(closeErr.Message, "inspector token") {
		t.Fatalf("err = %v", err)
	}
}

func TestInspectorReadyTimeout(t *testing.T) {
	f := newFakeInspector(t, func(*fakeWSConn, string) {})
	client, _ := inspectorClient(t, f)
	start := time.Now()
	_, err := client.Managed.Realtime.OpenInspector(context.Background(), tP, tI, &InspectorOptions{KeepAlive: -1, ReadyTimeout: 100 * time.Millisecond})
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("err = %v after %v", err, time.Since(start))
	}
}

func TestDescribeInspectorCloseReplaced(t *testing.T) {
	info := DescribeInspectorClose(4409, "")
	if info.Code != 4409 || !strings.Contains(info.Message, "do not reconnect") {
		t.Fatalf("4409 described as %+v", info)
	}
}

package realtime_test

// A minimal RFC 6455 client for the live tests (text frames, ping/pong, close), so the module
// needs no WebSocket dependency. It plays the browser side of a HubFly Realtime connection.

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// frame is one Pusher/HubFly event frame.
type frame struct {
	Event   string          `json:"event"`
	Channel string          `json:"channel,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	UserID  string          `json:"user_id,omitempty"`
	Hubfly  *frameMeta      `json:"hubfly,omitempty"`
}

type frameMeta struct {
	Kind   string `json:"k"`
	ID     string `json:"m"`
	Ack    bool   `json:"ack"`
	Epoch  string `json:"e"`
	Offset int64  `json:"o"`
}

// text returns the frame's data: the JSON-encoded string servers send for events, or the raw
// object of pusher:error and friends.
func (f frame) text() string {
	var s string
	if json.Unmarshal(f.Data, &s) == nil {
		return s
	}
	return string(f.Data)
}

type liveSocket struct {
	t        *testing.T
	conn     net.Conn
	br       *bufio.Reader
	wmu      sync.Mutex
	frames   chan frame
	closed   chan int // close code (1006 when the TCP connection ended without a close frame)
	SocketID string
	Hello    map[string]any
}

// dialSocket connects to /app/<key> (hubfly=false) or /hubfly/v1/app/<key> (sending
// hubfly:hello) and waits for pusher:connection_established.
func dialSocket(t *testing.T, base, key string, hubfly bool) *liveSocket {
	t.Helper()
	if !hubfly {
		return dialHello(t, base, key, nil)
	}
	return dialHello(t, base, key, map[string]any{"v": 1, "features": []string{"ack", "offsets"}})
}

// dialHello connects to /hubfly/v1/app/<key> and sends this hubfly:hello (to /app/<key> without
// one when hello is nil), then waits for pusher:connection_established.
func dialHello(t *testing.T, base, key string, hello map[string]any) *liveSocket {
	t.Helper()
	hubfly := hello != nil
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	path := "/app/" + key
	if hubfly {
		path = "/hubfly/v1/app/" + key
	}
	host := u.Host
	if u.Port() == "" {
		host += ":80"
	}
	conn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, 16)
	_, _ = rand.Read(nonce)
	wsKey := base64.StdEncoding.EncodeToString(nonce)
	req := "GET " + path + "?protocol=7&client=hubfly-go-live&version=0.1.0 HTTP/1.1\r\nHost: " + u.Host +
		"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + wsKey + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
	if _, err := io.WriteString(conn, req); err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha1.Sum([]byte(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	if res.StatusCode != http.StatusSwitchingProtocols || res.Header.Get("Sec-WebSocket-Accept") != base64.StdEncoding.EncodeToString(sum[:]) {
		t.Fatalf("upgrade %s: %s", path, res.Status)
	}
	s := &liveSocket{t: t, conn: conn, br: br, frames: make(chan frame, 256), closed: make(chan int, 1)}
	go s.readLoop()
	t.Cleanup(func() { s.Close(1000) })
	if hubfly {
		s.Send("hubfly:hello", hello, "")
	}
	f := s.Next(func(f frame) bool { return f.Event == "pusher:connection_established" })
	var est map[string]any
	if err := json.Unmarshal([]byte(f.text()), &est); err != nil {
		t.Fatal(err)
	}
	s.SocketID, _ = est["socket_id"].(string)
	s.Hello, _ = est["hubfly"].(map[string]any)
	return s
}

func (s *liveSocket) readLoop() {
	defer close(s.frames)
	var msg []byte
	for {
		fin, op, payload, err := s.readFrame()
		if err != nil {
			select {
			case s.closed <- 1006:
			default:
			}
			return
		}
		switch op {
		case 0x8: // close
			code := 1005
			if len(payload) >= 2 {
				code = int(binary.BigEndian.Uint16(payload))
			}
			s.closed <- code
			_ = s.writeFrame(0x8, payload[:min(2, len(payload))])
			return
		case 0x9: // ping
			_ = s.writeFrame(0xA, payload)
		case 0x1, 0x0:
			msg = append(msg, payload...)
			if !fin {
				continue
			}
			var f frame
			if err := json.Unmarshal(msg, &f); err == nil {
				if f.Event == "pusher:ping" {
					s.Send("pusher:pong", map[string]any{}, "")
				} else {
					s.frames <- f
				}
			}
			msg = nil
		}
	}
}

func (s *liveSocket) readFrame() (fin bool, op byte, payload []byte, err error) {
	var h [2]byte
	if _, err = io.ReadFull(s.br, h[:]); err != nil {
		return
	}
	fin, op = h[0]&0x80 != 0, h[0]&0x0F
	n := uint64(h[1] & 0x7F)
	switch n {
	case 126:
		var b [2]byte
		if _, err = io.ReadFull(s.br, b[:]); err != nil {
			return
		}
		n = uint64(binary.BigEndian.Uint16(b[:]))
	case 127:
		var b [8]byte
		if _, err = io.ReadFull(s.br, b[:]); err != nil {
			return
		}
		n = binary.BigEndian.Uint64(b[:])
	}
	if h[1]&0x80 != 0 || n > 16<<20 {
		return false, 0, nil, errors.New("masked or oversized server frame")
	}
	payload = make([]byte, n)
	_, err = io.ReadFull(s.br, payload)
	return
}

func (s *liveSocket) writeFrame(op byte, payload []byte) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	b := []byte{0x80 | op}
	switch n := len(payload); {
	case n < 126:
		b = append(b, 0x80|byte(n))
	case n <= 0xFFFF:
		b = append(b, 0x80|126, byte(n>>8), byte(n))
	default:
		b = append(b, 0x80|127)
		b = binary.BigEndian.AppendUint64(b, uint64(n))
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	b = append(b, mask...)
	for i, c := range payload {
		b = append(b, c^mask[i%4])
	}
	_ = s.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err := s.conn.Write(b)
	return err
}

// Send writes an event frame; data is sent as a JSON object (the engine accepts objects and
// strings).
func (s *liveSocket) Send(event string, data any, channel string) {
	s.t.Helper()
	f := map[string]any{"event": event, "data": data}
	if channel != "" {
		f["channel"] = channel
	}
	b, _ := json.Marshal(f)
	if err := s.writeFrame(0x1, b); err != nil {
		s.t.Fatalf("send %s: %v", event, err)
	}
}

// Next returns the next frame that matches (frames before it are dropped).
func (s *liveSocket) Next(match func(frame) bool) frame {
	s.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				s.t.Fatal("connection closed while waiting for a frame")
			}
			if match(f) {
				return f
			}
		case <-timeout:
			s.t.Fatal("timeout waiting for a frame")
		}
	}
}

// Event waits for an application event (not pusher:/pusher_internal:).
func (s *liveSocket) Event(name string) frame {
	s.t.Helper()
	return s.Next(func(f frame) bool { return f.Event == name })
}

// None fails when a frame with this event arrives within d.
func (s *liveSocket) None(name string, d time.Duration) {
	s.t.Helper()
	deadline := time.After(d)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				return
			}
			if f.Event == name {
				s.t.Fatalf("unexpected %s: %s", name, f.Data)
			}
		case <-deadline:
			return
		}
	}
}

// Subscribe sends pusher:subscribe and waits for the outcome. auth/channelData may be empty.
func (s *liveSocket) Subscribe(channel, auth, channelData string) frame {
	s.t.Helper()
	d := map[string]any{"channel": channel}
	if auth != "" {
		d["auth"] = auth
	}
	if channelData != "" {
		d["channel_data"] = channelData
	}
	s.Send("pusher:subscribe", d, "")
	return s.Next(func(f frame) bool {
		return f.Channel == channel && (f.Event == "pusher_internal:subscription_succeeded" || f.Event == "pusher:subscription_error")
	})
}

// WaitClose returns the close code the server sent.
func (s *liveSocket) WaitClose() int {
	s.t.Helper()
	select {
	case code := <-s.closed:
		return code
	case <-time.After(5 * time.Second):
		s.t.Fatal("timeout waiting for the close")
		return 0
	}
}

// Close sends a close frame and closes the TCP connection.
func (s *liveSocket) Close(code int) {
	_ = s.writeFrame(0x8, []byte{byte(code >> 8), byte(code)})
	_ = s.conn.Close()
}

func (f frame) String() string {
	return fmt.Sprintf("%s %s %s", f.Event, f.Channel, strings.TrimSpace(string(f.Data)))
}

package hubfly

// Inspector socket client (WIRE.md "Inspector", wss://<host>/hubfly/v1/inspect):
// the live event stream of a realtime server for debugging. The token comes
// from the Dashboard (CreateInspectorToken) and travels only in the first
// frame, never in the URL. The WebSocket client below is a minimal RFC 6455
// implementation, so the SDK keeps no dependencies.

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
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
	"sync/atomic"
	"time"
)

// InspectorReady is the ready frame of an inspector session.
type InspectorReady struct {
	SessionID string   `json:"session_id"`
	Apps      []string `json:"apps"` // ["*"] for all apps
	ExpiresAt string   `json:"expires_at"`
	Sampling  float64  `json:"sampling"` // fraction of events delivered (1 = all)
}

// InspectorEvent is one inspector event. Kind-specific fields (channels,
// event, size, socket_id, ...; see WIRE.md "Inspector") are in Fields.
type InspectorEvent struct {
	Seq    int64  `json:"seq"`
	T      int64  `json:"t"` // Unix time in milliseconds
	AppID  string `json:"app_id"`
	Family string `json:"family"` // conn, sub, member, msg, api, err or webhook
	Kind   string `json:"kind"`   // e.g. "msg.publish"
	// Fields holds every field of the frame, the common ones included.
	Fields map[string]any `json:"-"`
	// Raw is the frame as received.
	Raw json.RawMessage `json:"-"`
}

// InspectorFilter narrows the stream; empty fields show everything the token allows.
type InspectorFilter struct {
	Apps          []string
	Families      []string
	ChannelPrefix string
}

// InspectorCloseInfo describes how an inspector socket closed.
type InspectorCloseInfo struct {
	Code    int
	Reason  string
	Message string // what the close code means
}

// InspectorCloseError is returned when the server closes the socket before
// the session is ready (bad token 4401, origin 4403, no auth 4408, too many
// sessions 4429).
type InspectorCloseError struct{ InspectorCloseInfo }

func (e *InspectorCloseError) Error() string {
	return fmt.Sprintf("inspector: %s (close %d)", e.Message, e.Code)
}

var inspectorCloseMessages = map[int]string{
	1000: "closed",
	4000: "session expired (1 hour) or the realtime server is draining",
	4401: "missing, invalid, expired or replayed inspector token",
	4403: "origin not allowed for the inspector",
	4408: "no auth frame within 5 s",
	4409: "replaced by a newer inspector session of the same user (do not reconnect automatically)",
	4429: "more than 5 inspector sessions on this realtime server",
}

// DescribeInspectorClose explains an inspector close code.
func DescribeInspectorClose(code int, reason string) InspectorCloseInfo {
	message, ok := inspectorCloseMessages[code]
	if !ok {
		message = reason
		if message == "" {
			message = fmt.Sprintf("inspector socket closed (%d)", code)
		}
	}
	return InspectorCloseInfo{Code: code, Reason: reason, Message: message}
}

// InspectorOptions configures OpenInspector and ConnectInspector.
type InspectorOptions struct {
	// Token request (OpenInspector only): see CreateManagedRealtimeInspectorTokenBody.
	Origin         string
	Apps           []string
	PayloadPreview bool

	// Filter is sent right after the session is ready.
	Filter *InspectorFilter
	// Callbacks run on the reader goroutine, one at a time; OnClose runs
	// before Done is closed.
	OnEvent    func(InspectorEvent)
	OnSampling func(rate float64)
	OnDropped  func(count int64)
	OnClose    func(InspectorCloseInfo)
	// KeepAlive sends {"type":"ping"} this often (default 30 s; negative disables).
	KeepAlive time.Duration
	// ReadyTimeout bounds connecting until the ready frame (default 10 s).
	ReadyTimeout time.Duration
	// TLSConfig is used for wss:// URLs (default: system roots).
	TLSConfig *tls.Config
}

// InspectorSession is a live inspector session.
type InspectorSession struct {
	// Ready is the server's ready frame.
	Ready InspectorReady

	conn    net.Conn
	reader  *bufio.Reader
	writeMu sync.Mutex
	closing chan struct{}
	done    chan struct{}
	once    sync.Once
	ended   atomic.Bool
	info    InspectorCloseInfo
}

// OpenInspector mints an inspector token (realtime:publish; see
// CreateInspectorToken), connects to the server's /hubfly/v1/inspect socket
// with the token's origin and sends the token as the first frame. It returns
// once the server answers ready, or an *InspectorCloseError. Events arrive
// through the callbacks. Needs a realtime engine with the inspector socket.
func (s *ManagedRealtimeService) OpenInspector(ctx context.Context, projectID, instanceID string, opts *InspectorOptions) (*InspectorSession, error) {
	var o InspectorOptions
	if opts != nil {
		o = *opts
	}
	body := CreateManagedRealtimeInspectorTokenBody{Origin: o.Origin, Apps: o.Apps}
	if o.PayloadPreview {
		body.PayloadPreview = Ptr(true)
	}
	grant, err := s.CreateInspectorToken(ctx, projectID, instanceID, body)
	if err != nil {
		return nil, err
	}
	return ConnectInspector(ctx, grant.Data, &o)
}

// ConnectInspector connects with an inspector token from CreateInspectorToken.
func ConnectInspector(ctx context.Context, grant CreateManagedRealtimeInspectorTokenResponse, opts *InspectorOptions) (*InspectorSession, error) {
	var o InspectorOptions
	if opts != nil {
		o = *opts
	}
	readyTimeout := o.ReadyTimeout
	if readyTimeout <= 0 {
		readyTimeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, readyTimeout)
	defer cancel()

	conn, reader, err := dialInspector(ctx, grant.URL, grant.Origin, o.TLSConfig)
	if err != nil {
		return nil, err
	}
	s := &InspectorSession{conn: conn, reader: reader, closing: make(chan struct{}), done: make(chan struct{})}
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	ready, err := s.authenticate(grant.Token)
	stop()
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	s.Ready = ready

	if o.Filter != nil {
		if err := s.SetFilter(*o.Filter); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	go s.readLoop(&o)
	keepAlive := o.KeepAlive
	if keepAlive == 0 {
		keepAlive = 30 * time.Second
	}
	if keepAlive > 0 {
		go s.keepAlive(keepAlive)
	}
	return s, nil
}

func (s *InspectorSession) authenticate(token string) (InspectorReady, error) {
	auth, _ := json.Marshal(map[string]string{"type": "auth", "token": token})
	if err := s.writeFrame(wsOpText, auth); err != nil {
		return InspectorReady{}, fmt.Errorf("inspector: %w", err)
	}
	for {
		op, data, err := s.readMessage()
		if err != nil {
			return InspectorReady{}, fmt.Errorf("inspector: waiting for ready: %w", err)
		}
		if op == wsOpClose {
			code, reason := parseClosePayload(data)
			return InspectorReady{}, &InspectorCloseError{DescribeInspectorClose(code, reason)}
		}
		var frame struct {
			Type string `json:"type"`
		}
		if op != wsOpText || json.Unmarshal(data, &frame) != nil || frame.Type != "ready" {
			continue
		}
		var ready InspectorReady
		if err := json.Unmarshal(data, &ready); err != nil {
			return InspectorReady{}, fmt.Errorf("inspector: bad ready frame: %w", err)
		}
		return ready, nil
	}
}

func (s *InspectorSession) readLoop(o *InspectorOptions) {
	for {
		op, data, err := s.readMessage()
		if err != nil {
			select {
			case <-s.closing:
				s.finish(DescribeInspectorClose(1000, "client closed"), o)
			default:
				s.finish(DescribeInspectorClose(1006, err.Error()), o)
			}
			return
		}
		if op == wsOpClose {
			code, reason := parseClosePayload(data)
			select {
			case <-s.closing:
			default:
				_ = s.writeFrame(wsOpClose, data[:min(len(data), 2)])
			}
			s.finish(DescribeInspectorClose(code, reason), o)
			return
		}
		if op != wsOpText {
			continue
		}
		var frame struct {
			Type  string  `json:"type"`
			Rate  float64 `json:"rate"`
			Count int64   `json:"count"`
		}
		if json.Unmarshal(data, &frame) != nil {
			continue
		}
		switch frame.Type {
		case "event":
			if o.OnEvent == nil {
				continue
			}
			var event InspectorEvent
			if json.Unmarshal(data, &event) != nil {
				continue
			}
			_ = json.Unmarshal(data, &event.Fields)
			event.Raw = append(json.RawMessage(nil), data...)
			o.OnEvent(event)
		case "sampling":
			if o.OnSampling != nil {
				o.OnSampling(frame.Rate)
			}
		case "dropped":
			if o.OnDropped != nil {
				o.OnDropped(frame.Count)
			}
		}
	}
}

func (s *InspectorSession) keepAlive(every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			_ = s.Ping()
		}
	}
}

// finish runs OnClose before Done is closed, so everything the callbacks did
// is visible to code waiting on Done.
func (s *InspectorSession) finish(info InspectorCloseInfo, o *InspectorOptions) {
	s.once.Do(func() {
		s.info = info
		s.ended.Store(true)
		_ = s.conn.Close()
		if o.OnClose != nil {
			o.OnClose(info)
		}
		close(s.done)
	})
}

// SetFilter replaces the filter (an empty filter shows everything the token allows).
func (s *InspectorSession) SetFilter(filter InspectorFilter) error {
	frame := map[string]any{"type": "filter"}
	if filter.Apps != nil {
		frame["apps"] = filter.Apps
	}
	if filter.Families != nil {
		frame["families"] = filter.Families
	}
	if filter.ChannelPrefix != "" {
		frame["channel_prefix"] = filter.ChannelPrefix
	}
	data, _ := json.Marshal(frame)
	return s.writeFrame(wsOpText, data)
}

// Ping sends {"type":"ping"}; the server answers {"type":"pong"}.
func (s *InspectorSession) Ping() error {
	return s.writeFrame(wsOpText, []byte(`{"type":"ping"}`))
}

// Close ends the session and waits briefly for the server's close frame.
func (s *InspectorSession) Close() error {
	if s.ended.Load() {
		return nil // already over (also when called from OnClose)
	}
	select {
	case <-s.closing:
		return nil
	default:
		close(s.closing)
	}
	payload := make([]byte, 2, 2+len("client closed"))
	binary.BigEndian.PutUint16(payload, 1000)
	payload = append(payload, "client closed"...)
	err := s.writeFrame(wsOpClose, payload)
	_ = s.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	<-s.done
	return err
}

// Done is closed when the session ends; CloseInfo then says why.
func (s *InspectorSession) Done() <-chan struct{} { return s.done }

// CloseInfo describes how the session ended (valid after Done is closed).
func (s *InspectorSession) CloseInfo() InspectorCloseInfo {
	<-s.done
	return s.info
}

// ---- minimal RFC 6455 client ----

const (
	wsOpContinuation = 0x0
	wsOpText         = 0x1
	wsOpBinary       = 0x2
	wsOpClose        = 0x8
	wsOpPing         = 0x9
	wsOpPong         = 0xA
	wsMaxMessage     = 1 << 20
	wsAcceptGUID     = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
)

func dialInspector(ctx context.Context, rawURL, origin string, tlsConfig *tls.Config) (net.Conn, *bufio.Reader, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, nil, fmt.Errorf("inspector: bad URL: %w", err)
	}
	secure := u.Scheme == "wss" || u.Scheme == "https"
	if !secure && u.Scheme != "ws" && u.Scheme != "http" {
		return nil, nil, fmt.Errorf("inspector: unsupported URL scheme %q", u.Scheme)
	}
	addr := u.Host
	if u.Port() == "" {
		port := "80"
		if secure {
			port = "443"
		}
		addr = net.JoinHostPort(u.Hostname(), port)
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, nil, fmt.Errorf("inspector: %w", err)
	}
	if secure {
		cfg := &tls.Config{}
		if tlsConfig != nil {
			cfg = tlsConfig.Clone()
		}
		if cfg.ServerName == "" {
			cfg.ServerName = u.Hostname()
		}
		tlsConn := tls.Client(conn, cfg)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, nil, fmt.Errorf("inspector: %w", err)
		}
		conn = tlsConn
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	request := "GET " + u.RequestURI() + " HTTP/1.1\r\n" +
		"Host: " + u.Host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Origin: " + origin + "\r\n" +
		"User-Agent: hubfly-sdk-go\r\n\r\n"
	if _, err := io.WriteString(conn, request); err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("inspector: %w", err)
	}
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("inspector: handshake: %w", err)
	}
	_ = resp.Body.Close()
	sum := sha1.Sum([]byte(key + wsAcceptGUID))
	if resp.StatusCode != http.StatusSwitchingProtocols ||
		!strings.EqualFold(resp.Header.Get("Upgrade"), "websocket") ||
		resp.Header.Get("Sec-WebSocket-Accept") != base64.StdEncoding.EncodeToString(sum[:]) {
		_ = conn.Close()
		return nil, nil, fmt.Errorf("inspector: handshake refused (HTTP %d)", resp.StatusCode)
	}
	return conn, reader, nil
}

func (s *InspectorSession) writeFrame(opcode byte, payload []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	header := make([]byte, 0, 14)
	header = append(header, 0x80|opcode)
	n := len(payload)
	switch {
	case n < 126:
		header = append(header, 0x80|byte(n))
	case n <= 0xFFFF:
		header = append(header, 0x80|126, byte(n>>8), byte(n))
	default:
		header = append(header, 0x80|127)
		header = binary.BigEndian.AppendUint64(header, uint64(n))
	}
	var mask [4]byte
	if _, err := rand.Read(mask[:]); err != nil {
		return err
	}
	header = append(header, mask[:]...)
	frame := make([]byte, len(header)+n)
	copy(frame, header)
	for i, b := range payload {
		frame[len(header)+i] = b ^ mask[i%4]
	}
	_, err := s.conn.Write(frame)
	return err
}

func (s *InspectorSession) readFrame() (fin bool, opcode byte, payload []byte, err error) {
	var head [2]byte
	if _, err = io.ReadFull(s.reader, head[:]); err != nil {
		return
	}
	fin = head[0]&0x80 != 0
	opcode = head[0] & 0x0F
	masked := head[1]&0x80 != 0
	length := uint64(head[1] & 0x7F)
	switch length {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(s.reader, ext[:]); err != nil {
			return
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(s.reader, ext[:]); err != nil {
			return
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > wsMaxMessage {
		err = errors.New("frame too large")
		return
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(s.reader, mask[:]); err != nil {
			return
		}
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(s.reader, payload); err != nil {
		return
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return
}

// readMessage returns the next text/binary message or close frame; it answers pings.
func (s *InspectorSession) readMessage() (byte, []byte, error) {
	var message []byte
	var opcode byte
	for {
		fin, op, payload, err := s.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case wsOpClose:
			return wsOpClose, payload, nil
		case wsOpPing:
			if err := s.writeFrame(wsOpPong, payload); err != nil {
				return 0, nil, err
			}
			continue
		case wsOpPong:
			continue
		case wsOpContinuation:
			message = append(message, payload...)
		case wsOpText, wsOpBinary:
			opcode = op
			message = append(message[:0], payload...)
		default:
			return 0, nil, fmt.Errorf("unexpected opcode %d", op)
		}
		if len(message) > wsMaxMessage {
			return 0, nil, errors.New("message too large")
		}
		if fin {
			return opcode, message, nil
		}
	}
}

func parseClosePayload(payload []byte) (int, string) {
	if len(payload) < 2 {
		return 1005, ""
	}
	return int(binary.BigEndian.Uint16(payload[:2])), string(payload[2:])
}

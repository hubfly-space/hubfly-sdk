package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

const userPrefix = "#server-to-user-"

var (
	channelRE     = regexp.MustCompile(`^[-a-zA-Z0-9_=@,.;]{1,200}$`)
	userChannelRE = regexp.MustCompile(`^#server-to-user-[-a-zA-Z0-9_=@,.;]{1,128}$`)
	userIDRE      = regexp.MustCompile(`^[-a-zA-Z0-9_=@,.;]{1,128}$`)
	messageIDRE   = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
)

func validChannel(c string) bool {
	return len(c) <= 200 && (channelRE.MatchString(c) || userChannelRE.MatchString(c))
}

func needsAuth(c string) bool {
	return strings.HasPrefix(c, "private-") || strings.HasPrefix(c, "presence-")
}

func checkChannel(c string, pathSafe bool) error {
	if !validChannel(c) || (pathSafe && strings.HasPrefix(c, "#")) {
		return fmt.Errorf("hubfly realtime: invalid channel name %q", c)
	}
	return nil
}

func checkEvent(e string) error {
	if e == "" || len(e) > 200 || strings.HasPrefix(e, "pusher:") || strings.HasPrefix(e, "pusher_internal:") || strings.HasPrefix(e, "hubfly:") {
		return fmt.Errorf("hubfly realtime: invalid event name %q", e)
	}
	return nil
}

func checkUserID(u string) error {
	if !userIDRE.MatchString(u) {
		return fmt.Errorf("hubfly realtime: invalid user id %s", quoteID(u))
	}
	return nil
}

func checkMessageID(m string) error {
	if !messageIDRE.MatchString(m) {
		return fmt.Errorf("hubfly realtime: invalid message id %q (1-64 of [A-Za-z0-9_.:-])", m)
	}
	return nil
}

// splitID returns base, or base.<i> when a call had to be split across requests.
func splitID(base string, i, total int) (string, error) {
	if total == 1 {
		return base, nil
	}
	id := base + "." + strconv.Itoa(i)
	if len(id) > 64 {
		return "", errors.New("hubfly realtime: MessageID too long to split across requests (keep it under 60 characters)")
	}
	return id, nil
}

// Bool returns a pointer to b, for the tri-state Encrypt options.
func Bool(b bool) *bool { return &b }

// encodeData is the Pusher events encoding: strings as-is, other values JSON-encoded.
func encodeData(data any) (string, error) {
	switch d := data.(type) {
	case string:
		return d, nil
	case []byte:
		return string(d), nil
	}
	b, err := jsonValue(data)
	return string(b), err
}

type mode int

const (
	plain mode = iota
	pusherEnvelope
	v1Envelope
)

// channelMode decides how a publish to channel is encrypted.
func (c *Client) channelMode(channel string, encrypt *bool) (mode, error) {
	if strings.HasPrefix(channel, "private-encrypted-") {
		if _, err := c.requireKeys(fmt.Sprintf("%q", channel)); err != nil {
			return plain, err
		}
		if encrypt != nil && !*encrypt {
			return plain, errors.New("hubfly realtime: private-encrypted channels are always encrypted")
		}
		return pusherEnvelope, nil
	}
	if encrypt != nil && !*encrypt {
		return plain, nil
	}
	if encrypt != nil && *encrypt {
		if _, err := c.requireKeys("Encrypt"); err != nil {
			return plain, err
		}
		return v1Envelope, nil
	}
	keys, err := c.masterKeys()
	if err != nil || keys == nil {
		return plain, err
	}
	if strings.HasPrefix(channel, userPrefix) || (c.FullE2E && needsAuth(channel)) {
		return v1Envelope, nil
	}
	return plain, nil
}

func (c *Client) sealV1(context string, key []byte, kid, event string, data any, messageID string) (string, error) {
	d, err := jsonValue(data)
	if err != nil {
		return "", err
	}
	return EncryptV1(key, kid, V1Message{E: event, D: d, To: context, M: messageID, T: c.now().UnixMilli()})
}

// encryptFor returns the outer event name and data string for an encrypted publish.
func (c *Client) encryptFor(context string, m mode, event string, data any, messageID string) (string, string, error) {
	keys, err := c.requireKeys("encryption")
	if err != nil {
		return "", "", err
	}
	key := DeriveKey(context, keys[0].Key)
	if m == pusherEnvelope {
		env, err := EncryptPusher(key, data)
		return event, env, err
	}
	env, err := c.sealV1(context, key, keys[0].Kid, event, data, messageID)
	return E2EEvent, env, err
}

// ---- Pusher endpoints -----------------------------------------------------------------------

// TriggerOptions are optional arguments of Trigger.
type TriggerOptions struct {
	// SocketID excludes this connection (socket id or E2E connection id) from delivery.
	SocketID string
	// Info requests subscription_count and/or user_count.
	Info []string
	// Encrypt forces (true: v1 envelope) or skips (false) encryption; nil is automatic.
	Encrypt *bool
}

// ChannelInfo describes a channel.
type ChannelInfo struct {
	Occupied          bool `json:"occupied,omitempty"`
	SubscriptionCount *int `json:"subscription_count,omitempty"`
	UserCount         *int `json:"user_count,omitempty"`
}

// TriggerResult is the answer of Trigger/TriggerBatch (empty unless Info was requested).
type TriggerResult struct {
	Channels map[string]ChannelInfo `json:"channels,omitempty"`
	Batch    []ChannelInfo          `json:"batch,omitempty"`
}

// BatchEvent is one event of TriggerBatch.
type BatchEvent struct {
	Channel  string
	Name     string
	Data     any
	SocketID string
	Info     []string
	Encrypt  *bool
}

func socketOf(id string) (string, error) {
	s, _, err := ParseConnectionID(id)
	return s, err
}

// Trigger publishes an event through POST /apps/<id>/events. String data is sent as-is, other
// values JSON-encoded. Encrypted channels get a Pusher envelope, user and full-E2E channels a v1
// envelope; a trigger to several channels that need different keys is sent as a batch.
func (c *Client) Trigger(ctx context.Context, channels []string, event string, data any, opts *TriggerOptions) (*TriggerResult, error) {
	if opts == nil {
		opts = &TriggerOptions{}
	}
	if len(channels) == 0 || len(channels) > 100 {
		return nil, errors.New("hubfly realtime: Trigger needs 1-100 channels")
	}
	if err := checkEvent(event); err != nil {
		return nil, err
	}
	modes := make([]mode, len(channels))
	anyEncrypted := false
	for i, ch := range channels {
		if err := checkChannel(ch, false); err != nil {
			return nil, err
		}
		m, err := c.channelMode(ch, opts.Encrypt)
		if err != nil {
			return nil, err
		}
		modes[i] = m
		anyEncrypted = anyEncrypted || m != plain
	}
	if len(channels) > 1 && anyEncrypted {
		batch := make([]BatchEvent, len(channels))
		for i, ch := range channels {
			batch[i] = BatchEvent{Channel: ch, Name: event, Data: data, SocketID: opts.SocketID, Info: opts.Info, Encrypt: opts.Encrypt}
		}
		res, err := c.TriggerBatch(ctx, batch)
		if err != nil || len(res.Batch) == 0 {
			return &TriggerResult{}, err
		}
		out := &TriggerResult{Channels: map[string]ChannelInfo{}}
		for i, ch := range channels {
			if i < len(res.Batch) {
				out.Channels[ch] = res.Batch[i]
			}
		}
		return out, nil
	}
	body := map[string]any{"name": event, "channels": channels}
	if modes[0] != plain {
		name, env, err := c.encryptFor(channels[0], modes[0], event, data, NewMessageID())
		if err != nil {
			return nil, err
		}
		body["name"], body["data"] = name, env
	} else {
		d, err := encodeData(data)
		if err != nil {
			return nil, err
		}
		body["data"] = d
	}
	if opts.SocketID != "" {
		s, err := socketOf(opts.SocketID)
		if err != nil {
			return nil, err
		}
		body["socket_id"] = s
	}
	if len(opts.Info) > 0 {
		body["info"] = strings.Join(opts.Info, ",")
	}
	out := &TriggerResult{}
	return out, c.do(ctx, http.MethodPost, "/events", nil, body, false, out)
}

// TriggerBatch publishes up to 100 events through POST /apps/<id>/batch_events, encrypting each
// like Trigger.
func (c *Client) TriggerBatch(ctx context.Context, events []BatchEvent) (*TriggerResult, error) {
	if len(events) == 0 || len(events) > 100 {
		return nil, errors.New("hubfly realtime: TriggerBatch needs 1-100 events")
	}
	items := make([]map[string]any, len(events))
	for i, e := range events {
		if err := checkChannel(e.Channel, false); err != nil {
			return nil, err
		}
		if err := checkEvent(e.Name); err != nil {
			return nil, err
		}
		m, err := c.channelMode(e.Channel, e.Encrypt)
		if err != nil {
			return nil, err
		}
		item := map[string]any{"channel": e.Channel, "name": e.Name}
		if m != plain {
			name, env, err := c.encryptFor(e.Channel, m, e.Name, e.Data, NewMessageID())
			if err != nil {
				return nil, err
			}
			item["name"], item["data"] = name, env
		} else {
			d, err := encodeData(e.Data)
			if err != nil {
				return nil, err
			}
			item["data"] = d
		}
		if e.SocketID != "" {
			s, err := socketOf(e.SocketID)
			if err != nil {
				return nil, err
			}
			item["socket_id"] = s
		}
		if len(e.Info) > 0 {
			item["info"] = strings.Join(e.Info, ",")
		}
		items[i] = item
	}
	out := &TriggerResult{}
	return out, c.do(ctx, http.MethodPost, "/batch_events", nil, map[string]any{"batch": items}, false, out)
}

// ChannelsResult lists occupied channels.
type ChannelsResult struct {
	Channels map[string]ChannelInfo `json:"channels"`
}

// Channels lists occupied channels (GET /apps/<id>/channels).
func (c *Client) Channels(ctx context.Context, prefix string, info []string) (*ChannelsResult, error) {
	out := &ChannelsResult{}
	return out, c.do(ctx, http.MethodGet, "/channels", map[string]string{"filter_by_prefix": prefix, "info": strings.Join(info, ",")}, nil, false, out)
}

// ChannelInfo describes one channel (GET /apps/<id>/channels/<name>).
func (c *Client) ChannelInfo(ctx context.Context, channel string, info []string) (*ChannelInfo, error) {
	if err := checkChannel(channel, true); err != nil {
		return nil, err
	}
	out := &ChannelInfo{}
	return out, c.do(ctx, http.MethodGet, "/channels/"+channel, map[string]string{"info": strings.Join(info, ",")}, nil, false, out)
}

// ChannelUsers lists the user ids of a presence channel.
func (c *Client) ChannelUsers(ctx context.Context, channel string) ([]string, error) {
	if err := checkChannel(channel, true); err != nil {
		return nil, err
	}
	var out struct {
		Users []struct {
			ID string `json:"id"`
		} `json:"users"`
	}
	if err := c.do(ctx, http.MethodGet, "/channels/"+channel+"/users", nil, nil, false, &out); err != nil {
		return nil, err
	}
	ids := make([]string, len(out.Users))
	for i, u := range out.Users {
		ids[i] = u.ID
	}
	return ids, nil
}

// TerminateUserConnections closes every connection of a user (4009).
func (c *Client) TerminateUserConnections(ctx context.Context, userID string) error {
	if err := checkUserID(userID); err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/users/"+userID+"/terminate_connections", nil, struct{}{}, false, nil)
}

// ---- HubFly endpoints -----------------------------------------------------------------------

// PublishOptions are optional arguments of Publish.
type PublishOptions struct {
	// MessageID is the idempotency key (1–64 of [A-Za-z0-9_.:-]); generated when empty. Reuse
	// it on retries.
	MessageID string
	// SocketID excludes this connection from delivery.
	SocketID string
	Encrypt  *bool
}

// Position is a channel stream position; Epoch is empty for channels without history.
type Position struct {
	Epoch  string `json:"epoch,omitempty"`
	Offset int64  `json:"offset,omitempty"`
}

// PublishResult is the answer of Publish.
type PublishResult struct {
	MessageID string              `json:"message_id"`
	Channels  map[string]Position `json:"channels"`
	// MessageIDs is set when the publish was split (one request per encrypted channel).
	MessageIDs map[string]string `json:"message_ids,omitempty"`
}

// Publish publishes through POST …/hubfly/v1/publish with message_id idempotency and returns
// the channel positions. Encrypted channels are published one request per channel (ids
// <MessageID>.<n>).
func (c *Client) Publish(ctx context.Context, channels []string, event string, data any, opts *PublishOptions) (*PublishResult, error) {
	if opts == nil {
		opts = &PublishOptions{}
	}
	channels = dedupe(channels)
	if len(channels) == 0 || len(channels) > 100 {
		return nil, errors.New("hubfly realtime: Publish needs 1-100 channels")
	}
	if err := checkEvent(event); err != nil {
		return nil, err
	}
	base := opts.MessageID
	if base == "" {
		base = NewMessageID()
	}
	if err := checkMessageID(base); err != nil {
		return nil, err
	}
	modes := map[string]mode{}
	anyEncrypted := false
	for _, ch := range channels {
		if err := checkChannel(ch, false); err != nil {
			return nil, err
		}
		m, err := c.channelMode(ch, opts.Encrypt)
		if err != nil {
			return nil, err
		}
		modes[ch] = m
		anyEncrypted = anyEncrypted || m != plain
	}
	groups := [][]string{channels}
	if anyEncrypted {
		groups = groups[:0]
		for _, ch := range channels {
			groups = append(groups, []string{ch})
		}
	}
	socketID := ""
	if opts.SocketID != "" {
		var err error
		if socketID, err = socketOf(opts.SocketID); err != nil {
			return nil, err
		}
	}
	plainData, err := jsonValue(data)
	if err != nil {
		return nil, err
	}
	results := make([]PublishResult, len(groups))
	ids := make([]string, len(groups))
	err = parallel(ctx, len(groups), func(ctx context.Context, i int) error {
		id, err := splitID(base, i, len(groups))
		if err != nil {
			return err
		}
		ids[i] = id
		body := map[string]any{"channels": groups[i], "event": event, "data": plainData, "message_id": id}
		if m := modes[groups[i][0]]; m != plain {
			name, env, err := c.encryptFor(groups[i][0], m, event, data, id)
			if err != nil {
				return err
			}
			body["event"], body["data"] = name, env
		}
		if socketID != "" {
			body["socket_id"] = socketID
		}
		return c.do(ctx, http.MethodPost, "/hubfly/v1/publish", nil, body, true, &results[i])
	})
	if err != nil {
		return nil, err
	}
	out := &PublishResult{MessageID: base, Channels: map[string]Position{}}
	for i, r := range results {
		for ch, p := range r.Channels {
			out.Channels[ch] = p
		}
		if len(groups) > 1 {
			if out.MessageIDs == nil {
				out.MessageIDs = map[string]string{}
			}
			out.MessageIDs[groups[i][0]] = ids[i]
		}
	}
	return out, nil
}

// SendOptions are optional arguments of the send methods.
type SendOptions struct {
	// MessageID is the idempotency key; generated when empty. Reuse it on retries.
	MessageID string
	// Ack asks the receiving client to acknowledge (the receipt becomes "acked").
	Ack bool
	// Encrypt forces (true) or skips (false) encryption; nil encrypts whenever a key is available.
	Encrypt *bool
}

// SendTarget is the delivery result of one target.
type SendTarget struct {
	// ID is the target as given (connection id or user id).
	ID          string `json:"id"`
	SocketID    string `json:"socket_id,omitempty"`
	UserID      string `json:"user_id,omitempty"`
	Status      string `json:"status"`
	Connections int    `json:"connections,omitempty"`
	// MessageID of the request that carried this target.
	MessageID string `json:"message_id"`
}

// SendResult is the answer of the send methods.
type SendResult struct {
	MessageID string       `json:"message_id"`
	Results   []SendTarget `json:"results"`
}

type sendResponse struct {
	Results []SendTarget `json:"results"`
}

// SendToConnection sends an event to one connection id (socket id or E2E connection id).
func (c *Client) SendToConnection(ctx context.Context, id, event string, data any, opts *SendOptions) (*SendResult, error) {
	return c.SendToConnections(ctx, []string{id}, event, data, opts)
}

// SendToConnections sends an event through POST …/hubfly/v1/send to connection ids. E2E ids
// (<socket_id>~<k>) are encrypted with their own key (v1 envelope, kid "c"), one request per
// E2E target; plaintext targets go 100 per request. Split requests use ids <MessageID>.<n>.
func (c *Client) SendToConnections(ctx context.Context, ids []string, event string, data any, opts *SendOptions) (*SendResult, error) {
	if opts == nil {
		opts = &SendOptions{}
	}
	ids = dedupe(ids)
	if len(ids) == 0 {
		return nil, errors.New("hubfly realtime: send needs at least one connection id")
	}
	if err := checkEvent(event); err != nil {
		return nil, err
	}
	type target struct {
		id, socketID string
		key          []byte
	}
	encrypt := opts.Encrypt == nil || *opts.Encrypt
	var plainTargets []target
	var requests [][]target
	for _, id := range ids {
		s, key, err := ParseConnectionID(id)
		if err != nil {
			return nil, err
		}
		if opts.Encrypt != nil && *opts.Encrypt && key == nil {
			return nil, errors.New("hubfly realtime: Encrypt needs E2E connection ids (<socket_id>~<key>)")
		}
		if encrypt && key != nil {
			requests = append(requests, []target{{id, s, key}})
		} else {
			plainTargets = append(plainTargets, target{id, s, nil})
		}
	}
	var plainGroups [][]target
	for i := 0; i < len(plainTargets); i += 100 {
		plainGroups = append(plainGroups, plainTargets[i:min(i+100, len(plainTargets))])
	}
	requests = append(plainGroups, requests...)
	plainData, err := jsonValue(data)
	if err != nil {
		return nil, err
	}
	return c.dispatch(ctx, len(requests), opts, func(i int, messageID string) (map[string]any, func(SendTarget) string, error) {
		group := requests[i]
		socketIDs := make([]string, len(group))
		for k, t := range group {
			socketIDs[k] = t.socketID
		}
		body := map[string]any{"socket_ids": socketIDs, "event": event, "data": plainData, "message_id": messageID}
		if group[0].key != nil {
			env, err := c.sealV1("#direct-"+group[0].socketID, group[0].key, "c", event, data, messageID)
			if err != nil {
				return nil, nil, err
			}
			body["event"], body["data"] = E2EEvent, env
		}
		idOf := func(r SendTarget) string {
			for _, t := range group {
				if t.socketID == r.SocketID {
					return t.id
				}
			}
			return r.SocketID
		}
		return body, idOf, nil
	})
}

// SendToUser sends an event to every connection of a user.
func (c *Client) SendToUser(ctx context.Context, userID, event string, data any, opts *SendOptions) (*SendResult, error) {
	return c.SendToUsers(ctx, []string{userID}, event, data, opts)
}

// SendToUsers sends an event to users through POST …/hubfly/v1/send. With EncryptionKeys each
// user gets a v1 envelope under K(#server-to-user-<id>) (one request per user).
func (c *Client) SendToUsers(ctx context.Context, userIDs []string, event string, data any, opts *SendOptions) (*SendResult, error) {
	if opts == nil {
		opts = &SendOptions{}
	}
	userIDs = dedupe(userIDs)
	if len(userIDs) == 0 {
		return nil, errors.New("hubfly realtime: send needs at least one user id")
	}
	for _, u := range userIDs {
		if err := checkUserID(u); err != nil {
			return nil, err
		}
	}
	if err := checkEvent(event); err != nil {
		return nil, err
	}
	keys, err := c.masterKeys()
	if err != nil {
		return nil, err
	}
	encrypt := (opts.Encrypt == nil && keys != nil) || (opts.Encrypt != nil && *opts.Encrypt)
	if encrypt && keys == nil {
		return nil, fmt.Errorf("hubfly realtime: Encrypt needs EncryptionKeys (%s)", EnvE2EKeys)
	}
	var requests [][]string
	if encrypt {
		for _, u := range userIDs {
			requests = append(requests, []string{u})
		}
	} else {
		for i := 0; i < len(userIDs); i += 100 {
			requests = append(requests, userIDs[i:min(i+100, len(userIDs))])
		}
	}
	plainData, err := jsonValue(data)
	if err != nil {
		return nil, err
	}
	return c.dispatch(ctx, len(requests), opts, func(i int, messageID string) (map[string]any, func(SendTarget) string, error) {
		body := map[string]any{"user_ids": requests[i], "event": event, "data": plainData, "message_id": messageID}
		if encrypt {
			ctxName := userPrefix + requests[i][0]
			env, err := c.sealV1(ctxName, DeriveKey(ctxName, keys[0].Key), keys[0].Kid, event, data, messageID)
			if err != nil {
				return nil, nil, err
			}
			body["event"], body["data"] = E2EEvent, env
		}
		return body, func(r SendTarget) string { return r.UserID }, nil
	})
}

func (c *Client) dispatch(ctx context.Context, n int, opts *SendOptions, build func(i int, messageID string) (map[string]any, func(SendTarget) string, error)) (*SendResult, error) {
	base := opts.MessageID
	if base == "" {
		base = NewMessageID()
	}
	if err := checkMessageID(base); err != nil {
		return nil, err
	}
	results := make([][]SendTarget, n)
	err := parallel(ctx, n, func(ctx context.Context, i int) error {
		id, err := splitID(base, i, n)
		if err != nil {
			return err
		}
		body, idOf, err := build(i, id)
		if err != nil {
			return err
		}
		if opts.Ack {
			body["ack"] = true
		}
		var res sendResponse
		if err := c.do(ctx, http.MethodPost, "/hubfly/v1/send", nil, body, true, &res); err != nil {
			return err
		}
		for k := range res.Results {
			res.Results[k].ID = idOf(res.Results[k])
			res.Results[k].MessageID = id
		}
		results[i] = res.Results
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := &SendResult{MessageID: base, Results: []SendTarget{}}
	for _, r := range results {
		out.Results = append(out.Results, r...)
	}
	return out, nil
}

// ConnectionStatus describes a connection.
type ConnectionStatus struct {
	SocketID string `json:"socket_id"`
	Online   bool   `json:"online"`
	// State is "connected" (or "detached" while a HubFly session waits to be resumed).
	State string `json:"state,omitempty"`
	// UserID is the signed-in user ("" when not signed in).
	UserID      string `json:"user_id,omitempty"`
	ConnectedAt string `json:"connected_at,omitempty"`
	// ExpiresAt is when a detached session expires unless it is resumed.
	ExpiresAt string `json:"expires_at,omitempty"`
	// Protocol is "hubfly" or "pusher".
	Protocol string `json:"protocol,omitempty"`
}

// ConnectionStatus returns the state of a connection (socket id or E2E connection id);
// unknown connections are {Online: false}.
func (c *Client) ConnectionStatus(ctx context.Context, id string) (*ConnectionStatus, error) {
	s, err := socketOf(id)
	if err != nil {
		return nil, err
	}
	out := &ConnectionStatus{}
	if err := c.do(ctx, http.MethodGet, "/hubfly/v1/connections/"+s, nil, nil, false, out); err != nil {
		if IsNotFound(err) {
			return &ConnectionStatus{SocketID: s}, nil
		}
		return nil, err
	}
	return out, nil
}

// IsOnline reports whether a connection is connected or detached (resumable).
func (c *Client) IsOnline(ctx context.Context, id string) (bool, error) {
	st, err := c.ConnectionStatus(ctx, id)
	if err != nil {
		return false, err
	}
	return st.Online, nil
}

// TerminateConnection closes a connection with 4009 (POST …/connections/<socket_id>/terminate):
// the client stops reconnecting and its session ends.
func (c *Client) TerminateConnection(ctx context.Context, id string) error {
	return c.closeConnection(ctx, id, "terminate")
}

// DisconnectConnection closes a connection with 4200: the client reconnects at once (HubFly
// sessions resume).
func (c *Client) DisconnectConnection(ctx context.Context, id string) error {
	return c.closeConnection(ctx, id, "disconnect")
}

func (c *Client) closeConnection(ctx context.Context, id, mode string) error {
	s, err := socketOf(id)
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/hubfly/v1/connections/"+s+"/terminate", nil, map[string]string{"mode": mode}, false, nil)
}

// UserStatus describes a user's connections.
type UserStatus struct {
	UserID      string   `json:"user_id"`
	Online      bool     `json:"online"`
	Connections int      `json:"connections"`
	SocketIDs   []string `json:"socket_ids"`
}

// UserStatus returns whether a user is online and their socket ids.
func (c *Client) UserStatus(ctx context.Context, userID string) (*UserStatus, error) {
	if err := checkUserID(userID); err != nil {
		return nil, err
	}
	out := &UserStatus{}
	if err := c.do(ctx, http.MethodGet, "/hubfly/v1/users/"+userID, nil, nil, false, out); err != nil {
		if IsNotFound(err) {
			return &UserStatus{UserID: userID, SocketIDs: []string{}}, nil
		}
		return nil, err
	}
	return out, nil
}

// HistoryOptions are optional arguments of History.
type HistoryOptions struct {
	// Since returns messages after this offset.
	Since *int64
	Epoch string
	// Limit is at most 1000 (the engine's default is 100).
	Limit int
	// Raw returns Data exactly as stored (a JSON string holding the event's data text,
	// envelopes unopened).
	Raw bool
}

// HistoryMessage is one stored message. Data is the JSON value client handlers receive: the
// stored data text when it is JSON, else a JSON string; the decrypted data when Encrypted is
// true. With HistoryOptions.Raw it is the stored JSON string.
type HistoryMessage struct {
	Offset      int64           `json:"offset"`
	Event       string          `json:"event"`
	Data        json.RawMessage `json:"data"`
	MessageID   string          `json:"message_id"`
	PublishedAt string          `json:"published_at"`
	// UserID is the sender of a client event on a presence channel.
	UserID    string `json:"user_id,omitempty"`
	Encrypted bool   `json:"encrypted,omitempty"`
	// E2EError is set when an envelope could not be opened (Data is left as stored).
	E2EError string `json:"e2e_error,omitempty"`
}

// HistoryResult is the answer of History.
type HistoryResult struct {
	Channel   string           `json:"channel"`
	Epoch     *string          `json:"epoch"`
	Head      *int64           `json:"head"`
	Oldest    *int64           `json:"oldest"`
	Messages  []HistoryMessage `json:"messages"`
	Truncated bool             `json:"truncated"`
	Gap       bool             `json:"gap"`
}

// History reads a channel's history (GET …/hubfly/v1/history/<channel>). Data is decoded the
// way client handlers receive it, and envelopes are opened when EncryptionKeys are configured.
func (c *Client) History(ctx context.Context, channel string, opts *HistoryOptions) (*HistoryResult, error) {
	if opts == nil {
		opts = &HistoryOptions{}
	}
	if err := checkChannel(channel, true); err != nil {
		return nil, err
	}
	params := map[string]string{"epoch": opts.Epoch}
	if opts.Since != nil {
		params["since"] = strconv.FormatInt(*opts.Since, 10)
	}
	if opts.Limit > 0 {
		params["limit"] = strconv.Itoa(opts.Limit)
	}
	out := &HistoryResult{}
	if err := c.do(ctx, http.MethodGet, "/hubfly/v1/history/"+channel, params, nil, false, out); err != nil {
		return nil, err
	}
	if opts.Raw {
		return out, nil
	}
	keys, _ := c.masterKeys()
	for i := range out.Messages {
		m := &out.Messages[i]
		sealed := m.Event == E2EEvent || m.Event == ClientE2EEvent || strings.HasPrefix(channel, "private-encrypted-")
		if !sealed && (keys == nil || !isE2EContext(channel, c.FullE2E)) {
			m.Data = decodeStored(m.Data)
			continue
		}
		if keys != nil {
			event, data, err := c.Decrypt(channel, m.Event, m.Data)
			if err != nil {
				var e *E2EError
				if errors.As(err, &e) {
					m.E2EError = e.Reason
				} else {
					m.E2EError = "decrypt_failed"
				}
				continue
			}
			if !sealed { // plaintext allowed by AllowPlaintext
				m.Data = decodeStored(m.Data)
				continue
			}
			m.Event, m.Data, m.Encrypted = event, data, true
		}
	}
	return out, nil
}

// MessageReceipt is the per-target delivery state of a direct/user message.
type MessageReceipt struct {
	MessageID string `json:"message_id"`
	CreatedAt string `json:"created_at"`
	Event     string `json:"event"`
	Targets   []struct {
		SocketID  string `json:"socket_id,omitempty"`
		UserID    string `json:"user_id,omitempty"`
		Status    string `json:"status"`
		UpdatedAt string `json:"updated_at"`
	} `json:"targets"`
}

// MessageReceipt returns a message's receipt, or nil when it is unknown (receipts are kept one
// hour).
func (c *Client) MessageReceipt(ctx context.Context, messageID string) (*MessageReceipt, error) {
	if err := checkMessageID(messageID); err != nil {
		return nil, err
	}
	out := &MessageReceipt{}
	if err := c.do(ctx, http.MethodGet, "/hubfly/v1/messages/"+messageID, nil, nil, false, out); err != nil {
		if IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// Decrypt opens an event of context (a channel or #server-to-user-<id>): v1 envelopes
// (hubfly.e2e / client-hubfly.e2e, any configured kid) and Pusher envelopes on
// private-encrypted-* channels. data may be the envelope text or a JSON string holding it.
// Other events are returned unchanged, except in E2E contexts (private-encrypted-*,
// #server-to-user-<id>, and private/presence channels with FullE2E), where a non-envelope event
// fails with E2EError "plaintext" unless AllowPlaintext is set. Useful for client_event webhooks
// and history.
func (c *Client) Decrypt(context, event string, data any) (string, json.RawMessage, error) {
	keys, err := c.requireKeys("Decrypt")
	if err != nil {
		return "", nil, err
	}
	env := envelopeBytes(data)
	if event == E2EEvent || event == ClientE2EEvent {
		msg, _, err := DecryptV1(func(kid string) []byte {
			for _, k := range keys {
				if k.Kid == kid {
					return DeriveKey(context, k.Key)
				}
			}
			return nil
		}, env)
		if err != nil {
			return "", nil, err
		}
		if msg.To != context {
			return "", nil, e2eErr("wrong_context")
		}
		if (event == ClientE2EEvent) != strings.HasPrefix(msg.E, "client-") {
			return "", nil, e2eErr("bad_event")
		}
		return msg.E, msg.D, nil
	}
	if strings.HasPrefix(context, "private-encrypted-") {
		if _, err := ParseEnvelope(env); err != nil {
			return "", nil, e2eErr("plaintext")
		}
		derived := make([][]byte, len(keys))
		for i, k := range keys {
			derived[i] = DeriveKey(context, k.Key)
		}
		d, err := DecryptPusher(derived, env)
		return event, d, err
	}
	if !c.AllowPlaintext && isE2EContext(context, c.FullE2E) {
		return "", nil, e2eErr("plaintext")
	}
	raw, err := jsonValue(data)
	return event, raw, err
}

// isE2EContext reports whether messages of context are always encrypted when keys are
// configured (and its auth responses carry hubfly.keys): private-encrypted-*, user messages
// and, with FullE2E, private/presence channels. Clients accept only envelopes there.
func isE2EContext(context string, fullE2E bool) bool {
	return strings.HasPrefix(context, "private-encrypted-") || strings.HasPrefix(context, userPrefix) || (fullE2E && needsAuth(context))
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// parallel runs fn for 0..n-1 with at most 8 in flight and returns the first error.
func parallel(ctx context.Context, n int, fn func(ctx context.Context, i int) error) error {
	if n == 1 {
		return fn(ctx, 0)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	var once sync.Once
	var first error
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := fn(ctx, i); err != nil {
				once.Do(func() {
					first = err
					cancel()
				})
			}
		}(i)
	}
	wg.Wait()
	return first
}

// decodeStored turns stored/wire data (a JSON string holding the event's data text) into the
// JSON value client handlers receive: the text itself when it is JSON, else the string. Values
// that are not JSON strings are returned unchanged.
func decodeStored(raw json.RawMessage) json.RawMessage {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return raw
	}
	if t := strings.TrimSpace(s); t != "" && json.Valid([]byte(t)) {
		return json.RawMessage(t)
	}
	return raw
}

package realtime

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

// PresenceData is the channel_data of a presence subscription.
type PresenceData struct {
	UserID   string `json:"user_id"`
	UserInfo any    `json:"user_info,omitempty"`
}

// AuthKeys carries derived E2E keys in auth responses (hubfly.keys; pusher-js ignores it).
type AuthKeys struct {
	Keys []WireKey `json:"keys"`
}

// ChannelAuth is the response of a channel authorization (pusher-js compatible).
type ChannelAuth struct {
	Auth        string `json:"auth"`
	ChannelData string `json:"channel_data,omitempty"`
	// SharedSecret is Pusher's field for private-encrypted-* channels: base64 K(channel, active kid).
	SharedSecret string    `json:"shared_secret,omitempty"`
	HubFly       *AuthKeys `json:"hubfly,omitempty"`
}

// UserData is the user_data of a sign-in. ID is required.
type UserData struct {
	ID       string `json:"id"`
	UserInfo any    `json:"user_info,omitempty"`
}

// UserAuth is the response of a user authentication (pusher:signin).
type UserAuth struct {
	Auth     string    `json:"auth"`
	UserData string    `json:"user_data"`
	HubFly   *AuthKeys `json:"hubfly,omitempty"`
}

// AuthorizeChannel signs a channel subscription. Presence channels need presence. With
// EncryptionKeys: SharedSecret and HubFly.Keys for private-encrypted-*; with FullE2E also
// HubFly.Keys for other private/presence channels and sealed presence user_info (clients then
// accept only envelopes on them).
func (c *Client) AuthorizeChannel(socketID, channel string, presence *PresenceData) (*ChannelAuth, error) {
	if !IsSocketID(socketID) {
		return nil, fmt.Errorf("hubfly realtime: invalid socket id %s", quoteID(socketID))
	}
	if err := checkChannel(channel, false); err != nil {
		return nil, err
	}
	keys, err := c.masterKeys()
	if err != nil {
		return nil, err
	}
	out := &ChannelAuth{}
	toSign := socketID + ":" + channel
	if strings.HasPrefix(channel, "presence-") {
		if presence == nil || presence.UserID == "" {
			return nil, errors.New("hubfly realtime: presence channels need PresenceData.UserID")
		}
		pd := *presence
		if c.FullE2E && keys != nil && pd.UserInfo != nil {
			sealed, err := c.sealV1(channel, DeriveKey(channel, keys[0].Key), keys[0].Kid, UserInfoEvent, pd.UserInfo, pd.UserID)
			if err != nil {
				return nil, err
			}
			pd.UserInfo = json.RawMessage(sealed)
		}
		cd, err := marshal(pd)
		if err != nil {
			return nil, err
		}
		out.ChannelData = string(cd)
		toSign += ":" + out.ChannelData
	}
	out.Auth = c.Key + ":" + hmacHex(c.Secret, []byte(toSign))
	if strings.HasPrefix(channel, "private-encrypted-") {
		if keys == nil {
			return nil, fmt.Errorf("hubfly realtime: %q needs EncryptionKeys (%s)", channel, EnvE2EKeys)
		}
		out.SharedSecret = base64.StdEncoding.EncodeToString(DeriveKey(channel, keys[0].Key))
	}
	if keys != nil && isE2EContext(channel, c.FullE2E) {
		out.HubFly = &AuthKeys{Keys: DeriveWireKeys(channel, keys)}
	}
	return out, nil
}

// AuthenticateUser signs a user sign-in; adds the user-message keys when EncryptionKeys are set.
// With FullE2E sign-in user_info is sealed with K(#server-to-user-<id>).
func (c *Client) AuthenticateUser(socketID string, user UserData) (*UserAuth, error) {
	if !IsSocketID(socketID) {
		return nil, fmt.Errorf("hubfly realtime: invalid socket id %s", quoteID(socketID))
	}
	if err := checkUserID(user.ID); err != nil {
		return nil, err
	}
	keys, err := c.masterKeys()
	if err != nil {
		return nil, err
	}
	if c.FullE2E && keys != nil && user.UserInfo != nil {
		ctx := userPrefix + user.ID
		sealed, err := c.sealV1(ctx, DeriveKey(ctx, keys[0].Key), keys[0].Kid, SigninUserInfoEvent, user.UserInfo, user.ID)
		if err != nil {
			return nil, err
		}
		user.UserInfo = json.RawMessage(sealed)
	}
	ud, err := marshal(user)
	if err != nil {
		return nil, err
	}
	out := &UserAuth{
		Auth:     c.Key + ":" + hmacHex(c.Secret, []byte(socketID+"::user::"), ud),
		UserData: string(ud),
	}
	if keys != nil {
		out.HubFly = &AuthKeys{Keys: DeriveWireKeys(userPrefix+user.ID, keys)}
	}
	return out, nil
}

// User is the signed-in user of an auth request.
type User struct {
	ID string
	// Info becomes presence user_info and sign-in user_info.
	Info any
}

// AuthHandlerOptions configure AuthHandler.
type AuthHandlerOptions struct {
	// GetUser returns the signed-in user of the request, or nil.
	GetUser func(r *http.Request) (*User, error)
	// CanAccess decides whether user (possibly nil) may join channel. Default: any signed-in
	// user may join private and presence channels.
	CanAccess func(user *User, channel string, r *http.Request) bool
}

// AuthHandler answers the client's authEndpoint and userAuthEndpoint: form-encoded (pusher-js)
// or JSON bodies with socket_id and, for channel auth, channel_name.
func (c *Client) AuthHandler(opts AuthHandlerOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		params, err := authParams(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Malformed request body"})
			return
		}
		socketID, channel := params["socket_id"], params["channel_name"]
		if !IsSocketID(socketID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid socket_id"})
			return
		}
		var user *User
		if opts.GetUser != nil {
			if user, err = opts.GetUser(r); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not load the user"})
				return
			}
		}
		if channel == "" {
			if user == nil {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Not signed in"})
				return
			}
			res, err := c.AuthenticateUser(socketID, UserData{ID: user.ID, UserInfo: user.Info})
			respond(w, res, err)
			return
		}
		if !validChannel(channel) || !needsAuth(channel) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid channel_name"})
			return
		}
		if keys, _ := c.masterKeys(); keys == nil && strings.HasPrefix(channel, "private-encrypted-") {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Encrypted channels are not configured on this server"})
			return
		}
		allowed := user != nil
		if opts.CanAccess != nil {
			allowed = opts.CanAccess(user, channel, r)
		}
		if !allowed {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Forbidden"})
			return
		}
		var presence *PresenceData
		if strings.HasPrefix(channel, "presence-") {
			if user == nil {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Not signed in"})
				return
			}
			presence = &PresenceData{UserID: user.ID, UserInfo: user.Info}
		}
		res, err := c.AuthorizeChannel(socketID, channel, presence)
		respond(w, res, err)
	})
}

func authParams(r *http.Request) (map[string]string, error) {
	out := map[string]string{}
	if r.Method == http.MethodGet {
		for k, v := range r.URL.Query() {
			out[k] = v[0]
		}
		return out, nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		return nil, err
	}
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if strings.Contains(ct, "json") {
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			return nil, err
		}
		for k, v := range m {
			if s, ok := v.(string); ok {
				out[k] = s
			}
		}
		return out, nil
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, err
	}
	for k, v := range values {
		out[k] = v[0]
	}
	return out, nil
}

// respond writes v, or a generic 500: the remaining errors come from the server's own data
// (GetUser, keys), and their text must not reach the client.
func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Authorization failed"})
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, _ := marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

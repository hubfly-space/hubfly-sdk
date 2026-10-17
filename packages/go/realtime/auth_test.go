package realtime

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// The documented Pusher signature examples (Pusher "auth signatures" docs; pusher-http-go's
// TestAuthenticatePrivateChannel / TestAuthenticatePresenceChannel use the same key, secret and
// socket id).
const (
	docKey    = "278d425bdf160c739803"
	docSecret = "7ad3773142a6692b25b8"
)

func docClient() *Client {
	return &Client{URL: "https://api.pusherapp.com", AppID: "3", Key: docKey, Secret: docSecret}
}

func refHMAC(secret, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

func TestAuthorizeChannelPusherVectors(t *testing.T) {
	res, err := docClient().AuthorizeChannel("1234.1234", "private-foobar", nil)
	if err != nil || res.Auth != docKey+":58df8b0c36d6982b82c3ecf6b4662e34fe8c25bba48f5369f135bf843651c3a4" || res.ChannelData != "" || res.HubFly != nil {
		t.Errorf("private: %+v %v", res, err)
	}
	res, err = docClient().AuthorizeChannel("1234.1234", "presence-foobar", &PresenceData{UserID: "10", UserInfo: map[string]string{"name": "Mr. Pusher"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.ChannelData != `{"user_id":"10","user_info":{"name":"Mr. Pusher"}}` ||
		res.Auth != docKey+":48dac51d2d7569e1e9c0f48c227d4b26f238fa68e5c0bb04222c966909c4f7c4" {
		t.Errorf("presence: %+v", res)
	}
}

func TestAuthorizeChannelE2E(t *testing.T) {
	v, _ := loadVectors(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "k3n9x2m4q8w1e7r5t6y0", Secret: "secret", EncryptionKeys: "k1:" + v.MasterKeys[0].Key + ",k0:" + v.MasterKeys[1].Key}
	socket := "1234567890.1234567890"
	res, err := c.AuthorizeChannel(socket, "private-encrypted-orders", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Auth != c.Key+":"+refHMAC("secret", socket+":private-encrypted-orders") {
		t.Error("auth mismatch")
	}
	if res.SharedSecret != v.Derive[0].Key {
		t.Errorf("shared_secret %s", res.SharedSecret)
	}
	if res.HubFly == nil || len(res.HubFly.Keys) != 2 || res.HubFly.Keys[0] != (WireKey{"k1", v.Derive[0].Key}) || res.HubFly.Keys[1] != (WireKey{"k0", v.Derive[1].Key}) {
		t.Errorf("hubfly keys %+v", res.HubFly)
	}
	b, _ := json.Marshal(res)
	if !strings.Contains(string(b), `"shared_secret":`) || !strings.Contains(string(b), `"hubfly":{"keys":[{"kid":"k1"`) {
		t.Errorf("json %s", b)
	}
	// Other private/presence channels get keys (clients then accept only envelopes) with FullE2E only.
	if res, _ := c.AuthorizeChannel(socket, "private-orders", nil); res.SharedSecret != "" || res.HubFly != nil {
		t.Errorf("private channel: %+v", res)
	}
	c.FullE2E = true
	if res, _ := c.AuthorizeChannel(socket, "private-orders", nil); res.SharedSecret != "" || res.HubFly == nil || len(res.HubFly.Keys) != 2 || res.HubFly.Keys[0].Kid != "k1" {
		t.Errorf("full E2E private channel: %+v", res)
	}
	c.FullE2E = false
	if _, err := (&Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s"}).AuthorizeChannel(socket, "private-encrypted-orders", nil); err == nil {
		t.Error("encrypted channel without keys accepted")
	}
}

func TestSealedPresence(t *testing.T) {
	v, _ := loadVectors(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: v.MasterKeys[0].Key, FullE2E: true}
	res, err := c.AuthorizeChannel("1.2", "presence-room-1", &PresenceData{UserID: "u_42", UserInfo: map[string]string{"name": "Ann"}})
	if err != nil {
		t.Fatal(err)
	}
	var cd struct {
		UserID   string          `json:"user_id"`
		UserInfo json.RawMessage `json:"user_info"`
	}
	if err := json.Unmarshal([]byte(res.ChannelData), &cd); err != nil {
		t.Fatal(err)
	}
	if res.Auth != "k:"+refHMAC("s", "1.2:presence-room-1:"+res.ChannelData) {
		t.Error("auth mismatch")
	}
	msg, kid, err := DecryptV1(func(string) []byte { return mustB64(t, v.Derive[2].Key) }, cd.UserInfo)
	if err != nil || kid != "k1" || msg.E != UserInfoEvent || msg.M != "u_42" || msg.To != "presence-room-1" || string(msg.D) != `{"name":"Ann"}` {
		t.Errorf("sealed user_info: %+v %v", msg, err)
	}
}

func TestSealedSigninUserInfo(t *testing.T) {
	v, _ := loadVectors(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: v.MasterKeys[0].Key, FullE2E: true}
	res, err := c.AuthenticateUser("1.2", UserData{ID: "u_42", UserInfo: map[string]string{"name": "Ann"}})
	if err != nil {
		t.Fatal(err)
	}
	var ud struct {
		ID       string          `json:"id"`
		UserInfo json.RawMessage `json:"user_info"`
	}
	if err := json.Unmarshal([]byte(res.UserData), &ud); err != nil || ud.ID != "u_42" {
		t.Fatalf("user_data %s %v", res.UserData, err)
	}
	if strings.Contains(res.UserData, "Ann") || res.Auth != "k:"+refHMAC("s", "1.2::user::"+res.UserData) {
		t.Errorf("sealed sign-in auth %+v", res)
	}
	msg, kid, err := DecryptV1(func(string) []byte { return mustB64(t, v.Derive[3].Key) }, ud.UserInfo)
	if err != nil || kid != "k1" || msg.E != SigninUserInfoEvent || msg.M != "u_42" || msg.To != "#server-to-user-u_42" || string(msg.D) != `{"name":"Ann"}` {
		t.Errorf("sealed sign-in user_info: %+v %v", msg, err)
	}
	// Absent stays absent; without FullE2E it stays plaintext.
	if res, _ := c.AuthenticateUser("1.2", UserData{ID: "u_42"}); res.UserData != `{"id":"u_42"}` {
		t.Errorf("absent user_info: %s", res.UserData)
	}
	c.FullE2E = false
	if res, _ := c.AuthenticateUser("1.2", UserData{ID: "u_42", UserInfo: map[string]string{"name": "Ann"}}); res.UserData != `{"id":"u_42","user_info":{"name":"Ann"}}` {
		t.Errorf("plaintext user_info: %s", res.UserData)
	}
}

func TestAuthenticateUser(t *testing.T) {
	v, _ := loadVectors(t)
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s", EncryptionKeys: v.MasterKeys[0].Key}
	res, err := c.AuthenticateUser("1234567890.1234567890", UserData{ID: "u_42", UserInfo: map[string]string{"name": "Ann"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.UserData != `{"id":"u_42","user_info":{"name":"Ann"}}` || res.Auth != "k:"+refHMAC("s", "1234567890.1234567890::user::"+res.UserData) {
		t.Errorf("user auth %+v", res)
	}
	if res.HubFly == nil || res.HubFly.Keys[0] != (WireKey{"k1", v.Derive[3].Key}) {
		t.Errorf("user keys %+v", res.HubFly)
	}
	if _, err := c.AuthenticateUser("bad", UserData{ID: "u"}); err == nil {
		t.Error("bad socket id accepted")
	}
	if _, err := c.AuthenticateUser("1.2", UserData{}); err == nil {
		t.Error("empty user id accepted")
	}
}

func TestAuthHandler(t *testing.T) {
	c := &Client{URL: "https://x", AppID: "1", Key: "k", Secret: "s"}
	h := c.AuthHandler(AuthHandlerOptions{
		GetUser: func(r *http.Request) (*User, error) {
			if id := r.Header.Get("X-User"); id != "" {
				return &User{ID: id, Info: map[string]string{"name": "Ann"}}, nil
			}
			return nil, nil
		},
		CanAccess: func(u *User, channel string, r *http.Request) bool {
			return channel != "private-secret" && (u != nil || channel == "private-open")
		},
	})
	post := func(ct, body, user string) (*httptest.ResponseRecorder, map[string]string) {
		r := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(body))
		r.Header.Set("Content-Type", ct)
		if user != "" {
			r.Header.Set("X-User", user)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		out := map[string]string{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w, out
	}
	form := "application/x-www-form-urlencoded"
	w, out := post(form, url.Values{"socket_id": {"1.2"}, "channel_name": {"presence-room"}}.Encode(), "u_1")
	if w.Code != 200 || out["channel_data"] != `{"user_id":"u_1","user_info":{"name":"Ann"}}` || out["auth"] != "k:"+refHMAC("s", "1.2:presence-room:"+out["channel_data"]) {
		t.Errorf("presence: %d %v", w.Code, out)
	}
	if w, out := post("application/json", `{"socket_id":"1.2"}`, "u_7"); w.Code != 200 || out["user_data"] != `{"id":"u_7","user_info":{"name":"Ann"}}` {
		t.Errorf("user auth: %d %v", w.Code, out)
	}
	if w, _ := post(form, "socket_id=1.2&channel_name=private-open", ""); w.Code != 200 {
		t.Errorf("anonymous allowed channel: %d", w.Code)
	}
	for _, tc := range []struct {
		body, user string
		code       int
	}{
		{"socket_id=1.2&channel_name=private-a", "", 403},
		{"socket_id=1.2", "", 403},
		{"socket_id=1.2&channel_name=private-secret", "u", 403},
		{"socket_id=bad&channel_name=private-a", "u", 400},
		{"socket_id=1.2&channel_name=public", "u", 400},
		{"socket_id=1.2&channel_name=private-encrypted-x", "u", 403},
		{"socket_id=1.2&channel_name=presence-open", "", 403},
	} {
		if w, _ := post(form, tc.body, tc.user); w.Code != tc.code {
			t.Errorf("%s (user %q): %d, want %d", tc.body, tc.user, w.Code, tc.code)
		}
	}
	if w, _ := post("application/json", `{`, "u"); w.Code != 400 {
		t.Errorf("malformed json: %d", w.Code)
	}
}

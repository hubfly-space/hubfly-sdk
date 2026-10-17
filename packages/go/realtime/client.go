package realtime

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Version of this package.
const Version = "0.1.0"

// Client talks to one app of a HubFly Realtime instance: Pusher-signed REST, the HubFly
// endpoints, channel/user authorization, webhooks and end-to-end encryption. Set URL, AppID,
// Key and Secret (or use FromEnv). A Client is safe for concurrent use; do not copy it after
// first use.
type Client struct {
	// URL of the instance: https://<host> (HUBFLY_REALTIME_URL). wss:// is accepted.
	URL string
	// AppID is HUBFLY_REALTIME_APP_ID.
	AppID string
	// Key is HUBFLY_REALTIME_KEY.
	Key string
	// Secret is HUBFLY_REALTIME_SECRET.
	Secret string
	// EncryptionKeys holds the customer's master keys in HUBFLY_REALTIME_E2E_KEYS format
	// ("kid:base64,…", first is active, a bare base64 value is kid "k1"). Optional; HubFly never
	// sees them.
	EncryptionKeys string
	// FullE2E also seals publishes to private-* and presence-* channels with the v1 envelope
	// (event names hidden; pusher-js subscribers cannot read them), seals presence and sign-in
	// user_info and hands those channels' keys to clients, which then accept only envelopes on
	// them. private-encrypted-* channels, user messages and direct messages to E2E
	// connection ids are encrypted whenever keys are available.
	FullE2E bool
	// AllowPlaintext lets Decrypt (and History) return plaintext found in an E2E context (user
	// messages, and private/presence channels with FullE2E) unchanged instead of failing with
	// E2EError "plaintext". This WEAKENS the guarantee: a compromised relay could then forge such
	// events. private-encrypted-* channels never accept plaintext.
	AllowPlaintext bool
	// HTTPClient defaults to a client with a 10 second timeout.
	HTTPClient *http.Client
	// DisableRetry turns off the single retry of idempotent HubFly POSTs (send, publish) on
	// network errors and 502/503/504.
	DisableRetry bool
	// Now overrides the clock (tests).
	Now func() time.Time

	mu      sync.Mutex
	keysSrc string
	keys    []MasterKey
	keysErr error
}

// String describes the client without its Secret or EncryptionKeys (fmt %v, %s, %+v).
func (c *Client) String() string {
	return fmt.Sprintf("realtime.Client{URL:%q, AppID:%q, Key:%q, Secret:[redacted], Encryption:%t}", c.URL, c.AppID, c.Key, c.EncryptionKeys != "")
}

// GoString is String for fmt %#v.
func (c *Client) GoString() string { return c.String() }

// Env var names (the Dashboard's app bindings and the AI Builder write these).
const (
	EnvURL     = "HUBFLY_REALTIME_URL"
	EnvAppID   = "HUBFLY_REALTIME_APP_ID"
	EnvKey     = "HUBFLY_REALTIME_KEY"
	EnvSecret  = "HUBFLY_REALTIME_SECRET"
	EnvE2EKeys = "HUBFLY_REALTIME_E2E_KEYS"
)

// FromEnv builds a Client from HUBFLY_REALTIME_URL, HUBFLY_REALTIME_APP_ID,
// HUBFLY_REALTIME_KEY, HUBFLY_REALTIME_SECRET and the optional HUBFLY_REALTIME_E2E_KEYS. Each
// falls back to the Laravel/Pusher names (PUSHER_HOST/PUSHER_PORT/PUSHER_SCHEME, PUSHER_APP_ID,
// PUSHER_APP_KEY, PUSHER_APP_SECRET).
func FromEnv() (*Client, error) { return FromEnvFunc(os.Getenv) }

// FromEnvFunc is FromEnv with a custom lookup (tests, config maps).
func FromEnvFunc(getenv func(string) string) (*Client, error) {
	first := func(names ...string) string {
		for _, n := range names {
			if v := getenv(n); v != "" {
				return v
			}
		}
		return ""
	}
	u := getenv(EnvURL)
	if u == "" && getenv("PUSHER_HOST") != "" {
		scheme := first("PUSHER_SCHEME")
		if scheme == "" {
			scheme = "https"
		}
		port := getenv("PUSHER_PORT")
		if port != "" && !(scheme == "https" && port == "443") && !(scheme == "http" && port == "80") {
			port = ":" + port
		} else {
			port = ""
		}
		u = scheme + "://" + getenv("PUSHER_HOST") + port
	}
	c := &Client{
		URL:            u,
		AppID:          first(EnvAppID, "PUSHER_APP_ID"),
		Key:            first(EnvKey, "PUSHER_APP_KEY"),
		Secret:         first(EnvSecret, "PUSHER_APP_SECRET"),
		EncryptionKeys: getenv(EnvE2EKeys),
	}
	var missing []string
	for _, f := range []struct{ v, name string }{{c.URL, EnvURL}, {c.AppID, EnvAppID}, {c.Key, EnvKey}, {c.Secret, EnvSecret}} {
		if f.v == "" {
			missing = append(missing, f.name)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("hubfly realtime: missing environment variables: %s", strings.Join(missing, ", "))
	}
	if _, err := c.baseURL(); err != nil {
		return nil, err
	}
	if _, err := c.masterKeys(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

var defaultHTTPClient = &http.Client{Timeout: 10 * time.Second}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return defaultHTTPClient
}

var appIDRE = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (c *Client) baseURL() (string, error) {
	u, err := url.Parse(c.URL)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("hubfly realtime: invalid URL %q", c.URL)
	}
	scheme := map[string]string{"https": "https", "wss": "https", "http": "http", "ws": "http"}[u.Scheme]
	if scheme == "" {
		return "", fmt.Errorf("hubfly realtime: URL must be https:// (got %s://)", u.Scheme)
	}
	if !appIDRE.MatchString(c.AppID) {
		return "", errors.New("hubfly realtime: invalid AppID")
	}
	if c.Key == "" || c.Secret == "" {
		return "", errors.New("hubfly realtime: Key and Secret are required")
	}
	return scheme + "://" + u.Host + strings.TrimRight(u.Path, "/"), nil
}

// masterKeys parses EncryptionKeys (cached); nil when none are configured.
func (c *Client) masterKeys() ([]MasterKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(c.EncryptionKeys) == "" {
		return nil, nil
	}
	if c.keysSrc != c.EncryptionKeys || (c.keys == nil && c.keysErr == nil) {
		c.keysSrc = c.EncryptionKeys
		c.keys, c.keysErr = ParseKeyList(c.EncryptionKeys)
	}
	return c.keys, c.keysErr
}

func (c *Client) requireKeys(what string) ([]MasterKey, error) {
	keys, err := c.masterKeys()
	if err != nil {
		return nil, err
	}
	if keys == nil {
		return nil, fmt.Errorf("hubfly realtime: %s needs EncryptionKeys (%s)", what, EnvE2EKeys)
	}
	return keys, nil
}

func hmacHex(secret string, parts ...[]byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	for _, p := range parts {
		m.Write(p)
	}
	return hex.EncodeToString(m.Sum(nil))
}

// SignQuery returns the signed query string of a REST request (Pusher auth version 1.0):
// params plus auth_key, auth_timestamp, auth_version, body_md5 (non-empty bodies) and
// auth_signature = HMAC-SHA256-hex(secret, "<METHOD>\n<path>\n<sorted query>"). path is the
// full path (/apps/<id>/…). Values are URL-encoded in the result, signed unencoded.
func (c *Client) SignQuery(method, path string, params map[string]string, body []byte, at time.Time) string {
	q := map[string]string{}
	for k, v := range params {
		if v != "" {
			q[strings.ToLower(k)] = v
		}
	}
	q["auth_key"] = c.Key
	q["auth_timestamp"] = strconv.FormatInt(at.Unix(), 10)
	q["auth_version"] = "1.0"
	if len(body) > 0 {
		sum := md5.Sum(body)
		q["body_md5"] = hex.EncodeToString(sum[:])
	}
	delete(q, "auth_signature")
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var plain, enc strings.Builder
	for i, k := range keys {
		if i > 0 {
			plain.WriteByte('&')
			enc.WriteByte('&')
		}
		plain.WriteString(k + "=" + q[k])
		enc.WriteString(url.QueryEscape(k) + "=" + url.QueryEscape(q[k]))
	}
	sig := hmacHex(c.Secret, []byte(strings.ToUpper(method)+"\n"+path+"\n"+plain.String()))
	return enc.String() + "&auth_signature=" + sig
}

// APIError is a non-2xx answer of the realtime REST API.
type APIError struct {
	Status int
	// Message is the API's "error" member (or the HTTP status text).
	Message string
	// Reason is "e2e_required" when the app's encryption policy rejected plaintext.
	Reason string
	// RetryAfter is the Retry-After header (429, 503).
	RetryAfter time.Duration
	Body       []byte
}

func (e *APIError) Error() string {
	return fmt.Sprintf("hubfly realtime: HTTP %d: %s", e.Status, e.Message)
}

// IsNotFound reports whether err is a 404 API error.
func IsNotFound(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusNotFound
}

func newAPIError(res *http.Response, body []byte) *APIError {
	e := &APIError{Status: res.StatusCode, Body: body, Message: http.StatusText(res.StatusCode)}
	var parsed struct {
		Error  string `json:"error"`
		Reason string `json:"reason"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		if parsed.Error != "" {
			e.Message = parsed.Error
		}
		e.Reason = parsed.Reason
	}
	if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil {
		e.RetryAfter = time.Duration(s) * time.Second
	}
	return e
}

// do sends a signed request to /apps/<id><path> and decodes a JSON answer into out.
func (c *Client) do(ctx context.Context, method, path string, params map[string]string, body any, idempotent bool, out any) error {
	base, err := c.baseURL()
	if err != nil {
		return err
	}
	var raw []byte
	if body != nil {
		if raw, err = marshal(body); err != nil {
			return err
		}
	}
	full := "/apps/" + c.AppID + path
	attempts := 1
	if idempotent && !c.DisableRetry {
		attempts = 2
	}
	for attempt := 1; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, base+full+"?"+c.SignQuery(method, full, params, raw, c.now()), bytes.NewReader(raw))
		if err != nil {
			return err
		}
		if raw != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("User-Agent", "hubfly-realtime-go/"+Version)
		res, err := c.httpClient().Do(req)
		if err != nil {
			if attempt < attempts && ctx.Err() == nil {
				if sleepCtx(ctx, 200*time.Millisecond) == nil {
					continue
				}
			}
			return err
		}
		data, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
		res.Body.Close()
		if err != nil {
			return err
		}
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			if out != nil && len(bytes.TrimSpace(data)) > 0 {
				return json.Unmarshal(data, out)
			}
			return nil
		}
		apiErr := newAPIError(res, data)
		if attempt < attempts && (res.StatusCode == 502 || res.StatusCode == 503 || res.StatusCode == 504) {
			wait := apiErr.RetryAfter
			if wait <= 0 {
				wait = 200 * time.Millisecond
			}
			if wait > 2*time.Second {
				wait = 2 * time.Second
			}
			if sleepCtx(ctx, wait) == nil {
				continue
			}
		}
		return apiErr
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Get sends a signed GET to any /apps/<id> sub-path (like the Pusher libraries' generic get).
func (c *Client) Get(ctx context.Context, path string, params map[string]string, out any) error {
	return c.do(ctx, http.MethodGet, path, params, nil, false, out)
}

// Post sends a signed POST to any /apps/<id> sub-path (like the Pusher libraries' generic post).
func (c *Client) Post(ctx context.Context, path string, body any, out any) error {
	if body == nil {
		body = struct{}{}
	}
	return c.do(ctx, http.MethodPost, path, nil, body, false, out)
}

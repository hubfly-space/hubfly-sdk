package hubfly

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// The Dashboard derives the HTTP method from the handler name: get → GET,
// create/add/post → POST, update/put → PUT, delete/remove → DELETE.
func TestMailEndpoints(t *testing.T) {
	const m = "/api/v1/projects/" + tP + "/mail"
	cases := []struct {
		name   string
		call   func(ctx context.Context, c *Client) error
		method string
		path   string
		query  map[string][]string
		body   string // expected JSON, "" for none
	}{
		{"mailboxes list", func(ctx context.Context, c *Client) error { return errOf(c.Mail.Mailboxes.List(ctx, tP)) }, "GET", m + "/mailboxes", nil, ""},
		{"mailboxes enable", func(ctx context.Context, c *Client) error { return errOf(c.Mail.Mailboxes.Enable(ctx, tP)) }, "POST", m + "/mailboxes/enable", nil, ""},
		{"mailboxes create", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.Mailboxes.Create(ctx, tP, CreateMailMailboxParams{Name: "Support", Kind: "shared", Addresses: []string{"help@acme.test"}}))
		}, "POST", m + "/mailboxes/create", nil, `{"name":"Support","kind":"shared","addresses":["help@acme.test"]}`},
		{"mailboxes update", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.Mailboxes.Update(ctx, tP, "mbx_1", UpdateMailMailboxParams{Color: "#0f766e", RemoveCap: true}))
		}, "PUT", m + "/mailboxes/mbx_1/update", nil, `{"color":"#0f766e","capBytes":null}`},
		{"mailboxes update cap", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.Mailboxes.Update(ctx, tP, "mbx_1", UpdateMailMailboxParams{CapBytes: Ptr(int64(1 << 20))}))
		}, "PUT", m + "/mailboxes/mbx_1/update", nil, `{"capBytes":1048576}`},
		{"mailboxes delete", func(ctx context.Context, c *Client) error { return errOf(c.Mail.Mailboxes.Delete(ctx, tP, "mbx_1")) }, "DELETE", m + "/mailboxes/mbx_1/delete", nil, ""},
		{"address delivery", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.SetAddressDelivery(ctx, tP, "help@acme.test", MailAddressDeliveryParams{MailboxIDs: []string{"mbx_1"}}))
		}, "PUT", m + "/addresses/help@acme.test/delivery", nil, `{"mailboxIds":["mbx_1"],"forwardTo":""}`},
		{"address delivery forward only", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.SetAddressDelivery(ctx, tP, "a b@acme.test", MailAddressDeliveryParams{ForwardTo: "me@example.net"}))
		}, "PUT", m + "/addresses/a%20b@acme.test/delivery", nil, `{"mailboxIds":[],"forwardTo":"me@example.net"}`},
		{"people list", func(ctx context.Context, c *Client) error { return errOf(c.Mail.People.List(ctx, tP)) }, "GET", m + "/people", nil, ""},
		{"people create", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.People.Create(ctx, tP, CreateMailPersonParams{Kind: "standalone", Email: "ann@acme.test", Grants: []MailGrant{{MailboxID: "mbx_1", Role: "full"}}, SendInvite: Ptr(true)}))
		}, "POST", m + "/people/create", nil, `{"kind":"standalone","email":"ann@acme.test","grants":[{"mailboxId":"mbx_1","role":"full"}],"sendInvite":true}`},
		{"people update", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.People.Update(ctx, tP, "mu_1", UpdateMailPersonParams{State: "disabled", CanSend: Ptr(false)}))
		}, "PUT", m + "/people/mu_1/update", nil, `{"state":"disabled","canSend":false}`},
		{"people delete", func(ctx context.Context, c *Client) error { return errOf(c.Mail.People.Delete(ctx, tP, "mu_1")) }, "DELETE", m + "/people/mu_1/delete", nil, ""},
		{"people reset", func(ctx context.Context, c *Client) error { return errOf(c.Mail.People.Reset(ctx, tP, "mu_1", true)) }, "POST", m + "/people/mu_1/reset", nil, `{"email":true}`},
		{"identities list", func(ctx context.Context, c *Client) error { return errOf(c.Mail.Identities.List(ctx, tP)) }, "GET", m + "/identities", nil, ""},
		{"identities create", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.Identities.Create(ctx, tP, CreateMailIdentityParams{Address: "help@acme.test", DisplayName: "Acme Help"}))
		}, "POST", m + "/identities/create", nil, `{"address":"help@acme.test","displayName":"Acme Help"}`},
		{"identities update", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.Identities.Update(ctx, tP, "idn_1", UpdateMailIdentityParams{ReplyTo: Ptr("")}))
		}, "PUT", m + "/identities/idn_1/update", nil, `{"replyTo":""}`},
		{"identities delete", func(ctx context.Context, c *Client) error { return errOf(c.Mail.Identities.Delete(ctx, tP, "idn_1")) }, "DELETE", m + "/identities/idn_1/delete", nil, ""},
		{"brand get", func(ctx context.Context, c *Client) error { return errOf(c.Mail.GetBrand(ctx, tP)) }, "GET", m + "/brand", nil, ""},
		{"brand update", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.UpdateBrand(ctx, tP, map[string]any{"productName": "Acme Mail"}))
		}, "PUT", m + "/brand/update", nil, `{"brand":{"productName":"Acme Mail"}}`},
		{"storage", func(ctx context.Context, c *Client) error { return errOf(c.Mail.GetStorage(ctx, tP, false)) }, "GET", m + "/storage", nil, ""},
		{"storage refresh", func(ctx context.Context, c *Client) error { return errOf(c.Mail.GetStorage(ctx, tP, true)) }, "GET", m + "/storage", map[string][]string{"refresh": {"true"}}, ""},
		{"ai get", func(ctx context.Context, c *Client) error { return errOf(c.Mail.GetAISettings(ctx, tP)) }, "GET", m + "/ai", nil, ""},
		{"ai update", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.UpdateAISettings(ctx, tP, MailAISettings{Enabled: true, Features: []string{"summarize"}}))
		}, "PUT", m + "/ai/update", nil, `{"enabled":true,"features":["summarize"]}`},
		{"keys list", func(ctx context.Context, c *Client) error { return errOf(c.Mail.MailboxKeys.List(ctx, tP)) }, "GET", m + "/mailbox-keys", nil, ""},
		{"keys create", func(ctx context.Context, c *Client) error {
			return errOf(c.Mail.MailboxKeys.Create(ctx, tP, CreateMailMailboxKeyParams{Name: "helpdesk", Scopes: []string{"read", "send"}, MailboxRoles: map[string]string{"mbx_1": "full"}}))
		}, "POST", m + "/mailbox-keys/create", nil, `{"name":"helpdesk","scopes":["read","send"],"mailboxRoles":{"mbx_1":"full"}}`},
		{"keys revoke", func(ctx context.Context, c *Client) error { return errOf(c.Mail.MailboxKeys.Revoke(ctx, tP, "key_1")) }, "POST", m + "/mailbox-keys/key_1/revoke", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake, c := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
				data := "{}"
				if r.Method == "GET" && (strings.HasSuffix(r.Path, "/people") || strings.HasSuffix(r.Path, "/identities") || strings.HasSuffix(r.Path, "/mailbox-keys")) {
					data = "[]"
				}
				return 200, `{"ok":true,"data":` + data + `,"meta":{"requestId":"req_1","timestamp":"t"}}`
			})
			if err := tc.call(context.Background(), c); err != nil {
				t.Fatalf("call: %v", err)
			}
			reqs := fake.all()
			if len(reqs) != 1 {
				t.Fatalf("got %d requests", len(reqs))
			}
			r := reqs[0]
			if r.Method != tc.method || r.Path != tc.path {
				t.Errorf("got %s %s, want %s %s", r.Method, r.Path, tc.method, tc.path)
			}
			query := tc.query
			if query == nil {
				query = map[string][]string{}
			}
			if !reflect.DeepEqual(r.Query, query) {
				t.Errorf("query %v, want %v", r.Query, query)
			}
			if tc.body == "" {
				if r.Body != "" {
					t.Errorf("unexpected body %s", r.Body)
				}
				return
			}
			var got, want any
			if err := json.Unmarshal([]byte(r.Body), &got); err != nil {
				t.Fatalf("body %q: %v", r.Body, err)
			}
			_ = json.Unmarshal([]byte(tc.body), &want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("body %s, want %s", r.Body, tc.body)
			}
		})
	}
}

func TestMailDecodesEnvelopeAndErrors(t *testing.T) {
	_, c := newFakeManagedAPI(t, func(r recordedRequest) (int, string) {
		if r.Method == "POST" {
			return 200, `{"ok":true,"data":{"key":{"id":"key_1","name":"helpdesk","keyHint":"hfmb_…ab12","scopes":["read"],"mailboxRoles":{"mbx_1":"read"},"identityIds":[],"createdAt":"t","revokedAt":null},"secret":"hfmb_secret"},"meta":{"requestId":"r","timestamp":"t"}}`
		}
		return 403, `{"ok":false,"error":{"code":"FORBIDDEN","message":"Missing permission"},"meta":{"requestId":"req_9"}}`
	})
	ctx := context.Background()
	res, err := c.Mail.MailboxKeys.Create(ctx, tP, CreateMailMailboxKeyParams{Name: "helpdesk", Scopes: []string{"read"}, MailboxRoles: map[string]string{"mbx_1": "read"}})
	if err != nil || res.Data.Secret != "hfmb_secret" || res.Data.Key.MailboxRoles["mbx_1"] != "read" || res.Data.Key.RevokedAt != nil {
		t.Fatalf("create %+v, %v", res, err)
	}
	_, err = c.Mail.People.List(ctx, tP)
	if !IsAPIErrorCode(err, "FORBIDDEN") {
		t.Fatalf("err %v", err)
	}
}

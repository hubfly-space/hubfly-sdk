package hubfly

import (
	"context"
	"fmt"
)

type SubaccountsService struct{ client *Client }

func (s *SubaccountsService) List(ctx context.Context) (*Response[[]Subaccount], error) {
	return Request[[]Subaccount](ctx, s.client, "GET", "/api/v1/subaccounts", nil)
}

func (s *SubaccountsService) Create(ctx context.Context, params CreateSubaccountParams) (*Response[Subaccount], error) {
	return Request[Subaccount](ctx, s.client, "POST", "/api/v1/subaccounts/create", params)
}

func (s *SubaccountsService) Get(ctx context.Context, id string) (*Response[Subaccount], error) {
	return Request[Subaccount](ctx, s.client, "GET", fmt.Sprintf("/api/v1/subaccounts/%s", id), nil)
}

func (s *SubaccountsService) Suspend(ctx context.Context, id string) (*Response[Subaccount], error) {
	return Request[Subaccount](ctx, s.client, "POST", fmt.Sprintf("/api/v1/subaccounts/%s/suspend", id), nil)
}

func (s *SubaccountsService) Resume(ctx context.Context, id string) (*Response[Subaccount], error) {
	return Request[Subaccount](ctx, s.client, "POST", fmt.Sprintf("/api/v1/subaccounts/%s/resume", id), nil)
}

func (s *SubaccountsService) Close(ctx context.Context, id string) (*Response[Subaccount], error) {
	return Request[Subaccount](ctx, s.client, "POST", fmt.Sprintf("/api/v1/subaccounts/%s/close", id), nil)
}

func (s *SubaccountsService) ListKeys(ctx context.Context, id string) (*Response[[]SubaccountKey], error) {
	return Request[[]SubaccountKey](ctx, s.client, "GET", fmt.Sprintf("/api/v1/subaccounts/%s/api-keys", id), nil)
}

func (s *SubaccountsService) CreateKey(ctx context.Context, id string, params map[string]interface{}) (*Response[SubaccountKey], error) {
	return Request[SubaccountKey](ctx, s.client, "POST", fmt.Sprintf("/api/v1/subaccounts/%s/api-keys/create", id), params)
}

func (s *SubaccountsService) RevokeKey(ctx context.Context, id, keyID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "POST", fmt.Sprintf("/api/v1/subaccounts/%s/api-keys/%s/revoke", id, keyID), nil)
}

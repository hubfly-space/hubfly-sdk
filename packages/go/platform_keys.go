package hubfly

import (
	"context"
	"fmt"
)

type PlatformKeysService struct{ client *Client }

func (s *PlatformKeysService) List(ctx context.Context, parentType, parentID string) (*Response[[]SubaccountKey], error) {
	return Request[[]SubaccountKey](ctx, s.client, "GET", fmt.Sprintf("/api/v1/platform/api-keys?parentType=%s&parentId=%s", parentType, parentID), nil)
}

func (s *PlatformKeysService) Create(ctx context.Context, params map[string]interface{}) (*Response[SubaccountKey], error) {
	return Request[SubaccountKey](ctx, s.client, "POST", "/api/v1/platform/api-keys/create", params)
}

func (s *PlatformKeysService) Revoke(ctx context.Context, keyID string) (*Response[map[string]bool], error) {
	return Request[map[string]bool](ctx, s.client, "POST", fmt.Sprintf("/api/v1/platform/api-keys/%s/revoke", keyID), nil)
}

package hubfly

import (
	"context"
	"fmt"
)

type CoursesService struct {
	client *Client
}

func (s *CoursesService) GetAssignments(ctx context.Context, courseID string) (*Response[[]interface{}], error) {
	path := fmt.Sprintf("/api/v1/courses/%s/assignments", courseID)
	return Request[[]interface{}](ctx, s.client, "GET", path, nil)
}

func (s *CoursesService) CreateAssignment(ctx context.Context, courseID string, body interface{}) (*Response[interface{}], error) {
	path := fmt.Sprintf("/api/v1/courses/%s/assignments/create", courseID)
	return Request[interface{}](ctx, s.client, "POST", path, body)
}

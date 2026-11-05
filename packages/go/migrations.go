package hubfly

import (
	"context"
	"net/url"
)

type ProjectMigrationsService struct{ client *Client }
type MigrationBatchesService struct{ client *Client }
type ProjectMovesService struct{ client *Client }

func migrationProjectPath(id string) string { return "/api/v1/projects/" + url.PathEscape(id) }
func (s *ProjectMigrationsService) Get(ctx context.Context, projectID string) (*Response[*ProjectMigrationView], error) {
	return Request[*ProjectMigrationView](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migration", nil)
}
func (s *ProjectMigrationsService) Targets(ctx context.Context, projectID string) (*Response[MigrationTargetRegions], error) {
	return Request[MigrationTargetRegions](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migration/targets", nil)
}
func (s *ProjectMigrationsService) DNS(ctx context.Context, projectID string) (*Response[ProjectMigrationDnsStatus], error) {
	return Request[ProjectMigrationDnsStatus](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migration/dns", nil)
}
func (s *ProjectMigrationsService) List(ctx context.Context, projectID string) (*Response[[]ProjectMigrationView], error) {
	return Request[[]ProjectMigrationView](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migrations", nil)
}
func (s *ProjectMigrationsService) Create(ctx context.Context, projectID string, params CreateProjectMigrationParams) (*Response[ProjectMigrationView], error) {
	return Request[ProjectMigrationView](ctx, s.client, "POST", migrationProjectPath(projectID)+"/migration/create", params)
}
func (s *ProjectMigrationsService) Probe(ctx context.Context, projectID string, targetRegionID string) (*Response[MigrationBandwidthProbe], error) {
	return Request[MigrationBandwidthProbe](ctx, s.client, "POST", migrationProjectPath(projectID)+"/migration/probe", map[string]string{"targetRegionId": targetRegionID})
}
func (s *ProjectMigrationsService) Cancel(ctx context.Context, projectID string) (*Response[ProjectMigrationView], error) {
	return Request[ProjectMigrationView](ctx, s.client, "POST", migrationProjectPath(projectID)+"/migration/cancel", map[string]string{})
}
func (s *ProjectMigrationsService) Continue(ctx context.Context, projectID string, decision string) (*Response[ProjectMigrationView], error) {
	return Request[ProjectMigrationView](ctx, s.client, "POST", migrationProjectPath(projectID)+"/migration/continue", map[string]string{"decision": decision})
}
func (s *ProjectMigrationsService) MoveBack(ctx context.Context, projectID string, params MoveBackProjectMigrationParams) (*Response[ProjectMigrationView], error) {
	return Request[ProjectMigrationView](ctx, s.client, "POST", migrationProjectPath(projectID)+"/migration/move-back", params)
}
func (s *ProjectMigrationsService) Rehome(ctx context.Context, projectID string, params CreateProjectRehomeParams) (*Response[ProjectMigrationView], error) {
	return Request[ProjectMigrationView](ctx, s.client, "POST", migrationProjectPath(projectID)+"/rehome/create", params)
}
func (s *ProjectMigrationsService) Preview(ctx context.Context, projectID, targetRegionID string, mode ProjectMigrationMode) (*Response[ProjectMigrationPreview], error) {
	q := url.Values{"targetRegionId": {targetRegionID}}
	if mode != "" {
		q.Set("mode", string(mode))
	}
	return Request[ProjectMigrationPreview](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migration/preview?"+q.Encode(), nil)
}
func (s *ProjectMigrationsService) Attestation(ctx context.Context, projectID, migrationID string) (*Response[MigrationAttestation], error) {
	return Request[MigrationAttestation](ctx, s.client, "GET", migrationProjectPath(projectID)+"/migration/attestation?"+url.Values{"migrationId": {migrationID}}.Encode(), nil)
}
func (s *MigrationBatchesService) List(ctx context.Context) (*Response[[]MigrationBatchView], error) {
	return Request[[]MigrationBatchView](ctx, s.client, "GET", "/api/v1/migration-batches", nil)
}
func (s *MigrationBatchesService) Get(ctx context.Context, id string) (*Response[MigrationBatchView], error) {
	return Request[MigrationBatchView](ctx, s.client, "GET", "/api/v1/migration-batches/"+url.PathEscape(id), nil)
}
func (s *MigrationBatchesService) Create(ctx context.Context, params CreateMigrationBatchParams) (*Response[MigrationBatchView], error) {
	return Request[MigrationBatchView](ctx, s.client, "POST", "/api/v1/migration-batches/create", params)
}
func (s *MigrationBatchesService) Cancel(ctx context.Context, id string) (*Response[MigrationBatchView], error) {
	return Request[MigrationBatchView](ctx, s.client, "POST", "/api/v1/migration-batches/"+url.PathEscape(id)+"/cancel", map[string]string{})
}
func (s *ProjectMovesService) Notices(ctx context.Context) (*Response[ProjectMoveNotices], error) {
	return Request[ProjectMoveNotices](ctx, s.client, "GET", "/api/v1/project-moves/notices", nil)
}

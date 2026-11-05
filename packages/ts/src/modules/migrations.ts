import type { HubflyClient } from "../client.js";
import type {ApiResponse, ProjectMigrationView, ProjectMigrationPreview, MigrationTargetRegion, ProjectMigrationMode, CreateProjectMigrationParams, ProjectMigrationDnsStatus, MigrationAttestation, MigrationBatchView, CreateMigrationBatchParams, ProjectMoveNotice, MigrationBandwidthProbe} from "../types.js";
const projectPath=(id:string)=>`/api/v1/projects/${encodeURIComponent(id)}`;
export class ProjectMigrationsSubModule {
 constructor(private readonly client:HubflyClient){}
 get(projectId:string):Promise<ApiResponse<ProjectMigrationView|null>> {return this.client.request(`${projectPath(projectId)}/migration`);}
 targets(projectId:string):Promise<ApiResponse<{regions:MigrationTargetRegion[]}>> {return this.client.request(`${projectPath(projectId)}/migration/targets`);}
 preview(projectId:string,targetRegionId:string,mode?:ProjectMigrationMode):Promise<ApiResponse<ProjectMigrationPreview>> {const query=new URLSearchParams({targetRegionId});if(mode)query.set("mode",mode);return this.client.request(`${projectPath(projectId)}/migration/preview?${query}`);}
 probe(projectId:string,targetRegionId:string):Promise<ApiResponse<MigrationBandwidthProbe>> {return this.client.request(`${projectPath(projectId)}/migration/probe`,{method:"POST",body:{targetRegionId}});}
 create(projectId:string,params:CreateProjectMigrationParams):Promise<ApiResponse<ProjectMigrationView>> {return this.client.request(`${projectPath(projectId)}/migration/create`,{method:"POST",body:params});}
 cancel(projectId:string):Promise<ApiResponse<ProjectMigrationView>> {return this.client.request(`${projectPath(projectId)}/migration/cancel`,{method:"POST",body:{}});}
 continue(projectId:string,decision:"freeze_now"|"keep_syncing"|"cancel"):Promise<ApiResponse<ProjectMigrationView>> {return this.client.request(`${projectPath(projectId)}/migration/continue`,{method:"POST",body:{decision}});}
 moveBack(projectId:string,params:{confirmName:string;mode?:ProjectMigrationMode}):Promise<ApiResponse<ProjectMigrationView>> {return this.client.request(`${projectPath(projectId)}/migration/move-back`,{method:"POST",body:params});}
 dns(projectId:string):Promise<ApiResponse<ProjectMigrationDnsStatus>> {return this.client.request(`${projectPath(projectId)}/migration/dns`);}
 attestation(projectId:string,migrationId:string):Promise<ApiResponse<MigrationAttestation>> {return this.client.request(`${projectPath(projectId)}/migration/attestation?${new URLSearchParams({migrationId})}`);}
 list(projectId:string):Promise<ApiResponse<ProjectMigrationView[]>> {return this.client.request(`${projectPath(projectId)}/migrations`);}
 rehome(projectId:string,params:{targetRegionId:string;confirmName:string}):Promise<ApiResponse<ProjectMigrationView>> {return this.client.request(`${projectPath(projectId)}/rehome/create`,{method:"POST",body:params});}
}
export class MigrationBatchesModule {
 constructor(private readonly client:HubflyClient){}
 list():Promise<ApiResponse<MigrationBatchView[]>> {return this.client.request("/api/v1/migration-batches");}
 create(params:CreateMigrationBatchParams):Promise<ApiResponse<MigrationBatchView>> {return this.client.request("/api/v1/migration-batches/create",{method:"POST",body:params});}
 get(batchId:string):Promise<ApiResponse<MigrationBatchView>> {return this.client.request(`/api/v1/migration-batches/${encodeURIComponent(batchId)}`);}
 cancel(batchId:string):Promise<ApiResponse<MigrationBatchView>> {return this.client.request(`/api/v1/migration-batches/${encodeURIComponent(batchId)}/cancel`,{method:"POST",body:{}});}
}
export class ProjectMovesModule {
 constructor(private readonly client:HubflyClient){}
 notices():Promise<ApiResponse<{notices:ProjectMoveNotice[]}>> {return this.client.request("/api/v1/project-moves/notices");}
}
export function migrationBatchConfirmText(count:number) {return `MIGRATE ${count} PROJECTS`;}

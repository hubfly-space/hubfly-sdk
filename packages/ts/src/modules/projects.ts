import type { HubflyClient } from "../client.js";
import { ProjectMigrationsSubModule } from "./migrations.js";
import type {
  ApiResponse,
  Project,
  CreateProjectParams,
  Container,
  CreateContainerParams,
  Volume,
  CreateVolumeParams,
  EnvVar,
  LoadBalancer,
  CreateLoadBalancerParams,
  UpdateLoadBalancerParams,
  CreateLoadBalancerTargetParams,
  CreateLoadBalancerDomainParams,
  NetworkAccess,
  NetworkAccessKey,
  NetworkFirewall,
  NetworkLog,
  NetworkProxy,
  ChallengeRouteType,
  ChallengeRoute,
  RouteChallengePolicy,
  UpdateChallengePolicyParams,
  CreatedChallengeBypassKey,
  ChallengeAnalytics,
  PortReservation,
  ReservePortParams,
  MapPortParams,
  RegistryCredential,
  CreateRegistryCredentialParams,
  RegistryImage,
  ImageScanResult,
  RegistryToken,
  RegistryWebhook,
  SubdomainReservation,
  CreateSubdomainParams,
  TeamMember,
  TeamInvitation,
  CreateTeamInvitationParams,
  ProjectTunnel,
  CreateTunnelParams,
  ProjectWebhook,
  CreateWebhookParams,
  HibernationStatus,
  HibernationPreview,
  ProjectTransferView,
  ProjectTransferPreview,
  ProjectTransferOtp,
  ProjectTransferList,
  ProjectTransferOfferView,
  ProjectTransferAcceptancePreview,
  ProjectTransferBundle,
  ProjectTransferDestinationParams,
  AcceptProjectTransferParams,
  CreateProjectTransferOtpParams,
  CreateProjectTransferParams,
  CreateProjectTransferBundleOtpParams,
  CreateProjectTransferBundleParams,
  ProjectHistoryEntry,
} from "../types.js";

export class ContainersSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<Container[]>> {
    return this.client.request<Container[]>(
      `/api/v1/projects/${projectId}/containers`,
    );
  }

  public async get(
    projectId: string,
    containerId: string,
  ): Promise<ApiResponse<Container>> {
    return this.client.request<Container>(
      `/api/v1/projects/${projectId}/containers/${containerId}`,
    );
  }

  public async create(
    params: CreateContainerParams,
  ): Promise<ApiResponse<Container>> {
    return this.client.request<Container>(
      `/api/v1/projects/${params.projectId}/containers`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async delete(
    projectId: string,
    containerId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/containers/${containerId}`,
      {
        method: "DELETE",
      },
    );
  }

  public async restart(
    projectId: string,
    containerId: string,
  ): Promise<ApiResponse<{ restarted: boolean }>> {
    return this.client.request<{ restarted: boolean }>(
      `/api/v1/projects/${projectId}/containers/${containerId}/restart`,
      { method: "POST" },
    );
  }
}

export class LoadBalancersSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<LoadBalancer[]>> {
    return this.client.request<LoadBalancer[]>(
      `/api/v1/projects/${projectId}/load-balancers`,
    );
  }

  public async get(
    projectId: string,
    lbId: string,
  ): Promise<ApiResponse<LoadBalancer>> {
    return this.client.request<LoadBalancer>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}`,
    );
  }

  public async create(
    params: CreateLoadBalancerParams,
  ): Promise<ApiResponse<LoadBalancer>> {
    return this.client.request<LoadBalancer>(
      `/api/v1/projects/${params.projectId}/load-balancers/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async update(
    projectId: string,
    lbId: string,
    params: UpdateLoadBalancerParams,
  ): Promise<ApiResponse<LoadBalancer>> {
    return this.client.request<LoadBalancer>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/update`,
      {
        method: "PUT",
        body: params,
      },
    );
  }

  public async delete(
    projectId: string,
    lbId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/delete`,
      {
        method: "DELETE",
      },
    );
  }

  public async sync(
    projectId: string,
    lbId: string,
  ): Promise<ApiResponse<{ synced: boolean }>> {
    return this.client.request<{ synced: boolean }>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/sync`,
      { method: 'POST' },
    );
  }

  public async createTarget(
    projectId: string,
    lbId: string,
    params: CreateLoadBalancerTargetParams,
  ): Promise<ApiResponse<LoadBalancer>> {
    return this.client.request<LoadBalancer>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/targets/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async deleteTarget(
    projectId: string,
    lbId: string,
    targetId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/targets/${targetId}/delete`,
      { method: "DELETE" },
    );
  }

  public async createDomain(
    projectId: string,
    lbId: string,
    params: CreateLoadBalancerDomainParams,
  ): Promise<ApiResponse<LoadBalancer>> {
    return this.client.request<LoadBalancer>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/domains/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async deleteDomain(
    projectId: string,
    lbId: string,
    domainId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/load-balancers/${lbId}/domains/${domainId}/delete`,
      { method: "DELETE" },
    );
  }
}

export class NetworkSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async get(projectId: string): Promise<ApiResponse<NetworkAccess>> {
    return this.client.request<NetworkAccess>(
      `/api/v1/projects/${projectId}/network`,
    );
  }

  public async getAccess(
    projectId: string,
  ): Promise<ApiResponse<NetworkAccess>> {
    return this.client.request<NetworkAccess>(
      `/api/v1/projects/${projectId}/network/access`,
    );
  }

  public async createAccessKey(
    projectId: string,
    name: string,
  ): Promise<ApiResponse<NetworkAccessKey>> {
    return this.client.request<NetworkAccessKey>(
      `/api/v1/projects/${projectId}/network/access/keys/create`,
      {
        method: "POST",
        body: { name },
      },
    );
  }

  public async revokeAccessKey(
    projectId: string,
    keyId: string,
  ): Promise<ApiResponse<{ revoked: boolean }>> {
    return this.client.request<{ revoked: boolean }>(
      `/api/v1/projects/${projectId}/network/access/keys/revoke`,
      {
        method: "POST",
        body: { keyId },
      },
    );
  }

  public async getFirewall(
    projectId: string,
  ): Promise<ApiResponse<NetworkFirewall>> {
    return this.client.request<NetworkFirewall>(
      `/api/v1/projects/${projectId}/network/firewall`,
    );
  }

  public async updateFirewall(
    projectId: string,
    firewall: NetworkFirewall,
  ): Promise<ApiResponse<NetworkFirewall>> {
    return this.client.request<NetworkFirewall>(
      `/api/v1/projects/${projectId}/network/firewall/update`,
      {
        method: "POST",
        body: firewall,
      },
    );
  }

  public async getLogs(projectId: string): Promise<ApiResponse<NetworkLog[]>> {
    return this.client.request<NetworkLog[]>(
      `/api/v1/projects/${projectId}/network/logs`,
    );
  }

  public async getProxy(projectId: string): Promise<ApiResponse<NetworkProxy>> {
    return this.client.request<NetworkProxy>(
      `/api/v1/projects/${projectId}/network/proxy`,
    );
  }

  public async listChallengeRoutes(
    projectId: string,
  ): Promise<ApiResponse<{ routes: ChallengeRoute[] }>> {
    return this.client.request<{ routes: ChallengeRoute[] }>(
      `/api/v1/projects/${projectId}/network/challenge/routes`,
    );
  }

  public async getChallengePolicy(
    projectId: string,
    routeType: ChallengeRouteType,
    routeId: string,
  ): Promise<ApiResponse<{ policy: RouteChallengePolicy | null }>> {
    return this.client.request<{ policy: RouteChallengePolicy | null }>(
      `/api/v1/projects/${projectId}/network/challenge?routeType=${encodeURIComponent(routeType)}&routeId=${encodeURIComponent(routeId)}`,
    );
  }

  public async updateChallengePolicy(
    projectId: string,
    routeType: ChallengeRouteType,
    routeId: string,
    config: UpdateChallengePolicyParams,
  ): Promise<ApiResponse<RouteChallengePolicy>> {
    return this.client.request<RouteChallengePolicy>(
      `/api/v1/projects/${projectId}/network/challenge/update`,
      { method: "PUT", body: { routeType, routeId, config } },
    );
  }

  public async createChallengeBypassKey(
    projectId: string,
    policyId: string,
    name: string,
    allowedPaths: string[] = [],
    expiresAt?: string | null,
  ): Promise<ApiResponse<CreatedChallengeBypassKey>> {
    return this.client.request<CreatedChallengeBypassKey>(
      `/api/v1/projects/${projectId}/network/challenge/keys/create`,
      { method: "POST", body: { policyId, name, allowedPaths, expiresAt } },
    );
  }

  public async revokeChallengeBypassKey(
    projectId: string,
    policyId: string,
    keyId: string,
  ): Promise<ApiResponse<{ revoked: boolean }>> {
    return this.client.request<{ revoked: boolean }>(
      `/api/v1/projects/${projectId}/network/challenge/keys/revoke`,
      { method: "POST", body: { policyId, keyId } },
    );
  }

  public async retryChallengePolicy(
    projectId: string,
    policyId: string,
  ): Promise<ApiResponse<RouteChallengePolicy>> {
    return this.client.request<RouteChallengePolicy>(
      `/api/v1/projects/${projectId}/network/challenge/retry`,
      { method: "POST", body: { policyId } },
    );
  }

  public async getChallengeAnalytics(
    projectId: string,
    domain: string,
    range: "24h" | "7d" | "30d" = "24h",
  ): Promise<ApiResponse<ChallengeAnalytics>> {
    return this.client.request<ChallengeAnalytics>(
      `/api/v1/projects/${projectId}/network/challenge/analytics?domain=${encodeURIComponent(domain)}&range=${range}`,
    );
  }
}

export class PortsSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(
    projectId: string,
  ): Promise<ApiResponse<PortReservation[]>> {
    return this.client.request<PortReservation[]>(
      `/api/v1/projects/${projectId}/ports`,
    );
  }

  public async reserve(
    projectId: string,
    params: ReservePortParams,
  ): Promise<ApiResponse<PortReservation>> {
    return this.client.request<PortReservation>(
      `/api/v1/projects/${projectId}/ports/reserve`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async remove(
    projectId: string,
    reservationId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(
      `/api/v1/projects/${projectId}/ports/${reservationId}`,
      {
        method: "DELETE",
      },
    );
  }

  public async map(
    projectId: string,
    reservationId: string,
    params: MapPortParams,
  ): Promise<ApiResponse<PortReservation>> {
    return this.client.request<PortReservation>(
      `/api/v1/projects/${projectId}/ports/${reservationId}/map`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async unmap(
    projectId: string,
    reservationId: string,
  ): Promise<ApiResponse<PortReservation>> {
    return this.client.request<PortReservation>(
      `/api/v1/projects/${projectId}/ports/${reservationId}/unmap`,
      {
        method: "POST",
      },
    );
  }
}

export class RegistrySubModule {
  constructor(private readonly client: HubflyClient) {}

  public async listCredentials(
    projectId: string,
  ): Promise<ApiResponse<RegistryCredential[]>> {
    return this.client.request<RegistryCredential[]>(
      `/api/v1/projects/${projectId}/registry-credentials`,
    );
  }

  public async createCredential(
    projectId: string,
    params: CreateRegistryCredentialParams,
  ): Promise<ApiResponse<RegistryCredential>> {
    return this.client.request<RegistryCredential>(
      `/api/v1/projects/${projectId}/registry-credentials/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async deleteCredential(
    projectId: string,
    credentialId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/registry-credentials/${credentialId}/delete`,
      { method: "DELETE" },
    );
  }

  public async listImages(
    projectId: string,
  ): Promise<ApiResponse<RegistryImage[]>> {
    return this.client.request<RegistryImage[]>(
      `/api/v1/projects/${projectId}/registry/images`,
    );
  }

  public async getImage(
    projectId: string,
    imageId: string,
  ): Promise<ApiResponse<RegistryImage>> {
    return this.client.request<RegistryImage>(
      `/api/v1/projects/${projectId}/registry/images/${imageId}`,
    );
  }

  public async deleteImage(
    projectId: string,
    imageId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/registry/images/${imageId}/delete`,
      {
        method: "DELETE",
      },
    );
  }

  public async getScan(
    projectId: string,
    imageId: string,
  ): Promise<ApiResponse<ImageScanResult>> {
    return this.client.request<ImageScanResult>(
      `/api/v1/projects/${projectId}/registry/images/${imageId}/scan`,
    );
  }

  public async triggerScan(
    projectId: string,
    imageId: string,
  ): Promise<ApiResponse<ImageScanResult>> {
    return this.client.request<ImageScanResult>(
      `/api/v1/projects/${projectId}/registry/images/${imageId}/scan/trigger`,
      { method: 'POST' },
    );
  }
}

export class SubdomainsSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(
    projectId: string,
  ): Promise<ApiResponse<SubdomainReservation[]>> {
    return this.client.request<SubdomainReservation[]>(
      `/api/v1/projects/${projectId}/subdomains`,
    );
  }

  public async reserve(
    projectId: string,
    params: CreateSubdomainParams,
  ): Promise<ApiResponse<SubdomainReservation>> {
    return this.client.request<SubdomainReservation>(
      `/api/v1/projects/${projectId}/subdomains/reserve`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async remove(
    projectId: string,
    subdomainId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(
      `/api/v1/projects/${projectId}/subdomains/${subdomainId}`,
      {
        method: "DELETE",
      },
    );
  }
}

export class TeamSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async get(projectId: string): Promise<ApiResponse<TeamMember[]>> {
    return this.client.request<TeamMember[]>(
      `/api/v1/projects/${projectId}/team`,
    );
  }

  public async createInvitation(
    projectId: string,
    params: CreateTeamInvitationParams,
  ): Promise<ApiResponse<TeamInvitation>> {
    return this.client.request<TeamInvitation>(
      `/api/v1/projects/${projectId}/team/invitations/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async revokeInvitation(
    projectId: string,
    invitationId: string,
  ): Promise<ApiResponse<{ revoked: boolean }>> {
    return this.client.request<{ revoked: boolean }>(
      `/api/v1/projects/${projectId}/team/invitations/${invitationId}/revoke`,
      { method: "DELETE" },
    );
  }

  public async removeMember(
    projectId: string,
    userId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(
      `/api/v1/projects/${projectId}/team/members/${userId}/remove`,
      {
        method: "DELETE",
      },
    );
  }
}

export class TunnelsSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<ProjectTunnel[]>> {
    return this.client.request<ProjectTunnel[]>(
      `/api/v1/projects/${projectId}/tunnels`,
    );
  }

  public async create(
    projectId: string,
    params: CreateTunnelParams,
  ): Promise<ApiResponse<ProjectTunnel>> {
    return this.client.request<ProjectTunnel>(
      `/api/v1/projects/${projectId}/tunnels/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async delete(
    projectId: string,
    tunnelId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/tunnels/${tunnelId}/delete`,
      {
        method: "DELETE",
      },
    );
  }
}

export class VolumesSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<Volume[]>> {
    return this.client.request<Volume[]>(
      `/api/v1/projects/${projectId}/volumes`,
    );
  }

  public async get(
    projectId: string,
    volumeId: string,
  ): Promise<ApiResponse<Volume>> {
    return this.client.request<Volume>(
      `/api/v1/projects/${projectId}/volumes/${volumeId}`,
    );
  }

  public async create(
    params: CreateVolumeParams,
  ): Promise<ApiResponse<Volume>> {
    return this.client.request<Volume>(
      `/api/v1/projects/${params.projectId}/volumes/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async remove(
    projectId: string,
    volumeId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(
      `/api/v1/projects/${projectId}/volumes/${volumeId}/remove`,
      {
        method: "DELETE",
      },
    );
  }
}

export class WebhooksSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async list(projectId: string): Promise<ApiResponse<ProjectWebhook[]>> {
    return this.client.request<ProjectWebhook[]>(
      `/api/v1/projects/${projectId}/webhooks`,
    );
  }

  public async create(
    projectId: string,
    params: CreateWebhookParams,
  ): Promise<ApiResponse<ProjectWebhook>> {
    return this.client.request<ProjectWebhook>(
      `/api/v1/projects/${projectId}/webhooks/create`,
      {
        method: "POST",
        body: params,
      },
    );
  }

  public async remove(
    projectId: string,
    webhookId: string,
  ): Promise<ApiResponse<{ removed: boolean }>> {
    return this.client.request<{ removed: boolean }>(
      `/api/v1/projects/${projectId}/webhooks/${webhookId}`,
      {
        method: "DELETE",
      },
    );
  }
}

export class HibernationSubModule {
  constructor(private readonly client: HubflyClient) {}

  public async hibernate(
    projectId: string,
  ): Promise<ApiResponse<HibernationStatus>> {
    return this.client.request<HibernationStatus>(
      `/api/v1/projects/${projectId}/hibernation/hibernate`,
      { method: 'POST' },
    );
  }

  public async preview(
    projectId: string,
  ): Promise<ApiResponse<HibernationPreview>> {
    return this.client.request<HibernationPreview>(
      `/api/v1/projects/${projectId}/hibernation/preview`,
    );
  }

  public async restore(
    projectId: string,
  ): Promise<ApiResponse<HibernationStatus>> {
    return this.client.request<HibernationStatus>(
      `/api/v1/projects/${projectId}/hibernation/restore`,
      { method: 'POST' },
    );
  }
}

/** The confirmation text a bundle transfer needs: `TRANSFER <n> PROJECTS`. */
export function transferBundleConfirmText(projectCount: number): string {
  return `TRANSFER ${projectCount} PROJECTS`;
}

/**
 * Project transfers: give a project to another HubFly account or an
 * organization. The sender previews, gets an emailed code and creates the
 * offer; the recipient opens the emailed token, previews a destination and
 * accepts. The owner changes at the next full hour.
 *
 * Writes (`createOtp`, `create`, `cancel`, `accept`, `decline` and the bundle
 * calls) need a signed-in dashboard session: API keys and access tokens get
 * `403 MOVE_SESSION_REQUIRED`. Reads accept tokens.
 */
export class ProjectTransfersSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** The project's open transfer, or its latest one; null when it never had one. */
  public async get(
    projectId: string,
  ): Promise<ApiResponse<ProjectTransferView | null>> {
    return this.client.request<ProjectTransferView | null>(
      `/api/v1/projects/${projectId}/transfer`,
    );
  }

  /** What a transfer would move and revoke, and what blocks it (sender only). */
  public async preview(
    projectId: string,
  ): Promise<ApiResponse<ProjectTransferPreview>> {
    return this.client.request<ProjectTransferPreview>(
      `/api/v1/projects/${projectId}/transfer/preview`,
    );
  }

  /** Emails the sender a confirmation code bound to this project and recipient. */
  public async createOtp(
    projectId: string,
    params: CreateProjectTransferOtpParams,
  ): Promise<ApiResponse<ProjectTransferOtp>> {
    return this.client.request<ProjectTransferOtp>(
      `/api/v1/projects/${projectId}/transfer/otp/create`,
      { method: "POST", body: params },
    );
  }

  /**
   * Offers the project to an email address. The response is the same whether
   * or not the address has a HubFly account.
   */
  public async create(
    projectId: string,
    params: CreateProjectTransferParams,
  ): Promise<ApiResponse<ProjectTransferView>> {
    return this.client.request<ProjectTransferView>(
      `/api/v1/projects/${projectId}/transfer/create`,
      { method: "POST", body: params },
    );
  }

  /**
   * Cancels the open offer, or an accepted transfer whose owner change has
   * not started. An accepted transfer may still read `accepted` while its job
   * rolls back; poll `get`.
   */
  public async cancel(
    projectId: string,
  ): Promise<ApiResponse<ProjectTransferView>> {
    return this.client.request<ProjectTransferView>(
      `/api/v1/projects/${projectId}/transfer/cancel`,
      { method: "POST", body: {} },
    );
  }

  /** Offers waiting for you (without tokens) and transfers you started. */
  public async list(): Promise<ApiResponse<ProjectTransferList>> {
    return this.client.request<ProjectTransferList>("/api/v1/project-transfers");
  }

  /**
   * The offer behind an emailed token. Unknown tokens, offers for another
   * email address and closed offers all answer `404 TRANSFER_NOT_FOUND`.
   */
  public async getOffer(
    token: string,
  ): Promise<ApiResponse<ProjectTransferOfferView>> {
    return this.client.request<ProjectTransferOfferView>(
      `/api/v1/project-transfers/${encodeURIComponent(token)}`,
    );
  }

  /** What accepting into a destination costs and requires (recipient only). */
  public async previewAcceptance(
    token: string,
    params: ProjectTransferDestinationParams,
  ): Promise<ApiResponse<ProjectTransferAcceptancePreview>> {
    const search = new URLSearchParams({ destinationType: params.destinationType });
    if (params.destinationId) search.set("destinationId", params.destinationId);
    for (const id of params.transferIds ?? []) search.append("transferIds", id);
    return this.client.request<ProjectTransferAcceptancePreview>(
      `/api/v1/project-transfers/${encodeURIComponent(token)}/preview?${search}`,
    );
  }

  /** Accepts the offer (or part of a bundle) into your account or an organization. */
  public async accept(
    token: string,
    params: AcceptProjectTransferParams,
  ): Promise<ApiResponse<ProjectTransferView[]>> {
    return this.client.request<ProjectTransferView[]>(
      `/api/v1/project-transfers/${encodeURIComponent(token)}/accept`,
      { method: "POST", body: params },
    );
  }

  /** Declines every open project of the offer. */
  public async decline(
    token: string,
  ): Promise<ApiResponse<{ declined: true }>> {
    return this.client.request<{ declined: true }>(
      `/api/v1/project-transfers/${encodeURIComponent(token)}/decline`,
      { method: "POST", body: {} },
    );
  }

  /** Emails the sender a code bound to these projects and recipient. */
  public async createBundleOtp(
    params: CreateProjectTransferBundleOtpParams,
  ): Promise<ApiResponse<ProjectTransferOtp>> {
    return this.client.request<ProjectTransferOtp>(
      "/api/v1/project-transfers/bundles/otp/create",
      { method: "POST", body: params },
    );
  }

  /** Offers several projects to one address with a single token. */
  public async createBundle(
    params: CreateProjectTransferBundleParams,
  ): Promise<ApiResponse<ProjectTransferBundle>> {
    return this.client.request<ProjectTransferBundle>(
      "/api/v1/project-transfers/bundles/create",
      { method: "POST", body: params },
    );
  }
}

export class ProjectsModule {
  public readonly containers: ContainersSubModule;
  public readonly loadBalancers: LoadBalancersSubModule;
  public readonly network: NetworkSubModule;
  public readonly ports: PortsSubModule;
  public readonly registry: RegistrySubModule;
  public readonly subdomains: SubdomainsSubModule;
  public readonly team: TeamSubModule;
  public readonly tunnels: TunnelsSubModule;
  public readonly volumes: VolumesSubModule;
  public readonly webhooks: WebhooksSubModule;
  public readonly hibernation: HibernationSubModule;
  /** Give a project to another account or organization. */
  public readonly migration: ProjectMigrationsSubModule;
 public readonly transfers: ProjectTransfersSubModule;

  constructor(private readonly client: HubflyClient) {
    this.containers = new ContainersSubModule(client);
    this.loadBalancers = new LoadBalancersSubModule(client);
    this.network = new NetworkSubModule(client);
    this.ports = new PortsSubModule(client);
    this.registry = new RegistrySubModule(client);
    this.subdomains = new SubdomainsSubModule(client);
    this.team = new TeamSubModule(client);
    this.tunnels = new TunnelsSubModule(client);
    this.volumes = new VolumesSubModule(client);
    this.webhooks = new WebhooksSubModule(client);
    this.hibernation = new HibernationSubModule(client);
    this.transfers = new ProjectTransfersSubModule(client);
    this.migration = new ProjectMigrationsSubModule(client);
  }

  /**
   * List all projects for current account
   */
  public async list(): Promise<ApiResponse<Project[]>> {
    return this.client.request<Project[]>("/api/v1/projects");
  }

  /**
   * Get project by ID
   */
  public async get(projectId: string): Promise<ApiResponse<Project>> {
    return this.client.request<Project>(`/api/v1/projects/${projectId}`);
  }

  /**
   * Create a new project
   */
  public async create(
    params: CreateProjectParams,
  ): Promise<ApiResponse<Project>> {
    return this.client.request<Project>("/api/v1/projects/create", {
      method: "POST",
      body: params,
    });
  }

  /**
   * Delete a project
   */
  public async delete(
    projectId: string,
  ): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.client.request<{ deleted: boolean }>(
      `/api/v1/projects/${projectId}/delete`,
      {
        method: "DELETE",
      },
    );
  }

  /**
   * Transfers and region moves of a project, newest first
   */
  public async history(
    projectId: string,
  ): Promise<ApiResponse<{ entries: ProjectHistoryEntry[] }>> {
    return this.client.request<{ entries: ProjectHistoryEntry[] }>(
      `/api/v1/projects/${projectId}/history`,
    );
  }

  /**
   * List volumes attached to a project (convenience shortcut)
   */
  public async listVolumes(projectId: string): Promise<ApiResponse<Volume[]>> {
    return this.volumes.list(projectId);
  }

  /**
   * Create a new volume for a project (convenience shortcut)
   */
  public async createVolume(
    params: CreateVolumeParams,
  ): Promise<ApiResponse<Volume>> {
    return this.volumes.create(params);
  }

  /**
   * Get project environment variables
   */
  public async getEnv(projectId: string): Promise<ApiResponse<EnvVar[]>> {
    return this.client.request<EnvVar[]>(`/api/v1/projects/${projectId}/env`);
  }

  /**
   * Update project environment variables
   */
  public async updateEnv(
    projectId: string,
    env: EnvVar[],
  ): Promise<ApiResponse<EnvVar[]>> {
    return this.client.request<EnvVar[]>(`/api/v1/projects/${projectId}/env`, {
      method: "PUT",
      body: { environment: env },
    });
  }
}

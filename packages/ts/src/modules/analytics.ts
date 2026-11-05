import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';
import { ANALYTICS_OPERATIONS } from './analytics-types.js';
import type {
  AnalyticsOperationId,
  AnalyticsOperationTypes,
  AnalyticsQuery,
  AnalyticsQueryResult,
  CreateProjectAnalyticsFunnelBody,
  CreateProjectAnalyticsGoalBody,
  CreateProjectAnalyticsSegmentBody,
  CreateProjectAnalyticsShareBody,
  CreateProjectAnalyticsSiteBody,
  ExportProjectAnalyticsDataQuery,
  RunSharedAnalyticsQueryBody,
  UpdateProjectAnalyticsFunnelBody,
  UpdateProjectAnalyticsGoalBody,
  UpdateProjectAnalyticsSiteBody,
} from './analytics-types.js';

// Web Analytics of the Dashboard API: sites, reports, goals, funnels,
// segments, shared dashboards and ingest keys.
//
// Every request and response type comes from analytics-types.ts, which
// scripts/generate-managed.ts generates from the Dashboard's openapi.json.
// Reading sites, reports, exports and usage needs project:read; every change
// needs project:edit, and sites on HubFly domains (`source: "hubfly_route"`)
// also need network:manage. The monthly event cap needs billing:manage.
// Browsers send events with the `@hubfly/analytics` tracker, not this module.

/** Error codes of the Web Analytics API worth branching on (`HubflyApiError.code`). */
export const AnalyticsErrorCodes = {
  /** 409: new sites cannot be created in this region now; `details.reason` says why (disabled, billing_not_live, region_unavailable, scheduler_not_ready). */
  UNAVAILABLE: 'ANALYTICS_UNAVAILABLE',
  /** 409: an external site's domain is not covered by a verified custom domain; verify it with `verifyDomain`. */
  DOMAIN_UNVERIFIED: 'ANALYTICS_DOMAIN_UNVERIFIED',
  /** 409: another live site already tracks the domain. */
  DOMAIN_TAKEN: 'ANALYTICS_DOMAIN_TAKEN',
  /** 409: the project or owner has reached its site limit. */
  SITE_LIMIT: 'ANALYTICS_SITE_LIMIT',
  /** 404: no such site in the project. */
  SITE_NOT_FOUND: 'ANALYTICS_SITE_NOT_FOUND',
  /** 402: raising retention needs a positive balance. */
  RETENTION_REQUIRES_BALANCE: 'ANALYTICS_RETENTION_REQUIRES_BALANCE',
  /** 400: the query is invalid (unknown dimension, metric or filter). */
  INVALID_QUERY: 'ANALYTICS_INVALID_QUERY',
  /** 504: the query ran out of time; narrow the range or raise `timeoutMs`. */
  QUERY_TIMEOUT: 'ANALYTICS_QUERY_TIMEOUT',
  /** 422: the query would read too much data. */
  QUERY_TOO_LARGE: 'ANALYTICS_QUERY_TOO_LARGE',
  /** 503: the site's analytics region cannot be reached right now. */
  UNREACHABLE: 'ANALYTICS_UNREACHABLE',
  /** 401: the shared dashboard is password-protected; unlock it first. */
  SHARE_LOCKED: 'ANALYTICS_SHARE_LOCKED',
} as const;

export type AnalyticsErrorCode = (typeof AnalyticsErrorCodes)[keyof typeof AnalyticsErrorCodes];

/** Report types of {@link AnalyticsSitesSubModule.query}. */
export type AnalyticsQueryType = AnalyticsQuery['type'];

/** The result member of one report type: `AnalyticsResultOf<'breakdown'>` is `AnalyticsBreakdownResult`. */
export type AnalyticsResultOf<T extends AnalyticsQueryType> = Extract<AnalyticsQueryResult, { type: T }>;

type CallInput<K extends AnalyticsOperationId> = {
  query?: AnalyticsOperationTypes[K]['query'];
  body?: AnalyticsOperationTypes[K]['body'];
};

/**
 * Calls one Web Analytics operation by its operationId. Path parameters are
 * URL-encoded; operations whose body is `{}` always send `{}`.
 * @internal Used by the analytics module; prefer its methods.
 */
export async function callAnalytics<K extends AnalyticsOperationId>(
  client: HubflyClient,
  id: K,
  params: AnalyticsOperationTypes[K]['params'],
  input: CallInput<K> = {},
): Promise<ApiResponse<AnalyticsOperationTypes[K]['response']>> {
  const op = ANALYTICS_OPERATIONS[id];
  const values = params as Record<string, unknown>;
  const path = op.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = values[name];
    if (typeof value !== 'string' || value === '') {
      throw new TypeError(`${id}: path parameter "${name}" must be a non-empty string`);
    }
    return encodeURIComponent(value);
  });
  return client.request<AnalyticsOperationTypes[K]['response']>(path, {
    method: op.method,
    query: input.query as Record<string, string | number | boolean | undefined> | undefined,
    body: op.body === 'empty' ? {} : input.body,
  });
}

/**
 * Web Analytics: `client.analytics`. A project's sites, settings and usage
 * live here; per-site objects are in the sub-modules.
 */
export class AnalyticsModule {
  /** Sites, their reports and exports. */
  public readonly sites: AnalyticsSitesSubModule;
  /** Conversion goals of a site. */
  public readonly goals: AnalyticsGoalsSubModule;
  /** Saved funnels of a site. */
  public readonly funnels: AnalyticsFunnelsSubModule;
  /** Saved segments (filter sets) of a site. */
  public readonly segments: AnalyticsSegmentsSubModule;
  /** Shared dashboard links of a site. */
  public readonly shares: AnalyticsSharesSubModule;
  /** Ingest keys for the server-side events API. */
  public readonly keys: AnalyticsKeysSubModule;
  /** Public shared dashboards, by slug (no sign-in needed). */
  public readonly shared: AnalyticsSharedSubModule;

  constructor(private readonly client: HubflyClient) {
    this.sites = new AnalyticsSitesSubModule(client);
    this.goals = new AnalyticsGoalsSubModule(client);
    this.funnels = new AnalyticsFunnelsSubModule(client);
    this.segments = new AnalyticsSegmentsSubModule(client);
    this.shares = new AnalyticsSharesSubModule(client);
    this.keys = new AnalyticsKeysSubModule(client);
    this.shared = new AnalyticsSharedSubModule(client);
  }

  /** Regions where Web Analytics can be used (any signed-in user). */
  public regions() {
    return callAnalytics(this.client, 'getAnalyticsRegions', {});
  }

  /**
   * The project's analytics: availability in its region, monthly event cap,
   * every site (with its install snippet) and what the caller may change
   * (project:read).
   */
  public get(projectId: string) {
    return callAnalytics(this.client, 'getProjectAnalytics', { projectId });
  }

  /** Sets or clears (`null`) the project's monthly event cap (billing:manage). The cap stops every event, free ones included. */
  public setEventCap(projectId: string, monthlyEventCap: number | null) {
    return callAnalytics(this.client, 'updateProjectAnalytics', { projectId }, { body: { monthlyEventCap } });
  }

  /** This month's events, allowance, collection state and (with billing:view) cost (project:read). */
  public usage(projectId: string) {
    return callAnalytics(this.client, 'getProjectAnalyticsUsage', { projectId });
  }

  /** Domains the project serves through HubFly that a `hubfly_route` site can track (project:read). */
  public routes(projectId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsRoutes', { projectId });
  }

  /**
   * Starts or checks the TXT verification of a domain for external sites
   * (project:edit). While `status` is `pending`, publish `txtValue` at
   * `txtHost` and call again. A verified domain covers its subdomains.
   */
  public verifyDomain(projectId: string, domain: string) {
    return callAnalytics(this.client, 'verifyProjectAnalyticsDomain', { projectId }, { body: { domain } });
  }
}

/** Sites, reports and exports: `client.analytics.sites`. */
export class AnalyticsSitesSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** The project's sites (project:read). */
  public async list(projectId: string): Promise<ApiResponse<AnalyticsOperationTypes['getProjectAnalytics']['response']['sites']>> {
    const response = await callAnalytics(this.client, 'getProjectAnalytics', { projectId });
    return { ...response, data: response.data.sites };
  }

  /**
   * Creates a site (project:edit). `source: "external"` tracks any website
   * whose `domain`/`domains` are verified custom domains of the caller;
   * `source: "hubfly_route"` tracks a domain the project serves (pass
   * `routeType` and `routeId` from {@link AnalyticsModule.routes}, needs
   * network:manage) and can inject the script. The response carries
   * `install.snippet`.
   */
  public create(projectId: string, body: CreateProjectAnalyticsSiteBody) {
    return callAnalytics(this.client, 'createProjectAnalyticsSite', { projectId }, { body });
  }

  /** One site with its settings, sync state and install snippet (project:read). */
  public get(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'getProjectAnalyticsSite', { projectId, siteId });
  }

  /** Changes a site (project:edit). Only the fields given change; `settings` merges. */
  public update(projectId: string, siteId: string, body: UpdateProjectAnalyticsSiteBody) {
    return callAnalytics(this.client, 'updateProjectAnalyticsSite', { projectId, siteId }, { body });
  }

  /** Stops collecting while keeping the data (project:edit). */
  public pause(projectId: string, siteId: string) {
    return this.update(projectId, siteId, { state: 'paused' });
  }

  /** Collects again (project:edit). Answers 409 ANALYTICS_UNAVAILABLE while the region is closed. */
  public resume(projectId: string, siteId: string) {
    return this.update(projectId, siteId, { state: 'active' });
  }

  /** Deletes a site and its data (project:edit). `pending` is true while the region removal is retried. */
  public delete(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'deleteProjectAnalyticsSite', { projectId, siteId });
  }

  /** Whether the tracker is installed (an event arrived), with today's events and storage (project:read). */
  public status(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'getProjectAnalyticsSiteStatus', { projectId, siteId });
  }

  /**
   * Raw events, sessions or daily summaries as CSV or NDJSON, up to 8 MB per
   * call (`truncated` beyond it); export longer ranges in pieces
   * (project:read). `from`/`to` are site-local dates.
   */
  public export(projectId: string, siteId: string, query: ExportProjectAnalyticsDataQuery) {
    return callAnalytics(this.client, 'exportProjectAnalyticsData', { projectId, siteId }, { query });
  }

  /**
   * Runs a report (project:read). The result member matches `type`:
   * `aggregate`, `timeseries`, `breakdown` (needs `dim`), `realtime`,
   * `goals`, `funnel` (`funnel` or `funnelId`), `journeys`, `vitals`,
   * `errors` or `props` (needs an `event is <name>` filter). The site's
   * goals are attached for you; `segmentId` applies a saved segment.
   */
  public async query<T extends AnalyticsQueryType>(
    projectId: string,
    siteId: string,
    body: AnalyticsQuery & { type: T },
  ): Promise<ApiResponse<AnalyticsResultOf<T>>> {
    const response = await callAnalytics(this.client, 'runProjectAnalyticsQuery', { projectId, siteId }, { body });
    return response as ApiResponse<AnalyticsResultOf<T>>;
  }

  /** Visitors in the last 5 minutes, the last 30 minutes per minute and the latest events (project:read). */
  public realtime(projectId: string, siteId: string) {
    return this.query(projectId, siteId, { type: 'realtime' });
  }
}

/** Conversion goals: `client.analytics.goals`. Pageview goals match a path glob; event goals an event name. */
export class AnalyticsGoalsSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists a site's goals (project:read). */
  public list(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsGoals', { projectId, siteId });
  }

  /** Creates a goal (project:edit). */
  public create(projectId: string, siteId: string, body: CreateProjectAnalyticsGoalBody) {
    return callAnalytics(this.client, 'createProjectAnalyticsGoal', { projectId, siteId }, { body });
  }

  /** Replaces a goal (project:edit). */
  public update(projectId: string, siteId: string, goalId: string, body: UpdateProjectAnalyticsGoalBody) {
    return callAnalytics(this.client, 'updateProjectAnalyticsGoal', { projectId, siteId, goalId }, { body });
  }

  /** Deletes a goal (project:edit). */
  public delete(projectId: string, siteId: string, goalId: string) {
    return callAnalytics(this.client, 'deleteProjectAnalyticsGoal', { projectId, siteId, goalId });
  }
}

/** Saved funnels (2–8 steps): `client.analytics.funnels`. */
export class AnalyticsFunnelsSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists a site's funnels (project:read). */
  public list(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsFunnels', { projectId, siteId });
  }

  /** Creates a funnel (project:edit). */
  public create(projectId: string, siteId: string, body: CreateProjectAnalyticsFunnelBody) {
    return callAnalytics(this.client, 'createProjectAnalyticsFunnel', { projectId, siteId }, { body });
  }

  /** Replaces a funnel (project:edit). */
  public update(projectId: string, siteId: string, funnelId: string, body: UpdateProjectAnalyticsFunnelBody) {
    return callAnalytics(this.client, 'updateProjectAnalyticsFunnel', { projectId, siteId, funnelId }, { body });
  }

  /** Deletes a funnel (project:edit). */
  public delete(projectId: string, siteId: string, funnelId: string) {
    return callAnalytics(this.client, 'deleteProjectAnalyticsFunnel', { projectId, siteId, funnelId });
  }
}

/** Saved segments: `client.analytics.segments`. Use one in a report with `segmentId`. */
export class AnalyticsSegmentsSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists a site's segments (project:read). */
  public list(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsSegments', { projectId, siteId });
  }

  /** Creates a segment (project:edit). */
  public create(projectId: string, siteId: string, body: CreateProjectAnalyticsSegmentBody) {
    return callAnalytics(this.client, 'createProjectAnalyticsSegment', { projectId, siteId }, { body });
  }

  /** Deletes a segment (project:edit). */
  public delete(projectId: string, siteId: string, segmentId: string) {
    return callAnalytics(this.client, 'deleteProjectAnalyticsSegment', { projectId, siteId, segmentId });
  }
}

/**
 * Shared dashboard links: `client.analytics.shares`. The slug is the secret:
 * anyone holding the link (and its password, if set) can read the site's
 * reports.
 */
export class AnalyticsSharesSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists a site's links, revoked ones included (project:read). */
  public list(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsShares', { projectId, siteId });
  }

  /** Creates a link, optionally with a password and an expiry (project:edit). */
  public create(projectId: string, siteId: string, body: CreateProjectAnalyticsShareBody = {}) {
    return callAnalytics(this.client, 'createProjectAnalyticsShare', { projectId, siteId }, { body });
  }

  /** Revokes a link at once (project:edit). */
  public revoke(projectId: string, siteId: string, shareId: string) {
    return callAnalytics(this.client, 'revokeProjectAnalyticsShare', { projectId, siteId, shareId });
  }
}

/**
 * Ingest keys (`hfak_…`) for the server-side events API:
 * `client.analytics.keys`. HubFly keeps only a hash: the key is returned once,
 * by `create`.
 */
export class AnalyticsKeysSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** Lists a site's keys by prefix (project:read). */
  public list(projectId: string, siteId: string) {
    return callAnalytics(this.client, 'listProjectAnalyticsIngestKeys', { projectId, siteId });
  }

  /** Creates a key (project:edit). Store `key` now: it is never shown again. */
  public create(projectId: string, siteId: string, name: string) {
    return callAnalytics(this.client, 'createProjectAnalyticsIngestKey', { projectId, siteId }, { body: { name } });
  }

  /** Revokes a key (project:edit). */
  public revoke(projectId: string, siteId: string, keyId: string) {
    return callAnalytics(this.client, 'revokeProjectAnalyticsIngestKey', { projectId, siteId, keyId });
  }
}

/**
 * Public shared dashboards: `client.analytics.shared`. No sign-in is needed;
 * the slug is the credential. Password-protected links need the token from
 * {@link unlock} (valid 24 hours). Shared dashboards cannot use saved
 * segments or funnels and cannot export.
 */
export class AnalyticsSharedSubModule {
  constructor(private readonly client: HubflyClient) {}

  /** The shared site: name, domain, time zone and whether it is locked. */
  public get(slug: string, token?: string) {
    return callAnalytics(this.client, 'getSharedAnalyticsSite', { slug }, { query: token ? { token } : {} });
  }

  /** Exchanges the link's password for a token. */
  public unlock(slug: string, password: string) {
    return callAnalytics(this.client, 'unlockSharedAnalytics', { slug }, { body: { password } });
  }

  /** Runs a report on a shared dashboard; pass `token` for a protected link. */
  public async query<T extends AnalyticsQueryType>(
    slug: string,
    body: RunSharedAnalyticsQueryBody & { type: T },
  ): Promise<ApiResponse<AnalyticsResultOf<T>>> {
    const response = await callAnalytics(this.client, 'runSharedAnalyticsQuery', { slug }, { body });
    return response as ApiResponse<AnalyticsResultOf<T>>;
  }
}

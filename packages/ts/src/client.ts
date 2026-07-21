import type {
  HubflyClientOptions,
  ApiResponse,
  ApiErrorResponse,
} from './types.js';

import { AuthModule } from './modules/auth.js';
import { ProjectsModule } from './modules/projects.js';
import { OrganizationsModule } from './modules/organizations.js';
import { DomainsModule } from './modules/domains.js';
import { GpuModule } from './modules/gpu.js';
import { BillingModule } from './modules/billing.js';
import { SystemModule } from './modules/system.js';

/**
 * Custom Error thrown when Hubfly API returns an error response
 */
export class HubflyApiError extends Error {
  public readonly statusCode: number;
  public readonly meta?: unknown;
  public readonly rawResponse?: unknown;

  constructor(message: string, statusCode: number, rawResponse?: unknown, meta?: unknown) {
    super(message);
    this.name = 'HubflyApiError';
    this.statusCode = statusCode;
    this.rawResponse = rawResponse;
    this.meta = meta;
    Object.setPrototypeOf(this, HubflyApiError.prototype);
  }
}

/**
 * Hubfly API Client
 */
export class HubflyClient {
  public readonly baseUrl: string;
  private readonly token?: string;
  private readonly customFetch: typeof fetch;
  private readonly timeout: number;

  // Module Instances
  public readonly auth: AuthModule;
  public readonly projects: ProjectsModule;
  public readonly organizations: OrganizationsModule;
  public readonly domains: DomainsModule;
  public readonly gpu: GpuModule;
  public readonly billing: BillingModule;
  public readonly system: SystemModule;

  constructor(options: HubflyClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.hubfly.space').replace(/\/$/, '');
    
    // Resolve token from options or environment variable
    const envToken = typeof process !== 'undefined' && process.env ? process.env.HUBFLY_TOKEN : undefined;
    this.token = options.token || envToken;

    this.customFetch = options.fetch || globalThis.fetch;
    this.timeout = options.timeout || 30000;

    // Instantiate Modules
    this.auth = new AuthModule(this);
    this.projects = new ProjectsModule(this);
    this.organizations = new OrganizationsModule(this);
    this.domains = new DomainsModule(this);
    this.gpu = new GpuModule(this);
    this.billing = new BillingModule(this);
    this.system = new SystemModule(this);
  }

  /**
   * Internal generic request dispatcher
   */
  public async request<T>(
    endpointPath: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<ApiResponse<T>> {
    const { method = 'GET', body, query, headers = {} } = options;

    let url = `${this.baseUrl}${endpointPath}`;

    if (query) {
      const searchParams = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    };

    if (this.token) {
      reqHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.customFetch(url, {
        method,
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      let resJson: any;

      if (contentType.includes('application/json')) {
        resJson = await response.json();
      } else {
        const text = await response.text();
        resJson = { ok: response.ok, data: text };
      }

      if (!response.ok || resJson.ok === false) {
        const errResp = resJson as ApiErrorResponse;
        const msg =
          typeof errResp?.error === 'string'
            ? errResp.error
            : errResp?.error?.message || `HTTP ${response.status} Request Failed`;

        throw new HubflyApiError(msg, response.status, resJson, errResp?.meta);
      }

      return resJson as ApiResponse<T>;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof HubflyApiError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new HubflyApiError(`Request timed out after ${this.timeout}ms`, 408);
      }
      throw new HubflyApiError(err.message || 'Network error connecting to Hubfly API', 0);
    }
  }
}

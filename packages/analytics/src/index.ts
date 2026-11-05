/**
 * `@hubfly/analytics`: load the HubFly Analytics tracker from a bundled app and send commands to
 * it. The tracker itself is the per-site script the collector serves (`/s/{site}.js`, COLLECT.md
 * §4); this entry only adds its tag and talks to `window.hubfly`. Every function is a no-op on
 * the server, and commands made before the script loaded are queued in `window.hubfly.q`.
 */
import type { HubflyFn, Props } from './tracker/types';

export { VERSION } from './version';
export type { Props } from './tracker/types';

export interface InjectOptions {
  /** Site public id, `hfa_…` (Dashboard → Analytics → site settings). */
  site: string;
  /**
   * Where the script and events go. Default `/.hubfly/a`, the first-party path HubProxy serves on
   * domains hosted on HubFly. Sites hosted elsewhere use their region's collector,
   * `https://hfa.<region>.hubfly.app`.
   */
  host?: string;
  /** Full script URL; overrides `site` and `host` (for a self-hosted or proxied copy). */
  src?: string;
}

export interface Revenue {
  /** Amount in major units, e.g. `29.99`. */
  amount: number | string;
  /** ISO 4217 code, e.g. `USD`. Defaults to the site currency. */
  currency?: string;
}

export interface TrackOptions {
  /** Up to 30 props; keys up to 64 characters, values up to 512. */
  props?: Props;
  /** `{ amount, currency? }`, or a bare amount in the site currency (`revenue: 29.99`). */
  revenue?: Revenue | number;
}

export interface PageviewOptions {
  /** Page URL, absolute or relative to the current page. Default: the current page. */
  url?: string;
  props?: Props;
}

const SCRIPT_SELECTOR = 'script[data-hfa],script[src*="/s/hfa_"]';
const SITE_RE = /^hfa_[a-z2-7]{16}$/;

function hubfly(): HubflyFn | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { hubfly?: HubflyFn };
  if (!w.hubfly) {
    const stub: HubflyFn = function () {
      // eslint-disable-next-line prefer-rest-params
      (stub.q = stub.q || []).push(arguments as never);
    };
    w.hubfly = stub;
  }
  return w.hubfly;
}

function call(command: string, ...args: unknown[]): void {
  hubfly()?.(command, ...args);
}

/** The script URL for a site: `{host}/s/{site}.js`. */
export function scriptUrl(options: InjectOptions): string {
  if (options.src) return options.src;
  if (!SITE_RE.test(options.site)) throw new TypeError(`HubFly Analytics: invalid site id ${JSON.stringify(options.site)} (expected hfa_ and 16 characters of a-z2-7)`);
  return `${(options.host ?? '/.hubfly/a').replace(/\/+$/, '')}/s/${options.site}.js`;
}

/**
 * Adds the tracker script to the page once. Does nothing on the server, or when the page already
 * has the script (HubProxy injects it on domains with injection on). An invalid site id only logs
 * a warning.
 */
export function inject(options: InjectOptions): void {
  let src: string;
  try {
    src = scriptUrl(options);
  } catch (e) {
    // A wrong site id must not break the app it is measuring.
    console.warn((e as Error).message);
    return;
  }
  if (typeof document === 'undefined' || !hubfly() || document.querySelector(SCRIPT_SELECTOR)) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  s.setAttribute('data-hfa', '');
  (document.head || document.documentElement).appendChild(s);
}

/** Sends a custom event: `track('Signup', { props: { plan: 'pro' }, revenue: { amount: 29, currency: 'USD' } })`. */
export function track(name: string, options?: TrackOptions): void {
  call('track', name, options);
}

/**
 * Sends a pageview. The tracker already counts the first page and SPA navigations
 * (pushState, replaceState, popstate); use this for virtual pages.
 */
export function pageview(options?: PageviewOptions): void {
  call('pageview', options);
}

/**
 * Records a 404 for the current page. Automatic on pages served with status 404 in Chromium-based
 * browsers, and in every browser on HubFly-hosted pages with automatic injection.
 */
export function notFound(): void {
  call('404');
}

/** Attaches your user id to this visitor's events. Persistent identity mode only; ignored otherwise. */
export function identify(userId: string): void {
  call('identify', userId);
}

/**
 * Grants or withdraws consent for the persistent visitor id (sites with "require consent").
 * Withdrawing deletes the id from the device; the tracker stays cookieless.
 */
export function consent(granted: boolean): void {
  call('consent', granted);
}

/** Stops sending anything from this browser for this site (stored in localStorage). */
export function optOut(): void {
  call('opt_out');
}

/** Undoes `optOut()`. */
export function optIn(): void {
  call('opt_in');
}

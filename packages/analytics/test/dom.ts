/**
 * A small fake browser for the tracker tests: just the window, document, navigator, location,
 * history, storage and PerformanceObserver surface the scripts use. The built (minified) scripts
 * run against it through `new Function('window', code)`, so the tests exercise what ships.
 */
import { buildTracker } from '../scripts/build-tracker';
import type { Batch, TrackerConfig } from '../src/tracker/types';

type Listener = { fn: (e: any) => void; once: boolean };

export class FakeTarget {
  private listeners: Record<string, Listener[]> = {};
  addEventListener(type: string, fn: (e: any) => void, opts?: boolean | { once?: boolean }) {
    (this.listeners[type] ||= []).push({ fn, once: typeof opts === 'object' && !!opts.once });
  }
  removeEventListener(type: string, fn: (e: any) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((l) => l.fn !== fn);
  }
  dispatch(type: string, e: Record<string, unknown> = {}) {
    const ev = { type, ...e };
    for (const l of [...(this.listeners[type] || [])]) {
      if (l.once) this.removeEventListener(type, l.fn);
      l.fn(ev);
    }
  }
  count(type: string) {
    return (this.listeners[type] || []).length;
  }
}

export class FakeStorage {
  data = new Map<string, string>();
  writes = 0;
  blocked = false;
  getItem(k: string) {
    if (this.blocked) throw new Error('SecurityError');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.blocked) throw new Error('SecurityError');
    this.writes++;
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    if (this.blocked) throw new Error('SecurityError');
    this.writes++;
    this.data.delete(k);
  }
}

/** A PerformanceObserver whose entries the test delivers with `emit(type, entries)`. */
export class FakePerformance {
  observers: { type: string; opts: any; cb: (list: any) => void }[] = [];
  supported = new Set(['paint', 'largest-contentful-paint', 'layout-shift', 'event', 'first-input']);
  nav: Record<string, unknown> = { type: 'navigate', responseStart: 120.4, activationStart: 0 };
  clock = 0;
  readonly Observer: any;
  constructor() {
    const perf = this;
    this.Observer = class {
      constructor(private cb: (list: any) => void) {}
      observe(opts: any) {
        if (!perf.supported.has(opts.type)) throw new TypeError(`unsupported entry type ${opts.type}`);
        perf.observers.push({ type: opts.type, opts, cb: this.cb });
      }
    };
  }
  emit(type: string, entries: Record<string, unknown>[]) {
    for (const o of this.observers) if (o.type === type) o.cb({ getEntries: () => entries });
  }
  api() {
    return { getEntriesByType: (t: string) => (t === 'navigation' && this.nav ? [this.nav] : []), now: () => this.clock };
  }
}

export interface Sent {
  url: string;
  via: 'beacon' | 'fetch';
  body: Batch;
  raw: string;
  init?: any;
}

export interface WindowOptions {
  href?: string;
  /** `window.__HFA__`; `null` leaves it unset (data-* attributes are read instead). */
  config?: Partial<TrackerConfig> | null;
  scriptSrc?: string | null;
  attrs?: Record<string, string>;
  referrer?: string;
  visibility?: 'visible' | 'hidden';
  prerendering?: boolean;
  beacon?: 'ok' | 'refuse' | 'missing';
  storage?: FakeStorage;
  navigator?: Record<string, unknown>;
  /** Calls made to the stub before the script loaded. */
  queued?: unknown[][];
  extra?: Record<string, unknown>;
}

export const SITE = 'hfa_abcdefghijklmnop';

export function makeWindow(o: WindowOptions = {}) {
  let loc = new URL(o.href ?? 'https://example.com/pricing?utm_source=x');
  const sent: Sent[] = [];
  const win = new FakeTarget() as FakeTarget & Record<string, any>;
  const doc = new FakeTarget() as FakeTarget & Record<string, any>;
  const perf = new FakePerformance();
  const storage = o.storage ?? new FakeStorage();
  const attrs: Record<string, string> = { ...(o.attrs ?? {}) };

  const location = {
    get href() {
      return loc.href;
    },
    get host() {
      return loc.host;
    },
    get hostname() {
      return loc.hostname;
    },
    get pathname() {
      return loc.pathname;
    },
    get protocol() {
      return loc.protocol;
    },
  };
  const history = {
    pushState(_s: unknown, _t: string, url: string) {
      loc = new URL(url, loc.href);
    },
    replaceState(_s: unknown, _t: string, url: string) {
      loc = new URL(url, loc.href);
    },
  };
  const script =
    o.scriptSrc === null
      ? null
      : { src: o.scriptSrc ?? `https://example.com/.hubfly/a/s/${SITE}.js`, getAttribute: (k: string) => attrs[k] ?? null };

  Object.assign(doc, {
    currentScript: script,
    querySelector: () => null,
    referrer: o.referrer ?? '',
    visibilityState: o.visibility ?? 'visible',
    prerendering: !!o.prerendering,
    documentElement: { scrollHeight: 4000 },
  });
  const navigator: Record<string, unknown> = {
    language: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    webdriver: false,
    ...(o.navigator ?? {}),
  };
  if (o.beacon !== 'missing')
    navigator.sendBeacon = (url: string, body: string) => {
      if (o.beacon === 'refuse') return false;
      sent.push({ url, via: 'beacon', body: JSON.parse(body), raw: body });
      return true;
    };
  Object.assign(win, {
    document: doc,
    navigator,
    location,
    history,
    localStorage: storage,
    innerWidth: 1440,
    innerHeight: 1000,
    scrollY: 0,
    performance: perf.api(),
    PerformanceObserver: perf.Observer,
    fetch: (url: string, init: any) => {
      sent.push({ url, via: 'fetch', body: JSON.parse(init.body), raw: init.body, init });
      return Promise.resolve({ ok: true });
    },
    ...(o.extra ?? {}),
  });
  if (o.config !== null) win.__HFA__ = { s: SITE, ...(o.config ?? {}) };
  if (o.queued) {
    const stub: any = function () {
      // eslint-disable-next-line prefer-rest-params
      (stub.q = stub.q || []).push(arguments);
    };
    win.hubfly = stub;
    for (const args of o.queued) stub(...args);
  }

  return {
    win,
    doc,
    perf,
    storage,
    sent,
    /** Every event sent so far, in order. */
    events: () => sent.flatMap((s) => s.body.e),
    go: (url: string) => {
      loc = new URL(url, loc.href);
    },
    hubfly: (...args: unknown[]) => win.hubfly(...args),
    hide: () => {
      doc.visibilityState = 'hidden';
      doc.dispatch('visibilitychange');
    },
    show: () => {
      doc.visibilityState = 'visible';
      doc.dispatch('visibilitychange');
    },
  };
}

export type FakeBrowser = ReturnType<typeof makeWindow>;

const built: Record<string, Promise<string>> = {};
export function script(name: 'core' | 'vitals' | 'errors') {
  return (built[name] ||= buildTracker(name));
}

/** Runs the built scripts in the fake window, as the collector serves them (core first). */
export async function load(b: FakeBrowser, modules: ('vitals' | 'errors')[] = []) {
  for (const name of ['core', ...modules] as const) new Function('window', await script(name))(b.win);
}

/** Lets queued microtasks (the batch flush) run. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

/** A controllable `Date.now` for engagement timing. */
export function fakeClock(start = 1_761_732_000_000) {
  const real = Date.now;
  let t = start;
  Date.now = () => t;
  return {
    advance: (ms: number) => (t += ms),
    get now() {
      return t;
    },
    restore: () => (Date.now = real),
  };
}

// ---------------------------------------------------------------------------------------------
// COLLECT.md §5 as a checker: every batch the tracker sends must pass it.

const ID = /^[0-9a-z]{1,16}$/;
const TYPES = ['pv', 'ev', 'eng', 'vit', 'err'];
const KINDS = ['custom', 'outbound', 'download', 'form', '404'];
const AUTO: Record<string, string> = { outbound: 'Outbound Link: Click', download: 'File Download', form: 'Form: Submission', '404': '404' };

export function contractErrors(raw: string): string[] {
  const errs: string[] = [];
  const bad = (m: string) => errs.push(m);
  if (new TextEncoder().encode(raw).length > 16 * 1024) bad('body over 16 KiB');
  const b = JSON.parse(raw);
  if (b.v !== 1) bad('v');
  if (!/^hfa_[a-z2-7]{16}$/.test(b.s)) bad('s');
  if (b.st !== undefined && typeof b.st !== 'number') bad('st');
  if (b.vid !== undefined && !/^[0-9a-z]{8,32}$/.test(b.vid)) bad(`vid ${b.vid}`);
  if (b.uid !== undefined && (typeof b.uid !== 'string' || b.uid.length > 128)) bad('uid');
  if (b.bot !== undefined && b.bot !== 1) bad('bot');
  if (!Array.isArray(b.e) || b.e.length < 1 || b.e.length > 20) bad('e length');
  for (const e of b.e || []) {
    if (!TYPES.includes(e.t)) bad(`t ${e.t}`);
    if (e.ts !== undefined && typeof e.ts !== 'number') bad('ts');
    if (typeof e.u !== 'string' || !/^https?:\/\//.test(e.u) || e.u.length > 2048) bad(`u ${e.u}`);
    if (e.t !== 'ev' && !ID.test(e.pid)) bad(`pid ${e.pid} on ${e.t}`);
    if (e.pid !== undefined && !ID.test(e.pid)) bad(`pid ${e.pid}`);
    if (e.p !== undefined) {
      const entries = Object.entries(e.p);
      if (entries.length > 30) bad('p > 30');
      for (const [k, v] of entries) if (k.length > 64 || (typeof v === 'string' && v.length > 512)) bad(`p.${k}`);
    }
    if (e.t === 'ev') {
      if (e.k !== undefined && !KINDS.includes(e.k)) bad(`k ${e.k}`);
      if ((e.k ?? 'custom') === 'custom' && !(e.n && e.n.length <= 120)) bad('n');
      if (e.k && AUTO[e.k] && e.n !== undefined && e.n !== AUTO[e.k]) bad(`n ${e.n} for ${e.k}`);
      if (e.$ !== undefined && !(e.$.a > 0 && e.$.a <= 1e12)) bad('$.a');
    }
    if (e.t === 'eng' && !(Number.isInteger(e.d) && e.d >= 0 && e.d <= 1_800_000 && e.sd >= 0 && e.sd <= 100)) bad('eng');
    if (e.t === 'vit') {
      if (!['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].includes(e.m) || !(e.val >= 0 && e.val <= 600_000)) bad(`vit ${e.m}=${e.val}`);
      if (!['navigate', 'reload', 'back_forward', 'prerender'].includes(e.nt)) bad(`nt ${e.nt}`);
    }
    if (e.t === 'err') {
      if (!['error', 'unhandledrejection'].includes(e.ty)) bad('ty');
      if (!e.msg || e.msg.length > 300 || (e.src && e.src.length > 300) || (e.stk && e.stk.length > 1000)) bad('err lengths');
    }
  }
  return errs;
}

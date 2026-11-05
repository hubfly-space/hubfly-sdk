/**
 * Wire types shared by the tracker scripts and the npm entries (hubfly-analytics/docs/COLLECT.md
 * §5 and §7). Types only: nothing here reaches the built scripts.
 */

/** `window.__HFA__`, written by the collector in front of `core.js` (COLLECT.md §7). */
export interface TrackerConfig {
  /** Site public id, `hfa_…`. */
  s: string;
  /** Event endpoint URL; default: the script URL with `/s/{site}.js` replaced by `/e`. */
  e?: string;
  /** Track outbound links, downloads, form submits, 404s. */
  o?: boolean;
  d?: boolean;
  f?: boolean;
  n?: boolean;
  /** Keep `#/…` hash routes in page URLs. */
  h?: boolean;
  /** Respect `DNT` and `Sec-GPC`: send nothing. */
  dnt?: boolean;
  /** Excluded path globs (`*` one segment, `**` any). */
  x?: string[];
  /** Allow localhost and private hosts. */
  lh?: boolean;
  /** Persistent identity mode. */
  p?: boolean;
  /** Persistent ids only after `hubfly('consent', true)`. */
  c?: boolean;
  /** Web Vitals and error modules are included. */
  v?: boolean;
  r?: boolean;
}

export type EventType = 'pv' | 'ev' | 'eng' | 'vit' | 'err';
export type EventKind = 'custom' | 'outbound' | 'download' | 'form' | '404';
export type Props = Record<string, string | number | boolean>;

/** One event of a `POST /e` batch. */
export interface TrackerEvent {
  t: EventType;
  ts?: number;
  u?: string;
  pid?: string;
  r?: string;
  w?: number;
  l?: string;
  tz?: string;
  p?: Props;
  k?: EventKind;
  n?: string;
  $?: { a: number; c?: string };
  d?: number;
  sd?: number;
  m?: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
  val?: number;
  nt?: string;
  ty?: 'error' | 'unhandledrejection';
  msg?: string;
  src?: string;
  ln?: number;
  col?: number;
  stk?: string;
}

/** `POST /e` body. */
export interface Batch {
  v: 1;
  s: string;
  st?: number;
  vid?: string;
  uid?: string;
  bot?: 1;
  e: TrackerEvent[];
}

/** `window.hubfly.x`: what `core.js` hands to the modules (`0` when the tracker is off). */
export interface TrackerExt {
  /** Queues an event; `ts`, `u` and `pid` default to now and the current page. */
  send(e: TrackerEvent): void;
  cfg: TrackerConfig;
  /** Current pageview id. */
  pid(): string;
  /** Current page URL. */
  url(): string;
  /** Set by a module once it attached, so a second copy of the script does not attach twice. */
  V?: 1;
  R?: 1;
}

/** `window.hubfly`: the command function, or the stub that queues calls until `core.js` runs. */
export interface HubflyFn {
  (command: string, ...args: unknown[]): void;
  q?: IArguments[] | unknown[][];
  x?: TrackerExt | 0;
}

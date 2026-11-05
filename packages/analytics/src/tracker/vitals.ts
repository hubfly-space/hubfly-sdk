/**
 * `vitals.js`: the Web Vitals module, appended to the per-site script after `core.js` when the
 * site has `web_vitals` on (COLLECT.md §4, §7). Reports LCP, INP, CLS, FCP and TTFB once per page
 * load through `window.hubfly.x`, measured like the `web-vitals` library: values relative to
 * prerender activation, LCP and FCP only while the page was never hidden, CLS as the largest
 * session window (1 s gap, 5 s cap), INP as the ~98th percentile of interaction durations.
 * LCP is final at the first input or page hide; CLS and INP at page hide.
 */
import type { TrackerEvent, TrackerExt } from './types';

declare const window: any;

(() => {
  const w = window;
  const x: TrackerExt = w.hubfly && w.hubfly.x;
  const P = w.PerformanceObserver;
  if (!x || x.V || !P) return;
  x.V = 1;
  const d = w.document;
  const perf = w.performance;
  const pid = x.pid();
  const u = x.url();
  const nav = (perf.getEntriesByType && perf.getEntriesByType('navigation')[0]) || {};
  const act = nav.activationStart || 0;
  const nt = d.prerendering || act > 0 ? 'prerender' : nav.type || 'navigate';
  const done: Record<string, 1> = {};
  let hid = d.visibilityState == 'hidden' && !d.prerendering ? 0 : Infinity;

  const rep = (m: TrackerEvent['m'] & string, v: number | undefined) => {
    if (v == null || !(v >= 0) || done[m]) return;
    done[m] = 1;
    x.send({ t: 'vit', pid, u, m, val: +v.toFixed(m == 'CLS' ? 4 : 1), nt });
  };
  const obs = (type: string, cb: (e: any) => void, o?: object) => {
    try {
      new P((list: any) => list.getEntries().forEach(cb)).observe({ type, buffered: true, ...o });
      return 1;
    } catch (_) {}
  };
  const since = (t: number) => Math.max(t - act, 0);

  if (nav.responseStart > 0) rep('TTFB', since(nav.responseStart));
  obs('paint', (e) => e.name == 'first-contentful-paint' && e.startTime < hid && rep('FCP', since(e.startTime)));

  let lcp: number | undefined;
  obs('largest-contentful-paint', (e) => {
    if (e.startTime < hid) lcp = since(e.startTime);
  });

  let cls = 0;
  let sv = 0;
  let sf = 0;
  let sl = 0;
  const hasCls = obs('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (sv && e.startTime - sl < 1000 && e.startTime - sf < 5000) sv += e.value;
    else (sv = e.value), (sf = e.startTime);
    sl = e.startTime;
    cls = Math.max(cls, sv);
  });

  const ints: Record<string, number> = {};
  const inter = (e: any) => {
    if (e.interactionId) ints[e.interactionId] = Math.max(ints[e.interactionId] || 0, e.duration);
  };
  obs('event', inter, { durationThreshold: 40 });
  obs('first-input', inter);

  const lcpDone = () => rep('LCP', lcp);
  for (const t of ['keydown', 'click']) w.addEventListener(t, lcpDone, { once: true, capture: true });
  d.addEventListener('visibilitychange', () => {
    if (d.visibilityState != 'hidden') return;
    hid = Math.min(hid, perf.now());
    lcpDone();
    if (hasCls) rep('CLS', cls);
    const all = Object.values(ints).sort((a, b) => b - a);
    // One of the worst durations is skipped per 50 interactions (web-vitals' p98 estimate).
    if (all.length) rep('INP', all[Math.min(all.length - 1, Math.floor(all.length / 50))]);
  });
})();

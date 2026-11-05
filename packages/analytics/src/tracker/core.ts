/**
 * `core.js`: the HubFly Analytics browser tracker (hubfly-analytics/docs/COLLECT.md §5 and §7).
 *
 * Pageviews (SPA through pushState/replaceState/popstate, hash routes with `h`), engagement time
 * and scroll depth on page hide, outbound links, downloads, form submits, 404s, custom events,
 * exclusions, localhost/DNT/opt-out, consent and persistent ids. Built as an IIFE by
 * scripts/build-tracker.ts and kept under 2.5 KB min+gzip (test/size.test.ts), so it is written
 * for size: every browser global is read off `window`, which also lets the tests run it against
 * a fake window.
 */
import type { HubflyFn, TrackerConfig, TrackerEvent, TrackerExt } from './types';

declare const window: any;

(() => {
  const w = window;
  const d = w.document;
  const n = w.navigator;
  const l = w.location;
  const H: HubflyFn | undefined = w.hubfly;
  // Loaded twice (HubProxy injection plus a manual tag or inject()): the first copy wins.
  if (H && H.x != null) return;

  const sc = d.currentScript || d.querySelector('script[data-hfa]');
  const attr = (k: string) => sc && sc.getAttribute('data-' + k);
  let c: TrackerConfig = w.__HFA__;
  delete w.__HFA__;
  if (!c) {
    // npm or self-hosted use: data-site, data-api, data-<flag>="true", data-x="/a/**,/b".
    c = { s: attr('site'), e: attr('api') } as TrackerConfig;
    for (const k of ['o', 'd', 'f', 'n', 'h', 'dnt', 'lh', 'p', 'c']) (c as any)[k] = attr(k) == 'true';
    c.x = (attr('x') || '').split(',').filter(Boolean);
  }
  const m = /^(.*)\/s\/[^/]+\.js(?:[?#].*)?$/.exec((sc && sc.src) || '');
  const ep = c.e || (m && m[1] + '/e');

  let cmd = (a: string, b?: any, x?: any) => {};
  const hub: HubflyFn = (...a: any[]) => cmd(a[0], a[1], a[2]);
  w.hubfly = hub;
  hub.x = 0;
  if (
    !c.s ||
    !ep ||
    (!c.lh && (l.protocol == 'file:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[(::1|f[c-f]))|\.local(host)?$/.test(l.hostname))) ||
    (c.dnt && (n.doNotTrack == '1' || w.doNotTrack == '1' || n.globalPrivacyControl))
  )
    return;

  const now = Date.now;
  const rid = () => Math.random().toString(36).slice(2, 12) || '0';
  // localStorage, which throws when storage is blocked: get with (k), set with (k, v), remove with (k, 0).
  const st = (k: string, v?: string | 0) => {
    try {
      const s = w.localStorage;
      return v === undefined ? s.getItem(k) : v ? s.setItem(k, v) : s.removeItem(k);
    } catch (_) {}
  };
  const OPT = 'hfa_opt_out';
  const ID = 'hfa_id';
  // Page URL without the fragment, except `#/…` routes when hash routing is on.
  const url = (u: string = l.href) => {
    const i = u.indexOf('#');
    return i < 0 || (c.h && u[i + 1] == '/') ? u : u.slice(0, i);
  };
  // What makes a new pageview: path (and hash route), not the query string.
  const key = (u: string) => u.replace(/\?[^#]*/, '');
  const xr = (c.x || []).map(
    (g) => RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, (s) => (s[1] ? '.*' : '[^/]*')) + '$'),
  );

  let out = st(OPT) == '1';
  // A persistent id is only used once it is stored: an id that changes every page would count
  // each pageview as a new visitor.
  const newId = () => (st(ID, (rid() + rid()).slice(0, 16)), (st(ID) as string) || undefined);
  let vid: string | undefined = (c.p && (st(ID) as string)) || undefined;
  let uid: string | undefined;
  if (c.p && !c.c && !vid) vid = newId();
  const bot = n.webdriver || /headless/i.test(n.userAgent) ? 1 : undefined;

  let q: TrackerEvent[] = [];
  let timer = 0;
  let pid = '';
  let pu = '';
  let cur = '';
  let vis = 0;
  let eng = 0;
  let sd = 0;

  const flush = () => {
    timer = 0;
    while (q.length) {
      let k = Math.min(q.length, 20);
      let b: string;
      // Body limit 16 KiB: halve the batch until it fits (a single larger event is dropped by the collector).
      while (new Blob([(b = JSON.stringify({ v: 1, s: c.s, st: now(), vid, uid, bot, e: q.slice(0, k) }))]).size > 16e3 && k > 1) k >>= 1;
      q.splice(0, k);
      try {
        (n.sendBeacon && n.sendBeacon(ep, b!)) || w.fetch(ep, { method: 'POST', body: b!, keepalive: true }).catch(() => {});
      } catch (_) {}
    }
  };
  const send = (e: TrackerEvent) => {
    if (out) return;
    e.ts = e.ts || now();
    e.u = e.u || pu || url();
    e.pid = e.pid || pid || undefined;
    if (xr.some((r) => r.test(new URL(e.u!).pathname))) return;
    q.push(e);
    // Everything queued in the same task goes in one batch, also while the page is being hidden.
    timer = timer || (Promise.resolve().then(flush), 1);
  };
  // A falsy revenue (revenue: 0) is left out: the collector drops an event whose $ is not an object.
  const ev = (k: TrackerEvent['k'], name: string, p?: any, r?: any) => send({ t: 'ev', k, n: name, p, $: r || undefined });

  const tick = () => {
    if (vis) eng += now() - vis;
    vis = 0;
  };
  const leave = () => {
    tick();
    if (pid && eng > 0) send({ t: 'eng', u: pu, pid, d: Math.min(eng, 18e5), sd });
    eng = 0;
  };
  const scroll = () => {
    const e = d.documentElement;
    sd = Math.max(sd, Math.min(100, Math.round(((w.scrollY + w.innerHeight) / e.scrollHeight) * 100) || 0));
  };
  const pv = (u?: string, p?: any) => {
    leave();
    const r = pid ? undefined : d.referrer || undefined;
    pid = rid();
    pu = u || url();
    cur = key(pu);
    sd = 0;
    vis = d.visibilityState == 'visible' ? now() : 0;
    let tz;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_) {}
    send({ t: 'pv', u: pu, r, pid, w: w.innerWidth, l: n.language, tz, p });
    scroll();
  };
  const nav = () => key(url()) != cur && pv();

  cmd = (a, b, x) => {
    // revenue: {amount, currency}, or a bare amount in the site currency.
    if (a == 'track') b && ev('custom', b, x && x.props, x && x.revenue && { a: +(x.revenue.amount || x.revenue), c: x.revenue.currency && ('' + x.revenue.currency).toUpperCase() });
    else if (a == 'pageview') pv(b && b.url && new URL(b.url, l.href).href, b && b.props);
    else if (a == '404') ev('404', '404', { path: l.pathname });
    else if (a == 'identify') uid = vid ? ('' + b).slice(0, 128) : uid;
    else if (a == 'consent' && c.p) b ? (vid = vid || newId()) : (st(ID, 0), (vid = uid = undefined));
    else if (a == 'opt_out') st(OPT, '1'), (out = true);
    else if (a == 'opt_in') st(OPT, 0), (out = false);
  };

  const hs = w.history;
  for (const f of ['pushState', 'replaceState']) {
    const o = hs[f];
    hs[f] = function (this: unknown) {
      o.apply(this, arguments);
      nav();
    };
  }
  w.addEventListener('popstate', nav);
  if (c.h) w.addEventListener('hashchange', nav);
  w.addEventListener('scroll', scroll, { passive: true });
  d.addEventListener('visibilitychange', () => (d.visibilityState == 'hidden' ? leave() : (vis = vis || now())));
  w.addEventListener('pagehide', leave);

  const click = (e: any) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || (e.type == 'auxclick' && e.button != 1) || !/^https?:/.test(a.href)) return;
    if (c.d && (a.hasAttribute('download') || /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|epub|zip|rar|7z|gz|tgz|bz2|xz|dmg|pkg|exe|msi|apk|iso|deb|rpm|mp3|wav|flac|ogg|m4a|mp4|mov|avi|wmv|webm|mkv)$/i.test(a.pathname)))
      ev('download', 'File Download', { url: a.href.split(/[?#]/)[0].slice(0, 512) });
    else if (c.o && a.host != l.host) ev('outbound', 'Outbound Link: Click', { url: a.href.slice(0, 512) });
  };
  d.addEventListener('click', click, true);
  d.addEventListener('auxclick', click, true);
  if (c.f)
    d.addEventListener(
      'submit',
      (e: any) => {
        const f = e.target;
        ev('form', 'Form: Submission', { form: (f.getAttribute('id') || f.getAttribute('name') || new URL(f.getAttribute('action') || '', l.href).pathname).slice(0, 512) });
      },
      true,
    );

  const ext: TrackerExt = { send, cfg: c, pid: () => pid, url: () => pu || url() };
  hub.x = ext;

  // Calls made before the script loaded: identify/consent/opt_out/opt_in first, so the first
  // pageview already carries their effect, then the first pageview, then the rest.
  const early: any[][] = ((H && H.q) || []).map((a: any) => [].slice.call(a));
  for (const a of early) /^[ico]/.test(a[0]) && cmd(a[0], a[1], a[2]);
  const start = () => {
    pv();
    // A 404 page: HubProxy marks the tag it injects into one with data-404 (every browser);
    // otherwise the navigation's status, which only Chromium reports.
    try {
      if (c.n && (attr('404') != null || w.performance.getEntriesByType('navigation')[0].responseStatus == 404)) cmd('404');
    } catch (_) {}
    for (const a of early) /^[ico]/.test(a[0]) || cmd(a[0], a[1], a[2]);
  };
  d.prerendering ? d.addEventListener('prerenderingchange', start, { once: true }) : start();
})();

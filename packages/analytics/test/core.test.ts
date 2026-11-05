/**
 * core.js against the fake browser (test/dom.ts): config sources, pageviews and SPA navigation,
 * engagement and scroll, auto events, custom events, the pre-load queue, transport and batching,
 * exclusions, localhost/DNT/opt-out, consent and persistent ids. Every batch must satisfy
 * COLLECT.md §5 (contractErrors).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { contractErrors, fakeClock, FakeStorage, load, makeWindow, SITE, tick, type FakeBrowser, type WindowOptions } from './dom';

const browsers: FakeBrowser[] = [];
let clock: ReturnType<typeof fakeClock> | undefined;

async function start(o: WindowOptions = {}) {
  // A fixed clock unless the test advances its own: no engagement appears by accident.
  clock ||= fakeClock();
  const b = makeWindow(o);
  browsers.push(b);
  await load(b);
  await tick();
  return b;
}

afterEach(() => {
  clock?.restore();
  clock = undefined;
  for (const b of browsers.splice(0)) for (const s of b.sent) expect({ raw: s.raw, errors: contractErrors(s.raw) }).toEqual({ raw: s.raw, errors: [] });
});

const anchor = (href: string, base = 'https://example.com/', download = false) => {
  const u = new URL(href, base);
  const a = { href: u.href, host: u.host, pathname: u.pathname, hasAttribute: (n: string) => n === 'download' && download, closest: () => a };
  return a;
};
const click = (b: FakeBrowser, a: unknown, extra: Record<string, unknown> = {}) => b.doc.dispatch('click', { target: { closest: () => a }, button: 0, ...extra });

describe('config and first pageview', () => {
  test('sends a pageview to the endpoint derived from the script URL', async () => {
    const b = await start({ referrer: 'https://www.google.com/' });
    expect(b.sent).toHaveLength(1);
    const s = b.sent[0];
    expect(s.via).toBe('beacon');
    expect(s.url).toBe('https://example.com/.hubfly/a/e');
    expect(s.body).toMatchObject({ v: 1, s: SITE });
    expect(typeof s.body.st).toBe('number');
    expect(s.body.vid).toBeUndefined();
    expect(s.body.bot).toBeUndefined();
    const pv = s.body.e[0];
    expect(pv).toMatchObject({ t: 'pv', u: 'https://example.com/pricing?utm_source=x', r: 'https://www.google.com/', w: 1440, l: 'en-US' });
    expect(pv.pid).toMatch(/^[0-9a-z]{1,16}$/);
    expect(typeof pv.tz).toBe('string');
    expect(b.win.__HFA__).toBeUndefined();
    expect(typeof b.win.hubfly).toBe('function');
    expect(b.win.hubfly.x).toMatchObject({ cfg: { s: SITE } });
    expect(b.win.hubfly.x.pid()).toBe(pv.pid);
    expect(b.win.hubfly.x.url()).toBe(pv.u);
  });

  test('derives the endpoint for the external collector host and honours config e', async () => {
    const ext = await start({ scriptSrc: `https://hfa.eu-north.hubfly.app/s/${SITE}.js?v=2` });
    expect(ext.sent[0].url).toBe('https://hfa.eu-north.hubfly.app/e');
    const custom = await start({ config: { e: 'https://stats.example.com/collect' } });
    expect(custom.sent[0].url).toBe('https://stats.example.com/collect');
  });

  test('reads data-* attributes when window.__HFA__ is absent', async () => {
    const b = await start({
      config: null,
      scriptSrc: 'https://example.com/js/analytics.js',
      attrs: { 'data-site': SITE, 'data-api': 'https://hfa.eu-north.hubfly.app/e', 'data-o': 'true', 'data-x': '/admin/**,/drafts/*' },
      href: 'https://example.com/drafts/one',
    });
    expect(b.sent).toHaveLength(0);
    b.go('https://example.com/blog');
    b.win.history.pushState({}, '', '/blog');
    click(b, anchor('https://github.com/hubfly-space'));
    await tick();
    expect(b.sent.map((s) => s.url)).toEqual(['https://hfa.eu-north.hubfly.app/e']);
    expect(b.events().map((e) => e.t + ':' + (e.k ?? ''))).toEqual(['pv:', 'ev:outbound']);
    expect(b.win.hubfly.x.cfg).toMatchObject({ s: SITE, o: true, d: false, x: ['/admin/**', '/drafts/*'] });
  });

  test('stays off without a site, an endpoint, on localhost, or with DNT/GPC when respected', async () => {
    const cases: WindowOptions[] = [
      { config: null, attrs: {} },
      { scriptSrc: 'https://example.com/tracker.js' },
      { href: 'http://localhost:3000/' },
      { href: 'http://127.0.0.1:8080/' },
      { href: 'http://192.168.1.20/' },
      { href: 'http://shop.local/' },
      { href: 'http://[::1]:3000/' },
      { href: 'file:///home/me/site/index.html' },
      { config: { dnt: true }, navigator: { doNotTrack: '1' } },
      { config: { dnt: true }, navigator: { globalPrivacyControl: true } },
    ];
    for (const o of cases) {
      const b = await start({ ...o, queued: [['track', 'Signup']] });
      expect({ o, sent: b.sent.length, x: b.win.hubfly.x }).toEqual({ o, sent: 0, x: 0 });
      b.hubfly('track', 'Later');
      await tick();
      expect(b.sent).toHaveLength(0);
    }
    expect((await start({ href: 'http://localhost:3000/', config: { lh: true } })).sent).toHaveLength(1);
    expect((await start({ navigator: { doNotTrack: '1', globalPrivacyControl: true } })).sent).toHaveLength(1);
  });

  test('flags automation as bot', async () => {
    expect((await start({ navigator: { webdriver: true } })).sent[0].body.bot).toBe(1);
    expect((await start({ navigator: { userAgent: 'Mozilla/5.0 HeadlessChrome/130.0' } })).sent[0].body.bot).toBe(1);
  });

  test('a second copy of the script does nothing', async () => {
    const b = await start();
    const x = b.win.hubfly.x;
    b.win.__HFA__ = { s: SITE };
    await load(b);
    await tick();
    expect(b.sent).toHaveLength(1);
    expect(b.win.hubfly.x).toBe(x);
  });

  test('waits for a prerendered page to be shown', async () => {
    const b = await start({ prerendering: true });
    expect(b.sent).toHaveLength(0);
    b.doc.prerendering = false;
    b.doc.dispatch('prerenderingchange');
    await tick();
    expect(b.events().map((e) => e.t)).toEqual(['pv']);
  });
});

describe('SPA navigation', () => {
  test('pushState, replaceState and popstate count path changes, not query changes', async () => {
    const b = await start({ referrer: 'https://news.ycombinator.com/' });
    b.win.history.pushState({}, '', '/docs');
    b.win.history.replaceState({}, '', '/docs?tab=2');
    b.win.history.replaceState({}, '', '/docs/install');
    b.go('https://example.com/pricing');
    b.win.dispatch('popstate');
    b.win.dispatch('popstate');
    await tick();
    const pvs = b.events().filter((e) => e.t === 'pv');
    expect(pvs.map((e) => e.u)).toEqual([
      'https://example.com/pricing?utm_source=x',
      'https://example.com/docs',
      'https://example.com/docs/install',
      'https://example.com/pricing',
    ]);
    // Only the landing pageview carries the referrer; every pageview has its own id.
    expect(pvs.map((e) => e.r)).toEqual(['https://news.ycombinator.com/', undefined, undefined, undefined]);
    expect(new Set(pvs.map((e) => e.pid)).size).toBe(4);
  });

  test('drops fragments, except #/ routes with hash routing', async () => {
    const plain = await start({ href: 'https://example.com/app#/settings' });
    plain.go('https://example.com/app#/billing');
    plain.win.dispatch('hashchange');
    plain.win.dispatch('popstate');
    await tick();
    expect(plain.events().filter((e) => e.t === 'pv').map((e) => e.u)).toEqual(['https://example.com/app']);

    const hash = await start({ href: 'https://example.com/app#/settings', config: { h: true } });
    hash.go('https://example.com/app#/settings/billing');
    hash.win.dispatch('hashchange');
    hash.go('https://example.com/app#/settings/billing'); // popstate for the same route
    hash.win.dispatch('popstate');
    hash.go('https://example.com/app#top'); // an anchor, not a route
    hash.win.dispatch('hashchange');
    await tick();
    expect(hash.events().filter((e) => e.t === 'pv').map((e) => e.u)).toEqual(['https://example.com/app#/settings', 'https://example.com/app#/settings/billing', 'https://example.com/app']);
  });

  test('a manual pageview resolves relative URLs and carries props', async () => {
    const b = await start();
    b.hubfly('pageview', { url: '/virtual/step-2', props: { step: 2 } });
    await tick();
    expect(b.events().filter((e) => e.t === 'pv')[1]).toMatchObject({ t: 'pv', u: 'https://example.com/virtual/step-2', p: { step: 2 } });
  });
});

describe('engagement', () => {
  test('sends visible time and max scroll on hide, as deltas per pageview', async () => {
    clock = fakeClock();
    const b = await start();
    const pid = b.events()[0].pid;
    clock.advance(5000);
    b.win.scrollY = 1000; // (1000 + 1000) / 4000 = 50%
    b.win.dispatch('scroll');
    b.win.scrollY = 200;
    b.win.dispatch('scroll');
    clock.advance(7000);
    b.hide();
    await tick();
    clock.advance(60_000); // hidden time is not engagement
    b.show();
    clock.advance(3000);
    b.hide();
    b.win.dispatch('pagehide'); // after hide: nothing new
    await tick();
    const eng = b.events().filter((e) => e.t === 'eng');
    expect(eng).toEqual([
      expect.objectContaining({ pid, u: 'https://example.com/pricing?utm_source=x', d: 12000, sd: 50 }),
      expect.objectContaining({ pid, d: 3000, sd: 50 }),
    ]);
  });

  test('closes the previous page on SPA navigation, in the same batch as the new pageview', async () => {
    clock = fakeClock();
    const b = await start();
    const first = b.events()[0];
    clock.advance(4000);
    b.win.history.pushState({}, '', '/next');
    await tick();
    expect(b.sent).toHaveLength(2);
    expect(b.sent[1].body.e).toEqual([
      expect.objectContaining({ t: 'eng', pid: first.pid, u: first.u, d: 4000 }),
      expect.objectContaining({ t: 'pv', u: 'https://example.com/next' }),
    ]);
  });

  test('a page opened in a background tab only counts time once shown, capped at 30 minutes', async () => {
    clock = fakeClock();
    const b = await start({ visibility: 'hidden' });
    clock.advance(10_000);
    b.show();
    clock.advance(3_600_000);
    b.hide();
    await tick();
    expect(b.events().filter((e) => e.t === 'eng').map((e) => e.d)).toEqual([1_800_000]);
  });
});

describe('auto events', () => {
  const all = { o: true, d: true, f: true, n: true };

  test('outbound links and downloads', async () => {
    const b = await start({ config: all });
    click(b, anchor('https://github.com/hubfly-space'));
    click(b, anchor('/files/report.pdf?token=secret#p2'));
    click(b, anchor('/export', 'https://example.com/', true));
    click(b, anchor('https://cdn.other.com/app.dmg?x=1'));
    click(b, anchor('/pricing')); // same host
    click(b, anchor('mailto:hi@example.com'));
    click(b, null);
    b.doc.dispatch('auxclick', { target: { closest: () => anchor('https://x.com/') }, button: 1 });
    b.doc.dispatch('auxclick', { target: { closest: () => anchor('https://y.com/') }, button: 2 });
    await tick();
    expect(b.events().slice(1)).toEqual([
      expect.objectContaining({ t: 'ev', k: 'outbound', n: 'Outbound Link: Click', p: { url: 'https://github.com/hubfly-space' } }),
      expect.objectContaining({ k: 'download', n: 'File Download', p: { url: 'https://example.com/files/report.pdf' } }),
      expect.objectContaining({ k: 'download', p: { url: 'https://example.com/export' } }),
      expect.objectContaining({ k: 'download', p: { url: 'https://cdn.other.com/app.dmg' } }),
      expect.objectContaining({ k: 'outbound', p: { url: 'https://x.com/' } }),
    ]);
    expect(b.events()[1].pid).toBe(b.events()[0].pid);
  });

  test('nothing is auto-tracked when the flags are off', async () => {
    const b = await start();
    click(b, anchor('https://github.com/'));
    click(b, anchor('/a.pdf'));
    b.doc.dispatch('submit', { target: { getAttribute: () => 'signup' } });
    expect(b.doc.count('submit')).toBe(0);
    await tick();
    expect(b.events().map((e) => e.t)).toEqual(['pv']);
  });

  test('form submits name the form by id, name, then action path', async () => {
    const b = await start({ config: all });
    const form = (attrs: Record<string, string>) => ({ target: { getAttribute: (k: string) => attrs[k] ?? null } });
    b.doc.dispatch('submit', form({ id: 'signup', name: 'n', action: '/x' }));
    b.doc.dispatch('submit', form({ name: 'newsletter' }));
    b.doc.dispatch('submit', form({ action: '/api/contact?src=footer' }));
    b.doc.dispatch('submit', form({}));
    await tick();
    expect(b.events().slice(1).map((e) => [e.k, e.n, e.p])).toEqual([
      ['form', 'Form: Submission', { form: 'signup' }],
      ['form', 'Form: Submission', { form: 'newsletter' }],
      ['form', 'Form: Submission', { form: '/api/contact' }],
      ['form', 'Form: Submission', { form: '/pricing' }],
    ]);
  });

  test('404 from the navigation status and from the command', async () => {
    clock ||= fakeClock();
    const b = makeWindow({ config: all, href: 'https://example.com/missing' });
    browsers.push(b);
    b.perf.nav.responseStatus = 404;
    await load(b);
    b.hubfly('404');
    await tick();
    expect(b.events().map((e) => [e.t, e.k, e.n, e.p])).toEqual([
      ['pv', undefined, undefined, undefined],
      ['ev', '404', '404', { path: '/missing' }],
      ['ev', '404', '404', { path: '/missing' }],
    ]);
  });

  test('404 from the data-404 marker HubProxy adds to the tag it injects, in every browser', async () => {
    clock ||= fakeClock();
    const b = makeWindow({ config: all, href: 'https://example.com/gone', attrs: { 'data-hfa': '', 'data-404': '' } });
    browsers.push(b);
    // Not Chromium: no navigation status, here no Navigation Timing at all.
    b.win.performance = {};
    await load(b);
    await tick();
    expect(b.events().map((e) => [e.t, e.k, e.n, e.p])).toEqual([
      ['pv', undefined, undefined, undefined],
      ['ev', '404', '404', { path: '/gone' }],
    ]);
  });

  test('no 404 without the marker or the status, nor with 404 tracking off', async () => {
    const plain = await start({ config: all, href: 'https://example.com/gone' });
    const off = await start({ href: 'https://example.com/gone', attrs: { 'data-hfa': '', 'data-404': '' } });
    expect([...plain.events(), ...off.events()].map((e) => e.t)).toEqual(['pv', 'pv']);
  });
});

describe('commands', () => {
  test('track with props and revenue', async () => {
    const b = await start();
    b.hubfly('track', 'Signup', { props: { plan: 'pro', seats: 3, trial: true }, revenue: { amount: '29.99', currency: 'usd' } });
    b.hubfly('track', 'Plain');
    b.hubfly('track', '');
    await tick();
    expect(b.events().slice(1)).toEqual([
      expect.objectContaining({ t: 'ev', k: 'custom', n: 'Signup', p: { plan: 'pro', seats: 3, trial: true }, $: { a: 29.99, c: 'USD' } }),
      expect.objectContaining({ t: 'ev', k: 'custom', n: 'Plain' }),
    ]);
    expect(b.sent).toHaveLength(2); // the two tracks of one task share a batch
  });

  test('a bare revenue amount is in the site currency; a zero one is left out', async () => {
    const b = await start();
    b.hubfly('track', 'Upgrade', { revenue: 29.99 });
    b.hubfly('track', 'Tip', { revenue: '5' });
    b.hubfly('track', 'Free', { revenue: 0 });
    await tick();
    expect(b.events().slice(1).map((e) => [e.n, e.$])).toEqual([
      ['Upgrade', { a: 29.99 }],
      ['Tip', { a: 5 }],
      ['Free', undefined],
    ]);
  });

  test('calls queued before the script loaded: settings first, then the pageview, then events', async () => {
    const b = await start({
      config: { p: true },
      queued: [
        ['track', 'Early'],
        ['identify', 'user-42'],
        ['pageview', { url: '/manual' }],
      ],
    });
    expect(b.events().map((e) => e.t + ':' + (e.n ?? e.u))).toEqual(['pv:https://example.com/pricing?utm_source=x', 'ev:Early', 'pv:https://example.com/manual']);
    expect(b.sent[0].body.uid).toBe('user-42');
  });

  test('opt_out stops sending and is remembered; opt_in resumes', async () => {
    const storage = new FakeStorage();
    const b = await start({ storage });
    b.hubfly('opt_out');
    b.hubfly('track', 'Hidden');
    await tick();
    expect(b.events().map((e) => e.t)).toEqual(['pv']);
    expect(storage.data.get('hfa_opt_out')).toBe('1');

    const again = await start({ storage });
    expect(again.sent).toHaveLength(0);
    again.hubfly('opt_in');
    again.hubfly('track', 'Back');
    await tick();
    expect(again.events().map((e) => e.n)).toEqual(['Back']);
    expect(storage.data.has('hfa_opt_out')).toBe(false);
  });

  test('blocked storage does not break the tracker', async () => {
    const storage = new FakeStorage();
    storage.blocked = true;
    const b = await start({ storage, config: { p: true } });
    b.hubfly('opt_out');
    await tick();
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0].body.vid).toBeUndefined();
  });
});

describe('identity', () => {
  test('cookieless mode writes nothing to the device and ignores identify and consent', async () => {
    const storage = new FakeStorage();
    const b = await start({ storage });
    b.hubfly('identify', 'user-42');
    b.hubfly('consent', true);
    b.hubfly('track', 'Signup');
    b.hide();
    await tick();
    expect(storage.writes).toBe(0);
    for (const s of b.sent) expect([s.body.vid, s.body.uid]).toEqual([undefined, undefined]);
  });

  test('persistent mode keeps a random id in localStorage and sends identify', async () => {
    const storage = new FakeStorage();
    const b = await start({ storage, config: { p: true } });
    const vid = storage.data.get('hfa_id')!;
    expect(vid).toMatch(/^[0-9a-z]{8,32}$/);
    expect(b.sent[0].body.vid).toBe(vid);
    b.hubfly('identify', 'user-42');
    b.hubfly('track', 'Signup');
    await tick();
    expect(b.sent[1].body).toMatchObject({ vid, uid: 'user-42' });
    // Next page load: same id.
    expect((await start({ storage, config: { p: true } })).sent[0].body.vid).toBe(vid);
  });

  test('with require-consent the id only exists between consent(true) and consent(false)', async () => {
    const storage = new FakeStorage();
    const b = await start({ storage, config: { p: true, c: true } });
    b.hubfly('identify', 'before-consent');
    expect(b.sent[0].body.vid).toBeUndefined();
    expect(storage.data.has('hfa_id')).toBe(false);

    b.hubfly('consent', true);
    b.hubfly('identify', 'user-42');
    b.hubfly('track', 'A');
    await tick();
    const vid = storage.data.get('hfa_id');
    expect(vid).toMatch(/^[0-9a-z]{8,32}$/);
    expect(b.sent[1].body).toMatchObject({ vid, uid: 'user-42' });

    // Consent from an earlier visit: the stored id is used right away.
    expect((await start({ storage, config: { p: true, c: true } })).sent[0].body.vid).toBe(vid);

    b.hubfly('consent', false);
    b.hubfly('track', 'B');
    await tick();
    expect(storage.data.has('hfa_id')).toBe(false);
    expect([b.sent[2].body.vid, b.sent[2].body.uid]).toEqual([undefined, undefined]);
  });
});

describe('exclusions', () => {
  test('path globs: * is one segment, ** any depth', async () => {
    const x = ['/admin/**', '/blog/*/edit', '/preview'];
    const urls = ['/admin/users/1', '/admin/', '/blog/post-1/edit', '/blog/a/b/edit', '/preview', '/preview/x', '/pricing'];
    const sentFor: Record<string, boolean> = {};
    for (const p of urls) sentFor[p] = (await start({ href: `https://example.com${p}`, config: { x } })).sent.length > 0;
    expect(sentFor).toEqual({
      '/admin/users/1': false,
      '/admin/': false,
      '/blog/post-1/edit': false,
      '/blog/a/b/edit': true,
      '/preview': false,
      '/preview/x': true,
      '/pricing': true,
    });
  });

  test('events and engagement on an excluded page are not sent either', async () => {
    clock = fakeClock();
    const b = await start({ href: 'https://example.com/admin/x', config: { x: ['/admin/**'] } });
    b.hubfly('track', 'Click');
    clock.advance(3000);
    b.win.history.pushState({}, '', '/home');
    await tick();
    expect(b.events().map((e) => e.t + ':' + e.u)).toEqual(['pv:https://example.com/home']);
  });
});

describe('transport', () => {
  test('falls back to fetch keepalive when sendBeacon refuses or is missing', async () => {
    for (const beacon of ['refuse', 'missing'] as const) {
      const b = await start({ beacon });
      expect(b.sent).toHaveLength(1);
      expect(b.sent[0].via).toBe('fetch');
      expect(b.sent[0].url).toBe('https://example.com/.hubfly/a/e');
      expect(b.sent[0].init).toMatchObject({ method: 'POST', keepalive: true });
      expect(typeof b.sent[0].init.body).toBe('string'); // text/plain: no CORS preflight
    }
  });

  test('splits batches at 20 events and 16 KiB', async () => {
    const b = await start();
    for (let i = 0; i < 45; i++) b.hubfly('track', `E${i}`);
    await tick();
    expect(b.sent.slice(1).map((s) => s.body.e.length)).toEqual([20, 20, 5]);

    const big = await start();
    const props = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'x'.repeat(100)]));
    for (let i = 0; i < 10; i++) big.hubfly('track', `Big${i}`, { props });
    await tick();
    const sizes = big.sent.slice(1).map((s) => s.raw.length);
    expect(sizes.every((n) => n <= 16_000)).toBe(true);
    expect(big.sent.slice(1).reduce((n, s) => n + s.body.e.length, 0)).toBe(10);
  });
});

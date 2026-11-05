/**
 * vitals.js and errors.js on top of core.js in the fake browser, with mocked
 * PerformanceObserver entries and error events.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { contractErrors, fakeClock, load, makeWindow, tick, type FakeBrowser, type WindowOptions } from './dom';

const browsers: FakeBrowser[] = [];
let clock: ReturnType<typeof fakeClock> | undefined;

async function start(modules: ('vitals' | 'errors')[], o: WindowOptions = {}, setup?: (b: FakeBrowser) => void) {
  clock ||= fakeClock();
  const b = makeWindow(o);
  browsers.push(b);
  setup?.(b);
  await load(b, modules);
  await tick();
  return b;
}

afterEach(() => {
  clock?.restore();
  clock = undefined;
  for (const b of browsers.splice(0)) for (const s of b.sent) expect({ raw: s.raw, errors: contractErrors(s.raw) }).toEqual({ raw: s.raw, errors: [] });
});

const vitals = (b: FakeBrowser) => Object.fromEntries(b.events().filter((e) => e.t === 'vit').map((e) => [e.m, e.val]));

describe('vitals.js', () => {
  test('reports TTFB at once, FCP from paint, then LCP, CLS and INP once on hide', async () => {
    const b = await start(['vitals']);
    const pv = b.events()[0];
    const P = b.perf;
    P.emit('paint', [{ name: 'first-paint', startTime: 300 }, { name: 'first-contentful-paint', startTime: 412.34 }]);
    P.emit('largest-contentful-paint', [{ startTime: 900 }]);
    P.emit('largest-contentful-paint', [{ startTime: 2310.54 }]);
    // Session windows: [0.1, 0.05] = 0.15, a 1.5 s gap, then [0.2] = 0.2; input-driven shifts do not count.
    P.emit('layout-shift', [
      { startTime: 1000, value: 0.1 },
      { startTime: 1500, value: 0.05 },
      { startTime: 1600, value: 0.5, hadRecentInput: true },
      { startTime: 3100, value: 0.2 },
    ]);
    P.emit('first-input', [{ interactionId: 1, duration: 24 }]);
    P.emit('event', [
      { interactionId: 1, duration: 56 },
      { interactionId: 2, duration: 180 },
      { interactionId: 2, duration: 120 },
      { interactionId: 0, duration: 900 }, // not an interaction
    ]);
    await tick();
    expect(vitals(b)).toEqual({ TTFB: 120.4, FCP: 412.3 });

    b.hide();
    b.perf.emit('largest-contentful-paint', [{ startTime: 9000 }]); // after hide: ignored
    b.show();
    b.hide();
    await tick();
    expect(vitals(b)).toEqual({ TTFB: 120.4, FCP: 412.3, LCP: 2310.5, CLS: 0.2, INP: 180 });
    for (const e of b.events().filter((e) => e.t === 'vit')) expect(e).toMatchObject({ pid: pv.pid, u: pv.u, nt: 'navigate' });
    // LCP, CLS and INP of the hide share one batch.
    expect(b.sent.at(-1)!.body.e.map((e) => e.t + (e.m ?? ''))).toEqual(['vitLCP', 'vitCLS', 'vitINP']);
  });

  test('LCP is final at the first input; INP skips one worst duration per 50 interactions', async () => {
    const b = await start(['vitals']);
    b.perf.emit('largest-contentful-paint', [{ startTime: 1200 }]);
    b.win.dispatch('keydown');
    b.perf.emit('largest-contentful-paint', [{ startTime: 5000 }]);
    b.perf.emit('event', Array.from({ length: 120 }, (_, i) => ({ interactionId: i + 1, duration: 40 + i })));
    b.hide();
    await tick();
    // 120 interactions: the 2 worst (159, 158) are skipped.
    expect(vitals(b)).toMatchObject({ LCP: 1200, INP: 157 });
  });

  test('keeps the landing pageview after SPA navigation and reports prerender activation', async () => {
    const b = await start(['vitals'], {}, (b) => {
      b.perf.nav = { type: 'navigate', responseStart: 300, activationStart: 1000 };
    });
    const landing = b.events()[0];
    b.win.history.pushState({}, '', '/next');
    b.perf.emit('largest-contentful-paint', [{ startTime: 1800 }]);
    b.hide();
    await tick();
    const vit = b.events().filter((e) => e.t === 'vit');
    expect(vit.map((e) => [e.m, e.val, e.nt, e.pid])).toEqual([
      ['TTFB', 0, 'prerender', landing.pid],
      ['LCP', 800, 'prerender', landing.pid],
      ['CLS', 0, 'prerender', landing.pid],
    ]);
  });

  test('skips what the browser does not support and pages first loaded hidden', async () => {
    const b = await start(['vitals'], { visibility: 'hidden' }, (b) => {
      b.perf.supported.delete('layout-shift');
      b.perf.nav = { type: 'reload', responseStart: 0 };
    });
    b.perf.emit('paint', [{ name: 'first-contentful-paint', startTime: 500 }]);
    b.perf.emit('largest-contentful-paint', [{ startTime: 600 }]);
    b.show();
    b.hide();
    await tick();
    expect(vitals(b)).toEqual({});
  });

  test('does nothing without PerformanceObserver, when core is off, or when loaded twice', async () => {
    const noObs = await start(['vitals'], { extra: { PerformanceObserver: undefined } });
    noObs.hide();
    await tick();
    expect(vitals(noObs)).toEqual({});

    const off = await start(['vitals'], { href: 'http://localhost/' });
    expect(off.perf.observers).toHaveLength(0);

    const twice = await start(['vitals']);
    const n = twice.perf.observers.length;
    await load(twice, ['vitals']);
    expect(twice.perf.observers).toHaveLength(n);
  });
});

describe('errors.js', () => {
  const error = (b: FakeBrowser, message: string, extra: Record<string, unknown> = {}) =>
    b.win.dispatch('error', { message, filename: 'https://example.com/app.js', lineno: 10, colno: 5, error: { stack: 'at f (app.js:10:5)' }, ...extra });

  test('reports errors and unhandled rejections with truncated fields', async () => {
    const b = await start(['errors']);
    const pv = b.events()[0];
    error(b, 'Uncaught TypeError: x is undefined');
    b.win.dispatch('unhandledrejection', { reason: { message: 'Network down', stack: 'at load (api.js:3:1)' } });
    b.win.dispatch('unhandledrejection', { reason: 'plain string' });
    error(b, 'm'.repeat(400), { filename: 'https://example.com/' + 's'.repeat(400), error: { stack: 'k'.repeat(2000) } });
    await tick();
    const errs = b.events().filter((e) => e.t === 'err');
    expect(errs[0]).toMatchObject({ ty: 'error', msg: 'TypeError: x is undefined', src: 'https://example.com/app.js', ln: 10, col: 5, stk: 'at f (app.js:10:5)', pid: pv.pid, u: pv.u });
    expect(errs[1]).toMatchObject({ ty: 'unhandledrejection', msg: 'Network down', stk: 'at load (api.js:3:1)' });
    expect(errs[1].src).toBeUndefined();
    expect(errs[2]).toMatchObject({ ty: 'unhandledrejection', msg: 'plain string' });
    expect([errs[3].msg!.length, errs[3].src!.length, errs[3].stk!.length]).toEqual([300, 300, 1000]);
  });

  test('ignores resource errors and extension code; dedupes and caps at 10 per pageview', async () => {
    const b = await start(['errors']);
    b.win.dispatch('error', { message: '' }); // resource load error
    error(b, 'from extension', { filename: 'chrome-extension://abc/content.js' });
    error(b, 'stack in extension', { filename: '', error: { stack: 'at x (moz-extension://abc/x.js:1:1)' } });
    error(b, 'same');
    error(b, 'same');
    for (let i = 0; i < 15; i++) error(b, `E${i}`);
    await tick();
    expect(b.events().filter((e) => e.t === 'err').map((e) => e.msg)).toEqual(['same', 'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);

    b.win.history.pushState({}, '', '/next');
    error(b, 'same');
    await tick();
    const last = b.events().at(-1)!;
    expect([last.t, last.msg, last.pid]).toEqual(['err', 'same', b.win.hubfly.x.pid()]);
  });
});

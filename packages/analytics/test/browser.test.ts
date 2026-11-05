/**
 * The npm browser entries: inject() adds the per-site script once, commands go to (or queue on)
 * window.hubfly, and everything is a no-op on the server. React runs against a mocked `react`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const SITE = 'hfa_abcdefghijklmnop';

mock.module('react', () => ({ useEffect: (fn: () => void) => fn() }));

type El = { tag: string; attrs: Record<string, string>; src?: string; defer?: boolean; setAttribute(k: string, v: string): void };

function fakeDocument(existing = false) {
  const appended: El[] = [];
  return {
    appended,
    head: { appendChild: (el: El) => appended.push(el) },
    documentElement: { appendChild: (el: El) => appended.push(el) },
    querySelector: (sel: string) => (existing || appended.length ? { sel } : null),
    createElement: (tag: string): El => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
}

const g = globalThis as any;
beforeEach(() => {
  g.window = {};
  g.document = fakeDocument();
});
afterEach(() => {
  delete g.window;
  delete g.document;
});

describe('inject', () => {
  test('adds the first-party script once and installs the queue stub', async () => {
    const { inject } = await import('../src/index');
    inject({ site: SITE });
    inject({ site: SITE });
    expect(g.document.appended).toHaveLength(1);
    expect(g.document.appended[0]).toMatchObject({ tag: 'script', src: `/.hubfly/a/s/${SITE}.js`, defer: true, attrs: { 'data-hfa': '' } });
    expect(typeof g.window.hubfly).toBe('function');
  });

  test('external host, src override and an existing tag', async () => {
    const { inject, scriptUrl } = await import('../src/index');
    expect(scriptUrl({ site: SITE, host: 'https://hfa.eu-north.hubfly.app/' })).toBe(`https://hfa.eu-north.hubfly.app/s/${SITE}.js`);
    expect(scriptUrl({ site: '', src: '/js/a.js' })).toBe('/js/a.js');
    expect(() => scriptUrl({ site: 'hfa_WRONG' })).toThrow(TypeError);

    g.document = fakeDocument(true); // HubProxy injected it already
    inject({ site: SITE });
    expect(g.document.appended).toHaveLength(0);
  });

  test('an invalid site id warns instead of throwing', async () => {
    const { inject } = await import('../src/index');
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (m: unknown) => warned.push(m);
    try {
      inject({ site: 'hfa_nope' });
    } finally {
      console.warn = warn;
    }
    expect(g.document.appended).toHaveLength(0);
    expect(String(warned[0])).toContain('invalid site id');
  });

  test('is a no-op on the server', async () => {
    delete g.window;
    delete g.document;
    const { inject, track, optOut } = await import('../src/index');
    expect(() => {
      inject({ site: SITE });
      track('X');
      optOut();
    }).not.toThrow();
  });
});

describe('commands', () => {
  test('queue on the stub before the script loads, in the wire shape of window.hubfly', async () => {
    const m = await import('../src/index');
    m.track('Signup', { props: { plan: 'pro' }, revenue: { amount: 29, currency: 'USD' } });
    m.pageview({ url: '/step-2' });
    m.notFound();
    m.identify('user-42');
    m.consent(true);
    m.optOut();
    m.optIn();
    expect(g.window.hubfly.q.map((a: IArguments) => [...a])).toEqual([
      ['track', 'Signup', { props: { plan: 'pro' }, revenue: { amount: 29, currency: 'USD' } }],
      ['pageview', { url: '/step-2' }],
      ['404'],
      ['identify', 'user-42'],
      ['consent', true],
      ['opt_out'],
      ['opt_in'],
    ]);
  });

  test('go straight to the loaded tracker', async () => {
    const calls: unknown[][] = [];
    g.window.hubfly = (...a: unknown[]) => calls.push(a);
    const { track } = await import('../src/index');
    track('Later');
    expect(calls).toEqual([['track', 'Later', undefined]]);
  });
});

describe('framework entries', () => {
  test('react and next: <Analytics /> injects after mount and renders nothing', async () => {
    for (const entry of ['../src/react', '../src/next']) {
      g.document = fakeDocument();
      const { Analytics, track } = await import(entry);
      expect(Analytics({ site: SITE, host: 'https://hfa.eu-north.hubfly.app' })).toBeNull();
      expect(g.document.appended[0].src).toBe(`https://hfa.eu-north.hubfly.app/s/${SITE}.js`);
      expect(typeof track).toBe('function');
    }
  });

  test('vue plugin and svelte helper', async () => {
    const { analytics } = await import('../src/vue');
    analytics({ site: SITE }).install({});
    expect(g.document.appended).toHaveLength(1);
    g.document = fakeDocument();
    const { injectAnalytics, VERSION } = await import('../src/svelte');
    injectAnalytics({ site: SITE });
    expect(g.document.appended).toHaveLength(1);
    expect(VERSION).toBe('1.0.0');
  });
});

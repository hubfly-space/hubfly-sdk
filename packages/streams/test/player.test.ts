/**
 * The player state machine with fake DOM, RTCPeerConnection, fetch and timers: WHEP success,
 * fallback to LL-HLS with the lazy hls.js load, native HLS, the offline slate, stopped servers,
 * refused tokens, reconnects with backoff and the custom element.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPlayer, defineHubflyPlayer, type Player, type PlayerStateDetail } from '../src/player';
import { Clock, FakeElement, FakeMedia, FakePeerConnection, fakeDocument, fakeFetch, flush, install } from './fakes';

const HOST = 'https://acme-tv.live.hubfly.app';
const CH = 'sch_main0001';
const TOKEN = 'tok.en.value';

let clock: Clock;
let restore: () => void;
let players: Player[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const live = () => json({ live: true, viewers: 3 });
const whepOK = () => new Response('v=0 answer', { status: 201, headers: { Location: `/whep/${CH}/sess_1` } });

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  restore = install({
    document: fakeDocument,
    RTCPeerConnection: FakePeerConnection,
    MediaStream: class {},
    fetch: f.fetch,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  return f;
}

function mount(options: Parameters<typeof createPlayer>[1]) {
  const el = new FakeElement('hubfly-player');
  const states: PlayerStateDetail[] = [];
  el.addEventListener('statechange', (e) => states.push((e as CustomEvent<PlayerStateDetail>).detail));
  const player = createPlayer(el as unknown as HTMLElement, { host: HOST, channel: CH, token: TOKEN, ...options });
  players.push(player);
  return { el, player, states, media: player.media as unknown as FakeMedia };
}

/** A minimal hls.js stand-in that records what the player asked of it. */
function fakeHls() {
  const instances: FakeHlsInstance[] = [];
  class FakeHlsInstance {
    source = '';
    media: unknown;
    handlers: Array<(event: string, data: Record<string, unknown>) => void> = [];
    destroyed = false;
    recovered = 0;
    constructor(readonly config: Record<string, unknown>) {
      instances.push(this);
    }
    static isSupported() {
      return true;
    }
    static Events = { ERROR: 'hlsError' };
    static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
    loadSource(url: string) {
      this.source = url;
    }
    attachMedia(media: unknown) {
      this.media = media;
    }
    on(_event: string, handler: (event: string, data: Record<string, unknown>) => void) {
      this.handlers.push(handler);
    }
    emit(data: Record<string, unknown>) {
      for (const h of this.handlers) h('hlsError', data);
    }
    recoverMediaError() {
      this.recovered++;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  let loads = 0;
  return {
    instances,
    get loads() {
      return loads;
    },
    loadHls: async () => {
      loads++;
      return FakeHlsInstance;
    },
  };
}

beforeEach(() => {
  clock = new Clock();
  players = [];
  FakePeerConnection.instances = [];
  FakePeerConnection.behavior = 'connect';
  FakeMedia.canPlay = {};
  FakeMedia.autoplayBlocked = false;
});

afterEach(() => {
  for (const p of players) p.destroy();
  restore?.();
});

describe('WHEP', () => {
  test('plays over WebRTC with the token as a bearer and never loads hls.js', async () => {
    const hls = fakeHls();
    const f = setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: whepOK, 'DELETE /whep/': () => new Response(null, { status: 204 }) });
    const { el, player, media, states } = mount({ autoplay: true, muted: true, loadHls: hls.loadHls });
    await flush();

    expect(player.state).toBe('live');
    expect(player.transport).toBe('webrtc');
    expect(el.getAttribute('state')).toBe('live');
    expect(media.srcObject).toEqual({ id: 'remote' });
    expect(media.muted).toBe(true);
    expect(hls.loads).toBe(0);
    expect(states[0].state).toBe('loading');
    expect(states.at(-1)).toMatchObject({ state: 'live', transport: 'webrtc', message: 'Live' });

    const whep = f.calls.find((c) => c.method === 'POST')!;
    expect(whep.url).toBe(`${HOST}/whep/${CH}`);
    expect(whep.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(whep.headers['content-type']).toBe('application/sdp');
    const pc = FakePeerConnection.instances[0];
    expect(pc.transceivers.map((t) => [t.kind, t.direction])).toEqual([
      ['audio', 'recvonly'],
      ['video', 'recvonly'],
    ]);
    expect(pc.remote?.sdp).toBe('v=0 answer');

    // destroy() ends the WHEP session on the same origin, with the token.
    player.destroy();
    await flush();
    const del = f.calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toBe(`${HOST}/whep/${CH}/sess_1`);
    expect(del.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(el.children).toHaveLength(0);
    expect(el.hasAttribute('state')).toBe(false);
  });

  test('a session URL on another origin is never called with the token', async () => {
    const f = setup({
      [`GET /status/${CH}.json`]: live,
      [`POST /whep/${CH}`]: () => new Response('v=0', { status: 201, headers: { Location: 'https://evil.example/x' } }),
    });
    const { player } = mount({ autoplay: true, muted: true });
    await flush();
    player.destroy();
    await flush();
    expect(f.calls.some((c) => c.url.startsWith('https://evil.example'))).toBe(false);
  });

  test('a blocked autoplay shows a keyboard-usable Play button', async () => {
    FakeMedia.autoplayBlocked = true;
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: whepOK });
    const { el } = mount({ autoplay: true });
    await flush();
    const button = el.find('hfp-play')!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Play');
  });
});

describe('fallback', () => {
  for (const [status, reason] of [
    [503, 'webrtc_full'],
    [409, 'webrtc_unavailable'],
  ] as const) {
    test(`WHEP ${status} ${reason} falls back to LL-HLS through a lazy hls.js`, async () => {
      const hls = fakeHls();
      setup({
        [`GET /status/${CH}.json`]: live,
        [`POST /whep/${CH}`]: () => json({ error: reason }, status),
      });
      const { player, media } = mount({ autoplay: true, muted: true, loadHls: hls.loadHls });
      await flush();

      expect(hls.loads).toBe(1);
      expect(player.transport).toBe('ll-hls');
      const instance = hls.instances[0];
      expect(instance.config.lowLatencyMode).toBe(true);
      expect(instance.source).toBe(`${HOST}/hls/${CH}/index.m3u8?token=${encodeURIComponent(TOKEN)}`);
      expect(instance.media).toBe(media);
      expect(player.state).toBe('live');
      expect(FakePeerConnection.instances[0].closed).toBe(true);
    });
  }

  test('ICE failure falls back to LL-HLS', async () => {
    FakePeerConnection.behavior = 'fail';
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: whepOK });
    const { player } = mount({ autoplay: true, muted: true, loadHls: hls.loadHls });
    await flush();
    expect(player.transport).toBe('ll-hls');
    expect(hls.loads).toBe(1);
  });

  test('Safari plays HLS natively without hls.js', async () => {
    FakeMedia.canPlay['application/vnd.apple.mpegurl'] = 'maybe';
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live });
    const { player, media } = mount({ latency: 'll-hls', autoplay: true, muted: true, loadHls: hls.loadHls });
    await flush();
    expect(hls.loads).toBe(0);
    expect(media.src).toBe(`${HOST}/hls/${CH}/index.m3u8?token=${encodeURIComponent(TOKEN)}`);
    expect(player.state).toBe('live');
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  test('without hls.js or native HLS the player says the browser cannot play', async () => {
    setup({ [`GET /status/${CH}.json`]: live });
    const { player, el } = mount({
      latency: 'hls',
      loadHls: () => Promise.reject(new Error('Cannot find module')),
    });
    await flush();
    expect(player.state).toBe('error');
    expect(player.reason).toBe('unsupported');
    expect(el.find('hfp-status')!.children[1].textContent).toBe("This browser can't play the stream");
  });
});

describe('offline and refusals', () => {
  test('nothing live: the slate plays and the state is offline', async () => {
    setup({ [`GET /status/${CH}.json`]: () => json({ live: false }), [`POST /whep/${CH}`]: whepOK });
    const { player, el } = mount({ autoplay: true, muted: true });
    await flush();
    expect(player.state).toBe('offline');
    expect(player.reason).toBe('not_live');
    expect(el.getAttribute('reason')).toBe('not_live');
    expect(el.find('hfp-status')!.children[1].textContent).toContain('Offline');
  });

  test('a stopped server serves no media: offline without a WHEP attempt', async () => {
    const f = setup({ [`GET /status/${CH}.json`]: () => json({ live: false, state: 'stopped' }) });
    const { player } = mount({});
    await flush();
    expect(player.state).toBe('offline');
    expect(player.reason).toBe('stopped');
    expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  test('WHEP 503 server_blocked means paused', async () => {
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: () => json({ error: 'server_blocked' }, 503) });
    const { player } = mount({});
    await flush();
    expect(player.state).toBe('offline');
    expect(player.reason).toBe('paused');
  });

  test('a refused token is an error with the reason, announced politely', async () => {
    setup({ [`GET /status/${CH}.json`]: () => new Response('', { status: 401 }) });
    const { player, el, states } = mount({});
    await flush();
    expect(player.state).toBe('error');
    expect(player.reason).toBe('unauthorized');
    const status = el.find('hfp-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.children[1].textContent).toBe("Can't play this stream: access was refused");
    expect(states.at(-1)!.state).toBe('error');
    expect(el.find('hfp-play')!.textContent).toBe('Try again');
  });

  test('WHEP 401 is a refusal, not a fallback', async () => {
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: () => json({ error: 'unauthorized' }, 401) });
    const { player } = mount({ loadHls: hls.loadHls });
    await flush();
    expect(player.state).toBe('error');
    expect(hls.loads).toBe(0);
  });

  test('hls.js 403 on the playlist is a refusal', async () => {
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live });
    const { player } = mount({ latency: 'll-hls', loadHls: hls.loadHls });
    await flush();
    hls.instances[0].emit({ fatal: true, type: 'networkError', response: { code: 403 } });
    await flush();
    expect(player.state).toBe('error');
    expect(player.reason).toBe('forbidden');
  });
});

describe('reconnects', () => {
  test('fatal HLS errors reconnect with backoff, then drop to plain HLS', async () => {
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live });
    const { player, states } = mount({ latency: 'll-hls', autoplay: true, muted: true, loadHls: hls.loadHls });
    await flush();
    expect(player.state).toBe('live');

    hls.instances[0].emit({ fatal: true, type: 'networkError' });
    await flush();
    expect(player.state).toBe('reconnecting');
    expect(hls.instances[0].destroyed).toBe(true);
    await clock.advance(999 * 0.74); // below the shortest first delay (1 s × 0.75)
    expect(hls.instances).toHaveLength(1);
    await clock.advance(1000);
    expect(hls.instances).toHaveLength(2);
    expect(player.state).toBe('live');

    hls.instances[1].emit({ fatal: true, type: 'networkError' });
    await clock.advance(2000);
    expect(hls.instances).toHaveLength(3);
    expect(hls.instances[2].config.lowLatencyMode).toBe(false); // two LL-HLS failures: plain HLS
    expect(states.filter((s) => s.state === 'reconnecting').length).toBe(2);
  });

  test('a media error is recovered once in place', async () => {
    const hls = fakeHls();
    setup({ [`GET /status/${CH}.json`]: live });
    const { player } = mount({ latency: 'll-hls', autoplay: true, muted: true, loadHls: hls.loadHls });
    await flush();
    hls.instances[0].emit({ fatal: true, type: 'mediaError' });
    await flush();
    expect(hls.instances[0].recovered).toBe(1);
    expect(player.state).toBe('live');
  });

  test('a WebRTC connection that fails later reconnects', async () => {
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: whepOK });
    const { player } = mount({ autoplay: true, muted: true });
    await flush();
    expect(player.state).toBe('live');
    FakePeerConnection.instances[0].setState('failed');
    expect(player.state).toBe('reconnecting');
    await clock.advance(1000);
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(player.state).toBe('live');
  });

  test('the status poll notices a server that stopped and one that came back', async () => {
    let state: Record<string, unknown> = { live: true };
    setup({ [`GET /status/${CH}.json`]: () => json(state), [`POST /whep/${CH}`]: whepOK });
    const { player } = mount({ autoplay: true, muted: true });
    await flush();
    expect(player.state).toBe('live');
    state = { live: false, state: 'paused' };
    await clock.advance(15_000);
    expect(player.state).toBe('offline');
    expect(player.reason).toBe('paused');
    state = { live: true };
    await clock.advance(5_000);
    expect(player.state).toBe('live');
    expect(FakePeerConnection.instances).toHaveLength(2);
  });
});

describe('audio-only channels', () => {
  test('play the Opus output in an <audio> element when the browser can', async () => {
    FakeMedia.canPlay['audio/ogg; codecs=opus'] = 'probably';
    setup({ [`GET /status/${CH}.json`]: live });
    const { player, media } = mount({ audioOnly: true, latency: 'hls', autoplay: true });
    await flush();
    expect(media.tagName).toBe('AUDIO');
    expect(player.transport).toBe('audio');
    expect(media.src).toBe(`${HOST}/radio/${CH}.opus?token=${encodeURIComponent(TOKEN)}`);
    expect(player.state).toBe('live');
  });
});

describe('<hubfly-player>', () => {
  test('renders from attributes and reconnects when the token changes', async () => {
    const registry = new Map<string, new () => FakeElement>();
    setup({ [`GET /status/${CH}.json`]: live, [`POST /whep/${CH}`]: whepOK });
    const undo = install({
      HTMLElement: FakeElement,
      customElements: { get: (n: string) => registry.get(n), define: (n: string, c: new () => FakeElement) => registry.set(n, c) },
    });
    try {
      defineHubflyPlayer('test-player');
      const Element = registry.get('test-player')!;
      const el = new Element() as FakeElement & {
        connectedCallback(): void;
        attributeChangedCallback(): void;
        disconnectedCallback(): void;
        player?: Player;
      };
      el.setAttribute('host', HOST);
      el.setAttribute('channel', CH);
      el.setAttribute('token', 'first');
      el.setAttribute('autoplay', '');
      el.setAttribute('muted', '');
      el.connectedCallback();
      await flush();
      expect(el.getAttribute('state')).toBe('live');

      el.setAttribute('token', 'second');
      el.attributeChangedCallback();
      await flush();
      expect(FakePeerConnection.instances).toHaveLength(2);
      expect(FakePeerConnection.instances[0].closed).toBe(true);

      el.disconnectedCallback();
      expect(el.player).toBeUndefined();
      expect(el.children).toHaveLength(0);
    } finally {
      undo();
    }
  });
});

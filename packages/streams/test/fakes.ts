/**
 * Just enough DOM, WebRTC, fetch and timers to drive the player and the publisher in Bun:
 * elements with attributes and events, media elements with a scriptable `canPlayType` and
 * `play()`, a peer connection that connects (or fails) on `setRemoteDescription`, a routed
 * `fetch` that records requests, and a manual clock.
 */

export class FakeElement extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | undefined;
  className = '';
  textContent = '';
  hidden = false;
  type = '';

  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = undefined;
  }
  /** Depth-first search by class name. */
  find(className: string): FakeElement | undefined {
    for (const child of this.children) {
      if (child.className === className) return child;
      const found = child.find(className);
      if (found) return found;
    }
  }
  findTag(tag: string): FakeElement | undefined {
    for (const child of this.children) {
      if (child.tagName === tag.toUpperCase()) return child;
      const found = child.findTag(tag);
      if (found) return found;
    }
  }
}

export class FakeMedia extends FakeElement {
  static canPlay: Record<string, string> = {};
  static autoplayBlocked = false;
  controls = false;
  muted = false;
  autoplay = false;
  preload = '';
  srcObject: unknown = null;
  plays = 0;

  set src(value: string) {
    this.setAttribute('src', value);
  }
  get src() {
    return this.getAttribute('src') ?? '';
  }
  canPlayType(type: string) {
    return FakeMedia.canPlay[type] ?? '';
  }
  load() {}
  play(): Promise<void> {
    this.plays++;
    if (FakeMedia.autoplayBlocked) {
      return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    }
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
}

export const fakeDocument = {
  createElement(tag: string) {
    return tag === 'video' || tag === 'audio' ? new FakeMedia(tag) : new FakeElement(tag);
  },
};

export type PeerBehavior = 'connect' | 'fail' | 'hang';

export class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  static behavior: PeerBehavior = 'connect';
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'complete';
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | undefined;
  transceivers: FakeTransceiver[] = [];
  closed = false;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  ontrack: ((event: { track: unknown; streams: unknown[] }) => void) | null = null;

  constructor(readonly config?: unknown) {
    super();
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(trackOrKind: unknown, init?: { direction?: string }) {
    const t = new FakeTransceiver(trackOrKind, init?.direction ?? 'sendrecv');
    this.transceivers.push(t);
    return t;
  }
  async createOffer() {
    return { type: 'offer', sdp: `v=0 offer ${this.transceivers.map((t) => t.kind).join(',')}` };
  }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remote = description;
    const behavior = FakePeerConnection.behavior;
    if (behavior === 'hang') return;
    queueMicrotask(() => {
      if (behavior === 'connect') this.ontrack?.({ track: { kind: 'video' }, streams: [{ id: 'remote' }] });
      this.setState(behavior === 'connect' ? 'connected' : 'failed');
    });
  }
  setState(state: RTCPeerConnectionState) {
    if (this.closed) return;
    this.connectionState = state;
    const event = new Event('connectionstatechange');
    this.onconnectionstatechange?.(event);
    this.dispatchEvent(event);
  }
  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

export class FakeTransceiver {
  readonly kind: string;
  preferences: Array<{ mimeType: string }> | undefined;
  parameters: { encodings: Array<Record<string, unknown>> } = { encodings: [{}] };
  readonly sender = {
    getParameters: () => this.parameters,
    setParameters: async (p: { encodings: Array<Record<string, unknown>> }) => {
      this.parameters = p;
    },
  };
  constructor(
    readonly trackOrKind: unknown,
    readonly direction: string,
  ) {
    this.kind = typeof trackOrKind === 'string' ? trackOrKind : (trackOrKind as { kind: string }).kind;
  }
  setCodecPreferences(codecs: Array<{ mimeType: string }>) {
    this.preferences = codecs;
  }
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type Route = (request: Recorded) => Response | Promise<Response>;

/** A routed fetch: the first route whose `"METHOD /path"` key prefixes the request wins. */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fn = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const recorded: Recorded = {
      method: init.method ?? 'GET',
      url: url.href,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    calls.push(recorded);
    const key = `${recorded.method} ${url.pathname}`;
    const match = Object.keys(routes)
      .filter((k) => key.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return new Response('not found', { status: 404 });
    return routes[match](recorded);
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** A manual clock replacing setTimeout/clearTimeout; `advance` runs due timers in order. */
export class Clock {
  now = 0;
  private id = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout = ((fn: () => void, ms = 0) => {
    const id = ++this.id;
    this.timers.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  }) as unknown as typeof setTimeout;

  clearTimeout = ((id?: number) => {
    if (id !== undefined) this.timers.delete(id);
  }) as unknown as typeof clearTimeout;

  pending() {
    return this.timers.size;
  }

  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

/** Lets pending promise chains (fetch, offers, events) settle. */
export async function flush(rounds = 30) {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => queueMicrotask(resolve));
}

/** Installs the fakes on globalThis and returns a restore function. */
export function install(values: Record<string, unknown>): () => void {
  const g = globalThis as Record<string, unknown>;
  const saved = Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  for (const [k, v] of Object.entries(values)) {
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  }
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  };
}

import { Channel } from './channel';
import { Emitter } from './emitter';
import type {
  ChannelAuth,
  ClientE2E,
  ConnectionState,
  E2EModule,
  MessageMeta,
  RealtimeOptions,
  UserAuth,
  WebSocketConstructor,
  WebSocketLike,
} from './types';

export const VERSION = '0.1.2';
const USER = '#server-to-user-';
const E2E_EVENT_RE = /^(client-)?hubfly\.e2e$/;

type Timer = ReturnType<typeof setTimeout>;

/**
 * HubFly Realtime client.
 *
 * ```ts
 * const rt = new Realtime({ url, key, authEndpoint: '/api/realtime/auth', e2e: true });
 * const { id } = await rt.connect();
 * rt.on('order.updated', (data) => render(data)); // direct and user messages
 * rt.subscribe('private-orders').bind('created', (order) => add(order));
 * ```
 *
 * `rt.on` receives direct and user messages plus these lifecycle events (reserved names):
 * `state` (`{previous, current}`), `connecting`, `connected` (`{id, resumed}`), `reconnecting`
 * (`{code, delay, attempt}`), `disconnected`, `id` (`{id, previous}`: the connection id changed),
 * `resumed`, `signin`, `error` and `e2e:error`.
 */
export class Realtime extends Emitter {
  /** Connection state. */
  state: ConnectionState = 'initialized';
  /** Connection id: `<socket_id>~<key>` with E2E, else the socket id. Null before the first connect. */
  id: string | null = null;
  /** The engine's socket id. */
  socketId: string | null = null;
  /** True while connected through the HubFly socket (resume, recovery, acks). */
  hubfly = false;
  /** The signed-in user. */
  user: { id: string; info?: unknown } | null = null;

  /** @internal */ readonly _o: RealtimeOptions;
  /** @internal */ _chans = new Map<string, Channel>();
  /** @internal */ _e2e?: ClientE2E;
  /** @internal */ _est = false;
  private _ws: WebSocketLike | null = null;
  private _opened = false;
  private _stop = true;
  private _fb = false;
  private _tries = 0;
  private _token?: string;
  /** Until when the detached HubFly session can be resumed (ms epoch). */
  private _until = 0;
  private _ttl = 0;
  private _ck = '';
  private _us?: string | null;
  private _seen = new Set<string>();
  private _rf = new Map<string, [number, Promise<unknown>]>();
  private _acks: string[] = [];
  private _act = 120_000;
  private _t1?: Timer;
  private _t2?: Timer;
  private _t3?: Timer;
  private _wait: Array<[(r: { id: string; socketId: string }) => void, (e: unknown) => void]> = [];
  private _signing?: [(u: { id: string; info?: unknown }) => void, (e: unknown) => void, string];
  private _load?: Promise<void>;

  constructor(options: RealtimeOptions) {
    super();
    this._o = options;
  }

  /** Connects (or waits for the current attempt) and resolves with the connection id. */
  connect(): Promise<{ id: string; socketId: string }> {
    return new Promise((resolve, reject) => {
      if (this.state === 'connected') return resolve({ id: this.id!, socketId: this.socketId! });
      this._wait.push([resolve, reject]);
      if (this._stop) {
        this._stop = false;
        this._tries = 0;
        this._state('connecting');
        (this._load ||= this._loadE2E()).then(
          () => this._open(),
          (err) => {
            this._load = undefined;
            this._halt(err);
          },
        );
      }
    });
  }

  /** Closes the connection (ends the session) and stops reconnecting. Channels are kept for `connect()`. */
  disconnect(): void {
    this._stop = true;
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    const ws = this._ws;
    this._ws = null;
    this._est = false;
    this._token = undefined;
    this._acks = [];
    try {
      ws && ws.close(1000);
    } catch {}
    this._chans.forEach((c) => (c.subscribed = false));
    this._state('disconnected');
    this._settle(new Error('HubFly Realtime: disconnected'));
  }

  /** Subscribes to a channel (idempotent) and returns it. */
  subscribe(name: string): Channel {
    let c = this._chans.get(name);
    if (!c) {
      this._chans.set(name, (c = new Channel(name, this)));
      c._sub();
    }
    return c;
  }

  /** Alias of `subscribe`. */
  channel(name: string): Channel {
    return this.subscribe(name);
  }

  unsubscribe(name: string): void {
    const c = this._chans.get(name);
    if (!c) return;
    this._chans.delete(name);
    c.subscribed = false;
    if (this._est) this._send('pusher:unsubscribe', { channel: name });
    if (this._e2e) this._e2e.forget(name);
  }

  /**
   * Signs the connection in as a user (`userAuthEndpoint`/`userAuthorizer`) and subscribes to
   * `#server-to-user-<id>`; user messages then arrive on `rt.on(event)`. Repeated after
   * reconnects that lose the session.
   */
  async signin(): Promise<{ id: string; info?: unknown }> {
    await this.connect();
    const sid = this.socketId!;
    if (this.user && this._us === sid) return this.user;
    const res = await this._userAuth(sid);
    if (this.socketId !== sid) throw new Error('HubFly Realtime: reconnected during sign-in');
    return new Promise((resolve, reject) => {
      this._signing = [resolve, reject, res.user_data];
      this._send('pusher:signin', { auth: res.auth, user_data: res.user_data });
    });
  }

  /**
   * Fetches fresh auth (and E2E keys) for every private/presence channel and the signed-in user,
   * e.g. after a key rotation. Subscriptions are kept.
   */
  async reauthorize(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    this._chans.forEach((c, n) => {
      if (!c._user && /^(private|presence)-/.test(n)) {
        jobs.push(this._authorize(n).then((a) => this._e2e && this._e2e.keys(n, a.hubfly && a.hubfly.keys, a.shared_secret)));
      }
    });
    if (this.user && this._us === this.socketId) jobs.push(this._userAuth(this.socketId!));
    await Promise.all(jobs);
  }

  // ---- internals -----------------------------------------------------------------------------

  private async _loadE2E(): Promise<void> {
    const opt = this._o.e2e;
    if (!opt) return;
    const o = opt === true ? {} : opt;
    const m = o.module;
    const mod: E2EModule = m ? (typeof m === 'function' ? await m() : m) : await import('@hubfly/realtime/e2e');
    this._e2e = mod.createClientE2E(o);
  }

  private _state(s: ConnectionState, data?: unknown): void {
    const previous = this.state;
    this.state = s;
    if (previous !== s) this.emit('state', { previous, current: s });
    this.emit(s, data);
  }

  private _settle(err: unknown): void {
    const w = this._wait;
    this._wait = [];
    for (const [resolve, reject] of w) err ? reject(err) : resolve({ id: this.id!, socketId: this.socketId! });
  }

  private _halt(err: unknown): void {
    this._stop = true;
    this._token = undefined;
    this._state('disconnected', err);
    this.emit('error', err);
    this._settle(err);
  }

  private _open(): void {
    if (this._stop) return;
    const o = this._o;
    const hub = o.transport === 'hubfly' || (o.transport !== 'pusher' && !this._fb);
    const WS: WebSocketConstructor = o.WebSocket || (globalThis as any).WebSocket;
    const url = `${o.url.replace(/^http/, 'ws').replace(/\/+$/, '')}${hub ? '/hubfly/v1/app/' : '/app/'}${o.key}?protocol=7&client=hubfly-js&version=${VERSION}&flash=false`;
    let ws: WebSocketLike;
    try {
      ws = new WS(url);
    } catch (err) {
      return this._halt(err);
    }
    this._ws = ws;
    this._est = false;
    this._opened = false;
    this.hubfly = hub;
    ws.onopen = () => {
      this._opened = true;
      if (hub) this._send('hubfly:hello', this._hello());
    };
    ws.onmessage = (ev) => this._ws === ws && this._frame(ev.data);
    ws.onclose = (ev) => this._ws === ws && this._closed(ev.code);
    ws.onerror = () => {};
    this._t1 = setTimeout(() => this._drop(4201), o.connectTimeoutMs || 10_000);
  }

  private _hello(): Record<string, unknown> {
    const h: Record<string, unknown> = { v: 1, features: ['ack', 'offsets'] };
    if (this._token && this.socketId) {
      const channels: Record<string, unknown> = {};
      this._chans.forEach((c, n) => c.pos && (channels[n] = c.pos));
      h.resume = { socket_id: this.socketId, token: this._token };
      h.channels = channels;
    }
    return h;
  }

  /** Client-side close that should resume (never 1000, which would end the session). */
  private _drop(code: number): void {
    const ws = this._ws;
    if (!ws) return;
    this._ws = null;
    try {
      ws.close(code);
    } catch {}
    this._closed(code);
  }

  private _closed(code: number): void {
    const was = this._est;
    const o = this._o;
    this._ws = null;
    this._est = false;
    clearTimeout(this._t1);
    if (this._stop) return;
    if (was && this.hubfly) this._until = Date.now() + this._ttl;
    if (!was && this.hubfly && !this._opened && o.transport !== 'hubfly' && !this._fb && !(this._token && Date.now() < this._until)) {
      // HubFly path unreachable (old server, proxy, plain Pusher): try /app/{key} right away.
      // Not while a detached session can still be resumed (a network outage): only HubFly resumes.
      this._fb = true;
      return this._open();
    }
    this._fb = false;
    if (code >= 4000 && code < 4100) return this._halt(Object.assign(new Error(`HubFly Realtime: closed with ${code}`), { code }));
    const b = o.backoff || {};
    const n = this._tries++;
    const delay =
      code >= 4200 && code < 4300 && was
        ? 0
        : Math.random() * Math.min(b.maxMs || 30_000, (b.minMs || 1000) * 2 ** (n + (code >= 4100 && code < 4200 ? 2 : 0)));
    this._state('reconnecting', { code, delay, attempt: n + 1 });
    this._t2 = setTimeout(() => this._open(), delay);
  }

  private _alive(): void {
    clearTimeout(this._t1);
    if (this._est) {
      this._t1 = setTimeout(() => {
        this._send('pusher:ping', {});
        this._t1 = setTimeout(() => this._drop(4201), this._o.pongTimeoutMs || 30_000);
      }, this._act);
    }
  }

  private _frame(raw: unknown): void {
    let m: any;
    try {
      m = JSON.parse(raw as string);
    } catch {
      return;
    }
    if (!m || typeof m.event !== 'string') return;
    this._alive();
    const ev: string = m.event;
    const ch: string | undefined = m.channel;
    let d = m.data;
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d);
      } catch {}
    }
    switch (ev) {
      case 'pusher:connection_established':
        return this._established(d || {});
      case 'pusher:ping':
        return void this._send('pusher:pong', {});
      case 'pusher:error':
        this.emit('error', d);
        if (this._signing && d && d.code === 4009) this._signing[1](Object.assign(new Error(d.message), d));
        return;
      case 'pusher:signin_success':
        return this._signedIn();
      case 'hubfly:reconnect': {
        const ws = this._ws;
        return void setTimeout(() => this._ws === ws && this._drop(4200), (d && d.after_ms) || 0);
      }
      case 'hubfly:resumed':
        for (const n in (d && d.channels) || {}) this._chans.get(n)?._recovery(d.channels[n]);
        return void this.emit('resumed', d);
    }
    const c = ch != null ? this._chans.get(ch) : undefined;
    if (/^(pusher|pusher_internal|hubfly):/.test(ev)) return c && c._internal(ev, d);
    this._message(ev, ch, c, d, m.hubfly || {}, m.user_id);
  }

  private _established(d: any): void {
    const h = d.hubfly;
    const prev = this.socketId;
    const sid: string = d.socket_id;
    const resumed = !!h && h.resumed === true && sid === prev;
    this._token = h && h.session_token;
    this._ttl = ((h && h.detach_ttl) || 0) * 1000;
    this.socketId = sid;
    this._est = true;
    this._tries = 0;
    this._act = Math.min((d.activity_timeout || 120) * 1000, this._o.activityTimeoutMs || 1e9);
    if (!resumed) {
      this._acks = [];
      if (this._e2e) this._ck = this._e2e.newKey();
    }
    this._chans.forEach((c) => {
      // A resumed session keeps its subscriptions; only unconfirmed ones are (re)sent.
      if (!resumed) c.subscribed = false;
      if (!c.subscribed && !c._user) c._sub();
    });
    const id = this._ck ? `${sid}~${this._ck}` : sid;
    const previous = this.id;
    this.id = id;
    this._state('connected', { id, resumed });
    if (previous && previous !== id) this.emit('id', { id, previous });
    this._settle(null);
    if (resumed) this._flush();
    else if (this.user) this.signin().catch((err) => this.emit('error', err));
    this._alive();
  }

  private _signedIn(): void {
    // The user comes from our own auth response, not from the relay's echo (which it could forge).
    const s = this._signing;
    if (!s) return;
    let u: any = {};
    try {
      u = JSON.parse(s[2]);
    } catch {}
    const name = USER + u.id;
    let info = u.user_info;
    if (info && typeof info === 'object' && 'ciphertext' in info) {
      // Sealed sign-in user_info: open it with the key from the sign-in response, never expose
      // the ciphertext.
      try {
        if (!this._e2e) throw { reason: 'e2e_disabled' };
        info = this._e2e.info(name, String(u.id), info);
      } catch (err: any) {
        info = undefined;
        this.emit('e2e:error', { reason: (err && err.reason) || 'decrypt_failed', context: name, user_id: String(u.id) });
      }
    }
    this.user = { id: u.id, info };
    this._us = this.socketId;
    this._chans.forEach((c, n) => c._user && n !== name && this._chans.delete(n));
    let c = this._chans.get(name);
    if (!c) {
      this._chans.set(name, (c = new Channel(name, this)));
      c._user = true;
    }
    c._sub();
    this.emit('signin', this.user);
    this._signing = undefined;
    s[0](this.user);
  }

  private _message(ev: string, ch: string | undefined, c: Channel | undefined, d: unknown, h: any, userId?: string, retry?: boolean): void {
    const id: string | undefined = h.m;
    if (id && !retry) {
      const k = `${ch || ''}|${id}`;
      if (this._seen.has(k)) return void (h.ack && this._ack(id));
      this._seen.add(k);
      if (this._seen.size > 1000) this._seen.delete(this._seen.values().next().value as string);
    }
    let ctx: string;
    if (ch != null) {
      if (!c) return;
      if (h.e != null && !retry) {
        const p = c.pos;
        if (p && p.epoch === h.e && h.o <= p.offset) return;
        c.pos = { epoch: h.e, offset: h.o };
      }
      ctx = ch;
    } else ctx = `#direct-${this.socketId}`;
    const e2e = this._e2e;
    // E2E contexts (keys from the auth endpoint, direct messages) accept envelopes only, so a
    // relay cannot inject plaintext (unless `e2e.allowPlaintext`).
    const encrypted = E2E_EVENT_RE.test(ev) || ctx.startsWith('private-encrypted-') || (!!e2e && e2e.strict(ctx));
    if (encrypted) {
      const ev0 = ev;
      const d0 = d;
      try {
        if (!e2e) throw { reason: 'e2e_disabled' };
        [ev, d] = e2e.open(ctx, ev, d);
      } catch (err: any) {
        const reason = (err && err.reason) || 'decrypt_failed';
        const fail = () => {
          const e = { reason, context: ctx, event: ev0, channel: ch };
          this.emit('e2e:error', e);
          if (c) c.emit('e2e:error', e);
        };
        // Keys may have rotated: refresh this context's keys (at most every 30 s) and retry once.
        const refresh = !retry && c && /^(unknown_kid|decrypt_failed)$/.test(reason) && this._refresh(c);
        if (refresh) refresh.then(() => this._message(ev0, ch, c, d0, h, userId, true), fail);
        else fail();
        return;
      }
    }
    const meta: MessageMeta = { event: ev, channel: ch, id, user_id: userId, kind: h.k, encrypted };
    const results = c && !c._user ? c.emit(ev, d, meta) : this.emit(ev, d, meta);
    // Acknowledge after the handlers ran (and their promises settled).
    if (h.ack && id) Promise.all(results.map((r) => Promise.resolve(r).catch(() => {}))).then(() => this._ack(id));
  }

  /** Re-fetches the E2E keys of a channel or of the signed-in user (shared by concurrent failures). */
  private _refresh(c: Channel): Promise<unknown> | null {
    const n = c.name;
    let r = this._rf.get(n);
    if (!r || Date.now() - r[0] > 30_000) {
      const p = c._user
        ? this._userAuth(this.socketId!)
        : /^(private|presence)-/.test(n)
          ? this._authorize(n).then((a) => this._e2e!.keys(n, a.hubfly && a.hubfly.keys, a.shared_secret))
          : null;
      if (!p) return null;
      this._rf.set(n, (r = [Date.now(), p]));
    }
    return r[1];
  }

  private _ack(id: string): void {
    this._acks.push(id);
    if (!this._t3) {
      this._t3 = setTimeout(() => {
        this._t3 = undefined;
        this._flush();
      }, 0);
    }
  }

  private _flush(): void {
    if (this._est && this.hubfly) while (this._acks.length) this._send('hubfly:ack', { m: this._acks.splice(0, 100) });
  }

  private async _userAuth(socketId: string): Promise<UserAuth> {
    const o = this._o;
    const res: UserAuth = o.userAuthorizer
      ? await o.userAuthorizer({ socketId })
      : await this._post(o.userAuthEndpoint, { socket_id: socketId });
    if (this._e2e) {
      let id = '';
      try {
        id = JSON.parse(res.user_data).id;
      } catch {}
      this._e2e.keys(USER + id, res.hubfly && res.hubfly.keys);
    }
    return res;
  }

  /** @internal */
  _authorize(channel: string): Promise<ChannelAuth> {
    const o = this._o;
    const socketId = this.socketId!;
    return o.authorizer
      ? o.authorizer({ socketId, channelName: channel })
      : this._post(o.authEndpoint, { socket_id: socketId, channel_name: channel });
  }

  private async _post(url: string | undefined, body: Record<string, string>): Promise<any> {
    if (!url) throw new Error('HubFly Realtime: authEndpoint/userAuthEndpoint is not set');
    const a = this._o.auth || {};
    const headers = typeof a.headers === 'function' ? await a.headers() : a.headers;
    const res = await (this._o.fetch || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams({ ...a.params, ...body }).toString(),
      credentials: a.credentials,
    });
    if (!res.ok) throw Object.assign(new Error(`HubFly Realtime: auth failed (${res.status})`), { status: res.status });
    return res.json();
  }

  /** @internal */
  _send(event: string, data: unknown, channel?: string): boolean {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(channel != null ? { event, channel, data } : { event, data }));
    return true;
  }
}

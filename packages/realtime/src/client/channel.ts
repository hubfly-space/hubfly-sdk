import { Emitter } from './emitter';
import type { Realtime } from './realtime';
import type { ChannelAuth, RecoveryInfo } from './types';

const AUTH_RE = /^(private|presence)-/;

/** A presence member. */
export interface Member {
  id: string;
  info?: any;
}

/** Presence members of a channel (pusher-js style). */
export class Members {
  /** @internal */
  _m = new Map<string, unknown>();
  /** This connection's member (from the auth response). */
  me: Member | null = null;

  get count(): number {
    return this._m.size;
  }

  get(id: string): Member | null {
    return this._m.has(id) ? { id, info: this._m.get(id) } : null;
  }

  each(fn: (member: Member) => void): void {
    this._m.forEach((info, id) => fn({ id, info }));
  }
}

/**
 * A channel subscription. Bind application events with `bind(event, (data, meta) => …)`.
 * Channel events: `pusher:subscription_succeeded` (presence: the `Members`),
 * `pusher:subscription_error`, `pusher:member_added` / `pusher:member_removed` (`{id, info}`),
 * `pusher:subscription_count`, `pusher:cache_miss`, `recovery` (`RecoveryInfo`),
 * `recovery:failed` (`{reason}`: refetch state) and `e2e:error`.
 */
export class Channel extends Emitter {
  /** True once the server confirmed the subscription. */
  subscribed = false;
  /** Last seen position, used to recover missed messages (HubFly socket). */
  pos?: { epoch: string; offset: number };
  /** Presence members (presence channels only). */
  readonly members: Members | null;
  /** @internal The `#server-to-user-` channel of the signed-in user. */
  _user = false;

  constructor(
    readonly name: string,
    /** @internal */ readonly _rt: Realtime,
  ) {
    super();
    this.members = name.startsWith('presence-') ? new Members() : null;
  }

  /** Alias of `on` (pusher-js). */
  bind(event: string, handler: (data: any, meta?: any) => unknown): this {
    return this.on(event, handler);
  }

  /** Alias of `off` (pusher-js). */
  unbind(event?: string, handler?: (data: any, meta?: any) => unknown): this {
    return this.off(event, handler);
  }

  /**
   * Sends a client event (`client-…`) to the other subscribers. With E2E, events on encrypted
   * channels and on private/presence channels whose auth returned keys are sealed in a v1
   * envelope. Returns false when not subscribed or not connected.
   */
  trigger(event: string, data?: unknown): boolean {
    if (!event.startsWith('client-')) throw new Error('HubFly Realtime: client events start with "client-"');
    const rt = this._rt;
    const name = this.name;
    const encrypted = name.startsWith('private-encrypted-');
    let ev = event;
    let d = data;
    const sealed = rt._e2e ? rt._e2e.seal(name, event, data, encrypted) : null;
    if (sealed) [ev, d] = sealed;
    else if (encrypted) throw new Error('HubFly Realtime: client events on encrypted channels need e2e');
    return this.subscribed && rt._send(ev, d, name);
  }

  /** Unsubscribes. */
  unsubscribe(): void {
    this._rt.unsubscribe(this.name);
  }

  /** @internal Sends `pusher:subscribe` (authorizing private/presence channels first). */
  async _sub(): Promise<void> {
    const rt = this._rt;
    const name = this.name;
    const sid = rt.socketId;
    if (!rt._est) return;
    const data: Record<string, unknown> = { channel: name };
    if (AUTH_RE.test(name)) {
      let a: ChannelAuth;
      try {
        a = await rt._authorize(name);
      } catch (err: any) {
        this.emit('pusher:subscription_error', { type: 'AuthError', error: String((err && err.message) || err), status: err && err.status });
        return;
      }
      if (rt.socketId !== sid || rt._chans.get(name) !== this) return; // reconnected or unsubscribed meanwhile
      data.auth = a.auth;
      if (rt._e2e) rt._e2e.keys(name, a.hubfly && a.hubfly.keys, a.shared_secret);
      if (a.channel_data) {
        data.channel_data = a.channel_data;
        const cd = JSON.parse(a.channel_data);
        if (this.members) this.members.me = { id: String(cd.user_id), info: this._info(cd.user_id, cd.user_info) };
      }
    }
    if (this.pos && rt.hubfly) data.hubfly = { since: this.pos };
    rt._send('pusher:subscribe', data);
  }

  /** @internal Protocol events of this channel. */
  _internal(event: string, d: any): void {
    const m = this.members;
    const ev = event.replace('_internal', '');
    const h = d && d.hubfly;
    if (ev === 'pusher:subscription_succeeded') {
      this.subscribed = true;
      // Fresh subscribe or failed recovery: start from the head. Otherwise the replay advances it.
      if (h && (!h.recovery || h.recovery === 'failed')) this.pos = h.epoch != null ? { epoch: h.epoch, offset: h.head } : undefined;
      if (m) {
        m._m.clear();
        const p = (d && d.presence) || {};
        for (const id of p.ids || []) m._m.set(id, this._info(id, (p.hash || {})[id]));
        d = m;
      }
    } else if (ev === 'pusher:subscription_error') this.subscribed = false;
    else if (m && ev === 'pusher:member_added') {
      const info = this._info(d.user_id, d.user_info);
      m._m.set(d.user_id, info);
      d = { id: d.user_id, info };
    } else if (m && ev === 'pusher:member_removed') {
      d = { id: d.user_id, info: m._m.get(d.user_id) };
      m._m.delete(d.id);
    }
    this.emit(ev, d);
    if (ev === 'pusher:subscription_succeeded' && h && h.recovery) this._recovery(h);
  }

  /** @internal */
  _recovery(h: any): void {
    const info: RecoveryInfo = { ...h, status: h.recovery || h.status };
    this.emit('recovery', info);
    if (info.status === 'failed') this.emit('recovery:failed', { reason: info.reason });
  }

  /** Opens sealed presence `user_info` with E2E (plaintext on full-E2E channels counts as absent). */
  private _info(id: unknown, info: unknown): unknown {
    const e2e = this._rt._e2e;
    if (!e2e) return info;
    try {
      return e2e.info(this.name, String(id), info);
    } catch (err: any) {
      const e = { reason: (err && err.reason) || 'decrypt_failed', context: this.name, user_id: String(id) };
      this.emit('e2e:error', e);
      this._rt.emit('e2e:error', e);
      return undefined;
    }
  }
}

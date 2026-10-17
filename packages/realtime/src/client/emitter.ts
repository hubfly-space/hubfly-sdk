import type { Handler } from './types';

/** Minimal event emitter. A Map, so server-chosen event names cannot reach Object.prototype. */
export class Emitter {
  /** @internal */
  _h = new Map<string, Handler[]>();

  /** Adds a handler. Handlers receive `(data, meta)`. */
  on(event: string, handler: Handler): this {
    const list = this._h.get(event);
    if (list) list.push(handler);
    else this._h.set(event, [handler]);
    return this;
  }

  /** Removes one handler, every handler of an event, or everything. */
  off(event?: string, handler?: Handler): this {
    if (event == null) this._h.clear();
    else if (!handler) this._h.delete(event);
    else this._h.set(event, (this._h.get(event) || []).filter((h) => h !== handler));
    return this;
  }

  /** @internal Calls the handlers; a throwing handler does not stop the others. Returns their results. */
  emit(event: string, data?: unknown, meta?: unknown): unknown[] {
    const out: unknown[] = [];
    for (const h of (this._h.get(event) || []).slice()) {
      try {
        out.push(h(data, meta));
      } catch (err) {
        console.error(err);
      }
    }
    return out;
  }
}

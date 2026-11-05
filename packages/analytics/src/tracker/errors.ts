/**
 * `errors.js`: the JS errors module, appended to the per-site script after `core.js` when the
 * site has `errors` on (COLLECT.md §4, §7). Reports uncaught `error` and `unhandledrejection`
 * events through `window.hubfly.x`: at most 10 per pageview, each distinct message/location once
 * per pageview, nothing from browser extensions. Chrome's "Uncaught " message prefix is removed so
 * the collector fingerprints the same error alike in every browser.
 */
import type { TrackerExt } from './types';

declare const window: any;

(() => {
  const w = window;
  const x: TrackerExt = w.hubfly && w.hubfly.x;
  if (!x || x.R) return;
  x.R = 1;
  let pid = '';
  let seen: Record<string, 1> = {};
  let count = 0;
  const cut = (s: unknown, n: number) => (s ? ('' + s).slice(0, n) : undefined);

  const rep = (ty: 'error' | 'unhandledrejection', msg: unknown, src?: string, ln?: number, col?: number, stk?: unknown) => {
    if (x.pid() != pid) (pid = x.pid()), (seen = {}), (count = 0);
    const k = msg + '|' + src + '|' + ln + '|' + col;
    if (count >= 10 || seen[k] || /-extension:\/\//.test(src + '' + stk)) return;
    seen[k] = 1;
    count++;
    x.send({ t: 'err', ty, msg: cut(('' + msg).replace(/^Uncaught /, ''), 300) || '(no message)', src: cut(src, 300), ln: ln || undefined, col: col || undefined, stk: cut(stk, 1000) });
  };

  // Resource load errors do not bubble to window and carry no message, so only script errors arrive here.
  w.addEventListener('error', (e: any) => e.message && rep('error', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack));
  w.addEventListener('unhandledrejection', (e: any) => {
    const r = e.reason;
    rep('unhandledrejection', (r && r.message) || r, undefined, undefined, undefined, r && r.stack);
  });
})();

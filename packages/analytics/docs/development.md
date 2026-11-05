# Developing @hubfly/analytics

The package has two halves:

- **Tracker scripts** (`src/tracker/`): `core.ts`, `vitals.ts` and `errors.ts`,
  built into minified IIFEs that the `hubfly-analytics` collector serves as one
  per-site script (`GET /s/{site}.js`). The wire format and the script's
  config are defined in `hubfly-analytics/docs/COLLECT.md` (§5 and §7);
  change that contract first.
- **npm entries** (`src/index.ts`, `react.ts`, `next.ts`, `vue.ts`,
  `svelte.ts`, `server.ts`), built with tsup. The browser entries only add the
  script tag and call `window.hubfly`; the tracker logic lives in the scripts.

## Commands

```sh
bun install                 # from the repo root (workspace)
cd packages/analytics
bun run typecheck
bun test                    # runs the built scripts in a fake browser
bun run build               # dist/ (tsup) + dist/tracker/ (scripts and manifest)
bun run build:tracker       # dist/tracker/ only
```

`bun run build:tracker` writes `dist/tracker/core.js`, `vitals.js`,
`errors.js` and `manifest.json` (`{"version", "files": {name: sha256}}`).
`hubfly-analytics` copies them byte for byte with `make tracker-sync` and
checks them against the manifest. After changing a script, rebuild, then run
`make tracker-sync` in `hubfly-analytics`.

## Size budget

`core.js` must stay within **2.5 KB min+gzip** (`test/size.test.ts`; the
modules have 1 KB and 512 B budgets). The scripts are written for size: every
browser global is read off `window`, commands are compared as strings, and
fields left `undefined` are dropped by `JSON.stringify`. Check the printed
sizes when you change a script.

## Tests

`test/dom.ts` is a small fake browser (window, document, navigator, location,
history, storage, PerformanceObserver). The tests build the real scripts with
`Bun.build` and run them in it with `new Function('window', code)`, so they
cover the shipped output. Every batch a test sends is checked against
COLLECT.md §5 by `contractErrors()`.

For a live check, serve a page that sets `window.__HFA__ = { s: 'hfa_…', e: '<collector>/e', lh: true }`
before `dist/tracker/core.js` and watch the network panel: one `POST /e`
with `text/plain` per batch.

## Behaviour the collector relies on

- **Endpoint.** `config.e`, else the script URL with its final
  `/s/{site}.js` replaced by `/e`. Without either, the tracker stays off.
- **Batches.** Events queued in the same task share one `POST`
  (`sendBeacon`, `text/plain;charset=UTF-8`; `fetch` with `keepalive` when the
  beacon is refused or missing). At most 20 events and 16,000 bytes per body:
  a bigger batch is halved until it fits.
- **Pageviews.** The first one carries `r` (`document.referrer`); later ones
  (SPA) don't. A new pageview starts when the path (plus the `#/…` route with
  `h`) changes; query-only changes don't count. Fragments are dropped from
  `u` unless `h` is on and the fragment starts with `#/`.
- **Engagement.** `eng.d` is visible time since the previous `eng` of the
  same pageview, capped at 1,800,000. Sent on page hide, `pagehide` and SPA
  navigation (in the same batch as the next `pv`); never with `d: 0`.
- **Revenue.** `$.a` is a number; `$.c` is uppercased and omitted when the
  caller gave no currency (the collector then uses the site currency). A
  bare number (`revenue: 29.99`) is the amount; a falsy revenue sends no `$`.
- **Exclusions** (`x`). Matched against the URL path: `*` is `[^/]*`, `**`
  is `.*`, anchored at both ends, so `/admin/**` matches `/admin/` and
  `/admin/a/b` but not `/admin`. On an excluded page nothing is sent, not
  even events or engagement.
- **Ignored hosts** unless `lh`: `localhost`, `*.local`, `*.localhost`,
  `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `0.0.0.0`, IPv6 loopback and
  private/link-local literals, and `file:` pages.
- **Storage.** Opt-out is `localStorage.hfa_opt_out = "1"`. In persistent
  mode the visitor id is `localStorage.hfa_id` (16 characters of `[0-9a-z]`);
  it is only sent once stored, so blocked storage falls back to cookieless.
  Cookieless mode writes nothing.
- **Bots.** `bot: 1` when `navigator.webdriver` is set or the user agent says
  `Headless`. Such batches are still sent so the collector can count them as
  filtered.
- **404.** `hubfly('404')`, or automatically (with `n`) after the first
  pageview when the script tag has a `data-404` attribute (HubProxy adds it
  when it injects the tag into a 404 page; every browser) or the navigation
  entry's `responseStatus` is 404 (Chromium).
- **Pre-load queue.** `identify`, `consent`, `opt_out` and `opt_in` calls
  queued before the script ran are applied first, then the first pageview is
  sent, then the other queued calls.
- **Self-hosted config.** Without `window.__HFA__`, `core.js` reads
  `data-site`, `data-api`, `data-o|d|f|n|h|dnt|lh|p|c="true"` and
  `data-x="/a/**,/b"` (comma-separated) from its own script tag.
- **Modules.** `vitals.js` and `errors.js` attach through `window.hubfly.x`
  (`0` when the tracker is off), mark themselves (`x.V`, `x.R`) so a second
  copy does nothing, and tag their events with the landing pageview
  (vitals) or the current one (errors).
- **Concatenation.** Each built file ends with exactly one `\n`, so the
  collector can serve `window.__HFA__=…;\n` + `core.js` + `vitals.js` +
  `errors.js` as-is.

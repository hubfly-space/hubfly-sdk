# HubFly Web Analytics

Cookieless, privacy-friendly web analytics for sites on HubFly or anywhere else.
Pageviews, custom events, engagement, Web Vitals and JS errors, without cookies
or a consent banner.

```sh
npm install @hubfly/analytics
```

Most sites don't need this package: on a domain hosted on HubFly, turn on
**Analytics** for the domain in the Dashboard and HubFly adds the script for
you. Use the package to load the script from a bundled app, to send custom
events with types, or to send events from your servers.

## Get started

In the [HubFly Dashboard](https://dashboard.hubfly.space), open a project's
**Analytics** tab (or create an **Analytics** project for a site hosted
elsewhere) and add a site. Copy its site ID (`hfa_…`). Sites hosted elsewhere
also need their region's collector host, shown next to the site ID:
`https://hfa.<region>.hubfly.app`.

### Script tag

```html
<script defer src="https://hfa.<region>.hubfly.app/s/hfa_xxxxxxxxxxxxxxxx.js"></script>
```

On a domain hosted on HubFly, use the first-party path instead:
`/.hubfly/a/s/hfa_xxxxxxxxxxxxxxxx.js`. It is served from your own domain, so a
CSP of `script-src 'self'` allows it.

To send events before the script has loaded, add this stub above it. Calls
are queued and sent once the script runs:

```html
<script>window.hubfly=window.hubfly||function(){(hubfly.q=hubfly.q||[]).push(arguments)}</script>
```

### Bundled apps

```js
import { inject, track } from '@hubfly/analytics';

inject({ site: 'hfa_xxxxxxxxxxxxxxxx', host: 'https://hfa.<region>.hubfly.app' });

track('Signup', { props: { plan: 'pro' } });
```

`host` defaults to `/.hubfly/a`, the first-party path on domains hosted on
HubFly. `inject()` adds the script once. It does nothing during server
rendering, and nothing when the page already has the script.

## Frameworks

Single-page apps need no router setup: the tracker counts navigations made
with the History API (`pushState`, `replaceState`, back and forward).

### React

```jsx
import { Analytics } from '@hubfly/analytics/react';

export function App() {
  return (
    <>
      <Routes />
      <Analytics site="hfa_xxxxxxxxxxxxxxxx" host="https://hfa.<region>.hubfly.app" />
    </>
  );
}
```

### Next.js

`Analytics` is a client component. Put it in the root layout (App Router) or
in `pages/_app` (Pages Router):

```jsx
// app/layout.tsx
import { Analytics } from '@hubfly/analytics/next';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics site="hfa_xxxxxxxxxxxxxxxx" host="https://hfa.<region>.hubfly.app" />
      </body>
    </html>
  );
}
```

### Vue and Nuxt

```js
import { createApp } from 'vue';
import { analytics } from '@hubfly/analytics/vue';

createApp(App).use(analytics({ site: 'hfa_xxxxxxxxxxxxxxxx', host: 'https://hfa.<region>.hubfly.app' })).mount('#app');
```

In Nuxt, install it from a client-only plugin (`plugins/analytics.client.ts`).

### Svelte and SvelteKit

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { injectAnalytics } from '@hubfly/analytics/svelte';

  injectAnalytics({ site: 'hfa_xxxxxxxxxxxxxxxx', host: 'https://hfa.<region>.hubfly.app' });
</script>

<slot />
```

### Options

`inject()`, `<Analytics />`, `analytics()` and `injectAnalytics()` take the same
options:

| Option | Default | |
|---|---|---|
| `site` | | Site ID, `hfa_…`. |
| `host` | `/.hubfly/a` | Where the script and events go. Sites hosted elsewhere use `https://hfa.<region>.hubfly.app`. |
| `src` | | Full script URL. Overrides `site` and `host`. |

What the script tracks (outbound links, downloads, forms, 404s, Web Vitals,
JS errors, hash routes, excluded paths, Do Not Track) is set per site in the
Dashboard, not in code.

## Events

Every entry point exports the same commands. They are safe to call before the
script has loaded, and they do nothing during server rendering.

```js
import { track, pageview, identify, consent, optOut, optIn, notFound } from '@hubfly/analytics';

// Custom event, with props and revenue.
track('Purchase', { props: { plan: 'pro', seats: 3 }, revenue: { amount: 29.99, currency: 'USD' } });

// A virtual page (wizard steps, modals). Normal navigations are counted already.
pageview({ url: '/checkout/step-2' });

// A 404 page the script doesn't detect on its own (below).
notFound();
```

When the site tracks 404s, pages served with status 404 are detected on their
own: in every browser on domains hosted on HubFly where HubFly adds the
script, and in Chromium-based browsers elsewhere. Call `notFound()` for the
rest, such as a single-page app's not-found route.

With the script tag, call `window.hubfly` directly:
`hubfly('track', 'Purchase', { props: { plan: 'pro' }, revenue: { amount: 29.99, currency: 'USD' } })`,
`hubfly('pageview', { url })`, `hubfly('404')`, `hubfly('identify', id)`,
`hubfly('consent', true)`, `hubfly('opt_out')` and `hubfly('opt_in')`.

| Command | |
|---|---|
| `track(name, { props?, revenue? })` | Name up to 120 characters. Up to 30 props, keys up to 64 characters, values (string, number or boolean) up to 512. `revenue: { amount, currency? }`, currency as an ISO 4217 code; without it, the site currency. A bare number is an amount in the site currency: `revenue: 29.99`. |
| `pageview({ url?, props? })` | `url` absolute or relative to the page. Default: the current page. |
| `notFound()` | Records a 404 for the current page. |
| `identify(userId)` | Your user ID, up to 128 characters. Persistent mode only. |
| `consent(granted)` | Grants or withdraws consent for the persistent visitor ID. |
| `optOut()` / `optIn()` | Stops or resumes all tracking from this browser for this site. |

## Privacy

By default the script stores nothing on the device: no cookies, no
`localStorage`. Visitors are counted with a hash that rotates every day, and IP
addresses are never stored. The only thing ever written is the visitor's own
choice when they opt out.

A site can turn on **persistent mode** in the Dashboard to see returning
visitors and retention and to use `identify()`. The script then keeps a random
ID in `localStorage` (`hfa_id`). With **require consent** on, it stays
cookieless until you call `consent(true)`; `consent(false)` deletes the ID.
Persistent mode stores data on the device, so EU visitors must consent first.

The script sends nothing on `localhost` and private hosts (unless the site
allows them), when the visitor opted out, or, when the site respects them,
with Do Not Track or Global Privacy Control on.

## Server-side events

Send events from your backend with a site ingest key (`hfak_…`, Dashboard →
Analytics → site settings → Ingest keys). Keep the key on the server. Works on
Node 18+, Bun, Deno and Cloudflare Workers.

```js
import { AnalyticsServer } from '@hubfly/analytics/server';

const analytics = new AnalyticsServer({
  key: process.env.HUBFLY_ANALYTICS_INGEST_KEY,
  host: 'https://hfa.<region>.hubfly.app',
});
// or: AnalyticsServer.fromEnv() reads HUBFLY_ANALYTICS_INGEST_KEY and HUBFLY_ANALYTICS_HOST

await analytics.track('Purchase', {
  url: 'https://example.com/checkout',
  props: { plan: 'pro' },
  revenue: { amount: '29.99', currency: 'USD' },
  ip: request.ip,
  userAgent: request.headers['user-agent'],
});

await analytics.pageview({ url: 'https://example.com/api/docs', ip, userAgent });

const { accepted, rejected } = await analytics.send([
  { type: 'event', name: 'Signup', url: 'https://example.com/', userId: 'user-42' },
  { type: 'pageview', url: 'https://example.com/welcome', visitorId: 'v-123' },
]);
```

| Field | |
|---|---|
| `url` | Required. Its host must be one of the site's domains. |
| `props`, `revenue` | As in the browser, but `revenue` is always `{ amount, currency? }`. |
| `ip`, `userAgent` | The visitor's. Together they give the same cookieless visitor as the browser script. |
| `visitorId` | Your own visitor ID. Takes precedence over `ip` and `userAgent`. |
| `userId` | Your user ID. |
| `referrer` | Referrer URL. |
| `timestamp` | `Date`, ISO string or epoch ms, from 24 hours ago to 5 minutes ahead. Default: now. |

`send()` takes any number of events and sends them 100 per request. Events
the collector refuses (wrong domain, malformed, filtered) are counted in
`rejected`; they don't fail the call. A missing or revoked key (401), an
invalid body (400) or an oversized one (413) throws `AnalyticsApiError` with
`status`.

Server-side events are billed like browser events.

## Limits and pricing

Pageviews and custom events (including outbound clicks, downloads, form
submits and 404s) are billable events. Engagement, Web Vitals, JS errors and
filtered traffic are never billed. See
[pricing](https://hubfly.space/pricing) for the current price and free
allowance.

## Development

See [docs/development.md](docs/development.md).

## License

MIT

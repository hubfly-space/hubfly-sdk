# Frameworks and existing Pusher apps

[Get started](../README.md) · [Authentication](authentication.md)

## Frontend environment variables

Expose only the Realtime URL and public app key to the browser:

| Framework | Public variables |
| --- | --- |
| Vite | `VITE_HUBFLY_REALTIME_URL`, `VITE_HUBFLY_REALTIME_KEY` |
| Next.js | `NEXT_PUBLIC_HUBFLY_REALTIME_URL`, `NEXT_PUBLIC_HUBFLY_REALTIME_KEY` |
| SvelteKit / Astro | `PUBLIC_HUBFLY_REALTIME_URL`, `PUBLIC_HUBFLY_REALTIME_KEY` |

For example, in Vite:

```js
const realtime = new Realtime({
  url: import.meta.env.VITE_HUBFLY_REALTIME_URL,
  key: import.meta.env.VITE_HUBFLY_REALTIME_KEY,
});
```

Keep `HUBFLY_REALTIME_SECRET` and `HUBFLY_REALTIME_E2E_KEYS` on your backend.

## React

Create the connection inside an effect and disconnect during cleanup.
In Next.js, use this in a component marked `'use client'`.

```tsx
import { useEffect, useState } from 'react';
import { Realtime } from '@hubfly/realtime';

export function LiveMessage({ url, appKey }: { url: string; appKey: string }) {
  const [text, setText] = useState('');

  useEffect(() => {
    const realtime = new Realtime({ url, key: appKey });
    realtime.subscribe('chat').bind('message.created', (message) => {
      setText(message.text);
    });
    void realtime.connect().catch(console.error);
    return () => realtime.disconnect();
  }, [url, appKey]);

  return <p>{text || 'Waiting for a message…'}</p>;
}
```

## Backend runtimes

The server entry supports Node.js 18+, Bun, Deno, and Cloudflare Workers.
It uses Fetch and Web Crypto APIs.

```js
import { RealtimeServer } from '@hubfly/realtime/server';

// Node, Bun, Deno: reads the process environment where available.
const realtime = RealtimeServer.fromEnv();
```

In Deno, pass `Deno.env.toObject()` to `fromEnv` and allow environment access.
In Workers, pass the `env` bindings supplied to your request handler:

```ts
export default {
  async fetch(request: Request, env: Record<string, string>) {
    const realtime = RealtimeServer.fromEnv(env);
    await realtime.channel('chat').publish('message.created', { text: 'Hello' });
    return new Response('Sent');
  },
};
```

On Node.js 18, if global Web Crypto is unavailable, pass
`{ crypto: (await import('node:crypto')).webcrypto }` as the second argument
to `fromEnv`. If you use the **client** entry on a Node version without a
global `WebSocket`, install `ws` and pass its constructor as the `WebSocket`
option. Browsers and Bun provide a WebSocket implementation.

## Pusher and Laravel Echo

Pusher clients can use the same Realtime server. Replace their host, app ID,
key, and secret with your HubFly app's values.

```js
import Pusher from 'pusher-js';

const pusher = new Pusher('your-app-key', {
  wsHost: 'your-server.rt.hubfly.app',
  wssPort: 443,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  cluster: 'mt1', // Required by pusher-js; HubFly uses the explicit host.
  channelAuthorization: { endpoint: '/api/realtime/auth', transport: 'ajax' },
});
```

For Laravel, set these backend variables:

```dotenv
BROADCAST_CONNECTION=pusher
PUSHER_APP_ID=your-app-id
PUSHER_APP_KEY=your-app-key
PUSHER_APP_SECRET=your-app-secret
PUSHER_HOST=your-server.rt.hubfly.app
PUSHER_PORT=443
PUSHER_SCHEME=https
```

Use `BROADCAST_DRIVER=pusher` for Laravel versions before 11. Configure
Laravel Echo with `broadcaster: 'pusher'` and the same WebSocket host, port,
TLS, and transport settings shown above. Your Laravel broadcast auth route
still controls access to private and presence channels.

Pusher clients support standard channel features. HubFly session resume,
direct messages, receipts, and full E2E use the HubFly client.

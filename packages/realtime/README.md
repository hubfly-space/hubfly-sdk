# HubFly Realtime

Add live chat, notifications, and presence to your app with managed WebSockets.
Includes a JavaScript client, server helpers, and optional end-to-end encryption.

```sh
npm install @hubfly/realtime
```

## Get started

In the [HubFly Dashboard](https://dashboard.hubfly.space), create a Realtime
server, then create an app. Copy its URL, app ID, key, and secret.

### 1. Listen in the browser

Replace the URL and public app key with the values from your Realtime app.

```js
import { Realtime } from '@hubfly/realtime';

const realtime = new Realtime({
  url: 'https://your-server.rt.hubfly.app',
  key: 'your-app-key',
});

const chat = realtime.subscribe('chat');

chat.bind('message.created', (message) => {
  console.log(message.text);
});

chat.bind('pusher:subscription_succeeded', () => {
  console.log('Ready to receive messages');
});

await realtime.connect();
```

This uses a public channel: anyone with the app key can subscribe. Use
[private channels](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/authentication.md)
for user or account data.

### 2. Publish from your server

Save these values in a backend `.env` file. Dashboard app bindings and
AI Builder can set the environment variables for you.

```dotenv
HUBFLY_REALTIME_URL=https://your-server.rt.hubfly.app
HUBFLY_REALTIME_APP_ID=your-app-id
HUBFLY_REALTIME_KEY=your-app-key
HUBFLY_REALTIME_SECRET=your-app-secret
```

Save this as `publish.mjs`:

```js
import { RealtimeServer } from '@hubfly/realtime/server';

const realtime = RealtimeServer.fromEnv();

await realtime.channel('chat').publish('message.created', {
  text: 'Hello from your server',
});
```

Once the browser says “Ready to receive messages,” run it with Node.js 22+:

```sh
node --env-file=.env publish.mjs
```

The browser prints `Hello from your server`. Keep the app secret on your
backend; the browser needs only the URL and public key.

### 3. Handle connection changes

The client reconnects automatically. Listen for state changes to update your UI:

```js
realtime.on('state', ({ current }) => console.log(current));
realtime.on('error', (error) => console.error(error));

// When leaving the page or unmounting your component:
// realtime.disconnect();
```

## Guides

| I want to… | Read |
| --- | --- |
| Authorize private channels, show presence, or message a user | [Authentication](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/authentication.md) |
| Encrypt message content | [Encryption](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/encryption.md) |
| Use React, Node, Workers, Pusher, or Laravel Echo | [Integrations](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/integrations.md) |
| Look up options, methods, recovery, and errors | [API reference](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/api.md) |
| Build the SDK or run its tests | [Contributing](https://github.com/hubfly-space/hubfly-sdk/blob/main/packages/realtime/docs/development.md) |

The package exports `@hubfly/realtime` for clients, `/server` for backends, and
`/e2e` for encryption helpers. TypeScript declarations are included.

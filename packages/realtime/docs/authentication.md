# Authentication and presence

[Get started](../README.md) · [API reference](api.md)

Public channels need no authorization. Private and presence channels call an
endpoint on your backend before subscribing. That endpoint checks your app's
session and signs access with `HUBFLY_REALTIME_SECRET`.

## Add an authorization endpoint

This Next.js route allows each signed-in user to join only their own channel.
`getSession` is your application's server-side session lookup; replace its
import with your existing authentication code.

```ts
// app/api/realtime/auth/route.ts
import { RealtimeServer } from '@hubfly/realtime/server';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  const realtime = RealtimeServer.fromEnv();

  return realtime.authHandler({
    getUser: async (request) => {
      const session = await getSession(request);
      return session ? { id: session.user.id } : null;
    },
    canAccess: (user, channel) =>
      user !== null && channel === `private-user-${user.id}`,
  })(request);
}
```

Use the authenticated session to identify the user. Do not accept a user ID
from the browser as proof of identity. Set `canAccess` for your channel rules;
without it, any signed-in user can join any private or presence channel.

On the client, add `authEndpoint` to your connection options:

```js
import { Realtime } from '@hubfly/realtime';

const realtime = new Realtime({
  url: 'https://your-server.rt.hubfly.app',
  key: 'your-app-key',
  authEndpoint: '/api/realtime/auth',
});

const notifications = realtime.subscribe('private-user-42');
notifications.bind('notification', (data) => console.log(data));
await realtime.connect();
```

Replace `42` with the signed-in user's ID. On your server, publish to the
same channel with `realtime.channel('private-user-42').publish(...)`.

The handler accepts a Fetch `Request` and returns a `Response`, so the same
handler works in Bun, Deno, and Workers. It accepts the form-encoded requests
sent by this client and pusher-js, as well as JSON. Denied access returns 403;
invalid request parameters return 400.

## Show who is online

Subscribe to a `presence-` channel and listen for membership changes:

```js
const room = realtime.subscribe('presence-room-42');

room.bind('pusher:subscription_succeeded', (members) => {
  console.log(`${members.count} people online`);
});
room.bind('pusher:member_added', ({ id }) => console.log('Joined:', id));
room.bind('pusher:member_removed', ({ id }) => console.log('Left:', id));
```

Update your backend's `canAccess` callback to check room membership for this
channel. The private-user rule above intentionally denies it. Return
`{ id, info: { name } }` from `getUser` to include a display name in presence
data; keep `info` under 1 KiB. Presence always requires a signed-in user.

To send typing indicators, enable **client events** in the app settings,
then call `room.trigger('client-typing', { typing: true })` after subscription
succeeds. Client events work on private and presence channels.

## Message a user across their tabs

Set `userAuthEndpoint: '/api/realtime/auth'` on the client. The same handler
supports user sign-in:

```js
// Browser: register the listener, connect, then sign in.
realtime.on('notification', (data) => console.log(data));
await realtime.connect();
await realtime.signin();
```

```js
// Backend: all signed-in connections for this user receive the message.
await realtime.toUser('42').send('notification', { text: 'Your export is ready' });
```

## Cookies and bearer tokens

Same-origin auth requests send cookies by default. For a bearer token, set
`auth.headers` to a function that returns your current Authorization header.
For cross-origin cookies, set `auth.credentials` to `'include'` and configure
your auth endpoint's CORS policy for your frontend origin.

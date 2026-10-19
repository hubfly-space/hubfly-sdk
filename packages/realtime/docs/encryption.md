# End-to-end encryption

[Get started](../README.md) · [Authentication](authentication.md)

Encrypt messages on your backend and decrypt them in authorized clients.
The Realtime service relays and stores ciphertext. Your backend's auth
endpoint controls which clients receive decryption keys.

## Encrypt a channel

1. Generate a 32-byte key on your own machine:

   ```sh
   openssl rand -base64 32
   ```

2. Store it in your backend environment with a key ID:

   ```dotenv
   HUBFLY_REALTIME_E2E_KEYS=k1:your-generated-base64-key
   ```

   `RealtimeServer.fromEnv()` reads it automatically. Never put this master
   key in frontend environment variables or source code.

3. Set up the [auth endpoint](authentication.md), allowing only users who
   should read `private-encrypted-chat`. Enable encryption in the client:

   ```js
   import { Realtime } from '@hubfly/realtime';

   const realtime = new Realtime({
     url: 'https://your-server.rt.hubfly.app',
     key: 'your-app-key',
     authEndpoint: '/api/realtime/auth',
     e2e: true,
   });

   realtime.subscribe('private-encrypted-chat')
     .bind('message.created', (message) => console.log(message.text));
   realtime.on('e2e:error', (error) => console.error(error.reason));
   await realtime.connect();
   ```

4. Publish from your backend after the client has subscribed:

   ```js
   import { RealtimeServer } from '@hubfly/realtime/server';

   const realtime = RealtimeServer.fromEnv();
   await realtime.channel('private-encrypted-chat')
     .publish('message.created', { text: 'Only authorized clients can read this' });
   ```

## What is encrypted?

| Message type | Behavior |
| --- | --- |
| `private-encrypted-*` channels | Payloads are encrypted; event names stay visible. Compatible with pusher-js `with-encryption`. |
| User messages | Encrypted when your server has master keys. Clients need `e2e: true` and user sign-in. |
| Direct messages | Encrypted when sent to an E2E connection ID returned by `connect()`. |
| Other private/presence channels | Enable `fullE2E: true` on the server to encrypt their events and presence/sign-in info. Pusher clients cannot read these events. |

With encryption enabled, `connect()` returns a connection ID containing a
client-generated key. Pass it only to your trusted backend; treat it as a secret.

To require encrypted traffic at the service, set the app's encryption policy
to **required** in the Dashboard. Include `fullE2E: true` in your server options
if you send presence or sign-in user info under that policy:

```js
const realtime = RealtimeServer.fromEnv(undefined, { fullE2E: true });
```

## Rotate keys

Put the new key first on every backend and retain the old key while old
messages may still be read:

```dotenv
HUBFLY_REALTIME_E2E_KEYS=k2:new-base64-key,k1:old-base64-key
```

New messages use `k2`. The HubFly client refreshes authorization when it
encounters an unknown key; call `realtime.reauthorize()` to refresh immediately.
Remove the old key after your retained history has expired. Pusher clients
receive the current shared secret at their next authorization.

## Failure handling and trust

Invalid, replayed, expired, or wrongly addressed encrypted messages are dropped
and emit `e2e:error`. The default maximum message age is 24 hours; set
`e2e: { maxAgeMs }` for a different replay-age window.

Encrypted contexts reject plaintext by default. `allowPlaintext: true` is a
migration option that weakens this protection. `private-encrypted-*` channels
always reject plaintext.

The service can still see channel names, users, connections, message sizes,
and timing. It can drop or delay messages. Encryption does not protect against
an attacker who controls your auth endpoint or master keys. If your backend
runs on HubFly hosting, that hosting environment also holds your server keys.

The client loads encryption helpers only when enabled. For environments
without dynamic imports, pass `import * as e2e from '@hubfly/realtime/e2e'`
as `e2e: { module: e2e }`. React Native also needs a secure
`crypto.getRandomValues` implementation, such as `react-native-get-random-values`.

# @hubfly/sdk

Official TypeScript & JavaScript client SDK for **Hubfly Cloud Platform API** (`https://api.hubfly.space`). Fully-typed, zero-dependency, isomorphic SDK supporting Node.js, Bun, Deno, and modern browsers.

---

## Installation

```bash
npm install @hubfly/sdk
# or
bun add @hubfly/sdk
# or
yarn add @hubfly/sdk
```

---

## Usage

### Initializing Client
```typescript
import { HubflyClient } from '@hubfly/sdk';

const hubfly = new HubflyClient({
  token: 'YOUR_API_BEARER_TOKEN', // Defaults to process.env.HUBFLY_TOKEN if omitted
  baseUrl: 'https://api.hubfly.space', // Default
});
```

---

## API Modules & Examples

### 1. Projects & Workloads
```typescript
// List projects
const projects = await hubfly.projects.list();

// Create new project
const newProject = await hubfly.projects.create({
  name: 'my-production-app',
  region: 'us-east',
});
```

### 2. Container Deployments
```typescript
// List containers in a project
const containers = await hubfly.projects.containers.list('proj_123');

// Deploy a container
const container = await hubfly.projects.containers.create({
  projectId: 'proj_123',
  name: 'frontend-service',
  image: 'nginx:alpine',
  ports: [{ container: 80, protocol: 'tcp' }],
  environment: [
    { key: 'ENV', value: 'production' },
    { key: 'API_URL', value: 'https://api.hubfly.space' },
  ],
});

// Restart container
await hubfly.projects.containers.restart('proj_123', 'cont_456');
```

### 3. Custom Domains & DNS
```typescript
// Register a custom domain
const domain = await hubfly.domains.create({
  domainName: 'myapp.mydomain.com',
});

// Trigger DNS verification
const check = await hubfly.domains.verify(domain.data.id);
```

### 4. Handling API Errors
```typescript
import { HubflyClient, HubflyApiError } from '@hubfly/sdk';

try {
  await hubfly.auth.getProfile();
} catch (err) {
  if (err instanceof HubflyApiError) {
    console.error(`HTTP ${err.statusCode}: ${err.message}`);
    // err.code (e.g. "MANAGED_PRICE_CHANGED"), err.details, err.requestId, err.errorId (5xx)
  }
}
```

### 5. Managed Services: databases and realtime servers

`hubfly.managed` covers the Managed Services API of the Dashboard:

| Module | Covers |
| :--- | :--- |
| `hubfly.managed` | `catalog`, `clientIp`, `pricing`, `estimatePrice`, `workspace`, `listOperations` |
| `hubfly.managed.instances` | Both services: `list`, `get`, `create`, `update`, `delete`, `start`, `stop`, `restart`, `resize`, `upgrade`, operations (`waitForOperation`), `metrics`, `logs`, `audit`, network, alerts, deletion protection |
| `hubfly.managed.databases` | PostgreSQL, MySQL and libSQL: credentials, bindings, databases, users, extensions, exports/imports, config, insights, sessions, SQL, schema, table rows, tokens, shell |
| `hubfly.managed.realtime` | HubFly Realtime: apps, keys, webhooks (+ deliveries), `publish`, `send`, channels, connections, terminate, history, insights, usage, inspector token/recent, bindings, connection details |

All request and response types (`ManagedInstance`, `ManagedRealtimeApp`, `ManagedRealtimeKey`, …) are
generated from the Dashboard's `openapi.json`. Each method's JSDoc names the permission it needs:
`realtime:read`, `realtime:publish`, `realtime:admin`, `database:read|query|admin`, or a level
(read/operate/admin) for routes shared by both services. Secrets are returned only where the API
returns them (marked **Returns a secret** in the JSDoc): realtime `createApp`, `createKey`,
`rotateKey`, `revealKey` and `createInspectorToken`; database `revealCredentials`,
`rotateCredentials`, `createUser`, `rotateUserPassword`, `createToken`, `createShellSession`,
`downloadExport` and `uploadImport`.

```typescript
import { HubflyClient, ManagedErrorCodes, isManagedApiError } from '@hubfly/sdk';

const hubfly = new HubflyClient();
const projectId = 'proj_123';

// Create a realtime server: quote the price from the catalog, create, wait.
const { data: catalog } = await hubfly.managed.catalog();
const size = catalog.realtime.sizes[0];
const { data: created } = await hubfly.managed.instances.create(projectId, {
  name: 'chat',
  service: 'realtime',
  size: { cpu: size.cpu, memoryMib: size.memoryMib },
  quotedHourlyTotal: size.price.hourly.total, // 409 MANAGED_PRICE_CHANGED if it moved
  idempotencyKey: crypto.randomUUID(),        // reuse it when retrying
  initialApp: { name: 'production' },
});
const instanceId = created.instance.id;
const op = await hubfly.managed.instances.waitForOperation(projectId, instanceId, created.operationId);
if (op.status !== 'succeeded') throw new Error(op.error?.message ?? op.status);

// The first app's secret is not in the create response: reveal it (realtime:admin).
const appId = created.initialApp!.appId;
const { data: key } = await hubfly.managed.realtime.revealKey(projectId, instanceId, appId, created.initialApp!.keyId);

// Publish to channels; send to connections or a user (realtime:publish).
await hubfly.managed.realtime.publish(projectId, instanceId, appId, {
  event: 'order.created',
  data: { id: 42 }, // any JSON value, or a string sent as is
  channels: ['private-orders'],
});
const { data: sent } = await hubfly.managed.realtime.send(projectId, instanceId, appId, {
  event: 'ping',
  data: 'hi',
  userId: 'user_1',
});
console.log(sent.counts); // { delivered, buffered, queued, offline }

// Inspect: channel lists need realtime:read; connections, channel inspect and the inspector
// need realtime:publish. Lists page with nextCursor; the iterators follow it.
for await (const channel of hubfly.managed.realtime.iterateChannels(projectId, instanceId, appId)) {
  console.log(channel.name, channel.subscriptionCount);
}

try {
  await hubfly.managed.realtime.getHistory(projectId, instanceId, appId, { channel: 'private-orders', since: 0 });
} catch (err) {
  if (isManagedApiError(err, ManagedErrorCodes.REALTIME_ENGINE_UNSUPPORTED)) {
    // 409: this server's engine version does not have the feature yet
  }
}
```

Errors worth branching on are in `ManagedErrorCodes`: `MANAGED_REALTIME_ENGINE_UNSUPPORTED` (409),
`MANAGED_REALTIME_E2E_REQUIRED` (403: the app only accepts end-to-end encrypted payloads),
`MANAGED_REALTIME_PAYLOAD_TOO_LARGE` (413), `MANAGED_REALTIME_E2E_CONNECTION_ID` (400),
`MANAGED_FEATURE_UNSUPPORTED` (409: a database route called on a realtime server, or the reverse),
`MANAGED_PRICE_CHANGED`, `MANAGED_INSTANCE_NOT_RUNNING` and more.

**End-to-end connection ids.** E2E connection ids look like `<socket_id>~<key>`. The key must never
reach HubFly, and the Dashboard API is HubFly. `send`, `terminateConnection`, `listConnections` and
`publish` (`excludeSocketId`) accept these ids and remove the key on your machine before the request is
built (`toSocketId()` does the same). The Dashboard cannot encrypt for you, so `send` refuses plaintext
to an E2E connection id locally with `MANAGED_REALTIME_E2E_CONNECTION_ID`. Send sealed messages from
your own server with [`@hubfly/realtime/server`](../realtime/README.md) instead.

**Inspector socket.** `openInspector()` mints an inspector token (`realtime:publish`, at most 120 s),
connects to the server's `/hubfly/v1/inspect` socket with the token's origin, and sends the token as
the first frame (never in the URL). When the socket is refused (4403 origin, 4429 too many sessions)
or the engine has no inspector socket, poll
`getInspectorRecent()` instead. Tested against an in-process fake only; not yet against a live
instance.

```typescript
const session = await hubfly.managed.realtime.openInspector(projectId, instanceId, {
  filter: { families: ['msg', 'err'], channelPrefix: 'orders' },
  onEvent: (event) => console.log(event.seq, event.kind, event),
});
// later: session.setFilter({}); session.close(); await session.closed;
```

In Node the default WebSocket is the built-in one (Node 22+); pass `webSocket: (url, origin) => new WS(url, { headers: { Origin: origin } })`
to use another implementation. Refusals reject with `RealtimeInspectorError` (`closeCode` 4401 token,
4403 origin, 4408 no auth, 4429 too many sessions).

The types and the operation table are regenerated with `make generate-managed`, and
`make verify-spec-managed` checks them against the spec (see the root README).

---

## License

MIT License. Copyright (c) Hubfly Cloud Platform.

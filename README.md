# Hubfly Multi-Language SDK (`hubfly-sdk`)

Official client SDK monorepo for the **Hubfly Cloud Platform API** (`https://api.hubfly.space`). Programmatically manage containers, workloads, GPU instances, custom domains, organizations, billing, and automated deployments.

---

## Packages

| Language | Directory | Module / Package Name | Status |
| :--- | :--- | :--- | :--- |
| **TypeScript / Node.js** | [`packages/ts`](packages/ts) | `@hubfly/sdk` | Production Ready |
| **Go** | [`packages/go`](packages/go) | `github.com/hubfly/hubfly-sdk/go` | Production Ready |
| **HubFly Realtime (TypeScript)**: client, server, E2E | [`packages/realtime`](packages/realtime) | `@hubfly/realtime` (`/server`, `/e2e`) | Preview |
| **HubFly Realtime (Go)**: server | [`packages/go/realtime`](packages/go/realtime) | `github.com/hubfly/hubfly-sdk/go/realtime` (nested module) | Preview |
| **HubFly Web Analytics**: browser tracker and events API | [`packages/analytics`](packages/analytics) | `@hubfly/analytics` | Preview |
| **HubFly Streams (TypeScript)**: player, WHIP publishing, tokens, webhooks | [`packages/streams`](packages/streams) | `@hubfly/streams` (`/player`, `/publish`, `/server`) | Preview |
| **HubFly Streams (Go)**: playback tokens, webhooks | [`packages/go/streams`](packages/go/streams) | `github.com/hubfly/hubfly-sdk/go/streams` (nested module) | Preview |

---

## Quick Start

### TypeScript / JavaScript
```bash
npm install @hubfly/sdk
# or
bun add @hubfly/sdk
```

```typescript
import { HubflyClient } from '@hubfly/sdk';

const client = new HubflyClient({
  token: 'YOUR_API_TOKEN', // or set process.env.HUBFLY_TOKEN
});

// List projects
const projects = await client.projects.list();
console.log(projects);

// Deploy a container
const container = await client.projects.containers.create({
  projectId: 'proj_123',
  name: 'my-web-app',
  image: 'nginx:alpine',
});
```

### Go
```bash
go get github.com/hubfly/hubfly-sdk/go
```

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/hubfly/hubfly-sdk/go"
)

func main() {
	client := hubfly.NewClient(hubfly.WithToken("YOUR_API_TOKEN"))

	ctx := context.Background()
	projects, err := client.Projects.List(ctx)
	if err != nil {
		log.Fatalf("failed to list projects: %v", err)
	}

	for _, p := range projects.Data {
		fmt.Printf("Project: %s (ID: %s)\n", p.Name, p.ID)
	}
}
```

### HubFly Realtime
Managed, Pusher-compatible WebSockets with resume, recovery, direct messages and end-to-end
encryption. See [`packages/realtime`](packages/realtime/README.md) (browser, Next.js, Node/Bun/Workers,
Laravel Echo, E2E) and [`packages/go/realtime`](packages/go/realtime/README.md).

```typescript
import { Realtime } from '@hubfly/realtime';                // browser
import { RealtimeServer } from '@hubfly/realtime/server';   // your backend

const rt = new Realtime({ url, key, authEndpoint: '/api/realtime/auth' });
const { id } = await rt.connect();
rt.subscribe('private-orders').bind('order.created', (order) => render(order));

await RealtimeServer.fromEnv().channel('private-orders').publish('order.created', { id: 42 });
```

### HubFly Streams
Live video and audio: a player that picks WebRTC, LL-HLS or HLS, browser publishing over WHIP, and
playback tokens and webhook verification for your backend. See [`packages/streams`](packages/streams/README.md)
and [`packages/go/streams`](packages/go/streams/README.md).

```html
<script type="module">import '@hubfly/streams/player';</script>
<hubfly-player host="acme-tv.live.hubfly.app" channel="sch_main0001" autoplay muted></hubfly-player>
```

```typescript
import { signPlaybackToken } from '@hubfly/streams/server';   // your backend
const token = await signPlaybackToken({ id: keyId, secret: keySecret }, { ch: 'sch_main0001' }, { ttlSeconds: 3600 });
```

Stream servers, inputs, channels, destinations, schedules and keys are managed through
`hubfly.managed.streams` (TypeScript) and `client.Managed.Streams` (Go).

### Managed Services (Databases + Realtime) through the Dashboard API
`@hubfly/sdk` (`hubfly.managed`) and the Go SDK (`client.Managed`) manage databases and realtime
servers: lifecycle, operations, metrics, network, alerts, the database-specific endpoints, and every
realtime endpoint (apps, keys, webhooks, publish/send, channels, connections, history, insights, usage,
inspector, bindings). See [`packages/ts`](packages/ts/README.md#5-managed-services-databases-and-realtime-servers)
and [`packages/go`](packages/go/README.md#4-managed-services-databases-and-realtime-servers).

```typescript
const { data } = await hubfly.managed.realtime.send(projectId, instanceId, appId, {
  event: 'ping', data: { hello: 'world' }, userId: 'user_1',
});
console.log(data.counts); // { delivered, buffered, queued, offline }
```

Their request and response types are generated from the Dashboard's `openapi.json` by
`scripts/generate-managed.ts` (TypeScript `packages/ts/src/modules/managed-types.ts`, Go
`packages/go/managed_types.go`; do not edit them by hand). The same script generates the Web Analytics
types (`analytics-types.ts`, `analytics_types.go`).

### Web Analytics through the Dashboard API
`@hubfly/sdk` (`hubfly.analytics`) and the Go SDK (`client.Analytics`) manage Web Analytics: sites
(external websites or domains served on HubFly), install snippets, reports (aggregate, timeseries,
breakdown, realtime, goals, funnels, journeys, Web Vitals, errors, props), exports, usage and the event
cap, goals, funnels, segments, shared dashboard links and ingest keys. Browsers send events with the
[`@hubfly/analytics`](packages/analytics) tracker. See
[`packages/ts`](packages/ts/README.md#7-web-analytics) and
[`packages/go`](packages/go/README.md#6-web-analytics).

```typescript
const { data } = await hubfly.analytics.sites.query(projectId, siteId, {
  type: 'breakdown', dim: 'page', range: { period: '30d' }, metrics: ['visitors', 'pageviews'],
});
for (const row of data.results) console.log(row.value, row.values.visitors);
```

### Mailboxes (HubFly Mail)
`hubfly.mail` / `client.Mail` administer mailboxes, people, sender identities, branding, storage and
Mailbox API keys through the Dashboard API. `MailboxClient` (TypeScript) and the
[`mailbox`](packages/go/mailbox) Go package read and send mail on the Mail node
(`https://mail.hubmail.space/client/v1`) with a Mailbox API key (`hfmb_…`). See
[`packages/ts`](packages/ts/README.md#6-mailboxes-hubfly-mail) and
[`packages/go`](packages/go/README.md#5-mailboxes-hubfly-mail).

```typescript
const mailbox = new MailboxClient({ apiKey: process.env.HUBFLY_MAILBOX_KEY! });
for await (const thread of mailbox.threads.iterate({ unread: true })) console.log(thread.subject);
```

---

## Monorepo Commands

```bash
# Build both TypeScript and Go SDKs
make build

# Run tests across all SDKs
make test

# Build TypeScript SDK only
make build-ts

# Build Go SDK only
make build-go

# HubFly Realtime: build/test @hubfly/realtime, test the Go realtime module
make build-realtime test-realtime test-go-realtime

# Managed Services and Web Analytics: regenerate types from ../hubfly-dashboard/openapi.json
# (or OPENAPI_PATH), then check that every operation has a TS and Go method and the types are in sync.
# A spec without analytics routes leaves the analytics types as they are.
make generate-managed
make verify-spec-managed
make verify-spec-analytics
```

---

## License

Internal & Proprietary to Hubfly Cloud Platform.

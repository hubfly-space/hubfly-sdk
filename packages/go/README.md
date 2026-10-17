# Hubfly Go SDK (`hubfly-sdk/go`)

Official Go client library for **Hubfly Cloud Platform API** (`https://api.hubfly.space`). Provides idiomatic, strongly-typed interfaces with full `context.Context` support for managing projects, containers, volumes, GPU instances, custom domains, and organizations.

---

## Installation

```bash
go get github.com/hubfly/hubfly-sdk/go
```

---

## Quick Start

```go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/hubfly/hubfly-sdk/go"
)

func main() {
	// Initialize Client (uses HUBFLY_TOKEN env variable if set)
	client := hubfly.NewClient(
		hubfly.WithToken("YOUR_API_BEARER_TOKEN"),
	)

	ctx := context.Background()

	// List Projects
	projects, err := client.Projects.List(ctx)
	if err != nil {
		log.Fatalf("Failed to list projects: %v", err)
	}

	for _, p := range projects.Data {
		fmt.Printf("Project: %s (ID: %s)\n", p.Name, p.ID)
	}
}
```

---

## Code Examples

### 1. Provisioning a Container Deployment
```go
container, err := client.Containers.Create(ctx, hubfly.CreateContainerParams{
    ProjectID: "proj_9921",
    Name:      "api-service",
    Image:     "golang:1.22-alpine",
    Ports: []hubfly.PortMapping{
        {Container: 8080, Protocol: "tcp"},
    },
    Environment: []hubfly.EnvVar{
        {Key: "ENV", Value: "production"},
    },
})
if err != nil {
    log.Fatalf("Failed to deploy container: %v", err)
}

fmt.Printf("Deployed Container ID: %s\n", container.Data.ID)
```

### 2. Custom Domain Registration & Verification
```go
domain, err := client.Domains.Create(ctx, hubfly.CreateDomainParams{
    DomainName: "api.mycompany.com",
})
if err != nil {
    log.Fatalf("Failed to register domain: %v", err)
}

// Trigger DNS verification
verifyResult, err := client.Domains.Verify(ctx, domain.Data.ID)
```

### 3. Error Handling
```go
_, err := client.Projects.Get(ctx, "invalid_id")
if err != nil {
    if apiErr, ok := err.(*hubfly.APIError); ok {
        fmt.Printf("API Error HTTP %d: %s\n", apiErr.StatusCode, apiErr.Message)
        // apiErr.Code (e.g. "MANAGED_PRICE_CHANGED"), apiErr.Details, apiErr.RequestID, apiErr.ErrorID (5xx)
    } else {
        fmt.Printf("Network or unknown error: %v\n", err)
    }
}
```

### 4. Managed Services: databases and realtime servers

`client.Managed` mirrors the TypeScript `hubfly.managed` module: `Managed` (`Catalog`, `ClientIP`,
`Pricing`, `EstimatePrice`, `Workspace`, `ListOperations`), `Managed.Instances` (lifecycle of both
services, `WaitForOperation`, metrics, logs, audit, network, alerts), `Managed.Databases` (PostgreSQL,
MySQL, libSQL) and `Managed.Realtime` (apps, keys, webhooks, `Publish`, `Send`, channels, connections,
history, insights, usage, inspector, bindings, connection details). Request and response types are
generated from the Dashboard's `openapi.json` (`managed_types.go`); each method's doc comment names the
permission it needs and says when it returns a secret.

Conventions of the generated types: JSON numbers are `float64` (the spec has no integer type);
nullable fields are pointers; optional numbers and booleans in request bodies and queries are pointers
(`nil` leaves them out, so `false` and `0` can be sent: `hubfly.Ptr(false)`, `hubfly.Float(0)`);
optional strings are left out when empty; empty, non-nil slices are sent as `[]`.

```go
ctx := context.Background()
projectID := "proj_123"
rt := client.Managed.Realtime

// Create a realtime server: quote the price from the catalog, create, wait.
catalog, err := client.Managed.Catalog(ctx)
if err != nil {
    log.Fatal(err)
}
size := catalog.Data.Realtime.Sizes[0]
created, err := client.Managed.Instances.Create(ctx, projectID, hubfly.CreateManagedInstanceBody{
    Name:              "chat",
    Service:           "realtime",
    Size:              hubfly.ManagedInstanceSizeInput{CPU: size.CPU, MemoryMib: size.MemoryMib},
    QuotedHourlyTotal: size.Price.Hourly.Total, // 409 MANAGED_PRICE_CHANGED if it moved
    IdempotencyKey:    "create-chat-1",        // reuse it when retrying
    InitialApp:        &hubfly.ManagedRealtimeInitialAppInput{Name: "production"},
})
if err != nil {
    log.Fatal(err)
}
instanceID := created.Data.Instance.ID
op, err := client.Managed.Instances.WaitForOperation(ctx, projectID, instanceID, created.Data.OperationID, nil)
if err != nil || op.Status != "succeeded" {
    log.Fatalf("create: %v %+v", err, op)
}
appID := created.Data.InitialApp.AppID

// Publish (Data is the event's data string, usually JSON) and send (realtime:publish).
_, err = rt.Publish(ctx, projectID, instanceID, appID, hubfly.PostManagedRealtimePublishBody{
    Event: "order.created", Data: `{"id":42}`, Channels: []string{"private-orders"},
})
sent, err := rt.Send(ctx, projectID, instanceID, appID, hubfly.PostManagedRealtimeSendBody{
    Event: "ping", Data: "hi", UserID: "user_1",
})
if err == nil {
    fmt.Printf("%+v\n", sent.Data.Counts) // Delivered, Buffered, Queued, Offline
}

// History (realtime:publish); feature gaps of the engine version answer 409.
_, err = rt.GetHistory(ctx, projectID, instanceID, appID, hubfly.GetManagedRealtimeHistoryQuery{
    Channel: "private-orders", Since: hubfly.Float(0),
})
if hubfly.IsAPIErrorCode(err, hubfly.ErrCodeManagedRealtimeEngineUnsupported) {
    // this server's engine version does not have the feature yet
}
```

Error codes worth branching on are the `ErrCodeManaged*` constants (`IsAPIErrorCode(err, code)`).

**Inspector socket.** `Managed.Realtime.OpenInspector` mints an inspector token (realtime:publish) and
connects to the server's `/hubfly/v1/inspect` socket (built-in WebSocket client, no dependencies),
sending the token as the first frame. When the socket is refused (4403 origin, 4429 too many
sessions) or the engine has no inspector socket, poll
`GetInspectorRecent` instead. Tested against an in-process fake only; not yet against a live
instance.

```go
session, err := client.Managed.Realtime.OpenInspector(ctx, projectID, instanceID, &hubfly.InspectorOptions{
    Filter:  &hubfly.InspectorFilter{Families: []string{"msg", "err"}},
    OnEvent: func(e hubfly.InspectorEvent) { fmt.Println(e.Seq, e.Kind, e.Fields) },
})
var refused *hubfly.InspectorCloseError // 4401 token, 4403 origin, 4408 no auth, 4429 too many sessions
if errors.As(err, &refused) {
    log.Fatal(refused.Message)
}
defer session.Close()
<-session.Done() // session.CloseInfo() says why it ended
```

**End-to-end connection ids** (`<socket_id>~<key>`): the key must never reach HubFly. `Send`,
`TerminateConnection`, `ListConnections` and `Publish` (`ExcludeSocketID`) remove it before the request
is built (`hubfly.ToSocketID` does the same), and `Send` refuses plaintext to such an id locally with
`MANAGED_REALTIME_E2E_CONNECTION_ID`. Send sealed messages from your own server with
[`github.com/hubfly/hubfly-sdk/go/realtime`](realtime/README.md).

---

## License

MIT License. Copyright (c) Hubfly Cloud Platform.

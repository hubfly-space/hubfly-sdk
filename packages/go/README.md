# Hubfly Go SDK (`hubfly-sdk/go`)

Official Go client library for **Hubfly Cloud Platform API** (`https://api.hubfly.space`). Provides idiomatic, strongly-typed interfaces with full `context.Context` support for managing projects, containers, volumes, GPU instances, custom domains, and organizations.

---

## ⚡ Installation

```bash
go get github.com/hubfly/hubfly-sdk/go
```

---

## 🚀 Quick Start

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

## 🛠️ Code Examples

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
    } else {
        fmt.Printf("Network or unknown error: %v\n", err)
    }
}
```

---

## 📄 License

MIT License. Copyright (c) Hubfly Cloud Platform.

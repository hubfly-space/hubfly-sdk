# Hubfly Multi-Language SDK (`hubfly-sdk`)

Official client SDK monorepo for the **Hubfly Cloud Platform API** (`https://api.hubfly.space`). Programmatically manage containers, workloads, GPU instances, custom domains, organizations, billing, and automated deployments.

---

## 📦 Packages

| Language | Directory | Module / Package Name | Status |
| :--- | :--- | :--- | :--- |
| **TypeScript / Node.js** | [`packages/ts`](packages/ts) | `@hubfly/sdk` | Production Ready |
| **Go** | [`packages/go`](packages/go) | `github.com/hubfly/hubfly-sdk/go` | Production Ready |

---

## ⚡ Quick Start

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

---

## 🛠️ Monorepo Commands

```bash
# Build both TypeScript and Go SDKs
make build

# Run tests across all SDKs
make test

# Build TypeScript SDK only
make build-ts

# Build Go SDK only
make build-go
```

---

## 📄 License

Internal & Proprietary to Hubfly Cloud Platform.

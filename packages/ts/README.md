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
  }
}
```

---

## License

MIT License. Copyright (c) Hubfly Cloud Platform.

import { HubflyClient, HubflyApiError } from '../src/index.js';

async function main() {
  // Initialize client with token
  const client = new HubflyClient({
    token: process.env.HUBFLY_TOKEN || 'demo_token_123',
    baseUrl: 'https://api.hubfly.space',
  });

  console.log('Initializing Hubfly Client...');

  try {
    // 1. Fetch System Health
    const health = await client.system.getHealth();
    console.log('System Health:', health.data);

    // 2. List Projects
    const projects = await client.projects.list();
    console.log('Projects Count:', projects.data.length);

    // 3. Create a Container Deployment
    if (projects.data.length > 0) {
      const projId = projects.data[0].id;
      const newContainer = await client.projects.containers.create({
        projectId: projId,
        name: 'web-api-node',
        image: 'node:18-alpine',
        ports: [{ container: 3000, protocol: 'tcp' }],
        environment: [{ key: 'NODE_ENV', value: 'production' }],
      });
      console.log('Deployed Container:', newContainer.data);
    }
  } catch (error) {
    if (error instanceof HubflyApiError) {
      console.error(`API Error [HTTP ${error.statusCode}]:`, error.message);
    } else {
      console.error('Unexpected Error:', error);
    }
  }
}

main();

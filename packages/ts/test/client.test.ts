import { describe, expect, it } from 'bun:test';
import { HubflyClient } from '../src/index.js';

describe('HubflyClient', () => {
  it('should initialize with custom options and expose all modules', () => {
    const client = new HubflyClient({
      token: 'test-token',
      baseUrl: 'http://localhost:8787',
    });

    expect(client.baseUrl).toBe('http://localhost:8787');
    expect(client.auth).toBeDefined();
    expect(client.projects).toBeDefined();
    expect(client.projects.containers).toBeDefined();
    expect(client.projects.loadBalancers).toBeDefined();
    expect(client.projects.network).toBeDefined();
    expect(client.projects.ports).toBeDefined();
    expect(client.projects.registry).toBeDefined();
    expect(client.projects.subdomains).toBeDefined();
    expect(client.projects.team).toBeDefined();
    expect(client.projects.tunnels).toBeDefined();
    expect(client.projects.volumes).toBeDefined();
    expect(client.projects.webhooks).toBeDefined();
    expect(client.projects.hibernation).toBeDefined();
    expect(client.organizations).toBeDefined();
    expect(client.domains).toBeDefined();
    expect(client.gpu).toBeDefined();
    expect(client.billing).toBeDefined();
    expect(client.system).toBeDefined();
    expect(client.regions).toBeDefined();
    expect(client.templates).toBeDefined();
  });
});

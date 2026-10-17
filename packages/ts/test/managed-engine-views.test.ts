import { describe, expect, it } from 'bun:test';
import { HubflyClient } from '../src/index.js';
import type { GetManagedRealtimeInsightsResponse, ManagedRealtimeUsageDay } from '../src/modules/managed-types.js';
// The insights and usage views as the Dashboard builds them from a real
// engine's replies (captured by hubfly-dashboard's engine-integration.test.ts
// against rt-devserver).
import fixture from './fixtures/realtime-engine-views.json';

// Every member of the generated types, and nothing else: a view field the
// types do not know (or a typed field the view lacks) fails here.
const INSIGHTS_KEYS = [
  'windowSeconds',
  'topChannels',
  'topEvents',
  'authFailures',
  'rateLimited',
  'closes',
  'connectionsPeak',
  'libraries',
  'webhooks',
] as const satisfies ReadonlyArray<keyof GetManagedRealtimeInsightsResponse>;
const USAGE_DAY_KEYS = [
  'day',
  'appId',
  'peakConnections',
  'connectionMinutes',
  'messagesIn',
  'messagesOut',
  'bytesIn',
  'bytesOut',
  'webhookDeliveries',
] as const satisfies ReadonlyArray<keyof ManagedRealtimeUsageDay>;
type Exhaustive<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const insightsListed: Exhaustive<keyof GetManagedRealtimeInsightsResponse, (typeof INSIGHTS_KEYS)[number]> = true;
const usageListed: Exhaustive<keyof ManagedRealtimeUsageDay, (typeof USAGE_DAY_KEYS)[number]> = true;

function clientWith(responses: Record<string, unknown>) {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = url.includes('/realtime/insights') ? responses.insights : responses.usage;
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return new HubflyClient({ token: 't', baseUrl: 'https://api.example.test', fetch: fetchImpl });
}

describe('realtime insights and usage from a real engine', () => {
  it('parse into the generated types', async () => {
    expect(insightsListed && usageListed).toBe(true);
    const client = clientWith(fixture);
    const { data: insights } = await client.managed.realtime.getInsights('prj_1', 'msi_1', { windowSeconds: 3600 });
    const { data: usage } = await client.managed.realtime.getUsage('prj_1', 'msi_1');
    expect(insights).toEqual(fixture.insights.data as GetManagedRealtimeInsightsResponse);
    expect(Object.keys(insights).sort()).toEqual([...INSIGHTS_KEYS].sort());
    expect(insights.topChannels.length).toBeGreaterThan(0);
    for (const channel of insights.topChannels) {
      expect(Object.keys(channel).sort()).toEqual(['bytes', 'messages', 'name', 'subscribersPeak']);
      expect(typeof channel.messages).toBe('number');
    }
    expect(Object.keys(insights.webhooks).sort()).toEqual(['backlog', 'latencyMsP95', 'successRate']);
    expect(insights.libraries[0]).toEqual({ name: expect.any(String), version: expect.any(String), count: expect.any(Number) });
    expect(Object.values(insights.closes).every((count) => typeof count === 'number')).toBe(true);

    expect(usage.days.length).toBeGreaterThan(0);
    for (const day of usage.days) {
      expect(Object.keys(day).sort()).toEqual([...USAGE_DAY_KEYS].sort());
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

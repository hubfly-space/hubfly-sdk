/**
 * Size budget of the tracker scripts (COLLECT.md §7): `core.js`, minified and gzipped, must stay
 * within 2.5 KB; the optional modules have budgets of their own so they stay small too.
 */
import { describe, expect, test } from 'bun:test';
import { buildTracker } from '../scripts/build-tracker';

const LIMITS = { core: 2560, vitals: 1024, errors: 512 } as const;

describe('tracker size', () => {
  for (const [name, limit] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    test(`${name}.js is <= ${limit} bytes min+gzip`, async () => {
      const code = await buildTracker(name);
      const gzip = Bun.gzipSync(new TextEncoder().encode(code), { level: 9 }).length;
      console.log(`${name}.js: ${code.length} B minified, ${gzip} B min+gzip (limit ${limit})`);
      expect(gzip).toBeLessThanOrEqual(limit);
    });
  }

  test('the scripts are self-contained and set no cookies', async () => {
    for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      const code = await buildTracker(name);
      expect({ name, imports: /\bimport\b|\brequire\(/.test(code), cookie: code.includes('cookie') }).toEqual({ name, imports: false, cookie: false });
    }
  });
});

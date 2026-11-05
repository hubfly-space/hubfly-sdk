/**
 * Keeps contractErrors() (test/dom.ts), which every tracker batch in the tests must pass, honest
 * against the shared collection vectors: browser batches the collector stores must pass it, and
 * the malformed ones must not. Skipped when hubfly-analytics is not checked out next to hubfly-sdk.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractErrors } from './dom';

const CASES = join(import.meta.dir, '..', '..', '..', '..', 'hubfly-analytics', 'testdata', 'collect', 'cases.json');
const MALFORMED = new Set(['too many props makes the event malformed', 'more than 20 events drops the batch', 'body over 16 KiB is refused']);

describe.skipIf(!existsSync(CASES))('collect vectors', () => {
  const doc = JSON.parse(existsSync(CASES) ? readFileSync(CASES, 'utf8') : '{"cases":[]}');
  const browser = doc.cases.filter((c: any) => c.body && typeof c.body === 'object' && Array.isArray(c.body.e));

  test('stored browser batches pass the tracker contract check', () => {
    const stored = browser.filter((c: any) => c.expect.stored.length > 0);
    expect(stored.length).toBeGreaterThan(5);
    for (const c of stored) expect({ name: c.name, errors: contractErrors(JSON.stringify(c.body)) }).toEqual({ name: c.name, errors: [] });
  });

  test('malformed batches fail it', () => {
    for (const c of browser.filter((c: any) => MALFORMED.has(c.name))) expect({ name: c.name, failed: contractErrors(JSON.stringify(c.body)).length > 0 }).toEqual({ name: c.name, failed: true });
  });
});

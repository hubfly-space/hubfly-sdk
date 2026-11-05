/**
 * Size budgets, minified and gzipped: the player core at most 12 KB without hls.js (which it
 * imports lazily), the publisher at most 6 KB. Neither browser entry may carry server code.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const PLAYER_LIMIT = 12 * 1024;
const PUBLISH_LIMIT = 6 * 1024;
// Literals that only exist in the server entry.
const SERVER_MARKERS = ['Playback token refused', 'HMAC'];
const root = join(import.meta.dir, '..');

async function bundle(entry: string, external: string[] = []) {
  const res = await Bun.build({ entrypoints: [join(root, entry)], minify: true, format: 'esm', target: 'browser', external });
  if (!res.success) throw new AggregateError(res.logs, 'build failed');
  const code = await res.outputs[0].text();
  return { code, min: code.length, gzip: Bun.gzipSync(new TextEncoder().encode(code), { level: 9 }).length };
}

describe('bundle size', () => {
  test(`player is <= ${PLAYER_LIMIT} bytes min+gzip and loads hls.js lazily`, async () => {
    const player = await bundle('src/player.ts', ['hls.js']);
    console.log(`player: ${player.min} B minified, ${player.gzip} B min+gzip (limit ${PLAYER_LIMIT})`);
    expect(player.gzip).toBeLessThanOrEqual(PLAYER_LIMIT);
    expect(player.code).toContain('import("hls.js")');
    expect(player.code).not.toMatch(/^import .*hls\.js/m);
    for (const marker of SERVER_MARKERS) expect({ marker, found: player.code.includes(marker) }).toEqual({ marker, found: false });
  });

  test(`publish is <= ${PUBLISH_LIMIT} bytes min+gzip`, async () => {
    const publish = await bundle('src/publish.ts');
    console.log(`publish: ${publish.min} B minified, ${publish.gzip} B min+gzip (limit ${PUBLISH_LIMIT})`);
    expect(publish.gzip).toBeLessThanOrEqual(PUBLISH_LIMIT);
    for (const marker of SERVER_MARKERS) expect({ marker, found: publish.code.includes(marker) }).toEqual({ marker, found: false });
  });

  test('reference sizes of the other entries', async () => {
    const index = await bundle('src/index.ts');
    const server = await bundle('src/server.ts');
    console.log(`index: ${index.gzip} B min+gzip; server: ${server.gzip} B min+gzip`);
  });
});

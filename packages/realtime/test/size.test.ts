/**
 * Size budget of the client core: the `.` entry, minified and gzipped, must stay within 8 KB,
 * and must not contain E2E code (it is loaded from `@hubfly/realtime/e2e` only when enabled).
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const LIMIT = 8 * 1024;
// String literals of the E2E code: salsa20 sigma, a SHA-256 round constant, noble's tag error,
// envelope reasons and the sealed user_info event name.
const E2E_MARKERS = ['expand 32-byte k', '1116352408', 'invalid tag', 'missing_members', 'wrong_envelope', 'presence.user_info'];
const root = join(import.meta.dir, '..');

async function bundle(entry: string, external: string[] = []) {
  const res = await Bun.build({ entrypoints: [join(root, entry)], minify: true, format: 'esm', target: 'browser', external });
  if (!res.success) throw new AggregateError(res.logs, 'build failed');
  const code = await res.outputs[0].text();
  return { code, min: code.length, gzip: Bun.gzipSync(new TextEncoder().encode(code), { level: 9 }).length };
}

describe('bundle size', () => {
  test(`client core is <= ${LIMIT} bytes min+gzip and E2E-free`, async () => {
    const core = await bundle('src/index.ts', ['@hubfly/realtime/e2e']);
    console.log(`client core: ${core.min} B minified, ${core.gzip} B min+gzip (limit ${LIMIT})`);
    expect(core.gzip).toBeLessThanOrEqual(LIMIT);
    // E2E arrives through a lazy import of the package's own ./e2e entry ...
    expect(core.code).toContain('import("@hubfly/realtime/e2e")');
    // ... so no cipher, hash or envelope code is in the core (literals survive minification).
    for (const marker of E2E_MARKERS) {
      expect({ marker, found: core.code.includes(marker) }).toEqual({ marker, found: false });
    }
  });

  test('reference sizes of the other entries', async () => {
    const e2e = await bundle('src/e2e/index.ts');
    const server = await bundle('src/server/index.ts');
    console.log(`e2e (with @noble): ${e2e.gzip} B min+gzip; server (with @noble): ${server.gzip} B min+gzip`);
    for (const marker of E2E_MARKERS) {
      expect({ marker, found: e2e.code.includes(marker) }).toEqual({ marker, found: true });
    }
  });
});

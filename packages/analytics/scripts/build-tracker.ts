/**
 * Builds the browser tracker scripts the collector serves (hubfly-analytics/docs/COLLECT.md §7):
 * dist/tracker/{core,vitals,errors}.js, minified IIFEs, plus manifest.json
 * `{"version", "files": {"core.js": "<sha256 hex>", …}}`. hubfly-analytics copies these files
 * byte for byte (`make tracker-sync`) and checks them against the manifest.
 *
 *   bun scripts/build-tracker.ts [outDir]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../src/version';

export const TRACKER_FILES = ['core', 'vitals', 'errors'] as const;

const root = join(import.meta.dir, '..');

/** Minified source of one tracker script (also used by the tests and the size budget). */
export async function buildTracker(name: (typeof TRACKER_FILES)[number]): Promise<string> {
  const res = await Bun.build({
    entrypoints: [join(root, 'src', 'tracker', `${name}.ts`)],
    minify: true,
    format: 'iife',
    target: 'browser',
  });
  if (!res.success) throw new AggregateError(res.logs, `build of ${name}.js failed`);
  // One trailing newline: the collector concatenates core.js, vitals.js and errors.js.
  return (await res.outputs[0].text()).trim() + '\n';
}

export async function buildAll(outDir = join(root, 'dist', 'tracker')) {
  mkdirSync(outDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const name of TRACKER_FILES) {
    const code = await buildTracker(name);
    writeFileSync(join(outDir, `${name}.js`), code);
    files[`${name}.js`] = createHash('sha256').update(code).digest('hex');
  }
  const manifest = { version: VERSION, files };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (import.meta.main) {
  const out = await buildAll(process.argv[2]);
  console.log(JSON.stringify(out, null, 2));
}

/**
 * Smoke tests of the built package (`bun run build` first; skipped without dist/): the ESM and
 * CJS entries load in Node, and dist/tracker/ matches the current sources and its manifest.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTracker, TRACKER_FILES } from '../scripts/build-tracker';
import { VERSION } from '../src/version';

const root = join(import.meta.dir, '..');
const built = existsSync(join(root, 'dist', 'index.js')) && existsSync(join(root, 'dist', 'tracker', 'manifest.json'));
const node = spawnSync('node', ['--version']).status === 0;

function run(args: string[]) {
  const r = spawnSync('node', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`node ${args[0]} failed:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!);
}

const probe = `
const out = { version: idx.VERSION, inject: typeof idx.inject, track: typeof idx.track, server: typeof srv.AnalyticsServer,
  vue: typeof vue.analytics, svelte: typeof svelte.injectAnalytics };
idx.track('noop'); idx.inject({ site: 'hfa_abcdefghijklmnop' });
console.log(JSON.stringify(out));`;
const expected = { version: VERSION, inject: 'function', track: 'function', server: 'function', vue: 'function', svelte: 'function' };

describe.skipIf(!built)('dist', () => {
  test.skipIf(!node)('ESM entries load in Node and are no-ops there', () => {
    const out = run([
      '--input-type=module',
      '-e',
      `import * as idx from '@hubfly/analytics'; import * as srv from '@hubfly/analytics/server';
import * as vue from '@hubfly/analytics/vue'; import * as svelte from '@hubfly/analytics/svelte';${probe}`,
    ]);
    expect(out).toEqual(expected);
  });

  test.skipIf(!node)('CJS entries load in Node', () => {
    const out = run([
      '-e',
      `const idx = require('@hubfly/analytics'), srv = require('@hubfly/analytics/server'),
vue = require('@hubfly/analytics/vue'), svelte = require('@hubfly/analytics/svelte');${probe}`,
    ]);
    expect(out).toEqual(expected);
  });

  test('react and next entries are client modules', () => {
    for (const f of ['react.js', 'react.cjs', 'next.js', 'next.cjs']) expect(readFileSync(join(root, 'dist', f), 'utf8').startsWith("'use client';")).toBe(true);
  });

  test('dist/tracker is current and matches its manifest', async () => {
    const manifest = JSON.parse(readFileSync(join(root, 'dist', 'tracker', 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(VERSION);
    expect(Object.keys(manifest.files)).toEqual(TRACKER_FILES.map((n) => `${n}.js`));
    for (const name of TRACKER_FILES) {
      const file = readFileSync(join(root, 'dist', 'tracker', `${name}.js`));
      expect({ name, sha: createHash('sha256').update(file).digest('hex') }).toEqual({ name, sha: manifest.files[`${name}.js`] });
      expect({ name, current: file.toString('utf8') === (await buildTracker(name)) }).toEqual({ name, current: true });
    }
  });
});

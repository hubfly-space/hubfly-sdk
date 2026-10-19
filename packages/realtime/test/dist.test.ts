/**
 * Smoke tests of the built package (`bun run build` first; skipped without dist/): the ESM and
 * CJS entries load in Node, the client's lazy `import('@hubfly/realtime/e2e')` resolves through
 * the package's own exports from both formats, and node16 TypeScript consumers type-check
 * against the emitted .d.ts/.d.cts.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const built = existsSync(join(root, 'dist', 'index.js')) && existsSync(join(root, 'dist', 'index.cjs'));
const node = spawnSync('node', ['--version']).status === 0;

function run(args: string[]) {
  const r = spawnSync('node', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`node ${args[0]} failed:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!);
}

const body = (load: string) => `
${load}
const rt = new Realtime({ url: 'https://x.invalid', key: 'k', e2e: true });
await rt._loadE2E();
const ck = rt._e2e.newKey();
const server = new RealtimeServer({ url: 'https://x.invalid', appId: '1', key: 'k', secret: 's', encryptionKeys: e2e.toBase64(new Uint8Array(32).fill(7)) });
const a = await server.authorizeChannel('1.2', 'private-encrypted-x');
const engine = e2e.createClientE2E();
engine.keys('private-encrypted-x', a.hubfly.keys, a.shared_secret);
const env = e2e.encryptPusher(e2e.fromBase64(a.shared_secret), { ok: true });
console.log(JSON.stringify({ version: VERSION, keyLen: e2e.fromBase64Url(ck).length, opened: engine.open('private-encrypted-x', 'e', env)[1] }));
`;

describe.skipIf(!built || !node)('dist', () => {
  test('ESM entries work in Node, including the lazy e2e import', () => {
    const out = run([
      '--input-type=module',
      '-e',
      body(`import { Realtime, VERSION } from '@hubfly/realtime';
import { RealtimeServer } from '@hubfly/realtime/server';
import * as e2e from '@hubfly/realtime/e2e';`),
    ]);
    expect(out).toEqual({ version: '0.1.2', keyLen: 32, opened: { ok: true } });
  });

  test('CJS entries work in Node, including the lazy e2e import', () => {
    const out = run([
      '-e',
      `(async () => {${body(`const { Realtime, VERSION } = require('@hubfly/realtime');
const { RealtimeServer } = require('@hubfly/realtime/server');
const e2e = require('@hubfly/realtime/e2e');`)}})().catch((e) => { console.error(e); process.exit(1); });`,
    ]);
    expect(out).toEqual({ version: '0.1.2', keyLen: 32, opened: { ok: true } });
  });

  test('declarations type-check for node16 ESM and CJS consumers', () => {
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    const r = spawnSync(tsc, ['-p', join(import.meta.dir, 'consumer', 'tsconfig.json')], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

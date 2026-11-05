/**
 * Smoke tests of the built package (`bun run build` first; skipped without dist/): the ESM and
 * CJS entries load in Node (the player entry is safe without a DOM), the server entry signs and
 * verifies a vector token, and node16 TypeScript consumers type-check against the emitted
 * .d.ts/.d.cts.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import playback from './vectors/playback.json';

const root = join(import.meta.dir, '..');
const built = ['index', 'player', 'publish', 'server'].every(
  (e) => existsSync(join(root, 'dist', `${e}.js`)) && existsSync(join(root, 'dist', `${e}.cjs`)),
);
const node = spawnSync('node', ['--version']).status === 0;
const vector = playback.cases.find((c) => c.name === 'valid for one channel')!;
const key = playback.keys[0];

function run(args: string[]) {
  const r = spawnSync('node', args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error(`node ${args[0]} failed:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!);
}

const body = (load: string) => `
${load}
const token = await server.signPlaybackToken(${JSON.stringify({ id: key.id, secret: key.secret })}, ${JSON.stringify(vector.claims)});
const claims = await server.verifyPlaybackToken(token, ${JSON.stringify(playback.keys)}, { channel: ${JSON.stringify(vector.channel)}, now: ${playback.now} });
console.log(JSON.stringify({
  version: streams.VERSION,
  hls: streams.playbackURLs('acme-tv.live.hubfly.app', 'sch_main0001').hls,
  player: typeof player.createPlayer,
  publish: typeof pub.publish,
  same: token === ${JSON.stringify(vector.token)},
  ch: claims.ch,
}));
`;

const expected = {
  version: '0.1.0',
  hls: 'https://acme-tv.live.hubfly.app/hls/sch_main0001/index.m3u8',
  player: 'function',
  publish: 'function',
  same: true,
  ch: 'sch_main0001',
};

describe.skipIf(!built || !node)('dist', () => {
  test('ESM entries work in Node', () => {
    const out = run([
      '--input-type=module',
      '-e',
      body(`import * as streams from '@hubfly/streams';
import * as player from '@hubfly/streams/player';
import * as pub from '@hubfly/streams/publish';
import * as server from '@hubfly/streams/server';`),
    ]);
    expect(out).toEqual(expected);
  });

  test('CJS entries work in Node', () => {
    const out = run([
      '-e',
      `(async () => {${body(`const streams = require('@hubfly/streams');
const player = require('@hubfly/streams/player');
const pub = require('@hubfly/streams/publish');
const server = require('@hubfly/streams/server');`)}})().catch((e) => { console.error(e); process.exit(1); });`,
    ]);
    expect(out).toEqual(expected);
  });

  test('declarations type-check for node16 ESM and CJS consumers', () => {
    const tsc = join(root, 'node_modules', '.bin', 'tsc');
    const r = spawnSync(tsc, ['-p', join(import.meta.dir, 'consumer', 'tsconfig.json')], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

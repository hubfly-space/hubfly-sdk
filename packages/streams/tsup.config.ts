import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    player: 'src/player.ts',
    publish: 'src/publish.ts',
    server: 'src/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // hls.js is an optional peer dependency, imported by the player only when LL-HLS needs it.
  external: ['hls.js'],
});

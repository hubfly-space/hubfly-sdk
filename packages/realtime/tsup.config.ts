import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server/index.ts',
    e2e: 'src/e2e/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // The client loads E2E code lazily from the package's own ./e2e entry (never bundled into
  // the core). tsconfig "paths" maps it to the source for tests and typechecking only.
  external: ['@hubfly/realtime/e2e'],
});

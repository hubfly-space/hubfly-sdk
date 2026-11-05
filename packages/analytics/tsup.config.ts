import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  splitting: false,
  sourcemap: true,
  target: 'es2020' as const,
  external: ['react'],
};

// `bun run build` empties dist/ first. The browser tracker scripts (dist/tracker/) are built by
// scripts/build-tracker.ts.
export default defineConfig([
  {
    ...shared,
    entry: { index: 'src/index.ts', vue: 'src/vue.ts', svelte: 'src/svelte.ts', server: 'src/server.ts' },
  },
  {
    ...shared,
    // React Server Components: the component must be a client module.
    entry: { react: 'src/react.ts', next: 'src/next.ts' },
    banner: { js: "'use client';" },
  },
]);

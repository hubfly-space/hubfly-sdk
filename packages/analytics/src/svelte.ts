/**
 * `@hubfly/analytics/svelte`: call `injectAnalytics({ site: 'hfa_…' })` once from the root
 * `+layout.svelte` (SvelteKit) or `main.ts`. It does nothing during server rendering.
 */
import { inject, type InjectOptions } from './index';

export * from './index';

export function injectAnalytics(options: InjectOptions): void {
  inject(options);
}

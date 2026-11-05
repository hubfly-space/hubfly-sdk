/**
 * `@hubfly/analytics/vue`: a Vue 3 plugin, `app.use(analytics({ site: 'hfa_…' }))`. In Nuxt, install
 * it from a client-only plugin. Route changes are counted by the tracker through the History API.
 */
import { inject, type InjectOptions } from './index';

export * from './index';

export function analytics(options: InjectOptions): { install(app?: unknown): void } {
  return {
    install() {
      inject(options);
    },
  };
}

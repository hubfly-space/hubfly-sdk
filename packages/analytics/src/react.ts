/**
 * `@hubfly/analytics/react`: `<Analytics site="hfa_…" />` for React apps. Render it once, near the
 * root; it adds the tracker script after hydration and renders nothing.
 */
import { useEffect } from 'react';
import { inject, type InjectOptions } from './index';

export * from './index';

export type AnalyticsProps = InjectOptions;

export function Analytics(props: AnalyticsProps): null {
  useEffect(() => {
    inject(props);
  }, [props.site, props.host, props.src]);
  return null;
}

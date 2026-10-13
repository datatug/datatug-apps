import type { IEnvironmentConfig } from '@sneat/core';
import {
  resolveProductProfileId,
  type ResolveProductProfileInput,
} from '@datatug/product-profiles';

/** DataTug uses its dedicated GA4 and PostHog in production; the shared
 * Sneat Firebase Analytics measurementId is stripped so events are not sent to Sneat.
 * Firebase identity, Firestore and Sentry diagnostics keep their existing config.
 */
export function withoutDataTugTracking(
  config: IEnvironmentConfig,
  profile: ResolveProductProfileInput,
): IEnvironmentConfig {
  if (resolveProductProfileId(profile) !== 'datatug') return config;
  return {
    ...config,
    firebaseConfig: { ...config.firebaseConfig, measurementId: undefined },
  };
}

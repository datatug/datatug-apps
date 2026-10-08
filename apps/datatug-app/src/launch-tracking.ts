import type { IEnvironmentConfig } from '@sneat/core';
import {
  resolveProductProfileId,
  type ResolveProductProfileInput,
} from '@datatug/product-profiles';

/** Launch prerequisite: optional analytics are off for DataTug, on every route.
 * Firebase identity, Firestore and Sentry diagnostics keep their existing config.
 * Re-enabling requires a reviewed privacy/consent decision, not a URL switch.
 */
export function withoutDataTugTracking(
  config: IEnvironmentConfig,
  profile: ResolveProductProfileInput,
): IEnvironmentConfig {
  if (resolveProductProfileId(profile) !== 'datatug') return config;
  return {
    ...config,
    posthog: undefined,
    googleAnalytics: undefined,
    firebaseConfig: { ...config.firebaseConfig, measurementId: undefined },
  };
}

import type { IEnvironmentConfig } from '@sneat/core';
import {
  resolveProductProfileId,
  type ResolveProductProfileInput,
} from '@datatug/product-profiles';

/** Optional analytics are off for DataTug, on every route: PostHog and Firebase Analytics stay off, and the shared
 * Sneat GA property (G-TYBDTV738R) is never used for DataTug.
 * Firebase identity, Firestore and Sentry diagnostics keep their existing config.
 * The one analytics DataTug has is Google Analytics on its own property, and it does not run from this config: it
 * starts only after the visitor accepts the analytics banner (app/analytics-consent, 2026-10-19 founder decision).
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

/** The DataTug GA4 measurement id for the consent banner; undefined for any other product profile. */
export function dataTugGoogleAnalyticsId(
  measurementId: string | undefined,
  profile: ResolveProductProfileInput,
): string | undefined {
  return resolveProductProfileId(profile) === 'datatug'
    ? measurementId
    : undefined;
}

import type { IEnvironmentConfig } from '@sneat/core';
import {
  resolveProductProfileId,
  type ResolveProductProfileInput,
} from '@datatug/product-profiles';

/** The shared Sneat analytics are off for DataTug, on every route: the shared sneat.app PostHog project, Firebase
 * Analytics and the shared Sneat GA property (G-TYBDTV738R) are never used for DataTug. DataTug's own anonymous
 * usage PostHog (environment `datatugUsagePosthog`, main.ts) replaces the first, behind consent.
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

/** Whether this document runs the DataTug product profile (datatug.app), the only one with the consent banner. */
export function isDataTugProfile(profile: ResolveProductProfileInput): boolean {
  return resolveProductProfileId(profile) === 'datatug';
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

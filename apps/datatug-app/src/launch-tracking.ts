import type { IEnvironmentConfig, IPosthogSettings } from '@sneat/core';
import { anonymousUsagePosthog } from './app/telemetry/usage-privacy';
import { USAGE_ANALYTICS_CONSENT_KEY } from './app/analytics-consent/analytics-consent';
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

/**
 * Every profile's analytics under the same constraints (public-demo REQ:demo-usage-analytics; founder 2026-10-22 "Fix
 * incidentius"): no shared Sneat GA or Firebase Analytics, and PostHog only as anonymous usage analytics behind
 * consent. DataTug uses its own project (`dataTugPosthog`, off until configured); any other profile (Incidentius)
 * keeps its configured PostHog key, which is still the project shared with sneat.app.
 */
export function withAnonymousUsageTracking(
  config: IEnvironmentConfig,
  profile: ResolveProductProfileInput,
  dataTugPosthog: IPosthogSettings | undefined,
): IEnvironmentConfig {
  return {
    ...config,
    googleAnalytics: undefined,
    firebaseConfig: { ...config.firebaseConfig, measurementId: undefined },
    posthog: anonymousUsagePosthog(
      isDataTugProfile(profile) ? dataTugPosthog : config.posthog,
    ),
  };
}

/**
 * The storage key of the usage-analytics consent. DataTug's (datatug.app) is apart from the landing site's Google
 * Analytics key; every other profile has its own, named after it (`incidentius.usage-analytics-consent.v1` on
 * app.incidentius.com, another origin, whose banner names PostHog only).
 */
export function usageConsentKey(profile: ResolveProductProfileInput): string {
  const id = resolveProductProfileId(profile);
  return id === 'datatug'
    ? USAGE_ANALYTICS_CONSENT_KEY
    : `${id}.usage-analytics-consent.v1`;
}

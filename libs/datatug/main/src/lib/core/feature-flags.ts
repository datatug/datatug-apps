import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { EnvConfigToken, IEnvironmentConfig } from '@sneat/core';

/**
 * Phase 0 feature flag (single, shared by all six pages — see
 * `spec/research/2026-09-09-web-ui-audit.md` "UI without real backing"):
 * Widgets, Tags, Resources, Variables, DB models (list + detail), and Diff
 * are routed pages that render a header over an empty `<ion-content>` —
 * nothing signals to a user that they are unfinished before clicking in.
 *
 * Defaults to `false` (hidden): their routes are left out of the `Routes`
 * arrays entirely and their menu entries are omitted, so there is nothing to
 * click into. Flip to `true` locally to work on one of them.
 */
export const ENABLE_EMPTY_SHELL_PAGES = false;

/**
 * Hosted Google Cloud Logging is available only in local or pilot builds until
 * the cloud API host is deployed. Enable deliberately for those builds.
 */
export function hostedCloudLogsEnabled(): boolean {
  const environment = inject(EnvConfigToken) as IEnvironmentConfig & {
    hostedCloudLogsEnabled?: boolean;
  };
  return environment.hostedCloudLogsEnabled === true;
}

export const hostedCloudLogsFeatureGuard: CanMatchFn = () =>
  hostedCloudLogsEnabled();

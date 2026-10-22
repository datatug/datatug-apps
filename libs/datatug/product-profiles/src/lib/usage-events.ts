// The closed list of anonymous product-usage events (datatug/backstage spec/features/public-demo
// REQ:demo-usage-analytics). Eager-safe on purpose: the app's PostHog `before_send` drops every event that is not
// named here, and `@sneat/datatug-main` (route-lazy) records them through USAGE_EVENT_SINK.

import { InjectionToken } from '@angular/core';

/**
 * Every usage event any DataTug surface may send, and nothing else. Each event has a fixed set of parameter keys
 * whose values are closed words (`project` is only `demo` or `other`) or identifiers the public demo declares; none
 * carries a user or account id, a repository or account name, query text, a result value, a record key or a path.
 */
export const USAGE_EVENT_NAMES = [
  // Emitted today.
  /** The visitor chose "Accept analytics". No parameters. */
  'analytics_consent_given',
  /** A page of an act was shown: `page` (closed page kind), `project` (`demo` | `other`). */
  'act_page_viewed',
  /** A parameter value was picked with the lookup: `project`. */
  'parameter_lookup_used',
  /** A query run ended: `outcome` (`rows` | `empty` | `error` | `cancelled`), `project`. */
  'query_run_finished',
  /** An evidence link was copied: `kind` (`execution` | `check-run`), `project`. */
  'evidence_link_copied',
  /** An evidence link was opened: `access` (`open` | `sign-in` | `invalid`), `project`. */
  'evidence_link_opened',
  /** The visitor was asked to sign in: `reason` (`evidence-link` | `walkthrough`). */
  'signin_prompted',
  /** A sign-in that followed a prompt in the same tab: `reason`. */
  'signin_completed',
  /** A verified source reset. No parameters. */
  'source_reset',
  // Defined now, emitted by the features that do not exist yet.
  /** Public-demo plan Task 6 (stable act deep links, next-act exits): `act` (`1`…`9`), `project`. */
  'act_entered',
  'act_completed',
  /** Public-demo plan Task 8 (learning wizard chapters): walkthrough, chapter and step ids of the public demo. */
  'walkthrough_chapter_entered',
  'walkthrough_chapter_completed',
  'walkthrough_step_entered',
  'walkthrough_step_completed',
  'walkthrough_signin_prompted',
  'walkthrough_signin_completed',
  'walkthrough_reset',
  /** Public-demo plan Task 14 (CLI on-ramp). */
  'cli_hint_shown',
  'cli_hint_dismissed',
  'cli_install_copied',
  'clone_completed',
  'local_server_connected',
] as const;

export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

export type UsageEventParams = Readonly<Record<string, string>>;

const NAMES: ReadonlySet<string> = new Set(USAGE_EVENT_NAMES);

/** Whether name is on the closed list. */
export function isUsageEventName(name: unknown): name is UsageEventName {
  return typeof name === 'string' && NAMES.has(name);
}

/** Where usage events go. The app provides it where a consented, anonymous backend exists; else nowhere. */
export interface UsageEventSink {
  send(name: UsageEventName, params: UsageEventParams): void;
}

export const NOOP_USAGE_EVENT_SINK: UsageEventSink = { send: () => undefined };

export const USAGE_EVENT_SINK = new InjectionToken<UsageEventSink>(
  'USAGE_EVENT_SINK',
  { providedIn: 'root', factory: () => NOOP_USAGE_EVENT_SINK },
);

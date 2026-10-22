import { isUsageEventName } from '@datatug/product-profiles';
import type { IPosthogSettings } from '@sneat/core';

/**
 * public-demo REQ:demo-usage-analytics: anonymous usage events "carry no personal data, account or repository names,
 * query text, result values or local paths, are never linked to a signed-in identity". This is the one PostHog policy
 * for DataTug: every `posthog.init` (register-posthog.ts and Sneat's DeferredPosthogAnalyticsService alike) gets these
 * settings, so no init path can skip the scrubber.
 */

/** Path segments that name a page kind, never data; every other segment becomes `:id`. */
const ROUTE_WORDS: ReadonlySet<string> = new Set([
  'agent',
  'board',
  'boards',
  'business',
  'card',
  'cards',
  'cases',
  'chat',
  'checkout',
  'checks',
  'cloud-logs',
  'data',
  'db',
  'dbmodel',
  'dbmodels',
  'demo',
  'demo-db-sandbox',
  'detective',
  'entities',
  'entity',
  'env',
  'environments',
  'explore',
  'github.com',
  'home',
  'incidents',
  'login',
  'logs',
  'meanings',
  'models',
  'new',
  'new-project',
  'pricing',
  'project',
  'public-data',
  'queries',
  'query',
  'quick-search',
  'record',
  'records',
  'result',
  'search-schema',
  'servers',
  'sessions',
  'shipping',
  'sign-in',
  'signed-out',
  'source',
  'sources',
  'space',
  'spaces',
  'sqlite',
  'store',
  'subscribe',
  'table',
  'tables',
  'tags',
  'tree',
  'view',
  'widgets',
  '-',
]);

/**
 * A path as usage analytics may see it: no query, no fragment; a GitHub project's owner and repository become
 * `:owner/:repo`, and every segment that is not a page kind becomes `:id` (store, project, database, table, query and
 * record ids, branch and folder names alike).
 */
export function scrubUsagePath(path: string): string {
  const bare = path.split(/[?#]/u)[0];
  const segments = bare.split('/');
  return segments
    .map((segment, index) => {
      if (index === 0 || segment === '') return segment;
      if (segments[index - 1] === 'github.com') return ':owner';
      if (segments[index - 2] === 'github.com') return ':repo';
      return ROUTE_WORDS.has(segment) ? segment : ':id';
    })
    .join('/');
}

const ABSOLUTE = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)(.*)$/iu;

/** An address as usage analytics may see it: its origin and {@link scrubUsagePath}; any other text unchanged. */
export function scrubUsageValue(value: string): string {
  const absolute = ABSOLUTE.exec(value);
  if (absolute) return absolute[1] + scrubUsagePath(absolute[2] || '/');
  return value.startsWith('/') ? scrubUsagePath(value) : value;
}

/** PostHog events allowed besides the closed usage list: the scrubbed page view only. */
const POSTHOG_EVENTS: ReadonlySet<string> = new Set(['$pageview']);

/**
 * The only event properties that leave the browser: the closed usage parameters and a fixed set of PostHog's own
 * technical properties. Everything else is dropped, so a new SDK default (campaign and click ids, referrers, initial
 * person data, element text, titles) can never pass by default.
 */
const ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
  // Usage parameters (USAGE_EVENT_NAMES) and Sneat's scrubbed `$pageview` path.
  'page',
  'project',
  'outcome',
  'kind',
  'access',
  'reason',
  'act',
  'walkthrough_id',
  'walkthrough_version',
  'mode',
  'chapter_id',
  'step_id',
  'requirement',
  'page_path',
  // PostHog technical properties: delivery, the anonymous browser id, and coarse device facts.
  'token',
  'distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$insert_id',
  '$time',
  '$lib',
  '$lib_version',
  '$process_person_profile',
  '$is_identified',
  '$pageview_id',
  '$current_url',
  '$host',
  '$pathname',
  '$browser',
  '$browser_version',
  '$os',
  '$os_version',
  '$device_type',
  '$screen_height',
  '$screen_width',
  '$viewport_height',
  '$viewport_width',
  '$browser_language',
  '$timezone',
]);

/** The only top-level keys of an event that leave the browser. */
const ALLOWED_EVENT_KEYS: ReadonlySet<string> = new Set([
  'uuid',
  'event',
  'properties',
  'timestamp',
]);

const MAX_DEPTH = 10;

function scrubValues(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubUsageValue(value);
  if (!value || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value))
    return value.map((item) => scrubValues(item, depth + 1));
  // A timestamp or another class instance is no address container.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>))
    out[key] = scrubValues(item, depth + 1);
  return out;
}

type PosthogEvent = {
  event: string;
  properties?: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Every PostHog event of DataTug: only `$pageview` and the closed usage list leave the browser (`$identify`,
 * `$create_alias`, `$set`, `$groupidentify`, autocapture, recordings and every other event are dropped), only
 * allowlisted properties stay (ALLOWED_PROPERTIES), and every address in them loses its query, fragment and ids.
 */
export function scrubUsagePosthogEvent<T extends PosthogEvent | null>(
  event: T,
): T | null {
  if (!event) return event;
  if (!POSTHOG_EVENTS.has(event.event) && !isUsageEventName(event.event))
    return null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event))
    if (ALLOWED_EVENT_KEYS.has(key)) kept[key] = value;
  if (event.properties) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.properties))
      if (ALLOWED_PROPERTIES.has(key)) properties[key] = value;
    kept['properties'] = properties;
  }
  return scrubValues(kept) as T & PosthogEvent;
}

/**
 * The DataTug PostHog settings: anonymous (`person_profiles: 'never'`; the app never identifies), no autocapture, no
 * session recording, no automatic page view or page leave, no surveys or feature flags, and the usage scrubber as the
 * last `before_send` step. Undefined stays undefined: no key, no PostHog.
 */
export function anonymousUsagePosthog(
  settings: IPosthogSettings | undefined,
): IPosthogSettings | undefined {
  if (!settings?.token) return undefined;
  const before = settings.config?.before_send;
  return {
    ...settings,
    config: {
      ...settings.config,
      person_profiles: 'never',
      // No utm_*, click ids (gclid, fbclid, msclkid…) or referrer as super-properties; mask personal URL params.
      save_campaign_params: false,
      save_referrer: false,
      mask_personal_data_properties: true,
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      capture_pageleave: false,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      before_send: (event) => {
        let next: typeof event | null = event;
        if (typeof before === 'function') next = before(next);
        else if (Array.isArray(before))
          for (const transform of before) {
            if (!next) break;
            next = transform(next);
          }
        return next
          ? (scrubUsagePosthogEvent(
              next as unknown as PosthogEvent,
            ) as unknown as typeof event)
          : null;
      },
    },
  };
}

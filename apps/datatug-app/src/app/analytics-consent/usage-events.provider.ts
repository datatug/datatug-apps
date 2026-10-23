import {
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { DEMO_PROJECT_REF, parseProjectUrl } from '@datatug/project-address';
import {
  USAGE_EVENT_SINK,
  type UsageEventSink,
} from '@datatug/product-profiles';
import { AnalyticsService } from '@sneat/core';
import { ANALYTICS_CONSENT } from './analytics-consent.token';

/** The page kinds an act of the public demo is made of; any other page is not reported. */
export type ActPageKind =
  | 'query'
  | 'table'
  | 'board'
  | 'logs'
  | 'public-data'
  | 'incidents'
  | 'cases'
  | 'meanings'
  | 'checks';

const PAGE_WORDS: readonly [string, ActPageKind][] = [
  ['query', 'query'],
  ['queries', 'query'],
  ['table', 'table'],
  ['view', 'table'],
  ['records', 'table'],
  ['record', 'table'],
  ['board', 'board'],
  ['boards', 'board'],
  ['logs', 'logs'],
  ['cloud-logs', 'logs'],
  ['public-data', 'public-data'],
  ['incidents', 'incidents'],
  ['cases', 'cases'],
  ['meanings', 'meanings'],
  ['checks', 'checks'],
];
const PAGE_KIND = new Map(PAGE_WORDS);

/**
 * The act page a path shows and whether it is the public demo: `undefined` for any other page. Only closed words
 * come out of it, never a segment of the path.
 */
export function actPageOf(
  path: string,
): { page: ActPageKind; project: 'demo' | 'other' } | undefined {
  const bare = path.split(/[?#]/u)[0];
  let project: 'demo' | 'other';
  let rest: string;
  if (bare === '/demo' || bare.startsWith('/demo/')) {
    project = 'demo';
    rest = bare.slice('/demo'.length);
  } else {
    const parsed = parseProjectUrl(bare);
    if (!parsed.ok) return undefined;
    project =
      parsed.storeId === DEMO_PROJECT_REF.storeId &&
      parsed.projectId === DEMO_PROJECT_REF.projectId &&
      !parsed.spaceID
        ? 'demo'
        : 'other';
    rest = parsed.rest;
  }
  for (const segment of rest.split('/')) {
    const page = PAGE_KIND.get(segment);
    if (page) return { page, project };
  }
  return undefined;
}

/** USAGE_EVENT_SINK over the app's consent-gated, anonymous `AnalyticsService`. */
export function analyticsUsageSink(): UsageEventSink {
  const analytics = inject(AnalyticsService);
  return { send: (name, params) => analytics.logEvent(name, params) };
}

/**
 * DataTug's usage events (public-demo REQ:demo-usage-analytics): the sink the product features record through, an
 * `act_page_viewed` per act page shown, and `analytics_consent_given` when the visitor accepts. All of it goes through
 * the consent-gated `AnalyticsService`, so nothing is sent without consent. After provideAnalyticsConsent, so that a
 * grant has started PostHog before the consent event is sent.
 */
export function provideUsageEvents() {
  return makeEnvironmentProviders([
    { provide: USAGE_EVENT_SINK, useFactory: analyticsUsageSink },
    provideAppInitializer(() => {
      const sink = inject(USAGE_EVENT_SINK);
      const consent = inject(ANALYTICS_CONSENT);
      let granted = consent.granted();
      consent.subscribe(() => {
        const now = consent.granted();
        if (now && !granted) sink.send('analytics_consent_given', {});
        granted = now;
      });
      let last = '';
      inject(Router).events.subscribe((event) => {
        if (!(event instanceof NavigationEnd)) return;
        const act = actPageOf(event.urlAfterRedirects);
        const key = act ? act.page + ':' + act.project : '';
        if (act && key !== last) sink.send('act_page_viewed', act);
        last = key;
      });
    }),
  ]);
}

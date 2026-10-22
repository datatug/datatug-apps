// PostHog keeps the `fetch` it finds when it is imported: the recorder must be in place first.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>(
    async () => new Response('{"status":1}', { status: 200 }),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
});
import posthog from 'posthog-js';
import { provideSneatAnalytics } from '@sneat/logging';
import type { IAnalyticsService } from '@sneat/core';
import type { FactoryProvider, Injector } from '@angular/core';
import { registerPosthog } from '../../register-posthog';
import { consentGatedAnalytics } from '../analytics-consent/consent-gated-analytics';
import { withPosthogLinkPrivacy } from './link-telemetry-privacy';
import { anonymousUsagePosthog } from './usage-privacy';

/**
 * public-demo REQ:demo-usage-analytics, end to end through the real PostHog SDK: what reaches the network, from both
 * PostHog init paths (register-posthog.ts and Sneat's DeferredPosthogAnalyticsService), never holds a query, a
 * fragment, a repository or account name, a user id, or an event outside the closed list.
 */
const PRIVATE_PAGE =
  '/project/github.com/acme-corp/secret-repo/tree/main/billing/-/query/q-revenue?customer=ALFKI&order=11045#evidence=eyJ2Ijox';
const SECRETS = [
  'acme-corp',
  'secret-repo',
  'billing',
  'q-revenue',
  'ALFKI',
  '11045',
  'evidence=',
  'eyJ2Ijox',
  'uid-zz9',
  'Quarterly revenue',
];

async function bodies(recorded: typeof fetchMock): Promise<string> {
  const out: string[] = [];
  for (const [url, init] of recorded.mock.calls) {
    out.push(String(url));
    const body = (init as RequestInit | undefined)?.body;
    if (typeof body === 'string') out.push(decodeURIComponent(body));
    else if (body instanceof Blob) out.push(await body.text());
  }
  return out.join('\n');
}

describe('DataTug usage PostHog on the wire', () => {
  it('sends only scrubbed, anonymous, closed-list events from either init path', async () => {
    const window_ = window as unknown as {
      happyDOM?: { setURL(url: string): void };
    };
    window_.happyDOM?.setURL('https://datatug.app' + PRIVATE_PAGE);
    document.title = 'Quarterly revenue - acme-corp/secret-repo';

    // The settings exactly as main.ts builds them for the DataTug profile.
    const settings = withPosthogLinkPrivacy(
      anonymousUsagePosthog({
        token: 'phc_test_token',
        config: {
          api_host: 'https://eu.i.posthog.com',
          api_transport: 'fetch',
          request_batching: false,
          disable_compression: true,
          disable_external_dependency_loading: true, // happy-dom cannot load scripts
          opt_out_useragent_filter: true, // the test browser identifies as a bot
        },
      }),
    );
    expect(settings).toBeDefined();
    if (!settings) return;
    registerPosthog(settings);

    // Sneat's own analytics path, behind the app's gate: its identify never reaches PostHog.
    const sneat = provideSneatAnalytics({
      posthog: settings,
      firebaseConfig: {},
    } as never) as FactoryProvider;
    const analytics: IAnalyticsService = consentGatedAnalytics(
      () => true,
      () =>
        sneat.useFactory({ logError: vi.fn() }, {
          get: () => null,
        } as unknown as Injector),
    );
    analytics.identify('uid-zz9');
    analytics.logEvent('$pageview', { page_path: PRIVATE_PAGE });
    analytics.logEvent('query_run_finished', {
      outcome: 'rows',
      project: 'other',
    });
    analytics.logEvent('custom_free_text', { query: 'select * from acme' });

    // And straight through the SDK, as autocapture or a stray call would.
    posthog.identify('uid-zz9', { email: 'a@acme-corp.example' });
    posthog.alias('uid-zz9');
    posthog.capture('$autocapture', { $el_text: 'secret-repo' });
    posthog.capture('act_page_viewed', {
      page: 'query',
      project: 'other',
      $current_url: 'https://datatug.app' + PRIVATE_PAGE,
    });

    await vi.waitFor(
      async () => {
        const wire = await bodies(fetchMock);
        expect(wire).toContain('query_run_finished');
        expect(wire).toContain('act_page_viewed');
        expect(wire).toContain('$pageview');
      },
      { timeout: 5000 },
    );
    const wire = await bodies(fetchMock);
    for (const secret of SECRETS) expect(wire).not.toContain(secret);
    const events = [...wire.matchAll(/"event":"([^"]+)"/gu)].map((m) => m[1]);
    expect(new Set(events)).toEqual(
      new Set(['act_page_viewed', '$pageview', 'query_run_finished']),
    );
    expect(wire).toContain('"$process_person_profile":false');
    expect(wire).not.toContain('custom_free_text');
    expect(wire).toContain(
      '/project/github.com/:owner/:repo/tree/:id/:id/-/query/:id',
    );
    // No address on the wire keeps a query or a fragment.
    expect(wire).not.toMatch(/https:\/\/datatug\.app[^"\s]*[?#]/u);
  });
});

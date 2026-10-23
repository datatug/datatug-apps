// PostHog keeps the `fetch` it finds when it is imported: the recorder must be in place first.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>(
    async () => new Response('{"status":1}', { status: 200 }),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
});
import posthog from 'posthog-js';
import { registerPosthog } from '../../register-posthog';
import { withPosthogLinkPrivacy } from './link-telemetry-privacy';
import { anonymousUsagePosthog } from './usage-privacy';

/**
 * public-demo REQ:demo-usage-analytics, through the real PostHog SDK: a visit that lands from an ad or a newsletter
 * (`utm_*`, click ids) sends none of it. PostHog would otherwise save these as session super-properties and send
 * them on every event; a click id is unique per ad click and can be tied to a person by the ad platform.
 */
const LANDING =
  'https://datatug.app/demo?utm_source=news-letter&utm_medium=mail&utm_campaign=launch-oct&utm_content=hero&utm_term=sql' +
  '&gclid=GCLID-123&fbclid=FBCLID-456&msclkid=MSCLKID-789&gbraid=GBRAID-1&wbraid=WBRAID-2&ttclid=TTCLID-3&gad_source=1';
const SECRETS = [
  'utm_',
  'news-letter',
  'launch-oct',
  'gclid',
  'GCLID-123',
  'fbclid',
  'FBCLID-456',
  'msclkid',
  'MSCLKID-789',
  'gbraid',
  'wbraid',
  'ttclid',
  'gad_source',
  '$referrer',
  '$initial_',
  '$session_entry_',
];

async function wire(): Promise<string> {
  const out: string[] = [];
  for (const [url, init] of fetchMock.mock.calls) {
    out.push(String(url));
    const body = (init as RequestInit | undefined)?.body;
    if (typeof body === 'string') out.push(decodeURIComponent(body));
    else if (body instanceof Blob) out.push(await body.text());
  }
  return out.join('\n');
}

it('sends no campaign parameter, click id or referrer from the landing address', async () => {
  (
    window as unknown as { happyDOM?: { setURL(url: string): void } }
  ).happyDOM?.setURL(LANDING);
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
  posthog.capture('$pageview', { page_path: '/demo' });
  posthog.capture('act_page_viewed', { page: 'logs', project: 'demo' });
  await vi.waitFor(
    async () => {
      const body = await wire();
      expect(body).toContain('act_page_viewed');
      expect(body).toContain('$pageview');
    },
    { timeout: 5000 },
  );
  const body = await wire();
  for (const secret of SECRETS) expect(body).not.toContain(secret);
  expect(body).toContain('"$current_url":"https://datatug.app/demo"');
});

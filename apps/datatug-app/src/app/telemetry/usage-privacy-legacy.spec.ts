// PostHog keeps the `fetch` it finds when it is imported: the recorder must be in place first.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>(
    async () => new Response('{"status":1}', { status: 200 }),
  );
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
});
import posthog from 'posthog-js';
import type { IEnvironmentConfig } from '@sneat/core';
import { withAnonymousUsageTracking } from '../../launch-tracking';
import { registerPosthog } from '../../register-posthog';
import { withPosthogLinkPrivacy } from './link-telemetry-privacy';
import {
  forgetLegacyPosthogStore,
  startAnonymousPosthog,
  type LegacyStoreEnv,
} from './usage-privacy';

/**
 * Review #511 (6353543423): earlier builds called `identify(uid)` with the same PostHog key, so a returning browser
 * holds a store whose `distinct_id` is the Firebase uid. The anonymous client must never send it.
 */
const TOKEN = 'phc_shared_test';
const UID = 'firebase-uid-legacy-77';
const identified = JSON.stringify({
  distinct_id: UID,
  $device_id: 'device-legacy-1',
  $user_state: 'identified',
});

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

describe('legacy identified PostHog stores', () => {
  it('sends no uid and no identified state after a yes, from either store', async () => {
    (
      window as unknown as { happyDOM?: { setURL(url: string): void } }
    ).happyDOM?.setURL('https://app.incidentius.com/incidents');
    // What an earlier build left: the default store for the key, in localStorage and in a cookie…
    localStorage.setItem(`ph_${TOKEN}_posthog`, identified);
    document.cookie = `ph_${TOKEN}_posthog=${encodeURIComponent(identified)}; path=/`;
    // …and, to prove the start-up reset too, an identified anonymous store, which no build should ever write.
    localStorage.setItem(`ph_${TOKEN}_anonymous`, identified);
    document.cookie = `ph_${TOKEN}_anonymous=${encodeURIComponent(identified)}; path=/`;

    const config = withAnonymousUsageTracking(
      {
        production: true,
        firebaseConfig: { projectId: 'p' },
        posthog: {
          token: TOKEN,
          config: {
            api_host: 'https://eu.i.posthog.com',
            person_profiles: 'identified_only',
            api_transport: 'fetch',
            request_batching: false,
            disable_compression: true,
            disable_external_dependency_loading: true, // happy-dom cannot load scripts
            opt_out_useragent_filter: true, // the test browser identifies as a bot
          },
        },
      } as unknown as IEnvironmentConfig,
      { hostname: 'app.incidentius.com', queryProfile: null },
      undefined,
    );
    const settings = config.posthog
      ? withPosthogLinkPrivacy(config.posthog)
      : undefined;
    expect(settings).toBeDefined();
    if (!settings) return;
    registerPosthog(settings);
    expect(localStorage.getItem(`ph_${TOKEN}_posthog`)).toBeNull();
    expect(document.cookie).not.toContain(`ph_${TOKEN}_posthog=`);
    expect(posthog.get_distinct_id()).not.toBe(UID);

    posthog.capture('$pageview', { page_path: '/incidents' });
    posthog.capture('act_page_viewed', { page: 'incidents', project: 'other' });
    await vi.waitFor(
      async () => expect(await wire()).toContain('act_page_viewed'),
      { timeout: 5000 },
    );
    const body = await wire();
    expect(body).not.toContain(UID);
    expect(body).not.toContain('device-legacy-1');
    expect(body).not.toContain('$is_identified');
    expect(body).not.toMatch(/"\$user_state":"identified"/u);
    expect(body).toContain('"$process_person_profile":false');
  });
});

describe('forgetLegacyPosthogStore', () => {
  function env(hostname: string, refuse = false) {
    const cookies: string[] = [];
    const removed: string[] = [];
    const e: LegacyStoreEnv = {
      storage: () => {
        if (refuse) throw new Error('blocked');
        return { removeItem: (key: string) => void removed.push(key) };
      },
      document: {
        get cookie() {
          return '';
        },
        set cookie(value: string) {
          cookies.push(value);
        },
      },
      hostname: () => hostname,
    };
    return { e, cookies, removed };
  }

  it('deletes the store and its cookie on the host and its parent domain', () => {
    const { e, cookies, removed } = env('app.incidentius.com');
    forgetLegacyPosthogStore('phc_x', e);
    expect(removed).toEqual(['ph_phc_x_posthog']);
    expect(cookies.map((c) => c.split('; domain=')[1])).toEqual([
      undefined,
      'app.incidentius.com',
      '.incidentius.com',
      '.app.incidentius.com',
    ]);
    expect(
      cookies.every((c) =>
        c.startsWith('ph_phc_x_posthog=; expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
  });

  it('does nothing without a key, and survives refused storage', () => {
    const none = env('datatug.app');
    forgetLegacyPosthogStore(undefined, none.e);
    expect(none.cookies).toEqual([]);
    const blocked = env('localhost', true);
    forgetLegacyPosthogStore('phc_x', blocked.e);
    expect(blocked.cookies).toHaveLength(2);
  });

  it('resets an identified client before its first capture, and leaves an anonymous one alone', () => {
    const { e } = env('datatug.app');
    const reset = vi.fn();
    startAnonymousPosthog(
      { get_property: () => 'identified', reset },
      'phc_x',
      e,
    );
    expect(reset).toHaveBeenCalledExactlyOnceWith(true);
    reset.mockClear();
    startAnonymousPosthog(
      { get_property: () => 'anonymous', reset },
      'phc_x',
      e,
    );
    expect(reset).not.toHaveBeenCalled();
  });
});

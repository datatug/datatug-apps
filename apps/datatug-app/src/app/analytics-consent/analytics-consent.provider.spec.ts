import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { ANALYTICS_CONSENT_KEY } from './analytics-consent';
import {
  browserAnalyticsEnv,
  provideAnalyticsConsent,
} from './analytics-consent.provider';

const target = window as unknown as Record<string, unknown>;

function setup(measurementId: string | undefined, path = '/') {
  history.replaceState(null, '', path);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([
        { path: '', children: [] },
        { path: '**', children: [] },
      ]),
      provideAnalyticsConsent(measurementId),
    ],
  });
  return TestBed.inject(Router);
}

afterEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
  document.body.innerHTML = '';
  delete target['dataLayer'];
  delete target['__datatugCheckoutPrivacy'];
  history.replaceState(null, '', '/');
});

describe('provideAnalyticsConsent', () => {
  it('reads the browser it runs in', () => {
    const env = browserAnalyticsEnv();
    expect(env.storage()).toBe(window.localStorage);
    expect(env.location()).toBe(window.location);
    expect(env.document).toBe(document);
    expect(env.window).toBe(window);
    expect(env.checkoutActive()).toBe(false);
    target['__datatugCheckoutPrivacy'] = true;
    expect(env.checkoutActive()).toBe(true);
  });

  it('shows no banner on the happy-dom host (localhost) and sends nothing, however many pages follow', async () => {
    const router = setup('G-DESWRP39RY');
    await TestBed.inject(Router).navigateByUrl('/');
    await router.navigateByUrl('/demo');
    expect(document.querySelector('.datatug-analytics-consent')).toBeNull();
    expect(target['dataLayer']).toBeUndefined();
  });

  it('starts the consent after the router exists and reports each NavigationEnd', async () => {
    // A host that is not local: the provider takes the real window, so it is stood in for.
    const spy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'datatug.app',
      origin: 'https://datatug.app',
      pathname: '/demo',
    } as Location);
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted');
    const append = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node) => node);
    const router = setup('G-DESWRP39RY');
    await router.navigateByUrl('/demo');
    const layer = (target['dataLayer'] as ArrayLike<unknown>[]).map((entry) =>
      Array.from(entry),
    );
    spy.mockRestore();
    expect(
      append.mock.calls.map(([script]) => (script as HTMLScriptElement).src),
    ).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-DESWRP39RY']);
    append.mockRestore();
    expect(layer.map((entry) => entry[0])).toEqual([
      'consent',
      'consent',
      'js',
      'config',
      'set',
      'event',
    ]);
    expect(layer[5]).toEqual([
      'event',
      'page_view',
      {
        page_location: 'https://datatug.app/demo',
        page_referrer: '',
        page_title: 'DataTug',
      },
    ]);
    expect(document.querySelector('.datatug-analytics-consent')).toBeNull();
  });

  it('asks for a choice first on a non-local host', async () => {
    const spy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'datatug.app',
      origin: 'https://datatug.app',
      pathname: '/',
    } as Location);
    const router = setup('G-DESWRP39RY');
    await router.navigateByUrl('/');
    expect(document.querySelector('.datatug-analytics-consent')).not.toBeNull();
    expect(target['dataLayer']).toBeUndefined();
    spy.mockRestore();
  });
});

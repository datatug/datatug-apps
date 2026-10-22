import type { AnalyticsConsent } from './analytics-consent';
import {
  BANNER_TEXT,
  mountAnalyticsConsentBanner,
  PRIVACY_NOTICE_URL,
} from './analytics-consent-banner';

function fakeConsent(visible = true) {
  let listener: () => void = () => undefined;
  const state = { visible };
  const consent = {
    bannerVisible: () => state.visible,
    choose: vi.fn(),
    subscribe: vi.fn((fn: () => void) => {
      listener = fn;
      return vi.fn();
    }),
  };
  return {
    consent: consent as unknown as AnalyticsConsent & typeof consent,
    change(next: boolean) {
      state.visible = next;
      listener();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

const banner = () => document.querySelector('.datatug-analytics-consent');

describe('analytics consent banner', () => {
  it('shows nothing while the consent says no', () => {
    const { consent } = fakeConsent(false);
    mountAnalyticsConsentBanner(consent, document, window);
    expect(banner()).toBeNull();
    expect(document.documentElement.classList).not.toContain(
      'datatug-analytics-consent-open',
    );
  });

  it('is a labelled region with the contract text, a privacy link and two equal buttons', () => {
    const { consent } = fakeConsent();
    mountAnalyticsConsentBanner(consent, document, window);
    const region = banner() as HTMLElement;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Analytics choice');
    expect(BANNER_TEXT).toBe(
      "We'd like to use analytics (Google Analytics and PostHog) to count visits and see which pages help. They set cookies only if you accept.",
    );
    expect(region.querySelector('p')?.textContent).toBe(
      BANNER_TEXT + ' Privacy notice',
    );
    const link = region.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      'https://datatug.app/en/privacy/#analytics',
    );
    expect(PRIVACY_NOTICE_URL).toBe(link.getAttribute('href'));
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    const buttons = [...region.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Accept analytics',
      'Reject',
    ]);
    expect(buttons.map((button) => button.type)).toEqual(['button', 'button']);
    // Same style family: one rule styles both, and nothing sets either apart.
    expect(buttons.every((button) => !button.className && !button.id)).toBe(
      true,
    );
  });

  it('makes the app end above it while it is open, and gives the room back when it closes', () => {
    const { consent, change } = fakeConsent();
    mountAnalyticsConsentBanner(consent, document, window);
    const root = document.documentElement;
    expect(root.classList).toContain('datatug-analytics-consent-open');
    expect(
      document.getElementById('datatug-analytics-consent-style')?.textContent,
    ).toContain('ion-app { bottom: var(--datatug-analytics-consent-height');
    Object.defineProperty(banner(), 'offsetHeight', { value: 96 });
    window.dispatchEvent(new Event('resize'));
    expect(
      root.style.getPropertyValue('--datatug-analytics-consent-height'),
    ).toBe('96px');
    change(false);
    expect(banner()).toBeNull();
    expect(root.classList).not.toContain('datatug-analytics-consent-open');
    expect(
      root.style.getPropertyValue('--datatug-analytics-consent-height'),
    ).toBe('');
  });

  it('records the choice of either button and leaves closing to the consent', () => {
    const { consent } = fakeConsent();
    mountAnalyticsConsentBanner(consent, document, window);
    const [accept, reject] = [...document.querySelectorAll('button')];
    accept.click();
    reject.click();
    expect(consent.choose.mock.calls).toEqual([['granted'], ['denied']]);
    // It closes only on a choice: nothing but the consent hides it.
    expect(banner()).not.toBeNull();
  });

  it('adds its stylesheet once however often it is shown, and reacts to every change', () => {
    const { consent, change } = fakeConsent();
    mountAnalyticsConsentBanner(consent, document, window);
    change(true);
    expect(
      document.querySelectorAll('.datatug-analytics-consent'),
    ).toHaveLength(1);
    change(false);
    change(false);
    change(true);
    expect(
      document.querySelectorAll('.datatug-analytics-consent'),
    ).toHaveLength(1);
    expect(document.querySelectorAll('style')).toHaveLength(1);
  });

  it('is removed for good by the function it returns', () => {
    const { consent } = fakeConsent();
    const unsubscribe = vi.fn();
    consent.subscribe.mockReturnValue(unsubscribe);
    const remove = vi.spyOn(window, 'removeEventListener');
    const unmount = mountAnalyticsConsentBanner(consent, document, window);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(banner()).toBeNull();
    // A resize after unmounting does not bring the inset back.
    window.dispatchEvent(new Event('resize'));
    expect(
      document.documentElement.style.getPropertyValue(
        '--datatug-analytics-consent-height',
      ),
    ).toBe('0px');
  });
});

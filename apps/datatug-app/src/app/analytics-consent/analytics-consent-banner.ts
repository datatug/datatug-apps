import type { AnalyticsConsent } from './analytics-consent';

export const PRIVACY_NOTICE_URL = 'https://datatug.app/en/privacy/#analytics';
/** What runs on datatug.app today: Google Analytics only. */
export const BANNER_TEXT =
  "We'd like to use Google Analytics to count visits and see which pages help. It sets cookies only if you accept.";
/** Where DataTug's anonymous usage PostHog is configured too (public-demo REQ:demo-usage-analytics). */
export const BANNER_TEXT_WITH_USAGE =
  "We'd like to use Google Analytics and PostHog to count visits and anonymous steps, such as which demo pages are opened and whether a query run worked. Never your account, repository names, queries or results. They set cookies only if you accept.";

/** Incidentius (app.incidentius.com): PostHog is the only analytics tool there. */
export const BANNER_TEXT_USAGE_ONLY =
  "We'd like to use PostHog to count anonymous steps, such as which pages are opened and whether a query run worked. Never your account, repository names, queries or results. It sets cookies only if you accept.";

/** The banner names exactly the tools that run after a yes. */
export function bannerText(usagePosthog: boolean): string {
  return usagePosthog ? BANNER_TEXT_WITH_USAGE : BANNER_TEXT;
}

const STYLE_ID = 'datatug-analytics-consent-style';
const OPEN_CLASS = 'datatug-analytics-consent-open';
const INSET_VAR = '--datatug-analytics-consent-height';

// Ionic variables, so that the banner follows the app's theme. While it is open the app (`ion-app` is absolutely
// positioned over the whole window) ends above it, so that it never covers a page's own bottom actions.
const STYLE = `
.datatug-analytics-consent {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000; box-sizing: border-box;
  max-height: 60vh; overflow-y: auto;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--ion-background-color, #fff); color: var(--ion-text-color, #000);
  border-top: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, 0.2));
  font: 14px/1.4 var(--ion-font-family, system-ui, sans-serif);
}
.datatug-analytics-consent p { flex: 1 1 280px; margin: 0; }
.datatug-analytics-consent a { color: var(--ion-color-primary, #3880ff); }
.datatug-analytics-consent .actions { display: flex; flex: 0 1 auto; gap: 8px; }
.datatug-analytics-consent button {
  flex: 1 1 0; min-width: 120px; min-height: 44px; padding: 0 12px; cursor: pointer;
  font: inherit; font-weight: 500; border-radius: 4px;
  color: var(--ion-color-primary, #3880ff); background: transparent;
  border: 1px solid var(--ion-color-primary, #3880ff);
}
html.${OPEN_CLASS} ion-app { bottom: var(${INSET_VAR}, 0px); }
`;

/**
 * Shows the analytics banner while the consent says so and removes it when it no longer does. Plain DOM: it has to
 * work before, and independently of, any Angular view. Returns a function that removes it for good.
 */
export function mountAnalyticsConsentBanner(
  consent: AnalyticsConsent,
  doc: Document,
  win: Window,
  bannerCopy: string = BANNER_TEXT,
): () => void {
  let banner: HTMLElement | undefined;

  const fit = () => {
    doc.documentElement.style.setProperty(
      INSET_VAR,
      (banner?.offsetHeight ?? 0) + 'px',
    );
  };

  const button = (label: string, onClick: () => void) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', onClick);
    return element;
  };

  const show = () => {
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLE;
      doc.head.appendChild(style);
    }
    const element = doc.createElement('div');
    element.className = 'datatug-analytics-consent';
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', 'Analytics choice');
    const text = doc.createElement('p');
    text.append(bannerCopy + ' ');
    const link = doc.createElement('a');
    link.href = PRIVACY_NOTICE_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Privacy notice';
    text.append(link);
    const actions = doc.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Accept analytics', () => consent.choose('granted')),
      button('Reject', () => consent.choose('denied')),
    );
    element.append(text, actions);
    doc.body.append(element);
    banner = element;
    doc.documentElement.classList.add(OPEN_CLASS);
    fit();
  };

  const hide = () => {
    banner?.remove();
    banner = undefined;
    doc.documentElement.classList.remove(OPEN_CLASS);
    doc.documentElement.style.removeProperty(INSET_VAR);
  };

  const update = () => {
    const visible = consent.bannerVisible();
    if (visible && !banner) show();
    else if (!visible && banner) hide();
  };

  const unsubscribe = consent.subscribe(update);
  win.addEventListener('resize', fit);
  update();

  return () => {
    unsubscribe();
    win.removeEventListener('resize', fit);
    hide();
  };
}

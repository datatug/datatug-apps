import { DEMO_PROJECT_REF, projectUrl } from '@datatug/project-address';
import type { DemoLang } from './demo-handoff-capture';

/**
 * Every visitor-facing string of the holding page, in one place. The two sentences are the founder's to change
 * (design doc demo-as-github-project.md, section 9, question 7); the heading, the link labels and the notice
 * are placeholders in the same spirit.
 */
export interface DemoHoldingStrings {
  readonly heading: string;
  /** Shown above the visitor's question. */
  readonly withQuestion: string;
  /** Shown when there is no question to show back. */
  readonly withoutQuestion: string;
  /** Shown when the question was longer than the bound and was cut. */
  readonly shortened: string;
  readonly questionLabel: string;
  /** The page for the start-chat address of any repository other than the demo project: no question, no demo claim. */
  readonly neutralHeading: string;
  readonly neutralMessage: string;
  readonly openDemoProject: string;
  readonly backToSite: string;
}

export const DEMO_HOLDING_STRINGS: Readonly<
  Record<DemoLang, DemoHoldingStrings>
> = {
  en: {
    heading: 'DataTug live demo',
    withQuestion:
      'This is the question you asked. The live demo is not open yet; it opens here soon.',
    withoutQuestion: 'The live demo is not open yet; it opens here soon.',
    shortened: 'Your question was long, so only the beginning is shown.',
    questionLabel: 'Your question',
    neutralHeading: 'DataTug',
    neutralMessage: 'This page is not available yet.',
    openDemoProject: 'Open the demo project',
    backToSite: 'Back to the site',
  },
  ru: {
    heading: 'Живое демо DataTug',
    withQuestion:
      'Это ваш вопрос. Живое демо ещё не открыто, скоро оно появится здесь.',
    withoutQuestion: 'Живое демо ещё не открыто, скоро оно появится здесь.',
    shortened: 'Вопрос длинный, поэтому показано только его начало.',
    questionLabel: 'Ваш вопрос',
    neutralHeading: 'DataTug',
    neutralMessage: 'Эта страница пока недоступна.',
    openDemoProject: 'Открыть демо-проект',
    backToSite: 'Назад на сайт',
  },
};

/** The demo project exactly as the home page's "DataTug Demo Project @ GitHub" entry opens it: its short address. */
export const DEMO_PROJECT_PATH: string = projectUrl(DEMO_PROJECT_REF);

export const SITE_URL = 'https://datatug.io/';

/** Origins the "back to the site" link may return to. Never an arbitrary referrer: that would be an open redirect. */
const ALLOWED_SITE_ORIGINS: readonly string[] = [
  'https://datatug.io',
  'https://datatug.ai',
];

/**
 * datatug.app serves this app on every path and the DataTug.app landing page on `/`, `/en/…` and `/ru/…`. A referrer
 * on that origin means "from the landing" only on those paths: from any other path (`/home`, a project) the visitor
 * came from the app itself, which has no site page to return to.
 */
const LANDING_ORIGIN = 'https://datatug.app';

/** Whether `pathname` is `prefix` itself or anything under `prefix/`. */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** The landing's own paths: the root, and the English and Russian subtrees (`/en` and `/ru` themselves included). */
function isLandingPath(pathname: string): boolean {
  return (
    pathname === '/' || isUnder(pathname, '/en') || isUnder(pathname, '/ru')
  );
}

/** The Russian home page of datatug.ai and of the DataTug.app landing: the one path, besides `/`, a referrer may send the visitor back to. */
const RU_HOME_PATH = '/ru/';

/**
 * The site the visitor came from when it is one of ours, else datatug.io. Only an origin is ever used, plus, for
 * a visitor who came from the Russian pages of datatug.ai or of the DataTug.app landing (`/ru` or anything under
 * `/ru/`), that site's Russian home page. A visitor from the English pages of the DataTug.app landing (see
 * {@link isLandingPath}) returns to its root. Nothing else of the referrer (no other path, query or fragment) is
 * ever used.
 */
export function siteUrlFor(referrer: string): string {
  try {
    const { origin, pathname } = new URL(referrer);
    if (ALLOWED_SITE_ORIGINS.includes(origin)) {
      const russian =
        origin === 'https://datatug.ai' &&
        (pathname === '/ru' || pathname.startsWith(RU_HOME_PATH));
      return origin + (russian ? RU_HOME_PATH : '/');
    }
    if (origin === LANDING_ORIGIN && isLandingPath(pathname)) {
      return LANDING_ORIGIN + (isUnder(pathname, '/ru') ? RU_HOME_PATH : '/');
    }
  } catch {
    // No referrer, or not a URL.
  }
  return SITE_URL;
}

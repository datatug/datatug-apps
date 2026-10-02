import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AskedEnv,
  cleanQuestion,
  DEMO_HANDOFF_KEY,
  DEMO_HANDOFF_STASH,
  questionOfSearch,
  resetHandoffAskedForTests,
  searchAsksQuestion,
  showsHoldingPage,
} from './demo-handoff-asked';
import { routeSegments } from './demo-handoff-path';

// Which hand-off addresses show the holding page, and which are the project's own pages: the rule of
// datatug-app-routes.ts, decided from what index.html kept of the query (the router never sees it).

const CHAT = '/project/github.com/datatug/chinook-demo/chat';

/** Keys removed from sessionStorage through the env made by `env()`. */
const removed: string[] = [];

function env(
  options: {
    stash?: string;
    stored?: string;
    navigation?: string;
    blocked?: boolean;
  } = {},
): AskedEnv {
  return {
    stash:
      options.stash === undefined
        ? {}
        : { [DEMO_HANDOFF_STASH]: options.stash },
    storage: () => {
      if (options.blocked) throw new Error('blocked');
      return {
        getItem: (key: string) =>
          key === DEMO_HANDOFF_KEY ? (options.stored ?? null) : null,
        removeItem: (key: string) => void removed.push(key),
      } as unknown as Storage;
    },
    navigationType: () => options.navigation,
  };
}

const shows = (path: string, e?: AskedEnv): boolean =>
  showsHoldingPage(routeSegments(path), e);

describe('which hand-off addresses show the holding page', () => {
  beforeEach(() => {
    resetHandoffAskedForTests();
    removed.length = 0;
  });

  // Review S1 and minor 6 of G-A1b: on main a fresh bare visit removed the question kept in the tab, so a reload
  // shows the project chat; the answer "no question" must do the same, and the stash must not outlive it.
  describe('an answer of "no question" forgets the question kept for this tab', () => {
    it('a fresh visit with no query removes the stored copy, so a reload no longer shows the page', () => {
      const stored = CHAT + '?msg=Hello';
      expect(shows(CHAT, env({ stored, navigation: 'navigate' }))).toBe(false);
      expect(removed).toEqual([DEMO_HANDOFF_KEY]);
    });

    it('a visit with a query that is no question removes the stored copy, and the stash', () => {
      const e = env({
        stash: '?lang=ru',
        stored: CHAT + '?msg=Hello',
        navigation: 'navigate',
      });
      expect(shows(CHAT, e)).toBe(false);
      expect(removed).toEqual([DEMO_HANDOFF_KEY]);
      expect(DEMO_HANDOFF_STASH in e.stash).toBe(false);
    });

    it('the same for an address that may not echo its question (an untrusted repository)', () => {
      const path = '/project/github.com/someone/else/chat';
      expect(
        shows(
          path,
          env({
            stored: path + '?lang=en&asked=1',
            navigation: 'navigate',
          }),
        ),
      ).toBe(false);
      expect(removed).toEqual([DEMO_HANDOFF_KEY]);
    });

    it('a question that was asked is kept, and its stash is left for the holding page', () => {
      const e = env({ stash: '?msg=Hello', navigation: 'navigate' });
      expect(shows(CHAT, e)).toBe(true);
      expect(removed).toEqual([]);
      expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?msg=Hello');
    });

    it('a reload and Back keep it: that is how the page comes back', () => {
      for (const navigation of ['reload', 'back_forward']) {
        resetHandoffAskedForTests();
        expect(
          shows(CHAT, env({ stored: CHAT + '?msg=Hello', navigation })),
          navigation,
        ).toBe(true);
      }
      expect(removed).toEqual([]);
    });

    it('/demo keeps its stash: the page reads the language from it', () => {
      const e = env({ stash: '?lang=ru', navigation: 'navigate' });
      expect(shows('/demo', e)).toBe(true);
      expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?lang=ru');
      expect(removed).toEqual([]);
    });

    it('blocked storage does not throw, and the answer is still no', () => {
      expect(shows(CHAT, env({ blocked: true, navigation: 'navigate' }))).toBe(
        false,
      );
      expect(shows(CHAT, env({ blocked: true, stash: '?lang=ru' }))).toBe(
        false,
      );
    });

    it('asking again about the same address, from the same page load, does not remove anything more', () => {
      const e = env({ navigation: 'navigate' });
      shows(CHAT, e);
      shows(CHAT, e);
      expect(removed).toEqual([DEMO_HANDOFF_KEY]);
    });
  });

  describe('/demo: always, whatever the query or storage says', () => {
    it.each(['/demo', '/Demo', '/demo/', '/demo;x=1'])('%s', (path) => {
      expect(shows(path, env())).toBe(true);
      expect(shows(path, env({ stash: '?lang=ru' }))).toBe(true);
      expect(shows(path, env({ blocked: true, navigation: 'navigate' }))).toBe(
        true,
      );
    });
  });

  describe('the project chat address: only when a question was asked', () => {
    it.each([
      [CHAT],
      ['/project/github.com/Datatug/Chinook-Demo/chat/'],
      ['/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat'],
      ['/project/github.com/someone/else/chat'],
      ['/project/github.com/datatug/chinook-demo/tree/abc123/-/chat'],
    ])('%s', (path) => {
      // arrived with a question (index.html stashed it)
      for (const stash of [
        '?msg=Hello',
        '?q=Hello',
        '?msg=%20&q=Hello',
        '?lang=ru&msg=Hello',
      ]) {
        resetHandoffAskedForTests();
        expect(shows(path, env({ stash })), stash).toBe(true);
      }
      // arrived with no question: the project's own chat page
      for (const stash of [
        '?lang=ru',
        '?msg=',
        '?msg=%20%0A',
        '?scenario=x',
        '?other=1',
        '?msg=%07',
      ]) {
        resetHandoffAskedForTests();
        expect(shows(path, env({ stash })), stash).toBe(false);
      }
      // no query at all: a fresh visit
      resetHandoffAskedForTests();
      expect(shows(path, env({ navigation: 'navigate' }))).toBe(false);
      resetHandoffAskedForTests();
      expect(shows(path, env())).toBe(false);
    });

    it('the mark kept for an address that may not echo its question counts as a question', () => {
      expect(shows(CHAT, env({ stash: '?lang=ru&asked=1' }))).toBe(true);
      expect(searchAsksQuestion('?asked=1')).toBe(true);
      expect(searchAsksQuestion('?asked=0')).toBe(false);
      expect(searchAsksQuestion('?asked')).toBe(false);
    });
  });

  describe('a reload or Back, from the copy kept in sessionStorage', () => {
    it.each([
      ['reload', 'reload'],
      ['back/forward', 'back_forward'],
      ['an unknown navigation type', undefined],
    ])(
      'after a %s the address that had a question shows the page again',
      (_name, navigation) => {
        expect(
          shows(CHAT, env({ stored: CHAT + '?msg=Hello&lang=ru', navigation })),
        ).toBe(true);
      },
    );

    it('also for an address that may not echo its question (the mark)', () => {
      const path = '/project/github.com/someone/else/chat';
      expect(
        shows(
          path,
          env({ stored: path + '?lang=ru&asked=1', navigation: 'reload' }),
        ),
      ).toBe(true);
    });

    it.each([
      ['only a language was kept', CHAT + '?lang=ru'],
      ['nothing was kept', ''],
      ['junk was kept', 'junk'],
      [
        'the question was asked at another address',
        '/project/github.com/datatug/other/chat?msg=Hello',
      ],
      ['the question was asked on /demo', '/demo?q=Hello'],
      ['the copy has no path', '?msg=Hello'],
    ])('the page is not shown when %s', (_name, stored) => {
      expect(shows(CHAT, env({ stored, navigation: 'reload' }))).toBe(false);
    });

    it('reads the path as the router does: case, a trailing slash, matrix parameters and encoding do not matter', () => {
      for (const stored of [
        '/Project/GitHub.com/DATATUG/Chinook-Demo/Chat?msg=Hi',
        '/project/github.com/datatug/chinook-demo/chat/?msg=Hi',
        '/project/github.com/datatug/chinook-demo/chat;x=1?msg=Hi',
        '/project/github.com/datatug/chinook%2Ddemo/chat?msg=Hi',
      ]) {
        expect(shows(CHAT, env({ stored, navigation: 'reload' })), stored).toBe(
          true,
        );
      }
    });

    it('a fresh visit (the document was navigated to, not reloaded) ignores what an earlier visit left in the tab', () => {
      expect(
        shows(
          CHAT,
          env({ stored: CHAT + '?msg=Hello', navigation: 'navigate' }),
        ),
      ).toBe(false);
    });

    it('blocked storage means the project page: the question lived only in the page', () => {
      expect(shows(CHAT, env({ blocked: true, navigation: 'reload' }))).toBe(
        false,
      );
    });
  });

  describe('what this page load has settled stays settled', () => {
    it('after the question was taken from the stash, coming back to the address shows the page again', () => {
      expect(shows(CHAT, env({ stash: '?msg=Hello' }))).toBe(true);
      // the holding page has picked the stash up; the router matches the address again
      expect(shows(CHAT, env({ navigation: 'navigate' }))).toBe(true);
      expect(
        shows('/project/github.com/datatug/chinook-demo/CHAT/', env()),
      ).toBe(true);
    });

    it('an address that arrived with no question stays the project page, whatever storage later holds', () => {
      expect(shows(CHAT, env({ stash: '?lang=ru' }))).toBe(false);
      expect(
        shows(CHAT, env({ stored: CHAT + '?msg=Hello', navigation: 'reload' })),
      ).toBe(false);
    });

    it('is per address', () => {
      expect(shows(CHAT, env({ stash: '?msg=Hello' }))).toBe(true);
      expect(
        shows(
          '/project/github.com/datatug/other/chat',
          env({ navigation: 'navigate' }),
        ),
      ).toBe(false);
    });
  });

  describe('not a hand-off address: never the holding page', () => {
    it.each([
      '/',
      '/project/github.com/datatug/chinook-demo',
      '/project/github.com/datatug/chinook-demo/queries',
      '/project/github.com/datatug/chinook-demo/chat/extra',
      '/project/github.com/datatug/chinook-demo/tree/HEAD/dir/-/chat',
      '/store/github.com/project/chinook-demo@datatug@/chat',
      '/demo/other',
      '/project/gitlab.com/datatug/chinook-demo/chat',
    ])('%s', (path) => {
      expect(shows(path, env({ stash: '?msg=Hello' }))).toBe(false);
    });
  });
});

describe('the page load it is asked about (the defaults: window, sessionStorage, navigation timing)', () => {
  beforeEach(() => {
    resetHandoffAskedForTests();
    window.sessionStorage.setItem(DEMO_HANDOFF_KEY, CHAT + '?msg=Hello');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH];
    window.sessionStorage.clear();
    resetHandoffAskedForTests();
  });

  it('reads the stash on window', () => {
    (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH] =
      '?q=Hello';
    expect(showsHoldingPage(routeSegments(CHAT))).toBe(true);
  });

  it('a reload (the navigation timing says so) reads sessionStorage', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' } as PerformanceEntry,
    ]);
    expect(showsHoldingPage(routeSegments(CHAT))).toBe(true);
  });

  it('a navigation (the navigation timing says so) ignores sessionStorage', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'navigate' } as PerformanceEntry,
    ]);
    expect(showsHoldingPage(routeSegments(CHAT))).toBe(false);
  });

  it('a browser with no navigation timing is read as a reload: sessionStorage is used', () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('unsupported');
    });
    expect(showsHoldingPage(routeSegments(CHAT))).toBe(true);
  });
});

describe('the question of a query string', () => {
  it.each([
    ['?msg=Hello', 'Hello'],
    ['?q=Hello', 'Hello'],
    ['?msg=A&q=B', 'A'],
    ['?msg=%20&q=B', 'B'],
    ['?msg=%0A%0A%0A%0Ax%0A%0A%0A%0Ay', 'x\n\ny'],
    ['?msg=a%00b', 'ab'],
    ['?lang=ru', ''],
    ['', ''],
  ])('%j is %j', (search, question) => {
    expect(questionOfSearch(search)).toBe(question);
  });

  it('cleans text like the parser of the holding page', () => {
    expect(cleanQuestion(null)).toBe('');
    expect(cleanQuestion('  a\u0007b  ')).toBe('ab');
    expect(cleanQuestion('a\t\nb')).toBe('a\t\nb');
  });
});

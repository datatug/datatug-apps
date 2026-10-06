import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AskedEnv,
  cleanQuestion,
  DEMO_HANDOFF_KEY,
  DEMO_HANDOFF_STASH,
  questionOfSearch,
  resetHandoffAskedForTests,
  handoffDecision,
  searchAsksQuestion,
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

const decide = (path: string, e?: AskedEnv, routerSearch?: string) =>
  handoffDecision(routeSegments(path), e, routerSearch);
/** Whether the hand-off rules take this address at all (its own page, or a move to the page that has it). */
const shows = (path: string, e?: AskedEnv, routerSearch?: string): boolean =>
  decide(path, e, routerSearch).kind !== 'none';

describe('which hand-off addresses show the holding page', () => {
  beforeEach(() => {
    resetHandoffAskedForTests();
    removed.length = 0;
  });

  // Review r2, B1: an address that the router matches but index.html's script did not take the question out of
  // (the script reads the path its own way) arrives with the question in the navigation's query and no stash.
  describe('a question in the navigation query that the script did not take out (review r2, B1)', () => {
    it('is asked: the router matched a hand-off address with a question in its query, and there is no stash', () => {
      expect(shows(CHAT, env({ navigation: 'navigate' }), '?msg=Hello')).toBe(
        true,
      );
    });

    it('and the query is stashed for the holding page, which captures it from there and takes it out of the address', () => {
      const e = env({ navigation: 'navigate' });
      expect(shows(CHAT, e, '?msg=Hello&lang=ru')).toBe(true);
      expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?msg=Hello&lang=ru');
      expect(removed).toEqual([]);
    });

    it('counts q, the old name, as a question too', () => {
      expect(shows(CHAT, env({ navigation: 'navigate' }), '?q=Hello')).toBe(
        true,
      );
    });

    it('a blank question, or no question, is not one: the chat page, and a stored copy is forgotten as for any bare visit', () => {
      for (const search of ['', '?msg=', '?msg=%20%0A', '?lang=ru&x=1']) {
        resetHandoffAskedForTests();
        removed.length = 0;
        const e = env({ navigation: 'navigate', stored: CHAT + '?msg=Old' });
        expect(shows(CHAT, e, search), search).toBe(false);
        expect(removed, search).toEqual([DEMO_HANDOFF_KEY]);
        expect(DEMO_HANDOFF_STASH in e.stash).toBe(false);
      }
    });

    it('what the script stashed wins over what the router has', () => {
      const e = env({ stash: '?lang=ru', navigation: 'navigate' });
      expect(shows(CHAT, e, '?msg=Hello')).toBe(false);
      expect(DEMO_HANDOFF_STASH in e.stash).toBe(false);
    });

    it('is asked again for the same address later in the page, whatever was settled before (an in-app navigation)', () => {
      expect(shows(CHAT, env({ navigation: 'navigate' }))).toBe(false);
      expect(shows(CHAT, env({ navigation: 'navigate' }), '?msg=Later')).toBe(
        true,
      );
    });

    it('/demo needs no question, and its query is stashed as well, for the holding page to capture', () => {
      const e = env({ navigation: 'navigate' });
      expect(shows('/demo', e, '?q=Hello')).toBe(true);
      expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?q=Hello');
      const none = env({ navigation: 'navigate' });
      expect(shows('/demo', none, '')).toBe(true);
      expect(DEMO_HANDOFF_STASH in none.stash).toBe(false);
    });

    it("a trusted and an untrusted repository are alike here: whether the question is shown back is the capture's to say", () => {
      expect(
        shows(
          '/project/github.com/someone/else/chat',
          env({ navigation: 'navigate' }),
          '?msg=Hello',
        ),
      ).toBe(true);
    });
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
      '/project/github.com/datatug/chinook-demo/tree/HEAD/dir/-/chat/extra',
      '/store/github.com/project/chinook-demo@datatug@/chat',
      '/demo/other',
      '/project/gitlab.com/datatug/chinook-demo/chat',
    ])('%s', (path) => {
      expect(shows(path, env({ stash: '?msg=Hello' }))).toBe(false);
    });
  });
});

describe('the decision for an address (founder ruling 2026-10-03: start-chat is the confirmation page)', () => {
  const START_CHAT = '/project/github.com/datatug/chinook-demo/start-chat';
  beforeEach(() => {
    resetHandoffAskedForTests();
    removed.length = 0;
  });

  it('start-chat is always its own page, with or without a question, on a fresh visit or a reload', () => {
    for (const navigation of ['navigate', 'reload', 'back_forward', undefined]) {
      expect(decide(START_CHAT, env({ navigation })), String(navigation)).toEqual({ kind: 'page' });
      expect(
        decide(START_CHAT, env({ navigation, stash: '?msg=Hello' })),
        String(navigation),
      ).toEqual({ kind: 'page' });
    }
  });

  it('start-chat in a folder or on a ref is its own page too', () => {
    expect(decide(START_CHAT.replace('/start-chat', '/tree/abc/-/start-chat'), env())).toEqual({ kind: 'page' });
    expect(decide(START_CHAT.replace('/start-chat', '/tree/HEAD/d/e/-/start-chat'), env())).toEqual({ kind: 'page' });
  });

  it('start-chat takes nothing out of storage and puts nothing in the stash: the page captures the address itself', () => {
    const e = env({ navigation: 'navigate', stash: undefined });
    decide(START_CHAT, e, '?msg=Hello');
    expect(e.stash[DEMO_HANDOFF_STASH]).toBeUndefined();
    expect(removed).toEqual([]);
  });

  it('/demo is its own page, and a question in its navigation query is stashed', () => {
    const e = env({ navigation: 'navigate' });
    expect(decide('/demo', e, '?q=Hello')).toEqual({ kind: 'page' });
    expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?q=Hello');
  });

  it('the old chat address that arrived with a question is moved to start-chat of the same project', () => {
    expect(decide(CHAT, env({ stash: '?msg=Hello' }))).toEqual({
      kind: 'move-to-start-chat',
      segments: ['project', 'github.com', 'datatug', 'chinook-demo', 'start-chat'],
    });
  });

  it('the move keeps the ref and the letter case of the owner, repo and ref, and drops the rest of the old spelling', () => {
    expect(
      decide('//Project/github.com/Acme/Demo/tree/Rel-1/-/chat/', env({ stash: '?q=Hello' })),
    ).toEqual({
      kind: 'move-to-start-chat',
      segments: ['Project', 'github.com', 'Acme', 'Demo', 'tree', 'Rel-1', '-', 'start-chat'],
    });
  });

  it('the old chat address without a question is nothing for these rules: it is the project chat page', () => {
    expect(decide(CHAT, env({ navigation: 'navigate' }))).toEqual({ kind: 'none' });
  });

  it('the move leaves the question in the stash for the page it moves to', () => {
    const e = env({ stash: '?msg=Hello&lang=ru' });
    decide(CHAT, e);
    expect(e.stash[DEMO_HANDOFF_STASH]).toBe('?msg=Hello&lang=ru');
  });

  it.each(['/', '/chat', '/project/github.com/o/r', '/project/github.com/o/r/queries', '/start-chat'])(
    '%s is not a hand-off address',
    (path) => {
      expect(decide(path, env({ stash: '?msg=x' }))).toEqual({ kind: 'none' });
    },
  );
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
    expect(handoffDecision(routeSegments(CHAT)).kind !== 'none').toBe(true);
  });

  it('a reload (the navigation timing says so) reads sessionStorage', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' } as PerformanceEntry,
    ]);
    expect(handoffDecision(routeSegments(CHAT)).kind !== 'none').toBe(true);
  });

  it('a navigation (the navigation timing says so) ignores sessionStorage', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'navigate' } as PerformanceEntry,
    ]);
    expect(handoffDecision(routeSegments(CHAT)).kind !== 'none').toBe(false);
  });

  it('a browser with no navigation timing is read as a reload: sessionStorage is used', () => {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('unsupported');
    });
    expect(handoffDecision(routeSegments(CHAT)).kind !== 'none').toBe(true);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CaptureEnv,
  captureDemoHandoff,
  DEMO_HANDOFF_KEY,
  DEMO_HANDOFF_STASH,
  DEMO_QUESTION_MAX_BYTES,
  demoHandoff,
  isTrustedHandoff,
  isHandoffPath,
  liveHandoffSearch,
  parseHandoffSearch,
  resetDemoHandoffForTests,
  truncateToBytes,
} from './demo-handoff-capture';
import { handoffTargetOfPath, routeSegments } from './demo-handoff-path';

const ORIGIN = 'https://app.test';
/** The address that is given to history.replaceState: a path that starts with `//` needs its origin (review r2). */
const toReplaceState = (path: string): string =>
  (path.startsWith('//') ? ORIGIN : '') + path;

const bytes = (text: string): number => new TextEncoder().encode(text).length;

interface Fakes {
  env: CaptureEnv;
  replaced: string[];
  store: Map<string, string>;
  stash: Record<string, unknown>;
}

/** One page load: where it lands, what storage is left over from earlier loads, how the browser got here. */
function pageLoad(
  pathname: string,
  search: string,
  options: {
    hash?: string;
    store?: Map<string, string>;
    blocked?: 'none' | 'writes' | 'everything';
    navigation?: string;
    stashed?: string;
  } = {},
): Fakes {
  const store = options.store ?? new Map<string, string>();
  const replaced: string[] = [];
  const stash: Record<string, unknown> =
    options.stashed === undefined
      ? {}
      : { [DEMO_HANDOFF_STASH]: options.stashed };
  const blocked = options.blocked ?? 'none';
  const storage = {
    getItem: (key: string) =>
      blocked === 'everything' ? thrower() : (store.get(key) ?? null),
    setItem: (key: string, value: string) =>
      blocked === 'none' ? void store.set(key, value) : thrower(),
    removeItem: (key: string) =>
      blocked === 'none' ? void store.delete(key) : thrower(),
  } as unknown as Storage;
  const loc = {
    pathname,
    search,
    hash: options.hash ?? '',
    origin: ORIGIN,
  } as Location;
  const history = {
    state: { x: 1 },
    replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(url);
      // what the browser does: the address bar becomes what it was given
      const at = url.replace(ORIGIN, '');
      const hash = at.indexOf('#');
      const query = at.slice(0, hash < 0 ? undefined : hash).indexOf('?');
      (loc as { search: string }).search =
        query < 0 ? '' : at.slice(query, hash < 0 ? undefined : hash);
      (loc as { hash: string }).hash = hash < 0 ? '' : at.slice(hash);
    },
  } as unknown as History;
  const env: CaptureEnv = {
    location: loc,
    history,
    storage: () => (blocked === 'everything' ? thrower() : storage),
    stash,
    navigationType: () => options.navigation ?? 'navigate',
  };
  return { env, replaced, store, stash };
}

function thrower(): never {
  throw new Error('blocked');
}

describe('demo hand-off capture', () => {
  beforeEach(() => resetDemoHandoffForTests());

  describe('parsing (design doc 3.5, as G-0 needs it: the question and the language only)', () => {
    const q = 'Which countries listen to the most music per person?';
    const enc = encodeURIComponent(q);

    it('row 1: /demo?scenario=S&q=Q&lang=L keeps Q and L and drops the scenario', () => {
      expect(
        parseHandoffSearch(`?scenario=jazz-artists&q=${enc}&lang=ru`),
      ).toEqual({ question: q, lang: 'ru', truncated: false });
    });
    it('row 2: /demo?q=Q is Q in English', () => {
      expect(parseHandoffSearch(`?q=${enc}`)).toEqual({
        question: q,
        lang: 'en',
        truncated: false,
      });
    });
    it('row 3: scenario=custom is ignored like any other scenario', () => {
      expect(parseHandoffSearch(`?scenario=custom&q=${enc}&lang=en`)).toEqual({
        question: q,
        lang: 'en',
        truncated: false,
      });
    });
    it('row 4: a known scenario without q has no question (the scenario is ignored, not turned into one)', () => {
      for (const scenario of [
        'countries-music-per-capita',
        'sales-per-capita',
        'jazz-artists',
        'customer-artist-path',
      ]) {
        expect(parseHandoffSearch(`?scenario=${scenario}&lang=ru`)).toEqual({
          question: '',
          lang: 'ru',
          truncated: false,
        });
      }
    });
    it('row 5: an unknown scenario without q has no question', () => {
      expect(parseHandoffSearch('?scenario=whatever')).toEqual({
        question: '',
        lang: 'en',
        truncated: false,
      });
    });
    it('row 6: a bare /demo has no question', () => {
      expect(parseHandoffSearch('')).toEqual({
        question: '',
        lang: 'en',
        truncated: false,
      });
    });
    it('row 7: /demo?lang=L keeps only the language', () => {
      expect(parseHandoffSearch('?lang=ru')).toEqual({
        question: '',
        lang: 'ru',
        truncated: false,
      });
    });
    it('accepts msg, and msg wins over q when both are present', () => {
      expect(parseHandoffSearch('?msg=from+msg').question).toBe('from msg');
      expect(parseHandoffSearch('?q=from+q&msg=from+msg').question).toBe(
        'from msg',
      );
      expect(parseHandoffSearch('?msg=from+msg&q=from+q').question).toBe(
        'from msg',
      );
    });
    it('a blank msg does not hide a real q', () => {
      expect(parseHandoffSearch('?msg=%20%20&q=real').question).toBe('real');
    });
    it('lang other than en or ru is English; case and padding do not matter', () => {
      for (const lang of ['de', '', 'english', 'ru-RU', '<script>'])
        expect(parseHandoffSearch(`?lang=${lang}`).lang).toBe('en');
      expect(parseHandoffSearch('?lang=EN').lang).toBe('en');
      expect(parseHandoffSearch('?lang=RU').lang).toBe('ru');
      expect(parseHandoffSearch('?lang=%20ru%20').lang).toBe('ru');
    });
    it('ignores unknown parameters and takes the first of a repeated one', () => {
      expect(parseHandoffSearch('?utm_source=x&q=a&q=b&fbclid=1')).toEqual({
        question: 'a',
        lang: 'en',
        truncated: false,
      });
    });
    it('trims the question and drops control characters but keeps line breaks', () => {
      expect(parseHandoffSearch('?q=%20%20a%00b%07c%0Ad%20%20').question).toBe(
        'abc\nd',
      );
    });
    it('collapses runs of blank lines into one and trims, keeping a single blank line', () => {
      const q = (text: string) =>
        parseHandoffSearch('?q=' + encodeURIComponent(text)).question;
      expect(q('a\n\n\n\nb')).toBe('a\n\nb');
      expect(q('a\n\nb')).toBe('a\n\nb');
      expect(q('a\nb')).toBe('a\nb');
      expect(q('a\n \t\n  \n\nb')).toBe('a\n\nb');
      expect(q('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb');
      expect(q('\n\n\n  hello \n\n\n')).toBe('hello');
      expect(q('a\n\n\n\n' + 'b\n\n\n\nc')).toBe('a\n\nb\n\nc');
    });
    it('survives a malformed percent sequence', () => {
      expect(parseHandoffSearch('?q=100%25%ZZ%E0%A4').question).toContain(
        '100%',
      );
    });
  });

  describe('truncation at 1000 UTF-8 bytes on a character boundary', () => {
    it('keeps exactly 1000 bytes of ASCII and cuts the 1001st', () => {
      expect(truncateToBytes('a'.repeat(1000), 1000)).toEqual({
        text: 'a'.repeat(1000),
        truncated: false,
      });
      expect(truncateToBytes('a'.repeat(1001), 1000)).toEqual({
        text: 'a'.repeat(1000),
        truncated: true,
      });
    });
    it('cuts Cyrillic (2 bytes per letter) at 500 letters', () => {
      const cut = truncateToBytes('ж'.repeat(700), 1000);
      expect(cut.text).toBe('ж'.repeat(500));
      expect(bytes(cut.text)).toBe(1000);
      expect(cut.truncated).toBe(true);
    });
    it('cuts emoji (4 bytes, a surrogate pair each) at 250 and never splits a pair', () => {
      const cut = truncateToBytes('😀'.repeat(300), 1000);
      expect(cut.text).toBe('😀'.repeat(250));
      expect(bytes(cut.text)).toBe(1000);
      const odd = truncateToBytes('a' + '😀'.repeat(300), 1000);
      expect(odd.text).toBe('a' + '😀'.repeat(249));
      expect(bytes(odd.text)).toBe(997);
      expect(new TextDecoder().decode(new TextEncoder().encode(odd.text))).toBe(
        odd.text,
      );
    });
    it('never leaves a half character when the boundary falls inside one', () => {
      const text = 'a'.repeat(999) + 'ж';
      expect(truncateToBytes(text, 1000)).toEqual({
        text: 'a'.repeat(999),
        truncated: true,
      });
    });
    it('parseHandoffSearch applies the bound and reports it', () => {
      const parsed = parseHandoffSearch(
        '?q=' + encodeURIComponent('Ж'.repeat(900)),
      );
      expect(bytes(parsed.question)).toBeLessThanOrEqual(
        DEMO_QUESTION_MAX_BYTES,
      );
      expect(parsed.question).toBe('Ж'.repeat(500));
      expect(parsed.truncated).toBe(true);
    });
  });

  describe('which paths are hand-off paths', () => {
    it('accepts /demo and the project chat of any GitHub project, with or without a trailing slash', () => {
      for (const path of [
        '/demo',
        '/demo/',
        '/project/github.com/datatug/chinook-demo/chat',
        '/project/github.com/o/r/chat/',
        '/project/github.com/o/r/tree/abc123/-/chat',
        '/project/github.com/o/r/tree/HEAD/-/chat/',
      ]) {
        expect(isHandoffPath(path)).toBe(true);
      }
    });
    it('ignores matrix parameters, as the router does', () => {
      for (const path of [
        '/demo;x=1',
        '/demo;x=1/',
        '/demo;a=1;b=2',
        '/project/github.com/o/r/chat;x=1',
        '/project/github.com;x=1/o;y=2/r/chat',
        '/project/github.com/o/r/tree;a=1/abc123/-;b=2/chat',
      ]) {
        expect(isHandoffPath(path), path).toBe(true);
      }
    });
    it('matches the literal segments in any letter case', () => {
      for (const path of [
        '/Demo',
        '/DEMO/',
        '/dEmO;x=1',
        '/Project/GitHub.com/o/r/Chat',
        '/PROJECT/GITHUB.COM/o/r/TREE/abc/-/CHAT',
        '/%64emo',
      ]) {
        expect(isHandoffPath(path), path).toBe(true);
      }
    });
    it('rejects everything else', () => {
      for (const path of [
        '/',
        '',
        '/demos',
        '/demo/other',
        '/demo//',
        '/demo;x=1/other',
        '/;x=1',
        '/chat',
        '/hello-world',
        '/store/github.com/project/p/chat',
        '/project/github.com/o/r',
        '/project/github.com/o/r/chat/x',
        '/project/github.com/o/chat',
        '/project/gitlab.com/o/r/chat',
        '/project/github.com//r/chat',
        '/project/github.com/o/r/tree/abc123/chat',
        '/project/github.com/o/r/tree/abc123/dir/-/chat',
        '/project/github.com/o/r/tree/-/chat',
        '/project/github.com/o/r/tree//-/chat',
        '/demo(menu:x)',
        '/demo/(menu:x)',
        '/Demo(menu:x/y)',
        '/project/github.com/o/r/chat(menu:x)',
      ]) {
        expect(isHandoffPath(path), path).toBe(false);
      }
    });
  });

  describe('capture', () => {
    const search =
      '?scenario=countries-music-per-capita&q=Which+countries&lang=ru';

    it('keeps the question in memory, in sessionStorage, and removes the whole query from the address bar', () => {
      const f = pageLoad('/demo', search, { hash: '#x' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual(['/demo#x']);
      expect(demoHandoff(undefined, '/demo')).toEqual({
        question: 'Which countries',
        lang: 'ru',
        truncated: false,
      });
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe('/demo' + search); // path and raw query string, parsed again on read
    });

    it('works for the project chat shape with msg', () => {
      const f = pageLoad(
        '/project/github.com/datatug/chinook-demo/chat',
        '?msg=Hello&q=ignored',
      );
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([
        '/project/github.com/datatug/chinook-demo/chat',
      ]);
      expect(
        demoHandoff(undefined, '/project/github.com/datatug/chinook-demo/chat')
          ?.question,
      ).toBe('Hello');
    });

    // review r2, B1: spellings of the address that the router reads as a hand-off address
    describe('an address written another way (review r2, B1)', () => {
      it.each([
        ['//project/github.com/datatug/chinook-demo/chat', true],
        ['//project/github.com/acme/demo/chat', false],
        ['///project/github.com/datatug/chinook-demo/tree/HEAD/-/chat', true],
        ['/(project/github.com/datatug/chinook-demo/chat)', true],
        ['/(project/github.com/acme/demo/chat)', false],
        ['//demo', true],
        ['/(demo)', true],
      ])(
        '%s: the query is taken out of the address (a `//` path with its origin), kept for the page, and shown back only where the address may echo it',
        (path, shown) => {
          const f = pageLoad(path, '?msg=Hello&lang=ru', { hash: '#x' });
          captureDemoHandoff(f.env);
          expect(f.replaced).toEqual([toReplaceState(path) + '#x']);
          expect(demoHandoff(undefined, path)?.question).toBe(
            shown ? 'Hello' : '',
          );
          expect(demoHandoff(undefined, path)?.lang).toBe('ru');
        },
      );

      it('what the script kept under the typed path is found again under the path the router has put there since', () => {
        const typed = '//project/github.com/datatug/chinook-demo/chat';
        const first = pageLoad(typed, '?msg=Hello');
        captureDemoHandoff(first.env);
        resetDemoHandoffForTests();
        const reload = pageLoad(
          '/project/github.com/datatug/chinook-demo/chat',
          '',
          { store: first.store, navigation: 'reload' },
        );
        captureDemoHandoff(reload.env);
        expect(
          demoHandoff(
            () => reload.env.storage(),
            '/project/github.com/datatug/chinook-demo/chat',
          )?.question,
        ).toBe('Hello');
        // another address is another address
        expect(
          demoHandoff(
            () => reload.env.storage(),
            '/project/github.com/datatug/other-demo/chat',
          ),
        ).toBeUndefined();
      });
    });

    it('takes the query the inline script of index.html stashed, and forgets the stash', () => {
      const f = pageLoad('/demo', '', { stashed: '?q=From+the+stash&lang=ru' });
      captureDemoHandoff(f.env);
      expect(demoHandoff(undefined, '/demo')).toEqual({
        question: 'From the stash',
        lang: 'ru',
        truncated: false,
      });
      expect(f.replaced).toEqual([]); // the inline script already stripped it
      expect(DEMO_HANDOFF_STASH in f.stash).toBe(false);
    });

    it.each(['writes', 'everything'] as const)(
      'removes the query from the address bar even when storage is blocked (%s)',
      (blocked) => {
        const f = pageLoad('/demo', search, { blocked });
        expect(() => captureDemoHandoff(f.env)).not.toThrow();
        expect(f.replaced).toEqual(['/demo']);
        expect(demoHandoff(() => thrower(), '/demo')?.question).toBe(
          'Which countries',
        ); // still in memory for this load
        expect(f.store.size).toBe(0);
      },
    );

    it('does not fail when the browser refuses to rewrite the address: the question is still held and shown', () => {
      const f = pageLoad('/demo', search);
      (f.env.history as { replaceState: () => void }).replaceState = () => {
        throw new DOMException('refused', 'SecurityError');
      };
      expect(() => captureDemoHandoff(f.env)).not.toThrow();
      expect(demoHandoff(undefined, '/demo')?.question).toBe('Which countries');
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe('/demo' + search);
    });

    it.each([
      '/demo;x=1',
      '/Demo',
      '/DEMO/',
      '/project/github.com/datatug/chinook-demo/chat;x=1',
      '/PROJECT/github.com/o/r/Chat',
    ])('strips the query for %s as well (the router matches it)', (path) => {
      const f = pageLoad(path, search);
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([path]);
      expect(demoHandoff(undefined, path)?.question).toBe(
        isTrustedHandoff(path) ? 'Which countries' : '',
      );
    });

    it('leaves every other path alone, whatever its query', () => {
      for (const [path, query] of [
        ['/', '?q=x'],
        ['/demo/other', '?q=x'],
        ['/demo;x=1/other', '?q=x'],
        ['/demo(menu:x)', '?q=x'],
        ['/store/x/project/y/chat', '?scenario=a'],
        ['/no-such-route', '?q=x'],
      ]) {
        const f = pageLoad(path, query);
        captureDemoHandoff(f.env);
        expect(f.store.size).toBe(0);
        expect(f.replaced).toEqual([]);
        expect(demoHandoff(undefined, path)).toBeUndefined();
      }
    });

    it('a bare /demo has nothing to strip and keeps no question', () => {
      const f = pageLoad('/demo', '');
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([]);
      expect(demoHandoff(undefined, '/demo')).toBeUndefined();
    });

    it('strips a query that holds no question, and an earlier question is replaced, not shown', () => {
      const store = new Map([[DEMO_HANDOFF_KEY, '/demo?q=old']]);
      const f = pageLoad('/demo', '?scenario=jazz-artists&lang=ru', { store });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual(['/demo']);
      expect(demoHandoff(undefined, '/demo')).toEqual({
        question: '',
        lang: 'ru',
        truncated: false,
      });
      expect(store.get(DEMO_HANDOFF_KEY)).toBe(
        '/demo?scenario=jazz-artists&lang=ru',
      );
    });

    describe('a reload', () => {
      it('shows the same question again, from the copy kept for the tab (the question is not asked twice)', () => {
        const first = pageLoad('/demo', search);
        captureDemoHandoff(first.env);
        const replacedByFirst = [...first.replaced];
        resetDemoHandoffForTests(); // the page load ends: module memory is gone

        const reload = pageLoad('/demo', '', {
          store: first.store,
          navigation: 'reload',
        });
        captureDemoHandoff(reload.env);
        expect(reload.replaced).toEqual([]); // the address bar was clean already
        expect(demoHandoff(() => reload.env.storage(), '/demo')).toEqual({
          question: 'Which countries',
          lang: 'ru',
          truncated: false,
        });
        expect(replacedByFirst).toEqual(['/demo']);
      });

      it('shows the no-question copy rather than failing when storage is blocked after a reload', () => {
        const reload = pageLoad('/demo', '', {
          blocked: 'everything',
          navigation: 'reload',
        });
        expect(() => captureDemoHandoff(reload.env)).not.toThrow();
        expect(
          demoHandoff(() => reload.env.storage(), '/demo'),
        ).toBeUndefined();
      });

      it('a fresh visit to the bare path in the same tab does not show the previous question', () => {
        const first = pageLoad('/demo', search);
        captureDemoHandoff(first.env);
        resetDemoHandoffForTests();
        const fresh = pageLoad('/demo', '', {
          store: first.store,
          navigation: 'navigate',
        });
        captureDemoHandoff(fresh.env);
        expect(demoHandoff(() => fresh.env.storage(), '/demo')).toBeUndefined();
      });

      it('back/forward keeps the question like a reload', () => {
        const first = pageLoad('/demo', search);
        captureDemoHandoff(first.env);
        resetDemoHandoffForTests();
        const back = pageLoad('/demo', '', {
          store: first.store,
          navigation: 'back_forward',
        });
        captureDemoHandoff(back.env);
        expect(demoHandoff(() => back.env.storage(), '/demo')?.question).toBe(
          'Which countries',
        );
      });
    });

    describe('what is read back from sessionStorage is parsed like any query string', () => {
      const read = (value: string | null) =>
        demoHandoff(
          () => ({ getItem: () => value }) as unknown as Storage,
          '/demo',
        );
      it('nothing stored is no hand-off', () => {
        expect(read(null)).toBeUndefined();
        expect(read('')).toBeUndefined();
      });
      it('applies the 1000-byte bound and strips control characters', () => {
        const got = read(
          '/demo?q=' + encodeURIComponent('ж'.repeat(900) + '\u0000'),
        );
        expect(got?.question).toBe('ж'.repeat(500));
        expect(got?.truncated).toBe(true);
      });
      it('what was kept for another path is not applied', () => {
        expect(read('/demo/other?q=x')).toBeUndefined();
        expect(read('/project/github.com/o/r/chat?q=x')).toBeUndefined();
        expect(read('not a stored value')).toBeUndefined();
      });
      it('junk is a hand-off without a question, never an error', () => {
        expect(read('/demo?not a query')).toEqual({
          question: '',
          lang: 'en',
          truncated: false,
        });
      });
    });
  });

  // Founder ruling 2026-10-03: the question travels after `#`, on a page of its own.
  describe('capture of the start-chat address (founder ruling 2026-10-03)', () => {
    const TRUSTED = '/project/github.com/datatug/chinook-demo/start-chat';
    const OTHER = '/project/github.com/acme/demo/start-chat';
    const M = 'Which countries listen most?';

    it('takes msg and lang from the fragment, removes the fragment, and keeps them for this tab', () => {
      const f = pageLoad(TRUSTED, '', { hash: '#msg=Which+countries+listen+most%3F&lang=ru' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([TRUSTED]);
      expect(demoHandoff(undefined, TRUSTED)).toEqual({ question: M, lang: 'ru', truncated: false });
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe(TRUSTED + '?msg=Which+countries+listen+most%3F&lang=ru');
    });

    it('q is an alias of msg, in the fragment and in the query', () => {
      for (const [search, hash] of [['', '#q=Hello'], ['?q=Hello', '']]) {
        resetDemoHandoffForTests();
        const f = pageLoad(TRUSTED, search, { hash });
        captureDemoHandoff(f.env);
        expect(demoHandoff(undefined, TRUSTED)?.question, search + hash).toBe('Hello');
      }
    });

    it('takes them from the query too (the form post of a site with no script), keeping the other query keys', () => {
      const f = pageLoad(TRUSTED, '?utm_source=x&msg=Hello&lang=ru&a=1', {});
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([TRUSTED + '?utm_source=x&a=1']);
      expect(demoHandoff(undefined, TRUSTED)).toEqual({ question: 'Hello', lang: 'ru', truncated: false });
    });

    it('the fragment wins over the query, and the whole fragment goes, other content included', () => {
      const f = pageLoad(TRUSTED, '?msg=FromQuery&x=1', { hash: '#msg=FromFragment&top' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([TRUSTED + '?x=1']);
      expect(demoHandoff(undefined, TRUSTED)?.question).toBe('FromFragment');
    });

    it('a fragment with no question is removed too, and nothing is kept', () => {
      const f = pageLoad(TRUSTED, '?x=1', { hash: '#top' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([TRUSTED + '?x=1']);
      expect(f.store.size).toBe(0);
    });

    it('an address with nothing to strip is not rewritten', () => {
      const f = pageLoad(TRUSTED, '?x=1', {});
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([]);
    });

    it('a path that starts with // is rewritten with its origin, as replaceState needs', () => {
      const f = pageLoad('/' + TRUSTED, '', { hash: '#msg=Hello' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([ORIGIN + '/' + TRUSTED]);
      expect(demoHandoff(undefined, '/' + TRUSTED)?.question).toBe('Hello');
    });

    it('takes what the inline script stashed, and there is nothing left to strip', () => {
      const f = pageLoad(TRUSTED, '', { stashed: '?msg=Hello&lang=ru' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([]);
      expect(f.stash[DEMO_HANDOFF_STASH]).toBeUndefined();
      expect(demoHandoff(undefined, TRUSTED)).toEqual({ question: 'Hello', lang: 'ru', truncated: false });
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe(TRUSTED + '?msg=Hello&lang=ru');
    });

    it('another repository gets neutral wording: the question is dropped, the language kept, a mark stored', () => {
      const f = pageLoad(OTHER, '', { hash: '#msg=Hello&lang=ru' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([OTHER]);
      expect(demoHandoff(undefined, OTHER)).toEqual({ question: '', lang: 'ru', truncated: false });
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe(OTHER + '?lang=ru&asked=1');
      expect(JSON.stringify([...f.store])).not.toContain('Hello');
    });

    it('a folder or another ref of the demo repository is not trusted either', () => {
      for (const path of [
        '/project/github.com/datatug/chinook-demo/tree/abc123/-/start-chat',
        '/project/github.com/datatug/chinook-demo/tree/HEAD/sub/-/start-chat',
      ]) {
        resetDemoHandoffForTests();
        expect(isTrustedHandoff(path), path).toBe(false);
        const f = pageLoad(path, '', { hash: '#msg=Hello' });
        captureDemoHandoff(f.env);
        expect(demoHandoff(undefined, path)?.question, path).toBe('');
      }
      expect(isTrustedHandoff('/project/github.com/datatug/chinook-demo/tree/HEAD/-/start-chat')).toBe(true);
    });

    it('a reload shows the same question from the tab store; a fresh visit to the bare address shows none', () => {
      const first = pageLoad(TRUSTED, '', { hash: '#msg=Hello' });
      captureDemoHandoff(first.env);
      resetDemoHandoffForTests();
      const reload = pageLoad(TRUSTED, '', { store: first.store, navigation: 'reload' });
      captureDemoHandoff(reload.env);
      expect(demoHandoff(() => reload.env.storage(), TRUSTED)?.question).toBe('Hello');
      resetDemoHandoffForTests();
      const fresh = pageLoad(TRUSTED, '', { store: first.store, navigation: 'navigate' });
      captureDemoHandoff(fresh.env);
      expect(demoHandoff(() => fresh.env.storage(), TRUSTED)).toBeUndefined();
    });

    it('is still stripped when storage is blocked, and the question lives in memory for this load', () => {
      const f = pageLoad(TRUSTED, '', { hash: '#msg=Hello', blocked: 'everything' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([TRUSTED]);
      expect(demoHandoff(() => f.env.storage(), TRUSTED)?.question).toBe('Hello');
    });

    it('liveHandoffSearch: the hand-off keys of the fragment and query of a start-chat address, the query elsewhere', () => {
      const at = (pathname: string, search: string, hash: string) => ({ pathname, search, hash }) as Location;
      expect(liveHandoffSearch(at(TRUSTED, '?utm_source=x', ''))).toBe('');
      expect(liveHandoffSearch(at(TRUSTED, '', '#top'))).toBe('');
      expect(liveHandoffSearch(at(TRUSTED, '?x=1&q=A', '#msg=B&lang=ru'))).toBe('?msg=B&lang=ru&q=A');
      expect(liveHandoffSearch(at('/demo', '?q=A', '#x'))).toBe('?q=A');
      expect(liveHandoffSearch(at('/queries', '?q=A', ''))).toBe('?q=A');
    });

    it('a start-chat address is a hand-off path for every spelling the router reads as one; /chat with a fragment is not touched', () => {
      for (const path of [TRUSTED, TRUSTED + '/', TRUSTED + ';x=1', '/(' + TRUSTED.slice(1) + ')']) {
        expect(handoffTargetOfPath(path)?.kind, path).toBe('start-chat');
      }
      const f = pageLoad('/project/github.com/datatug/chinook-demo/chat', '', { hash: '#msg=Hello' });
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([]);
    });
  });

  describe('which hand-offs are shown back (isTrustedHandoff)', () => {
    it.each([
      '/demo',
      '/demo/',
      '/project/github.com/datatug/chinook-demo/chat',
      '/project/github.com/datatug/chinook-demo/chat/',
      '/project/github.com/Datatug/Chinook-Demo/chat',
      '/project/github.com/DATATUG/CHINOOK-DEMO/chat',
      '/project/github.com/datatug/chinook%2Ddemo/chat',
      '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
      '/Demo',
      '/demo;x=1',
      '/PROJECT/GITHUB.COM/datatug/chinook-demo/CHAT',
      '/project/github.com/datatug/chinook-demo/chat;x=1',
    ])('%s is trusted', (path) => {
      expect(isTrustedHandoff(path)).toBe(true);
    });

    it.each([
      '/project/github.com/datatug/chinook-demo-evil/chat',
      '/project/github.com/datatug/chinook-demo-/chat',
      '/project/github.com/datatug/xchinook-demo/chat',
      '/project/github.com/datatug-evil/chinook-demo/chat',
      '/project/github.com/evil/chinook-demo/chat',
      '/project/github.com/datatug/other/chat',
      '/project/github.com/someone/else/chat',
      '/project/github.com/datatug/chinook-demo/tree/abc1234def5678/-/chat',
      '/project/github.com/datatug/chinook-demo/tree/main/-/chat',
      '/project/github.com/datatug/chinook-demo/tree/head/-/chat',
      '/project/github.com/datatug%2Fchinook-demo/x/chat',
      '/project/github.com/datatug/chinook-demo%2Fx/chat',
      '/project/github.com/%E0%A4%A/chinook-demo/chat',
      '/project/github.com/datatug/chinook-demo',
      '/project/github.com/datatug/chinook-demo/chat/extra',
      '/project/gitlab.com/datatug/chinook-demo/chat',
      '/demo/other',
      '/',
    ])('%s is not trusted', (path) => {
      expect(isTrustedHandoff(path)).toBe(false);
    });

    // Issue #180: `toLowerCase()` turns the Kelvin sign U+212A into the ASCII `k`, so a trust decision on the
    // lower-cased text would have accepted `chinooK-demo` (live on main). The decision is on the parsed address:
    // owner and repo are ASCII, lower-cased A-Z only, and compared for exact equality.
    describe('look-alike letters are never trusted (the Kelvin sign U+212A)', () => {
      const KELVIN = '\u212A';

      it('is the character the old check mistook for k', () => {
        expect(KELVIN.toLowerCase()).toBe('k');
      });

      it.each([
        `/project/github.com/datatug/chinoo${KELVIN}-demo/chat`,
        `/project/github.com/datatug/CHINOO${KELVIN}-DEMO/chat`,
        `/project/github.com/datatug/chinoo%E2%84%AA-demo/chat`,
        `/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat`.replace('chinook', `chinoo${KELVIN}`),
        `/project/github.com/dataTUG/chinoo${KELVIN}-demo/chat`,
        `/project/github.com/${KELVIN}datatug/chinook-demo/chat`,
        `/project/github.com/datatug${KELVIN}/chinook-demo/chat`,
        `/project/github.com/datatug/chinook-demo${KELVIN}/chat`,
      ])('%s is not trusted', (path) => {
        expect(isHandoffPath(path)).toBe(true);
        expect(isTrustedHandoff(path)).toBe(false);
      });

      it('drops the question of such an address, keeps the language, and still strips the address bar', () => {
        const path = `/project/github.com/datatug/chinoo${KELVIN}-demo/chat`;
        const f = pageLoad(path, '?msg=Hello+there&lang=ru');
        captureDemoHandoff(f.env);
        expect(f.replaced).toEqual([path]);
        expect(demoHandoff(undefined, path)).toEqual({
          question: '',
          lang: 'ru',
          truncated: false,
        });
        expect(JSON.stringify([...f.store])).not.toContain('Hello');
      });

      it('plain ASCII spellings of the same repository are still trusted', () => {
        expect(isTrustedHandoff('/project/github.com/datatug/chinook-demo/chat')).toBe(true);
        expect(isTrustedHandoff('/project/github.com/DataTug/Chinook-Demo/chat')).toBe(true);
      });
    });

    const msg = '?msg=Hello+there&lang=ru';

    it.each([
      '/project/github.com/datatug/chinook-demo/chat',
      '/project/github.com/Datatug/Chinook-Demo/chat',
      '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
    ])('a trusted chat address (%s) keeps the question', (path) => {
      const f = pageLoad(path, msg);
      captureDemoHandoff(f.env);
      expect(f.replaced).toEqual([path]);
      expect(demoHandoff(undefined, path)).toEqual({
        question: 'Hello there',
        lang: 'ru',
        truncated: false,
      });
      expect(f.store.get(DEMO_HANDOFF_KEY)).toBe(path + msg);
    });

    it.each([
      '/project/github.com/someone/else/chat',
      '/project/github.com/datatug/chinook-demo-evil/chat',
      '/project/github.com/datatug/chinook-demo/tree/abc1234def5678/-/chat',
    ])(
      'any other address (%s) drops the question, keeps the language, and still strips the address bar',
      (path) => {
        const f = pageLoad(path, msg);
        captureDemoHandoff(f.env);
        expect(f.replaced).toEqual([path]);
        expect(demoHandoff(undefined, path)).toEqual({
          question: '',
          lang: 'ru',
          truncated: false,
        });
        expect(JSON.stringify([...f.store])).not.toContain('Hello');
        expect(f.store.get(DEMO_HANDOFF_KEY)).toBe(path + '?lang=ru&asked=1');
      },
    );

    it('after a reload an untrusted address still shows no question, even if storage holds one (it was stored by index.html)', () => {
      const path = '/project/github.com/someone/else/chat';
      const store = new Map([[DEMO_HANDOFF_KEY, path + msg]]);
      const reload = pageLoad(path, '', { store, navigation: 'reload' });
      captureDemoHandoff(reload.env);
      expect(demoHandoff(() => reload.env.storage(), path)).toEqual({
        question: '',
        lang: 'ru',
        truncated: false,
      });
    });

    it('a question captured on /demo is not shown on another repository chat address', () => {
      const demo = pageLoad('/demo', '?q=Mine');
      captureDemoHandoff(demo.env);
      expect(
        demoHandoff(
          () => demo.env.storage(),
          '/project/github.com/someone/else/chat',
        ),
      ).toMatchObject({ question: '' });
    });

    it('blocked storage wins: after a reload on a trusted address nothing is shown', () => {
      const path = '/project/github.com/datatug/chinook-demo/chat';
      const first = pageLoad(path, msg);
      captureDemoHandoff(first.env);
      resetDemoHandoffForTests();
      const reload = pageLoad(path, '', {
        store: first.store,
        blocked: 'everything',
        navigation: 'reload',
      });
      expect(() => captureDemoHandoff(reload.env)).not.toThrow();
      expect(demoHandoff(() => reload.env.storage(), path)).toBeUndefined();
    });
  });

  describe("index.html's inline stash script", () => {
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    const script =
      /<script id="datatug-handoff-stash">([\s\S]*?)<\/script>/.exec(html)?.[1];

    function run(
      pathname: string,
      search: string,
      hash = '',
      blocked = false,
      refuseReplace = false,
    ) {
      const replaced: string[] = [];
      const win: Record<string, unknown> = {};
      const kept = new Map<string, string>();
      const sessionStorage = {
        setItem: (key: string, value: string) =>
          blocked ? thrower() : void kept.set(key, value),
      };
      const location = { pathname, search, hash, origin: ORIGIN };
      const history = {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => {
          if (refuseReplace) throw new DOMException('refused', 'SecurityError');
          replaced.push(url);
        },
      };
      new Function(
        'location',
        'history',
        'window',
        'sessionStorage',
        script ?? '',
      )(location, history, win, sessionStorage);
      return { replaced, stash: win[DEMO_HANDOFF_STASH], kept };
    }

    it('exists in index.html, ahead of the Google Analytics snippet', () => {
      expect(script).toBeTruthy();
      expect(html.indexOf('datatug-handoff-stash')).toBeLessThan(
        html.indexOf('googletagmanager'),
      );
    });

    it('acts on exactly the paths isHandoffPath accepts', () => {
      const paths = [
        '/demo',
        '/demo/',
        '/demos',
        '/demo/other',
        '/demo//',
        '/Demo',
        '/DEMO/',
        '/%64emo',
        '/demo;x=1',
        '/demo;x=1/',
        '/demo;x=1/other',
        '/demo(menu:x)',
        '/demo/(menu:x)',
        '/Demo(menu:x/y)',
        '/project/github.com/o/r/chat(menu:x)',
        '/project/github.com/a%28b/r/chat',
        '/;x=1',
        '/',
        '/chat',
        '/hello-world',
        '/store/github.com/project/p/chat',
        '/project/github.com/datatug/chinook-demo/chat',
        '/project/github.com/o/r/chat/',
        '/project/github.com/o/r/chat;x=1',
        '/project/github.com;x=1/o;y=2/r/chat',
        '/Project/GitHub.com/o/r/Chat',
        '/project/github.com/o/r',
        '/project/github.com/o/r/chat/x',
        '/project/github.com/o/chat',
        '/project/gitlab.com/o/r/chat',
        '/project/github.com//r/chat',
        '/project/github.com/o/r/tree/abc123/-/chat',
        '/project/github.com/o/r/tree;a=1/abc123/-;b=2/chat',
        '/PROJECT/GITHUB.COM/o/r/TREE/abc123/-/CHAT',
        '/project/github.com/o/r/tree/abc123/chat',
        '/project/github.com/o/r/tree/abc123/dir/-/chat',
        '/project/github.com/o/r/tree//-/chat',
        '/project/github.com/o%2Fx/r/chat',
        '/project/github.com/%E0%A4%A/r/chat',
        // review r2: spellings that the router's parser reads as the same address
        '//demo',
        '///demo/',
        '/(demo)',
        '/(Demo;x=1)/',
        '/(demo//menu:x)',
        '/(demo)(menu:x)',
        '/(demo/other)',
        '/demo//other',
        '/demo///',
        '//project/github.com/datatug/chinook-demo/chat',
        '///project/github.com/o/r/chat/',
        '/(project/github.com/o/r/chat)',
        '/(PROJECT/github.com/acme/demo/tree/HEAD/-/chat)',
        '/(project/github.com/o/r/chat//menu:x)',
        '/(project/github.com/o/r/queries)',
        '//project/github.com/o/r/queries',
        '///project/github.com/o/r',
        '/project//github.com/o/r/chat',
        '/project/github.com/o/r//chat',
        '/project/github.com/o/r/tree/HEAD/a(b)/-/chat',
      ];
      // Every other address under /project/github.com loses `msg` and `q` only (review S2): nothing is stashed
      // or kept for it, and the rest of its query stays. ("Under" as the router's parser reads the path.)
      const underProject = (path: string) => {
        const [first = '', second = ''] = routeSegments(path).map((s) =>
          s.toLowerCase(),
        );
        return first === 'project' && second.split('(')[0] === 'github.com';
      };
      for (const path of paths) {
        const result = run(path, '?q=x&lang=ru', '#h');
        expect(result.stash !== undefined, path).toBe(isHandoffPath(path));
        const startChat = handoffTargetOfPath(path)?.kind === 'start-chat';
        expect(result.replaced, path).toEqual(
          startChat
            ? [toReplaceState(path)] // the fragment goes too: it is where a start-chat question travels
            : isHandoffPath(path)
            ? [toReplaceState(path) + '#h']
            : underProject(path)
              ? [toReplaceState(path) + '?lang=ru#h']
              : [],
        );
        if (!isHandoffPath(path)) expect(result.kept, path).toEqual(new Map());
      }
    });

    describe('every other address under /project/github.com loses msg and q, and only those (review S2)', () => {
      it.each([
        // [path, search, hash, what the address becomes]
        [
          '/project/github.com/o/r?msg=M&x=1',
          '/project/github.com/o/r?x=1',
        ],
        [
          '/project/github.com/o/r/tree/HEAD/dir/-/chat?msg=M',
          '/project/github.com/o/r/tree/HEAD/dir/-/chat',
        ],
        [
          '/project/github.com/o/r/queries?msg=M',
          '/project/github.com/o/r/queries',
        ],
        ['/project/github.com/o/r/queries?q=M&b=2', '/project/github.com/o/r/queries?b=2'],
        ['/Project/GitHub.com/o/r/Queries?a=1&MSG=keep&msg=M&q=N', '/Project/GitHub.com/o/r/Queries?a=1&MSG=keep'],
        ['/project/github.com/o/r/chat/extra?msg=M&lang=ru', '/project/github.com/o/r/chat/extra?lang=ru'],
        ['/project/github.com/o/r/queries?m%73g=M&x=%20y', '/project/github.com/o/r/queries?x=%20y'],
        ['/project/github.com/o/r/queries?%71=M&x=1', '/project/github.com/o/r/queries?x=1'],
        ['/project/github.com/o/r/queries?msg&x=1', '/project/github.com/o/r/queries?x=1'],
        ['/project/github.com/o/r/queries?msg=A&msg=B&q=C', '/project/github.com/o/r/queries'],
        ['/project/github.com/o/r;m=1/queries?msg=M', '/project/github.com/o/r;m=1/queries'],
        ['/project/github.com/o/r/queries?x=1&&y=2&msg=M', '/project/github.com/o/r/queries?x=1&&y=2'],
      ])('%s becomes %s', (path, becomes) => {
        const [bare, query] = path.split('?');
        const result = run(bare, '?' + query, '#h');
        expect(result.replaced).toEqual([becomes + '#h']);
        expect(result.stash).toBeUndefined();
        expect(result.kept).toEqual(new Map());
        // and what is left has neither, as the parser of the app reads a query
        const left = new URLSearchParams(
          result.replaced[0].split('#')[0].split('?')[1] ?? '',
        );
        expect(left.has('msg')).toBe(false);
        expect(left.has('q')).toBe(false);
      });

      it.each([
        '/project/github.com/o/r?x=1&MSG=1&Q=2&msgx=3&xq=4',
        '/project/github.com/o/r/queries?lang=ru',
      ])('%s: nothing to take out, so the address is not rewritten', (path) => {
        const [bare, query] = path.split('?');
        expect(run(bare, '?' + query, '#h').replaced).toEqual([]);
      });

      it.each([
        '/no-such-route?msg=M',
        '/queries?q=M',
        '/store/github.com/project/p@o@/chat?msg=M',
        '/project/gitlab.com/o/r?msg=M',
        '/projects/github.com/o/r?msg=M',
        '/demo/other?q=M',
        '/',
      ])('%s is left exactly as it is', (path) => {
        const [bare, query] = path.split('?');
        const result = run(bare, '?' + query, '#h');
        expect(result.replaced).toEqual([]);
        expect(result.stash).toBeUndefined();
      });

      it('does nothing for an address with no query at all', () => {
        expect(run('/project/github.com/o/r/queries', '').replaced).toEqual([]);
      });

      it('does not throw when the browser refuses to rewrite the address', () => {
        expect(() =>
          run('/project/github.com/o/r', '?msg=M', '', false, true),
        ).not.toThrow();
      });

      it('a hand-off address is handled as before: the whole query goes, the question is stashed and kept', () => {
        const result = run(
          '/project/github.com/o/r/chat',
          '?msg=M&lang=ru&x=1',
          '#h',
        );
        expect(result.replaced).toEqual(['/project/github.com/o/r/chat#h']);
        expect(result.stash).toBe('?msg=M&lang=ru&x=1');
        expect(result.kept).toEqual(
          new Map([[DEMO_HANDOFF_KEY, '/project/github.com/o/r/chat?msg=M&lang=ru&x=1']]),
        );
      });
    });

    // review r2, B1: the script read these addresses differently from the router, so the question stayed in the
    // address bar and the history, and went to analytics
    describe('an address that the router reads as a hand-off address is one for the script too (review r2, B1)', () => {
      it.each([
        '//demo',
        '///demo/',
        '/(demo)',
        '/(Demo;x=1)',
        '//project/github.com/datatug/chinook-demo/chat',
        '//project/github.com/acme/demo/chat',
        '///project/github.com/acme/demo/chat/',
        '/(project/github.com/datatug/chinook-demo/chat)',
        '/(project/github.com/acme/demo/chat)',
        '/(project/github.com/acme/demo/chat)/',
        '/(Project/GitHub.com/acme/demo/tree/HEAD/-/chat)',
        '//project/github.com/acme/demo/tree/HEAD/-/chat',
        '/project/github.com/acme/demo/Tree/HEAD/-/chat',
      ])('%s: the question is stashed, kept for a reload, and out of the address bar', (path) => {
        expect(isHandoffPath(path)).toBe(true);
        const result = run(path, '?msg=Q&lang=ru', '#h');
        expect(result.stash).toBe('?msg=Q&lang=ru');
        expect(result.replaced).toEqual([toReplaceState(path) + '#h']);
        expect(result.kept).toEqual(
          new Map([[DEMO_HANDOFF_KEY, path.replace(/\/$/, '') + '?msg=Q&lang=ru']]),
        );
      });

      it.each([
        '//project/github.com/acme/demo/queries',
        '///project/github.com/acme/demo/queries',
        '/(project/github.com/acme/demo/queries)',
        '/(project/github.com/acme/demo/queries)/',
        '//project/github.com/acme/demo',
        '//project/github.com/acme/demo/tree/HEAD/dir/-/chat',
        '/(project/github.com/acme/demo/chat//menu:x)',
      ])('%s: the question is dropped, the rest of the query stays', (path) => {
        const result = run(path, '?msg=Q&x=1', '#h');
        expect(result.stash).toBeUndefined();
        expect(result.replaced).toEqual([toReplaceState(path) + '?x=1#h']);
        expect(result.kept).toEqual(new Map());
      });

      it('an address that is no project and no hand-off, written the same way, is left alone', () => {
        for (const path of ['//no-such-route', '/(queries)', '///', '/(menu:x)']) {
          const result = run(path, '?msg=Q');
          expect(result.stash, path).toBeUndefined();
          expect(result.replaced, path).toEqual([]);
        }
      });

      it('a reload of a hand-off address written another way, after the script and before the app, shows the same question', () => {
        const first = run('//project/github.com/datatug/chinook-demo/chat', '?msg=Early');
        const reload = pageLoad(
          '/project/github.com/datatug/chinook-demo/chat',
          '',
          { store: first.kept, navigation: 'reload' },
        );
        captureDemoHandoff(reload.env);
        expect(
          demoHandoff(
            () => reload.env.storage(),
            '/project/github.com/datatug/chinook-demo/chat',
          )?.question,
        ).toBe('Early');
      });
    });

    // Founder ruling 2026-10-03: `…/start-chat#msg=<q>&lang=<l>`.
    describe('the start-chat address: the question after #', () => {
      const P = '/project/github.com/acme/demo/start-chat';

      it('stashes msg and lang from the fragment, keeps them for a reload under the same path, and takes the fragment out', () => {
        const result = run(P, '', '#msg=Which+countries%3F&lang=ru');
        expect(result.stash).toBe('?msg=Which+countries%3F&lang=ru');
        expect(result.replaced).toEqual([P]);
        expect(result.kept).toEqual(new Map([[DEMO_HANDOFF_KEY, P + '?msg=Which+countries%3F&lang=ru']]));
      });

      it('q is read like msg, and only msg, q and lang are kept; the fragment is taken out whole', () => {
        const result = run(P, '', '#q=Hi&scenario=x&lang=en&top');
        expect(result.stash).toBe('?q=Hi&lang=en');
        expect(result.replaced).toEqual([P]);
      });

      it('reads the query too (a form post), fragment first, and keeps its other keys', () => {
        const result = run(P, '?utm_source=x&msg=FromQuery&b=2&lang=ru', '#msg=FromFragment');
        expect(result.stash).toBe('?msg=FromFragment&msg=FromQuery&lang=ru');
        expect(result.replaced).toEqual([P + '?utm_source=x&b=2']);
        // and the app parses the stash like any query string: the fragment's question comes first
        expect(new URLSearchParams(result.stash as string).get('msg')).toBe('FromFragment');
      });

      it('keys are read as the app reads them: percent-decoded, case-sensitive', () => {
        const result = run(P, '?m%73g=Q&MSG=kept&x=1', '');
        expect(result.stash).toBe('?m%73g=Q');
        expect(result.replaced).toEqual([P + '?MSG=kept&x=1']);
      });

      it('a fragment with no question is removed and nothing is stashed or kept', () => {
        const result = run(P, '?x=1', '#top');
        expect(result).toEqual({ replaced: [P + '?x=1'], stash: undefined, kept: new Map() });
      });

      it('a bare address, or one with a query that holds none of the keys, is not touched', () => {
        expect(run(P, '', '').replaced).toEqual([]);
        expect(run(P, '?x=1&y=2', '').replaced).toEqual([]);
      });

      it.each([
        ['/project/github.com/acme/demo/tree/HEAD/-/start-chat'],
        ['/project/github.com/acme/demo/tree/HEAD/dir/-/start-chat'],
        ['/project/github.com/acme/demo/tree/abc/a/b/-/start-chat'],
        ['//project/github.com/acme/demo/start-chat'],
        ['///project/github.com/acme/demo/start-chat/'],
        ['/(project/github.com/acme/demo/start-chat)'],
        ['/(Project/GitHub.com/acme/demo/tree/HEAD/d/-/START-CHAT)/'],
        ['/Project/GitHub.com/acme/demo/Start-Chat;x=1'],
        ['/project/github.com/datatug/chinook-demo/start-chat'],
      ])('%s is handled: the question is stashed, kept, and out of the address bar', (path) => {
        expect(handoffTargetOfPath(path)?.kind).toBe('start-chat');
        const result = run(path, '', '#msg=Q&lang=ru');
        expect(result.stash).toBe('?msg=Q&lang=ru');
        expect(result.replaced).toEqual([toReplaceState(path)]);
        expect(result.kept).toEqual(new Map([[DEMO_HANDOFF_KEY, path.replace(/\/$/, '') + '?msg=Q&lang=ru']]));
      });

      it.each([
        '/project/github.com/acme/demo/start-chat/extra',
        '/project/github.com/acme/demo/tree/HEAD/start-chat',
        '/project/github.com/acme/demo/tree/HEAD/a/-/b/-/start-chat',
        '/project/github.com/acme/demo/tree/-/start-chat',
        '/project/gitlab.com/acme/demo/start-chat',
        '/project/github.com/acme/start-chat',
        '/start-chat',
        '/start-chat/x',
        '/store/github.com/project/p@o@/start-chat',
        '/project/github.com/acme/demo/start-chat(menu:x)',
        '/project/github.com/acme/demo/tree/HEAD/a(b)/-/start-chat',
        '/demo',
        '/project/github.com/acme/demo/chat',
        '/project/github.com/acme/demo/queries',
      ])('%s with a question in its fragment is left exactly as it is', (path) => {
        const result = run(path, '', '#msg=Q&lang=ru');
        expect(result, path).toEqual({ replaced: [], stash: undefined, kept: new Map() });
      });

      it('agrees with the TypeScript on every spelling: stashed exactly when handoffTargetOfPath says start-chat', () => {
        for (const path of [
          '/project/github.com/o/r/start-chat',
          '/project/github.com/o/r/start-chat/',
          '/project/github.com/o/r/start-chat/x',
          '/project/github.com/o/r/tree/HEAD/d/-/start-chat',
          '/project/github.com/o/r/tree/HEAD/start-chat',
          '/project/github.com/o/r/tree/-/start-chat',
          '/project/github.com/o/r/tree//-/start-chat',
          '/project/github.com/o/r/tree/HEAD/a/-/b/-/start-chat',
          '/project/github.com/o%2Fx/r/start-chat',
          '/project/github.com/o/r/start-chat//',
          '/project//github.com/o/r/start-chat',
          '//project/github.com/o/r/start-chat',
          '/(project/github.com/o/r/start-chat)',
          '/(project/github.com/o/r/start-chat//menu:x)',
          '/(project/github.com/o/r/tree/HEAD/-/start-chat)(menu:x)',
          '/project/github.com/o/r/start-chat(menu:x)',
          '/project/github.com/o/r/chat',
          '/demo',
          '/',
        ]) {
          const result = run(path, '', '#msg=Q');
          expect(result.stash !== undefined, path).toBe(handoffTargetOfPath(path)?.kind === 'start-chat');
        }
      });

      it('strips the address even when sessionStorage is blocked, and does not throw when the browser refuses', () => {
        expect(run(P, '', '#msg=Q', true).replaced).toEqual([P]);
        expect(() => run(P, '', '#msg=Q', false, true)).not.toThrow();
        expect(run(P, '', '#msg=Q', false, true).stash).toBe('?msg=Q');
      });

      it('a reload before the app has started loses nothing', () => {
        const first = run('/project/github.com/datatug/chinook-demo/start-chat', '', '#msg=Early&lang=ru');
        const reload = pageLoad('/project/github.com/datatug/chinook-demo/start-chat', '', {
          store: first.kept,
          navigation: 'reload',
        });
        captureDemoHandoff(reload.env);
        expect(
          demoHandoff(() => reload.env.storage(), '/project/github.com/datatug/chinook-demo/start-chat'),
        ).toEqual({ question: 'Early', lang: 'ru', truncated: false });
      });
    });

    it('stashes the raw query string for the TypeScript side to parse', () => {
      expect(run('/demo', '?scenario=a&q=hello%20world').stash).toBe(
        '?scenario=a&q=hello%20world',
      );
    });

    it('does nothing for a hand-off path without a query', () => {
      expect(run('/demo', '')).toEqual({
        replaced: [],
        stash: undefined,
        kept: new Map(),
      });
    });

    it('keeps the raw query string in sessionStorage under the key the app reads', () => {
      expect(run('/demo', '?q=a+b').kept).toEqual(
        new Map([[DEMO_HANDOFF_KEY, '/demo?q=a+b']]),
      );
    });

    it('strips the address bar even when sessionStorage is blocked', () => {
      const result = run('/demo', '?q=a+b', '', true);
      expect(result.replaced).toEqual(['/demo']);
      expect(result.stash).toBe('?q=a+b');
    });

    it('does not throw, and still stashes the question, when the browser refuses to rewrite the address', () => {
      const result = run('/demo', '?q=a+b', '', false, true);
      expect(result.replaced).toEqual([]);
      expect(result.stash).toBe('?q=a+b');
      expect(result.kept).toEqual(new Map([[DEMO_HANDOFF_KEY, '/demo?q=a+b']]));
    });

    it('strips the query of a matrix-parameter address and keeps it for the reload under that same path', () => {
      const first = run('/demo;x=1', '?q=Matrix+one', '#h');
      expect(first.replaced).toEqual(['/demo;x=1#h']);
      expect(first.kept).toEqual(
        new Map([[DEMO_HANDOFF_KEY, '/demo;x=1?q=Matrix+one']]),
      );
      const reload = pageLoad('/demo;x=1', '', {
        store: first.kept,
        navigation: 'reload',
      });
      captureDemoHandoff(reload.env);
      expect(
        demoHandoff(() => reload.env.storage(), '/demo;x=1')?.question,
      ).toBe('Matrix one');
    });

    it('a reload before the app has started loses nothing: the stored copy is read once the app runs', () => {
      const first = run('/demo', '?q=Early+reload&lang=ru');
      // The page load ends before any bundle ran; the next one starts with no stash and a clean URL.
      const reload = pageLoad('/demo', '', {
        store: first.kept,
        navigation: 'reload',
      });
      captureDemoHandoff(reload.env);
      expect(demoHandoff(() => reload.env.storage(), '/demo')).toEqual({
        question: 'Early reload',
        lang: 'ru',
        truncated: false,
      });
    });
  });
});

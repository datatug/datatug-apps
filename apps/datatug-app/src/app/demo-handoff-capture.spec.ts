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
  parseHandoffSearch,
  resetDemoHandoffForTests,
  truncateToBytes,
} from './demo-handoff-capture';

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
  const loc = { pathname, search, hash: options.hash ?? '' } as Location;
  const history = {
    state: { x: 1 },
    replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(url);
      (loc as { search: string }).search = '';
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
      const location = { pathname, search, hash };
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
      ];
      for (const path of paths) {
        const result = run(path, '?q=x&lang=ru', '#h');
        expect(result.stash !== undefined, path).toBe(isHandoffPath(path));
        expect(result.replaced, path).toEqual(
          isHandoffPath(path) ? [path + '#h'] : [],
        );
      }
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

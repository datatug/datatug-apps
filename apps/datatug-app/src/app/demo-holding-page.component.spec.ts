import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import { provideRouter, Router, RouterLink } from '@angular/router';
import {
  captureDemoHandoff,
  DEMO_HANDOFF_KEY,
  DEMO_HANDOFF_STASH,
  resetDemoHandoffForTests,
} from './demo-handoff-capture';
import { DemoHoldingPageComponent } from './demo-holding-page.component';
import {
  DEMO_HOLDING_STRINGS,
  DEMO_PROJECT_PATH,
  SITE_URL,
  siteUrlFor,
} from './demo-holding-page.strings';

/** Visits `path` as a real page load would: the address is the clean one, the query went through index.html. */
function handOff(search: string, path = '/demo'): void {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`https://datatug.app${path}`);
  captureDemoHandoff({
    location: { pathname: path, search: '', hash: '' } as Location,
    history: {
      state: null,
      replaceState: () => undefined,
    } as unknown as History,
    storage: () => window.sessionStorage,
    stash: { [DEMO_HANDOFF_STASH]: search },
    navigationType: () => 'navigate',
  });
}

async function render(): Promise<ComponentFixture<DemoHoldingPageComponent>> {
  await TestBed.configureTestingModule({
    imports: [DemoHoldingPageComponent],
    providers: [provideRouter([])],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
  })
    .overrideComponent(DemoHoldingPageComponent, {
      // The Ionic custom elements are not under test; RouterLink is.
      set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(DemoHoldingPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

/** What a browser set to block site data does: merely touching `sessionStorage` throws. Returns the undo. */
function blockStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  return () => {
    if (original) Object.defineProperty(window, 'sessionStorage', original);
    else
      delete (window as unknown as Record<string, unknown>)['sessionStorage'];
  };
}

const text = (
  fixture: ComponentFixture<unknown>,
  selector: string,
): string | undefined =>
  (fixture.nativeElement as HTMLElement)
    .querySelector(selector)
    ?.textContent?.trim();

describe('DemoHoldingPageComponent', () => {
  beforeEach(() => {
    resetDemoHandoffForTests();
    window.sessionStorage.clear();
    (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL('https://datatug.app/demo');
  });

  it('shows the question back with the founder-proposed sentence, in English', async () => {
    handOff('?scenario=jazz-artists&q=Which+jazz+artists%3F&lang=en');
    const fixture = await render();
    expect(text(fixture, '[role=status] > p')).toBe(
      'This is the question you asked. The live demo is not open yet; it opens here soon.',
    );
    expect(text(fixture, 'blockquote')).toBe('Which jazz artists?');
    expect(text(fixture, 'h1')).toBe(DEMO_HOLDING_STRINGS.en.heading);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.holding')
        ?.getAttribute('lang'),
    ).toBe('en');
  });

  it('shows the question back in Russian', async () => {
    handOff(
      '?q=' +
        encodeURIComponent('Какие страны слушают больше всего джаза?') +
        '&lang=ru',
    );
    const fixture = await render();
    expect(text(fixture, '[role=status] > p')).toBe(
      'Это ваш вопрос. Живое демо ещё не открыто, скоро оно появится здесь.',
    );
    expect(text(fixture, 'blockquote')).toBe(
      'Какие страны слушают больше всего джаза?',
    );
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.holding')
        ?.getAttribute('lang'),
    ).toBe('ru');
  });

  it.each([
    ['', 'The live demo is not open yet; it opens here soon.'],
    ['?lang=en', 'The live demo is not open yet; it opens here soon.'],
    ['?lang=ru', 'Живое демо ещё не открыто, скоро оно появится здесь.'],
    [
      '?scenario=jazz-artists&lang=ru',
      'Живое демо ещё не открыто, скоро оно появится здесь.',
    ],
  ])(
    'with no question (%s) says only that the demo opens soon',
    async (search, sentence) => {
      if (search) handOff(search);
      const fixture = await render();
      expect(text(fixture, '[role=status] > p')).toBe(sentence);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('blockquote'),
      ).toBeNull();
    },
  );

  it('renders HTML in the question as text, never as markup', async () => {
    const hostile =
      '<img src=x onerror="window.__pwned=1"><b>bold</b> <script>window.__pwned=2</script>';
    handOff('?q=' + encodeURIComponent(hostile));
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('blockquote')?.textContent).toBe(hostile);
    expect(root.querySelector('blockquote')?.children.length).toBe(0);
    expect(root.querySelector('img, b, script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('says when a long question was cut, and shows at most 1000 bytes of it', async () => {
    handOff('?q=' + encodeURIComponent('Ж'.repeat(900)));
    const fixture = await render();
    expect(text(fixture, 'blockquote')).toBe('Ж'.repeat(500));
    expect(text(fixture, '.note')).toBe(DEMO_HOLDING_STRINGS.en.shortened);
  });

  it('shows the same question after a reload (from sessionStorage) and the no-question copy when storage is blocked', async () => {
    handOff('?q=Reload+me&lang=ru');
    expect(window.sessionStorage.getItem(DEMO_HANDOFF_KEY)).toContain(
      'Reload+me',
    );
    resetDemoHandoffForTests(); // the old page load is gone; only sessionStorage is left
    const fixture = await render();
    expect(text(fixture, 'blockquote')).toBe('Reload me');
    expect(text(fixture, '[role=status] > p')).toBe(
      DEMO_HOLDING_STRINGS.ru.withQuestion,
    );
  });

  it('does not fail when sessionStorage is blocked: the question captured in this page load is still shown, a reload shows the no-question copy', async () => {
    const unblock = blockStorage();
    try {
      handOff('?q=Blocked+but+shown');
      const first = await render();
      expect(text(first, 'blockquote')).toBe('Blocked but shown');
      TestBed.resetTestingModule();
      resetDemoHandoffForTests(); // the reload
      const reloaded = await render();
      expect(text(reloaded, '[role=status] > p')).toBe(
        DEMO_HOLDING_STRINGS.en.withoutQuestion,
      );
      expect(
        (reloaded.nativeElement as HTMLElement).querySelector('blockquote'),
      ).toBeNull();
    } finally {
      unblock();
    }
  });

  it('has one heading, a described and announced message, and moves focus to the heading', async () => {
    handOff('?q=Hello');
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('h1, h2, h3, [role=heading]').length).toBe(1);
    const heading = root.querySelector('h1') as HTMLElement;
    expect(heading.getAttribute('aria-describedby')).toBe(
      'demo-holding-message',
    );
    expect(
      root.querySelector('#demo-holding-message')?.getAttribute('role'),
    ).toBe('status');
    expect(root.querySelector('main')).toBeNull(); // the page's single main landmark is ion-content's own
    expect(document.activeElement).toBe(heading);
  });

  it('lets the browser pick the direction of the quote from its text, and shows a long run of blank lines as one', async () => {
    handOff('?q=' + encodeURIComponent('first\n\n\n\n\nsecond'));
    const fixture = await render();
    const quote = (fixture.nativeElement as HTMLElement).querySelector(
      'blockquote',
    );
    expect(quote?.getAttribute('dir')).toBe('auto');
    expect(quote?.textContent).toBe('first\n\nsecond');
  });

  it('keeps the question out of analytics autocapture', async () => {
    handOff('?q=Hello');
    const fixture = await render();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('blockquote')
        ?.classList.contains('ph-no-capture'),
    ).toBe(true);
  });

  it('links to the demo project as the home page opens it, and back to the site', async () => {
    const fixture = await render();
    const [project, site] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.links a'),
    ) as HTMLAnchorElement[];
    expect(project.getAttribute('href')).toBe(DEMO_PROJECT_PATH.join('/'));
    expect(project.getAttribute('href')).toBe(
      '/store/github.com/project/datatug-demo-projects@datatug@demo-project-1',
    );
    expect(site.getAttribute('href')).toBe(SITE_URL);
    expect(project.textContent?.trim()).toBe(
      DEMO_HOLDING_STRINGS.en.openDemoProject,
    );
    expect(site.textContent?.trim()).toBe(DEMO_HOLDING_STRINGS.en.backToSite);
  });
});

describe('DemoHoldingPageComponent: the link back to the site', () => {
  beforeEach(() => {
    resetDemoHandoffForTests();
    window.sessionStorage.clear();
  });
  afterEach(
    () => delete (document as unknown as { referrer?: string }).referrer,
  );

  it('goes back to the Russian pages of datatug.ai for a visitor who came from them', async () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://datatug.ai/ru/some/page?q=secret',
    });
    handOff('?q=Hi&lang=ru');
    const fixture = await render();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.links a'),
    );
    expect(links[links.length - 1].getAttribute('href')).toBe(
      'https://datatug.ai/ru/',
    );
  });
});

describe('DemoHoldingPageComponent: the tab title and the document language', () => {
  const root = document.documentElement;

  beforeEach(() => {
    resetDemoHandoffForTests();
    window.sessionStorage.clear();
    document.title = 'DataTug.app';
    root.setAttribute('lang', 'en');
  });
  afterEach(() => root.setAttribute('lang', 'en'));

  it.each([
    ['en', 'DataTug live demo'],
    ['ru', 'Живое демо DataTug'],
  ] as const)(
    'while shown, the title and <html lang> follow the page language (%s)',
    async (lang, title) => {
      handOff(`?q=Hi&lang=${lang}`);
      const fixture = await render();
      expect(document.title).toBe(title);
      expect(root.getAttribute('lang')).toBe(lang);
      fixture.destroy();
    },
  );

  it('uses the neutral title on another repository address', async () => {
    handOff('?msg=Hi&lang=ru', '/project/github.com/someone/else/chat');
    const fixture = await render();
    expect(document.title).toBe('DataTug');
    expect(root.getAttribute('lang')).toBe('ru');
    fixture.destroy();
  });

  it('puts both back when the visitor leaves the page', async () => {
    handOff('?q=Hi&lang=ru');
    const fixture = await render();
    expect(document.title).not.toBe('DataTug.app');
    fixture.destroy();
    expect(document.title).toBe('DataTug.app');
    expect(root.getAttribute('lang')).toBe('en');
  });

  it('removes <html lang> again when there was none', async () => {
    root.removeAttribute('lang');
    handOff('?q=Hi&lang=ru');
    const fixture = await render();
    expect(root.getAttribute('lang')).toBe('ru');
    fixture.destroy();
    expect(root.hasAttribute('lang')).toBe(false);
  });

  describe('a visitor who leaves through a navigation, with the page kept alive (the Ionic outlet keeps it for Back)', () => {
    async function renderWithRoutes() {
      await TestBed.configureTestingModule({
        imports: [DemoHoldingPageComponent],
        providers: [
          provideRouter([
            { path: 'demo', component: OtherPage },
            { path: 'Demo', component: OtherPage },
            { path: 'store/:id/project/:pid', component: OtherPage },
            { path: 'project/github.com/:o/:r/chat', component: OtherPage },
          ]),
        ],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      })
        .overrideComponent(DemoHoldingPageComponent, {
          set: { imports: [RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
        })
        .compileComponents();
      const fixture = TestBed.createComponent(DemoHoldingPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      return { fixture, router: TestBed.inject(Router) };
    }

    it('puts the title and language back on navigating away, without the component being destroyed, and re-applies them on coming back', async () => {
      handOff('?q=Hi&lang=ru');
      const { fixture, router } = await renderWithRoutes();
      expect(document.title).toBe('Живое демо DataTug');
      expect(root.getAttribute('lang')).toBe('ru');

      await router.navigateByUrl('/store/github.com/project/p1'); // the page's own "Open the demo project" link
      expect(document.title).toBe('DataTug.app');
      expect(root.getAttribute('lang')).toBe('en');

      await router.navigateByUrl('/demo?lang=ru'); // Back
      expect(document.title).toBe('Живое демо DataTug');
      expect(root.getAttribute('lang')).toBe('ru');

      await router.navigateByUrl('/store/github.com/project/p1');
      expect(document.title).toBe('DataTug.app');
      fixture.destroy(); // the backstop: nothing left to restore, and no double restore
      expect(document.title).toBe('DataTug.app');
      expect(root.getAttribute('lang')).toBe('en');
    });

    it('stays applied while the visitor moves between hand-off addresses', async () => {
      handOff('?q=Hi&lang=ru');
      const { fixture, router } = await renderWithRoutes();
      await router.navigateByUrl('/Demo;x=1');
      await router.navigateByUrl(
        '/project/github.com/datatug/chinook-demo/chat',
      );
      expect(document.title).toBe('Живое демо DataTug');
      expect(root.getAttribute('lang')).toBe('ru');
      fixture.destroy();
      expect(document.title).toBe('DataTug.app');
    });

    it('a title set by the next page is not overwritten by a late restore', async () => {
      handOff('?q=Hi&lang=ru');
      const { fixture, router } = await renderWithRoutes();
      await router.navigateByUrl('/store/github.com/project/p1');
      document.title = 'Some project';
      fixture.destroy();
      expect(document.title).toBe('Some project');
    });
  });

  it('a bare visit is English', async () => {
    const fixture = await render();
    expect(document.title).toBe('DataTug live demo');
    expect(root.getAttribute('lang')).toBe('en');
    fixture.destroy();
  });
});

describe('DemoHoldingPageComponent on the project chat address', () => {
  const MSG = 'A message that came in a link <b>x</b>';
  const search = `?msg=${encodeURIComponent(MSG)}&lang=en`;

  beforeEach(() => {
    resetDemoHandoffForTests();
    window.sessionStorage.clear();
  });

  it.each([
    '/project/github.com/datatug/chinook-demo/chat',
    '/project/github.com/Datatug/Chinook-Demo/chat',
    '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
  ])(
    'the demo project (%s) shows the message back, as /demo does',
    async (path) => {
      handOff(search, path);
      const fixture = await render();
      expect(text(fixture, 'blockquote')).toBe(MSG);
      expect(text(fixture, '[role=status] > p')).toBe(
        DEMO_HOLDING_STRINGS.en.withQuestion,
      );
      expect(text(fixture, 'h1')).toBe(DEMO_HOLDING_STRINGS.en.heading);
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.links a')
          .length,
      ).toBe(2);
    },
  );

  it.each([
    '/project/github.com/someone/else/chat',
    '/project/github.com/datatug/chinook-demo-evil/chat',
    '/project/github.com/datatug/chinook-demo/tree/0123abcd4567ef89/-/chat',
  ])(
    'any other address (%s) does not show the message, claims no demo, and links only back to the site',
    async (path) => {
      handOff(`?msg=${encodeURIComponent(MSG)}&lang=ru`, path);
      const fixture = await render();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('blockquote')).toBeNull();
      expect(root.textContent).not.toContain('A message that came in a link');
      expect(text(fixture, 'h1')).toBe(DEMO_HOLDING_STRINGS.ru.neutralHeading);
      expect(text(fixture, '[role=status] > p')).toBe(
        DEMO_HOLDING_STRINGS.ru.neutralMessage,
      );
      // No claim about a demo, in either language.
      for (const word of [/demo/i, /демо/i])
        expect(root.textContent).not.toMatch(word);
      const links = Array.from(
        root.querySelectorAll('.links a'),
      ) as HTMLAnchorElement[];
      expect(links.map((a) => a.getAttribute('href'))).toEqual([SITE_URL]);
      expect(root.querySelector('.holding')?.getAttribute('lang')).toBe('ru');
    },
  );

  it('the neutral page in English', async () => {
    handOff(search, '/project/github.com/someone/else/chat');
    const fixture = await render();
    expect(text(fixture, '[role=status] > p')).toBe(
      'This page is not available yet.',
    );
    expect(text(fixture, 'h1')).toBe('DataTug');
  });

  it('a message captured on /demo is not shown when the visitor moves in-app to another repository address', async () => {
    handOff('?q=From+demo');
    (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(
      'https://datatug.app/project/github.com/someone/else/chat',
    );
    const fixture = await render();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('blockquote'),
    ).toBeNull();
  });

  it('blocked storage wins: after a reload the no-question copy is shown, not an old message', async () => {
    const path = '/project/github.com/datatug/chinook-demo/chat';
    handOff(search, path);
    resetDemoHandoffForTests();
    const unblock = blockStorage();
    try {
      const fixture = await render();
      expect(text(fixture, '[role=status] > p')).toBe(
        DEMO_HOLDING_STRINGS.en.withoutQuestion,
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('blockquote'),
      ).toBeNull();
    } finally {
      unblock();
    }
  });
});

describe('siteUrlFor (the back-to-the-site link)', () => {
  it('returns to the sites it knows, as an origin only', () => {
    expect(siteUrlFor('https://datatug.io/ru/some/page?q=secret#x')).toBe(
      'https://datatug.io/',
    );
    expect(siteUrlFor('https://datatug.ai/')).toBe('https://datatug.ai/');
    expect(siteUrlFor('https://datatug.ai')).toBe('https://datatug.ai/');
  });

  it('a visitor from the Russian pages of datatug.ai returns to its Russian home page, and only to that', () => {
    for (const referrer of [
      'https://datatug.ai/ru/',
      'https://datatug.ai/ru',
      'https://datatug.ai/ru/pricing?q=secret#x',
      'https://datatug.ai/ru/a/b/c',
    ])
      expect(siteUrlFor(referrer), referrer).toBe('https://datatug.ai/ru/');
    for (const referrer of [
      'https://datatug.ai/en/',
      'https://datatug.ai/ruby/',
      'https://datatug.ai/rus/',
      'https://datatug.ai/pricing/ru/',
      'https://datatug.ai/',
    ])
      expect(siteUrlFor(referrer), referrer).toBe('https://datatug.ai/');
    // datatug.io has no Russian home page to return to.
    expect(siteUrlFor('https://datatug.io/ru/')).toBe('https://datatug.io/');
    // Other origins never get a path.
    expect(siteUrlFor('https://evil.example/ru/')).toBe(SITE_URL);
    expect(siteUrlFor('https://datatug.ai.evil.example/ru/')).toBe(SITE_URL);
  });

  it.each([
    '',
    'not a url',
    'https://evil.example/',
    'https://datatug.io.evil.example/',
    'https://evil.example/https://datatug.io/',
    'https://www.datatug.io/',
    'https://sub.datatug.ai/',
    'http://datatug.io/',
    'https://datatug.io:8443/',
    'https://user@evil.example/',
    'https://datatug.io@evil.example/',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'https://DATATUG.IO.evil.example/',
  ])('never uses %j: falls back to datatug.io', (referrer) => {
    expect(siteUrlFor(referrer)).toBe(SITE_URL);
  });
});

@Component({ selector: 'sneat-stub-other-page', template: '' })
class OtherPage {}

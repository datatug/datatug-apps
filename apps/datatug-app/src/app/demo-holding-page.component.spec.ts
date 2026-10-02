import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, RouterLink } from '@angular/router';
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
      'This is the question you asked. The live demo opens here soon.',
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
      'Это ваш вопрос. Живое демо скоро откроется здесь.',
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
    ['', 'The live demo opens here soon.'],
    ['?lang=en', 'The live demo opens here soon.'],
    ['?lang=ru', 'Живое демо скоро откроется здесь.'],
    ['?scenario=jazz-artists&lang=ru', 'Живое демо скоро откроется здесь.'],
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

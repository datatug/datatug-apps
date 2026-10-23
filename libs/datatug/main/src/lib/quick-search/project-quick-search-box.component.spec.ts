import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, ReplaySubject } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  ProjectQuickSearchBoxComponent,
  QUICK_SEARCH_DEBOUNCE_MS,
} from './project-quick-search-box.component';
import {
  ProjectMetadataSearchService,
  ProjectMetadataState,
} from './project-metadata-search.service';
import { MetadataItem } from './project-metadata-search';
import { IProjectRef } from '../core/project-context';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ref: IProjectRef = {
  storeId: 'github.com',
  projectId: 'datatug-demo-project@datatug@demo-project-1',
};
const items: MetadataItem[] = [
  ...Array.from({ length: 7 }, (_, i) => ({
    kind: 'query' as const,
    id: `customers/q${i}`,
    title: `Customer query ${i}`,
    tags: [],
    href: `/project/q${i}`,
    queryType: i % 2 ? 'SQL' : 'TugQL',
  })),
  {
    kind: 'table',
    id: 'chinook/main/Customer',
    title: 'Customer',
    context: 'chinook · main',
    tags: [],
    href: '/project/t',
  },
  { kind: 'board', id: 'b', title: 'Albums', tags: [], href: '/project/b' },
];

describe('ProjectQuickSearchBoxComponent', () => {
  let metadata: ReplaySubject<ProjectMetadataState>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let includeColumns: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    metadata = new ReplaySubject<ProjectMetadataState>(1);
    includeColumns = vi.fn();
    TestBed.configureTestingModule({
      imports: [ProjectQuickSearchBoxComponent],
      providers: [
        provideRouter([]),
        {
          provide: ProjectMetadataSearchService,
          useValue: {
            metadata: vi.fn(() => metadata),
            forget: vi.fn(),
            includeColumns,
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ status: 'notAuthenticated' }),
          },
        },
      ],
    });
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
  });

  async function render(projectRef: IProjectRef = ref) {
    const fixture = TestBed.createComponent(ProjectQuickSearchBoxComponent);
    fixture.componentRef.setInput('projectRef', projectRef);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector('input') as HTMLInputElement;
    const type = async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      await sleep(QUICK_SEARCH_DEBOUNCE_MS + 40);
      await fixture.whenStable();
    };
    const key = async (name: string) => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          bubbles: true,
          cancelable: true,
        }),
      );
      await fixture.whenStable();
    };
    return { fixture, el, input, type, key };
  }

  it('is an ARIA combobox that controls a listbox', async () => {
    const { input, el, type } = await render();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    const listbox = el.querySelector('[role=listbox]') as HTMLElement;
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    metadata.next({ items, loading: false });
    await type('cust');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('waits for the debounce, shows a loading state, then grouped results that arrive later', async () => {
    const { el, input, type, fixture } = await render();
    input.value = 'customer';
    input.dispatchEvent(new Event('input'));
    await sleep(QUICK_SEARCH_DEBOUNCE_MS / 3);
    await fixture.whenStable();
    expect(el.querySelector('.panel')?.hasAttribute('hidden')).toBe(true);
    expect(includeColumns).not.toHaveBeenCalled();
    await type('customer');
    expect(includeColumns).toHaveBeenCalledWith(ref);
    expect(el.querySelector('.state')?.textContent).toContain(
      'Searching project metadata',
    );
    // Status words are announced from a live region next to the listbox, never inside it.
    expect(el.querySelector('[role=listbox] .state')).toBeNull();
    expect(el.querySelector('[aria-live=polite] .state')).not.toBeNull();
    metadata.next({ items, loading: false });
    await fixture.whenStable();
    const titles = [...el.querySelectorAll('.group-title')].map((g) =>
      g.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(titles).toEqual(['Queries 7', 'Tables 1']);
    // At most five per group, and "See all" carries the full count.
    expect(
      el.querySelectorAll('[role=group]')[0].querySelectorAll('[role=option]'),
    ).toHaveLength(5);
    expect(el.querySelector('.see-all')?.textContent).toContain(
      'See all 8 results',
    );
    expect(el.querySelector('mark')?.textContent).toBe('Customer');
  });

  it('shows an empty state when nothing matches', async () => {
    const { el, type, fixture } = await render();
    metadata.next({ items, loading: false });
    await type('zzz');
    await fixture.whenStable();
    expect(el.querySelector('.state')?.textContent).toContain(
      'No matches for “zzz”',
    );
    // An empty listbox is not reported as expanded.
    expect(el.querySelector('input')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('marks group titles as presentation inside labelled groups', async () => {
    const { el, type } = await render();
    metadata.next({ items, loading: false });
    await type('Customer');
    const group = el.querySelector('[role=group]') as HTMLElement;
    const title = group.querySelector('.group-title') as HTMLElement;
    expect(title.getAttribute('role')).toBe('presentation');
    expect(group.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('never opens a stale suggestion with ArrowDown and Enter inside the debounce', async () => {
    const { input, type, fixture } = await render();
    metadata.next({ items, loading: false });
    await type('Albums');
    input.value = 'Customer';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    for (const key of ['ArrowDown', 'Enter'])
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    await fixture.whenStable();
    // Enter searched the typed text instead of opening "Albums".
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0][0])).toContain(
      'quick-search?q=Customer',
    );
  });

  it('moves with ArrowDown/ArrowUp, wraps, opens with Enter and closes with Escape', async () => {
    const { input, type, key, el } = await render();
    metadata.next({ items, loading: false });
    await type('Customer');
    await key('ArrowDown');
    const first = el.querySelector('[role=option]') as HTMLElement;
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    await key('ArrowUp');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      (el.querySelector('.see-all') as HTMLElement).id,
    );
    await key('ArrowDown');
    await key('Enter');
    expect(String(navigate.mock.calls[0][0])).toBe('/project/q0');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    await type('Customer q');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await key('Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('opens the full results page on Enter without a highlighted option', async () => {
    const { input, type, fixture } = await render();
    metadata.next({ items, loading: false });
    await type('Customer');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await fixture.whenStable();
    expect(String(navigate.mock.calls.at(-1)?.[0])).toBe(
      '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/quick-search?q=Customer',
    );
  });

  it('renders query suggestions as the shared query row: type badge, marked title, combobox option', async () => {
    const { el, input, type, key } = await render();
    metadata.next({ items, loading: false });
    await type('Customer');
    const rows = el.querySelectorAll(
      '[role=group] sneat-datatug-query-list-item',
    );
    expect(rows).toHaveLength(5);
    // The same icon and per-type badge as every other query list, never a primary-coloured kind icon.
    expect(
      [...el.querySelectorAll('.query-type-badge')].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(['TugQL', 'SQL', 'TugQL', 'SQL', 'TugQL']);
    const option = rows[0].querySelector('[role=option]') as HTMLElement;
    expect(option.classList).toContain('query-row-main');
    expect(option.getAttribute('tabindex')).toBe('-1');
    expect(option.getAttribute('href')).toBe('/project/q0');
    expect(option.querySelector('mark')?.textContent).toBe('Customer');
    expect(
      rows[0].querySelector('[queryRowSubtitle]')?.textContent?.trim(),
    ).toBe('Query');
    // Non-query kinds keep their own kind icon.
    expect(el.querySelectorAll('a.option[role=option]')).toHaveLength(2); // table + "See all"
    await key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the project qualifiers when it opens the full results page', async () => {
    const { input, type, fixture, el } = await render({
      storeId: 'github.com',
      projectId: 'repo@owner@',
      projectApi: 'cloud',
      branch: 'main',
    } as IProjectRef);
    metadata.next({ items, loading: false });
    await type('Customer');
    const expected =
      '/project/github.com/owner/repo/quick-search?projectApi=cloud&branch=main&q=Customer';
    expect(el.querySelector('.see-all')?.getAttribute('href')).toBe(expected);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await fixture.whenStable();
    expect(
      TestBed.inject(Router).serializeUrl(navigate.mock.calls.at(-1)?.[0]),
    ).toBe(expected);
  });

  it('shows an honest note when a source failed', async () => {
    const { el, type, fixture } = await render();
    metadata.next({
      items,
      loading: false,
      error: { status: 403, url: 'https://api.github.com/repos/x/y' },
    });
    await type('Customer');
    await fixture.whenStable();
    expect(el.querySelector('.warning')?.textContent).toContain(
      'GitHub is limiting',
    );
  });
});

import { SneatAuthStateService } from '@sneat/auth-core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  ActivatedRoute,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { QuickSearchPageComponent } from './quick-search-page.component';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { SearchStatus } from './quick-search-model';
import {
  ProjectMetadataSearchService,
  ProjectMetadataState,
} from './project-metadata-search.service';
import { MetadataItem } from './project-metadata-search';

const customerItems: MetadataItem[] = [
  {
    kind: 'query',
    id: 'top',
    title: 'Top customers',
    tags: ['Customers'],
    href: '/q/top',
  },
  {
    kind: 'table',
    id: 'm/main/Customer',
    title: 'Customer',
    context: 'chinook · main',
    tags: [],
    href: '/t/Customer',
  },
  { kind: 'board', id: 'sales', title: 'Sales', tags: [], href: '/b/sales' },
];

const ready: SearchStatus = {
  state: 'ready',
  canManage: true,
  eligible: true,
  audience: 'private',
  provider: 'Typesense',
  documentCount: 0,
  consentVersion: 'project-quick-search/1',
};
describe('Quick Search consent and async state', () => {
  const context = new BehaviorSubject({
    ref: { storeId: 'firestore', spaceID: 's', projectId: 'p' },
  });
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: 'first' },
  });
  let meta: BehaviorSubject<ProjectMetadataState>;
  let api: {
    preview: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    auth.next({ status: 'authenticated', user: { uid: 'first' } });
    context.next({
      ref: { storeId: 'firestore', spaceID: 's', projectId: 'p' },
    });
    meta = new BehaviorSubject<ProjectMetadataState>({
      items: customerItems,
      loading: false,
    });
    api = {
      preview: vi.fn(() => of({ documents: [], sourceCoverage: [] })),
      status: vi.fn(() => of(ready)),
      search: vi.fn(() => of({ items: [], tags: [], itemCount: 0 })),
      enable: vi.fn(() => of(ready)),
      refresh: vi.fn(() => of(ready)),
      disable: vi.fn(() => of({ ...ready, state: 'disabled' })),
    };
    TestBed.configureTestingModule({
      imports: [QuickSearchPageComponent],
      providers: [
        provideRouter([]),
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: {},
              queryParamMap: convertToParamMap({}),
              paramMap: convertToParamMap({}),
            },
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: context },
        },
        { provide: QuickSearchApiService, useValue: api },
        {
          provide: ProjectMetadataSearchService,
          useValue: { metadata: () => meta, forget: vi.fn() },
        },
        {
          provide: QuickSearchSnapshotService,
          useValue: {
            preview: vi.fn(async () => ({ documents: [], sourceCoverage: [] })),
          },
        },
      ],
    });
  });
  it('uses all canonical categories and tag names only when the authenticated status advertises preview capability', async () => {
    api.status.mockReturnValue(of({ ...ready, supportsMetadataPreview: true }));
    const documents = (
      [
        'table',
        'column',
        'view',
        'query',
        'dashboard',
        'check',
        'entity',
        'environment',
        'tag',
      ] as const
    ).map((kind) => ({
      kind,
      id: kind,
      name: 'Canonical ' + kind,
      tags: ['customers'],
      reference: { objectId: kind },
    }));
    const snapshot = {
      documents,
      sourceCoverage: documents.map((d) => ({
        kind: d.kind,
        status: 'complete' as const,
        count: 1,
      })),
    };
    api.preview.mockReturnValue(of(snapshot));
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    await fixture.whenStable();
    const fallback = TestBed.inject(QuickSearchSnapshotService).preview;
    expect(api.preview).not.toHaveBeenCalled();
    await page.preview();
    expect(page.snapshot()).toBe(snapshot);
    expect(api.preview).toHaveBeenCalledExactlyOnceWith(
      page.project(),
      undefined,
    );
    expect(fallback).not.toHaveBeenCalled();
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
  });
  it.each([false, undefined])(
    'keeps public legacy preview when capability is %s',
    async (capability) => {
      api.status.mockReturnValue(
        of({ ...ready, supportsMetadataPreview: capability }),
      );
      TestBed.overrideProvider(DatatugNavContextService, {
        useValue: {
          currentProject: of({
            ref: { storeId: 'github.com', projectId: 'repo@owner@' },
          }),
        },
      });
      const fixture = TestBed.createComponent(QuickSearchPageComponent);
      await fixture.whenStable();
      await fixture.componentInstance.preview();
      expect(
        TestBed.inject(QuickSearchSnapshotService).preview,
      ).toHaveBeenCalledOnce();
      expect(api.preview).not.toHaveBeenCalled();
      expect(api.enable).not.toHaveBeenCalled();
    },
  );
  it('does not fall back or index after an advertised canonical preview fails', async () => {
    api.status.mockReturnValue(of({ ...ready, supportsMetadataPreview: true }));
    api.preview.mockReturnValue(throwError(() => ({ status: 403 })));
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    await fixture.componentInstance.preview();
    expect(fixture.componentInstance.snapshot()).toBeUndefined();
    expect(fixture.componentInstance.error()).toContain(
      'Could not read selected metadata',
    );
    expect(
      TestBed.inject(QuickSearchSnapshotService).preview,
    ).not.toHaveBeenCalled();
    expect(api.enable).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
  });
  it('searches in-memory project metadata at once, with no index, consent or upload', async () => {
    api.status.mockReturnValue(
      of({
        ...ready,
        state: 'disabled',
        canManage: false,
        eligible: false,
        audience: '',
      }),
    );
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    page.onTerm('customer');
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('no search index yet');
    expect(text).toContain('Top customers');
    expect(text).toContain('Customer');
    expect(text).not.toContain('Sales');
    expect(
      [
        ...fixture.nativeElement.querySelectorAll(
          'ion-item-group > ion-item-divider h3',
        ),
      ].map((h: unknown) => (h as HTMLElement).textContent?.trim()),
    ).toEqual(['Queries', 'Tables']);
    expect(
      [...fixture.nativeElement.querySelectorAll('mark')].map(
        (m: unknown) => (m as HTMLElement).textContent,
      ),
    ).toEqual(['customer', 'Customer']);
    expect(api.search).not.toHaveBeenCalled();
    expect(api.enable).not.toHaveBeenCalled();
    page.localKind.set('table');
    await fixture.whenStable();
    expect(page.resultCount()).toBe(1);
    page.localKind.set('');
    page.tag.set('custom');
    await fixture.whenStable();
    expect(page.resultMatches().map((m) => m.item.title)).toEqual([
      'Top customers',
    ]);
  });
  it('shows loading, empty and honest error states', async () => {
    api.status.mockReturnValue(of({ ...ready, state: 'disabled' }));
    meta.next({ items: [], loading: true });
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    page.onTerm('zzz');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Searching project metadata',
    );
    meta.next({ items: customerItems, loading: false });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'No matches for “zzz”.',
    );
    meta.next({
      items: [],
      loading: false,
      error: {
        status: 403,
        url: 'https://api.github.com/repos/o/r/commits/HEAD?per_page=1',
      },
    });
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('GitHub is limiting anonymous reads');
    expect(text).not.toContain('Check your project access');
    expect(text).not.toContain('api.github.com');
  });
  it('makes Index settings an icon-only header button with a label and tooltip', async () => {
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector(
      'ion-header ion-button.index-settings-button',
    ) as HTMLElement;
    const inner = button.shadowRoot?.querySelector('button');
    expect(
      button.getAttribute('aria-label') ?? inner?.getAttribute('aria-label'),
    ).toBe('Index settings');
    expect(button.getAttribute('title') ?? inner?.getAttribute('title')).toBe(
      'Index settings',
    );
    expect(button.textContent?.trim()).toBe('');
    expect(button.querySelector('ion-icon[slot=icon-only]')).toBeTruthy();
    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.settings()).toBe(true);
    expect(
      fixture.nativeElement.querySelector(
        '#quick-search-index-settings ion-item-divider',
      )?.textContent,
    ).toContain('Index settings');
  });
  it('does not upload on load, preview or checkbox selection, and requires checked consent', async () => {
    api.status.mockReturnValue(
      of({ ...ready, state: 'disabled', consentVersion: undefined }),
    );
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.enable).not.toHaveBeenCalled();
    await page.preview();
    page.enable();
    expect(api.enable).not.toHaveBeenCalled();
    page.consent.set(true);
    expect(api.enable).not.toHaveBeenCalled();
    page.enable();
    expect(api.enable).toHaveBeenCalledOnce();
  });
  it('merges a ready hosted index with in-memory results, discarding stale responses', async () => {
    meta.next({
      items: [],
      loading: false,
      error: new Error('API rate limit exceeded'),
    });
    const status = new Subject<SearchStatus>();
    api.status.mockReturnValue(status);
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    fixture.detectChanges();
    status.next(ready);
    await fixture.whenStable();
    expect(page.status()).toEqual(ready);
    const old = new Subject<unknown>(),
      current = new Subject<unknown>();
    api.search.mockReturnValueOnce(old).mockReturnValueOnce(current);
    page.onTerm('old');
    await fixture.whenStable();
    page.onTerm('new');
    await fixture.whenStable();
    old.next({
      items: [{ kind: 'tag', id: 'old', name: 'old', tags: [], reference: {} }],
    });
    expect(page.hostedItems()).toBeUndefined();
    current.next({
      items: [
        {
          kind: 'query',
          id: 'new',
          name: 'new query',
          tags: [],
          reference: {},
        },
      ],
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('new query');
    expect(fixture.nativeElement.textContent).not.toContain(
      'GitHub is limiting',
    );
  });
  it('maps a failed hosted fallback to honest words', async () => {
    meta.next({
      items: [],
      loading: false,
      error: new Error('API rate limit exceeded'),
    });
    api.search.mockReturnValue(
      throwError(() => ({
        status: 409,
        error: { error: { code: 'quick_search_reindex_required' } },
      })),
    );
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    page.onTerm('customer');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('out of date');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Check your project access',
    );
  });
  it('clears results and consent when project changes', () => {
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    page.consent.set(true);
    page.items.set([
      { kind: 'tag', id: 'secret', name: 'secret', tags: [], reference: {} },
    ]);
    context.next({
      ref: { storeId: 'firestore', spaceID: 's', projectId: 'other' },
    });
    expect(page.items()).toEqual([]);
    expect(page.consent()).toBe(false);
  });
  it('keeps deletion retry available after provider failure', () => {
    const failure = new Subject<SearchStatus>();
    api.disable.mockReturnValue(failure);
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    page.disable();
    failure.error(new Error('provider'));
    expect(page.error()).toContain('Retry');
    expect(page.busy()).toBe(false);
    page.disable();
    expect(api.disable).toHaveBeenCalledTimes(2);
  });
  it('clears cached Ionic page state when leaving and rechecks status on return', () => {
    const page = TestBed.createComponent(
      QuickSearchPageComponent,
    ).componentInstance;
    page.consent.set(true);
    page.items.set([
      { kind: 'tag', id: 'old', name: 'old', tags: [], reference: {} },
    ]);
    page.ionViewWillLeave();
    expect(page.items()).toEqual([]);
    expect(page.consent()).toBe(false);
    const count = api.status.mock.calls.length;
    page.ionViewWillEnter();
    expect(api.status).toHaveBeenCalledTimes(count + 1);
  });
  it('blocks oversized snapshots before upload', () => {
    const page = TestBed.createComponent(
      QuickSearchPageComponent,
    ).componentInstance;
    page.snapshot.set({
      documents: Array.from({ length: 1001 }, (_, index) => ({
        kind: 'tag',
        id: String(index),
        name: String(index),
        tags: [],
        reference: { objectId: String(index) },
      })),
      sourceCoverage: [],
    });
    page.consent.set(true);
    page.enable();
    expect(page.capacityExceeded()).toBe(true);
    expect(api.enable).not.toHaveBeenCalled();
  });
  it('lists items explicitly tagged with the discovery tag from in-memory metadata', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          data: { discovery: true },
          queryParamMap: convertToParamMap({ name: 'customers' }),
          paramMap: convertToParamMap({}),
        },
      },
    });
    api.search.mockReturnValue(
      of({
        items: [
          {
            kind: 'dashboard',
            id: 'crm',
            name: 'CRM board',
            tags: ['Customers'],
            reference: { objectId: 'crm' },
          },
        ],
        tags: [],
        itemCount: 1,
      }),
    );
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    // In-memory tags first; a ready hosted index adds tags only full item files carry.
    expect(
      fixture.componentInstance.resultMatches().map((m) => m.item.title),
    ).toEqual(['Top customers', 'CRM board']);
    expect(api.search).toHaveBeenCalledWith(
      { storeId: 'firestore', spaceID: 's', projectId: 'p' },
      'customers',
      [],
      ['customers'],
    );
  });
  it('does not send an empty query when an enabled index opens', () => {
    const page = TestBed.createComponent(
      QuickSearchPageComponent,
    ).componentInstance;
    page.query.set('  ');
    page.search();
    expect(api.search).not.toHaveBeenCalled();
  });
  it('fences delayed searches, previews and checked consent when the actor changes', async () => {
    const search = new Subject<unknown>();
    api.search
      .mockReturnValueOnce(search)
      .mockReturnValue(of({ items: [], tags: [], itemCount: 0 }));
    let resolvePreview: (value: unknown) => void = () => undefined;
    TestBed.overrideProvider(QuickSearchSnapshotService, {
      useValue: {
        preview: () =>
          new Promise((resolve) => {
            resolvePreview = resolve;
          }),
      },
    });
    const page = TestBed.createComponent(
      QuickSearchPageComponent,
    ).componentInstance;
    page.query.set('private');
    page.search();
    page.consent.set(true);
    const pending = page.preview();
    auth.next({ status: 'authenticated', user: { uid: 'second' } });
    resolvePreview({
      documents: [
        {
          kind: 'tag',
          id: 'private',
          name: 'private',
          tags: [],
          reference: {},
        },
      ],
      sourceCoverage: [],
    });
    await pending;
    search.next({
      items: [
        {
          kind: 'tag',
          id: 'private',
          name: 'private',
          tags: [],
          reference: {},
        },
      ],
    });
    expect(page.snapshot()).toBeUndefined();
    expect(page.items()).toEqual([]);
    expect(page.consent()).toBe(false);
    page.consent.set(true);
    auth.next({ status: 'notAuthenticated', user: { uid: '' } });
    expect(page.consent()).toBe(false);
  });
  it('reloads metadata when the reused schema route changes table and column', async () => {
    const params = new BehaviorSubject(convertToParamMap({ dbModelId: 'db' }));
    const query = new BehaviorSubject(
      convertToParamMap({ schema: 'dbo', table: 'A' }),
    );
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          data: { schemaDetail: true },
          paramMap: params.value,
          queryParamMap: query.value,
        },
        paramMap: params,
        queryParamMap: query,
      },
    });
    TestBed.overrideProvider(QuickSearchSnapshotService, {
      useValue: {
        preview: vi.fn(async () => ({
          documents: [
            {
              kind: 'table',
              id: 'A',
              name: 'A',
              tags: [],
              reference: { dbModelId: 'db', schema: 'dbo', table: 'A' },
            },
            {
              kind: 'table',
              id: 'B',
              name: 'B',
              tags: [],
              reference: { dbModelId: 'db', schema: 'dbo', table: 'B' },
            },
            {
              kind: 'column',
              id: 'B-ID',
              name: 'ID',
              tags: [],
              reference: {
                dbModelId: 'db',
                schema: 'dbo',
                table: 'B',
                column: 'ID',
              },
            },
          ],
          sourceCoverage: [],
        })),
      },
    });
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    await fixture.whenStable();
    expect(page.items().map((item) => item.name)).toEqual(['A']);
    query.next(convertToParamMap({ schema: 'dbo', table: 'B' }));
    await fixture.whenStable();
    expect(page.items().map((item) => item.name)).toEqual(['B', 'ID']);
    query.next(convertToParamMap({ schema: 'dbo', table: 'B', column: 'ID' }));
    await fixture.whenStable();
    expect(page.items().map((item) => item.name)).toEqual(['ID']);
  });
  it('searches the overview query and observes later query changes on a reused route', async () => {
    api.status.mockReturnValue(of({ ...ready, state: 'disabled' }));
    const query = new BehaviorSubject(convertToParamMap({ q: 'Customer' }));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          data: {},
          paramMap: convertToParamMap({}),
          queryParamMap: query.value,
        },
        queryParamMap: query,
      },
    });
    const fixture = TestBed.createComponent(QuickSearchPageComponent),
      page = fixture.componentInstance;
    await fixture.whenStable();
    expect(page.resultMatches().map((m) => m.item.title)).toEqual([
      'Customer',
      'Top customers',
    ]);
    query.next(convertToParamMap({ q: 'Sales' }));
    expect(page.query()).toBe('Sales');
    expect(page.resultMatches().map((m) => m.item.title)).toEqual(['Sales']);
    expect(api.search).not.toHaveBeenCalled();
  });
});

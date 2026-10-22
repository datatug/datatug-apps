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
import { SearchDocument, SearchStatus } from './quick-search-model';

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
  it('offers settings instead of a zero-result search counter while indexing is disabled', async () => {
    api.status.mockReturnValue(of({ ...ready, state: 'disabled' }));
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Quick Search is disabled',
    );
    expect(fixture.nativeElement.textContent).not.toContain('0 names');
    const button = [
      ...fixture.nativeElement.querySelectorAll('ion-button'),
    ].find(
      (b: unknown) =>
        (b as HTMLElement).textContent?.trim() === 'Open Index settings',
    ) as HTMLElement;
    expect(button).toBeTruthy();
    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.settings()).toBe(true);
    expect(api.enable).not.toHaveBeenCalled();
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
  it('renders late status without an extra click and discards stale query responses', async () => {
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
    page.query.set('old');
    page.search();
    page.query.set('new');
    page.search();
    old.next({
      items: [{ kind: 'tag', id: 'old', name: 'old', tags: [], reference: {} }],
    });
    expect(page.items()).toEqual([]);
    current.next({
      items: [{ kind: 'tag', id: 'new', name: 'new', tags: [], reference: {} }],
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('new');
    expect(fixture.nativeElement.textContent).not.toContain('old');
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
  it('sends the selected discovery tag as a nonempty query and filter', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          data: { discovery: true },
          queryParamMap: convertToParamMap({ name: 'Customers' }),
          paramMap: convertToParamMap({}),
        },
      },
    });
    TestBed.createComponent(QuickSearchPageComponent);
    expect(api.search).toHaveBeenCalledWith(
      { storeId: 'firestore', spaceID: 's', projectId: 'p' },
      'Customers',
      [],
      ['Customers'],
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
  it('searches the overview query and observes later query changes on a reused route', () => {
    const query = new BehaviorSubject(convertToParamMap({ q: 'Customers' }));
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
    const page = TestBed.createComponent(
      QuickSearchPageComponent,
    ).componentInstance;
    expect(api.search).toHaveBeenLastCalledWith(
      { storeId: 'firestore', spaceID: 's', projectId: 'p' },
      'Customers',
      [],
      [],
    );
    query.next(convertToParamMap({ q: 'Invoices' }));
    expect(page.query()).toBe('Invoices');
    expect(api.search).toHaveBeenLastCalledWith(
      { storeId: 'firestore', spaceID: 's', projectId: 'p' },
      'Invoices',
      [],
      [],
    );
  });

  describe('search without the status waterfall', () => {
    const doc = (name: string): SearchDocument => ({
      kind: 'tag',
      id: name,
      name,
      tags: [],
      reference: { objectId: name },
    });
    const withQuery = (q: string) =>
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: {
          snapshot: {
            data: {},
            queryParamMap: convertToParamMap({ q }),
            paramMap: convertToParamMap({}),
          },
        },
      });
    it('starts the search before status resolves and keeps results when status arrives late', async () => {
      const status = new Subject<SearchStatus>();
      api.status.mockReturnValue(status);
      api.search.mockReturnValue(
        of({ items: [doc('Customers')], tags: [], itemCount: 1 }),
      );
      withQuery('Customers');
      const fixture = TestBed.createComponent(QuickSearchPageComponent),
        page = fixture.componentInstance;
      await fixture.whenStable();
      expect(api.search).toHaveBeenCalledTimes(1);
      expect(page.items().map((i) => i.name)).toEqual(['Customers']);
      status.next(ready);
      await fixture.whenStable();
      expect(page.status()).toEqual(ready);
      expect(page.items().map((i) => i.name)).toEqual(['Customers']);
      expect(fixture.nativeElement.textContent).toContain('1 name');
      expect(api.search).toHaveBeenCalledTimes(1);
    });
    it('keeps results when status fails and shows a status retry without touching them', async () => {
      const status = new Subject<SearchStatus>();
      api.status.mockReturnValue(status);
      api.search.mockReturnValue(
        of({ items: [doc('Customers')], tags: [], itemCount: 1 }),
      );
      withQuery('Customers');
      const fixture = TestBed.createComponent(QuickSearchPageComponent),
        page = fixture.componentInstance;
      await fixture.whenStable();
      status.error(new Error('status down'));
      await fixture.whenStable();
      expect(page.statusError()).toContain('Could not load index status');
      expect(page.error()).toBe('');
      expect(page.items().map((i) => i.name)).toEqual(['Customers']);
      expect(fixture.nativeElement.textContent).toContain('Retry status');
    });
    it('does not cancel an in-flight status load when searching', async () => {
      const status = new Subject<SearchStatus>();
      api.status.mockReturnValue(status);
      const search = new Subject<unknown>();
      api.search.mockReturnValue(search);
      withQuery('x');
      const fixture = TestBed.createComponent(QuickSearchPageComponent),
        page = fixture.componentInstance;
      page.query.set('y');
      page.search();
      status.next(ready);
      expect(page.status()).toEqual(ready);
      expect(page.busy()).toBe(true);
      search.next({ items: [doc('y')], tags: [], itemCount: 1 });
      await fixture.whenStable();
      expect(page.items().map((i) => i.name)).toEqual(['y']);
    });
    it('ignores stale search responses after a project change', () => {
      const old = new Subject<unknown>();
      api.search.mockReturnValueOnce(old);
      withQuery('Customers');
      const page = TestBed.createComponent(
        QuickSearchPageComponent,
      ).componentInstance;
      api.search.mockReturnValue(new Subject());
      context.next({
        ref: { storeId: 'firestore', spaceID: 's', projectId: 'other' },
      });
      old.next({ items: [doc('stale')], tags: [], itemCount: 1 });
      expect(page.items()).toEqual([]);
    });
    it('ignores stale search responses after sign-out', () => {
      const old = new Subject<unknown>();
      api.search.mockReturnValueOnce(old);
      withQuery('Customers');
      const page = TestBed.createComponent(
        QuickSearchPageComponent,
      ).componentInstance;
      api.search.mockReturnValue(new Subject());
      auth.next({ status: 'notAuthenticated', user: { uid: '' } });
      old.next({ items: [doc('stale')], tags: [], itemCount: 1 });
      expect(page.items()).toEqual([]);
    });
    it('does not search while auth is still resolving', () => {
      auth.next({ status: 'authenticating', user: { uid: '' } });
      withQuery('Customers');
      TestBed.createComponent(QuickSearchPageComponent);
      expect(api.search).not.toHaveBeenCalled();
      auth.next({ status: 'authenticated', user: { uid: 'first' } });
      expect(api.search).toHaveBeenCalledTimes(1);
    });
    it('does not let a preview cancel an in-flight search, or a search cancel a preview', async () => {
      const search = new Subject<unknown>();
      api.search.mockReturnValue(search);
      let resolvePreview: (value: unknown) => void = () => undefined;
      TestBed.overrideProvider(QuickSearchSnapshotService, {
        useValue: {
          preview: () =>
            new Promise((resolve) => {
              resolvePreview = resolve;
            }),
        },
      });
      withQuery('Customers');
      const fixture = TestBed.createComponent(QuickSearchPageComponent),
        page = fixture.componentInstance;
      await fixture.whenStable();
      const pending = page.preview();
      search.next({ items: [doc('Customers')], tags: [], itemCount: 1 });
      expect(page.items().map((i) => i.name)).toEqual(['Customers']);
      const snapshot = { documents: [], sourceCoverage: [] };
      resolvePreview(snapshot);
      await pending;
      expect(page.snapshot()).toBe(snapshot);
      expect(page.items().map((i) => i.name)).toEqual(['Customers']);
      // A new search while a preview is pending leaves the preview alone.
      api.search.mockReturnValue(of({ items: [], tags: [], itemCount: 0 }));
      const pending2 = page.preview();
      page.search();
      resolvePreview(snapshot);
      await pending2;
      expect(page.snapshot()).toBe(snapshot);
    });
    const httpError = (status: number, code: string) => ({
      status,
      error: { error: { code } },
    });
    it.each([
      [409, 'consent_required', 'consent', 'Quick Search is disabled'],
      [
        409,
        'quick_search_reindex_required',
        'reindex',
        'must be refreshed before it can be searched',
      ],
      [
        409,
        'quick_search_unsupported_storage',
        'unsupported',
        "isn't available yet for projects stored in DataTug cloud",
      ],
      [
        409,
        'quick_search_premium_required',
        'premium',
        'requires a Pro or Business plan',
      ],
      [403, 'project_denied', 'denied', "don't have access"],
      [409, 'operation_in_progress', 'conflict', 'being changed right now'],
      [503, 'provider_unavailable', 'unavailable', 'temporarily unavailable'],
      [429, 'quick_search_rate_limited', 'rateLimited', 'Too many searches'],
    ])(
      'renders an explicit state for %s %s',
      async (status, code, problem, text) => {
        api.search.mockReturnValue(throwError(() => httpError(status, code)));
        withQuery('Customers');
        const fixture = TestBed.createComponent(QuickSearchPageComponent);
        await fixture.whenStable();
        expect(fixture.componentInstance.problem()).toBe(problem);
        expect(fixture.nativeElement.textContent).toContain(text);
        expect(fixture.componentInstance.items()).toEqual([]);
        expect(fixture.nativeElement.textContent).not.toContain('0 names');
        expect(fixture.nativeElement.textContent).not.toContain(
          'No matching items',
        );
      },
    );
    it('gives non-managers a neutral reindex message without a settings link', async () => {
      api.status.mockReturnValue(of({ ...ready, canManage: false }));
      api.search.mockReturnValue(
        throwError(() => httpError(409, 'quick_search_reindex_required')),
      );
      withQuery('Customers');
      const fixture = TestBed.createComponent(QuickSearchPageComponent);
      await fixture.whenStable();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('A project manager needs to refresh it');
      expect(text).not.toContain('Open Index settings');
    });
    it('shows disabled consent state to managers with an Index settings button', async () => {
      api.search.mockReturnValue(
        throwError(() => httpError(409, 'consent_required')),
      );
      withQuery('Customers');
      const fixture = TestBed.createComponent(QuickSearchPageComponent);
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Open Index settings',
      );
    });
    it('labels counts as the last indexed snapshot and renders unavailable counts explicitly', async () => {
      api.status.mockReturnValue(
        of({
          ...ready,
          documentCount: 157,
          lastIndexedAt: '2026-10-22T10:42:00',
        }),
      );
      const fixture = TestBed.createComponent(QuickSearchPageComponent);
      fixture.componentInstance.settings.set(true);
      await fixture.whenStable();
      expect(
        (fixture.nativeElement.textContent as string).replace(/\s+/g, ' '),
      ).toContain('Last indexed snapshot: 157 items · indexed 22 Oct 10:42');
      api.status.mockReturnValue(
        of({ ...ready, documentCount: 0, countsUnavailable: 'not_eligible' }),
      );
      fixture.componentInstance.loadStatus();
      await fixture.whenStable();
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('Item counts unavailable');
      expect(text).not.toContain('0 items');
    });
  });
});

import { SneatAuthStateService } from '@sneat/auth-core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  ActivatedRoute,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { QuickSearchPageComponent } from './quick-search-page.component';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { SearchStatus } from './quick-search-model';

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
  it('offers settings instead of a zero-result search counter while indexing is disabled',async()=>{
    api.status.mockReturnValue(of({...ready,state:'disabled'}));
    const fixture=TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Quick Search is disabled');
    expect(fixture.nativeElement.textContent).not.toContain('0 names');
    const button=[...fixture.nativeElement.querySelectorAll('ion-button')].find((b:unknown)=>(b as HTMLElement).textContent?.trim()==='Open Index settings') as HTMLElement;
    expect(button).toBeTruthy();button.click();
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
    expect(fixture.nativeElement.textContent).toContain('0 names');
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
});

import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { QuickSearchPageComponent } from './quick-search-page.component';
import { QuickSearchApiService } from './quick-search-api.service';
import { QuickSearchSnapshotService } from './quick-search-snapshot.service';
import { ProjectService } from '../services/project/project.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { QueriesService } from '../queries/queries.service';
import { ProjectMetadataSearchService } from './project-metadata-search.service';

const ref = {
  storeId: 'github.com',
  projectId: 'repo@owner@folder',
  projectApi: 'cloud' as const,
  branch: 'private-ref',
};
function setup(preview: ReturnType<typeof vi.fn>) {
  const forbidden = vi.fn(() => {
    throw new Error('Private metadata must use the server snapshot only');
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: QuickSearchApiService, useValue: { preview } },
      {
        provide: ProjectService,
        useValue: { watchProjectSummary: forbidden, getFull: forbidden },
      },
      { provide: ProjectQueryApiService, useValue: { folder: forbidden } },
      { provide: QueriesService, useValue: { getQueriesFolder: forbidden } },
      {
        provide: GithubProjectReaderService,
        useValue: {
          getRawJson: forbidden,
          listDirectory: forbidden,
          readInfo: forbidden,
          visitEpoch: forbidden,
        },
      },
    ],
  });
  return {
    get service() {
      return TestBed.inject(QuickSearchSnapshotService);
    },
    forbidden,
  };
}
describe('registered cloud GitHub metadata preview', () => {
  it('returns one canonical authorized snapshot without mixing other readers or indexing', async () => {
    const snapshot = {
      documents: [
        {
          kind: 'table',
          id: 'db/dbo/table/Customers',
          name: 'Customers',
          sourceName: 'db',
          tags: [],
          reference: { dbModelId: 'db', schema: 'dbo', table: 'Customers' },
        },
      ],
      sourceCoverage: [{ kind: 'table', status: 'complete', count: 1 }],
    };
    const preview = vi.fn(() => of(snapshot));
    const { service, forbidden } = setup(preview);
    expect(await service.preview(ref, 'env')).toBe(snapshot);
    expect(preview).toHaveBeenCalledExactlyOnceWith(ref, 'env');
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('propagates an authorized read failure rather than inventing complete zero coverage', async () => {
    const { service, forbidden } = setup(
      vi.fn(() => throwError(() => new Error('denied'))),
    );
    await expect(service.preview(ref)).rejects.toThrow('denied');
    expect(forbidden).not.toHaveBeenCalled();
  });
});

describe('pending authenticated cloud preview fences', () => {
  it.each(['actor', 'project', 'environment', 'query'])(
    'does not publish old metadata after %s changes',
    async (change) => {
      const pending = new Subject<{
        documents: never[];
        sourceCoverage: never[];
      }>();
      setup(vi.fn(() => pending));
      const auth = new BehaviorSubject({
        status: 'authenticated',
        user: { uid: 'first' },
      });
      const project = new BehaviorSubject({ ref });
      const environment = new BehaviorSubject<{ id: string } | undefined>(
        undefined,
      );
      const query = new BehaviorSubject(convertToParamMap({}));
      TestBed.configureTestingModule({
        imports: [QuickSearchPageComponent],
        providers: [
          provideRouter([]),
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                data: {},
                paramMap: convertToParamMap({}),
                queryParamMap: query.value,
              },
              queryParamMap: query,
            },
          },
          { provide: SneatAuthStateService, useValue: { authState: auth } },
          {
            provide: DatatugNavContextService,
            useValue: { currentProject: project, currentEnv: environment },
          },
          {
            provide: ProjectMetadataSearchService,
            useValue: {
              metadata: () => of({ items: [], loading: false }),
              includeColumns: () => undefined,
            },
          },
        ],
      });
      TestBed.overrideProvider(QuickSearchApiService, {
        useValue: {
          preview: () => pending,
          status: () => of({ state: 'ready', canManage: true, eligible: true }),
          search: () => of({ items: [], tags: [], itemCount: 0 }),
        },
      });
      const fixture = TestBed.createComponent(QuickSearchPageComponent),
        page = fixture.componentInstance;
      await fixture.whenStable();
      page.consent.set(true);
      const preview = page.preview();
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'second' } });
      if (change === 'project')
        project.next({ ref: { ...ref, projectId: 'another@owner@folder' } });
      if (change === 'environment') environment.next({ id: 'other-env' });
      if (change === 'query')
        query.next(convertToParamMap({ q: 'other-query' }));
      pending.next({ documents: [], sourceCoverage: [] });
      pending.complete();
      await preview;
      if (change === 'query') {
        // A new search text is not a new scope: it must never abort a metadata preview.
        expect(page.snapshot()).toEqual({ documents: [], sourceCoverage: [] });
        expect(page.busy()).toBe(false);
        return;
      }
      expect(page.snapshot()).toBeUndefined();
      expect(page.consent()).toBe(false);
    },
  );
});

describe('authorized cloud schema metadata detail', () => {
  it('uses canonical server references when table and column change on the reused route', async () => {
    const snapshot = {
      documents: [
        {
          kind: 'table',
          id: 'db/dbo/table/A',
          name: 'A',
          tags: [],
          reference: { dbModelId: 'db', schema: 'dbo', table: 'A' },
        },
        {
          kind: 'table',
          id: 'db/dbo/table/B',
          name: 'B',
          tags: [],
          reference: { dbModelId: 'db', schema: 'dbo', table: 'B' },
        },
        {
          kind: 'column',
          id: 'db/dbo/table/B/ID',
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
    };
    const preview = vi.fn(() => of(snapshot));
    const { forbidden } = setup(preview);
    const params = new BehaviorSubject(convertToParamMap({ dbModelId: 'db' })),
      query = new BehaviorSubject(
        convertToParamMap({ schema: 'dbo', table: 'A' }),
      );
    TestBed.configureTestingModule({
      imports: [QuickSearchPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { schemaDetail: true },
              paramMap: params.value,
              queryParamMap: query.value,
            },
            paramMap: params,
            queryParamMap: query,
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: 'authenticated', user: { uid: 'actor' } }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of({ ref }) },
        },
      ],
    });
    TestBed.overrideProvider(QuickSearchApiService, {
      useValue: {
        preview,
        status: () =>
          of({ state: 'disabled', canManage: false, eligible: true }),
      },
    });
    const fixture = TestBed.createComponent(QuickSearchPageComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.items().map((d) => d.name)).toEqual(['A']);
    query.next(convertToParamMap({ schema: 'dbo', table: 'B' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.items().map((d) => d.name)).toEqual([
      'B',
      'ID',
    ]);
    query.next(convertToParamMap({ schema: 'dbo', table: 'B', column: 'ID' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.items().map((d) => d.id)).toEqual([
      'db/dbo/table/B/ID',
    ]);
    expect(forbidden).not.toHaveBeenCalled();
  });
});


describe('hosted Firestore canonical preview',()=>{
  it('preserves actual check/dashboard tags and coverage from the authorized environment snapshot',async()=>{
    const hosted={storeId:'firestore',spaceID:'space',projectId:'project'};
    const snapshot={documents:[
      {kind:'check',id:'check-1',name:'Customer check',tags:['customers'],reference:{objectId:'check-1',environmentId:'env'}},
      {kind:'dashboard',id:'dashboard-1',name:'Customer dashboard',tags:['sales','customers'],reference:{objectId:'dashboard-1',environmentId:'env'}},
    ],sourceCoverage:[{kind:'check',status:'complete',count:1},{kind:'dashboard',status:'complete',count:1},{kind:'table',status:'unavailable',count:0}]};
    const preview=vi.fn(()=>of(snapshot));const {service,forbidden}=setup(preview);
    expect(await service.preview(hosted,'env')).toBe(snapshot);
    expect(preview).toHaveBeenCalledExactlyOnceWith(hosted,'env');
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('does not fall back to local summaries after a hosted authorization failure',async()=>{
    const {service,forbidden}=setup(vi.fn(()=>throwError(()=>new Error('denied'))));
    await expect(service.preview({storeId:'firestore',spaceID:'space',projectId:'project'},'env')).rejects.toThrow('denied');
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('rejects an invalid shared scope before any metadata read',async()=>{
    const preview=vi.fn();const {service,forbidden}=setup(preview);
    await expect(service.preview({storeId:'firestore',spaceID:'../other',projectId:'project'})).rejects.toThrow('Invalid project scope');
    expect(preview).not.toHaveBeenCalled();expect(forbidden).not.toHaveBeenCalled();
  });
});

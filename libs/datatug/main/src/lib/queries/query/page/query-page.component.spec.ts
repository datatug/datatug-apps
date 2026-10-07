import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { resolve } from 'node:path';
import { nativeFixture } from '../../public-data/native-fixture.spec-helper';
import { PublicDataService } from '../../public-data/public-data.service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectorRef,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Firestore } from 'firebase/firestore';
import { ErrorLogger } from '@sneat/core';
import { RANDOM_ID_OPTIONS, RandomIdService } from '@sneat/random';
import {
  AgentContextService,
  InvestigationContextService,
  SemanticApiService,
  type RunQueryResponse,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';

import {
  QueryPageComponent,
  extractLinkedEntityNames,
} from './query-page.component';
import { IQueryEditorState, IQueryState } from '../../../editor/models';
import { IProjectContext } from '../../../nav/nav-models';
import {
  IQueryDef,
  ISqlQueryRequest,
  ITextQueryRequest,
  QueryType,
} from '../../../models/definition/query-def';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import { QueriesService } from '../../queries.service';
import { Coordinator } from '../../../executor/coordinator';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { FederatedQueryService } from '../../federated-query.service';
import { graphFixturePlan } from '../../public-data/native-graph.spec-helper';
import { graphStableIdentity } from '../../public-data/native-graph-executor';
import { createOutputStores, replaceGraphOutput, openLocalResult, deleteLocalResult, type LocalResultDescriptor } from '../../federated-local-results';
import { INITIAL_CANONICAL_PINS } from '../../public-data/canonical-metadata';
import {
  SAVED_SCENARIO_PUBLICATION_BLOCKER,
  type PublicDataScenario,
} from '../../public-data/public-data-scenario';

function agentContextStub(securityContextId: string | undefined = 'sctx-1') {
  return {
    securityContextId: signal(securityContextId),
    refresh: vi.fn(() => of(undefined)),
  };
}

describe('SqlEditorPage', () => {
  let component: QueryPageComponent;
  let fixture: ComponentFixture<QueryPageComponent>;

  beforeEach(async () => {
    sessionStorage.clear();
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { query: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(undefined),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        {
          provide: SemanticApiService,
          useValue: { runQuery: vi.fn() },
        },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueryPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // G-A1c: where the back button goes with no history: the project's queries (its address is the one
  // `projectUrl()` writes), in the folder of this query.
  it.each([
    [
      'an agent project',
      { storeId: 'localhost:8989', projectId: 'datatug-demo-project' },
      'customers',
      '/store/localhost:8989/project/datatug-demo-project/queries?folder=customers',
    ],
    [
      'an agent project, query in no folder',
      { storeId: 'localhost:8989', projectId: 'p1' },
      '',
      '/store/localhost:8989/project/p1/queries?folder=',
    ],
    [
      'a GitHub project',
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      'sales',
      '/project/github.com/datatug/chinook-demo/queries?folder=sales',
    ],
    [
      'a GitHub project in a folder',
      { storeId: 'github.com', projectId: 'r@o@d' },
      'sales',
      '/project/github.com/o/r/tree/HEAD/d/-/queries?folder=sales',
    ],
  ])(
    'the back button goes to the queries of %s',
    (_name, ref, folder, href) => {
      component.project = { ref };
      component.queryFolderPath = folder;
      expect(component.queriesBackHref).toBe(href);
    },
  );

  it('the back button goes to the root while there is no project', () => {
    component.queryFolderPath = 'sales';
    expect(component.queriesBackHref).toBe('/?folder=sales');
  });
});

// REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6), Task 15 item 3
// (binding-resolver.ts precedence/ambiguity/conflict). Uses the REAL
// InvestigationContextService (not a bindingsFor() mock) so scope-keyed storage,
// typed equality and the resolver's precedence are exercised end to end, the same as
// production — see investigation-context.service.spec.ts / binding-resolver.spec.ts
// for those units' own isolated coverage.
describe('QueryPageComponent — semantic parameter binding and run', () => {
  let component: QueryPageComponent;
  let runFixture: ComponentFixture<QueryPageComponent>;
  let runQueryMock: ReturnType<typeof vi.fn>;
  let federatedRunMock: ReturnType<typeof vi.fn>;
  let federatedGetPageMock: ReturnType<typeof vi.fn>;
  let agentContext: ReturnType<typeof agentContextStub>;
  let investigationContext: InvestigationContextService;

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };

  const queryDef: IQueryDef = {
    id: 'customer-invoices',
    title: 'Customer invoices',
    request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
  };

  const editorState: IQueryEditorState = {
    currentQueryId: queryDef.id,
    activeQueries: [
      {
        id: queryDef.id,
        queryType: QueryType.SQL,
        request: queryDef.request,
        def: queryDef,
      },
    ],
  } as unknown as IQueryEditorState;

  async function createComponent(
    historyState: Record<string, unknown> = {},
    definition: IQueryDef = queryDef,
    template = '<ul aria-label="Access blockers">@for (blocker of accessBlockers(); track $index) {<li>{{ blocker }}</li>}</ul>',
    navigation?: { editor: Observable<IQueryEditorState>; project: Observable<IProjectContext> },
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    runQueryMock = vi.fn();
    federatedRunMock = vi.fn();
    federatedGetPageMock = vi.fn();
    agentContext = agentContextStub();
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: navigation?.project ?? of(project),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: navigation?.editor ?? of(
              definition === queryDef
                ? editorState
                : {
                    ...editorState,
                    currentQueryId: definition.id,
                    activeQueries: [
                      {
                        id: definition.id,
                        queryType: QueryType.SQL,
                        request: definition.request,
                        def: definition,
                      },
                    ],
                  },
            ),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: runQueryMock } },
        {
          provide: FederatedQueryService,
          useValue: {
            run: federatedRunMock,
            getPage: federatedGetPageMock,
            dispose: vi.fn().mockResolvedValue(undefined),
            listLocalResults: vi.fn().mockResolvedValue([]),
            openLocalResult: vi.fn(),
            associateLocalResult: vi.fn().mockResolvedValue(undefined),
            deleteLocalResult: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AgentContextService, useValue: agentContext },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template,
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    investigationContext = TestBed.inject(InvestigationContextService);
    runFixture = TestBed.createComponent(QueryPageComponent);
    const created = runFixture.componentInstance;
    created.project = project;
    created.envId = 'production';
    // The component's own effect/constructor already calls setScope once project/env/
    // securityContextId are all available (Task 15 item 2), but DatatugNavContextService
    // is stubbed here rather than reactive, so nudge it once explicitly the same way a
    // real change-detection tick would.
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
    });
    return created;
  }

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
    factId: 'selection-customer-5',
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('keeps accepted plan review state across no-op editor emissions and resets it for a definition edit', async () => {
    const definition: IQueryDef = {
      ...historyDefinition(),
      request: {
        queryType: QueryType.DTQL,
        text: 'from:\n  name: Person\n  alias: p\n',
      } as unknown as ITextQueryRequest,
    };
    const editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, '<p></p>', {
      editor,
      project: of(project),
    });
    component.publicDataRevisionAcknowledged.set(true);
    component.savedPlanReview.acknowledged.set('accepted-fingerprint');

    editor.next({
      ...editor.value,
      activeQueries: editor.value.activeQueries.map((query) => ({
        ...query,
        isSaving: true,
      })),
    });
    await runFixture.whenStable();
    expect(component.publicDataRevisionAcknowledged()).toBe(true);
    expect(component.savedPlanReview.acknowledged()).toBe('accepted-fingerprint');

    const edited = editor.value.activeQueries[0];
    editor.next({
      ...editor.value,
      activeQueries: [{
        ...edited,
        request: {
          queryType: QueryType.DTQL,
          text: 'from:\n  name: Person\n  alias: p\nlimit: 5\n',
        } as unknown as ITextQueryRequest,
      }],
    });
    await runFixture.whenStable();
    expect(component.publicDataRevisionAcknowledged()).toBe(false);
    expect(component.savedPlanReview.acknowledged()).toBeUndefined();
  });

  it('opens saved history and pages all three grids locally with original pins and timestamp, no run or metadata fetch', async () => {
    const definition = { ...queryDef, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: graphFixturePlan() } };
    const template = '<p>{{ selectedHistoricalResult() ? "Historical local result" : "idle" }}</p><p>{{ runResult()?.provenance?.observedAt }}</p><pre>{{ historicalPins() }}</pre><span>{{ relatedResultSet() }} {{ resultTotalRows() }}</span>@for (row of visibleResultRows(); track $index) {<span>{{ displayValue(row[0]) }}</span>}';
    component = await createComponent({}, definition, template);
    runFixture.detectChanges();
    const service = TestBed.inject(FederatedQueryService);
    const ref = { id: 'datatug-output-100000-abc', generation: 1 };
    const historical = { localResult: ref, recordset: { columns: [{ name: 'Affiliation', type: 'string' }], rows: [{ type: 'string', value: 'original-affiliation' }] .map((cell) => [cell]) }, totalRows: 150,
      relatedRecordsets: [{ id: 'locations', label: 'Locations', totalRows: 135, recordset: { columns: [{ name: 'Location', type: 'string' }], rows: [[{ type: 'string', value: 'original-location' }]] } }, { id: 'aliases', label: 'Alternate names', totalRows: 115, recordset: { columns: [{ name: 'Alias', type: 'string' }], rows: [[{ type: 'string', value: 'original-alias' }]] } }],
      limitations: [], bindingsApplied: [], truncated: false, provenance: { observedAt: '2026-10-01T09:30:00Z', source: 'fixture', queryId: definition.id, mode: 'live', executionProfile: 'protected' } };
    vi.mocked(service.openLocalResult).mockResolvedValue({ result: historical, executedDefinition: definition, descriptor: { ...ref } as LocalResultDescriptor } as Awaited<ReturnType<typeof service.openLocalResult>>);
    const metadata = TestBed.inject(PublicDataService); const loadMetadata = vi.spyOn(metadata, 'revalidate');
    await component.openHistoricalResult(ref.id); await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).toContain('Historical local result');
    expect(runFixture.nativeElement.textContent).toContain('2026-10-01T09:30:00Z');
    expect(runFixture.nativeElement.textContent).toContain('original-affiliation');
    expect(component.historicalDefinition()).toEqual(definition);
    await component.changeRelatedResultSet('locations'); await runFixture.whenStable();
    expect(component.resultTotalRows()).toBe(135); expect(runFixture.nativeElement.textContent).toContain('original-location');
    await component.changeRelatedResultSet('aliases'); await runFixture.whenStable();
    expect(component.resultTotalRows()).toBe(115); expect(runFixture.nativeElement.textContent).toContain('original-alias');
    federatedGetPageMock.mockResolvedValue([[{ type: 'string', value: 'alias-page-2' }]]);
    await component.changeResultPage(1); await runFixture.whenStable();
    expect(federatedGetPageMock).toHaveBeenCalledWith(1, 'aliases', ref);
    expect(runFixture.nativeElement.textContent).toContain('alias-page-2');
    expect(federatedRunMock).not.toHaveBeenCalled(); expect(runQueryMock).not.toHaveBeenCalled(); expect(loadMetadata).not.toHaveBeenCalled();
  });

  it('shows unavailable local history and discards a delayed old page after choosing a different historical artifact', async () => {
    component = await createComponent(); const service = TestBed.inject(FederatedQueryService);
    vi.mocked(service.openLocalResult).mockRejectedValue(new Error('No local result available.'));
    await component.openHistoricalResult('missing'); expect(component.localHistoryError()).toContain('No local result'); expect(federatedRunMock).not.toHaveBeenCalled();
    const result = { localResult: { id: 'old', generation: 1 }, recordset: { columns: [], rows: [] }, totalRows: 150, limitations: [], bindingsApplied: [], provenance: { observedAt: 'old', queryId: 'old', source: 'fixture' } };
    component.runResult.set(result as never); component.selectedHistoricalResult.set(result.localResult);
    let release!: (rows: unknown) => void; federatedGetPageMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = component.changeResultPage(1);
    const next = { ...result, localResult: { id: 'new', generation: 1 }, recordset: { columns: [], rows: [[{ type: 'string', value: 'new-row' }]] } };
    vi.mocked(service.openLocalResult).mockResolvedValue({ result: next, executedDefinition: queryDef, descriptor: {} as LocalResultDescriptor } as Awaited<ReturnType<typeof service.openLocalResult>>);
    await component.openHistoricalResult('new'); release([[{ type: 'string', value: 'stale-row' }]]); await pending;
    expect(component.visibleResultRows()).toEqual(next.recordset.rows); expect(component.resultPageIndex()).toBe(0);
  });

  const historyDefinition = (): IQueryDef => ({ ...queryDef, federation: { ovdbBaseUrl: 'https://runtime.example', tables: [], nativeGraph: graphFixturePlan() } });
  const historyStateFor = (definition: IQueryDef): IQueryEditorState => ({ currentQueryId: definition.id, activeQueries: [{ id: definition.id, queryType: QueryType.DTQL, request: definition.request, def: definition }] }) as IQueryEditorState;
  const historyResultFor = (definition: IQueryDef, id = 'datatug-output-100000-abc') => ({
    localResult: { id, generation: 1 }, nativeGraph: { planIdentity: graphStableIdentity(definition.federation?.nativeGraph), stageActions: [] },
    recordset: { columns: [{ name: 'Affiliation', type: 'string' }], rows: [[{ type: 'string', value: 'original-row' }]] }, totalRows: 150,
    limitations: [], bindingsApplied: [], truncated: false,
    provenance: { observedAt: '2026-10-01T09:30:00Z', queryId: definition.id, source: 'synthetic', mode: 'live', executionProfile: 'protected' },
  }) as Awaited<ReturnType<FederatedQueryService['run']>>;
  const historyResultTemplate = (): string => readFileSync(resolve('libs/datatug/main/src/lib/queries/query/page/query-page.component.html'), 'utf8').split('  @if (runResult(); as result) {')[1].split('</ion-content>')[0].replace(/^/, '@if (runResult(); as result) {');

  it('renders exact plain P1 evidence from actual IndexedDB reopening in the original grid and preserves all three sets', async () => {
    const definition = historyDefinition(); component = await createComponent({}, definition, historyResultTemplate());
    const tokens = ['-0', '1e400', '-1e400', '0e400', '1.0000000000000001', '9007199254740990.5', '{"nested":[-0,1e3,9007199254740993]}'];
    const result = { ...historyResultFor(definition), relatedRecordsets: [{ id: 'locations', label: 'Locations', parentSet: 'affiliations', parentField: 'Affiliation', totalRows: tokens.length, recordset: { columns: [{ name: 'Exact reference evidence', type: 'string' }], rows: tokens.map((token) => [{ type: 'string' as const, value: token }]) } }, { id: 'aliases', label: 'Alternate names', parentSet: 'locations', parentField: 'Location', totalRows: 0, recordset: { columns: [{ name: 'Alias', type: 'string' }], rows: [] } }] } as Awaited<ReturnType<FederatedQueryService['run']>>;
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(`datatug-output-100000-${crypto.randomUUID()}`, 2); request.onupgradeneeded = () => createOutputStores(request.result); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const descriptor = await replaceGraphOutput(db, definition, result, result.recordset.rows, 1); db.close();
    try {
      vi.mocked(TestBed.inject(FederatedQueryService).openLocalResult).mockImplementation(openLocalResult);
      await component.openHistoricalResult(descriptor.id); await component.changeRelatedResultSet('locations'); await runFixture.whenStable();
      const values = Array.from(runFixture.nativeElement.querySelectorAll('tbody td') as NodeListOf<HTMLElement>, (cell) => cell.textContent?.trim());
      expect(values).toEqual(tokens); expect(component.historicalDefinition()).toEqual(definition);
      await component.changeRelatedResultSet('aliases'); await runFixture.whenStable(); expect(component.visibleResultRows()).toEqual([]);
      await component.changeRelatedResultSet('affiliations'); await runFixture.whenStable(); expect(runFixture.nativeElement.textContent).toContain('original-row');
      expect(federatedRunMock).not.toHaveBeenCalled(); expect(runQueryMock).not.toHaveBeenCalled();
    } finally { await deleteLocalResult(descriptor.id); }
  });

  it.each(['aliases', 'fields', 'selection', 'operator', 'pins', 'in-place'])('marks completed output historical immediately on %s edit and preserves executed pins', async (change) => {
    const definition = historyDefinition(), originalDefinition = structuredClone(definition), editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, historyResultTemplate(), { editor, project: of(project) });
    const result = historyResultFor(definition); federatedRunMock.mockResolvedValue(result);
    component.runQuery(); await runFixture.whenStable();
    expect(runFixture.nativeElement.querySelector('[data-testid="result-provenance"]').textContent).toContain('live');
    const changed = change === 'in-place' ? definition : structuredClone(definition), plan = changed.federation?.nativeGraph;
    if (!plan) throw new Error('Missing graph fixture.');
    // These are editor drafts, never admitted for execution by this test.
    if (change === 'aliases' || change === 'in-place') Object.assign(plan, { aliases: false });
    if (change === 'fields') Object.assign(plan.stages.locations, { fields: [...plan.stages.locations.fields, 'draft_field'] });
    if (change === 'selection') Object.assign(plan.selection, { rows: 999 });
    if (change === 'operator') Object.assign(plan.envelope.graphs[0].edges[1], { projection: 'draft-operator/1' });
    if (change === 'pins') Object.assign(plan.stages.locations.runtime, { manifestSha256: 'e'.repeat(64) });
    editor.next(historyStateFor(changed)); await runFixture.whenStable();
    expect(component.runResult()).toBe(result); expect(component.selectedHistoricalResult()).toEqual(result.localResult);
    expect(component.historicalDefinition()).toEqual(originalDefinition);
    expect(runFixture.nativeElement.textContent).toContain('Historical local result');
    expect(runFixture.nativeElement.textContent).toContain('2026-10-01T09:30:00Z');
    expect(runFixture.nativeElement.textContent).toContain('original-row');
    expect(runFixture.nativeElement.querySelector('[data-testid="result-provenance"]').textContent).not.toContain('live');
    expect(TestBed.inject(FederatedQueryService).dispose).toHaveBeenCalled();
    expect(federatedRunMock).toHaveBeenCalledOnce(); expect(runQueryMock).not.toHaveBeenCalled();
  });

  it.each(['edit', 'history', 'destroy'])('invalidates actual service startup before Worker creation on %s', async (action) => {
    const definition = historyDefinition(), editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, historyResultTemplate(), { editor, project: of(project) });
    const service = TestBed.inject(FederatedQueryService), actual = new FederatedQueryService();
    const construct = vi.fn(); vi.stubGlobal('Worker', construct);
    let release!: () => void;
    const cleanup = vi.spyOn(indexedDB, 'databases').mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    federatedRunMock.mockImplementation(actual.run.bind(actual));
    vi.mocked(service.dispose).mockImplementation(actual.dispose.bind(actual));
    vi.mocked(service.openLocalResult).mockRejectedValue(new Error('Fixture unavailable.'));
    try {
      component.runQuery(); await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
      if (action === 'edit') { Object.assign(definition.federation?.nativeGraph ?? {}, { aliases: false }); editor.next(historyStateFor(definition)); }
      if (action === 'history') await component.openHistoricalResult('fixture');
      if (action === 'destroy') component.ngOnDestroy();
      await Promise.resolve(); await Promise.resolve();
      expect(component.running()).toBe(false); expect(component.runResult()).toBeUndefined();
      release(); await runFixture.whenStable();
      expect(construct).not.toHaveBeenCalled(); expect(component.runResult()).toBeUndefined(); expect(component.runError()).toBeUndefined();
    } finally { cleanup.mockRestore(); vi.unstubAllGlobals(); }
  });

  it.each(['edit', 'silent-in-place'])('does not publish delayed output live across %s mutation and fences all old callbacks', async (action) => {
    const definition = historyDefinition(), editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, historyResultTemplate(), { editor, project: of(project) });
    let finish!: (value: Awaited<ReturnType<FederatedQueryService['run']>>) => void;
    federatedRunMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    component.runQuery(); const oldCall = federatedRunMock.mock.calls.at(-1);
    Object.assign(definition.federation?.nativeGraph ?? {}, { aliases: false });
    if (action === 'edit') editor.next(historyStateFor(definition));
    oldCall?.[1]?.({ phase: 'old' } as Parameters<NonNullable<Parameters<FederatedQueryService['run']>[1]>>[0]);
    oldCall?.[4]?.(999);
    finish(historyResultFor(oldCall?.[0] as IQueryDef)); await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined(); expect(component.federatedProgress()).toBeUndefined();
    expect(runFixture.nativeElement.textContent).not.toContain('original-row');
    expect(component.running()).toBe(false);
  });

  it.each(['resolve', 'reject'])('old completion %s cannot finalize or report errors into an immediate replacement', async (outcome) => {
    const definition = historyDefinition(), editor = new BehaviorSubject(historyStateFor(definition));
    component = await createComponent({}, definition, historyResultTemplate(), { editor, project: of(project) });
    let finishOld!: (value: Awaited<ReturnType<FederatedQueryService['run']>>) => void, failOld!: (error: Error) => void;
    let finishNew!: (value: Awaited<ReturnType<FederatedQueryService['run']>>) => void;
    federatedRunMock.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject; })).mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    component.runQuery(); const original = structuredClone(definition);
    Object.assign(definition.federation?.nativeGraph ?? {}, { aliases: false }); editor.next(historyStateFor(definition));
    component.runQuery(); expect(component.running()).toBe(true);
    if (outcome === 'resolve') finishOld(historyResultFor(original)); else failOld(new Error('Old failure.'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(component.running()).toBe(true); expect(component.runError()).toBeUndefined(); expect(component.runResult()).toBeUndefined();
    const replacement = historyResultFor(definition, 'datatug-output-100000-new'); finishNew(replacement); await runFixture.whenStable();
    expect(component.runResult()).toBe(replacement); expect(component.running()).toBe(false);
  });

  it.each(['resolve', 'reject'])('fences delayed local open %s across actual editor and project subscriptions', async (outcome) => {
    const definition = historyDefinition(), editor = new BehaviorSubject(historyStateFor(definition)), projects = new BehaviorSubject(project);
    component = await createComponent({}, definition, historyResultTemplate(), { editor, project: projects });
    const service = TestBed.inject(FederatedQueryService);
    let resolveOpen!: (value: Awaited<ReturnType<typeof service.openLocalResult>>) => void, rejectOpen!: (error: Error) => void;
    vi.mocked(service.openLocalResult).mockImplementation(() => new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; }));
    const pending = component.openHistoricalResult('datatug-output-100000-abc');
    await vi.waitFor(() => expect(service.openLocalResult).toHaveBeenCalledOnce());
    const other = { ...historyDefinition(), id: 'other-query' };
    projects.next({ ref: { storeId: 'other-store', projectId: 'other-project' } }); editor.next(historyStateFor(other));
    const current = historyResultFor(other, 'datatug-output-100000-def'); component.runResult.set(current);
    if (outcome === 'resolve') resolveOpen({ result: historyResultFor(definition), executedDefinition: definition, descriptor: {} as LocalResultDescriptor });
    else rejectOpen(new Error('Old artifact failed.'));
    await pending; await runFixture.whenStable();
    expect(component.runResult()).toBe(current); expect(component.historicalDefinition()).toBeUndefined();
    expect(component.localHistoryError()).toBeUndefined(); expect(component.localHistoryLoading()).toBe(false);
    expect(federatedRunMock).not.toHaveBeenCalled(); expect(runQueryMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears deleted displayed artifact with historical=%s and keeps another view usable', async (historical) => {
    const definition = historyDefinition(); component = await createComponent({}, definition, historyResultTemplate());
    const service = TestBed.inject(FederatedQueryService), result = historyResultFor(definition);
    component.runResult.set(result); if (historical) component.selectedHistoricalResult.set(result.localResult);
    if (!result.localResult) throw new Error('Missing graph result.');
    await component.deleteHistoricalResult(result.localResult.id); await runFixture.whenStable();
    expect(component.runResult()).toBeUndefined(); expect(component.visibleResultRows()).toEqual([]);
    expect(runFixture.nativeElement.textContent).not.toContain('original-row');
    const other = historyResultFor(definition, 'datatug-output-100000-def');
    vi.mocked(service.openLocalResult).mockResolvedValue({ result: other, executedDefinition: definition, descriptor: {} as LocalResultDescriptor });
    if (!other.localResult) throw new Error('Missing other graph result.');
    await component.openHistoricalResult(other.localResult.id); federatedGetPageMock.mockResolvedValue([[{ type: 'string', value: 'other-page' }]]);
    await component.changeResultPage(1); expect(component.visibleResultRows()[0][0].value).toBe('other-page');
    expect(service.deleteLocalResult).toHaveBeenCalledExactlyOnceWith(result.localResult.id);
  });

  it('reopens saved immutable provenance without lookup, exposes changed revisions and rejects a stored eligibility flag', async () => {
    const file = INITIAL_CANONICAL_PINS.directory;
    const saved: PublicDataScenario = {
      source: {
        schema: file,
        module: 'fixture',
        entity: 'Customer',
        property: 'Country',
        datatype: 'string',
        namespace: 'fixture-labels',
      },
      canonical: {
        ...INITIAL_CANONICAL_PINS,
        directory: { ...file, revision: 'b'.repeat(40) },
      },
      attachment: file,
      snapshot: file,
      model: file,
      meaning: file,
      decision: file,
      decisionScope: 'fixture-only',
      namespace: 'fixture-native',
      projection: 'identity',
      equality: 'utf8-byte-exact',
      rights: {
        source: 'fixture',
        model: 'fixture',
        meaning: 'fixture',
        attribution: 'fixture',
      },
      observedAt: '2026-10-05',
      eligible: true,
      unavailableReason: 'pending',
    };
    const definition: IQueryDef = {
      ...queryDef,
      id: 'saved-fixture',
      federation: { ovdbBaseUrl: 'https://demodb.dev/ovdb', tables: [] },
      publicData: saved,
    };
    component = await createComponent({}, definition);
    expect(component.queryDef()?.publicData).toEqual(saved);
    expect(component.publicDataRevisionChanges()).toEqual(['directory']);
    expect(federatedRunMock).not.toHaveBeenCalled();
    component.runQuery();
    expect(component.runError()).toMatch(/revisions changed/);
    component.publicDataRevisionAcknowledged.set(true);
    component.runQuery();
    expect(component.runError()).toBe(SAVED_SCENARIO_PUBLICATION_BLOCKER);
    expect(federatedRunMock).not.toHaveBeenCalled();
  });

  it.each(['canonical', 'data-only', 'configuration-only'] as const)(
    'discloses proposed %s pins before changed-pin acknowledgement and separate storage copy without a data query',
    async (change) => {
      const native = await nativeFixture('ror', true);
      vi.stubGlobal('fetch', native.http);
      try {
        const metadata = new PublicDataService(),
          oldPins = await native.publish();
        const source = native.contract.source as Parameters<
          PublicDataService['discover']
        >[0];
        const discovery = await metadata.discoverDeclared(
          native.context,
          new AbortController().signal,
          oldPins,
        );
        const definition = metadata.scenario(
          source,
          discovery,
          discovery.suggestions[0],
          { userRows: 1000, userOffset: 0 },
          discovery.declaredSources?.[0],
        );
        const original = structuredClone(definition);
        const pins =
          change === 'canonical'
            ? await native.publish('b'.repeat(40))
            : oldPins;
        if (change !== 'canonical') {
          if (change === 'data-only') {
            const updated = await native.put(
              native.data,
              '[{"affiliation_id":"changed","ror_id":null}]',
            );
            Object.assign(native.context.catalog.sha256, {
              affiliations: updated.sha256,
            });
          }
          const configuration = await native.put(
            { ...native.context.configuration, revision: 'd'.repeat(40) },
            JSON.stringify(native.context.catalog),
          );
          Object.assign(native.context, { configuration });
        }
        const html = readFileSync(
          resolve(
            'libs/datatug/main/src/lib/queries/query/page/query-page.component.html',
          ),
          'utf8',
        );
        const template = html
          .split('<ion-content color="light">')[1]
          .split('  <ion-card>')[0];
        native.http.mockClear();
        component = await createComponent({}, definition, template);
        Object.assign(component.savedPlanReview, {
          configured: async () => native.context,
        });
        const injected = TestBed.inject(PublicDataService),
          revalidate = injected.revalidate.bind(injected);
        const checked = vi
          .spyOn(injected, 'revalidate')
          .mockImplementation((query, signal) =>
            revalidate(query, signal, pins, native.context),
          );
        const create = vi.fn((_project, query) => of(structuredClone(query)));
        Object.assign(TestBed.inject(QueriesService), { createQuery: create });
        runFixture.detectChanges();
        await runFixture.whenStable();
        expect(native.http).not.toHaveBeenCalled();
        expect(runFixture.nativeElement.textContent).toContain(
          'Saved source release v2.13',
        );
        const click = async (label: string) => {
          const buttons = Array.from(
            runFixture.nativeElement.querySelectorAll('ion-button'),
          ) as HTMLElement[];
          const button = buttons.find(
            (value) => value.textContent?.trim() === label,
          );
          expect(button).toBeDefined();
          button?.click();
          await runFixture.whenStable();
        };
        await click('Check current metadata');
        await checked.mock.results[0].value;
        await runFixture.whenStable();
        if (change === 'data-only') {
          const review = component.savedPlanReview.review();
          expect(review?.compatible).toBe(false);
          expect(review?.copy).toBeUndefined();
          expect(review?.observedDeclared?.data.sha256).not.toBe(
            original.publicData?.declaredSource?.data.sha256,
          );
          expect(runFixture.nativeElement.textContent).toContain(
            review?.observedDeclared?.data.sha256,
          );
          expect(runFixture.nativeElement.textContent).toContain(
            'new reviewed admission',
          );
          expect(create).not.toHaveBeenCalled();
          expect(component.queryDef()).toEqual(original);
          expect(federatedRunMock).not.toHaveBeenCalled();
          return;
        }
        expect(component.savedPlanReview.review()?.compatible).toBe(true);
        expect(runFixture.nativeElement.textContent).toContain(
          change === 'canonical'
            ? 'Changed pins: canonical directory'
            : 'Changed pins: configured source/schema/data/mapping',
        );
        const details = runFixture.nativeElement.querySelector(
          '[data-testid="checked-public-data-provenance"]',
        ) as HTMLDetailsElement;
        expect(details.open).toBe(false);
        details.querySelector('summary')?.click();
        await runFixture.whenStable();
        expect(details.open).toBe(true);
        const proposed = component.savedPlanReview.review()?.copy?.publicData;
        if (
          !proposed?.declaredSource ||
          !proposed.native ||
          !original.publicData?.declaredSource
        )
          throw new Error(
            'Missing proposed or original declared native source.',
          );
        const declared = proposed.declaredSource,
          originalData = original.publicData;
        for (const ref of [
          declared.configuration,
          declared.data,
          proposed.source.schema,
          proposed.attachment,
          proposed.model,
          proposed.meaning,
          proposed.snapshot,
          proposed.decision,
          proposed.native.dataset,
          proposed.native.provenance,
        ]) {
          for (const value of Object.values(ref))
            expect(details.textContent).toContain(value);
        }
        expect(details.textContent).toContain('Mapping ror_id → ror_id');
        expect(details.textContent).toContain('ROR:URL');
        expect(details.textContent).toContain('key affiliation_id');
        expect(details.textContent).toContain(
          'do not grant semantic admission or execution',
        );
        expect(declared.data.sha256).toBe(
          originalData.declaredSource?.data.sha256,
        );
        expect(component.savedPlanReview.acknowledged()).toBeUndefined();
        const save = Array.from(
          runFixture.nativeElement.querySelectorAll('ion-button'),
        ).find(
          (button) =>
            (button as HTMLElement).textContent?.trim() ===
            'Save separate pending plan',
        ) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        expect(create).not.toHaveBeenCalled();
        expect(federatedRunMock).not.toHaveBeenCalled();
        await click('Acknowledge this metadata check');
        await click('Save separate pending plan');
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0][1].publicData.eligible).toBe(false);
        expect(component.queryDef()).toEqual(original);
        component.resultPageIndex.set(1);
        component.runQuery();
        expect(component.resultPageIndex()).toBe(1);
        expect(federatedRunMock).not.toHaveBeenCalled();
        expect(runQueryMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('runs a federated query in the browser and exposes its download and lookup progress', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    const response: RunQueryResponse = {
      recordset: {
        columns: [{ name: 'country', type: 'string' }],
        rows: [[{ type: 'string', value: 'Alpha' }]],
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    };
    federatedRunMock.mockImplementation(
      (_definition: IQueryDef, onProgress: (progress: unknown) => void) => {
        onProgress({
          rowsLoaded: 103,
          rowsProcessed: 100,
          requestsCompleted: 2,
          requestsInFlight: 0,
          requestsPending: 0,
        });
        return Promise.resolve(response);
      },
    );
    component.runQuery();
    await Promise.resolve();
    expect(federatedRunMock).toHaveBeenCalledOnce();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.federatedProgress()).toEqual({
      rowsLoaded: 103,
      rowsProcessed: 100,
      requestsCompleted: 2,
      requestsInFlight: 0,
      requestsPending: 0,
    });
    expect(component.runResult()).toEqual(response);
  });

  it('defaults a flat left join to visible rows and lets the user switch to full result', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'detail-join',
      request: {
        queryType: QueryType.DTQL,
        text: JSON.stringify({
          from: {
            database: 'sales',
            name: 'Invoice',
            alias: 'i',
            joins: [
              {
                type: 'left',
                from: { database: 'geo', name: 'Country', alias: 'c' },
                on: [
                  {
                    left: { field: 'country_id', source: 'i' },
                    op: '==',
                    right: { field: 'id', source: 'c' },
                  },
                ],
              },
            ],
          },
          columns: [
            { field: 'id', source: 'i' },
            { field: 'name', source: 'c' },
          ],
        }),
      },
      federation: {
        ovdbBaseUrl: 'http://127.0.0.1:50501',
        tables: [
          { database: 'sales', name: 'Invoice', fields: ['id', 'country_id'] },
          { database: 'geo', name: 'Country', fields: ['id', 'name'] },
        ],
      },
    };
    component = await createComponent({}, definition);
    expect(component.federatedMode()).toBe('visible');
    expect(component.ovdbDestination()).toBe('http://127.0.0.1:50501');
    federatedRunMock.mockResolvedValue({
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
    });
    component.federatedMode.set('full');
    component.runQuery();
    expect(federatedRunMock).toHaveBeenCalledWith(
      definition,
      expect.any(Function),
      '',
      'full',
      expect.any(Function),
    );
  });

  it('shows only one result page at a time for a large federated recordset', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'many-sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    federatedRunMock.mockResolvedValue({
      recordset: {
        columns: [{ name: 'id', type: 'integer' }],
        rows: Array.from({ length: 205 }, (_, index) => [
          { type: 'integer', value: String(index + 1) },
        ]),
      },
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'many-sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    } satisfies RunQueryResponse);
    component.runQuery();
    await Promise.resolve();
    expect(component.visibleResultRows()).toHaveLength(100);
    expect(component.visibleResultRows()[0][0].value).toBe('1');
    component.resultPageIndex.set(2);
    expect(component.visibleResultRows()).toHaveLength(5);
    expect(component.visibleResultRows()[0][0].value).toBe('201');
    expect(component.resultPageEnd()).toBe(205);
    await vi.waitFor(() => expect(component.running()).toBe(false));
    component.runQuery();
    await Promise.resolve();
    expect(component.resultPageIndex()).toBe(0);
  });

  it('fetches a browser-worker result page without retaining all output rows', async () => {
    const definition: IQueryDef = {
      ...queryDef,
      id: 'paged-sales',
      request: { queryType: QueryType.DTQL, text: 'from: Invoice' },
      federation: { ovdbBaseUrl: 'http://127.0.0.1:50501', tables: [] },
      parameters: [],
    };
    component = await createComponent({}, definition);
    federatedRunMock.mockResolvedValue({
      recordset: {
        columns: [{ name: 'id', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      totalRows: 120_000,
      limitations: [],
      bindingsApplied: [],
      truncated: false,
      provenance: {
        source: 'direct OVDB',
        queryId: 'paged-sales',
        mode: 'live',
        observedAt: '2026-09-23T00:00:00Z',
        executionProfile: 'protected',
      },
    });
    federatedGetPageMock.mockResolvedValue([
      [{ type: 'integer', value: '101' }],
    ]);
    component.runQuery();
    await Promise.resolve();
    expect(component.resultTotalRows()).toBe(120_000);
    expect(component.visibleResultRows()).toHaveLength(1);
    await component.changeResultPage(1);
    expect(federatedGetPageMock).toHaveBeenCalledWith(1, 'affiliations', undefined);
    expect(component.visibleResultRows()).toEqual([
      [{ type: 'integer', value: '101' }],
    ]);
    expect(component.resultPageEnd()).toBe(200);
  });

  it('binds a parameter from context when no selection binding is present', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick(); // flush the component's own investigationContext.items()-reactive effect

    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '7' },
        origin: 'context',
      }),
    ]);
  });

  it('preserves an open query binding when an overlay fact is promoted until the user accepts rebinding', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
      role: 'suspected',
    });
    TestBed.tick();
    expect(component.effectiveBindings()).toEqual([]);

    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    expect(component.effectiveBindings()).toEqual([]);
    expect(component.rebindSuggestions()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        previous: expect.objectContaining({ parameterId: 'CustomerId' }),
        suggested: expect.objectContaining({
          value: { type: 'integer', value: '11' },
          origin: 'context',
        }),
      }),
    ]);

    component.acceptRebind('CustomerId');

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '11' },
      }),
    ]);
  });

  it('accepts one of two promotion rebinds without changing the other parameter', async () => {
    const twoParameterQuery: IQueryDef = {
      ...queryDef,
      parameters: [
        ...(queryDef.parameters ?? []),
        {
          id: 'ComparisonCustomerId',
          type: 'integer',
          meta: { entity: 'Customer', field: 'ID' },
        },
      ],
    };
    component = await createComponent({}, twoParameterQuery);
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    expect(
      component.rebindSuggestions().map((item) => item.parameterId),
    ).toEqual(['CustomerId', 'ComparisonCustomerId']);

    component.acceptRebind('CustomerId');

    expect(
      component.rebindSuggestions().map((item) => item.parameterId),
    ).toEqual(['ComparisonCustomerId']);
    expect(
      component.bindings().find((item) => item.parameterId === 'CustomerId'),
    ).toMatchObject({
      value: { type: 'integer', value: '11' },
      origin: 'context',
    });
    expect(
      component
        .bindings()
        .find((item) => item.parameterId === 'ComparisonCustomerId')?.value,
    ).toBeUndefined();
  });

  it('keeps the accepted binding when the user declines a promotion rebind', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();

    component.keepCurrentBinding('CustomerId');

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);

    investigationContext.addValue({
      entityField: { entity: 'Country', field: 'Name' },
      value: 'Ireland',
      label: 'Country.Name = Ireland',
      source: 'manual',
    });
    TestBed.tick();

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);
  });

  it('lets the user choose affected while keeping healthy control visible as another compare side', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Affected customer',
      source: 'manual',
      role: 'affected',
    });
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9,
      label: 'Healthy control',
      source: 'manual',
      role: 'healthy_control',
    });
    TestBed.tick();
    const unresolved = component.bindings()[0];
    expect(unresolved.blocked).toBe('ambiguous');
    const affected = unresolved.cohortOptions?.find(
      (option) => option.role === 'affected',
    );
    expect(affected).toBeDefined();
    if (!affected) {
      throw new Error('Expected an affected cohort choice');
    }

    component.chooseContextCohort('CustomerId', affected.factKey);

    const selected = component.bindings()[0];
    expect(selected).toMatchObject({ role: 'affected', origin: 'context' });
    expect(selected.cohortOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'healthy_control' }),
      ]),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(selected)).toBe(
      '7 · from context · affected',
    );
  });

  it('treats a direct user edit as the new accepted snapshot after promotion', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();
    expect(component.rebindSuggestions()).toHaveLength(1);

    component.editBinding('CustomerId', { type: 'integer', value: '23' });

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '23' },
        origin: 'user',
      }),
    ]);
  });

  it('resets promotion rebinding when the security context changes in the same project and environment', async () => {
    component = await createComponent({});
    const overlay = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 11,
      label: 'Customer.ID = 11',
      source: 'grid',
      layer: 'hypothesis:H17',
    });
    TestBed.tick();
    investigationContext.applyPromotion(
      overlay.id,
      'hypothesis:H17',
      'affected',
    );
    TestBed.tick();
    expect(component.rebindSuggestions()).toHaveLength(1);

    agentContext.securityContextId.set('sctx-2');
    TestBed.tick();

    expect(component.rebindSuggestions()).toEqual([]);
    expect(component.effectiveBindings()).toEqual([]);
  });

  it('selection (router state from the context panel, a wire Binding[]) is reported as origin "selection", not "context", when both agree', async () => {
    // A context fact that agrees with the selection value is NOT a conflict — the
    // resolver still reports the higher-precedence tier's origin (REQ:parameter-auto-
    // binding: "an explicit user edit wins; otherwise one compatible selected fact
    // wins; otherwise ... a context fact"), proving selection is checked BEFORE
    // context even when the outcome value happens to be identical either way.
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5, // agrees with the selection — not a conflict
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.effectiveBindings()).toEqual([
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
      }),
    ]);
    expect(component.hasBlockedBindings()).toBe(false);
  });

  it('AC:bound-from-selection literal wording — renders "5 · from selection"', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    const [selectionRendered] = component.visibleBindings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingFieldLabel(selectionRendered)).toBe(
      'Customer.ID',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(selectionRendered)).toBe(
      '5 · from selection',
    );
  });

  it('AC:context-carries literal wording — renders "7 · from context"', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
    const [contextRendered] = component.visibleBindings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((component as any).bindingValueLabel(contextRendered)).toBe(
      '7 · from context',
    );
  });

  it('clearBinding removes a binding from effectiveBindings without touching bindings() presence', async () => {
    component = await createComponent({ bindings: [selectionBinding] });

    component.clearBinding('CustomerId');

    expect(component.effectiveBindings()).toEqual([]);
    expect(component.bindings().length).toBe(1);
    expect(component.bindings()[0].blocked).toBeUndefined(); // optional param, not required
  });

  it('two distinct context facts for the same field are ambiguous and block Run', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9,
      label: 'Customer.ID = 9',
      source: 'related',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('ambiguous');
    expect(component.hasBlockedBindings()).toBe(true);
    expect(component.effectiveBindings()).toEqual([]);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toBeTruthy();
  });

  it('a selection value conflicting with a different context value blocks Run until confirmed (AC:typed-context-isolation)', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 9, // conflicts with selection's 5
      label: 'Customer.ID = 9',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('conflict-unconfirmed');
    expect(component.hasBlockedBindings()).toBe(true);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();

    component.confirmConflict('CustomerId');

    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
      }),
    );
    expect(component.hasBlockedBindings()).toBe(false);
  });

  it('typed distinctness: integer 5 vs string "5" from selection vs context is a conflict, never silently equal', async () => {
    component = await createComponent({ bindings: [selectionBinding] }); // selection = integer 5
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: '5', // string "5" — typed-distinct from integer 5
      label: 'Customer.ID = "5"',
      source: 'grid',
    });
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('conflict-unconfirmed');
  });

  it('runQuery sends the full ExecutionRequest (Scope + typed parameters + bindingOrigins) and stores the response', async () => {
    const response = {
      recordset: {
        columns: [{ name: 'InvoiceId', type: 'integer' }],
        rows: [[{ type: 'integer', value: '1' }]],
      },
      limitations: [],
      bindingsApplied: [
        {
          parameterId: 'CustomerId',
          value: { type: 'integer', value: '7' },
          origin: 'context',
          originEvidence: 'client-reported',
        },
      ],
      provenance: {
        source: 'chinook',
        mode: 'live',
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    component = await createComponent({});
    const contextItem = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
      role: 'affected',
    });
    TestBed.tick();
    runQueryMock.mockReturnValue(of(response));
    component.project = project;

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
      queryId: 'customer-invoices',
      source: undefined,
      parameters: { CustomerId: { type: 'integer', value: '7' } },
      bindingOrigins: [
        {
          parameterId: 'CustomerId',
          origin: 'context',
          factId: contextItem.id,
        },
      ],
      mode: 'live',
    });
    expect(component.runResult()).toEqual(response);
    expect(
      (
        component as unknown as {
          appliedBindingRole: (
            binding: (typeof response.bindingsApplied)[number],
          ) => string | undefined;
        }
      ).appliedBindingRole(response.bindingsApplied[0]),
    ).toBe('affected');
    expect(component.running()).toBe(false);
    expect(component.runError()).toBeUndefined();
  });

  it('runQuery does not include a cleared binding', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 7,
      label: 'Customer.ID = 7',
      source: 'grid',
    });
    TestBed.tick();
    runQueryMock.mockReturnValue(
      of({
        recordset: { columns: [], rows: [] },
        limitations: [],
        bindingsApplied: [],
        provenance: {
          source: 'chinook',
          mode: 'live',
          observedAt: '2026-09-09T12:00:00Z',
          executionProfile: 'protected',
        },
        truncated: false,
      }),
    );
    component.project = project;
    component.clearBinding('CustomerId');

    component.runQuery();

    expect(runQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: {}, bindingOrigins: [] }),
    );
  });

  it('does not run a selected value when an old candidate omitted its fact provenance', async () => {
    component = await createComponent({
      bindings: [{ ...selectionBinding, factId: undefined }],
    });
    component.project = project;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toContain('provenance');
  });

  it('runQuery reports the failure without hiding it', async () => {
    component = await createComponent({});
    runQueryMock.mockReturnValue(
      throwError(() => ({ message: 'ACCESS_DENIED' })),
    );
    component.project = project;

    component.runQuery();

    expect(component.runError()).toBe('ACCESS_DENIED');
    expect(component.running()).toBe(false);
    expect(component.runResult()).toBeUndefined();
  });

  it('receives multiple ACL blockers asynchronously and clears them on retry', async () => {
    component = await createComponent({});
    runFixture.detectChanges();
    await runFixture.whenStable();
    const pending = new Subject<never>();
    runQueryMock.mockReturnValue(pending);
    component.runQuery();
    pending.error(
      new HttpErrorResponse({
        status: 403,
        error: {
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
            requestId: 'r1',
          },
          details: {
            authorization: {
              apiVersion: 'dtql.org/authorization/v1',
              requestId: 'r1',
              mode: 'execution',
              scope: 'request',
              result: 'deny',
              allowed: false,
              hypothetical: false,
              operations: [],
              layers: [],
              restrictions: [],
              coverage: {
                evaluation: 'partial',
                disclosure: 'redacted',
                truncated: false,
                unevaluated: [],
              },
              blockers: [
                {
                  operationId: 'q',
                  code: 'COLUMN_READ_DENIED',
                  scope: 'column',
                  layerId: 'ingitdb',
                },
                {
                  operationId: 'q',
                  code: 'ACCESS_DENIED',
                  scope: 'operation',
                  layerId: 'openvaultdb',
                },
              ],
            },
          },
        },
      }),
    );
    await runFixture.whenStable();
    expect(runFixture.nativeElement.textContent).toContain(
      'ingitdb: COLUMN_READ_DENIED',
    );
    expect(runFixture.nativeElement.textContent).toContain(
      'openvaultdb: ACCESS_DENIED',
    );
    runQueryMock.mockReturnValue(new Subject<never>());
    component.runQuery();
    expect(component.accessBlockers()).toEqual([]);
  });

  it('runQuery does nothing without a project', async () => {
    component = await createComponent({});
    component.project = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('runQuery does nothing without an environment (envId unset)', async () => {
    component = await createComponent({});
    component.project = project;
    component.envId = undefined;

    component.runQuery();

    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('TARGET_REQUIRED populates availableTargets from the error, never a hidden source', async () => {
    component = await createComponent({});
    component.project = project;
    const targetRequired = new HttpErrorResponse({
      status: 400,
      error: {
        error: {
          code: 'TARGET_REQUIRED',
          message: 'choose a target',
          requestId: 'req-1',
          targets: [
            { source: 'chinook', label: 'Chinook (SQLite)' },
            { source: 'exchange-rates-http', label: 'Exchange rates (HTTP)' },
          ],
        },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => targetRequired));

    component.runQuery();

    expect(component.availableTargets()).toEqual([
      { source: 'chinook', label: 'Chinook (SQLite)' },
      { source: 'exchange-rates-http', label: 'Exchange rates (HTTP)' },
    ]);
    expect(component.running()).toBe(false);
  });

  it('SOURCE_UNAVAILABLE on a live run offers an explicit snapshot retry, never a silent fallback', async () => {
    component = await createComponent({});
    component.project = project;
    // LEAD ASSUMPTION 2026-09-10 (AvailableSnapshot's own doc comment,
    // @sneat/datatug-semantic) — the sibling "details.availableSnapshots" key a
    // SOURCE_UNAVAILABLE response for an HTTP query with a recorded fixture carries;
    // runSnapshot() reads the snapshotId from HERE, never fabricating one client-side.
    const sourceUnavailable = new HttpErrorResponse({
      status: 503,
      error: {
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'live request failed',
          requestId: 'req-2',
        },
        details: {
          availableSnapshots: [
            {
              snapshotId: 'exchange-rates-2026-09-01',
              recordedAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => sourceUnavailable));

    component.runQuery();

    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toEqual({
      snapshotId: 'exchange-rates-2026-09-01',
      recordedAt: '2026-09-01T00:00:00Z',
    });
    expect(runQueryMock).toHaveBeenCalledTimes(1);
    expect(runQueryMock.mock.calls[0][0]).toMatchObject({ mode: 'live' });

    const snapshotResponse = {
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'exchange-rates-http',
        mode: 'snapshot',
        snapshotId: 'exchange-rates-2026-09-01',
        observedAt: '2026-09-01T00:00:00Z',
        executionProfile: 'protected',
      },
      truncated: false,
    };
    runQueryMock.mockReturnValue(of(snapshotResponse));

    component.runSnapshot();

    expect(runQueryMock).toHaveBeenCalledTimes(2);
    expect(runQueryMock.mock.calls[1][0]).toMatchObject({
      mode: 'snapshot',
      snapshotId: 'exchange-rates-2026-09-01',
    });
    expect(component.sourceUnavailable()).toBe(false);
    expect(component.runResult()).toEqual(snapshotResponse);
  });

  it('runSnapshot() is a no-op when the server reported no recorded snapshot at all', async () => {
    component = await createComponent({});
    component.project = project;
    const sourceUnavailableNoFixture = new HttpErrorResponse({
      status: 503,
      error: {
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'live request failed',
          requestId: 'req-3',
        },
        // No "details" key at all — this query has no recorded fixture.
      },
    });
    runQueryMock.mockReturnValue(throwError(() => sourceUnavailableNoFixture));

    component.runQuery();

    expect(component.sourceUnavailable()).toBe(true);
    expect(component.availableSnapshot()).toBeUndefined();
    expect(runQueryMock).toHaveBeenCalledTimes(1);

    component.runSnapshot();

    // Never sends a mode:snapshot request with a fabricated/empty snapshotId.
    expect(runQueryMock).toHaveBeenCalledTimes(1);
  });

  it('a late run response for a scope the user has since left is discarded (Task 15 item 4)', async () => {
    component = await createComponent({});
    component.project = project;
    const response = {
      recordset: { columns: [], rows: [] },
      limitations: [],
      bindingsApplied: [],
      provenance: {
        source: 'chinook',
        mode: 'live' as const,
        observedAt: '2026-09-09T12:00:00Z',
        executionProfile: 'protected' as const,
      },
      truncated: false,
    };
    // Don't resolve synchronously — simulate an in-flight request.
    let resolveRun!: (value: typeof response) => void;
    runQueryMock.mockReturnValue(
      new Observable<typeof response>((subscriber) => {
        resolveRun = (value) => {
          subscriber.next(value);
          subscriber.complete();
        };
      }),
    );

    component.runQuery();
    // User switches principal/scope while the request is still in flight.
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-2',
    });
    resolveRun(response);

    expect(component.runResult()).toBeUndefined();
  });

  it('STALE_CONTEXT clears the Investigation Context and refreshes agent-info', async () => {
    component = await createComponent({});
    component.project = project;
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 1,
      label: 'Customer.ID = 1',
      source: 'grid',
    });
    expect(investigationContext.items()).toHaveLength(1);
    const staleContext = new HttpErrorResponse({
      status: 409,
      error: {
        error: { code: 'STALE_CONTEXT', message: 'stale', requestId: 'req-3' },
      },
    });
    runQueryMock.mockReturnValue(throwError(() => staleContext));

    component.runQuery();

    expect(investigationContext.items()).toHaveLength(0);
    expect(agentContext.refresh).toHaveBeenCalled();
    expect(component.runError()).toContain('session changed');
  });
});

/**
 * S96 — api-contract.md "Binding and context behavior": "The user can clear a value;
 * a cleared required value blocks Run until supplied." The demo project's real queries
 * (`customer-invoices`, `customer-purchases-by-genre`) declare `CustomerId` with
 * `isRequired: true` (datatug-demo-projects/demo-project-1/queries/customers/*.query.json)
 * — the describe block above never sets `required` on its own `queryDef` fixture (see
 * its own `clearBinding` test: "optional param, not required"), so it cannot see what
 * happens for the parameter shape the journey e2e (S89/S90/S92/S96) actually exercises.
 * `resolveBindings()`'s own `unresolved()` helper (binding-resolver.ts) already returns
 * `blocked: 'missing-required'` for a required parameter with no candidate value —
 * these tests lock that production behavior in at the component level, for both ways a
 * bound value can be emptied: this page's own "Clear this binding" button
 * ({@link QueryPageComponent.clearBinding}) and disabling the Investigation Context's
 * own chip ({@link InvestigationContextService.setEnabled}, REQ:context-basket — the
 * literal action AC:context-carries names: "disabling the chip empties it").
 */
describe('QueryPageComponent — clearing a required parameter blocks Run (S96)', () => {
  let component: QueryPageComponent;
  let runQueryMock: ReturnType<typeof vi.fn>;
  let investigationContext: InvestigationContextService;

  const project: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  };

  const requiredQueryDef: IQueryDef = {
    id: 'customer-purchases-by-genre',
    title: 'Customer purchases by genre',
    request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        isRequired: true,
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
  };

  const requiredEditorState: IQueryEditorState = {
    currentQueryId: requiredQueryDef.id,
    activeQueries: [
      {
        id: requiredQueryDef.id,
        queryType: QueryType.SQL,
        request: requiredQueryDef.request,
        def: requiredQueryDef,
      },
    ],
  } as unknown as IQueryEditorState;

  const selectionBinding = {
    parameterId: 'CustomerId',
    value: { type: 'integer' as const, value: '5' },
    origin: 'selection' as const,
    originEvidence: 'client-reported' as const,
    factId: 'selection-customer-5',
  };

  async function createComponent(
    historyState: Record<string, unknown> = {},
  ): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: historyState },
      writable: true,
      configurable: true,
    });
    runQueryMock = vi.fn();
    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(requiredEditorState),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: runQueryMock } },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    investigationContext = TestBed.inject(InvestigationContextService);
    const created =
      TestBed.createComponent(QueryPageComponent).componentInstance;
    created.project = project;
    created.envId = 'production';
    investigationContext.setScope({
      project: 'demo-project',
      environment: 'production',
      securityContextId: 'sctx-1',
    });
    return created;
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('clearing a required parameter bound from selection stays visible as missing-required and blocks Run', async () => {
    component = await createComponent({ bindings: [selectionBinding] });
    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({
        parameterId: 'CustomerId',
        value: { type: 'integer', value: '5' },
      }),
    );

    component.clearBinding('CustomerId');

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.visibleBindings()).toHaveLength(1); // still shown, never silently hidden
    expect(component.hasBlockedBindings()).toBe(true);
    expect(component.effectiveBindings()).toEqual([]);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
    expect(component.runError()).toBeTruthy();
  });

  it('clearing a required parameter bound from context stays visible as missing-required and blocks Run', async () => {
    component = await createComponent({});
    investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();
    expect(component.bindings()[0].origin).toBe('context');

    component.clearBinding('CustomerId');

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.hasBlockedBindings()).toBe(true);

    component.project = project;
    component.runQuery();
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('disabling the Investigation Context chip (not clearing the page-local binding) empties a required from-context binding the same way (AC:context-carries "disabling the chip empties it")', async () => {
    component = await createComponent({});
    const item = investigationContext.addValue({
      entityField: { entity: 'Customer', field: 'ID' },
      value: 5,
      label: 'Customer.ID = 5',
      source: 'grid',
    });
    TestBed.tick();
    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({
        parameterId: 'CustomerId',
        origin: 'context',
        value: { type: 'integer', value: '5' },
      }),
    );

    investigationContext.setEnabled(item.id, false);
    TestBed.tick();

    expect(component.bindings()[0].blocked).toBe('missing-required');
    expect(component.hasBlockedBindings()).toBe(true);

    // Re-enabling restores the binding without the user ever having clicked
    // "Clear this binding" on the page itself.
    investigationContext.setEnabled(item.id, true);
    TestBed.tick();

    expect(component.bindings()[0]).toEqual(
      expect.objectContaining({
        parameterId: 'CustomerId',
        origin: 'context',
        value: { type: 'integer', value: '5' },
      }),
    );
  });
});

/**
 * Regression (lane S92, journey J2/J3): `@sneat/random`'s `RandomIdService` is
 * `@Injectable()` with no `providedIn`, and nothing in this app ever imports
 * the package's own `RandomModule` or otherwise root-provides the service —
 * only its `RANDOM_ID_OPTIONS` injection token is provided, in
 * `apps/datatug-app/src/main.ts`. `QueryPageComponent` (and
 * `QueriesUiService`/`SqlQueryEditorComponent`) `inject(RandomIdService)` as
 * an eager field initializer, so the dependency is resolved unconditionally
 * at construction — confirmed live: navigating straight to `/query/:id` (the
 * context panel's "open a query" hand-off) threw `NG0201: No provider found
 * for \`RandomIdService\`. Source: Standalone[_QueryPageComponent]` before any
 * of this component's own binding-resolution logic ever ran, for every
 * query, new or existing. The two describes above cannot see this: they stub
 * `RandomIdService` directly. Here the component is left exactly as
 * production declares it (its own `imports:` are the only thing satisfying
 * `DatatugNavContextService`/`QueryContextSqlService`/`QueriesService`/
 * `QueryEditorStateService`/`Coordinator`), and `RandomIdService` +
 * `RANDOM_ID_OPTIONS` are provided the same way `apps/datatug-app/src/main.ts`
 * provides them app-wide (the actual fix) — not via this component's own
 * `imports:`, since that file is where the real app wires this up.
 */
describe('QueryPageComponent dependency injection', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: {} },
      writable: true,
      configurable: true,
    });
    TestBed.configureTestingModule({
      // Importing the standalone component brings its own `imports` into the
      // testing injector — nothing else here provides the datatug services.
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            url: '/',
          },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
        // ChangeDetectorRef is a real, per-view Angular construct that
        // `TestBed.runInInjectionContext(() => new X())` (below) cannot
        // resolve — there's no actual component view backing a raw `new`
        // call, unlike a genuine `TestBed.createComponent`. Confirmed this
        // is purely a test-methodology gap, not a production one: the real
        // browser reproduction (journey J2/J3) never raised this — only
        // RandomIdService, then AppContextService, then HttpExecutor, all
        // fixed above/below.
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
        // The actual fix under test: app-wide root providers
        // (apps/datatug-app/src/main.ts), not anything QueryPageComponent's
        // own `imports:` declares.
        RandomIdService,
        { provide: RANDOM_ID_OPTIONS, useValue: { len: 9 } },
      ],
    });
  });

  it('constructs from its own declared imports plus the app-level RandomIdService provider, the site that threw NG0201', () => {
    expect(() =>
      TestBed.runInInjectionContext(() => new QueryPageComponent()),
    ).not.toThrow();
  });

  it('throws NG0201 for RandomIdService when the app-level provider is missing (proves the test above is not a false positive)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
            url: '/',
          },
        },
        {
          provide: NavController,
          useValue: {
            navigateForward: vi.fn(() => Promise.resolve(true)),
            navigateRoot: vi.fn(),
          },
        },
        { provide: HttpClient, useValue: { get: vi.fn(() => of({})) } },
        { provide: Firestore, useValue: {} },
        // RandomIdService deliberately NOT provided here.
      ],
    });

    expect(() =>
      TestBed.runInInjectionContext(() => new QueryPageComponent()),
    ).toThrow(/RandomIdService/);
  });
});

/**
 * S155 — founder ruling 2026-09-10: "Query page does not show query text and
 * linked entities/collections", reproduced live against the founder's own
 * URL (`.../query/artists%2Fartists_with_albums?id=...&editor=text&env=local`,
 * the real GitHub-store demo project). Live reproduction (this task) found
 * the data was ALREADY correct — `queryState.request.text`/`.def` load fine
 * (see `github-project-reader.service.spec.ts`'s own `getQuery` coverage,
 * unchanged by this task) — the query page template itself just never
 * rendered any of it: no body editor at all for SQL/DTQL (the old
 * `sneat-datatug-sql-query` binding, `query-page.component.html`, was
 * commented out and never replaced — confirmed by the pre-existing S136
 * comment on `apps/datatug-app/e2e/github-store.spec.ts`'s own
 * `getQueryBodyText()` helper) and no "linked entities" section anywhere.
 * `queryBodyText`/`linkedEntities` (new signals, `query-page.component.ts`)
 * are what the template now reads — these tests assert them directly, the
 * same way every other describe block in this file asserts component
 * signals rather than rendered DOM (this file overrides the template to
 * `''` throughout — real DOM rendering is covered instead by
 * `github-store.spec.ts`'s own Playwright case for this exact query).
 * `extractLinkedEntityNames()` has its own dedicated, TestBed-free tests
 * below this describe block.
 */
describe('QueryPageComponent — query text and linked entities display (S155)', () => {
  let component: QueryPageComponent;
  let fixture: ComponentFixture<QueryPageComponent>;

  const project: IProjectContext = {
    ref: {
      storeId: 'github.com',
      projectId: 'datatug-demo-projects@datatug@demo-project-1',
    },
  };

  // The real `artists/artists_with_albums.sql`/`.sql.json` shape
  // (datatug/datatug-demo-projects, demo-project-1/queries/artists/) — the
  // founder's own reproduction query. Its `.sql.json` file is just
  // `{"title": "Artists with albums"}` (confirmed live against the real
  // repo) — no `parameters`/`recordsets` at all, exactly the case
  // `extractLinkedEntityNames()`'s SQL-text fallback exists for.
  const legacySqlText =
    'SELECT ar.*, (SELECT COUNT(1) FROM Album al WHERE al.ArtistId = ar.ArtistID) as AlbumsCount FROM Artist as ar ORDER BY (SELECT COUNT(1) FROM Album al WHERE al.ArtistId = ar.ArtistID) DESC';
  const legacySqlDef: IQueryDef = {
    id: 'artists/artists_with_albums',
    title: 'Artists with albums',
    request: {
      queryType: QueryType.SQL,
      text: legacySqlText,
    } as ISqlQueryRequest,
  };

  // The real `customers/customer-invoices.query.json`/`.query.dtql` shape —
  // a DTQL query whose parameters/recordsets already carry `meta.entity`
  // (confirmed live against the real repo), the metadata path.
  const dtqlDef: IQueryDef = {
    id: 'customers/customer-invoices',
    title: 'Customer invoices',
    request: {
      queryType: QueryType.DTQL,
      text: 'from:\n  name: Invoice\n',
    } as unknown as ITextQueryRequest,
    parameters: [
      {
        id: 'CustomerId',
        type: 'integer',
        isRequired: true,
        meta: { entity: 'Customer', field: 'ID' },
      },
    ],
    recordsets: [
      {
        name: 'result',
        columns: [
          {
            name: 'InvoiceId',
            type: 'integer',
            meta: { entity: 'Invoice', field: 'ID' },
          },
          {
            name: 'Total',
            type: 'number',
            meta: { entity: 'Invoice', field: 'Total' },
          },
        ],
      },
    ],
  };

  async function createComponent(def: IQueryDef, template = ''): Promise<QueryPageComponent> {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: {} },
      writable: true,
      configurable: true,
    });
    const editorState: IQueryEditorState = {
      currentQueryId: def.id,
      activeQueries: [
        {
          id: def.id,
          queryType: def.request.queryType,
          request: def.request,
          def,
        },
      ],
    } as unknown as IQueryEditorState;
    const editor = new BehaviorSubject(editorState);

    await TestBed.configureTestingModule({
      imports: [QueryPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: editor,
            updateQueryState: vi.fn((state: IQueryState) => editor.next({
              ...editor.value,
              activeQueries: editor.value.activeQueries.map((query) =>
                query.id === state.id ? state : query,
              ),
            })),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        { provide: SemanticApiService, useValue: { runQuery: vi.fn() } },
        { provide: AgentContextService, useValue: agentContextStub() },
      ],
    })
      .overrideComponent(QueryPageComponent, {
        set: {
          imports: [],
          template,
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueryPageComponent);
    return fixture.componentInstance;
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('a direct-URL-loaded legacy SQL query (no parameters/recordsets metadata) exposes its own text and, from a FROM/JOIN scan, the tables it references', async () => {
    component = await createComponent(legacySqlDef);

    expect(component.queryBodyText()).toBe(legacySqlText);
    expect(component.linkedEntities()).toEqual(['Album', 'Artist']);
  });

  it('a DTQL query with parameter/recordset meta.entity exposes those entities, not a text-parsed guess', async () => {
    component = await createComponent(dtqlDef);

    expect(component.queryBodyText()).toBe('from:\n  name: Invoice\n');
    expect(component.linkedEntities()).toEqual(['Customer', 'Invoice']);
  });

  it('an HTTP query has no body text (queryBodyText is only for a text-shaped request)', async () => {
    const httpDef: IQueryDef = {
      id: 'reference/country-facts',
      title: 'Country facts',
      request: {
        queryType: QueryType.HTTP,
        url: 'https://example.test',
        method: 'GET',
      },
    };
    component = await createComponent(httpDef);

    expect(component.queryBodyText()).toBeUndefined();
  });

  it('keeps an empty text editor mounted while the user types, clears, and types again', async () => {
    const blankSql: IQueryDef = {
      id: 'new-query',
      title: 'New query',
      request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
    };
    component = await createComponent(
      blankSql,
      '@if (queryBodyText() !== undefined) {<ion-textarea data-testid="query-body-text" [value]="queryBodyText()" (ionInput)="queryTextChanged($event)"></ion-textarea>}',
    );
    fixture.detectChanges();
    const getEditor = () => fixture.nativeElement.querySelector(
      '[data-testid="query-body-text"]',
    ) as HTMLElement | null;
    expect(getEditor()).not.toBeNull();

    const edit = async (value: string) => {
      const editor = getEditor();
      expect(editor).not.toBeNull();
      editor?.dispatchEvent(new CustomEvent('ionInput', {
        detail: { value }, bubbles: true,
      }));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await edit('select 1');
    expect(component.queryBodyText()).toBe('select 1');
    expect(getEditor()).not.toBeNull();
    await edit('');
    expect(component.queryBodyText()).toBe('');
    expect(getEditor()).not.toBeNull();
    await edit('select 2');
    expect(component.queryBodyText()).toBe('select 2');
    expect(getEditor()).not.toBeNull();
  });
});

/**
 * `extractLinkedEntityNames()` (query-page.component.ts) in isolation — no
 * TestBed needed, a pure function. See its own doc comment for why the SQL
 * fallback exists and when it does/doesn't apply.
 */
describe('extractLinkedEntityNames', () => {
  it('returns nothing for an undefined definition', () => {
    expect(extractLinkedEntityNames(undefined)).toEqual([]);
  });

  it('prefers parameter/recordset meta.entity, deduplicated and sorted, over any text scan', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT 1 FROM Ignored',
      } as ISqlQueryRequest,
      parameters: [
        {
          id: 'p1',
          type: 'integer',
          meta: { entity: 'Customer', field: 'ID' },
        },
      ],
      recordsets: [
        {
          name: 'r',
          columns: [
            {
              name: 'c1',
              type: 'integer',
              meta: { entity: 'Invoice', field: 'ID' },
            },
            {
              name: 'c2',
              type: 'integer',
              meta: { entity: 'Customer', field: 'ID' },
            }, // dup
          ],
        },
      ],
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Customer', 'Invoice']);
  });

  it('falls back to a FROM/JOIN scan of the SQL text when there is no metadata at all (the legacy .sql.json shape)', () => {
    const def: IQueryDef = {
      id: 'artists_with_albums',
      title: 'Artists with albums',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT ar.* FROM Artist as ar INNER JOIN Album al ON al.ArtistId = ar.ArtistID',
      } as ISqlQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Album', 'Artist']);
  });

  it('the SQL-text fallback also handles a schema-qualified table name', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.SQL,
        text: 'SELECT * FROM dbo.Artist',
      } as ISqlQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual(['Artist']);
  });

  it('never SQL-parses a DTQL body (its text is YAML, not SQL) — no metadata means no entities', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.DTQL,
        text: 'from:\n  name: Invoice\n',
      } as unknown as ITextQueryRequest,
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });

  it('returns nothing for an HTTP query with no metadata', () => {
    const def: IQueryDef = {
      id: 'q',
      title: 'q',
      request: {
        queryType: QueryType.HTTP,
        url: 'https://example.test',
        method: 'GET',
      },
    };

    expect(extractLinkedEntityNames(def)).toEqual([]);
  });
});

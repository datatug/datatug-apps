import { savedMeaningChoices, type SavedMeaningChoice } from '../../semantic-meaning-reuse';
import { SemanticColumnHeaderComponent } from '../../semantic-column-header.component';
import { SemanticMappingDialogComponent } from '../../semantic-mapping-dialog.component';
import { validateSemanticModel, createSemanticModel, semanticQueryHash, sameSemanticBasis, type SemanticModel } from '../../semantic-mapping';
import { isDevicePersonalQuery } from '../../device-personal-queries';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { readGithubProjectId } from '@datatug/project-address';
import { SourceRightsNoticeComponent } from '@sneat/datatug-semantic';
import {
  formatTugQL,
  parseTugQL,
  type TugQLDiagnostic,
  type TugQLFormatOptions,
} from '@dalgo/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { PublicDataService } from '../../public-data/public-data.service';
import { ConfiguredPublicDataSourcesService } from '../../public-data/configured-public-data-sources.service';
import { SavedPlanReview } from '../../public-data/saved-plan-review';
import { INITIAL_CANONICAL_PINS } from '../../public-data/canonical-metadata';
import { monotonicTime } from '../../public-data/bounded-run-budget';
import {
  scenarioRevisionChanges,
  SAVED_SCENARIO_PUBLICATION_BLOCKER,
} from '../../public-data/public-data-scenario';
import {
  afterNextRender,
  ElementRef,
  Injector,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, NavigationEnd } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { addIcons } from 'ionicons';
import { copyOutline } from 'ionicons/icons';
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellFocusedEvent,
  type GridApi,
  type RowClickedEvent,
  type RowClassRules,
  type ICellRendererParams,
  type SelectionChangedEvent,
  type SuppressKeyboardEventParams,
} from 'ag-grid-community';
import {
  ErrorLogger,
  IErrorLogger,
  STORE_ID_GITHUB_COM,
  STORE_TYPE_GITHUB,
} from '@sneat/core';

const isGithubStoreId = (storeId?: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

const isBrowserSqlProject = (ref?: IProjectRef): boolean =>
  !!ref && (isGithubStoreId(ref.storeId) || isSharedProjectRef(ref));

const hasQueryActivity = (ref?: IProjectRef): boolean =>
  !!ref &&
  ((isGithubStoreId(ref.storeId) && ref.projectApi === 'cloud') ||
    isSharedProjectRef(ref));

ModuleRegistry.registerModules([AllCommunityModule]);

interface QueryResultGridRow {
  readonly [columnId: string]: string;
}

interface QueryResultGridRowSnapshot {
  readonly result: FederatedQueryResult;
  readonly recordset: FederatedQueryResult['recordset'];
  readonly rows: FederatedQueryResult['recordset']['rows'];
  readonly row: FederatedQueryResult['recordset']['rows'][number];
  readonly resultSetId: string;
  readonly resultPageIndex: number;
  readonly resultGeneration: number;
  readonly position: number;
}

const CUSTOMER_INVOICE_LOOKUP_QUERY_ID = 'chinook-invoice-author';

// displayTypedValue converts integer strings through Number(), which can round wide values.
const displayQueryResultValue = (value: TypedValue): string =>
  value.type === 'integer' ? value.value : displayTypedValue(value);

const cloneAndFreeze = <T>(value: T): T => {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
};

const sha256Text = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Shown instead of ever calling `SemanticApiService.runQuery()` for a
 * GitHub-store project — there is no CLI agent to execute against (founder
 * ruling 2026-09-11, deliverable 2: "an explicit, friendly notice with the
 * command to run, not a thrown error"). */
export const GITHUB_QUERY_RUN_MESSAGE =
  'This project is browsed read-only from GitHub — running a query needs a DataTug agent. Clone the repo and run `datatug serve --project <path>` to execute it.';
export const SHARED_QUERY_RUN_MESSAGE =
  'Choose the pinned public SQLite source to run a SQL query in this browser.';

interface QueryRunTiming {
  readonly firstRecordMs?: number;
  readonly allResultsLoadedMs: number;
  readonly noRecords: boolean;
}

interface PendingAuthorLookupNavigation {
  readonly targetId: string;
  readonly requestRevision: number;
  readonly projectRef: IProjectRef;
  readonly environment?: string;
  readonly securityContextId?: string;
  routeObserved: boolean;
  navigationSucceeded?: boolean;
  observedNavigationId?: number;
  routeSuperseded: boolean;
}

interface CommittedQueryDefinition {
  readonly request: {
    readonly queryType: QueryType;
    readonly text?: string;
    readonly method?: string;
  };
  readonly nativeGraph?: NonNullable<IQueryDef['federation']>['nativeGraph'];
}

type CommittedQueryResult = Omit<FederatedQueryResult, 'bindingsApplied'> & {
  readonly bindingsApplied: readonly {
    readonly parameterId: string;
    readonly type: TypedValue['type'];
    readonly set: true;
    readonly origin: Binding['origin'];
    readonly originEvidence: Binding['originEvidence'];
    readonly factId?: string;
  }[];
};

/** Retained receipts record binding metadata without copying runtime values. */
const snapshotCommittedResult = (
  result: FederatedQueryResult,
): CommittedQueryResult =>
  cloneAndFreeze({
    ...result,
    bindingsApplied: result.bindingsApplied.map((binding) => ({
      parameterId: binding.parameterId,
      type: binding.value.type,
      set: true as const,
      origin: binding.origin,
      originEvidence: binding.originEvidence,
      ...(binding.factId ? { factId: binding.factId } : {}),
    })),
  });

interface CommittedQueryRun {
  readonly result: CommittedQueryResult;
  readonly displayedResultGeneration: number;
  readonly executedDefinition: CommittedQueryDefinition;
  readonly queryIdentity: symbol;
  readonly scope: {
    readonly storeId?: string;
    readonly projectId?: string;
    readonly queryId?: string;
    readonly securityContextId?: string;
    readonly environment?: string;
    readonly target: string;
  };
  readonly targetIdentity: string;
  readonly timing?: QueryRunTiming;
  readonly provenance: FederatedQueryResult['provenance'];
}

interface AuthorFormatUndo {
  readonly action?: 'format' | 'filter';
  readonly originalSource: string;
  readonly formattedSource: string;
  readonly scopeKey: string;
  readonly queryIdentity: symbol;
}

interface AuthorRelationshipUndo {
  readonly action: 'join' | 'remove';
  readonly originalSource: string;
  readonly joinedSource: string;
  readonly scopeKey: string;
  readonly queryIdentity: symbol;
  readonly originalRelationshipBindings?: IQueryDef['relationshipBindings'];
}

interface AuthorFormatDiagnosticSnapshot {
  readonly definition: IQueryDef;
  readonly source: string;
  readonly draftRevision: number;
  readonly scopeKey: string;
  readonly queryIdentity: symbol;
  readonly diagnostics: readonly TugQLDiagnostic[];
  readonly remainingCount: number;
}

interface AuthorPreviewDiagnosticSnapshot {
  readonly definition: IQueryDef;
  readonly source: string;
  readonly draftRevision: number;
  readonly scopeKey: string;
  readonly queryIdentity: symbol;
  readonly queryId?: string;
  readonly historyScope: string;
  readonly lifetime: number;
  readonly errorRevision: number;
  readonly diagnostic: TugQLDiagnostic;
}

const isNoTargetFormatDiagnostic = (diagnostic: TugQLDiagnostic): boolean =>
  (diagnostic.code === 'input_too_large' || diagnostic.code === 'expected_from') &&
  diagnostic.span.start.line === 1 &&
  diagnostic.span.start.column === 1 &&
  diagnostic.span.end.line === 1 &&
  diagnostic.span.end.column === 1;
import { RandomIdService } from '@sneat/random';
import { distinctUntilChanged, takeUntil, filter, take } from 'rxjs/operators';
import { firstValueFrom, Subject } from 'rxjs';
import {
  IonAccordion,
  IonAccordionGroup,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonMenuButton,
  IonModal,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ViewDidEnter,
} from '@ionic/angular';
import {
  AgentContextService,
  AvailableSnapshot,
  Binding,
  BindingParameterRef,
  CandidateTarget,
  displayTypedValue,
  ExecutionBindingOrigin,
  Fact,
  hasBlockingBindings,
  InvestigationContextService,
  isBindingRunnable,
  isFactSelectedForBinding,
  LimitationHeaderComponent,
  ResolvedBinding,
  resolveBindings,
  scopeKey,
  RunQueryRequest,
  RunQueryResponse,
  SemanticApiService,
  tryDecodeErrorEnvelope,
  TypedValue,
} from '@sneat/datatug-semantic';
import { IProjectRef, equalProjectRef, isSharedProjectRef } from '../../../core/project-context';
import { fromProjectQueryWire } from '../../project-query-contract';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import {
  IQueryEditorState,
  IQueryEnvState,
  IQueryState,
  AuthorBindingProvenance,
} from '../../../editor/models';
import { Coordinator } from '../../../executor/coordinator';
import {
  IEnvDbServer,
  IEnvironmentSummary,
} from '../../../models/definition/environments';
import { IParameter } from '../../../models/definition/parameter';
import {
  IQueryDef,
  ISqlQueryRequest,
  ITextQueryRequest,
  QueryType,
} from '../../../models/definition/query-def';
import {
  IProjectContext,
  newProjectContextFromRef,
} from '../../../nav/nav-models';
import { projectPageHref } from '../../../nav/project-page-href';
import { ProjectTracker } from '../../../services/nav/contexts/project.tracker';
import { GitHubProjectActivityService } from '../../../services/project/github-project-activity.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { DatatugExecutorModule } from '../../../executor/datatug-executor.module';
import { DatatugQueriesServicesModule } from '../../datatug-queries-services.module';
import { QueriesService } from '../../queries.service';
import {
  HOSTED_DEMO_DB_SOURCES,
  hostedDemoDbSourceId,
  isHostedDemoDbStarterQuery,
  withHostedDemoDbSource,
} from '../../hosted-demo-db-query';
import {
  FederatedQueryService,
  type FederatedQueryProgress,
  type FederatedQueryResult,
} from '../../federated-query.service';
import { federatedVisibleMode } from '../../federated-query-executor';
import type {
  LocalResultDescriptor,
  LocalResultRef,
} from '../../federated-local-results';
import { graphStableIdentity } from '../../public-data/native-graph-executor';
import { QueryContextSqlService } from '../../query-context-sql.service';
import {
  PublicSqliteQueryService,
  type PublicSqliteSourceDiscovery,
} from '../../public-sqlite-query.service';
import type { PublicSqlitePreparedPlan } from '../../public-sqlite-tugql';
import { PUBLIC_SQLITE_COMPARE_WASM_PIN } from '../../public-sqlite-comparison-pin.token';
import {
  PublicSqliteComparisonSession,
  PUBLIC_CHINOOK_COMPARISON_TARGETS,
  isSupportedPublicSqliteComparisonProjection,
  compareSessionObservations,
  type ComparisonContextSnapshot,
  type ComparisonFixtureTarget,
  type ComparisonSessionSnapshot,
  type ComparisonSideToken,
  type SessionCompareResult,
} from '../../public-sqlite-comparison';
import { PublicSqliteComparisonPanelComponent } from './public-sqlite-comparison-panel.component';
import {
  reviewAuthorRelationshipSource,
  type AuthorCustomerField,
  type AuthorRelationshipSourceReview,
} from './author-relationship-source-edit';
import {
  inspectAuthorParticipatingSources,
  removeAuthorCustomerJoin,
} from './author-participating-sources';
import { AuthorSqlPreviewComponent } from './author-sql-preview.component';
import {
  AuthorCodeEditorComponent,
  createSourceSpanValidator,
  sourceSpanIsValid,
} from './author-code-editor.component';
import { AuthorComposeControlsComponent } from './author-compose-controls.component';
import { AuthorRelationshipSourcesComponent } from './author-relationship-sources.component';
import { AuthorParticipatingSourcesComponent } from './author-participating-sources.component';
import { AuthorCurrentRowComponent } from './author-current-row.component';
import { useInvoiceIdAsAuthorFilter } from './author-row-filter-edit';
import { readAuthorComposeProfile } from './author-compose-profile';
import {
  customerIdLookupValue,
  hasVerifiedCustomerIdLineage,
} from './author-customer-lookup';
import { QueryWorkspaceLayoutComponent } from './query-workspace-layout.component';
import { SqlEditorComponent } from '../../../components/sqleditor/sql-editor.component';
import type {
  PublicSqliteExecutionReceipt,
  PublicSqliteQueryPreview,
} from '../../public-sqlite-tugql';
import {
  isQueryChanged,
  QueryEditorStateService,
} from '../../query-editor-state-service';
import { HttpQueryEditorComponent } from '../http-query/http-query-editor.component';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

/** The exact pair of disagreeing values a confirmed conflict was confirmed for — see
 * `confirmConflict()`'s own comment on why a confirmation is invalidated (not silently
 * reused) if the underlying facts change to a *different* conflicting pair. */
interface ConfirmedConflict {
  readonly selectionValue: TypedValue;
  readonly contextValue: TypedValue;
}

function rebindFingerprint(
  previous: ResolvedBinding | undefined,
  suggested: ResolvedBinding,
): string {
  return JSON.stringify({ previous, suggested });
}

interface RebindSuggestion {
  readonly parameterId: string;
  readonly previous?: ResolvedBinding;
  readonly suggested: ResolvedBinding;
}

function typedValuesEqual(a: TypedValue, b: TypedValue): boolean {
  return a.type === b.type && a.value === b.value;
}

const githubQueryEditReportMinIntervalMs = 1_100;

/** Writes `next` into `sig` only if it differs from the current value per `equal` —
 * see `updateBindings()`'s own comment on why an unconditional `.set()` inside an
 * `effect()` is unsafe here. */
function setIfChanged<T>(
  sig: { (): T; set: (value: T) => void },
  next: T,
  equal: (a: T, b: T) => boolean,
): void {
  if (!equal(sig(), next)) {
    sig.set(next);
  }
}

function resolvedBindingEqual(a: ResolvedBinding, b: ResolvedBinding): boolean {
  if (
    a.parameterId !== b.parameterId ||
    a.origin !== b.origin ||
    a.factId !== b.factId ||
    a.role !== b.role ||
    a.blocked !== b.blocked ||
    a.meta?.entity !== b.meta?.entity ||
    a.meta?.field !== b.meta?.field
  ) {
    return false;
  }
  if ((a.value === undefined) !== (b.value === undefined)) {
    return false;
  }
  if (a.value && b.value && !typedValuesEqual(a.value, b.value)) {
    return false;
  }
  const aAmb = a.ambiguousValues ?? [];
  const bAmb = b.ambiguousValues ?? [];
  if (
    aAmb.length !== bAmb.length ||
    aAmb.some((v, i) => !typedValuesEqual(v, bAmb[i]))
  ) {
    return false;
  }
  if ((a.conflict === undefined) !== (b.conflict === undefined)) {
    return false;
  }
  if (
    a.conflict &&
    b.conflict &&
    (!typedValuesEqual(a.conflict.selectionValue, b.conflict.selectionValue) ||
      !typedValuesEqual(a.conflict.contextValue, b.conflict.contextValue))
  ) {
    return false;
  }
  if (
    JSON.stringify(a.cohortOptions ?? []) !==
    JSON.stringify(b.cohortOptions ?? [])
  ) {
    return false;
  }
  return true;
}

function bindingsEqual(
  a: readonly ResolvedBinding[],
  b: readonly ResolvedBinding[],
): boolean {
  return (
    a.length === b.length &&
    a.every((binding, i) => resolvedBindingEqual(binding, b[i]))
  );
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}

function mapsEqual<K, V>(
  a: ReadonlyMap<K, V>,
  b: ReadonlyMap<K, V>,
  valueEqual: (x: V, y: V) => boolean = (x, y) => x === y,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (!b.has(key) || !valueEqual(value, b.get(key) as V)) {
      return false;
    }
  }
  return true;
}

/** Naive `FROM`/`JOIN` table-name scan — deliberately NOT `SqlParser`
 * (`services/unsorted/sql-parser.ts`): that parser's own `reFrom` regex
 * requires a schema-qualified `schema.table` reference (mandatory `(\w+)\.`
 * before the table name), so an unqualified `FROM Artist` — exactly what
 * demo-project-1's own `artists_with_albums.sql` writes — never matches it
 * at all (confirmed by reading that regex; out of scope to change here, it
 * backs `QueryContextSqlService`'s live-catalog join-suggestion feature
 * elsewhere). This scan is display-only (used by
 * {@link extractLinkedEntityNames}'s own fallback below) and intentionally
 * schema-optional. */
const FROM_JOIN_TABLE_RE =
  /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/gi;

/** Distinct entity/collection names a query definition references — the
 * "linked entities/collections" the founder's ruling (S155, 2026-09-10)
 * says the query page must show. Primary source: `parameters[].meta.entity`
 * and `recordsets[].columns[].meta.entity` (`IEntityFieldRef`) — every
 * typed/DTQL query in demo-project-1 (e.g. `customer-invoices`) carries
 * this directly on its `.query.json` definition file, no parsing needed.
 * Falls back to a naive FROM/JOIN table-name scan of the query's own SQL
 * text ({@link FROM_JOIN_TABLE_RE}) only when NO metadata entity was found
 * at all — the legacy `<id>.sql.json` shape (e.g. `artists_with_albums`)
 * carries no `parameters`/`recordsets` whatsoever (confirmed against the
 * real demo file: `{"title": "Artists with albums"}`, nothing else), so
 * without this fallback that query would show no linked entities at all
 * despite its SQL text plainly naming `Artist`/`Album`. Never applied to a
 * non-SQL request (DTQL's own body is YAML, not SQL — parsing it as SQL
 * would be meaningless; every DTQL query in this demo already has metadata
 * anyway) or when metadata already yielded at least one name (metadata is
 * the more precise source, never silently supplemented by a text guess). */
export function extractLinkedEntityNames(
  def: IQueryDef | undefined,
): readonly string[] {
  if (!def) {
    return [];
  }
  const names = new Set<string>();
  def.parameters?.forEach((p) => {
    if (p.meta?.entity) {
      names.add(p.meta.entity);
    }
  });
  def.recordsets?.forEach((rs) => {
    rs.columns?.forEach((c) => {
      if (c.meta?.entity) {
        names.add(c.meta.entity);
      }
    });
  });
  if (names.size === 0 && def.request?.queryType === QueryType.SQL) {
    const text = (def.request as ISqlQueryRequest).text;
    if (text) {
      FROM_JOIN_TABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FROM_JOIN_TABLE_RE.exec(text))) {
        names.add(m[2] || m[1]);
      }
    }
  }
  return [...names].sort();
}

@Component({
  selector: 'sneat-datatug-sql-editor',
  templateUrl: './query-page.component.html',
  styleUrl: './query-page.component.scss',
  imports: [
    SemanticMappingDialogComponent,
    AuthorComposeControlsComponent,
    AuthorSqlPreviewComponent,
    AuthorCodeEditorComponent,
    AuthorRelationshipSourcesComponent,
    AuthorParticipatingSourcesComponent,
    AuthorCurrentRowComponent,
    PublicSqliteComparisonPanelComponent,
    QueryWorkspaceLayoutComponent,
    SqlEditorComponent,
    NgTemplateOutlet,
    // DatatugNavContextService and EnvironmentService are now
    // providedIn: 'root' (nav-context-root-singletons); QueriesService,
    // QueryContextSqlService, QueryEditorStateService and Coordinator
    // (all injected below too) are still plain @Injectable(), provided by
    // these modules. `query/:queryId` is a sibling
    // of the bare '' route (routes/datatug-routing-proj.ts), not a child of
    // ProjectPageComponent, so this page never inherited them — the same
    // NG0201 class `EnvDbTablePageComponent` and `DatatugStorePageComponent`
    // were already fixed for. Lane S79's static sweep added the four
    // DatatugServices*Module below, but never caught that
    // DatatugNavContextService's OWN constructor also needs AppContextService
    // (DatatugCoreModule, not any of the four) — a static sweep can't see a
    // transitive DI gap like that; only actually constructing the component
    // does. Confirmed live: even with DatatugUserService fixed
    // (providedIn: 'root', lane S79) and the four modules below present, a
    // real navigation to `/query/:id` (the context panel's "open a query"
    // hand-off) still threw `NG0201: No provider found for
    // \`AppContextService\`. Source: Standalone[_QueryPageComponent]`, one
    // level deeper than the RandomIdService gap this same stream also fixed
    // (main.ts) — found only once RandomIdService stopped masking it
    // (lane S92, journey J2/J3).
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesUnsortedModule,
    DatatugQueriesServicesModule,
    DatatugExecutorModule,
    FormsModule,
    AgGridAngular,
    HttpQueryEditorComponent,
    SneatDatatugPageTitleComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonModal,
    IonAccordion,
    IonAccordionGroup,
    IonBackButton,
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonChip,
    IonCardContent,
    IonItem,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSegment,
    IonSegmentButton,
    IonIcon,
    IonLabel,
    IonList,
    IonListHeader,
    IonBadge,
    IonNote,
    IonSpinner,
    IonText,
    IonTextarea,
    SourceRightsNoticeComponent,
    LimitationHeaderComponent,
  ],
})
export class QueryPageComponent implements OnDestroy, ViewDidEnter {
  public readonly sqlQueryType = QueryType.SQL;

  private readonly injector = inject(Injector);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly randomIdService = inject(RandomIdService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly githubProjectActivity = inject(GitHubProjectActivityService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryContextSqlService = inject(QueryContextSqlService);
  private readonly queriesService = inject(QueriesService);
  private readonly federatedQuery = inject(FederatedQueryService);
  private readonly publicSqliteQuery = inject(PublicSqliteQueryService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly coordinator = inject(Coordinator);
  private readonly queryEditorStateService = inject(QueryEditorStateService);
  private readonly envService = inject(EnvironmentService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private authorRunAbort?: AbortController;
  private readonly comparisonSession = new PublicSqliteComparisonSession();
  private comparisonPreparedPlan?: PublicSqlitePreparedPlan;
  private comparisonAccessGeneration = 0;
  private comparisonAbort?: AbortController;
  private comparisonGeneration = 0;
  private comparisonObservedScopeIdentity?: string;
  private comparisonRouteProjectRef?: IProjectRef;
  /** Full ref for the latest accepted nav-context summary; stale page summaries cannot restore access. */
  private comparisonAccessProjectRef?: IProjectRef;
  private readonly comparisonWasmPin = inject(PUBLIC_SQLITE_COMPARE_WASM_PIN, {
    optional: true,
  });
  private authorLookupFocusRevision = 0;
  private authorLookupRequestRevision = 0;
  private pendingAuthorLookupNavigation?: PendingAuthorLookupNavigation;
  private authorModeScopeKey = '';
  private authorModeContextKey = '';
  private authorModeDefaultResolved = false;
  private authorModeExplicit = false;
  @ViewChild('authorLookupHeading', { read: ElementRef })
  private authorLookupHeading?: ElementRef<HTMLElement>;

  @ViewChild(QueryWorkspaceLayoutComponent)
  private authorWorkspaceLayout?: QueryWorkspaceLayoutComponent;

  @ViewChild(AuthorCodeEditorComponent)
  private authorCodeEditor?: AuthorCodeEditorComponent;

  public project?: IProjectContext;
  private navigationDraft?: { ref: IProjectRef; query: IQueryDef };
  private authorPreviewLifetime = 0;
  private previewDiagnosticNavigationSnapshot = signal<
    AuthorPreviewDiagnosticSnapshot | undefined
  >(undefined);
  private pendingPreviewDiagnosticNavigation?: {
    readonly generation: number;
    readonly snapshot: AuthorPreviewDiagnosticSnapshot;
  };
  private previewDiagnosticNavigationGeneration = 0;
  private authorErrorRevision = 0;
  private lastGitHubQueryEditReport?: { key: string; at: number };

  public showQueryBuilder?: boolean;
  public editorTab: 'text' | 'builder' = 'text';
  public readonly authorMode = signal<'compose' | 'code' | 'preview'>('compose');
  private readonly authorFormatUndo = signal<AuthorFormatUndo | undefined>(
    undefined,
  );
  private readonly authorRelationshipUndo = signal<AuthorRelationshipUndo | undefined>(undefined);
  private readonly authorFormatNavigationSnapshot = signal<
    AuthorFormatDiagnosticSnapshot | undefined
  >(undefined);
  public readonly authorFormatStatus = signal('');
  public authorFormatDiagnosticItems(): readonly TugQLDiagnostic[] {
    const snapshot = this.authorFormatNavigationSnapshot();
    return this.isCurrentAuthorFormatDiagnosticSnapshot(snapshot)
      ? snapshot.diagnostics
      : [];
  }
  public authorFormatDiagnosticRemainder(): number {
    const snapshot = this.authorFormatNavigationSnapshot();
    return this.isCurrentAuthorFormatDiagnosticSnapshot(snapshot)
      ? snapshot.remainingCount
      : 0;
  }
  public readonly canUndoAuthorFormat = computed(() => {
    const relationshipUndo = this.authorRelationshipUndo();
    const current = this.currentAuthorFormatContext();
    if (
      relationshipUndo &&
      current &&
      this.authorMode() === 'code' &&
      !this.running() &&
      !this.queryState.isSaving &&
      current.scopeKey === relationshipUndo.scopeKey &&
      current.queryIdentity === relationshipUndo.queryIdentity &&
      this.queryBodyText() === relationshipUndo.joinedSource
    ) return true;
    const undo = this.authorFormatUndo();
    if (!undo) return false;
    return (
      !!current &&
      this.authorMode() === 'code' &&
      !this.running() &&
      !this.queryState.isSaving &&
      current.scopeKey === undo.scopeKey &&
      current.queryIdentity === undo.queryIdentity &&
      this.queryBodyText() === undo.formattedSource
    );
  });
  public readonly authorCustomerId = signal('');
  public readonly customerInvoiceExample = signal(false);
  private readonly initializedCustomerInvoiceExamples = new Set<string>();

  private initializeCustomerInvoiceExample(): void {
    const ref = this.project?.ref;
    const address = ref && readGithubProjectId(ref.projectId);
    const routeId = this.route.snapshot.paramMap.get('queryId');
    const parameterId = this.route.snapshot.queryParamMap?.get('id');
    const routeProjectId = this.route.snapshot.paramMap.get('projectId');
    const routeStoreId = this.route.snapshot.paramMap.get('storeId');
    const admitted =
      (!routeId || !parameterId || routeId === parameterId) &&
      (routeId || parameterId) === this.queryState.id &&
      (!routeProjectId || routeProjectId === ref?.projectId) &&
      (!routeStoreId || routeStoreId === ref?.storeId) &&
      equalProjectRef(this.comparisonAccessProjectRef, ref) &&
      this.route.snapshot.queryParamMap?.get('example') ===
        'customer-invoices' &&
      ref?.storeId === 'github.com' &&
      ref.spaceID === undefined &&
      ref.projectApi === undefined &&
      ref.branch === undefined &&
      address?.ok === true &&
      address.id.org === 'datatug' &&
      address.id.repo === 'datatug-demo-project' &&
      address.id.folder === 'demo-project-1' &&
      address.id.ref === undefined &&
      this.comparisonProjectAccess() === 'public' &&
      this.queryState.id === 'demodb/chinook-customer-invoice-join' &&
      this.queryState.def?.connectionId === 'chinook-sqlite' &&
      this.queryState.def?.request.queryType === QueryType.DTQL;
    this.customerInvoiceExample.set(!!admitted);
    if (!admitted || !ref) return;
    const key = JSON.stringify(ref) + ':' + this.queryState.id;
    if (this.initializedCustomerInvoiceExamples.has(key)) return;
    this.initializedCustomerInvoiceExamples.add(key);
    if (
      Object.prototype.hasOwnProperty.call(
        this.queryState.authorBindings ?? {},
        'CustomerId',
      )
    )
      return;
    this.authorCustomerIdChanged(
      new CustomEvent('ionInput', { detail: { value: '1' } }),
    );
  }

  public readonly authorBindingRevision = signal(0);
  public readonly authorDraftRevision = signal(0);
  public readonly authorPlan = signal<PublicSqliteQueryPreview | undefined>(
    undefined,
  );
  public readonly authorPreviewLoading = signal(false);
  private readonly authorRunParameterAttempt = signal<{
    readonly scope: string;
    readonly definition: IQueryDef | undefined;
    readonly binding: string;
    readonly draftRevision: number;
  } | undefined>(undefined);
  public readonly authorRunParameterWarning = computed(() => {
    const attempt = this.authorRunParameterAttempt();
    if (!attempt) return undefined;
    return attempt.scope === this.authorRunParameterScope() &&
      attempt.definition === this.queryDef() &&
      attempt.binding === this.authorCustomerId() &&
      attempt.draftRevision === this.authorDraftRevision() &&
      this.authorRunReadiness().action === 'parameters'
      ? this.authorRunReadiness().message
      : undefined;
  });

  /** The same gates drive the header explanation and Run's disabled state. */
  public authorRunReadiness(): {
    readonly blocked: boolean;
    readonly message: string;
    readonly action?: 'parameters' | 'preview' | 'error' | 'code';
  } {
    if (this.running()) return { blocked: true, message: 'Running query…' };
    if (this.queryState.isSaving) return { blocked: true, message: 'Saving query…' };
    if (this.authorPreviewLoading()) return { blocked: true, message: 'Preparing SQL preview…' };
    if (!this.queryId || !this.project || !this.queryDef())
      return { blocked: true, message: 'Waiting for the query and project to load.' };
    if (this.authorUnsupportedParameterNames().length)
      return { blocked: true, message: 'This draft has parameters that this form cannot bind.', action: 'code' };
    if (!this.authorHasCustomerIdParameter())
      return { blocked: true, message: 'This parameter-free draft is unavailable in the current runner. Review a supported parameterized draft.', action: 'code' };
    const plan = this.authorPlan();
    if (this.authorError() && (!plan || plan.draftRevision !== this.authorDraftRevision()))
      return { blocked: true, message: 'SQL preview needs attention. Review the draft error.',
        action: this.canNavigateToAuthorPreviewSyntaxDiagnostic() ? 'error' : 'code' };
    if (!this.authorCustomerIdValid())
      return { blocked: true, message: this.authorCustomerIdMissing()
        ? 'Customer ID is required to Run.' : 'Customer ID must be a whole number.', action: 'parameters' };
    if (!plan || plan.draftRevision !== this.authorDraftRevision()) {
      return { blocked: true, message: 'Preview the current draft to enable Run.', action: 'preview' };
    }
    return { blocked: false, message: this.authorHasCustomerIdParameter()
      ? 'Ready to Run with Customer ID ' + this.authorCustomerId() + '.'
      : 'Ready to Run the current preview.' };
  }

  public recoverAuthorRun(): void {
    switch (this.authorRunReadiness().action) {
      case 'parameters':
        this.authorContextTabChanged('parameters');
        this.focusAuthorParameterAfterRender();
        break;
      case 'preview':
        this.setAuthorMode('preview');
        void this.previewTugql();
        break;
      case 'error': this.navigateToAuthorPreviewSyntaxDiagnostic(); break;
      case 'code': this.setAuthorMode('code'); break;
    }
  }

  @ViewChild('authorCustomerInput') private authorCustomerInput?: IonInput;
  private authorParameterFocusRevision = 0;

  private focusAuthorParameterAfterRender(): void {
    const revision = ++this.authorParameterFocusRevision;
    const definition = this.queryDef();
    const scope = this.historyScope();
    const current = (): boolean => revision === this.authorParameterFocusRevision &&
      this.queryDef() === definition && this.historyScope() === scope &&
      this.queryView() === 'author' && this.activeAuthorContextTab() === 'parameters' &&
      !this.running() && !this.queryState.isSaving;
    this.changeDetector.markForCheck();
    afterNextRender(() => {
      if (current()) void this.authorCustomerInput?.setFocus();
    }, { injector: this.injector });
  }
  public readonly queryView = signal<'author' | 'compare'>('author');
  public readonly comparisonSnapshot = signal<ComparisonSessionSnapshot | undefined>(undefined);
  public readonly comparisonResult = signal<SessionCompareResult | undefined>(undefined);
  public readonly comparisonBusy = signal(false);
  public readonly comparisonMessage = signal('');
  public readonly comparisonCustomerBinding = signal('No comparison pair has been run.');
  public readonly comparisonQueryLimit = signal('—');
  /** Access comes from the ref-matched project summary, never ambient auth state. */
  public readonly comparisonProjectAccess = signal<'public' | 'private' | 'protected' | undefined>(undefined);
  public readonly comparisonBlocker = computed(() => {
    const project = this.project?.ref;
    if (!project || !isGithubStoreId(project.storeId) || project.spaceID !== undefined || project.projectApi === 'cloud')
      return 'Compare is available for admitted public GitHub projects.';
    if (this.comparisonProjectAccess() !== 'public')
      return 'Public project access is required; wait for the matching project summary to load.';
    const definition = this.queryDef();
    if (!definition || !this.isTugqlAuthorJourney() || definition.connectionId !== 'chinook-sqlite')
      return 'Compare is available for the admitted Chinook Invoice TugQL query.';
    const plan = this.authorPlan();
    if (!plan || plan.draftRevision !== this.authorDraftRevision())
      return 'Preview SQL to check the current draft before running both fixtures.';
    if (plan.expandedSource !== undefined)
      return 'Review and apply the displayed relationship completion in Code, then Preview the updated draft before comparing.';
    if (plan.authorProof.profile !== 'invoice-query' || !plan.relationship ||
        !Number.isSafeInteger(plan.authorProof.resolvedQuery.limit) ||
        (plan.authorProof.resolvedQuery.limit ?? 0) < 1 ||
        (plan.authorProof.resolvedQuery.limit ?? 101) > 100)
      return 'Compare supports the bounded Invoice-to-Customer query profile only.';
    if (!isSupportedPublicSqliteComparisonProjection(plan))
      return 'Select InvoiceId plus supported text fields such as InvoiceDate before comparing.';
    if (!this.authorCustomerIdValid())
      return 'Enter a whole-number Customer ID binding before running both fixtures.';
    return 'Ready · Preview is current; both fixture queries will use the same frozen binding.';
  });
  public readonly authorCustomerIdValid = computed(
    () =>
      /^-?\d+$/u.test(this.authorCustomerId()) &&
      Number.isSafeInteger(Number(this.authorCustomerId())),
  );
  public readonly authorCustomerIdMissing = computed(
    () => this.authorCustomerId().trim().length === 0,
  );
  public readonly authorHasCustomerIdParameter = computed(() => {
    const source = this.queryBodyText();
    if (!source) return false;
    const parsed = parseTugQL(source);
    const hasDeclaredParameter = parsed.document.tree?.parameters?.some(
      (parameter) => parameter.name.toLowerCase() === 'customerid',
    );
    if (hasDeclaredParameter) return true;
    if (parsed.diagnostics.length)
      return /@CustomerId\b/iu.test(source);
    return false;
  });
  public readonly authorParameterDeclarationCount = computed(() => {
    const source = this.queryBodyText();
    if (!source) return undefined;
    const parsed = parseTugQL(source);
    const tree = parsed.document.tree;
    if (tree) return tree.parameters?.length ?? 0;
    return /@CustomerId\b/iu.test(source) ? 1 : undefined;
  });
  public readonly authorUnsupportedParameterNames = computed(() => {
    const parsed = parseTugQL(this.queryBodyText() ?? '');
    return (parsed.document.tree?.parameters ?? [])
      .filter((parameter) => parameter.name.toLowerCase() !== 'customerid')
      .map((parameter) => parameter.name);
  });
  public readonly authorParticipatingSourceInventory = computed(() =>
    inspectAuthorParticipatingSources(this.queryBodyText() ?? ''),
  );
  public authorRelatedSourceCount(): number | undefined {
    const metadata = this.authorSourceMetadata();
    const inventory = this.authorParticipatingSourceInventory();
    if (!metadata || !inventory.available) return undefined;
    const main = inventory.sources.find((source) => source.kind === 'main');
    if (main?.name.toLowerCase() !== 'invoice' ||
        (main.schema !== undefined && main.schema !== 'main') || main.database) return undefined;
    if (inventory.sources.some((source) =>
      source.kind !== 'main' && !(source.kind === 'join' && source.name.toLowerCase() === 'customer' && source.removable &&
        (source.schema === undefined || source.schema === 'main') && !source.database),
    )) return undefined;
    return inventory.customerJoined ? 0 : 1;
  }
  public authorSourceOccurrenceCount(): number | undefined {
    const inventory = this.authorParticipatingSourceInventory();
    return inventory.available ? inventory.sources.length : undefined;
  }
  public authorParameterCountLabel(): string {
    const count = this.authorParameterDeclarationCount();
    return count === undefined ? 'Parameter count unavailable' :
      `${count} parameter${count === 1 ? '' : 's'}`;
  }
  public authorSourceCountLabel(): string {
    const count = this.authorSourceOccurrenceCount();
    return count === undefined ? 'Source count unavailable' :
      `${count} participating source${count === 1 ? '' : 's'}`;
  }
  public authorRelatedSourceCountLabel(): string {
    const count = this.authorRelatedSourceCount();
    return count === undefined ? 'Related source count unavailable' :
      `${count} available related source${count === 1 ? '' : 's'}`;
  }
  public readonly authorContextTab = signal<'parameters' | 'sources' | 'related' | undefined>(undefined);
  public readonly activeAuthorContextTab = computed(
    () => this.authorContextTab() ??
      (this.authorHasCustomerIdParameter() ? 'parameters' : 'related'),
  );
  public readonly authorResultSnapshotKey = computed(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    const rows = this.visibleResultRows();
    if (!result || !recordset) return undefined;
    return Object.freeze([
      result,
      recordset,
      rows,
      this.relatedResultSet(),
      this.resultPageIndex(),
      this.displayedResultGeneration(),
    ]);
  });
  public readonly authorError = signal<string | undefined>(undefined);

  private setAuthorError(message: string | undefined): void {
    this.authorErrorRevision++;
    this.authorError.set(message);
  }
  public readonly authorSourceDiscovery = signal<PublicSqliteSourceDiscovery | undefined>(undefined);
  private authorSourceMetadataSource = '';
  private authorSourceMetadataIdentity?: symbol;
  public readonly authorSourceLoading = signal(false);
  public readonly authorSourceMessage = signal('');
  public readonly authorCustomerRemovalOpen = signal(false);
  public readonly authorCustomerRemovalOutputs = signal<readonly string[]>([]);
  private pendingAuthorCustomerRemoval?: {
    readonly source: string;
    readonly draftRevision: number;
    readonly scopeKey: string;
    readonly queryIdentity: symbol;
    readonly relationship: NonNullable<IQueryDef['relationshipBindings']>[number];
  };
  public readonly authorSourceReview = signal<AuthorRelationshipSourceReview | undefined>(undefined);
  public readonly authorSourceSelectedFields = signal<readonly AuthorCustomerField[]>(['FirstName']);
  public readonly authorCanJoinRelationship = computed(() => {
    if (this.authorSourceLoading() || this.running() || this.queryState.isSaving === true) return false;
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    return !!context && !!discovery && reviewAuthorRelationshipSource(
      context.source,
      [],
      discovery.relationship,
    ).ok;
  });
  public readonly authorCanRemoveCustomerJoin = computed(() => {
    if (this.authorSourceLoading() || this.running() || this.queryState.isSaving === true) return false;
    const context = this.currentAuthorSourceContext();
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    const binding = definition?.relationshipBindings?.find((candidate) =>
      candidate.id === discovery?.relationship.id &&
      candidate.version === discovery.relationship.version,
    );
    return !!context && !!definition && !!binding &&
      removeAuthorCustomerJoin(context.source, binding).ok;
  });
  public authorCustomerJoinRemovalReason(): string | undefined {
    if (this.running() || this.queryState.isSaving === true)
      return 'Source edits are unavailable while the query is running or saving.';
    const context = this.currentAuthorSourceContext();
    if (!context) return 'The current project and query context is unavailable.';
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    if (!discovery) return 'Current source metadata must be admitted again before this JOIN can be removed.';
    const binding = definition?.relationshipBindings?.find((candidate) =>
      candidate.id === discovery.relationship.id &&
      candidate.version === discovery.relationship.version,
    );
    if (!binding) return 'This JOIN has no matching admitted relationship binding.';
    const proposal = removeAuthorCustomerJoin(context.source, binding);
    return proposal.ok ? undefined : proposal.reason;
  }
  public readonly authorCustomerOutputChoices: readonly AuthorCustomerField[] = Object.freeze([
    'FirstName', 'LastName', 'Email',
  ]);
  private authorSourceRequestGeneration = 0;
  private authorSourceReviewGeneration = 0;
  private authorSourceScopeKey = '';
  private authorSourceReviewContext?: {
    readonly scopeKey: string;
    readonly queryIdentity: symbol;
    readonly source: string;
    readonly draftRevision: number;
    readonly selectedFields: readonly AuthorCustomerField[];
    readonly reviewGeneration: number;
    readonly schemaVersion: string;
  };
  public readonly isTugqlAuthorJourney = computed(
    () =>
      this.queryDef()?.connectionId === 'chinook-sqlite' &&
      this.queryDef()?.request.queryType === QueryType.DTQL,
  );

  public parameters?: IParameter[];

  public editorState?: IQueryEditorState = undefined;
  /** Current selected query's header label; normalized only for presentation. */
  public readonly queryPageTitle = signal('Query');
  public queryState: IQueryState = {
    id: '',
    queryType: QueryType.SQL,
    request: {
      queryType: QueryType.SQL,
      text: '',
    } as ISqlQueryRequest,
  };
  /** Structural Author edits update the executable definition. Retain the saved
   * definition separately until a real save or reload replaces that local draft. */
  private readonly authorSavedDefinition = signal<{
    readonly queryId: string;
    readonly saved: IQueryDef;
    readonly local: IQueryDef;
  } | undefined>(undefined);

  private trackAuthorStructuralDraft(local: IQueryDef): void {
    const previous = this.authorSavedDefinition();
    const queryId = this.queryState.id;
    if (!queryId) return;
    if (previous?.queryId !== queryId) {
      const saved = this.queryState.def;
      if (!saved) return;
      this.authorSavedDefinition.set({ queryId, saved, local });
    } else if (previous) {
      this.authorSavedDefinition.set({ ...previous, local });
    }
  }

  public get activeEnv(): IQueryEnvState | undefined {
    return this.queryState?.activeEnv;
  }

  public get queryId(): string | undefined {
    return this.queryState?.id;
  }

  public queryFolderPath = '';

  /** Where the back button goes with no history: the project's queries, in the folder of this query. */
  public get queriesBackHref(): string {
    const href = projectPageHref(this.project?.ref, 'queries');
    return `${href}${href.includes('?') ? '&' : '?'}folder=${encodeURIComponent(this.queryFolderPath)}`;
  }
  public envId?: string;
  public envDbServerId?: string;
  // noinspection SqlDialectInspection,SqlNoDataSourceInspection
  public environments?: readonly IQueryEnvState[];

  private readonly destroyed = new Subject<void>();

  // REQ:parameter-auto-binding, REQ:no-hidden-filters (INTEGRATION.md §6). Signals,
  // not plain fields, per this repo's zoneless-ready convention (AGENTS.md).
  private readonly selectionBindings: readonly Binding[];
  private readonly userBindingValues = signal<ReadonlyMap<string, TypedValue>>(
    new Map(),
  );
  private readonly selectedContextFactKeys = signal<
    ReadonlyMap<string, string>
  >(new Map());
  /** Task 15 item 3 — every semantic parameter's resolved binding, via
   * `binding-resolver.ts`'s precedence engine (explicit user edit > selection >
   * context > default; ambiguous/conflict/missing-required block Run). */
  public readonly bindings = signal<readonly ResolvedBinding[]>([]);
  private readonly clearedParamIds = signal<ReadonlySet<string>>(new Set());
  /** Parameter ids where the user has explicitly confirmed a shown
   * selection-vs-context conflict — keyed by the EXACT pair of values confirmed, so a
   * later change to a *different* conflicting pair is never silently treated as
   * already-confirmed (api-contract.md "an already-open query never rebinds
   * silently"). */
  private readonly confirmedConflicts = signal<
    ReadonlyMap<string, ConfirmedConflict>
  >(new Map());
  /** Bindings are frozen when a query opens. Later context changes are offered here
   * and never replace the run request until the user explicitly accepts them. */
  public readonly rebindSuggestions = signal<readonly RebindSuggestion[]>([]);
  private bindingSnapshot = new Map<string, ResolvedBinding>();
  private bindingSnapshotKey = '';
  private dismissedRebinds = new Map<string, string>();
  private seenPromotionRevision = 0;
  private promotionRebindPending = false;
  /** Bindings actually visible in the Parameters card — anything with a value or a
   * block reason; a still-empty optional parameter renders nothing (unchanged from
   * the pre-Task-15 behavior). */
  public readonly visibleBindings = computed(() =>
    this.bindings().filter((b) => b.value !== undefined || b.blocked),
  );
  /** What actually gets sent on a run — cleared, ambiguous, unconfirmed-conflict and
   * missing-required bindings are never silently sent (REQ:no-hidden-filters). */
  public readonly effectiveBindings = computed(() =>
    this.bindings().filter(isBindingRunnable),
  );
  /** `true` when at least one parameter is ambiguous, conflicted or a missing
   * required value — Run must be disabled and the reason shown (REQ:no-hidden-filters,
   * AC:typed-context-isolation "conflict blocks an unconfirmed run"). */
  public readonly hasBlockedBindings = computed(() =>
    hasBlockingBindings(this.bindings()),
  );
  public readonly running = signal(false);
  public readonly federatedProgress = signal<
    FederatedQueryProgress | undefined
  >(undefined);
  public readonly resultPageIndex = signal(0);
  public readonly resultPageSize = 100;
  public readonly federatedMode = signal<'full' | 'visible'>('full');
  public readonly visibleModeSupport = computed(() => {
    const definition = this.queryDef();
    return definition
      ? federatedVisibleMode(definition)
      : { supported: false, defaultMode: 'full' as const };
  });
  public readonly ovdbDestination = computed(() => {
    try {
      return new URL(this.queryDef()?.federation?.ovdbBaseUrl ?? '').origin;
    } catch {
      return 'the configured OVDB endpoint';
    }
  });
  public readonly resultPageLoading = signal(false);
  private resultPageRequestGeneration = 0;
  private readonly resultPageRows = signal<
    RunQueryResponse['recordset']['rows']
  >([]);
  /** In-memory OVDB credential for the current query only. */
  public readonly ovdbToken = signal('');
  /** Changes fence work authorized by a previous token without storing token bytes. */
  private readonly ovdbCredentialGeneration = signal(0);
  public readonly accessBlockers = signal<readonly string[]>([]);
  public readonly runError = signal<string | undefined>(undefined);
  public readonly runResult = signal<FederatedQueryResult | undefined>(
    undefined,
  );
  private readonly executionCopyFeedback = signal<{
    readonly receipt: PublicSqliteExecutionReceipt;
    readonly text: string;
  } | undefined>(undefined);
  private executionCopyGeneration = 0;
  public readonly executionCopyStatus = computed(() => {
    const feedback = this.executionCopyFeedback();
    return feedback && feedback.receipt === this.runResult()?.publicSqliteReceipt ? feedback.text : '';
  });

  public async copyExecutionIdentifier(
    receipt: PublicSqliteExecutionReceipt,
    value: string,
    label: string,
  ): Promise<void> {
    if (this.runResult()?.publicSqliteReceipt !== receipt) return;
    const generation = ++this.executionCopyGeneration;
    this.executionCopyFeedback.set(undefined);
    let write: Promise<void>;
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      write = clipboard.writeText(value);
    } catch {
      if (this.executionCopyGeneration === generation)
        this.executionCopyFeedback.set({ receipt, text: `Couldn't copy ${label}. Try again.` });
      return;
    }
    try {
      await write;
      if (this.executionCopyGeneration === generation && this.runResult()?.publicSqliteReceipt === receipt)
        this.executionCopyFeedback.set({ receipt, text: `${label} copied` });
    } catch {
      if (this.executionCopyGeneration === generation && this.runResult()?.publicSqliteReceipt === receipt)
        this.executionCopyFeedback.set({ receipt, text: `Couldn't copy ${label}. Try again.` });
    }
  }
  private readonly displayedResultGeneration = signal(0);
  public readonly queryRunTiming = signal<QueryRunTiming | undefined>(
    undefined,
  );
  /** Last complete execution, frozen separately from the latest attempt/result pane. */
  public readonly committedRun = signal<CommittedQueryRun | undefined>(
    undefined,
  );
  public readonly previousCommittedRun = computed(() => {
    const committed = this.committedRun();
    return committed &&
      (committed.displayedResultGeneration !==
        this.displayedResultGeneration() ||
        committed.queryIdentity !== this.currentQueryIdentity() ||
        committed.targetIdentity !== this.currentResultTargetIdentity() ||
        this.running() ||
        !!this.runError())
      ? committed
      : undefined;
  });
  public readonly displayedResultIsPreviousRun = computed(() => {
    const committed = this.committedRun();
    return (
      !!committed &&
      committed.displayedResultGeneration ===
        this.displayedResultGeneration() &&
      (this.running() ||
        !!this.runError() ||
        committed.queryIdentity !== this.currentQueryIdentity() ||
        committed.targetIdentity !== this.currentResultTargetIdentity())
    );
  });
  public readonly localResults = signal<readonly LocalResultDescriptor[]>([]);
  public readonly localHistoryLoading = signal(false);
  public readonly localHistoryError = signal<string | undefined>(undefined);
  public readonly selectedHistoricalResult = signal<LocalResultRef | undefined>(
    undefined,
  );
  public readonly historicalDefinition = signal<IQueryDef | undefined>(
    undefined,
  );
  public readonly relatedResultSet = signal('affiliations');
  private historySelection = 0;
  private historyCatalogRequest = 0;
  private observedSecurityContextId?: string;
  private hasObservedSecurityContext = false;
  private executedGraphDefinition?: IQueryDef;
  private federatedRunLifetime = 0;
  private semanticRunLifetime = 0;
  public readonly historicalPins = computed(() =>
    JSON.stringify(
      this.historicalDefinition()?.federation?.nativeGraph,
      null,
      2,
    ),
  );
  public readonly displayedRecordset = computed(() => {
    const result = this.runResult();
    return this.relatedResultSet() === 'affiliations'
      ? result?.recordset
      : result?.relatedRecordsets?.find(
          (set) => set.id === this.relatedResultSet(),
        )?.recordset;
  });
  private readonly publicDataMetadata = inject(PublicDataService);
  public readonly savedPlanReview = new SavedPlanReview(
    () => this.queryDef(),
    this.publicDataMetadata,
    this.queriesService,
    () => this.project?.ref,
    async (definition, signal) => {
      const source = definition.publicData?.declaredSource;
      if (!source || !this.project) return undefined;
      return this.injector
        .get(ConfiguredPublicDataSourcesService)
        .resolveSaved(this.project, source, signal);
    },
  );
  public readonly publicDataRevisionAcknowledged = signal(false);
  public readonly publicDataRevisionChanges = computed(() => {
    const saved = this.queryDef()?.publicData;
    return saved ? scenarioRevisionChanges(saved, INITIAL_CANONICAL_PINS) : [];
  });
  public readonly resultTotalRows = computed(() =>
    this.relatedResultSet() === 'affiliations'
      ? (this.runResult()?.totalRows ??
        this.runResult()?.recordset.rows.length ??
        0)
      : (this.runResult()?.relatedRecordsets?.find(
          (set) => set.id === this.relatedResultSet(),
        )?.totalRows ?? 0),
  );
  public readonly resultTotalRowsKnown = computed(() => {
    const result = this.runResult();
    if (!result) return false;
    if (this.relatedResultSet() === 'affiliations')
      return result.totalRows !== undefined || result.hasMore !== true;
    return result.relatedRecordsets?.some(
      (set) => set.id === this.relatedResultSet(),
    ) ?? true;
  });
  public readonly resultHasMore = computed(
    () =>
      !this.selectedHistoricalResult() && this.runResult()?.hasMore === true,
  );
  public readonly visibleResultRows = computed(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    if (!result || !recordset) return [];
    if (result?.totalRows !== undefined || result?.hasMore)
      return this.resultPageRows();
    const rows = recordset.rows;
    const start = this.resultPageIndex() * this.resultPageSize;
    return rows.slice(start, start + this.resultPageSize);
  });
  readonly semanticDialog = signal<SemanticModel | undefined>(undefined);
  readonly semanticColumn = signal(0);
  readonly semanticSaving = signal(false);
  readonly semanticBeforeSave = signal<SemanticModel | undefined>(undefined);
  readonly semanticError = signal('');
  readonly semanticNotice = signal('');
  readonly semanticStorage = signal('');
  readonly semanticSaveToProject = signal(false);
  readonly semanticSaveLabel = signal('Save meaning');
  readonly semanticSavedChoices = signal<readonly SavedMeaningChoice[]>([]);
  readonly semanticChoicesLoading = signal(false);
  readonly semanticChoicesMessage = signal('');
  readonly semanticExecutedDefinition = signal<IQueryDef | undefined>(undefined);
  readonly semanticCurrentHash = signal('');
  private static pendingSemanticCopy?: { id: string; result: FederatedQueryResult; definition: IQueryDef; environment?: string; selectedSource?: string };
  readonly semanticBasis = signal<SemanticModel['basis'] | undefined>(undefined);
  readonly semanticPersonalCopies = signal<IQueryDef[]>([]);
  private readonly semanticNav = inject(DatatugNavService);
  private semanticBasisGeneration = 0;
  private semanticMappingLifetime = 0;
  readonly semanticNeedsReview = computed(() => {
    const saved = this.queryDef()?.semanticModel, basis = this.semanticBasis();
    return !!saved && (!basis || this.displayedResultIsPreviousRun() || this.semanticCurrentHash() !== basis.queryHash || !sameSemanticBasis(saved.basis, basis));
  });
  semanticColumnLabel(index: number): string {
    const bundle = this.semanticSaving() ? this.semanticBeforeSave() : this.queryDef()?.semanticModel;
    const binding = bundle?.bindings.find(item => item.columnIndex === index);
    const property = bundle?.meaning.concepts.find(item => item.id === binding?.concept);
    const entity = bundle?.meaning.concepts.find(item => item.id === property?.of);
    return property ? [entity?.labels.en, property.labels.en, binding?.role].filter(Boolean).join(' · ') : '';
  }
  async openColumnMeaning(index: number): Promise<void> {
    if (!this.semanticBasis() || !this.project) return;
    const lifetime = ++this.semanticMappingLifetime, project = this.project, queryId = this.queryState.id ?? '', ref = project.ref;
    const active = () => lifetime === this.semanticMappingLifetime && this.project?.ref === ref && this.queryState.id === queryId;
    if (this.displayedResultIsPreviousRun() || this.semanticCurrentHash() !== this.semanticBasis()?.queryHash) { this.semanticNotice.set('Run the updated query before mapping its columns. Existing meanings need review.'); return; }
    this.semanticNotice.set('');
    this.semanticError.set(''); this.semanticColumn.set(index);
    const current = this.queryDef()?.semanticModel;
    const fresh = createSemanticModel(this.semanticBasis()!);
    if (current) {
      fresh.meaning = structuredClone(current.meaning);
      fresh.bindings = current.bindings.filter(binding => binding.columnIndex < fresh.basis.columns.length);
    }
    let supported = false;
    if (!isDevicePersonalQuery(this.queryState.id ?? '') && (this.project.ref.projectApi || isSharedProjectRef(this.project.ref))) {
      try { const capabilities = await firstValueFrom(this.queriesService.capabilities(this.project.ref)); supported = !!capabilities.querySave && !!capabilities.semanticModel && this.queryState.saveSupported !== false; } catch { supported = false; }
    }
    if (!active()) return;
    this.semanticSaveToProject.set(supported);
    const personal = isDevicePersonalQuery(this.queryState.id ?? '');
    this.semanticStorage.set(personal ? 'Saved on this device.' : supported ? 'Saves meanings in this project.' : 'Creates a personal copy saved on this device.');
    this.semanticSaveLabel.set(personal || supported ? 'Save meaning' : 'Save personal copy');
    this.semanticSavedChoices.set([]);
    this.semanticChoicesLoading.set(true);
    this.semanticChoicesMessage.set('');
    this.semanticDialog.set(fresh);
    void this.queriesService.devicePersonal.list(ref).then(items => {
      if (this.semanticDialog() !== fresh || this.queryState.id !== queryId || this.project?.ref !== ref) return;
      const result = savedMeaningChoices(items.map(item => item.query), queryId);
      this.semanticSavedChoices.set(result.choices);
      this.semanticChoicesMessage.set(result.skipped ? 'Some saved meanings could not be loaded. You can still create a property.' : '');
    }).catch(() => {
      if (this.semanticDialog() === fresh && this.queryState.id === queryId && this.project?.ref === ref)
        this.semanticChoicesMessage.set('Saved meanings could not be loaded. You can still create a property.');
    }).finally(() => { if (this.semanticDialog() === fresh) this.semanticChoicesLoading.set(false); });
  }
  async saveColumnMeaning(bundle: SemanticModel): Promise<void> {
    const project = this.project, definition = this.queryDef();
    if (!project || !definition || this.semanticSaving()) return;
    const sourceState = this.queryState, originalDefinition = sourceState.def;
    const sourceResult = this.runResult(), environment = this.envId, selectedSource = this.selectedSource();
    const lifetime = ++this.semanticMappingLifetime;
    const active = () => lifetime === this.semanticMappingLifetime && this.project?.ref === project.ref && this.queryState.id === sourceState.id;
    this.semanticBeforeSave.set(originalDefinition?.semanticModel);
    this.semanticSaving.set(true); this.semanticError.set('');
    try {
      validateSemanticModel(bundle);
      const current = { ...definition, request: this.queryState.request ?? definition.request, connectionId: this.queryState.connectionId ?? definition.connectionId, federation: this.queryState.federation ?? definition.federation, semanticModel: bundle };
      const supported = this.semanticSaveToProject();
      if (isDevicePersonalQuery(current.id) || supported) {
        this.queryEditorStateService.updateQueryState({ ...this.queryState, def: current });
        await firstValueFrom(this.queryEditorStateService.saveQuery({ ...sourceState, def: current }, project.ref));
        if (!active()) return;
      } else {
        const copy = { ...current, id: `device-personal-${crypto.randomUUID()}`, title: `${current.title || 'Query'} · Personal` };
        await firstValueFrom(this.queriesService.createQuery(project.ref, copy));
        if (!active()) return;
        const result = sourceResult;
        if (result) QueryPageComponent.pendingSemanticCopy = { id: copy.id, result, definition: copy, environment, selectedSource };
        this.queryEditorStateService.newQuery({ ...sourceState, id: copy.id, title: copy.title, def: copy, request: copy.request, isNew: false, isSaving: false });
        this.semanticSaving.set(false);
        this.semanticDialog.set(undefined);
        this.router.events.pipe(filter(event => event instanceof NavigationEnd), take(1)).subscribe(() => {
          if (result && this.queryState.id === copy.id) {
            QueryPageComponent.pendingSemanticCopy = undefined;
            this.setDisplayedResult(result);
            this.commitSuccessfulResult(result, copy);
          }
        });
        this.semanticNav.goQuery(project, copy, 'edit');
      }
      if (!active()) return;
      this.semanticSaving.set(false);
      this.semanticDialog.set(undefined);
      void this.queriesService.devicePersonal.list(project.ref).then(items => { if (this.project?.ref === project.ref) this.semanticPersonalCopies.set(items.map(item => item.query)); }).catch(() => undefined);
    } catch (error) {
      if (!active()) return;
      if (originalDefinition) this.queryEditorStateService.updateQueryState({ ...sourceState, def: originalDefinition, isSaving: false });
      this.semanticError.set(error instanceof Error ? error.message : 'Meaning could not be saved. Your draft is retained.');
    }
    finally { if (active()) this.semanticSaving.set(false); }
  }
  openSemanticPersonalCopy(id: string): void {
    const query = this.semanticPersonalCopies().find(item => item.id === id);
    if (query && this.project) this.semanticNav.goQuery(this.project, query, 'edit');
  }
  public readonly resultGridColumnDefs = computed<ColDef<QueryResultGridRow>[]>(
    () => {
      const result = this.runResult();
      const receipt = result?.publicSqliteReceipt;
      const canOfferLookup =
        !!result &&
        this.relatedResultSet() === 'affiliations' &&
        !this.selectedHistoricalResult() &&
        !this.displayedResultIsPreviousRun() &&
        !this.publicSqliteRunIsStale(result);
      return (this.displayedRecordset()?.columns ?? []).map((column, index) => {
        const columnId = `result_${index}`;
        const canLookupCustomer =
          hasVerifiedCustomerIdLineage(receipt, index, column.name) &&
          canOfferLookup;
        return {
          colId: columnId,
          field: columnId,
          headerName: column.name,
          headerComponent: SemanticColumnHeaderComponent,
          headerComponentParams: {
            meaningLabel: this.semanticColumnLabel(index),
            needsReview: !!this.queryDef()?.semanticModel?.bindings.some(binding => binding.columnIndex === index) && this.semanticNeedsReview(),
            openMeaning: () => { void this.openColumnMeaning(index); },
          },
          sortable: false,
          minWidth: 120,
          ...(canLookupCustomer || (index === 0 && this.isTugqlAuthorJourney())
            ? {
                cellRenderer: (
                  params: ICellRendererParams<QueryResultGridRow, string>,
                ) =>
                  this.renderInspectedResultCell(
                    params,
                    canLookupCustomer ? receipt : undefined,
                    this.currentQueryIdentity(),
                    index,
                    column.name,
                  ),
                suppressKeyboardEvent: (
                  params: SuppressKeyboardEventParams<
                    QueryResultGridRow,
                    string
                  >,
                ) => this.suppressCustomerLookupKeyboardEvent(params),
              }
            : {}),
        };
      });
    },
  );
  private readonly resultGridRowSnapshots = new WeakMap<
    QueryResultGridRow,
    QueryResultGridRowSnapshot
  >();
  public readonly selectedAuthorResultRow = signal<
    QueryResultGridRowSnapshot | undefined
  >(undefined);
  public readonly currentAuthorResultRow = computed(() => {
    const selected = this.selectedAuthorResultRow();
    if (!selected) return undefined;
    return selected.result === this.runResult() &&
      selected.recordset === this.displayedRecordset() &&
      selected.resultSetId === this.relatedResultSet() &&
      selected.resultPageIndex === this.resultPageIndex() &&
      selected.resultGeneration === this.displayedResultGeneration() &&
      selected.rows === this.visibleResultRows()
      ? selected
      : undefined;
  });
  private readonly authorRowFilterFeedback = signal<{
    readonly row: readonly TypedValue[];
    readonly snapshotKey: unknown;
    readonly text: string;
  } | undefined>(undefined);
  public readonly authorRowFilterStatus = computed(() => {
    const feedback = this.authorRowFilterFeedback();
    return feedback && feedback.row === this.currentAuthorResultRow()?.row &&
      feedback.snapshotKey === this.authorResultSnapshotKey() ? feedback.text : '';
  });
  public clearAuthorRowFilterStatus(): void {
    this.authorRowFilterFeedback.set(undefined);
  }

  public useAuthorResultValueAsFilter(action: {
    readonly index: number;
    readonly row: readonly TypedValue[];
    readonly snapshotKey: unknown;
  }): void {
    const selected = this.currentAuthorResultRow();
    const status = (text: string): void => {
      this.authorRowFilterFeedback.set({ row: action.row, snapshotKey: action.snapshotKey, text });
    };
    if (!selected || selected.row !== action.row || action.snapshotKey !== this.authorResultSnapshotKey()) {
      status('This row changed. Select a current result row and try again.');
      return;
    }
    const receipt = selected.result.publicSqliteReceipt;
    const output = receipt?.outputColumns?.[action.index];
    const column = selected.recordset.columns[action.index];
    const value = action.row[action.index];
    if (this.running() || this.queryState.isSaving || this.resultPageLoading() ||
        this.selectedHistoricalResult() || this.displayedResultIsPreviousRun() ||
        this.publicSqliteRunIsStale(selected.result) ||
        this.authorPlan()?.draftRevision !== this.authorDraftRevision()) {
      status('These results belong to a previous draft. Preview and run the current draft before filtering.');
      return;
    }
    if (!receipt || !column || !output || output.name !== column.name ||
        output.type !== 'integer' || output.lineage.length !== 1 ||
        (receipt.relationship && output.lineage[0]?.source !== receipt.relationship.fromSource) ||
        output.lineage[0]?.field !== 'InvoiceId' ||
        value?.type !== 'integer' || !/^[1-9]\d*$/u.test(value.value) ||
        !Number.isSafeInteger(Number(value.value))) {
      status('Filtering is available for a verified InvoiceId integer cell. Copy this value or edit other filters in TugQL Code.');
      return;
    }
    const source = this.queryBodyText();
    if (source === undefined) {
      status('The current TugQL draft is unavailable. Reopen this query before filtering.');
      return;
    }
    const edit = useInvoiceIdAsAuthorFilter(source, value.value);
    if (!edit.ok) {
      status(edit.reason);
      return;
    }
    if (edit.after === source) {
      status(`This draft already filters InvoiceId ${value.value}.`);
      return;
    }
    this.queryTextChanged(new CustomEvent('ionInput', { detail: { value: edit.after } }), false);
    const current = this.currentAuthorFormatContext();
    if (current) this.authorFormatUndo.set({
      action: 'filter', originalSource: source, formattedSource: edit.after,
      scopeKey: current.scopeKey, queryIdentity: current.queryIdentity,
    });
    this.authorModeExplicit = true;
    this.authorMode.set('code');
    this.authorFormatStatus.set('InvoiceId filter added. Undo available.');
    status(`InvoiceId ${value.value} added to TugQL Query. Undo available.`);
    if (this.authorRowDetailsOpen()) {
      this.authorRowDetailsShowEditorAfterDismiss = true;
      this.authorRowDetailsOpen.set(false);
    }
  }
  public readonly authorResultRowSelection = {
    mode: 'singleRow' as const,
    enableClickSelection: true,
    checkboxes: false,
    headerCheckbox: false,
  };
  public readonly authorRowDetailsOpen = signal(false);
  private authorRowDetailsShowEditorAfterDismiss = false;
  private authorRowDetailsFocusGeneration = 0;
  private authorViewActive = true;
  private authorRowDetailsSnapshot?: unknown;
  private authorRowDetailsCaller?: HTMLElement;
  private authorResultGridApi?: GridApi<QueryResultGridRow>;

  public openAuthorRowDetails(event: Event): void {
    if (!this.currentAuthorResultRow() || this.resultPageLoading()) return;
    ++this.authorRowDetailsFocusGeneration;
    this.authorRowDetailsCaller = event.currentTarget as HTMLElement;
    this.authorRowDetailsSnapshot = this.authorResultSnapshotKey();
    this.authorRowDetailsOpen.set(true);
  }

  public authorRowDetailsDismissed(): void {
    this.authorRowDetailsOpen.set(false);
    const showEditor = this.authorRowDetailsShowEditorAfterDismiss;
    this.authorRowDetailsShowEditorAfterDismiss = false;
    const caller = this.authorRowDetailsCaller;
    const snapshot = this.authorRowDetailsSnapshot;
    const generation = this.authorRowDetailsFocusGeneration;
    const query = this.currentQueryIdentity();
    const scope = this.historyScope();
    this.authorRowDetailsCaller = undefined;
    this.authorRowDetailsSnapshot = undefined;
    if (showEditor) {
      requestAnimationFrame(() => {
        if (this.authorViewActive && this.queryView() === 'author' &&
            query === this.currentQueryIdentity() && scope === this.historyScope())
          this.authorWorkspaceLayout?.showEditor();
      });
      return;
    }
    // Ionic emits didDismiss before completing overlay/focus-trap teardown.
    // Restore on the next frame, only while the originating view and row still own it.
    requestAnimationFrame(() => {
      if (!caller?.isConnected || !this.authorViewActive || this.queryView() !== 'author' ||
          generation !== this.authorRowDetailsFocusGeneration || this.authorRowDetailsOpen() ||
          query !== this.currentQueryIdentity() || scope !== this.historyScope() ||
          snapshot !== this.authorResultSnapshotKey() || !this.currentAuthorResultRow()) return;
      const focusTarget = caller.shadowRoot?.querySelector<HTMLElement>('button, a') ?? caller;
      focusTarget.focus({ preventScroll: true });
    });
  }

  public readonly authorResultRowClassRules: RowClassRules<QueryResultGridRow> = {
    'author-inspected-row': (params) => {
      const snapshot = params.data && this.resultGridRowSnapshots.get(params.data);
      return !!snapshot && snapshot === this.currentAuthorResultRow();
    },
  };

  private renderInspectedResultCell(
    params: ICellRendererParams<QueryResultGridRow, string>,
    receipt: PublicSqliteExecutionReceipt | undefined,
    queryIdentity: symbol,
    columnIndex: number,
    columnName: string,
  ): HTMLElement {
    const content = this.renderCustomerLookupCell(params, receipt, queryIdentity, columnIndex, columnName);
    if (columnIndex !== 0 || !params.data ||
        this.resultGridRowSnapshots.get(params.data) !== this.currentAuthorResultRow()) return content;
    const cell = document.createElement('span');
    cell.className = 'author-inspected-cell';
    const marker = document.createElement('span');
    marker.className = 'author-inspected-row-marker';
    marker.textContent = '▶';
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', 'Current row, position ' + this.currentAuthorResultRow()?.position);
    marker.title = 'Current row';
    cell.append(marker, content);
    return cell;
  }
  public readonly resultGridRows = computed<QueryResultGridRow[]>(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    const rows = this.visibleResultRows();
    if (!result || !recordset) return [];
    return rows.map((row, index) => {
      const projected = Object.fromEntries(
        row.map((cell, columnIndex) => [
          `result_${columnIndex}`,
          displayQueryResultValue(cell),
        ]),
      );
      this.resultGridRowSnapshots.set(projected, {
        result,
        recordset,
        rows,
        row,
        resultSetId: this.relatedResultSet(),
        resultPageIndex: this.resultPageIndex(),
        resultGeneration: this.displayedResultGeneration(),
        position: this.resultPageIndex() * this.resultPageSize + index + 1,
      });
      return projected;
    });
  });
  public readonly resultGridDefaultColDef: ColDef<QueryResultGridRow> = {
    initialFlex: 1,
    resizable: true,
  };
  public readonly resultGridNoRowsTemplate =
    '<span class="ag-overlay-no-rows-center">No rows.</span>';

  private renderCustomerLookupCell(
    params: ICellRendererParams<QueryResultGridRow, string>,
    receipt: PublicSqliteExecutionReceipt | undefined,
    queryIdentity: symbol,
    columnIndex: number,
    columnName: string,
  ): HTMLElement {
    const value = document.createElement('span');
    value.textContent = params.value ?? '';
    const rowIndex = params.node.rowIndex;
    const result = this.runResult();
    const current =
      !!result &&
      rowIndex !== null &&
      this.relatedResultSet() === 'affiliations' &&
      !this.selectedHistoricalResult() &&
      !this.displayedResultIsPreviousRun() &&
      !this.publicSqliteRunIsStale(result);
    const customerId = customerIdLookupValue(
      receipt,
      columnIndex,
      columnName,
      rowIndex === null
        ? undefined
        : this.visibleResultRows()[rowIndex]?.[columnIndex],
      current,
    );
    if (!customerId) return value;

    const cell = document.createElement('div');
    cell.className = 'author-customer-cell';
    cell.append(value);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'author-customer-lookup-action';
    button.dataset['testid'] = 'author-customer-lookup-action';
    button.dataset['gridRow'] = String(rowIndex);
    button.dataset['gridColumn'] = params.column?.getColId() ?? '';
    button.textContent = 'Look up invoices';
    button.setAttribute(
      'aria-label',
      `Look up invoices for Customer ID ${customerId}`,
    );
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        button.click();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      event.stopPropagation();
      params.api.tabToNextCell(event);
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (rowIndex !== null && receipt?.executionId) {
        this.openAuthorCustomerLookup(
          columnIndex,
          columnName,
          rowIndex,
          receipt.executionId,
          customerId,
          queryIdentity,
        );
      }
    });
    cell.append(button);
    return cell;
  }

  /**
   * AG Grid keeps keyboard focus on the gridcell and does not include controls
   * in a cell renderer in its normal Tab sequence. Let Tab enter this action
   * from the focused CustomerId cell; the button itself delegates Tab back to
   * AG Grid so navigation continues through cells and out of the grid.
   */
  private suppressCustomerLookupKeyboardEvent(
    params: SuppressKeyboardEventParams<QueryResultGridRow, string>,
  ): boolean {
    const event = params.event;
    if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== ' ') {
      return false;
    }
    const rowIndex = params.node.rowIndex;
    if (rowIndex === null) return false;
    const columnId = params.column.getColId();
    const eventTarget = event.target;
    if (!(eventTarget instanceof Element)) return false;
    const gridCell = eventTarget.closest<HTMLElement>('.ag-cell');
    const button = gridCell?.querySelector<HTMLButtonElement>(
      '.author-customer-lookup-action',
    );
    if (
      button?.dataset['gridRow'] !== String(rowIndex) ||
      button?.dataset['gridColumn'] !== columnId
    ) {
      return false;
    }
    if (!button || event.target === button) return false;
    if (event.key === 'Tab') {
      if (event.shiftKey) return false;
      event.preventDefault();
      button.focus();
      return true;
    }
    event.preventDefault();
    button.click();
    return true;
  }
  public readonly resultPageEnd = computed(() =>
    Math.min(
      (this.resultPageIndex() + 1) * this.resultPageSize,
      this.resultTotalRows(),
    ),
  );
  private readonly lastRunBindingRoles = signal<
    ReadonlyMap<string, ResolvedBinding['role']>
  >(new Map());

  /** The resolved definition backing the CURRENT `queryState` — a dedicated
   * signal, deliberately NOT read straight off `queryState.def` (a plain
   * field written from inside `onQueryEditorStateChanged()`'s `.subscribe()`
   * callback, this file's own pre-existing zoneless-allowlist entry): a
   * signal write notifies Angular's zoneless scheduler directly, so the
   * query-text/linked-entities display below (new, S155) reliably repaints
   * once the query finishes loading — including the direct-URL-load path
   * (no in-app click, no router `state`) that founder ruling 2026-09-10
   * reproduced, where the fetch genuinely completes asynchronously after
   * this component's first render. See AGENTS.md's "Change detection &
   * state" section. */
  public readonly queryDef = signal<IQueryDef | undefined>(undefined);
  /** Semantic equality avoids marking an unchanged definition as an edit. */
  private readonly identityDefinition = computed(() => {
    const definition = this.queryDef();
    if (!definition) return undefined;
    const { semanticModel: _semanticModel, ...executionDefinition } = definition;
    return executionDefinition;
  }, {
    equal: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  });
  /** Receipts identify a draft without copying request or credential bytes. */
  private readonly queryIdentityToken = computed(() => {
    this.identityDefinition();
    return Symbol('query-definition');
  });

  /** SQL/DTQL body text for the current query, for the `editor=text` panel
   * below — `undefined` for an HTTP query (no text-shaped `request`) or
   * before the query has loaded. */
  public readonly queryBodyText = computed(() => {
    const request = this.queryDef()?.request;
    return request && request.queryType !== QueryType.HTTP
      ? (request as ISqlQueryRequest).text
      : undefined;
  });
  public readonly hostedDemoDbSources = HOSTED_DEMO_DB_SOURCES;
  public readonly selectedHostedDemoDbSource = computed(() =>
    hostedDemoDbSourceId(this.queryDef()),
  );
  public readonly canChangeHostedDemoDbSource = computed(() =>
    isHostedDemoDbStarterQuery(this.queryDef()),
  );

  public canChoosePublicSqliteSource(): boolean {
    return (
      isBrowserSqlProject(this.project?.ref) &&
      this.queryDef()?.request.queryType === QueryType.SQL
    );
  }

  public readonly sharedQuerySaveAllowed = signal(false);
  public canSaveQuery(): boolean {
    return isDevicePersonalQuery(this.queryState.id ?? '') || !this.project || !isSharedProjectRef(this.project.ref) || this.sharedQuerySaveAllowed();
  }

  public querySaveState(): string {
    if (!this.queryDef()) return 'Loading';
    if (this.queryState.isSaving) return 'Saving';
    if (isDevicePersonalQuery(this.queryState.id ?? '')) return this.isChanged ? 'Unsaved · On this device' : 'Saved on this device';
    if (this.queryState.saveSupported === false || !this.canSaveQuery())
      return this.isChanged ? 'Unsaved · Read-only' : 'Read-only';
    return this.isChanged ? 'Unsaved' : 'Saved';
  }

  public publicSqliteSourceChanged(event: Event): void {
    if (!this.canChoosePublicSqliteSource()) return;
    const connectionId = (event as CustomEvent<{ value: string }>).detail.value;
    if (connectionId !== '' && connectionId !== 'chinook-sqlite') return;
    this.queryEditorStateService.updateQueryState({
      ...this.queryState,
      connectionId,
    });
  }

  public setQueryView(view: 'author' | 'compare'): void {
    if (view !== 'author') {
      this.authorFormatNavigationSnapshot.set(undefined);
      this.clearPreviewDiagnosticNavigation();
    }
    this.queryView.set(view);
  }

  private invalidateComparison(reason: string): void {
    this.comparisonAccessGeneration++;
    this.comparisonGeneration++;
    this.comparisonAbort?.abort();
    this.comparisonAbort = undefined;
    const snapshot = this.comparisonSession.snapshot();
    if (snapshot && !snapshot.invalidated) {
      this.comparisonSession.invalidate(reason);
      this.comparisonSnapshot.set(this.comparisonSession.snapshot());
    }
    this.comparisonBusy.set(false);
    if (snapshot) this.comparisonMessage.set(`${reason} The earlier observation is retained as previous page-memory output.`);
  }

  private expireComparisonSession(reason: string): void {
    this.invalidateComparison(reason);
    this.comparisonSession.clear();
    this.comparisonSnapshot.set(undefined);
    this.comparisonResult.set(undefined);
    this.comparisonPreparedPlan = undefined;
    this.comparisonCustomerBinding.set('No comparison pair has been run.');
    this.comparisonQueryLimit.set('—');
    this.comparisonMessage.set('The comparison session ended when this page was left or closed.');
  }

  /** Ionic caches routed pages, so comparison memory must expire on leave as well as destroy. */
  private invalidateSemanticMapping(): void {
    ++this.semanticMappingLifetime;
    this.semanticDialog.set(undefined);
    this.semanticSaving.set(false);
  }

  public ionViewWillLeave(): void {
    this.invalidateSemanticMapping();
    this.authorViewActive = false;
    ++this.authorRowDetailsFocusGeneration;
    ++this.authorPreviewLifetime;
    this.authorPreviewLoading.set(false);
    this.authorRowDetailsOpen.set(false);
    this.authorFormatNavigationSnapshot.set(undefined);
    this.clearPreviewDiagnosticNavigation();
    this.expireComparisonSession('The comparison session ended when this page was left.');
    this.changeDetector.detectChanges();
  }

  private comparisonInputKey(): string {
    return JSON.stringify({
      project: this.project?.ref,
      accessClassification: this.comparisonProjectAccess(),
      agentSecurityContextId: this.agentContext.securityContextId(),
      queryId: this.queryId,
      definition: this.queryDef(),
      source: this.queryBodyText(),
      draftRevision: this.authorDraftRevision(),
      bindingRevision: this.authorBindingRevision(),
      customerId: this.authorCustomerId(),
      accessGeneration: this.comparisonAccessGeneration,
    });
  }

  private preparedComparisonPlan(
    preview: PublicSqliteQueryPreview,
  ): PublicSqlitePreparedPlan {
    if (preview.expandedSource !== undefined)
      throw new Error(
        'Review and apply the displayed relationship completion in Code, then Preview the updated draft before comparing.',
      );
    const customerId = Number(this.authorCustomerId());
    if (!this.authorCustomerIdValid() || !Number.isSafeInteger(customerId))
      throw new Error('Compare requires a whole-number CustomerId binding.');
    const { fixedBindings, bindingSlots, ...base } = preview;
    const bindings = bindingSlots
      ? bindingSlots.map((slot) => slot.kind === 'customer-id' ? customerId : slot.value)
      : (() => {
          if (preview.bindingNames[0] !== 'CustomerId')
            throw new Error('The frozen query is missing its CustomerId binding.');
          return [customerId, ...fixedBindings];
        })();
    return cloneAndFreeze({ ...base, bindings }) as PublicSqlitePreparedPlan;
  }

  private async comparisonContext(
    plan: PublicSqlitePreparedPlan,
    project: IProjectRef,
  ): Promise<ComparisonContextSnapshot> {
    this.assertPublicComparisonScope(project);
    const relationship = plan.relationship;
    if (!relationship) throw new Error('Preview the declared Invoice-to-Customer relationship first.');
    const draftRevision = this.authorDraftRevision();
    return Object.freeze({
      projectRef: JSON.stringify(project),
      pageMemoryScope: `public-github:${JSON.stringify(project)}`,
      accessClassification: 'public',
      ...(this.agentContext.securityContextId()
        ? { agentSecurityContextId: this.agentContext.securityContextId() }
        : {}),
      accessGeneration: this.comparisonAccessGeneration,
      draftRevision,
      authoredSourceFingerprint: await sha256Text(this.queryBodyText() ?? ''),
      relationshipFingerprint: await sha256Text(JSON.stringify(relationship)),
      typedBindingsFingerprint: await sha256Text(JSON.stringify({ CustomerId: plan.bindings[0] })),
    });
  }

  private assertPublicComparisonScope(project: IProjectRef): void {
    if (
      !equalProjectRef(this.project?.ref, project) ||
      this.comparisonProjectAccess() !== 'public' ||
      !isGithubStoreId(project.storeId) ||
      project.spaceID !== undefined ||
      project.projectApi === 'cloud'
    )
      throw new Error('Public project access is required for this comparison session.');
  }

  private assertComparisonInputCurrent(key: string): void {
    if (this.comparisonInputKey() !== key)
      throw new Error('The draft, binding, project, or access context changed. Preview again before comparing.');
  }

  public async runComparisonBoth(): Promise<void> {
    if (!this.comparisonBlocker().startsWith('Ready')) return;
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (!project || !definition) return;
    const inputKey = this.comparisonInputKey();
    const reviewedPreview = this.authorPlan();
    if (!reviewedPreview || reviewedPreview.draftRevision !== this.authorDraftRevision()) return;
    const reviewedPreviewJson = JSON.stringify(reviewedPreview);
    const operation = ++this.comparisonGeneration;
    this.comparisonBusy.set(true);
    this.comparisonMessage.set('Rechecking the admitted project metadata before either worker starts.');
    try {
      const preview = await this.publicSqliteQuery.prepareTugQL(
        project,
        definition,
        this.authorDraftRevision(),
        undefined,
        true,
      );
      this.assertComparisonInputCurrent(inputKey);
      if (preview.expandedSource !== undefined)
        throw new Error(
          'Review and apply the displayed relationship completion in Code, then Preview the updated draft before comparing.',
        );
      if (
        JSON.stringify(preview) !== reviewedPreviewJson ||
        JSON.stringify(this.authorPlan()) !== reviewedPreviewJson
      )
        throw new Error(
          'The project metadata or compiled SQL changed after Preview. Preview again to review the current plan before running both fixtures.',
        );
      const plan = this.preparedComparisonPlan(preview);
      if (plan.authorProof.profile !== 'invoice-query' || !plan.relationship)
        throw new Error('The live query profile does not support fixture comparison.');
      this.comparisonCustomerBinding.set(`CustomerId ${String(plan.bindings[0])} · frozen integer binding`);
      this.comparisonQueryLimit.set(String(plan.authorProof.resolvedQuery.limit));
      const context = await this.comparisonContext(plan, project);
      this.assertComparisonInputCurrent(inputKey);
      if (operation !== this.comparisonGeneration) return;
      const snapshot = this.comparisonSession.begin(context);
      // A previous diff remains visible until the replacement pair has passed its
      // fresh metadata, Preview-plan and authorization-context admission checks.
      this.comparisonResult.set(undefined);
      this.comparisonPreparedPlan = plan;
      this.comparisonSnapshot.set(snapshot);
      this.comparisonMessage.set('Both independent fixture queries are running.');
      await Promise.all(PUBLIC_CHINOOK_COMPARISON_TARGETS.map(async (target) => {
        const token = this.comparisonSession.startSide(target.id);
        this.comparisonSnapshot.set(this.comparisonSession.snapshot());
        await this.runComparisonSide(token, project, definition, plan, operation);
      }));
    } catch (error) {
      if (operation === this.comparisonGeneration) {
        this.comparisonMessage.set(error instanceof Error ? error.message : 'The comparison pair could not start.');
        this.setAuthorError(error instanceof Error ? error.message : 'The comparison pair could not start.');
      }
    } finally {
      if (operation === this.comparisonGeneration) this.comparisonBusy.set(false);
    }
  }

  private async runComparisonSide(
    token: ComparisonSideToken,
    project: IProjectRef,
    definition: IQueryDef,
    plan: PublicSqlitePreparedPlan,
    operation: number,
  ): Promise<void> {
    try {
      const observation = await this.publicSqliteQuery.runComparisonSide(
        project,
        definition,
        plan,
        token.target.id,
        token.signal,
      );
      if (operation !== this.comparisonGeneration) return;
      this.comparisonSession.completeSide(token, observation);
    } catch (error) {
      if (operation === this.comparisonGeneration) {
        this.comparisonSession.failSide(
          token,
          error instanceof Error ? error.message : 'The fixture query failed.',
        );
      }
    } finally {
      if (operation === this.comparisonGeneration) {
        this.comparisonSnapshot.set(this.comparisonSession.snapshot());
        this.updateComparisonRunMessage(operation);
      }
    }
  }

  private updateComparisonRunMessage(operation: number): void {
    if (operation !== this.comparisonGeneration || this.comparisonResult()) return;
    const snapshot = this.comparisonSession.snapshot();
    if (!snapshot || snapshot.invalidated) return;

    const running = snapshot.sides.filter((side) => side.status === 'running');
    const queued = snapshot.sides.filter((side) => side.status === 'queued');
    const failed = snapshot.sides.filter((side) => side.status === 'failed');
    const cancelled = snapshot.sides.filter((side) => side.status === 'cancelled');
    const label = (side: (typeof snapshot.sides)[number]): string =>
      side.target.role === 'baseline' ? 'Baseline' : 'Candidate';
    if (running.length || queued.length) {
      const pending = [...running, ...queued].map(label);
      const finishedFailures = failed.map(label);
      const finishedCancellations = cancelled.map(label);
      const finished = [
        ...(finishedFailures.length ? [`${finishedFailures.join(' and ')} fixture quer${finishedFailures.length === 1 ? 'y failed' : 'ies failed'}`] : []),
        ...(finishedCancellations.length ? [`${finishedCancellations.join(' and ')} fixture quer${finishedCancellations.length === 1 ? 'y was' : 'ies were'} cancelled`] : []),
      ];
      this.comparisonMessage.set(
        `${finished.length ? `${finished.join('; ')}; ` : ''}${pending.join(' and ')} fixture ${pending.length === 1 ? 'query is' : 'queries are'} still running.`,
      );
      return;
    }
    if (failed.length) {
      this.comparisonMessage.set(
        `${failed.map(label).join(' and ')} fixture quer${failed.length === 1 ? 'y failed' : 'ies failed'}. Retry a failed side to continue.`,
      );
      return;
    }
    if (cancelled.length) {
      this.comparisonMessage.set(
        `${cancelled.map(label).join(' and ')} fixture quer${cancelled.length === 1 ? 'y was' : 'ies were'} cancelled. Retry a cancelled side to continue.`,
      );
      return;
    }
    if (snapshot.sides.every((side) => side.status === 'complete')) {
      this.comparisonMessage.set('Both fixture queries completed with complete bounded results.');
    }
  }

  public async retryComparisonSide(targetId: ComparisonFixtureTarget['id']): Promise<void> {
    const snapshot = this.comparisonSession.snapshot();
    const plan = this.comparisonPreparedPlan;
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (!snapshot || snapshot.invalidated || !plan || !project || !definition || this.comparisonBusy()) return;
    try {
      this.assertPublicComparisonScope(project);
    } catch (error) {
      this.invalidateComparison(error instanceof Error ? error.message : 'The public project scope changed.');
      return;
    }
    const inputKey = this.comparisonInputKey();
    this.comparisonBusy.set(true);
    this.comparisonMessage.set(`Retrying the ${targetId === 'chinook-baseline' ? 'Baseline' : 'Candidate'} query.`);
    const operation = this.comparisonGeneration;
    try {
      this.assertComparisonInputCurrent(inputKey);
      const token = this.comparisonSession.startSide(targetId);
      this.comparisonSnapshot.set(this.comparisonSession.snapshot());
      await this.runComparisonSide(token, project, definition, plan, operation);
    } finally {
      if (operation === this.comparisonGeneration) this.comparisonBusy.set(false);
    }
  }

  public cancelComparisonSide(targetId: ComparisonFixtureTarget['id']): void {
    this.comparisonSession.cancelSide(targetId);
    this.comparisonSnapshot.set(this.comparisonSession.snapshot());
    this.updateComparisonRunMessage(this.comparisonGeneration);
  }

  public async compareCompletedResults(): Promise<void> {
    const snapshot = this.comparisonSession.snapshot();
    const plan = this.comparisonPreparedPlan;
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (!snapshot || snapshot.invalidated || !plan || !project || !definition || this.comparisonBusy()) return;
    try {
      this.assertPublicComparisonScope(project);
    } catch (error) {
      this.invalidateComparison(error instanceof Error ? error.message : 'The public project scope changed.');
      return;
    }
    if (!snapshot.sides.every((side) => side.status === 'complete' && side.observation)) return;
    if (!this.comparisonWasmPin) {
      this.setAuthorError('The verified Core comparison asset is not configured for this build.');
      return;
    }
    const inputKey = this.comparisonInputKey();
    const operation = ++this.comparisonGeneration;
    const controller = new AbortController();
    this.comparisonAbort = controller;
    this.comparisonBusy.set(true);
    this.comparisonMessage.set('Checking current project metadata and the verified Core comparison module.');
    this.setAuthorError(undefined);
    try {
      // Explicit Compare re-reads the current catalog and schemas before Core sees either result.
      const livePreview = await this.publicSqliteQuery.prepareTugQL(
        project,
        definition,
        this.authorDraftRevision(),
        controller.signal,
        true,
      );
      this.assertComparisonInputCurrent(inputKey);
      const livePlan = this.preparedComparisonPlan(livePreview);
      if (JSON.stringify(livePlan) !== JSON.stringify(plan))
        throw new Error('The current catalog, schema, relationship, or query no longer matches both observations. Run both again.');
      const liveContext = await this.comparisonContext(livePlan, project);
      if (JSON.stringify(liveContext) !== JSON.stringify(snapshot.context))
        throw new Error('The draft, typed binding, project, or principal changed. Run both again.');
      const baseline = snapshot.sides.find((side) => side.target.role === 'baseline')?.observation;
      const candidate = snapshot.sides.find((side) => side.target.role === 'candidate')?.observation;
      if (!baseline || !candidate) throw new Error('Both fixture observations must be complete before Compare.');
      const result = await compareSessionObservations(
        baseline,
        candidate,
        snapshot.context,
        snapshot.generation,
        this.comparisonWasmPin,
        controller.signal,
      );
      this.assertComparisonInputCurrent(inputKey);
      if (operation !== this.comparisonGeneration || this.comparisonSession.snapshot()?.generation !== snapshot.generation)
        return;
      this.comparisonResult.set(result);
      this.comparisonMessage.set('Comparison finished from two complete bounded query observations.');
    } catch (error) {
      if (operation === this.comparisonGeneration) {
        this.comparisonMessage.set(error instanceof Error ? error.message : 'Core could not compare these complete results.');
        this.setAuthorError(error instanceof Error ? error.message : 'Core could not compare these complete results.');
      }
    } finally {
      if (this.comparisonAbort === controller) this.comparisonAbort = undefined;
      if (operation === this.comparisonGeneration) this.comparisonBusy.set(false);
    }
  }

  public hostedDemoDbSourceChanged(event: Event): void {
    const sourceId = (event as CustomEvent<{ value: string }>).detail.value;
    const definition = this.queryDef();
    if (
      this.queryState.saveSupported === false ||
      !definition ||
      !sourceId ||
      !isHostedDemoDbStarterQuery(definition)
    )
      return;
    const selected = withHostedDemoDbSource(definition, sourceId);
    this.queryState = {
      ...this.queryState,
      queryType: QueryType.DTQL,
      request: selected.request,
      federation: selected.federation,
    };
    this.queryEditorStateService.updateQueryState(this.queryState);
  }

  protected setOvdbToken(value: string | null | undefined): void {
    const nextToken = value ?? '';
    if (this.ovdbToken() === nextToken) return;
    this.ovdbToken.set(nextToken);
    this.ovdbCredentialGeneration.update((generation) => generation + 1);
    this.invalidateHistoryScope();
  }

  public queryTextChanged(event: Event, reportActivity = true): void {
    const isAuthorDraft = this.isTugqlAuthorJourney();
    // Local Author editing is independent of whether this rich query can be
    // serialized back to its current remote source. Save remains gated, but a
    // supported local draft must still update in Compose and Code.
    if (this.queryState.saveSupported === false && !isAuthorDraft && !this.project?.ref.spaceID) return;
    const text = (event as CustomEvent<{ value?: string }>).detail.value ?? '';
    if (
      !this.queryState.request ||
      this.queryState.request.queryType === QueryType.HTTP
    )
      return;
    const previousText = (this.queryState.request as ITextQueryRequest).text;
    if (isAuthorDraft && text !== previousText) {
      this.authorRunParameterAttempt.set(undefined);
      this.clearAuthorRowFilterStatus();
    }
    const sourceContextVisible = isAuthorDraft && text !== previousText &&
      (this.activeAuthorContextTab() === 'sources' ||
        this.activeAuthorContextTab() === 'related');
    if (reportActivity && text !== previousText)
      this.reportGitHubQueryEdit(this.project?.ref);
    this.queryState = {
      ...this.queryState,
      request: { ...this.queryState.request, text } as ITextQueryRequest,
    };
    if (isAuthorDraft) {
      this.clearPreviewDiagnosticNavigation();
      this.authorFormatUndo.set(undefined);
      this.authorRelationshipUndo.set(undefined);
      this.authorFormatNavigationSnapshot.set(undefined);
      this.authorFormatStatus.set('');
      this.invalidateAuthorDefinitionRun();
      ++this.authorLookupRequestRevision;
      this.queryDef.update((definition) =>
        definition
          ? {
              ...definition,
              request: { ...definition.request, text } as ITextQueryRequest,
            }
          : definition,
      );
      this.authorDraftRevision.update((revision) => revision + 1);
      if (sourceContextVisible) {
        ++this.authorSourceRequestGeneration;
        this.authorSourceLoading.set(false);
        this.authorSourceDiscovery.set(undefined);
        this.authorSourceMetadataSource = '';
        this.authorSourceMetadataIdentity = undefined;
        this.authorSourceReview.set(undefined);
        this.authorSourceReviewGeneration++;
        this.authorSourceReviewContext = undefined;
        this.authorSourceMessage.set(
          'The TugQL draft changed; source metadata is stale. Refresh to inspect this draft.',
        );
      }
      this.authorPlan.set(undefined);
      this.setAuthorError(undefined);
      this.invalidateComparison('The query draft changed; run both fixtures again.');
    }
    this.queryEditorStateService.updateQueryState(this.queryState);
  }

  public sqlTextChanged(text: string): void {
    this.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: text } }),
    );
  }

  public authorCodeChanged(text: string): void {
    this.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: text } }),
    );
  }

  public setAuthorMode(mode: 'compose' | 'code' | 'preview'): void {
    if (mode !== 'compose' && mode !== 'code' && mode !== 'preview') return;
    if (mode !== 'code') {
      this.authorFormatNavigationSnapshot.set(undefined);
      this.clearPreviewDiagnosticNavigation();
    }
    this.authorModeExplicit = true;
    this.authorMode.set(mode);
  }

  public authorContextTabChanged(value: unknown): void {
    if (value !== 'parameters' && value !== 'sources' && value !== 'related') return;
    const wasDiscovering = this.activeAuthorContextTab() === 'sources' || this.activeAuthorContextTab() === 'related';
    this.authorContextTab.set(value);
    const isDiscovering = value === 'sources' || value === 'related';
    if (wasDiscovering && !isDiscovering) this.authorSourcesToggled(false);
  }

  public authorResultSelectionChanged(
    event: SelectionChangedEvent<QueryResultGridRow>,
  ): void {
    if (!this.isTugqlAuthorJourney()) return;
    this.authorResultGridApi = event.api;
    const row = event.selectedNodes?.find((node) => node.isSelected())?.data;
    this.setAuthorResultRow(row);
  }

  public authorResultCellFocused(
    event: CellFocusedEvent<QueryResultGridRow>,
  ): void {
    if (!this.isTugqlAuthorJourney() || event.rowIndex === null) return;
    this.authorResultGridApi = event.api;
    const node = event.api.getDisplayedRowAtIndex(event.rowIndex);
    const row = node?.data;
    const snapshot = row && this.resultGridRowSnapshots.get(row);
    if (snapshot && snapshot.result === this.runResult() && snapshot.rows === this.visibleResultRows() &&
        snapshot.recordset === this.displayedRecordset() && snapshot.resultSetId === this.relatedResultSet() &&
        snapshot.resultPageIndex === this.resultPageIndex() && snapshot.resultGeneration === this.displayedResultGeneration())
      node?.setSelected?.(true, true);
    this.setAuthorResultRow(row);
  }

  public authorResultRowClicked(event: RowClickedEvent<QueryResultGridRow>): void {
    if (!this.isTugqlAuthorJourney()) return;
    this.authorResultGridApi = event.api;
    this.setAuthorResultRow(event.data);
  }

  private setAuthorResultRow(row: QueryResultGridRow | undefined): void {
    const previous = this.currentAuthorResultRow();
    this.selectedAuthorResultRow.set(
      row ? this.resultGridRowSnapshots.get(row) : undefined,
    );
    const inspected = this.currentAuthorResultRow();
    if (previous === inspected) return;
    this.authorResultGridApi?.forEachNode?.((node) => {
      const snapshot = node.data && this.resultGridRowSnapshots.get(node.data);
      if (node.data && (snapshot === previous || snapshot === inspected)) node.setData(node.data);
    });
    this.authorResultGridApi?.refreshCells?.({ columns: ['result_0'], force: true });
  }

  public authorSourcesToggled(open: boolean): void {
    if (open) void this.loadAuthorSources();
    else {
      ++this.authorSourceRequestGeneration;
      this.authorSourceLoading.set(false);
    }
  }

  private refreshAuthorSourcesIfVisible(): void {
    const tab = this.activeAuthorContextTab();
    if (tab === 'sources' || tab === 'related') this.authorSourcesToggled(true);
  }

  private currentAuthorSourceContext(): {
    readonly project: IProjectRef;
    readonly queryId: string;
    readonly draftRevision: number;
    readonly source: string;
    readonly scopeKey: string;
    readonly queryIdentity: symbol;
  } | undefined {
    const project = this.project?.ref;
    const definition = this.queryDef();
    const source = this.queryBodyText();
    if (!project || !definition || !source || !this.queryState.id || !this.isTugqlAuthorJourney())
      return undefined;
    const authorContext = this.currentAuthorFormatContext();
    if (!authorContext) return undefined;
    return {
      project,
      queryId: this.queryState.id,
      draftRevision: this.authorDraftRevision(),
      source,
      scopeKey: authorContext.scopeKey,
      queryIdentity: authorContext.queryIdentity,
    };
  }

  public authorSourceMetadata(): PublicSqliteSourceDiscovery | undefined {
    const context = this.currentAuthorSourceContext();
    const inventory = this.authorParticipatingSourceInventory();
    const mainSource = inventory.sources.find((source) => source.kind === 'main');
    const supportedSources = inventory.sources.every((source) =>
      (source.kind === 'main' && source.name.toLowerCase() === 'invoice' &&
        (source.schema === undefined || source.schema === 'main') && !source.database) ||
      (source.kind === 'join' && source.name.toLowerCase() === 'customer' && source.removable &&
        (source.schema === undefined || source.schema === 'main') && !source.database),
    );
    return context?.scopeKey === this.authorSourceScopeKey &&
      context.source === this.authorSourceMetadataSource &&
      context.queryIdentity === this.authorSourceMetadataIdentity &&
      inventory.available && mainSource?.name.toLowerCase() === 'invoice' &&
      (mainSource.schema === undefined || mainSource.schema === 'main') &&
      !mainSource.database && supportedSources
      ? this.authorSourceDiscovery()
      : undefined;
  }

  public authorCurrentLimit(): string {
    const source = this.queryBodyText();
    if (!source) return 'not recognized in this draft';
    const parsed = parseTugQL(source);
    if (parsed.diagnostics.length || !parsed.document.tree)
      return 'not recognized in this draft';
    const limit = parsed.document.tree.query['limit'];
    return typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0
      ? String(limit)
      : 'not recognized in this draft';
  }

  private isCurrentAuthorSourceContext(
    context: {
      readonly project: IProjectRef;
      readonly queryId: string;
      readonly draftRevision: number;
      readonly source: string;
      readonly scopeKey: string;
      readonly queryIdentity: symbol;
    } | undefined,
  ): boolean {
    const current = this.currentAuthorSourceContext();
    return !!context && !!current &&
      current.project.projectId === context.project.projectId &&
      current.queryId === context.queryId &&
      current.draftRevision === context.draftRevision &&
      current.source === context.source &&
      current.scopeKey === context.scopeKey &&
      current.queryIdentity === context.queryIdentity;
  }

  private async loadAuthorSources(): Promise<void> {
    const context = this.currentAuthorSourceContext();
    if (!context) {
      this.authorSourceMessage.set('Open a loaded Chinook Invoice draft to inspect its admitted sources.');
      return;
    }
    const inventory = this.authorParticipatingSourceInventory();
    const main = inventory.sources.find((source) => source.kind === 'main');
    const supportedSources = inventory.sources.every((source) =>
      (source.kind === 'main' && source.name.toLowerCase() === 'invoice' &&
        (source.schema === undefined || source.schema === 'main') && !source.database) ||
      (source.kind === 'join' && source.name.toLowerCase() === 'customer' && source.removable &&
        (source.schema === undefined || source.schema === 'main') && !source.database),
    );
    if (!inventory.available || main?.name.toLowerCase() !== 'invoice' ||
        (main.schema !== undefined && main.schema !== 'main') || main.database ||
        !supportedSources) {
      ++this.authorSourceRequestGeneration;
      this.authorSourceLoading.set(false);
      this.authorSourceDiscovery.set(undefined);
      this.authorSourceMetadataSource = '';
      this.authorSourceMetadataIdentity = undefined;
      this.authorSourceMessage.set(!inventory.available
        ? inventory.reason ?? 'Source metadata is unavailable until the TugQL draft parses.'
        : 'Source metadata is unavailable for this structure. This panel admits only main.Invoice and the declared Invoice–Customer relationship.');
      return;
    }
    const generation = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set('Checking the current project catalog, fields, and declared relationship…');
    this.authorSourceReview.set(undefined);
    this.authorSourceReviewContext = undefined;
    try {
      const discovery = await this.publicSqliteQuery.discoverInvoiceCustomerSources(context.project);
      if (generation !== this.authorSourceRequestGeneration || !this.isCurrentAuthorSourceContext(context)) return;
      this.authorSourceDiscovery.set(discovery);
      this.authorSourceScopeKey = context.scopeKey;
      this.authorSourceMetadataSource = context.source;
      this.authorSourceMetadataIdentity = context.queryIdentity;
      this.authorSourceMessage.set('');
    } catch (error) {
      if (generation !== this.authorSourceRequestGeneration || !this.isCurrentAuthorSourceContext(context)) return;
      this.authorSourceDiscovery.set(undefined);
      this.authorSourceMetadataSource = '';
      this.authorSourceMetadataIdentity = undefined;
      this.authorSourceMessage.set(error instanceof Error ? error.message : 'The current source metadata could not be admitted.');
    } finally {
      if (generation === this.authorSourceRequestGeneration) this.authorSourceLoading.set(false);
    }
  }

  public authorSourceFieldChanged(field: AuthorCustomerField, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement | null)?.checked === true;
    this.authorSourceFieldSelectionChanged(field, checked);
  }

  public authorSourceFieldSelectionChanged(field: AuthorCustomerField, checked: boolean): void {
    const fields = this.authorSourceSelectedFields();
    const next = checked
      ? [...fields.filter((item) => item !== field), field]
      : fields.filter((item) => item !== field);
    const order: readonly AuthorCustomerField[] = ['FirstName', 'LastName', 'Email'];
    this.authorSourceSelectedFields.set(order.filter((item) => next.includes(item)));
    this.invalidateComparison('The selected relationship projection changed.');
    this.buildAuthorSourceReview();
  }

  public reviewAuthorRelationship(): void {
    this.authorSourceSelectedFields.set(['FirstName']);
    this.buildAuthorSourceReview();
  }

  public async joinAuthorRelationship(): Promise<void> {
    if (this.authorSourceLoading() || !this.authorCanJoinRelationship()) return;
    const originalSource = this.queryBodyText();
    const originalDefinition = this.queryDef();
    if (!originalSource || !originalDefinition) return;
    const originalRelationshipBindings = originalDefinition.relationshipBindings;
    this.authorSourceSelectedFields.set([]);
    this.buildAuthorSourceReview();
    const review = this.authorSourceReview();
    if (!review || review.selectedFields.length !== 0) return;
    await this.applyAuthorRelationshipReview();
    const current = this.currentAuthorFormatContext();
    if (
      this.queryBodyText() === review.after &&
      current &&
      this.queryDef()?.relationshipBindings?.some(
        (binding) => binding.id === review.relationship.id &&
          binding.version === review.relationship.version,
      )
    ) {
      this.authorRelationshipUndo.set({
        action: 'join',
        originalSource,
        joinedSource: review.after,
        scopeKey: current.scopeKey,
        queryIdentity: current.queryIdentity,
        originalRelationshipBindings,
      });
    }
  }

  public requestAuthorCustomerJoinRemoval(): void {
    if (!this.authorCanRemoveCustomerJoin()) return;
    const context = this.currentAuthorSourceContext();
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    const binding = definition?.relationshipBindings?.find((candidate) =>
      candidate.id === discovery?.relationship.id &&
      candidate.version === discovery.relationship.version,
    );
    if (!context || !binding) return;
    const proposal = removeAuthorCustomerJoin(context.source, binding);
    if (!proposal.ok) {
      this.authorSourceMessage.set(proposal.reason);
      return;
    }
    this.pendingAuthorCustomerRemoval = {
      source: context.source,
      draftRevision: context.draftRevision,
      scopeKey: context.scopeKey,
      queryIdentity: context.queryIdentity,
      relationship: binding,
    };
    this.authorCustomerRemovalOutputs.set(proposal.removedOutputs);
    if (proposal.removedOutputs.length) {
      this.authorCustomerRemovalOpen.set(true);
      return;
    }
    void this.applyAuthorCustomerJoinRemoval();
  }

  public confirmAuthorCustomerJoinRemoval(confirmed: boolean): void {
    this.authorCustomerRemovalOpen.set(false);
    if (confirmed) void this.applyAuthorCustomerJoinRemoval();
    else {
      this.pendingAuthorCustomerRemoval = undefined;
      this.authorCustomerRemovalOutputs.set([]);
    }
  }

  private async applyAuthorCustomerJoinRemoval(): Promise<void> {
    const pending = this.pendingAuthorCustomerRemoval;
    const context = this.currentAuthorSourceContext();
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    if (!pending || !context || !definition || !discovery ||
        pending.source !== context.source ||
        pending.draftRevision !== context.draftRevision ||
        pending.scopeKey !== context.scopeKey ||
        pending.queryIdentity !== context.queryIdentity ||
        pending.relationship.id !== discovery.relationship.id ||
        pending.relationship.version !== discovery.relationship.version ||
        !this.isCurrentAuthorSourceContext(context)) {
      this.pendingAuthorCustomerRemoval = undefined;
      this.authorCustomerRemovalOutputs.set([]);
      this.authorSourceMessage.set('The source changed before removal. Reopen Sources and inspect the current draft.');
      return;
    }
    const generation = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set('Rechecking the admitted relationship before removing it…');
    try {
      const currentDiscovery = await this.publicSqliteQuery.discoverInvoiceCustomerSources(context.project);
      if (generation !== this.authorSourceRequestGeneration ||
          !this.isCurrentAuthorSourceContext(context) ||
          this.queryDef() !== definition ||
          currentDiscovery.schemaVersion !== discovery.schemaVersion ||
          JSON.stringify(currentDiscovery.relationship) !== JSON.stringify(pending.relationship)) {
        this.authorSourceMessage.set('The source metadata changed. No source was removed; inspect the current draft again.');
        return;
      }
      const proposal = removeAuthorCustomerJoin(context.source, pending.relationship);
      if (!proposal.ok ||
          JSON.stringify(proposal.removedOutputs) !== JSON.stringify(this.authorCustomerRemovalOutputs())) {
        this.authorSourceMessage.set(proposal.ok
          ? 'The Customer outputs changed before removal. No source was removed; inspect the current draft again.'
          : proposal.reason);
        return;
      }
      const updatedDefinition: IQueryDef = {
        ...definition,
        request: { ...definition.request, text: proposal.after } as ITextQueryRequest,
        relationshipBindings: (definition.relationshipBindings ?? []).filter((candidate) =>
          candidate.id !== pending.relationship.id || candidate.version !== pending.relationship.version,
        ),
      };
      const nextState: IQueryState = {
        ...this.queryState,
        def: updatedDefinition,
        request: updatedDefinition.request,
      };
      this.trackAuthorStructuralDraft(updatedDefinition);
      this.invalidateAuthorDefinitionRun();
      ++this.authorLookupRequestRevision;
      this.authorFormatUndo.set(undefined);
      this.authorPlan.set(undefined);
      this.setAuthorError(undefined);
      this.authorDraftRevision.update((revision) => revision + 1);
      this.queryState = nextState;
      this.queryDef.set(updatedDefinition);
      this.queryEditorStateService.updateQueryState(nextState);
      const current = this.currentAuthorFormatContext();
      if (current) this.authorRelationshipUndo.set({
        action: 'remove',
        originalSource: context.source,
        joinedSource: proposal.after,
        scopeKey: current.scopeKey,
        queryIdentity: current.queryIdentity,
        originalRelationshipBindings: definition.relationshipBindings,
      });
      this.authorSourceReview.set(undefined);
      this.authorSourceReviewGeneration++;
      this.authorSourceReviewContext = undefined;
      this.authorSourceMetadataSource = '';
      this.authorSourceMetadataIdentity = undefined;
      this.authorModeExplicit = true;
      this.authorMode.set('code');
      this.authorSourceMessage.set('Removed the Customer JOIN and its dependent outputs locally. Prior results are retained; Preview SQL and Run remain explicit.');
      this.refreshAuthorSourcesIfVisible();
    } catch (error) {
      this.authorSourceMessage.set(error instanceof Error ? error.message : 'The source could not be removed.');
    } finally {
      if (generation === this.authorSourceRequestGeneration) this.authorSourceLoading.set(false);
      this.pendingAuthorCustomerRemoval = undefined;
      this.authorCustomerRemovalOutputs.set([]);
    }
  }

  private buildAuthorSourceReview(): void {
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    if (!context || !discovery) {
      this.authorSourceReviewGeneration++;
      this.authorSourceMessage.set('Admit current source metadata before reviewing an edit.');
      return;
    }
    const result = reviewAuthorRelationshipSource(
      context.source,
      this.authorSourceSelectedFields(),
      discovery.relationship,
    );
    if (!result.ok) {
      this.authorSourceReviewGeneration++;
      this.authorSourceReview.set(undefined);
      this.authorSourceReviewContext = undefined;
      this.authorSourceMessage.set(result.reason);
      return;
    }
    const reviewGeneration = ++this.authorSourceReviewGeneration;
    this.authorSourceReview.set(result.review);
    this.authorSourceReviewContext = {
      scopeKey: context.scopeKey,
      queryIdentity: context.queryIdentity,
      source: context.source,
      draftRevision: context.draftRevision,
      selectedFields: Object.freeze([...this.authorSourceSelectedFields()]),
      reviewGeneration,
      schemaVersion: discovery.schemaVersion,
    };
    this.authorSourceMessage.set('Review the source and relationship binding before applying. No query has run.');
  }

  public async applyAuthorRelationshipReview(): Promise<void> {
    const review = this.authorSourceReview();
    const reviewed = this.authorSourceReviewContext;
    const reviewGeneration = this.authorSourceReviewGeneration;
    const selectedFields = Object.freeze([...this.authorSourceSelectedFields()]);
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    if (!review || !reviewed || !context || !discovery ||
        !this.isCurrentAuthorSourceContext(context) ||
        reviewed.scopeKey !== context.scopeKey ||
        reviewed.queryIdentity !== context.queryIdentity ||
        reviewed.source !== context.source ||
        reviewed.draftRevision !== context.draftRevision ||
        reviewed.reviewGeneration !== reviewGeneration ||
        JSON.stringify(reviewed.selectedFields) !== JSON.stringify(selectedFields) ||
        reviewed.schemaVersion !== discovery.schemaVersion) {
      this.authorSourceMessage.set('This review is stale. Reopen Sources and relationships, then review the edit again.');
      this.authorSourceReview.set(undefined);
      return;
    }
    const applyGeneration = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set('Rechecking source metadata before applying the reviewed draft…');
    try {
      const currentDiscovery = await this.publicSqliteQuery.discoverInvoiceCustomerSources(context.project);
      if (applyGeneration !== this.authorSourceRequestGeneration ||
          this.authorSourceReview() !== review ||
          this.authorSourceReviewGeneration !== reviewGeneration ||
          this.authorDraftRevision() !== reviewed.draftRevision ||
          JSON.stringify(this.authorSourceSelectedFields()) !== JSON.stringify(selectedFields) ||
          this.authorSourceReviewContext !== reviewed ||
          !this.isCurrentAuthorSourceContext(context) || currentDiscovery.schemaVersion !== reviewed.schemaVersion ||
          JSON.stringify(currentDiscovery.relationship) !== JSON.stringify(review.relationship)) {
        this.authorSourceReview.set(undefined);
        this.authorSourceMessage.set('The source metadata or relationship pin changed. Review the current source again.');
        return;
      }
      const definition = this.queryDef();
      if (!definition || definition.request.queryType !== QueryType.DTQL) return;
      const updatedDefinition: IQueryDef = {
        ...definition,
        request: { ...definition.request, text: review.after } as ITextQueryRequest,
        relationshipBindings: [review.relationship],
      };
      const nextState: IQueryState = {
        ...this.queryState,
        def: updatedDefinition,
        request: updatedDefinition.request,
      };
      this.trackAuthorStructuralDraft(updatedDefinition);
      this.invalidateAuthorDefinitionRun();
      ++this.authorLookupRequestRevision;
      this.authorFormatUndo.set(undefined);
      this.authorPlan.set(undefined);
      this.setAuthorError(undefined);
      this.authorDraftRevision.update((revision) => revision + 1);
      this.queryState = nextState;
      this.queryDef.set(updatedDefinition);
      this.queryEditorStateService.updateQueryState(nextState);
      this.refreshAuthorSourcesIfVisible();
      this.authorSourceReview.set(undefined);
      this.authorSourceReviewGeneration++;
      this.authorSourceReviewContext = undefined;
      this.authorModeExplicit = true;
      this.authorMode.set('code');
      this.authorFormatStatus.set(
        selectedFields.length
          ? `Applied the admitted join with ${selectedFields.join(', ')} outputs. The prior result is retained; Preview SQL before Run.`
          : 'Applied the admitted join with no added output columns. The prior result is retained; Preview SQL before Run.',
      );
    } catch (error) {
      this.authorSourceMessage.set(error instanceof Error ? error.message : 'The reviewed source edit could not be applied.');
    } finally {
      if (applyGeneration === this.authorSourceRequestGeneration)
        this.authorSourceLoading.set(false);
    }
  }

  private currentAuthorFormatContext():
    | { readonly scopeKey: string; readonly queryIdentity: symbol }
    | undefined {
    const definition = this.queryDef();
    if (
      !definition ||
      definition.connectionId !== 'chinook-sqlite' ||
      definition.request.queryType !== QueryType.DTQL ||
      this.queryBodyText() === undefined
    )
      return undefined;
    return {
      scopeKey: JSON.stringify({
        queryId: this.queryState.id,
        definitionId: definition.id,
        project: this.project?.ref,
        environment: this.queryState.activeEnv?.id ?? this.envId,
        securityContextId: this.agentContext.securityContextId(),
      }),
      queryIdentity: this.currentQueryIdentity(),
    };
  }

  private canFormatAuthorTugQL(): boolean {
    return (
      !!this.currentAuthorFormatContext() &&
      this.authorMode() === 'code' &&
      !this.running() &&
      !this.queryState.isSaving
    );
  }

  private isCurrentAuthorFormatDiagnosticSnapshot(
    snapshot: AuthorFormatDiagnosticSnapshot | undefined,
  ): snapshot is AuthorFormatDiagnosticSnapshot {
    if (
      !snapshot ||
      this.queryView() !== 'author' ||
      this.authorMode() !== 'code' ||
      !this.isTugqlAuthorJourney() ||
      this.running() ||
      this.queryState.isSaving ||
      this.queryBodyText() !== snapshot.source ||
      this.authorDraftRevision() !== snapshot.draftRevision ||
      this.queryDef() !== snapshot.definition
    )
      return false;
    const current = this.currentAuthorFormatContext();
    return !!current &&
      current.scopeKey === snapshot.scopeKey &&
      current.queryIdentity === snapshot.queryIdentity;
  }

  public navigateToAuthorFormatDiagnostic(diagnostic: TugQLDiagnostic): void {
    const snapshot = this.authorFormatNavigationSnapshot();
    if (
      !this.isCurrentAuthorFormatDiagnosticSnapshot(snapshot) ||
      !snapshot.diagnostics.includes(diagnostic)
    )
      return;
    this.authorCodeEditor?.navigateToFormatDiagnostic(snapshot.source, diagnostic);
  }

  public authorPreviewSyntaxDiagnostic(): TugQLDiagnostic | undefined {
    const snapshot = this.previewDiagnosticNavigationSnapshot();
    return this.isCurrentAuthorPreviewDiagnosticSnapshot(snapshot)
      ? snapshot.diagnostic
      : undefined;
  }

  public canNavigateToAuthorPreviewSyntaxDiagnostic(): boolean {
    const snapshot = this.previewDiagnosticNavigationSnapshot();
    if (!this.isCurrentAuthorPreviewDiagnosticSnapshot(snapshot)) return false;
    if (this.authorMode() !== 'code') return true;
    return !!this.authorCodeEditor?.isFormatDiagnosticNavigable(
      snapshot.source,
      snapshot.diagnostic.span,
    );
  }

  public navigateToAuthorPreviewSyntaxDiagnostic(): void {
    const snapshot = this.previewDiagnosticNavigationSnapshot();
    if (
      !this.isCurrentAuthorPreviewDiagnosticSnapshot(snapshot) ||
      !this.canNavigateToAuthorPreviewSyntaxDiagnostic()
    )
      return;

    if (this.authorMode() !== 'code') {
      const generation = ++this.previewDiagnosticNavigationGeneration;
      this.pendingPreviewDiagnosticNavigation = { generation, snapshot };
      this.authorModeExplicit = true;
      this.authorMode.set('code');
      this.changeDetector.markForCheck();
      afterNextRender(
        () => this.consumePendingPreviewDiagnosticNavigation(generation),
        { injector: this.injector },
      );
      return;
    }

    const navigated = this.authorCodeEditor?.navigateToFormatDiagnostic(
      snapshot.source,
      snapshot.diagnostic,
    );
    if (navigated) this.clearPreviewDiagnosticNavigation();
  }

  private consumePendingPreviewDiagnosticNavigation(generation: number): void {
    const pending = this.pendingPreviewDiagnosticNavigation;
    if (!pending || pending.generation !== generation) return;
    this.pendingPreviewDiagnosticNavigation = undefined;

    const editor = this.authorCodeEditor;
    if (
      !this.isCurrentAuthorPreviewDiagnosticSnapshot(pending.snapshot) ||
      this.authorMode() !== 'code' ||
      !editor?.isFormatDiagnosticNavigable(
        pending.snapshot.source,
        pending.snapshot.diagnostic.span,
      )
    ) {
      this.clearPreviewDiagnosticNavigation();
      return;
    }

    editor.navigateToFormatDiagnostic(
      pending.snapshot.source,
      pending.snapshot.diagnostic,
    );
    this.clearPreviewDiagnosticNavigation();
  }

  private clearPreviewDiagnosticNavigation(): void {
    this.previewDiagnosticNavigationGeneration++;
    this.pendingPreviewDiagnosticNavigation = undefined;
    this.previewDiagnosticNavigationSnapshot.set(undefined);
  }

  private isCurrentAuthorPreviewDiagnosticSnapshot(
    snapshot: AuthorPreviewDiagnosticSnapshot | undefined,
  ): snapshot is AuthorPreviewDiagnosticSnapshot {
    if (
      !snapshot ||
      this.queryView() !== 'author' ||
      !this.isTugqlAuthorJourney() ||
      this.authorErrorRevision !== snapshot.errorRevision ||
      this.authorError() === undefined ||
      this.running() ||
      this.queryState.isSaving ||
      this.queryId !== snapshot.queryId ||
      this.historyScope() !== snapshot.historyScope ||
      this.authorPreviewLifetime !== snapshot.lifetime ||
      this.queryBodyText() !== snapshot.source ||
      this.authorDraftRevision() !== snapshot.draftRevision ||
      this.queryDef() !== snapshot.definition ||
      !sourceSpanIsValid(snapshot.source, snapshot.diagnostic.span) ||
      isNoTargetFormatDiagnostic(snapshot.diagnostic)
    )
      return false;
    const current = this.currentAuthorFormatContext();
    return !!current &&
      current.scopeKey === snapshot.scopeKey &&
      current.queryIdentity === snapshot.queryIdentity;
  }

  public formatAuthorTugQL(): void {
    if (!this.canFormatAuthorTugQL()) return;
    this.authorFormatNavigationSnapshot.set(undefined);
    this.clearPreviewDiagnosticNavigation();
    const source = this.queryBodyText();
    if (source === undefined) return;
    const options: TugQLFormatOptions = {
      keywordCase: 'preserve-existing',
      indentation: 'preserve-existing',
      defaultKeywordCase: 'lowercase',
      defaultIndentation: 'two-spaces',
    };
    const formatted = formatTugQL(source, options);
    if (formatted.diagnostics.length) {
      this.authorFormatStatus.set(
        `TugQL was not changed: ${formatted.diagnostics
          .map((item) => item.message)
          .filter(
            (message, index, messages) => messages.indexOf(message) === index,
          )
          .join(' ')}`,
      );
      const parsed = parseTugQL(source);
      const isSourceSpanValid = createSourceSpanValidator(source);
      const positioned: TugQLDiagnostic[] = [];
      let remainingCount = 0;
      for (const diagnostic of parsed.diagnostics) {
        if (
          isNoTargetFormatDiagnostic(diagnostic) ||
          !isSourceSpanValid(diagnostic.span)
        )
          continue;
        if (positioned.length < 5) positioned.push(diagnostic);
        else remainingCount++;
      }
      const current = this.currentAuthorFormatContext();
      const definition = this.queryDef();
      if (current && definition && positioned.length) {
        const diagnostics = cloneAndFreeze(positioned);
        this.authorFormatNavigationSnapshot.set({
          definition,
          source,
          draftRevision: this.authorDraftRevision(),
          scopeKey: current.scopeKey,
          queryIdentity: current.queryIdentity,
          diagnostics,
          remainingCount,
        });
      }
      return;
    }
    if (formatted.source === source) {
      this.authorFormatStatus.set('TugQL is already formatted.');
      return;
    }

    this.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: formatted.source } }),
      false,
    );
    const current = this.currentAuthorFormatContext();
    if (!current) return;
    this.authorFormatUndo.set({
      action: 'format',
      originalSource: source,
      formattedSource: formatted.source,
      scopeKey: current.scopeKey,
      queryIdentity: current.queryIdentity,
    });
    this.authorFormatStatus.set('TugQL formatted.');
  }

  public undoAuthorTugQLFormat(): void {
    const relationshipUndo = this.authorRelationshipUndo();
    if (
      relationshipUndo &&
      this.canUndoAuthorRelationship(relationshipUndo)
    ) {
      const definition = this.queryDef();
      if (!definition || definition.request.queryType !== QueryType.DTQL) return;
      const updatedDefinition: IQueryDef = {
        ...definition,
        request: {
          ...definition.request,
          text: relationshipUndo.originalSource,
        } as ITextQueryRequest,
        relationshipBindings: relationshipUndo.originalRelationshipBindings,
      };
      const nextState: IQueryState = {
        ...this.queryState,
        def: updatedDefinition,
        request: updatedDefinition.request,
      };
      this.trackAuthorStructuralDraft(updatedDefinition);
      this.authorRelationshipUndo.set(undefined);
      this.authorFormatUndo.set(undefined);
      this.clearPreviewDiagnosticNavigation();
      this.authorFormatNavigationSnapshot.set(undefined);
      this.authorFormatStatus.set(relationshipUndo.action === 'remove' ? 'Source removal undone.' : 'Join undone.');
      this.invalidateAuthorDefinitionRun();
      ++this.authorLookupRequestRevision;
      this.authorPlan.set(undefined);
      this.setAuthorError(undefined);
      this.authorDraftRevision.update((revision) => revision + 1);
      this.queryState = nextState;
      this.queryDef.set(updatedDefinition);
      this.queryEditorStateService.updateQueryState(nextState);
      this.refreshAuthorSourcesIfVisible();
      this.authorSourceReview.set(undefined);
      this.authorSourceReviewGeneration++;
      this.authorSourceReviewContext = undefined;
      this.authorSourceMessage.set(relationshipUndo.action === 'remove'
        ? 'Undid the local source removal and restored the relationship binding. The prior result is retained.'
        : 'Undid the local join and restored the original relationship bindings. The prior result is retained.');
      return;
    }
    const undo = this.authorFormatUndo();
    if (!undo || !this.canFormatAuthorTugQL()) return;
    const current = this.currentAuthorFormatContext();
    if (
      !current ||
      current.scopeKey !== undo.scopeKey ||
      current.queryIdentity !== undo.queryIdentity ||
      this.queryBodyText() !== undo.formattedSource
    ) {
      this.authorFormatUndo.set(undefined);
      this.authorFormatStatus.set(
        'Undo format is no longer available because this draft or query context changed.',
      );
      return;
    }
    this.authorFormatUndo.set(undefined);
    this.queryTextChanged(
      new CustomEvent('ionInput', {
        detail: { value: undo.originalSource },
      }),
      false,
    );
    this.authorFormatStatus.set(undo.action === 'filter' ? 'InvoiceId filter undone.' : 'Formatting undone.');
  }

  private canUndoAuthorRelationship(
    undo: AuthorRelationshipUndo,
  ): boolean {
    const current = this.currentAuthorFormatContext();
    return !!current &&
      this.authorMode() === 'code' &&
      !this.running() &&
      !this.queryState.isSaving &&
      current.scopeKey === undo.scopeKey &&
      current.queryIdentity === undo.queryIdentity &&
      this.queryBodyText() === undo.joinedSource;
  }

  private syncAuthorMode(definition?: IQueryDef, resolveDefault = false): void {
    const nextScopeKey = JSON.stringify({
      queryId: this.queryState.id,
      project: this.project?.ref,
      environment: this.queryState.activeEnv?.id ?? this.envId,
      securityContextId: this.agentContext.securityContextId(),
    });
    const nextContextKey = JSON.stringify({
      project: this.project?.ref,
      environment: this.queryState.activeEnv?.id ?? this.envId,
      securityContextId: this.agentContext.securityContextId(),
    });
    if (nextContextKey !== this.authorModeContextKey) {
      ++this.authorLookupRequestRevision;
      this.authorModeContextKey = nextContextKey;
    }
    if (nextScopeKey !== this.authorModeScopeKey) {
      this.authorFormatUndo.set(undefined);
      this.authorFormatNavigationSnapshot.set(undefined);
      this.authorFormatStatus.set('');
      ++this.authorLookupFocusRevision;
      this.authorModeScopeKey = nextScopeKey;
      this.authorModeDefaultResolved = false;
      this.authorModeExplicit = false;
      // A target change starts in the conservative editor until its definition
      // has arrived and the visual profile can be checked.
      this.authorMode.set('code');
    }
    if (
      resolveDefault &&
      definition &&
      !this.authorModeDefaultResolved &&
      !this.authorModeExplicit
    ) {
      const request = definition.request;
      this.authorMode.set(
        definition.connectionId === 'chinook-sqlite' &&
          request?.queryType === QueryType.DTQL &&
          readAuthorComposeProfile(
            (request as ITextQueryRequest).text ?? '',
          ).supported
          ? 'compose'
          : 'code',
      );
      this.authorModeDefaultResolved = true;
    }
  }

  public authorComposeTextChanged(text: string): void {
    this.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: text } }),
    );
  }

  public cancelAuthorRun(): void {
    this.authorRunAbort?.abort();
  }

  private invalidateAuthorDefinitionRun(): void {
    ++this.authorPreviewLifetime;
    this.authorPreviewLoading.set(false);
    this.clearPreviewDiagnosticNavigation();
    ++this.semanticRunLifetime;
    this.invalidateFederatedRun();
    this.invalidateHistoryRequests();
    this.stopFederatedRun();
  }

  public authorCustomerIdChanged(event: Event): void {
    const detail = (event as CustomEvent<{ value?: string }>).detail;
    const target = event.target as HTMLInputElement | null;
    const value = detail?.value ?? target?.value ?? '';
    const previousOrigin = this.authorCustomerIdOrigin();
    const originChanged =
      previousOrigin.origin !== 'manual' ||
      previousOrigin.originEvidence !== 'client-reported' ||
      previousOrigin.sourceQueryId !== undefined ||
      previousOrigin.sourceColumn !== undefined;
    if (value !== this.authorCustomerId() || originChanged) {
      this.authorRunParameterAttempt.set(undefined);
      this.authorBindingRevision.update((revision) => revision + 1);
      ++this.authorLookupRequestRevision;
      this.invalidateComparison('The CustomerId binding changed; run both fixtures again.');
    }
    this.authorCustomerId.set(value);
    const next: IQueryState = {
      ...this.queryState,
      authorBindings: {
        ...(this.queryState.authorBindings ?? {}),
        CustomerId: value,
      },
      authorBindingProvenance: {
        ...(this.queryState.authorBindingProvenance ?? {}),
        CustomerId: {
          origin: 'manual',
          originEvidence: 'client-reported',
        },
      },
    };
    this.queryState = next;
    this.queryEditorStateService.updateQueryState(next);
  }

  private async openAuthorCustomerLookup(
    columnIndex: number,
    columnName: string,
    rowIndex: number,
    expectedExecutionId: string,
    expectedCustomerId: string,
    expectedQueryIdentity: symbol,
  ): Promise<void> {
    const lookupRequestRevision = ++this.authorLookupRequestRevision;
    ++this.authorLookupFocusRevision;
    const result = this.runResult();
    const receipt = result?.publicSqliteReceipt;
    if (
      !result ||
      receipt?.executionId !== expectedExecutionId ||
      this.currentQueryIdentity() !== expectedQueryIdentity
    ) {
      return;
    }
    const row = this.visibleResultRows()[rowIndex];
    const isCurrent =
      !!result &&
      this.relatedResultSet() === 'affiliations' &&
      !this.selectedHistoricalResult() &&
      !this.displayedResultIsPreviousRun() &&
      !this.publicSqliteRunIsStale(result);
    const customerId = customerIdLookupValue(
      receipt,
      columnIndex,
      columnName,
      row?.[columnIndex],
      isCurrent,
    );
    const projectRef = this.project?.ref;
    if (
      !customerId ||
      customerId !== expectedCustomerId ||
      !projectRef ||
      !this.queryId
    ) {
      return;
    }

    const sourceQueryId = this.queryId;
    const activeEnvironment =
      this.queryState.activeEnv?.id ?? this.envId;
    const sourceProjectRef = projectRef;
    const sourceEnvironment = activeEnvironment;
    const sourceDefinition = this.queryDef();
    const sourceSecurityContextId = this.agentContext.securityContextId();
    const sourceDraftRevision = this.authorDraftRevision();
    const sourceBindingRevision = this.authorBindingRevision();
    const requestIsCurrent = (): boolean =>
      this.authorLookupRequestRevision === lookupRequestRevision &&
      equalProjectRef(this.project?.ref, sourceProjectRef) &&
      this.queryId === sourceQueryId &&
      this.queryDef() === sourceDefinition &&
      (this.queryState.activeEnv?.id ?? this.envId) === sourceEnvironment &&
      this.agentContext.securityContextId() === sourceSecurityContextId &&
      this.authorDraftRevision() === sourceDraftRevision &&
      this.authorBindingRevision() === sourceBindingRevision &&
      this.runResult() === result &&
      this.runResult()?.publicSqliteReceipt?.executionId ===
        expectedExecutionId &&
      this.currentQueryIdentity() === expectedQueryIdentity;
    let lookupDefinition: IQueryDef;
    let lookupRevision:
      | {
          revision: string;
          branchHead?: string;
          saveSupported?: boolean;
          unsupportedSaveReason?: string;
        }
      | undefined;
    try {
      if (sourceProjectRef.projectApi) {
        const loaded = await firstValueFrom(
          this.queriesService.getRevision(
            sourceProjectRef,
            CUSTOMER_INVOICE_LOOKUP_QUERY_ID,
          ),
        );
        lookupDefinition = fromProjectQueryWire(loaded.query);
        lookupRevision = loaded;
      } else {
        lookupDefinition = await firstValueFrom(
          this.queriesService.getQuery(
            sourceProjectRef,
            CUSTOMER_INVOICE_LOOKUP_QUERY_ID,
          ),
        );
      }
    } catch {
      // A cloud 401/403 is also delivered through QueriesService's authority
      // invalidation stream. Never restore cached private data in that case.
      if (requestIsCurrent()) {
        this.setAuthorError(
          'The invoice lookup could not be opened. Your current results are still available.',
        );
      }
      return;
    }
    if (!requestIsCurrent()) return;
    const pendingNavigation: PendingAuthorLookupNavigation = {
      targetId: CUSTOMER_INVOICE_LOOKUP_QUERY_ID,
      requestRevision: lookupRequestRevision,
      projectRef: sourceProjectRef,
      environment: sourceEnvironment,
      securityContextId: sourceSecurityContextId,
      routeObserved: false,
      routeSuperseded: false,
    };
    this.pendingAuthorLookupNavigation = pendingNavigation;
    let navigated = false;
    try {
      navigated = await this.router.navigate([], {
        relativeTo: this.route,
        info: pendingNavigation,
        queryParams: {
          id: CUSTOMER_INVOICE_LOOKUP_QUERY_ID,
          editor: 'text',
          ...(activeEnvironment ? { env: activeEnvironment } : {}),
        },
        queryParamsHandling: 'merge',
      });
    } catch (error: unknown) {
      this.errorLogger.logError(
        error,
        'Failed to open the Customer invoice lookup query',
      );
      if (this.pendingAuthorLookupNavigation === pendingNavigation)
        this.pendingAuthorLookupNavigation = undefined;
      await this.restoreSourceRouteIfLookupIsStillCurrent(
        pendingNavigation,
        sourceQueryId,
        activeEnvironment,
      );
      if (requestIsCurrent())
        this.setAuthorError(
          'The invoice lookup could not be opened. Your current results are still available.',
        );
      return;
    }
    if (this.pendingAuthorLookupNavigation === pendingNavigation)
      this.pendingAuthorLookupNavigation = undefined;
    pendingNavigation.navigationSucceeded = navigated;
    if (!navigated) {
      await this.restoreSourceRouteIfLookupIsStillCurrent(
        pendingNavigation,
        sourceQueryId,
        activeEnvironment,
      );
      if (requestIsCurrent())
        this.setAuthorError(
          'The invoice lookup could not be opened. Your current results are still available.',
        );
      return;
    }

    // The route transition changes the current query as part of Angular's
    // query-param subscription. Recheck the original action and context after
    // that asynchronous boundary before publishing the selected binding.
    if (
      !requestIsCurrent() ||
      !this.isLatestAuthorLookupNavigation(pendingNavigation)
    ) {
      await this.restoreSourceRouteIfLookupIsStillCurrent(
        pendingNavigation,
        sourceQueryId,
        activeEnvironment,
      );
      return;
    }

    this.authorMode.set('compose');
    this.authorPlan.set(undefined);
    this.setAuthorError(undefined);
    let lookup: IQueryState;
    try {
      lookup = this.queryEditorStateService.openAuthorizedQuery(
        CUSTOMER_INVOICE_LOOKUP_QUERY_ID,
        lookupDefinition,
        sourceProjectRef,
        lookupRevision,
      );
    } catch {
      // The source draft/result was deliberately kept intact until navigation
      // succeeded. If opening its preflighted target still fails synchronously,
      // restore the source URL without asking the state service to reload it.
      if (requestIsCurrent()) {
        await this.restoreSourceRouteIfLookupIsStillCurrent(
          pendingNavigation,
          sourceQueryId,
          activeEnvironment,
        );
      }
      if (requestIsCurrent())
        this.setAuthorError(
          'The invoice lookup could not be opened. Your current results are still available.',
        );
      return;
    }
    this.authorBindingRevision.update((revision) => revision + 1);
    this.queryEditorStateService.updateQueryState({
      ...lookup,
      authorBindings: {
        ...(lookup.authorBindings ?? {}),
        CustomerId: customerId,
      },
      authorBindingProvenance: {
        ...(lookup.authorBindingProvenance ?? {}),
        CustomerId: {
          origin: 'selection',
          originEvidence: 'client-reported',
          sourceQueryId,
          sourceColumn: columnName,
        },
      },
    });
    this.authorWorkspaceLayout?.scrollToEditor();
    this.focusAuthorLookupAfterRender();
  }

  private focusAuthorLookupAfterRender(): void {
    const focusRevision = ++this.authorLookupFocusRevision;
    const expectedDraftRevision = this.authorDraftRevision();
    const expectedBindingRevision = this.authorBindingRevision();
    const expectedProject = JSON.stringify(this.project?.ref);
    const expectedEnvironment = this.queryState.activeEnv?.id;
    const expectedSecurityContext = this.agentContext.securityContextId();
    const canFocus = (): boolean =>
      focusRevision === this.authorLookupFocusRevision &&
      expectedDraftRevision === this.authorDraftRevision() &&
      expectedBindingRevision === this.authorBindingRevision() &&
      this.queryId === CUSTOMER_INVOICE_LOOKUP_QUERY_ID &&
      JSON.stringify(this.project?.ref) === expectedProject &&
      this.queryState.activeEnv?.id === expectedEnvironment &&
      this.agentContext.securityContextId() === expectedSecurityContext;

    this.changeDetector.markForCheck();
    afterNextRender(
      () => {
        if (!canFocus()) return;
        this.authorLookupHeading?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  private isLatestAuthorLookupNavigation(
    pendingNavigation: PendingAuthorLookupNavigation,
  ): boolean {
    const latest = this.router.lastSuccessfulNavigation?.();
    const inFlight = this.router.currentNavigation?.();
    return (
      pendingNavigation.routeObserved &&
      !pendingNavigation.routeSuperseded &&
      !!latest &&
      pendingNavigation.observedNavigationId !== undefined &&
      latest.id === pendingNavigation.observedNavigationId &&
      latest.extras.info === pendingNavigation &&
      (!inFlight || inFlight.id === pendingNavigation.observedNavigationId)
    );
  }

  private async restoreSourceRouteIfLookupIsStillCurrent(
    pendingNavigation: PendingAuthorLookupNavigation,
    sourceQueryId: string,
    environment?: string,
  ): Promise<void> {
    const routedId = this.route.snapshot.queryParamMap.get('id');
    const latest = this.router.lastSuccessfulNavigation?.();
    const inFlight = this.router.currentNavigation?.();
    const newerNavigationStarted =
      (!!inFlight && inFlight.id !== pendingNavigation.observedNavigationId) ||
      (!!latest &&
        pendingNavigation.observedNavigationId !== undefined &&
        latest.id > pendingNavigation.observedNavigationId &&
        latest.extras.info !== pendingNavigation);
    if (
      !pendingNavigation.routeObserved ||
      pendingNavigation.routeSuperseded ||
      newerNavigationStarted ||
      this.pendingAuthorLookupNavigation ||
      routedId !== pendingNavigation.targetId
    ) {
      return;
    }
    const routeStillOwned = this.isLatestAuthorLookupNavigation(pendingNavigation);
    const sameScope =
      equalProjectRef(this.project?.ref, pendingNavigation.projectRef) &&
      (this.queryState.activeEnv?.id ?? this.envId) ===
        pendingNavigation.environment &&
      this.agentContext.securityContextId() ===
        pendingNavigation.securityContextId;
    if (!sameScope) {
      // The route is still the actual user-visible destination, but its
      // original source-scope request is stale. Reconcile a successful route
      // through the normal authorized loader without applying the old selected
      // binding. Never restore an old source route or load a failed target in a
      // different security context.
      if (routeStillOwned && this.queryId !== routedId)
        this.queryEditorStateService.openQuery(routedId);
      return;
    }
    if (this.queryId !== sourceQueryId) return;
    const projectRef = this.project?.ref;
    if (!projectRef) return;
    const restore: PendingAuthorLookupNavigation = {
      targetId: sourceQueryId,
      requestRevision: this.authorLookupRequestRevision,
      projectRef,
      environment: this.queryState.activeEnv?.id ?? this.envId,
      securityContextId: this.agentContext.securityContextId(),
      routeObserved: false,
      routeSuperseded: false,
    };
    this.pendingAuthorLookupNavigation = restore;
    let restored = false;
    try {
      restored = await this.router.navigate([], {
        relativeTo: this.route,
        info: restore,
        queryParams: {
          id: sourceQueryId,
          editor: 'text',
          ...(environment ? { env: environment } : {}),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch (error: unknown) {
      this.errorLogger.logError(
        error,
        'Failed to restore the source query after lookup navigation',
      );
    } finally {
      if (this.pendingAuthorLookupNavigation === restore)
        this.pendingAuthorLookupNavigation = undefined;
    }
    const latestAfterRestore = this.router.lastSuccessfulNavigation?.();
    const inFlightAfterRestore = this.router.currentNavigation?.();
    const newerNavigationAfterRestore =
      (!!inFlightAfterRestore &&
        inFlightAfterRestore.id !== restore.observedNavigationId) ||
      (!!latestAfterRestore &&
        restore.observedNavigationId !== undefined &&
        latestAfterRestore.id > restore.observedNavigationId &&
        latestAfterRestore.extras.info !== restore);
    if (
      !restore.routeSuperseded &&
      !newerNavigationAfterRestore &&
      !this.pendingAuthorLookupNavigation &&
      this.authorLookupRequestRevision === restore.requestRevision &&
      equalProjectRef(this.project?.ref, restore.projectRef) &&
      (this.queryState.activeEnv?.id ?? this.envId) === restore.environment &&
      this.agentContext.securityContextId() === restore.securityContextId &&
      pendingNavigation.routeObserved &&
      !restored &&
      this.route.snapshot.queryParamMap.get('id') === routedId &&
      this.queryId === sourceQueryId
    ) {
      // A canceled or rejected rollback left the destination URL active. Load
      // that still-owned route through the authorized state service so
      // the page cannot show the source query beneath a destination URL.
      this.queryEditorStateService.openQuery(routedId);
    }
  }

  public async previewTugql(): Promise<void> {
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (!project || !definition || !this.isTugqlAuthorJourney()) return;
    const revision = this.authorDraftRevision();
    const definitionSnapshot = JSON.stringify(definition);
    const scopeSnapshot = this.historyScope();
    const queryIdSnapshot = this.queryId;
    const projectSnapshot = JSON.stringify(project);
    const securityContextIdSnapshot = this.agentContext.securityContextId();
    const authorContextSnapshot = this.currentAuthorFormatContext();
    const lifetime = ++this.authorPreviewLifetime;
    this.clearPreviewDiagnosticNavigation();
    this.authorFormatNavigationSnapshot.set(undefined);
    const isCurrent = (): boolean =>
      lifetime === this.authorPreviewLifetime &&
      this.isTugqlAuthorJourney() &&
      this.authorDraftRevision() === revision &&
      this.historyScope() === scopeSnapshot &&
      this.queryId === queryIdSnapshot &&
      this.queryDef() === definition &&
      JSON.stringify(this.queryDef()) === definitionSnapshot &&
      JSON.stringify(this.project?.ref) === projectSnapshot &&
      this.agentContext.securityContextId() === securityContextIdSnapshot &&
      !!authorContextSnapshot &&
      this.currentAuthorFormatContext()?.scopeKey ===
        authorContextSnapshot.scopeKey &&
      this.currentAuthorFormatContext()?.queryIdentity ===
        authorContextSnapshot.queryIdentity;
    this.authorPlan.set(undefined);
    this.authorPreviewLoading.set(true);
    this.setAuthorError(undefined);
    try {
      const source = (definition.request as ISqlQueryRequest).text;
      if (
        definition.request.queryType === QueryType.DTQL &&
        definition.connectionId === 'chinook-sqlite' &&
        !definition.federation
      ) {
        const parsed = parseTugQL(source);
        if (parsed.diagnostics.length) {
          if (!isCurrent()) return;
          this.setAuthorError(
            parsed.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
          );
          const diagnostic = parsed.diagnostics.find(
            (candidate) =>
              !isNoTargetFormatDiagnostic(candidate) &&
              sourceSpanIsValid(source, candidate.span),
          );
          const context = authorContextSnapshot;
          if (diagnostic && context) {
            this.previewDiagnosticNavigationSnapshot.set({
              definition,
              source,
              draftRevision: revision,
              scopeKey: context.scopeKey,
              queryIdentity: context.queryIdentity,
              queryId: queryIdSnapshot,
              historyScope: scopeSnapshot,
              lifetime,
              errorRevision: this.authorErrorRevision,
              diagnostic,
            });
          }
          return;
        }
      }
      const plan = await this.publicSqliteQuery.prepareTugQL(
        project,
        definition,
        revision,
      );
      if (isCurrent()) {
        if (plan.expandedSource !== undefined) {
          if (
            plan.expandedSource ===
            (definition.request as ISqlQueryRequest).text
          ) {
            this.setAuthorError(
              'The relationship completion did not change the draft. Review the JOIN in Code.',
            );
            return;
          }
          this.authorMode.set('code');
          this.queryTextChanged(
            new CustomEvent('ionInput', {
              detail: { value: plan.expandedSource },
            }),
          );
          if (this.queryDef()?.request.queryType !== QueryType.DTQL) return;
          if (
            (this.queryDef()?.request as ITextQueryRequest | undefined)
              ?.text !== plan.expandedSource
          ) {
            this.setAuthorError(
              'The relationship completion could not be applied to this draft. Review the JOIN in Code.',
            );
            return;
          }
          // A missing or shorthand ON clause is never hidden inside a preview
          // plan or run. Show the exact source edit in Code, then compile that
          // now-visible draft again; the user must still choose Run explicitly.
          void this.previewTugql();
          return;
        }
        this.authorPlan.set(plan);
        if (this.authorFormatStatus().includes('Preview SQL before Run.'))
          this.authorFormatStatus.set('');
      }
    } catch (error: unknown) {
      if (isCurrent())
        this.setAuthorError(
          error instanceof Error ? error.message : 'The TugQL preview failed.',
        );
    } finally {
      if (lifetime === this.authorPreviewLifetime) this.authorPreviewLoading.set(false);
    }
  }

  public publicSqliteCustomerIdLabel(result: FederatedQueryResult): string {
    const applied = result.bindingsApplied.find(
      (binding) => binding.parameterId === 'CustomerId',
    );
    return applied?.value.type === 'integer' ? applied.value.value : 'applied';
  }

  public authorCustomerIdOrigin(): AuthorBindingProvenance {
    return (
      this.queryState.authorBindingProvenance?.['CustomerId'] ?? {
        origin: 'manual',
        originEvidence: 'client-reported',
      }
    );
  }

  public publicSqliteRunIsStale(result: FederatedQueryResult): boolean {
    const applied = result.bindingsApplied.find(
      (binding) => binding.parameterId === 'CustomerId',
    );
    return (
      this.displayedResultIsPreviousRun() ||
      !this.authorCustomerIdValid() ||
      result.publicSqliteReceipt?.draftRevision !==
        this.authorDraftRevision() ||
      applied?.value.type !== 'integer' ||
      Number(applied.value.value) !== Number(this.authorCustomerId()) ||
      applied.origin !== this.authorCustomerIdOrigin().origin ||
      applied.originEvidence !== this.authorCustomerIdOrigin().originEvidence ||
      (this.authorCustomerIdOrigin().origin === 'selection' &&
        (result.publicSqliteReceipt?.clientReportedBinding?.sourceQueryId !==
          this.authorCustomerIdOrigin().sourceQueryId ||
          result.publicSqliteReceipt?.clientReportedBinding?.sourceColumn !==
            this.authorCustomerIdOrigin().sourceColumn))
    );
  }

  /** Entity/collection names this query references — see
   * {@link extractLinkedEntityNames}'s own doc comment. */
  public readonly linkedEntities = computed(() =>
    extractLinkedEntityNames(this.queryDef()),
  );

  /** api-contract.md "needs-target"/`TARGET_REQUIRED` — authorized eligible targets,
   * populated either from the Candidate the context panel opened this query with, or from
   * a `TARGET_REQUIRED` error's `error.targets` on a run attempt. Never leaks a hidden
   * source: only ever set from one of those two authorized responses. */
  public readonly availableTargets = signal<readonly CandidateTarget[]>([]);
  public readonly selectedSource = signal<string | undefined>(undefined);

  /** api-contract.md "Bounded lookups and HTTP" — a live run failed with
   * `SOURCE_UNAVAILABLE`; the user must explicitly choose a labeled snapshot (never a
   * silent fallback) via {@link runSnapshot}. */
  public readonly sourceUnavailable = signal(false);
  /** LEAD ASSUMPTION 2026-09-10 (`AvailableSnapshot`'s own doc comment,
   * `@sneat/datatug-semantic`) — the ONE recorded snapshot named on a `SOURCE_UNAVAILABLE`
   * error's sibling `details.availableSnapshots`, when the server reported one; `undefined`
   * means no recorded fixture exists for this query, so {@link runSnapshot} has nothing to
   * offer and the template must not render the action at all. Cleared on every new run
   * attempt (never stale across a live retry). */
  public readonly availableSnapshot = signal<AvailableSnapshot | undefined>(
    undefined,
  );
  private lastRequest?: RunQueryRequest;
  private lastRequestScope?: {
    project: string;
    environment: string;
    securityContextId: string;
  };

  constructor() {
    effect(() => {
      const definition = this.queryDef(), recordset = this.displayedRecordset(), resultSet = this.relatedResultSet(), executed = this.semanticExecutedDefinition();
      const generation = ++this.semanticBasisGeneration;
      this.semanticBasis.set(undefined);
      if (!definition) return;
      const project = this.project;
      if (project) void this.queriesService.devicePersonal.list(project.ref).then(items => { if (generation === this.semanticBasisGeneration) this.semanticPersonalCopies.set(items.map(item => item.query)); }).catch(() => undefined);
      void semanticQueryHash(definition.request.queryType, (definition.request as ISqlQueryRequest).text ?? '', definition.connectionId ?? '', definition.federation ?? null).then(hash => { if (generation === this.semanticBasisGeneration) this.semanticCurrentHash.set(hash); });
      if (!recordset || !executed) return;
      void semanticQueryHash(executed.request.queryType, (executed.request as ISqlQueryRequest).text ?? '', executed.connectionId ?? '', executed.federation ?? null).then(queryHash => {
        if (generation === this.semanticBasisGeneration) this.semanticBasis.set({ queryHash, resultIndex: resultSet === 'affiliations' ? 0 : 1 + (this.runResult()?.relatedRecordsets?.findIndex(item => item.id === resultSet) ?? 0), columns: recordset.columns.map(column => ({ name: column.name, dataType: column.type ?? 'unknown' })) });
      });
    });
    addIcons({ copyOutline });
    this.observedSecurityContextId = this.agentContext.securityContextId();
    this.hasObservedSecurityContext = true;
    const navigationQuery = history.state.query as IQueryDef | undefined;
    const navigationProject = history.state.project as
      | IProjectContext
      | undefined;
    if (
      history.state.action === 'create' &&
      navigationQuery?.id &&
      navigationQuery.request &&
      navigationProject?.ref
    ) {
      this.navigationDraft = {
        ref: navigationProject.ref,
        query: navigationQuery,
      };
    }
    // REQ:applicable-queries / INTEGRATION.md §3 — EnvDbTablePageComponent.onOpenQuery
    // carries the context panel's resolved Candidate bindings/targets (selection wins
    // over context, REQ:parameter-auto-binding) via router state, since this shared
    // library deliberately doesn't depend on @angular/router. MUST run before
    // trackQueryState(): queryEditorState can emit synchronously (a BehaviorSubject
    // in the real QueryEditorStateService — an of()-backed test double, always), and
    // its handler calls updateBindings(), which reads this.selectionBindings.
    // Reading it before assignment threw inside that handler's try/catch, so
    // `bindings` silently never got set at all — caught by this component's own
    // unit tests, not by inspection.
    this.selectionBindings =
      (history.state.bindings as readonly Binding[] | undefined) || [];
    this.availableTargets.set(
      (history.state.targets as readonly CandidateTarget[] | undefined) || [],
    );
    this.selectedSource.set(history.state.selectedSource as string | undefined);

    this.trackQueryState();
    const query = history.state.query as IQueryDef;
    if (
      query &&
      !this.navigationDraft &&
      !this.route.snapshot.queryParamMap.get('projectApi')
    ) {
      this.setQuery(query);
    }

    this.trackCurrentEnv();
    this.trackCurrentProject();
    this.trackQueryParams();
    this.trackProject();

    // Task 15 item 2/4 — reactive to the agent's securityContextId (a real signal)
    // and the Investigation Context's enabled items (also a signal): switches this
    // scope's own basket before recomputing bindings, and recomputes bindings whenever
    // the context changes underneath an already-open query page (a *changed*
    // conflict is never silently rebound — see confirmConflict()'s own comment).
    // project/envId are this component's own plain (non-signal) tracked fields, kept
    // in sync imperatively wherever they change (trackCurrentProject/trackCurrentEnv/
    // envChanged/setActiveEnv all call syncScopeAndBindings() too) — reading their
    // current value here is safe even though they aren't themselves tracked
    // dependencies of this effect.
    effect(() => {
      this.agentContext.securityContextId();
      this.investigationContext.items();
      this.investigationContext.promotionRevision();
      this.syncScopeAndBindings();
    });
    effect(() => {
      const selected = this.selectedAuthorResultRow();
      if (selected && this.currentAuthorResultRow() !== selected)
        this.selectedAuthorResultRow.set(undefined);
      if (this.authorRowDetailsOpen() &&
          (!this.currentAuthorResultRow() || this.resultPageLoading() ||
           this.authorRowDetailsSnapshot !== this.authorResultSnapshotKey()))
        this.authorRowDetailsOpen.set(false);
    });
  }

  /** Switches (or opens) the Investigation Context basket for the CURRENT
   * project/environment/securityContextId, then recomputes every parameter's
   * resolved binding — the single place both concerns happen together, called from
   * every place this component's tracked project/env/securityContextId can change. */
  private syncScopeAndBindings(): void {
    const projectId = this.project?.ref.projectId;
    const environment = this.envId;
    const securityContextId = this.agentContext.securityContextId();
    const parameterAttempt = untracked(this.authorRunParameterAttempt);
    if (parameterAttempt && parameterAttempt.scope !== this.authorRunParameterScope())
      this.authorRunParameterAttempt.set(undefined);
    const accessClassification = equalProjectRef(
      this.comparisonAccessProjectRef,
      this.project?.ref,
    )
      ? this.comparisonProjectAccess()
      : undefined;
    const scopeIdentity = JSON.stringify({
      project: this.project?.ref,
      queryId: this.queryId,
      accessClassification,
      securityContextId,
    });
    if (this.comparisonObservedScopeIdentity && this.comparisonObservedScopeIdentity !== scopeIdentity)
      this.invalidateComparison('The project, access classification, query, or agent context changed.');
    this.comparisonObservedScopeIdentity = scopeIdentity;
    if (
      this.hasObservedSecurityContext &&
      this.observedSecurityContextId !== securityContextId
    )
      this.invalidateHistoryScope();
    this.observedSecurityContextId = securityContextId;
    this.hasObservedSecurityContext = true;
    this.syncAuthorMode(this.queryDef(), true);
    if (projectId && environment && securityContextId) {
      this.investigationContext.setScope({
        project: projectId,
        environment,
        securityContextId,
      });
    }
    this.updateBindings();
  }

  ionViewDidEnter(): void {
    this.authorViewActive = true;
    try {
      this.updateUrl(); // If called in constructor breaks back button
      const semanticCopy = QueryPageComponent.pendingSemanticCopy;
      if (semanticCopy && semanticCopy.id === this.queryState.id) {
        QueryPageComponent.pendingSemanticCopy = undefined;
        this.envId = semanticCopy.environment;
        this.selectedSource.set(semanticCopy.selectedSource);
        this.setDisplayedResult(semanticCopy.result);
        this.commitSuccessfulResult(semanticCopy.result, semanticCopy.definition);
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process ionViewDidEnter event');
    }
  }

  private readonly onQueryEditorStateChanged = (
    editorState?: IQueryEditorState,
  ): void => {
    try {
      this.editorState = editorState;
      if (!editorState?.currentQueryId) {
        this.queryPageTitle.set('Query');
        this.customerInvoiceExample.set(false);
        if (this.queryId) {
          this.invalidateComparison('The selected query was closed.');
          this.invalidateHistoryScope();
          this.queryDef.set(undefined);
          this.queryState = {
            id: '',
            queryType: QueryType.SQL,
            request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
          };
          this.authorCustomerId.set('');
          this.authorPlan.set(undefined);
          this.changeDetector.markForCheck();
        }
        return;
      }
      const queryState = editorState.activeQueries.find(
        (qs) => qs.id === editorState.currentQueryId,
      );
      if (!queryState) {
        // A closed or unresolved selection must never inherit the previous
        // query's name while the editor state catches up.
        this.queryPageTitle.set('Query');
        return;
      }
      const structuralDraft = this.authorSavedDefinition();
      if (structuralDraft &&
          (structuralDraft.queryId !== queryState.id ||
            (queryState.def !== structuralDraft.local && queryState.def !== structuralDraft.saved)))
        this.authorSavedDefinition.set(undefined);
      const currentTitle = queryState.title ?? queryState.def?.title;
      this.queryPageTitle.set(
        typeof currentTitle === 'string'
          ? currentTitle.trim() || 'Query'
          : 'Query',
      );
      if (
        this.navigationDraft?.query.id === queryState.id &&
        !queryState.isNew &&
        queryState.def
      ) {
        this.navigationDraft = undefined;
        const navigationState = history.state as Record<string, unknown>;
        if (
          navigationState?.['action'] === 'create' &&
          (navigationState['query'] as IQueryDef | undefined)?.id ===
            queryState.id
        ) {
          const savedState = { ...navigationState };
          delete savedState['action'];
          delete savedState['query'];
          history.replaceState(savedState, '');
        }
      }
      const previousDefinition = this.queryDef();
      const previousCustomerId = this.authorCustomerId();
      const scopeChanged = this.queryId !== queryState.id;
      if (scopeChanged) {
        ++this.semanticMappingLifetime;
        this.semanticSaving.set(false);
        this.semanticDialog.set(undefined);
        this.authorRunParameterAttempt.set(undefined);
        this.authorContextTab.set(undefined);
        this.authorSourcesToggled(false);
        this.selectedAuthorResultRow.set(undefined);
      }
      const effectiveDefinition = queryState.def
        ? {
            ...queryState.def,
            ...(queryState.title !== undefined
              ? { title: queryState.title }
              : {}),
            ...(queryState.request ? { request: queryState.request } : {}),
            federation: queryState.federation ?? queryState.def.federation,
            connectionId:
              queryState.connectionId !== undefined
                ? queryState.connectionId || undefined
                : queryState.def.connectionId,
          }
        : undefined;
      const nextPlanIdentity = graphStableIdentity(
        effectiveDefinition?.federation?.nativeGraph,
      );
      const queryDefinitionChanged =
        !!previousDefinition &&
        !!effectiveDefinition &&
        JSON.stringify(previousDefinition) !==
          JSON.stringify(effectiveDefinition);
      const planChanged =
        graphStableIdentity(previousDefinition?.federation?.nativeGraph) !==
          nextPlanIdentity ||
        (!!this.executedGraphDefinition?.federation?.nativeGraph &&
          graphStableIdentity(
            this.executedGraphDefinition.federation.nativeGraph,
          ) !== nextPlanIdentity);
      if (
        scopeChanged ||
        ((this.project?.ref.projectApi === 'cloud' || (this.project && isSharedProjectRef(this.project.ref))) &&
          previousDefinition &&
          !effectiveDefinition)
      ) {
        this.invalidateComparison('The selected query or project scope changed.');
        this.invalidateHistoryScope();
      } else if (queryDefinitionChanged || planChanged) {
        this.invalidateComparison('The saved query definition changed.');
        // Editing the selected query preserves its last completed output as a
        // previous-run receipt. Fence active executions while keeping their frozen
        // definition, scope, provenance, and timing attached to that output.
        ++this.semanticRunLifetime;
        this.invalidateFederatedRun();
        this.invalidateHistoryRequests();
        const result = this.runResult();
        if (
          planChanged &&
          result?.localResult &&
          result.nativeGraph &&
          this.executedGraphDefinition
        ) {
          this.selectedHistoricalResult.set(result.localResult);
          this.historicalDefinition.set(this.executedGraphDefinition);
        }
        this.stopFederatedRun();
      }
      if (effectiveDefinition !== previousDefinition || queryState.isSaving)
        this.authorFormatNavigationSnapshot.set(undefined);
      this.queryState = queryState;
      this.authorCustomerId.set(
        queryState.authorBindings?.['CustomerId'] ?? '',
      );
      this.initializeCustomerInvoiceExample();
      if (previousCustomerId !== this.authorCustomerId())
        this.invalidateComparison('The CustomerId binding changed.');
      // Signal write (zoneless-safe, unlike the plain-field write just
      // above) — see `queryDef`'s own doc comment.
      const definitionChanged =
        previousDefinition?.id !== effectiveDefinition?.id ||
        previousDefinition?.request !== effectiveDefinition?.request ||
        previousDefinition?.federation !== effectiveDefinition?.federation ||
        previousDefinition?.publicData !== effectiveDefinition?.publicData;
      if (definitionChanged) {
        this.savedPlanReview.reset();
        this.publicDataRevisionAcknowledged.set(false);
      }
      if (this.queryDef()?.id !== queryState.def?.id) this.setOvdbToken('');
      if (effectiveDefinition && this.queryDef()?.id !== effectiveDefinition.id)
        this.federatedMode.set(
          federatedVisibleMode(effectiveDefinition).defaultMode,
        );
      this.queryDef.set(effectiveDefinition);
      this.changeDetector.markForCheck();
      if (effectiveDefinition?.federation?.nativeGraph)
        void this.refreshLocalHistory();
      if (this.queryState.environments && !this.queryState.activeEnv) {
        this.setActiveEnv(this.queryState.environments[0].id);
      }
      if (queryState.activeEnv?.id && queryState.activeEnv.id !== this.envId) {
        this.envId = queryState?.activeEnv.id;
        this.datatugNavContextService.setCurrentEnvironment(this.envId);
      }
      this.syncScopeAndBindings();
      const semanticCopy = QueryPageComponent.pendingSemanticCopy;
      if (semanticCopy && semanticCopy.id === queryState.id && this.route.snapshot.queryParamMap.get('id') === semanticCopy.id) {
        QueryPageComponent.pendingSemanticCopy = undefined;
        this.envId = semanticCopy.environment;
        this.selectedSource.set(semanticCopy.selectedSource);
        this.setDisplayedResult(semanticCopy.result);
        this.commitSuccessfulResult(semanticCopy.result, semanticCopy.definition);
      }
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to process query editor state change',
      );
    }
  };

  ngOnDestroy(): void {
    this.invalidateSemanticMapping();
    this.authorViewActive = false;
    ++this.authorRowDetailsFocusGeneration;
    ++this.authorPreviewLifetime;
    this.authorFormatNavigationSnapshot.set(undefined);
    this.expireComparisonSession('This page session ended.');
    ++this.authorLookupFocusRevision;
    ++this.authorLookupRequestRevision;
    this.pendingAuthorLookupNavigation = undefined;
    this.authorRunAbort?.abort();
    this.authorRunAbort = undefined;
    ++this.semanticRunLifetime;
    this.invalidateFederatedRun();
    this.setDisplayedResult(undefined);
    this.committedRun.set(undefined);
    this.historySelection++;
    this.savedPlanReview.destroy();
    void this.federatedQuery.dispose().catch(() => undefined);
    if (this.destroyed) {
      this.destroyed.next();
      this.destroyed.complete();
    }
  }

  public onParametersChanged(parameters: IParameter[]): void {
    this.parameters = parameters;
  }

  private trackQueryState(): void {
    this.queryEditorStateService.queryEditorState
      .pipe(distinctUntilChanged())
      .subscribe({
        next: this.onQueryEditorStateChanged,
        error: this.errorLogger.logErrorHandler(
          'Failed to get query editor stage',
        ),
      });
  }

  private trackCurrentEnv(): void {
    this.datatugNavContextService.currentEnv
      .pipe(takeUntil(this.destroyed))
      .subscribe((currentEnv) => {
        try {
          if (!currentEnv) {
            return;
          }
          const { id } = currentEnv;
          if (!id) {
            return;
          }
          this.envId = id;

          let activeEnv = this.queryState.environments?.find(
            (env) => env.id === id,
          ) || {
            id,
            summary: currentEnv.summary,
          };
          if (!activeEnv.summary && currentEnv.summary) {
            activeEnv = { ...activeEnv, summary: currentEnv.summary };
          }
          let environments: readonly IQueryEnvState[] = this.queryState
            .environments || [activeEnv];
          if (!environments.find((item) => item.id == id)) {
            environments = [...environments, activeEnv];
          }
          this.updateQueryState({
            ...this.queryState,
            activeEnv,
            environments,
          });
          this.syncScopeAndBindings();
        } catch (e) {
          this.errorLogger.logError(
            e,
            'Failed to process change of current environment',
          );
        }
      });
  }

  private updateQueryState(queryState: IQueryState): void {
    this.queryEditorStateService.updateQueryState(queryState);
  }

  private trackCurrentProject(): void {
    this.datatugNavContextService.currentProject
      .pipe(takeUntil(this.destroyed))
      .subscribe((currentProject) => {
        if (!currentProject) {
          if (this.project) {
            this.comparisonAccessProjectRef = undefined;
            this.comparisonProjectAccess.set(undefined);
            this.invalidateComparison('The current project context was cleared.');
          }
          return; // TODO: cleanup query state?
        }
        if (
          this.comparisonRouteProjectRef &&
          !equalProjectRef(this.comparisonRouteProjectRef, currentProject.ref)
        ) return;
        if (
          equalProjectRef(this.project?.ref, currentProject.ref) &&
          this.project?.summary?.environments?.length ===
            currentProject.summary?.environments?.length &&
          this.project?.summary?.access === currentProject.summary?.access &&
          this.comparisonProjectAccess() === currentProject.summary?.access
        ) {
          this.restoreNavigationDraft(currentProject.ref);
          return;
        }
        if (
          this.project?.ref.projectId !== currentProject.ref.projectId ||
          this.project?.ref.storeId !== currentProject.ref.storeId
        )
          this.invalidateHistoryScope();
        const previousRef = this.project?.ref;
        this.project = currentProject;
        this.comparisonAccessProjectRef = currentProject.ref;
        this.comparisonProjectAccess.set(currentProject.summary?.access);
        this.initializeCustomerInvoiceExample();
        if (!equalProjectRef(previousRef, currentProject.ref)) {
          this.authorContextTab.set(undefined);
          this.authorSourcesToggled(false);
          this.selectedAuthorResultRow.set(undefined);
          this.sharedQuerySaveAllowed.set(false);
          if (isSharedProjectRef(currentProject.ref)) {
            this.queriesService.capabilities(currentProject.ref)
              .pipe(takeUntil(this.destroyed))
              .subscribe({
                next: (capabilities) => {
                  if (equalProjectRef(this.project?.ref, currentProject.ref))
                    this.sharedQuerySaveAllowed.set(capabilities.querySave === true);
                },
                error: () => {
                  if (equalProjectRef(this.project?.ref, currentProject.ref))
                    this.sharedQuerySaveAllowed.set(false);
                },
              });
          }
        }
        if (hasQueryActivity(currentProject.ref)) {
          this.githubProjectActivity.resolve(currentProject.ref).subscribe({
            error: (error: unknown) =>
              this.errorLogger.logError(
                error,
                'Failed to resolve GitHub Business query activity context',
              ),
          });
        }
        this.restoreNavigationDraft(currentProject.ref);
        if (
          (currentProject.ref.projectApi || isSharedProjectRef(currentProject.ref)) &&
          !equalProjectRef(previousRef, currentProject.ref)
        ) {
          const routeId = this.route.snapshot.paramMap.get('queryId');
          const parameterId = this.route.snapshot.queryParamMap.get('id');
          const id = routeId && parameterId && routeId !== parameterId
            ? undefined
            : routeId || parameterId;
          if (id) this.queryEditorStateService.openQuery(id);
        }
        if (this.queryDef()?.federation?.nativeGraph)
          void this.refreshLocalHistory();
        this.syncScopeAndBindings();
        const summary = currentProject?.summary;
        if (!summary) {
          return;
        }
      });
  }

  private setActiveEnv(envId: string): void {
    try {
      if (!envId) {
        this.errorLogger.logError(
          'An attempt to set active environment to: ' + envId,
        );
        return;
      }
      const queryState = this.queryId && this.getQueryState(this.queryId);
      if (!queryState) {
        this.errorLogger.logError(
          'An attempt to set unknown env as an active one: ' + envId,
        );
        return;
      }
      const activeEnv = queryState.environments?.find(
        (env) => env.id === envId,
      ) || {
        id: envId,
        parameters: this.parameters && [...this.parameters],
      };
      if (queryState.activeEnv !== activeEnv) {
        this.updateQueryState({
          ...queryState,
          activeEnv,
          environments: queryState.environments || [activeEnv],
        });
      }
      if (!activeEnv.summary) {
        // Potentially can be duplicate calls if user changes env back and forth before response comes back
        if (this.project) {
          this.getEnvData(this.project.ref, envId);
        }
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to set active environment');
    }
  }

  private getEnvData(projRef: IProjectRef, envId: string): void {
    const queryId = this.queryId;

    if (queryId) {
      this.envService
        .getEnvSummary(projRef, envId)
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: (envSummary) =>
            this.onEnvSummaryReceived(queryId, envId, envSummary),
          error: this.errorLogger.logErrorHandler('Failed to get env summary'),
        });
    }
  }

  private onEnvSummaryReceived(
    queryId: string,
    envId: string,
    envSummary: IEnvironmentSummary,
  ): void {
    if (!envSummary) {
      this.errorLogger.logError(
        'getEnvSummary returned nothing for envId=' + envId,
      );
      return;
    }
    const queryState = this.getQueryState(queryId);
    if (!queryState) {
      // The query has been closed since execution requested.
      // A 100% proper way would be TODO: takeUntil(IQueryState.destroyed:Observable<void>)
      return;
    }
    const queryEnv = queryState.environments?.find((env) => env.id == envId);
    if (!queryEnv) {
      // Can't see how it is possible but just in case
      this.errorLogger.logError(
        'received env details for unknown environment: ' + envSummary.id,
      );
      return;
    }
    if (!this.queryState.activeEnv) {
      return;
    }
    let envState: IQueryEnvState = {
      ...this.queryState.activeEnv,
      summary: envSummary,
    };
    if (envSummary.dbServers?.length) {
      const envDbServer = envSummary.dbServers[0];
      envState = {
        ...envState,
        dbServer: envDbServer,
        dbServerId: this.getDbServerId(envDbServer),
        catalogId: envDbServer.catalogs?.length
          ? envDbServer.catalogs[0]
          : undefined,
      };
    }
    if (queryId) {
      const queryState = this.getQueryState(queryId);
      this.updateEnvState(envState, queryState);
    }
  }

  public getDbServerId(dbServer: IEnvDbServer): string {
    return `${dbServer.driver}:${dbServer.host}`;
  }

  private trackQueryParams(): void {
    this.route.queryParamMap.subscribe({
      next: (queryParams) => {
        console.log(
          'QueryPageComponent.trackQueryParams(): queryParams:',
          queryParams,
        );

        // `id` BEFORE `env` (S155 fix — was the other way round): on a
        // direct/reloaded navigation carrying both `?id=...&env=...` (the
        // founder's own reproduction URL), `setQueryId()` below opens the
        // query state SYNCHRONOUSLY — `QueryEditorStateService.openQuery()`
        // pushes a new `BehaviorSubject` value that this component's own
        // `trackQueryState()` subscription (constructor, runs before this
        // method) observes synchronously too, so `this.queryState`/
        // `this.queryId` are already the real id by the time `setActiveEnv()`
        // runs just below. The old order called `setActiveEnv(envId)` FIRST,
        // while `this.queryId` was still `''` (the component's own initial
        // placeholder) — `setActiveEnv()`'s own `getQueryState(this.queryId)`
        // then found nothing and logged a user-visible "Something went
        // wrong: An attempt to set unknown env as an active one: local" toast
        // on every load of that URL (confirmed live), silently dropping the
        // `env=` query param in the process (`local` was never actually set
        // as the active environment for a direct URL load, only a click-
        // through from within the app already had a matching `queryState`
        // by the time `env` was applied).
        const routeId = this.route.snapshot.paramMap.get('queryId');
        const parameterId = queryParams.get('id');
        if (routeId && parameterId && routeId !== parameterId) {
          this.customerInvoiceExample.set(false);
          this.runError.set('Query URL and query ID disagree.');
          return;
        }
        let queryId = routeId || parameterId;
        const isNew = !queryId;
        if (isNew) {
          queryId = this.randomIdService.newRandomId();
        }
        this.setQueryId(queryId, isNew);
        this.initializeCustomerInvoiceExample();

        const envId = queryParams.get('env');
        if (envId) {
          this.setActiveEnv(envId);
        }
      },
    });
  }

  private onProjRefChanged = (ref: IProjectRef) => {
    this.comparisonRouteProjectRef = ref;
    const prevProject = this.project;
    if (
      ref.projectId !== prevProject?.ref.projectId ||
      ref.storeId !== prevProject?.ref.storeId
    )
      this.invalidateHistoryScope();
    const sameResolvedProject = equalProjectRef(prevProject?.ref, ref) && !!prevProject?.summary;
    this.project = sameResolvedProject ? prevProject : newProjectContextFromRef(ref);
    // A genuinely new route ref arrives before its summary and has no admission.
    // Preserve a summary only when it already belongs to this exact full ref.
    if (!sameResolvedProject) {
      this.comparisonAccessProjectRef = undefined;
      this.comparisonProjectAccess.set(undefined);
    }
    this.syncScopeAndBindings();
    if (this.queryDef()?.federation?.nativeGraph)
      void this.refreshLocalHistory();
    if (
      this.queryId &&
      (ref.projectId !== prevProject?.ref?.projectId ||
        ref.storeId !== prevProject?.ref?.storeId)
    ) {
      // this.loadQuery();
    }
  };

  private trackProject(): void {
    const projectTracker = new ProjectTracker(this.destroyed, this.route);
    projectTracker.projectRef.subscribe({
      next: this.onProjRefChanged,
      error: this.errorLogger.logErrorHandler(
        'Failed to track project ref from activated router',
      ),
    });
  }

  private setQueryId(id?: string | null, isNew = false): void {
    const pendingNavigation = this.pendingAuthorLookupNavigation;
    const currentNavigation = this.router.currentNavigation?.();
    const isOwnedNavigation =
      !!pendingNavigation &&
      pendingNavigation.targetId === id &&
      currentNavigation?.extras.info === pendingNavigation;
    if (pendingNavigation && !isOwnedNavigation && currentNavigation) {
      pendingNavigation.routeSuperseded = true;
    }
    if (isOwnedNavigation && pendingNavigation) {
      pendingNavigation.routeObserved = true;
      pendingNavigation.observedNavigationId = currentNavigation?.id;
      return;
    }
    if (this.queryId === id) {
      return;
    }
    if (!id) {
      this.queryFolderPath = '';
      return;
    }
    const i = id.lastIndexOf('/');
    if (i >= 0) {
      this.queryFolderPath = id.substring(0, i);
    }
    if (!isNew && this.navigationDraft?.query.id !== id) {
      this.queryEditorStateService.openQuery(id);
    }
  }

  private restoreNavigationDraft(ref: IProjectRef): void {
    const draft = this.navigationDraft;
    if (
      !draft ||
      !(
        equalProjectRef(draft.ref, ref) ||
        (!draft.ref.projectApi &&
          !ref.projectApi &&
          draft.ref.storeId === ref.storeId &&
          draft.ref.projectId === ref.projectId &&
          draft.ref.spaceID === ref.spaceID)
      )
    )
      return;
    const existing = this.queryEditorStateService.getQueryState(draft.query.id);
    if (existing?.isNew) return;
    const state: IQueryState = {
      id: draft.query.id,
      title: draft.query.title,
      queryType: draft.query.request.queryType,
      request: draft.query.request,
      def: draft.query,
      federation: draft.query.federation,
      isNew: true,
    };
    if (existing) this.queryEditorStateService.updateQueryState(state);
    else this.queryEditorStateService.newQuery(state);
  }

  private setQuery(query: IQueryDef): void {
    const queryState: IQueryState = this.getQueryState(query.id) || {
      id: query.id,
      queryType: query.request.queryType,
      title: query.title,
      request: query.request,
      def: query,
    };
    this.updateQueryState(
      queryState.def === query
        ? queryState
        : {
            ...queryState,
            isNew: false,
            queryType: query.request.queryType,
            def: query,
            request: {
              queryType: query.request.queryType,
              text: (query.request as ISqlQueryRequest).text,
            } as ISqlQueryRequest,
          },
    );
  }

  public get isChanged(): boolean {
    if (isQueryChanged(this.queryState)) return true;
    const draft = this.authorSavedDefinition();
    if (!draft || draft.queryId !== this.queryState.id) return false;
    return JSON.stringify({
      request: this.queryState.request,
      relationshipBindings: this.queryState.def?.relationshipBindings?.length
        ? this.queryState.def.relationshipBindings : undefined,
    }) !== JSON.stringify({
      request: draft.saved.request,
      relationshipBindings: draft.saved.relationshipBindings?.length
        ? draft.saved.relationshipBindings : undefined,
    });
  }

  serverChanged(event: CustomEvent): void {
    if (event.detail.value === this.activeEnv?.dbServerId) {
      return;
    }
    if (!this.activeEnv) {
      return;
    }
    const envState: IQueryEnvState = {
      ...this.activeEnv,
      dbServerId: this.envDbServerId,
    };
    this.updateEnvState(envState, this.queryState);
  }

  catalogChanged(event: CustomEvent): void {
    console.log(
      'catalogChanged',
      event.detail.value,
      this.activeEnv?.catalogId,
    );
    if (event.detail.value === this.activeEnv?.catalogId) {
      return;
    }
    if (this.activeEnv) {
      this.updateEnvState(
        {
          ...this.activeEnv,
          catalogId: event.detail.value,
        },
        this.queryState,
      );
    }
  }

  envChanged(event: CustomEvent): void {
    const { value } = event.detail;
    const activeEnv = this.queryState?.environments?.find(
      (v) => v.id === value,
    );
    this.updateQueryState({
      ...this.queryState,
      activeEnv,
    });
    if (this.project && this.activeEnv && !this.activeEnv.summary) {
      this.getEnvData(this.project.ref, this.activeEnv.id);
    }
    this.updateUrl();
  }

  editorTabChanged(): void {
    this.updateUrl();
  }

  public queryTitleChanged(event: Event): void {
    if (this.queryState.saveSupported === false && !this.project?.ref.spaceID) return;
    const ce = event as CustomEvent;
    this.queryState = {
      ...this.queryState,
      title: ce.detail.value || '',
    };
    this.queryEditorStateService.updateQueryState(this.queryState);
  }

  updateUrl(): void {
    // TODO: make sure not clashes with SqlQueryEditComponent
    const queryParams: Params = {
      id: this.queryId,
      editor: this.editorTab,
      env: this.queryState.activeEnv?.id,
    };
    this.router
      .navigate([], {
        // preserveFragment: true,
        replaceUrl: true,
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge', // remove to replace all query params by provided
      })
      .catch(
        this.errorLogger.logErrorHandler('Failed to change query parameter'),
      );
  }

  private getQueryState(id: string): IQueryState | undefined {
    return this.queryEditorStateService.getQueryState(id);
  }

  private updateEnvState(
    envState: IQueryEnvState,
    queryState?: IQueryState,
  ): IQueryEnvState | undefined {
    if (!envState.id) {
      throw new Error('!envState.id');
    }
    if (!queryState) {
      return undefined;
    }
    if (queryState.activeEnv?.id == envState.id) {
      queryState = { ...queryState, activeEnv: envState };
    }
    queryState = {
      ...queryState,
      environments: queryState.environments?.map((env) =>
        env.id === envState.id ? envState : env,
      ),
    };
    this.updateQueryState(queryState);
    return envState;
  }

  public readonly queryBranches = signal<
    readonly { name: string; head: string }[]
  >([]);
  public readonly branchError = signal<string | undefined>(undefined);
  public loadQueryBranches(): void {
    const ref = this.project?.ref;
    if (!ref?.projectApi) return;
    this.queryBranches.set([]);
    this.branchError.set(undefined);
    this.queriesService.branches(ref).subscribe({
      next: (result) => {
        if (!equalProjectRef(ref, this.project?.ref)) return;
        this.queryBranches.set(
          ref.projectApi === 'local'
            ? result.branches.filter(
                (branch) => branch.name === result.currentBranch,
              )
            : result.branches,
        );
      },
      error: () => {
        if (equalProjectRef(ref, this.project?.ref))
          this.branchError.set(
            'Branches could not be loaded. The draft is unchanged.',
          );
      },
    });
  }
  public queryBranchChanged(event: Event): void {
    const branch = (event as CustomEvent<{ value: string }>).detail.value;
    const ref = this.project?.ref;
    if (
      ref?.projectApi !== 'cloud' ||
      !this.queryBranches().some((item) => item.name === branch) ||
      branch === ref.branch
    )
      return;
    if (
      this.isChanged &&
      !confirm('Discard this draft and open the selected branch?')
    )
      return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { projectApi: 'cloud', branch },
      queryParamsHandling: 'merge',
    });
  }

  public reloadSavedQuery(): void {
    if (
      !this.queryState.id ||
      (this.isChanged &&
        !confirm('Discard this draft and reload the saved query?'))
    )
      return;
    this.queryEditorStateService.reloadQuery(this.queryState.id);
  }

  public saveChanges(): void {
    if (this.semanticSaving()) return;
    if (!this.canSaveQuery()) return;
    if (!this.isChanged) {
      alert('Query does not require saving as is not changed yet');
      return;
    }
    if (this.project) {
      this.queryEditorStateService
        .saveQuery(this.queryState, this.project.ref)
        .subscribe({
          error: () => {
            /* The common API publishes a safe inline error; legacy failures keep the logger. */ if (
              !this.project?.ref.projectApi
            )
              this.errorLogger.logError('Failed to save query');
          },
        });
    }
  }

  /**
   * REQ:parameter-auto-binding (INTEGRATION.md §6), Task 15 item 3 — resolves every
   * semantic parameter's binding through `binding-resolver.ts`'s precedence engine:
   * the context panel's selection (router state, set once in the constructor) first,
   * then the Investigation Context's *enabled* facts, then a declared default. More
   * than one distinct typed value within a tier is `ambiguous`; a selection that
   * disagrees with a different context value is `conflict-unconfirmed` until
   * {@link confirmConflict}. Never applies anything — see effectiveBindings() and
   * clearBinding() for the REQ:no-hidden-filters half (the user must see and can
   * clear/override every binding before a run).
   */
  private updateBindings(explicitlyResolvedParameterId?: string): void {
    const parameterDefs = this.queryState.def?.parameters || [];
    const parameters: BindingParameterRef[] = parameterDefs
      .filter((p) => !!p.meta)
      .map((p) => ({ id: p.id, meta: p.meta, required: p.isRequired }));
    if (!parameters.length) {
      this.bindings.set([]);
      this.clearedParamIds.set(new Set());
      this.confirmedConflicts.set(new Map());
      return;
    }
    const selectionFacts = this.buildSelectionFacts(parameters);
    const contextFacts = this.investigationContext
      .items()
      .filter((item) => item.enabled && isFactSelectedForBinding(item));
    const activeContextScope = this.investigationContext.scope();
    const contextScopeKey = activeContextScope
      ? scopeKey(activeContextScope)
      : undefined;
    const clearedParamIds = this.clearedParamIds();

    // First pass with no confirmations, to discover the CURRENT conflict pair (if
    // any) per parameter — a stale confirmation for a *different* pair must not carry
    // over silently.
    const discovery = resolveBindings({
      parameters,
      userValues: this.userBindingValues(),
      selectedContextFactKeys: this.selectedContextFactKeys(),
      contextScopeKey,
      selectionFacts,
      contextFacts,
      clearedParamIds,
    });
    const confirmedNow = new Set<string>();
    for (const binding of discovery) {
      if (binding.blocked !== 'conflict-unconfirmed' || !binding.conflict) {
        continue;
      }
      const stored = this.confirmedConflicts().get(binding.parameterId);
      if (
        stored &&
        typedValuesEqual(
          stored.selectionValue,
          binding.conflict.selectionValue,
        ) &&
        typedValuesEqual(stored.contextValue, binding.conflict.contextValue)
      ) {
        confirmedNow.add(binding.parameterId);
      }
    }
    let resolved = confirmedNow.size
      ? resolveBindings({
          parameters,
          userValues: this.userBindingValues(),
          selectedContextFactKeys: this.selectedContextFactKeys(),
          contextScopeKey,
          selectionFacts,
          contextFacts,
          clearedParamIds,
          confirmedConflicts: confirmedNow,
        })
      : discovery;

    const snapshotKey = JSON.stringify([
      this.project?.ref.storeId,
      this.project?.ref.projectId,
      this.envId,
      this.queryId,
      this.agentContext.securityContextId(),
    ]);
    const promotionRevision = this.investigationContext.promotionRevision();
    if (snapshotKey !== this.bindingSnapshotKey) {
      this.bindingSnapshotKey = snapshotKey;
      this.bindingSnapshot = new Map(
        resolved.map((binding) => [binding.parameterId, binding]),
      );
      this.dismissedRebinds.clear();
      this.rebindSuggestions.set([]);
      this.seenPromotionRevision = promotionRevision;
      this.promotionRebindPending = false;
    } else if (
      this.promotionRebindPending ||
      promotionRevision !== this.seenPromotionRevision
    ) {
      this.seenPromotionRevision = promotionRevision;
      this.promotionRebindPending = true;
      const suggestions: RebindSuggestion[] = [];
      resolved = resolved.map((suggested) => {
        const previous = this.bindingSnapshot.get(suggested.parameterId);
        if (suggested.parameterId === explicitlyResolvedParameterId) {
          this.bindingSnapshot.set(suggested.parameterId, suggested);
          this.dismissedRebinds.delete(suggested.parameterId);
          return suggested;
        }
        const fingerprint = rebindFingerprint(previous, suggested);
        if (
          bindingsEqual(
            previous ? [previous] : [],
            previous ? [suggested] : [],
          ) ||
          this.dismissedRebinds.get(suggested.parameterId) === fingerprint
        ) {
          return previous ?? suggested;
        }
        suggestions.push({
          parameterId: suggested.parameterId,
          previous,
          suggested,
        });
        return (
          previous ?? {
            parameterId: suggested.parameterId,
            meta: suggested.meta,
            ...(suggested.blocked === 'missing-required'
              ? { blocked: 'missing-required' as const }
              : {}),
          }
        );
      });
      setIfChanged(
        this.rebindSuggestions,
        suggestions,
        (left, right) => JSON.stringify(left) === JSON.stringify(right),
      );
      this.promotionRebindPending =
        suggestions.length > 0 || this.dismissedRebinds.size > 0;
    } else {
      this.bindingSnapshot = new Map(
        resolved.map((binding) => [binding.parameterId, binding]),
      );
      if (this.rebindSuggestions().length) {
        this.rebindSuggestions.set([]);
      }
    }

    // Signal writes are skipped when the new value is equivalent to the current one
    // (deep-equal, not just a fresh array/Set/Map reference) — this method runs inside
    // a reactive `effect()` (see the constructor), and an unconditional `.set()` on
    // every run — even with unchanged content — repeatedly invalidates this component's
    // own signal graph and never lets Angular's change-detection loop reach a fixed
    // point (observed directly: a real infinite `detectChangesInViewWhileDirty` loop in
    // this component's own tests once `investigationContext.items()` started changing).
    setIfChanged(this.bindings, resolved, bindingsEqual);

    // Dropping a parameter (e.g. switching to a query with different params)
    // shouldn't leave a stale clear/confirmation behind for a parameterId that no
    // longer applies, but a still-applicable one the user explicitly cleared/confirmed
    // should stay that way.
    const resolvedIds = new Set(resolved.map((b) => b.parameterId));
    setIfChanged(
      this.clearedParamIds,
      new Set([...clearedParamIds].filter((id) => resolvedIds.has(id))),
      setsEqual,
    );
    setIfChanged(
      this.confirmedConflicts,
      new Map(
        [...this.confirmedConflicts()].filter(([id]) => resolvedIds.has(id)),
      ),
      (a, b) =>
        mapsEqual(
          a,
          b,
          (x, y) =>
            typedValuesEqual(x.selectionValue, y.selectionValue) &&
            typedValuesEqual(x.contextValue, y.contextValue),
        ),
    );
  }

  /** Wraps the context panel's resolved selection `Binding[]` (router state,
   * parameterId + value only) as {@link Fact}s keyed by each parameter's own
   * `meta.entity`/`meta.field` — `binding-resolver.ts` matches candidates by field, not
   * parameterId (api-contract.md: "Binding has no entity/field; the server already
   * knows them from the query def"). */
  private buildSelectionFacts(
    parameters: readonly BindingParameterRef[],
  ): Fact[] {
    const facts: Fact[] = [];
    for (const selection of this.selectionBindings) {
      const param = parameters.find((p) => p.id === selection.parameterId);
      if (!param?.meta) {
        continue;
      }
      facts.push({
        // Preserve the server's exact fact provenance. An older candidate that omitted
        // factId stays empty and runQuery fails closed instead of fabricating one.
        id: selection.factId ?? '',
        entity: param.meta.entity,
        field: param.meta.field,
        value: selection.value,
        origin: 'selection',
        enabled: true,
      });
    }
    return facts;
  }

  /** REQ:no-hidden-filters — the user clears (or, by not clearing, implicitly
   * confirms) every auto-bound parameter before it's ever sent on a run. */
  public clearBinding(parameterId: string): void {
    this.dismissedRebinds.delete(parameterId);
    this.clearedParamIds.set(new Set([...this.clearedParamIds(), parameterId]));
    this.selectedContextFactKeys.set(
      new Map(
        [...this.selectedContextFactKeys()].filter(
          ([id]) => id !== parameterId,
        ),
      ),
    );
    this.updateBindings(parameterId);
  }

  /** Accepts a direct parameter edit from the query UI. User edits have the resolver's
   * highest precedence and become the accepted snapshot immediately; a preceding
   * promotion must never make a fresh user choice look like a context rebind. */
  public editBinding(parameterId: string, value: TypedValue): void {
    this.dismissedRebinds.delete(parameterId);
    this.clearedParamIds.set(
      new Set([...this.clearedParamIds()].filter((id) => id !== parameterId)),
    );
    this.userBindingValues.set(
      new Map(this.userBindingValues()).set(parameterId, value),
    );
    this.selectedContextFactKeys.set(
      new Map(
        [...this.selectedContextFactKeys()].filter(
          ([id]) => id !== parameterId,
        ),
      ),
    );
    this.updateBindings(parameterId);
  }

  public chooseContextCohort(parameterId: string, factKey: string): void {
    this.dismissedRebinds.delete(parameterId);
    this.clearedParamIds.set(
      new Set([...this.clearedParamIds()].filter((id) => id !== parameterId)),
    );
    this.userBindingValues.set(
      new Map(
        [...this.userBindingValues()].filter(([id]) => id !== parameterId),
      ),
    );
    this.selectedContextFactKeys.set(
      new Map(this.selectedContextFactKeys()).set(parameterId, factKey),
    );
    this.updateBindings(parameterId);
  }

  /** api-contract.md "Selection overriding a different context value is shown as an
   * explicit conflict requiring confirmation" — accepts the selection value for THIS
   * exact conflicting pair. A later change to a *different* context/selection pair for
   * the same parameter is never silently treated as already-confirmed (see
   * {@link updateBindings}'s discovery pass). */
  public confirmConflict(parameterId: string): void {
    const current = this.bindings().find((b) => b.parameterId === parameterId);
    if (current?.blocked !== 'conflict-unconfirmed' || !current.conflict) {
      return;
    }
    this.dismissedRebinds.delete(parameterId);
    this.confirmedConflicts.set(
      new Map(this.confirmedConflicts()).set(parameterId, current.conflict),
    );
    this.updateBindings(parameterId);
  }

  public acceptRebind(parameterId: string): void {
    const suggestion = this.rebindSuggestions().find(
      (item) => item.parameterId === parameterId,
    );
    if (!suggestion) {
      return;
    }
    this.bindingSnapshot.set(parameterId, suggestion.suggested);
    this.dismissedRebinds.delete(parameterId);
    this.updateBindings(parameterId);
  }

  public keepCurrentBinding(parameterId: string): void {
    const suggestion = this.rebindSuggestions().find(
      (item) => item.parameterId === parameterId,
    );
    if (!suggestion) {
      return;
    }
    this.dismissedRebinds.set(
      parameterId,
      rebindFingerprint(suggestion.previous, suggestion.suggested),
    );
    const remaining = this.rebindSuggestions().filter(
      (item) => item.parameterId !== parameterId,
    );
    this.rebindSuggestions.set(remaining);
  }

  protected rebindSuggestionLabel(suggestion: RebindSuggestion): string {
    const previous = suggestion.previous?.value;
    const next = suggestion.suggested.value;
    return `${previous ? displayTypedValue(previous) : 'unbound'} → ${next ? displayTypedValue(next) : 'unbound'}`;
  }

  /** `"Customer.ID"` — the parameter's meta, for the Parameters card heading. */
  protected bindingFieldLabel(binding: ResolvedBinding): string {
    return binding.meta
      ? `${binding.meta.entity}.${binding.meta.field}`
      : binding.parameterId;
  }

  /** AC:bound-from-selection literal wording — `"5 · from selection"` /
   * `"5 · from context"` / `"5 · from default"` / `"5 · your edit"`. */
  protected bindingValueLabel(binding: ResolvedBinding): string {
    if (binding.value === undefined) {
      return '';
    }
    const origin =
      binding.origin === 'user' ? 'your edit' : `from ${binding.origin}`;
    const role =
      binding.origin === 'context' && binding.role ? ` · ${binding.role}` : '';
    return `${displayTypedValue(binding.value)} · ${origin}${role}`;
  }

  protected selectedCohortFactKey(parameterId: string): string | undefined {
    return this.selectedContextFactKeys().get(parameterId);
  }

  protected cohortOptionLabel(
    option: NonNullable<ResolvedBinding['cohortOptions']>[number],
  ): string {
    return `${option.role ?? 'unassigned'} = ${displayTypedValue(option.value)}`;
  }

  /** AC:typed-context-isolation — ">1 distinct typed value" rendered for an
   * `ambiguous` block. */
  protected ambiguousValuesLabel(binding: ResolvedBinding): string {
    return (binding.ambiguousValues ?? []).map(displayTypedValue).join(', ');
  }

  /** "Selection overriding a different context value is shown as an explicit conflict
   * requiring confirmation" — the two disagreeing values for a `conflict-unconfirmed`
   * block. */
  protected conflictLabel(binding: ResolvedBinding): string {
    if (!binding.conflict) {
      return '';
    }
    return `selection ${displayTypedValue(binding.conflict.selectionValue)} vs context ${displayTypedValue(binding.conflict.contextValue)}`;
  }

  /** Renders one `Result.bindingsApplied` entry (a wire {@link Binding}: parameterId +
   * value only) for the results header — entity/field come from this query's own
   * parameter definition, same lookup {@link updateBindings} uses. */
  protected appliedBindingLabel(binding: Binding): string {
    const meta = this.queryState.def?.parameters?.find(
      (p) => p.id === binding.parameterId,
    )?.meta;
    const name = meta ? `${meta.entity}.${meta.field}` : binding.parameterId;
    return `${name} = ${displayTypedValue(binding.value)}`;
  }

  /** REQ:parameter-auto-binding correction (2026-09-09 handoff): "Client-origin claims
   * appeared to be server provenance... do not describe a client-supplied
   * selection/context origin as server-attested evidence." Renders the exact distinction
   * the appendix requires (`originEvidence`), not just `origin`. */
  protected appliedBindingProvenance(binding: Binding): string {
    return binding.originEvidence === 'server-default'
      ? `${binding.origin} · server default`
      : `${binding.origin} · client-reported`;
  }

  protected appliedBindingRole(binding: Binding): ResolvedBinding['role'] {
    return this.lastRunBindingRoles().get(binding.parameterId);
  }

  protected chooseTarget(source: string): void {
    this.selectedSource.set(source);
  }

  /** Grid-adapter unwrap at the template edge (plan Task 12 item 3) — bound as a field so
   * the template can call it directly. */
  protected readonly displayValue = displayTypedValue;

  private currentQueryIdentity(): symbol {
    return this.queryIdentityToken();
  }

  private setDisplayedResult(result: FederatedQueryResult | undefined): void {
    ++this.resultPageRequestGeneration;
    this.resultPageLoading.set(false);
    this.displayedResultGeneration.update((generation) => generation + 1);
    this.runResult.set(result);
  }

  private updateDisplayedAttemptTotalRows(
    totalRows: number,
    generation: number | undefined,
  ): void {
    if (
      generation === undefined ||
      this.displayedResultGeneration() !== generation
    )
      return;
    const displayed = this.runResult();
    if (!displayed) return;
    const updated = { ...displayed, totalRows, hasMore: false };
    this.runResult.set(updated);
    const committed = this.committedRun();
    if (committed?.displayedResultGeneration === generation) {
      const frozenResult = snapshotCommittedResult(updated);
      this.committedRun.set(
        Object.freeze({
          ...committed,
          result: frozenResult,
          provenance: frozenResult.provenance,
        }),
      );
    }
  }

  private showAttemptResult(result: FederatedQueryResult): void {
    this.selectedHistoricalResult.set(undefined);
    this.historicalDefinition.set(undefined);
    this.relatedResultSet.set('affiliations');
    this.resultPageIndex.set(0);
    this.resultPageRows.set(result.recordset.rows);
    this.setDisplayedResult(result);
  }

  private currentResultTargetIdentity(): string {
    return JSON.stringify([
      this.queryDef()?.connectionId,
      this.selectedSource(),
      this.envId,
    ]);
  }

  private currentResultTargetLabel(
    definition = this.queryDef(),
    result?: FederatedQueryResult,
  ): string {
    const federationBase = definition?.federation?.ovdbBaseUrl;
    if (federationBase) {
      try {
        return `OVDB at ${new URL(federationBase).origin}`;
      } catch {
        return 'Configured OVDB endpoint';
      }
    }
    const connectionId = definition?.connectionId;
    if (connectionId === 'chinook-sqlite')
      return 'Chinook SQLite browser fixture';
    if (connectionId) {
      const connection = this.activeEnv?.summary?.connections?.[connectionId];
      return connection?.database
        ? `Database ${connection.database}`
        : 'Saved database connection';
    }
    const selectedSource = this.selectedSource();
    const source = selectedSource ?? result?.provenance.source;
    if (source) {
      const label = this.availableTargets().find(
        (target) => target.source === source,
      )?.label;
      if (label) return label;
      if (selectedSource) return 'Selected authorized source';
      if (result?.provenance.source)
        return `Source ${result.provenance.source}`;
    }
    const environment =
      this.activeEnv?.title ??
      this.queryState.environments?.find((item) => item.id === this.envId)
        ?.title;
    if (environment) return `Environment ${environment}`;
    return this.envId ? 'Current environment' : 'Authorized query target';
  }

  private currentEnvironmentLabel(): string | undefined {
    return (
      this.activeEnv?.title ??
      this.queryState.environments?.find((item) => item.id === this.envId)
        ?.title
    );
  }

  protected previousResultDisplayCount(rowCount: number): number {
    return Math.min(rowCount, this.resultPageSize);
  }

  private hasCompleteResult(result: FederatedQueryResult): boolean {
    const runtimePages = Object.values(result.runtimeRead?.pages ?? {});
    return (
      result.truncated !== true &&
      result.hasMore !== true &&
      !runtimePages.some((page) => !page.complete || page.possiblyMore)
    );
  }

  private commitSuccessfulResult(
    result: FederatedQueryResult,
    definition: IQueryDef,
    timing?: QueryRunTiming,
  ): void {
    if (!this.hasCompleteResult(result)) return;
    this.semanticExecutedDefinition.set(definition);
    const frozenResult = snapshotCommittedResult(result);
    const request = definition.request as ITextQueryRequest & {
      readonly method?: string;
    };
    const executedDefinition: CommittedQueryDefinition = cloneAndFreeze({
      request: {
        queryType: request.queryType,
        ...(request.queryType === QueryType.HTTP
          ? typeof request.method === 'string'
            ? { method: request.method }
            : {}
          : typeof request.text === 'string'
            ? { text: request.text }
            : {}),
      },
      ...(definition.federation?.nativeGraph
        ? { nativeGraph: definition.federation.nativeGraph }
        : {}),
    });
    const securityContextId = this.agentContext.securityContextId();
    const resultTarget = this.currentResultTargetLabel(definition, result);
    this.committedRun.set(
      Object.freeze({
        result: frozenResult,
        displayedResultGeneration: this.displayedResultGeneration(),
        executedDefinition,
        queryIdentity: this.currentQueryIdentity(),
        scope: Object.freeze({
          storeId: this.project?.ref.storeId,
          projectId: this.project?.ref.projectId,
          queryId: this.queryId,
          ...(securityContextId ? { securityContextId } : {}),
          ...(this.currentEnvironmentLabel()
            ? { environment: `Environment ${this.currentEnvironmentLabel()}` }
            : {}),
          target: resultTarget,
        }),
        targetIdentity: this.currentResultTargetIdentity(),
        ...(timing ? { timing: Object.freeze({ ...timing }) } : {}),
        provenance: frozenResult.provenance,
      }),
    );
  }

  /** REQ:parameter-auto-binding, REQ:no-hidden-filters, REQ:limitation-visible
   * (INTEGRATION.md §5-6) — runs the query through SemanticApiService (never a
   * browser-built query) with only the bindings the user has actually seen and not
   * cleared, then renders limitations and the applied-bindings list from the
   * response so nothing is a hidden filter. Every call carries the current
   * project/environment/securityContextId Scope and, per api-contract.md, the exact
   * bindingOrigins for the submitted parameter keys — display provenance only, never
   * authorization. */
  public runQuery(): void {
    this.authorFormatNavigationSnapshot.set(undefined);
    if (this.isTugqlAuthorJourney() && this.authorRunReadiness().action === 'parameters') {
      this.authorRunParameterAttempt.set({
        scope: this.authorRunParameterScope(),
        definition: this.queryDef(),
        binding: this.authorCustomerId(),
        draftRevision: this.authorDraftRevision(),
      });
      return;
    }
    this.authorRunParameterAttempt.set(undefined);
    const runRequestedAt = monotonicTime();
    const projectRef = this.project?.ref;
    const projectId = projectRef?.projectId;
    const queryId = this.queryId;
    if (!projectId || !queryId) {
      return;
    }
    const definition = this.queryDef();
    if (
      definition?.publicData &&
      this.publicDataRevisionChanges().length &&
      !this.publicDataRevisionAcknowledged()
    ) {
      this.runError.set(
        'Canonical metadata revisions changed. Inspect the saved pins and explicitly acknowledge before re-execution.',
      );
      return;
    }
    if (definition?.publicData) {
      this.runError.set(SAVED_SCENARIO_PUBLICATION_BLOCKER);
      return;
    }
    this.historySelection++;
    this.queryRunTiming.set(undefined);
    if (
      isGithubStoreId(this.project?.ref.storeId) &&
      definition?.connectionId === 'chinook-sqlite' &&
      definition.request.queryType === QueryType.DTQL
    ) {
      if (this.running()) return;
      if (!this.authorCustomerIdValid()) {
        this.runError.set(
          'Enter a whole-number CustomerId before running this query.',
        );
        return;
      }
      const previewPlan = this.authorPlan();
      if (!previewPlan || previewPlan.draftRevision !== this.authorDraftRevision()) {
        this.runError.set('Preview the current TugQL draft before Run.');
        return;
      }
      const runScope = this.historyScope();
      const executedDefinition = structuredClone(definition);
      const draftRevision = this.authorDraftRevision();
      const bindingRevision = this.authorBindingRevision();
      const customerId = this.authorCustomerId();
      const queryIdSnapshot = this.queryId;
      const projectSnapshot = JSON.stringify(projectRef);
      const lifetime = ++this.federatedRunLifetime;
      const controller = new AbortController();
      this.authorRunAbort = controller;
      const current = (): boolean =>
        lifetime === this.federatedRunLifetime &&
        this.historyScope() === runScope &&
        this.queryId === queryIdSnapshot &&
        JSON.stringify(this.project?.ref) === projectSnapshot &&
        this.authorDraftRevision() === draftRevision &&
        this.authorBindingRevision() === bindingRevision &&
        this.authorCustomerId() === customerId &&
        this.authorPlan() === previewPlan &&
        JSON.stringify(this.queryDef()) === JSON.stringify(executedDefinition);
      this.running.set(true);
      this.runError.set(undefined);
      void this.publicSqliteQuery
        .runTugQL(
          projectRef,
          executedDefinition,
          draftRevision,
          customerId,
          previewPlan,
          controller.signal,
          this.authorCustomerIdOrigin(),
          () => this.reportGitHubQueryDispatch(projectRef),
        )
        .then((result) => {
          if (!current()) return;
          this.showAttemptResult(result);
          const timing: QueryRunTiming = {
            allResultsLoadedMs: Math.max(0, monotonicTime() - runRequestedAt),
            noRecords: result.recordset.rows.length === 0,
          };
          this.queryRunTiming.set(timing);
          this.commitSuccessfulResult(result, executedDefinition, timing);
        })
        .catch((error: unknown) => {
          if (
            current() &&
            !(error instanceof Error && error.name === 'AbortError')
          ) {
            if (this.isAuthorizationFailure(error))
              this.invalidateHistoryScope();
            this.runError.set(
              error instanceof Error
                ? error.message
                : 'The public SQLite query failed.',
            );
          }
        })
        .finally(() => {
          if (this.authorRunAbort === controller)
            this.authorRunAbort = undefined;
          if (lifetime === this.federatedRunLifetime) {
            if (!current()) this.queryRunTiming.set(undefined);
            this.running.set(false);
          }
        });
      return;
    }
    if (
      isBrowserSqlProject(this.project?.ref) &&
      definition?.connectionId &&
      definition.request.queryType === QueryType.SQL
    ) {
      if (this.running()) return;
      const runScope = this.historyScope();
      const executedDefinition = structuredClone(definition);
      const lifetime = ++this.federatedRunLifetime;
      const current = (): boolean =>
        lifetime === this.federatedRunLifetime &&
        this.historyScope() === runScope &&
        JSON.stringify(this.queryDef()) === JSON.stringify(executedDefinition);
      this.running.set(true);
      this.runError.set(undefined);
      void this.publicSqliteQuery
        .run(projectRef, executedDefinition,
          () => this.reportGitHubQueryDispatch(projectRef))
        .then((result) => {
          if (!current()) return;
          this.showAttemptResult(result);
          const timing: QueryRunTiming = {
            allResultsLoadedMs: Math.max(0, monotonicTime() - runRequestedAt),
            noRecords: result.recordset.rows.length === 0,
          };
          this.queryRunTiming.set(timing);
          this.commitSuccessfulResult(result, executedDefinition, timing);
        })
        .catch((error: unknown) => {
          if (current()) {
            if (this.isAuthorizationFailure(error))
              this.invalidateHistoryScope();
            this.runError.set(
              error instanceof Error
                ? error.message
                : 'The public SQLite query failed.',
            );
          }
        })
        .finally(() => {
          if (lifetime === this.federatedRunLifetime) {
            if (!current()) this.queryRunTiming.set(undefined);
            this.running.set(false);
          }
        });
      return;
    }
    if (definition?.federation) {
      if (this.running()) return;
      const runStartedAt = runRequestedAt;
      const runMode = this.federatedMode();
      let firstRecordAt: number | undefined;
      this.running.set(true);
      this.federatedProgress.set(undefined);
      this.runError.set(undefined);
      const runScope = this.historyScope(),
        lifetime = ++this.federatedRunLifetime;
      const executedDefinition = structuredClone(definition);
      const executedIdentity = graphStableIdentity(executedDefinition);
      const credentialGeneration = this.ovdbCredentialGeneration();
      const runtimeToken = this.ovdbToken().trim();
      let reportedTotalRows: number | undefined;
      let resultPublished = false;
      let publishedGeneration: number | undefined;
      const current = (): boolean =>
        lifetime === this.federatedRunLifetime &&
        this.historyScope() === runScope &&
        credentialGeneration === this.ovdbCredentialGeneration() &&
        graphStableIdentity(this.queryDef()) === executedIdentity;
      this.executedGraphDefinition = executedDefinition;
      this.reportGitHubQueryDispatch(projectRef);
      this.federatedQuery
        .run(
          executedDefinition,
          (progress) => {
            if (current()) this.federatedProgress.set(progress);
          },
          runtimeToken,
          runMode,
          (totalRows) => {
            if (!current()) return;
            if (!resultPublished) {
              reportedTotalRows = totalRows;
              return;
            }
            this.updateDisplayedAttemptTotalRows(
              totalRows,
              publishedGeneration,
            );
          },
          runMode === 'full'
            ? {
                onFirstRecord: (at) => {
                  if (current() && firstRecordAt === undefined)
                    firstRecordAt = at;
                },
              }
            : {},
        )
        .then((result) => {
          if (current()) {
            const runtimePages = Object.values(result.runtimeRead?.pages ?? {});
            const allResultsComplete =
              result.hasMore !== true &&
              result.truncated !== true &&
              !runtimePages.some((page) => !page.complete || page.possiblyMore);
            const completedResult =
              reportedTotalRows !== undefined
                ? { ...result, totalRows: reportedTotalRows, hasMore: false }
                : result;
            let timing: QueryRunTiming | undefined;
            if (runMode === 'full' && allResultsComplete) {
              const resultRows =
                completedResult.totalRows ??
                completedResult.recordset.rows.length;
              timing = {
                ...(resultRows === 0 || firstRecordAt === undefined
                  ? {}
                  : {
                      firstRecordMs: Math.max(0, firstRecordAt - runStartedAt),
                    }),
                allResultsLoadedMs: Math.max(0, monotonicTime() - runStartedAt),
                noRecords: resultRows === 0,
              };
              this.queryRunTiming.set(timing);
            }
            this.executedGraphDefinition = executedDefinition;
            this.showAttemptResult(completedResult);
            resultPublished = true;
            publishedGeneration = this.displayedResultGeneration();
            if (runMode === 'full' && allResultsComplete)
              this.commitSuccessfulResult(
                completedResult,
                executedDefinition,
                timing,
              );
            if (completedResult.localResult && this.project?.ref) {
              void this.federatedQuery
                .associateLocalResult(
                  this.project.ref,
                  queryId,
                  completedResult.localResult,
                )
                .then(() =>
                  current() ? this.refreshLocalHistory() : undefined,
                )
                .catch((error: unknown) => {
                  if (current())
                    this.localHistoryError.set(
                      error instanceof Error
                        ? error.message
                        : 'Cannot associate the local result.',
                    );
                });
            }
          }
        })
        .catch((error: unknown) => {
          if (current()) {
            if (this.isAuthorizationFailure(error))
              this.invalidateHistoryScope();
            this.queryRunTiming.set(undefined);
            this.runError.set(
              error instanceof Error
                ? error.message
                : 'The direct OVDB query failed.',
            );
          }
        })
        .finally(() => {
          if (lifetime !== this.federatedRunLifetime) return;
          if (current()) this.running.set(false);
          else {
            this.invalidateFederatedRun();
            this.stopFederatedRun();
          }
        });
      return;
    }
    // Checked before requiring `environment`/`securityContextId` below: a
    // GitHub-store project has no live agent connection, so
    // `agentContext.securityContextId()` never resolves for one — the old
    // ordering (both checked in the same combined `if`) made this GitHub
    // guard dead code, silently no-op'ing "Run" instead of showing
    // `GITHUB_QUERY_RUN_MESSAGE` (confirmed live, S136: clicking "Run" on a
    // GitHub-store query did nothing at all — no message, no thrown error,
    // just nothing — for deliverable 2, "an explicit, friendly notice...
    // not a thrown error").
    if (isBrowserSqlProject(this.project?.ref)) {
      this.runError.set(this.project && isSharedProjectRef(this.project.ref)
        ? SHARED_QUERY_RUN_MESSAGE : GITHUB_QUERY_RUN_MESSAGE);
      return;
    }
    const environment = this.envId;
    const securityContextId = this.agentContext.securityContextId();
    if (!environment || !securityContextId) {
      return;
    }
    // REQ:no-hidden-filters, AC:typed-context-isolation "conflict blocks an
    // unconfirmed run" — an ambiguous, unconfirmed-conflict or missing-required
    // parameter stops Run entirely rather than silently omitting it.
    if (this.hasBlockedBindings()) {
      this.runError.set(
        'Resolve every ambiguous, conflicting or required parameter before running.',
      );
      return;
    }
    const missingFactProvenance = this.effectiveBindings().find(
      (binding) =>
        (binding.origin === 'selection' || binding.origin === 'context') &&
        !binding.factId,
    );
    if (missingFactProvenance) {
      this.runError.set(
        `Cannot run ${missingFactProvenance.parameterId}: its bound value has no fact provenance. Refresh the selection and try again.`,
      );
      return;
    }
    this.running.set(true);
    this.runError.set(undefined);
    this.accessBlockers.set([]);
    this.sourceUnavailable.set(false);
    this.availableSnapshot.set(undefined);
    const parameters: Record<string, TypedValue> = {};
    const bindingOrigins: ExecutionBindingOrigin[] = [];
    const effectiveBindings = this.effectiveBindings();
    this.lastRunBindingRoles.set(
      new Map(
        effectiveBindings
          .filter((binding) => !!binding.role)
          .map((binding) => [binding.parameterId, binding.role]),
      ),
    );
    for (const binding of effectiveBindings) {
      // isBindingRunnable() (effectiveBindings' own filter) guarantees `value` is set.
      parameters[binding.parameterId] = binding.value as TypedValue;
      const factId = binding.factId;
      bindingOrigins.push({
        parameterId: binding.parameterId,
        // The resolver's 'user' origin (an explicit edit) maps to the wire contract's
        // 'manual' bucket — api-contract.md's BindingOrigin has no 'user' case; a
        // client-entered value that isn't from selection/context IS what the appendix
        // calls 'manual'.
        origin:
          binding.origin === 'user' ? 'manual' : (binding.origin ?? 'default'),
        ...(factId ? { factId } : {}),
      });
    }
    this.executeQuery(
      {
        project: projectId,
        environment,
        securityContextId,
        queryId,
        source: this.selectedSource(),
        parameters,
        bindingOrigins,
        mode: 'live',
      },
      { project: projectId, environment, securityContextId },
    );
  }

  public async changeResultPage(delta: number): Promise<void> {
    const next = this.resultPageIndex() + delta;
    if (
      next < 0 ||
      (next * this.resultPageSize >= this.resultTotalRows() &&
        !this.resultHasMore())
    )
      return;
    const result = this.runResult();
    if (!result?.hasMore && result?.totalRows === undefined) {
      this.resultPageIndex.set(next);
      return;
    }
    const cachedRows = this.resultPageRows();
    const previousRows = cachedRows.length > 0
      ? cachedRows
      : this.resultPageIndex() === 0
        ? this.displayedRecordset()?.rows ?? []
        : cachedRows;
    const requestGeneration = ++this.resultPageRequestGeneration;
    const selection = this.historySelection,
      set = this.relatedResultSet();
    this.resultPageRows.set([]);
    this.resultPageLoading.set(true);
    try {
      const rows = await this.federatedQuery.getPage(
        next,
        set,
        this.selectedHistoricalResult() ?? result?.localResult,
      );
      const current = this.runResult();
      if (
        selection === this.historySelection &&
        set === this.relatedResultSet() &&
        current === result
      ) {
        if (rows.length === 0 && next > 0) {
          this.resultPageRows.set(previousRows);
          this.runResult.set({
            ...current,
            totalRows: next * this.resultPageSize,
            hasMore: false,
          });
        } else {
          this.resultPageIndex.set(next);
          this.resultPageRows.set(rows);
          if (current.hasMore && rows.length < this.resultPageSize)
            this.runResult.set({
              ...current,
              totalRows: next * this.resultPageSize + rows.length,
              hasMore: false,
            });
        }
      }
    } catch (error) {
      const current = this.runResult();
      if (
        selection !== this.historySelection ||
        set !== this.relatedResultSet() ||
        current !== result
      )
        return;
      this.resultPageRows.set(previousRows);
      this.runError.set(
        error instanceof Error ? error.message : 'Cannot load result page.',
      );
    } finally {
      if (requestGeneration === this.resultPageRequestGeneration)
        this.resultPageLoading.set(false);
    }
  }

  public async refreshLocalHistory(): Promise<void> {
    const projectRef = this.project?.ref,
      queryId = this.queryId;
    if (!projectRef || !queryId) return;
    const request = ++this.historyCatalogRequest,
      scope = this.historyScope();
    this.localResults.set([]);
    this.localHistoryLoading.set(true);
    try {
      const results = await this.federatedQuery.listLocalResults(
        { projectRef, queryId },
        (message) => {
          if (
            request === this.historyCatalogRequest &&
            this.historyScope() === scope
          )
            this.localHistoryError.set(message);
        },
      );
      if (
        request === this.historyCatalogRequest &&
        this.historyScope() === scope
      )
        this.localResults.set(results);
    } catch (error) {
      if (
        request === this.historyCatalogRequest &&
        this.historyScope() === scope
      )
        this.localHistoryError.set(
          error instanceof Error ? error.message : 'No local result available.',
        );
    } finally {
      if (
        request === this.historyCatalogRequest &&
        this.historyScope() === scope
      )
        this.localHistoryLoading.set(false);
    }
  }

  private historyScope(): string {
    return JSON.stringify([
      this.project?.ref.storeId,
      this.project?.ref.projectId,
      this.queryId,
    ]);
  }

  private authorRunParameterScope(): string {
    return JSON.stringify({
      project: this.project?.ref,
      history: this.historyScope(),
      environment: this.envId,
      securityContextId: this.agentContext.securityContextId(),
      resultTarget: this.currentResultTargetIdentity(),
    });
  }

  private invalidateHistoryRequests(): void {
    ++this.historySelection;
    ++this.historyCatalogRequest;
    ++this.resultPageRequestGeneration;
    this.localHistoryLoading.set(false);
    this.resultPageLoading.set(false);
    this.localHistoryError.set(undefined);
  }

  private invalidateFederatedRun(): void {
    this.authorRunAbort?.abort();
    this.authorRunAbort = undefined;
    ++this.federatedRunLifetime;
    this.running.set(false);
    this.federatedProgress.set(undefined);
    this.queryRunTiming.set(undefined);
  }

  private stopFederatedRun(): void {
    const lifetime = this.federatedRunLifetime;
    void this.federatedQuery.dispose().catch((error: unknown) => {
      if (lifetime === this.federatedRunLifetime)
        this.localHistoryError.set(
          error instanceof Error
            ? error.message
            : 'Cannot stop the previous execution.',
        );
    });
  }

  private invalidateHistoryScope(): void {
    ++this.authorLookupFocusRevision;
    ++this.authorPreviewLifetime;
    this.authorPreviewLoading.set(false);
    this.authorRowDetailsOpen.set(false);
    this.clearPreviewDiagnosticNavigation();
    this.authorPlan.set(undefined);
    this.setAuthorError(undefined);
    ++this.semanticRunLifetime;
    this.invalidateFederatedRun();
    this.stopFederatedRun();
    this.invalidateHistoryRequests();
    this.selectedHistoricalResult.set(undefined);
    this.historicalDefinition.set(undefined);
    this.executedGraphDefinition = undefined;
    this.setDisplayedResult(undefined);
    this.committedRun.set(undefined);
    this.runError.set(undefined);
    this.resultPageRows.set([]);
    this.localResults.set([]);
    this.resultPageIndex.set(0);
    this.relatedResultSet.set('affiliations');
  }

  /** Selecting history is a local read. It never invokes metadata, a Worker or a provider. */
  public async openHistoricalResult(id: string): Promise<void> {
    this.invalidateFederatedRun();
    const selection = ++this.historySelection,
      scope = this.historyScope();
    const current = (): boolean =>
      selection === this.historySelection && scope === this.historyScope();
    this.localHistoryLoading.set(true);
    this.localHistoryError.set(undefined);
    try {
      await this.federatedQuery.dispose();
      if (!current()) return;
      const opened = await this.federatedQuery.openLocalResult(id);
      if (!current()) return;
      this.selectedHistoricalResult.set(opened.result.localResult);
      this.historicalDefinition.set(opened.executedDefinition);
      this.executedGraphDefinition = opened.executedDefinition;
      this.relatedResultSet.set('affiliations');
      this.resultPageIndex.set(0);
      this.resultPageLoading.set(false);
      this.resultPageRows.set(opened.result.recordset.rows);
      this.setDisplayedResult(opened.result);
    } catch (error) {
      if (current())
        this.localHistoryError.set(
          error instanceof Error ? error.message : 'No local result available.',
        );
    } finally {
      if (current()) this.localHistoryLoading.set(false);
    }
  }

  public async changeRelatedResultSet(set: string): Promise<void> {
    const result = this.runResult();
    if (!result || !['affiliations', 'locations', 'aliases'].includes(set))
      return;
    ++this.historySelection;
    this.relatedResultSet.set(set);
    this.resultPageIndex.set(0);
    this.resultPageRows.set(
      set === 'affiliations'
        ? result.recordset.rows
        : (result.relatedRecordsets?.find((item) => item.id === set)?.recordset
            .rows ?? []),
    );
    this.resultPageLoading.set(false);
  }

  public async deleteHistoricalResult(id: string): Promise<void> {
    this.localHistoryLoading.set(true);
    this.localHistoryError.set(undefined);
    try {
      await this.federatedQuery.deleteLocalResult(id);
      if (
        this.selectedHistoricalResult()?.id === id ||
        this.runResult()?.localResult?.id === id ||
        this.committedRun()?.result.localResult?.id === id
      ) {
        this.invalidateHistoryScope();
      }
      await this.refreshLocalHistory();
    } catch (error) {
      this.localHistoryError.set(
        error instanceof Error
          ? error.message
          : 'Cannot delete the selected local result.',
      );
    } finally {
      this.localHistoryLoading.set(false);
    }
  }

  /** api-contract.md "Bounded lookups and HTTP" — the user's explicit choice to view a
   * recorded snapshot after a live `SOURCE_UNAVAILABLE` failure; never automatic. Reuses
   * the same request the live attempt sent, flipping `mode` AND naming the exact
   * `snapshotId` the server itself reported on the failed live attempt
   * (`availableSnapshot()`, `handleRunError`) — never fabricated or guessed client-side;
   * a request with no known snapshot id is refused rather than sent with an empty one
   * (the server's own `req.Validate()` would reject that anyway). */
  public runSnapshot(): void {
    const snapshot = this.availableSnapshot();
    if (!this.lastRequest || !this.lastRequestScope || !snapshot) {
      return;
    }
    this.queryRunTiming.set(undefined);
    this.running.set(true);
    this.runError.set(undefined);
    this.accessBlockers.set([]);
    this.sourceUnavailable.set(false);
    this.executeQuery(
      {
        ...this.lastRequest,
        mode: 'snapshot',
        snapshotId: snapshot.snapshotId,
      },
      this.lastRequestScope,
    );
  }

  private reportGitHubQueryDispatch(ref?: IProjectRef): void {
    if (
      !ref ||
      !hasQueryActivity(ref)
    ) {
      return;
    }
    this.githubProjectActivity
      .reportForCurrentProject(
        ref,
        this.randomIdService.newRandomId(),
        'query_execution_dispatched',
      )
      .subscribe({
        error: (error: unknown) =>
          this.errorLogger.logError(
            error,
            'Failed to record GitHub Business query activity',
          ),
      });
  }

  private reportGitHubQueryEdit(ref?: IProjectRef): void {
    if (
      !ref ||
      !hasQueryActivity(ref)
    ) {
      return;
    }
    const key = JSON.stringify({
      ref,
      queryId: this.queryId,
      bindingGeneration: this.githubProjectActivity.bindingGeneration,
    });
    const now = Date.now();
    const last = this.lastGitHubQueryEditReport;
    if (
      last?.key === key &&
      now - last.at < githubQueryEditReportMinIntervalMs
    ) {
      return;
    }
    this.lastGitHubQueryEditReport = { key, at: now };
    this.githubProjectActivity
      .reportForCurrentProject(
        ref,
        this.randomIdService.newRandomId(),
        'query_edit',
      )
      .subscribe({
        error: (error: unknown) =>
          this.errorLogger.logError(
            error,
            'Failed to record GitHub Business query edit activity',
          ),
      });
  }

  private executeQuery(
    request: RunQueryRequest,
    requestScope: {
      project: string;
      environment: string;
      securityContextId: string;
    },
  ): void {
    this.lastRequest = request;
    this.lastRequestScope = requestScope;
    const definition = this.queryDef();
    if (!definition) return;
    this.reportGitHubQueryDispatch(this.project?.ref);
    const executedDefinition = structuredClone(definition);
    const queryIdentity = this.currentQueryIdentity();
    const targetIdentity = this.currentResultTargetIdentity();
    const runStartedAt = monotonicTime();
    const lifetime = ++this.semanticRunLifetime;
    const current = (): boolean =>
      lifetime === this.semanticRunLifetime &&
      this.investigationContext.isCurrentScope(requestScope) &&
      this.currentQueryIdentity() === queryIdentity &&
      this.currentResultTargetIdentity() === targetIdentity;
    this.semanticApi.runQuery(request).subscribe({
      next: (response) => {
        // Task 15 item 4 — discard a late response for a scope the user has since left
        // (project/environment/principal switch mid-flight): api-contract.md "late
        // responses from another scope are discarded".
        if (!current()) return;
        const timing: QueryRunTiming = {
          allResultsLoadedMs: Math.max(0, monotonicTime() - runStartedAt),
          noRecords: response.recordset.rows.length === 0,
        };
        this.showAttemptResult(response);
        this.queryRunTiming.set(timing);
        this.commitSuccessfulResult(response, executedDefinition, timing);
        this.running.set(false);
      },
      error: (err: unknown) => {
        if (current()) this.handleRunError(err, request, requestScope);
      },
    });
  }

  private handleRunError(
    err: unknown,
    request: RunQueryRequest,
    requestScope: {
      project: string;
      environment: string;
      securityContextId: string;
    },
  ): void {
    if (!this.investigationContext.isCurrentScope(requestScope)) {
      // Late error response for a scope we've already left.
      return;
    }
    this.running.set(false);
    const envelope =
      err instanceof HttpErrorResponse
        ? tryDecodeErrorEnvelope(err.error)
        : undefined;
    if (this.isAuthorizationFailure(err, envelope?.error.code))
      this.invalidateHistoryScope();
    this.accessBlockers.set(
      envelope?.details?.authorization?.blockers.map(
        (b) => `${b.layerId ?? 'source'}: ${b.code}`,
      ) ?? [],
    );
    if (envelope?.error.code === 'TARGET_REQUIRED' && envelope.error.targets) {
      // Same authorized selector the context panel's needs-target Candidate renders —
      // never a hidden source (api-contract.md: "TARGET_REQUIRED errors return the same
      // authorized target options in error.targets, never hidden source IDs").
      this.availableTargets.set(envelope.error.targets);
      this.runError.set(
        'This query needs a target — choose one below and run again.',
      );
      return;
    }
    if (
      envelope?.error.code === 'SOURCE_UNAVAILABLE' &&
      request.mode === 'live'
    ) {
      this.sourceUnavailable.set(true);
      // LEAD ASSUMPTION 2026-09-10 (AvailableSnapshot's own doc comment) — exactly one
      // entry for Phase 1, or none when this query has no recorded fixture at all; the
      // template renders the "Use recorded snapshot" action only when this is set.
      this.availableSnapshot.set(envelope.details?.availableSnapshots?.[0]);
      this.runError.set('This source is unavailable right now.');
      return;
    }
    if (envelope?.error.code === 'STALE_CONTEXT') {
      // Old-principal facts must not survive a principal/policy-session change
      // (api-contract.md "Scope and identity"); Task 15 owns full reactive retry.
      this.investigationContext.clear();
      this.agentContext.refresh().subscribe({ error: () => undefined });
      this.runError.set(
        'Your session changed — context was cleared, please retry.',
      );
      return;
    }
    this.runError.set(envelope?.error.message ?? this.extractErrorMessage(err));
    this.errorLogger.logError(err, 'Failed to run query');
  }

  /** Renders an RFC3339 instant (`ResultProvenance.observedAt`, `AvailableSnapshot.
   * recordedAt`) as a plain calendar date for the result header / snapshot-action label —
   * "snapshot · recorded <date>" (api-contract.md), never the full timestamp, matching
   * datatug-cli's own `provenanceLine` CLI-output convention (`2006-01-02`). Falls back to
   * the raw string for a value that somehow isn't parseable, rather than throwing. */
  protected formatRecordedDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
  }

  protected committedDefinitionText(
    definition: CommittedQueryDefinition,
  ): string {
    const request = definition.request;
    if (request.queryType === QueryType.HTTP) {
      return `${request.method ?? 'HTTP'} request. URL and request body are omitted from this receipt for privacy.`;
    }
    if (typeof request.text === 'string') return request.text;
    return 'Executed request text is unavailable.';
  }

  protected committedDefinitionPins(
    definition: CommittedQueryDefinition,
  ): string | undefined {
    const plan = definition.nativeGraph;
    return plan ? JSON.stringify(plan, null, 2) : undefined;
  }

  protected formatQueryDuration(milliseconds: number): string {
    const rounded = Math.round(Math.max(0, milliseconds));
    return rounded < 1000
      ? `${rounded === 0 && milliseconds > 0 ? '<1' : rounded} ms`
      : `${(rounded / 1000).toFixed(1)} s`;
  }

  private extractErrorMessage(err: unknown): string {
    const message = (err as { message?: unknown } | undefined)?.message;
    return message ? String(message) : 'Failed to run the query';
  }

  private isAuthorizationFailure(err: unknown, code?: string): boolean {
    const normalizedCode = code?.toUpperCase();
    if (
      normalizedCode === 'ACCESS_DENIED' ||
      normalizedCode === 'UNAUTHENTICATED' ||
      normalizedCode === 'STALE_CONTEXT'
    )
      return true;
    if (err instanceof HttpErrorResponse && [401, 403].includes(err.status))
      return true;
    return /\b(?:ACCESS[_-]DENIED|UNAUTHENTICATED|UNAUTHORIZED|FORBIDDEN)\b|\bfailed\s*\([^)]*\b(?:401|403)\b[^)]*\)/i.test(
      this.extractErrorMessage(err),
    );
  }
}

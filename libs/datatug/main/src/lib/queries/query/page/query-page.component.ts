import { DemoTableDraftService } from '../../demo-table-draft.service';
import { queryContextScope } from '../../../session-context/session-query-scope';
import { savedMeaningChoices, type SavedMeaningChoice } from '../../semantic-meaning-reuse';
import { SemanticColumnHeaderComponent } from '../../semantic-column-header.component';
import { SemanticMappingDialogComponent } from '../../semantic-mapping-dialog.component';
import { validateSemanticModel, createSemanticModel, semanticQueryHash, semanticValidationState, type SemanticModel } from '../../semantic-mapping';
import { isDevicePersonalQuery } from '../../device-personal-queries';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { readGithubProjectId } from '@datatug/project-address';
import { SourceRightsNoticeComponent } from '@sneat/datatug-semantic';
import {
  DetectiveClientService,
  detectiveErrorMessage,
  type DetectiveRequestContext,
  type HostedQueryResponse,
} from '../../../detective/detective-client.service';
import { ValidationRunResultsComponent } from '../../../detective/validation-run-results.component';
import {
  caseRunLinkMessage,
  type ValidationRowSelection,
} from '../../../detective/detective-forms';
import type {
  CheckRun,
  DetectiveExecutionRef,
  DetectiveState,
} from '../../../detective/models';
import {
  formatTugQL,
  parseTugQL,
  type TugQLDiagnostic,
  type TugQLFormatOptions,
} from '@dalgo/core';
import { parseDocument as parseYamlDocument } from 'yaml';
import { NgTemplateOutlet } from '@angular/common';
import { HeldResultPresentationComponent } from '../../../board/ui/components/held-result-presentation/held-result-presentation.component';
import { prepareQueryResultChart, queryResultChartOptions } from './query-result-chart';
import { HttpErrorResponse } from '@angular/common/http';
import { PublicDataService } from '../../public-data/public-data.service';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { ProjectService } from '../../../services/project/project.service';
import { agentBaseUrl } from '../../../services/repo/agent-url';
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
  HostListener,
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
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Params, Router, NavigationEnd } from '@angular/router';
import { ResultsGridComponent } from '../../../components/results-grid/results-grid.component';
import {
  AgentLinkApiService,
  LinkProblemError,
} from '../../../agent-links/agent-link-api.service';
import { isLoopbackStore, routeParam } from '../../../agent-links/link-route';
import {
  RESULT_QUERY_PARAM,
  ResultMeta,
  StoredResult,
  pkFirstOrder,
  validResultId,
} from '../../../agent-links/query-result/query-result';
import {
  ResultEditorMode,
  ResultEditorPlan,
  resultEditorPlan,
} from '../../../agent-links/query-result/result-editor';
import {
  SavedResultBannerComponent,
  SavedResultBannerState,
} from '../../../agent-links/query-result/saved-result-banner.component';
import { routingParamStoreId } from '../../../core/datatug-routing-params';
import {
  isInternalKeyColumn,
  resultColumnDef,
} from '../../../components/results-grid/results-grid-columns';
import { gridStateKey } from '../../../components/results-grid/results-grid-state';
import { addIcons } from 'ionicons';
import { copyOutline, informationCircleOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import {
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

type WorkspaceTab = 'compose' | 'tugql' | 'preview' | 'sql' | 'dtql' | 'parameters' | 'sources' | 'related';

const hasQueryActivity = (ref?: IProjectRef): boolean =>
  !!ref &&
  ((isGithubStoreId(ref.storeId) && ref.projectApi === 'cloud') ||
    isSharedProjectRef(ref));


interface QueryResultGridRow {
  /** A cell is display text, or `null` for a database NULL (the grid draws it as a dimmed `null`). */
  readonly [columnId: string]: string | null;
}

type HostedRowStatus = 'pass' | 'fail' | 'unknown';

interface HostedQueryExecution {
  readonly result: FederatedQueryResult;
  readonly generation: number;
  readonly projectKey: string;
  readonly queryId: string;
  readonly environment: string;
  readonly execution: DetectiveExecutionRef;
  readonly queryRevision: string;
  readonly resultFingerprint: string;
  readonly run?: CheckRun;
  readonly validationPending?: boolean;
  readonly validationError?: string;
  readonly caseLinkNotice?: string;
}

interface LocalScenarioExecution {
  readonly projectKey: string;
  readonly queryId: string;
  readonly environment: string;
  readonly execution: DetectiveExecutionRef;
}

const sameExecution = (
  first: DetectiveExecutionRef | undefined,
  second: DetectiveExecutionRef | undefined,
): boolean =>
  !!first &&
  !!second &&
  first.storeId === second.storeId &&
  first.projectId === second.projectId &&
  first.executionId === second.executionId;

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
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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

/** A saved DTQL body is legacy only when its source positively names a YAML or
 * JSON query document. TugQL diagnostics are never evidence of a format switch. */
const isLegacyDtqlSource = (source: string): boolean => {
  const normalized = source.replace(/^\uFEFF/u, '');
  const firstLine = normalized.split(/\r?\n/u)
    .find((line) => line.trim() && !line.trimStart().startsWith('#') &&
      !/^(?:---|\.\.\.)(?:\s|$)/u.test(line.trimStart()) &&
      !/^%(?:YAML|TAG)\b/u.test(line.trimStart()))
    ?.trimStart() ?? '';
  // All root keys accepted by @dalgo/core's DTQL document model. A known
  // mapping key keeps an incomplete YAML draft in its original editor.
  if (/^(?:from|where|orderBy|limit|offset|columns|groupBy|having|money):(?:\s|$)/u.test(firstLine))
    return true;
  try {
    // The actual YAML reader also accepts JSON and flow mappings. This only
    // identifies the saved source format; query validity remains the engine's job.
    const parsed = parseYamlDocument(normalized, {
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (parsed.errors.length) return false;
    const document: unknown = parsed.toJS();
    return !!document && typeof document === 'object' && !Array.isArray(document) &&
      Object.hasOwn(document, 'from');
  } catch {
    return false;
  }
};

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
  (diagnostic.code === 'input_too_large' ||
    diagnostic.code === 'expected_from') &&
  diagnostic.span.start.line === 1 &&
  diagnostic.span.start.column === 1 &&
  diagnostic.span.end.line === 1 &&
  diagnostic.span.end.column === 1;
import { RandomIdService } from '@sneat/random';
import { distinctUntilChanged, takeUntil, filter, take } from 'rxjs/operators';
import { firstValueFrom, map, Subject, Subscription } from 'rxjs';
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
  IonPopover,
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
  decodeTypedValue,
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
import {
  IProjectRef,
  equalProjectRef,
  isSharedProjectRef,
} from '../../../core/project-context';
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
import { IParameter, IParameterDef } from '../../../models/definition/parameter';
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
import { GitHubReauthorizationBannerComponent } from '../../../project/new-project/github-reauthorization-banner.component';
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
import { QueryDispatchService } from '../../query-dispatch.service';
import type { QueryExecutionSession } from '../../query-dispatch';
import type { QueryRuntimeOption } from '../../query-runtime-registry.service';
import { SessionWorkspaceService } from '../../../session-context/session-workspace.service';
import { SessionResultCacheService, tryWriteSessionResultCache } from '../../../session-context/session-result-cache.service';
import { sessionResultFingerprint } from '../../../session-context/session-result-fingerprint';
import type { ContextDefinitionDocument } from '../../../session-context/session-context-contract';
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
import { transferSqlToTugql } from './sql-tugql-transfer';
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

let queryParameterEditorId = 0;

@Component({
  selector: 'sneat-datatug-sql-editor',
  templateUrl: './query-page.component.html',
  styleUrl: './query-page.component.scss',
  imports: [
    SemanticMappingDialogComponent,
    GitHubReauthorizationBannerComponent,
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
    ResultsGridComponent,
    SavedResultBannerComponent,
    HeldResultPresentationComponent,
    ValidationRunResultsComponent,
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
    IonPopover,
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
  public readonly parameterDetailsPrefix = `query-parameter-details-${++queryParameterEditorId}`;
  private readonly sessionWorkspace = inject(SessionWorkspaceService, { optional: true });
  private readonly route = inject(ActivatedRoute);
  private readonly contextSessionId = toSignal(this.route.paramMap.pipe(map((params) => params.get('sessionId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('sessionId') ?? '',
  });
  private readonly sessionPinning = signal(false);
  private readonly sessionRecordedRun = signal<string | undefined>(undefined);
  private readonly sessionRecordedInput = signal('');
  private readonly sessionRecordedSessionId = signal('');
  private sessionCompletionGeneration = 0;
  private readonly sessionResultCache = inject(SessionResultCacheService);
  public readonly sqlQueryType = QueryType.SQL;

  private readonly injector = inject(Injector);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly randomIdService = inject(RandomIdService);
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly documentTitle = inject(Title);
  private readonly githubProjectActivity = inject(GitHubProjectActivityService);
  private readonly router = inject(Router);
  private readonly queryContextSqlService = inject(QueryContextSqlService);
  private readonly queriesService = inject(QueriesService);
  public readonly agentRunEnvironments = signal<IEnvironmentFull[]>([]);
  public readonly agentRunEnvironmentsLoading = signal(false);
  public readonly agentRunEnvironmentsError = signal('');
  public readonly agentSelectedEnvironment = signal('');
  private readonly federatedQuery = inject(FederatedQueryService);
  private demoDraftAttempt?: string;
  private demoDraftEntry?: { token: string; routeKey: string; queryId: string };
  private demoDraftGeneration = 0;
  private async restoreDemoTableDraft(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const token = params?.get('demoDraft');
    const ref = this.project?.ref;
    const id = this.queryId;
    if (!token || !ref || !id || this.demoDraftAttempt === token) return;
    // Project context can arrive before route initialization. Never start an
    // unsaved table handoff against the editor selected by the previous page.
    if (!params.get('id') && !this.route.snapshot.paramMap.get('queryId') &&
      (this.demoDraftEntry?.token !== token || this.demoDraftEntry.queryId !== id)) return;
    this.demoDraftAttempt = token;
    const generation = ++this.demoDraftGeneration;
    const isCurrent = () => generation === this.demoDraftGeneration && this.demoDraftAttempt === token && equalProjectRef(ref, this.project?.ref) && this.queryId === id && this.route.snapshot.queryParamMap.get('demoDraft') === token;
    if (params.get('id') || this.route.snapshot.paramMap.get('queryId')) { this.runError.set('A table draft cannot replace an existing saved query. Return to your browser database.'); return; }
    try {
      this.runError.set(undefined);
      const actor = (await firstValueFrom(this.queriesService.authentication())).user?.uid;
      if (!actor) throw new Error('Sign in to the account that opened this edited browser database.');
      const definition = await this.injector.get(DemoTableDraftService).read(token, ref, params.get('runtime'), params.get('env'), actor);
      if ((await firstValueFrom(this.queriesService.authentication())).user?.uid !== actor) throw new Error('Sign in to the account that opened this edited browser database.');
      if (!isCurrent()) return;
      const current = this.queryEditorStateService.getQueryState(id);
      if (current?.request && 'text' in current.request && (current.request as ITextQueryRequest).text.trim()) throw new Error('This query already has an unsaved draft. Open Query this table in a new query to keep your edits.');
      this.queryEditorStateService.updateQueryState({ ...current, id, isNew: true, isLoading: false, queryType: QueryType.DTQL, def: { ...definition, id }, request: definition.request, connectionId: definition.connectionId });
      this.injector.get(DemoTableDraftService).consume(token);
    } catch (error) {
      if (isCurrent()) {
        this.demoDraftAttempt = undefined;
        this.runError.set(error instanceof Error ? error.message : 'The browser table draft is unavailable. Return to your browser database.');
      }
    }
  }
  private readonly queryDispatch = inject(QueryDispatchService);
  private activeDispatchSession?: QueryExecutionSession;
  public readonly workingCopyOptions = signal<readonly QueryRuntimeOption[]>([]);
  public readonly selectedWorkingCopy = signal('project');
  public readonly workingCopyLoading = signal(false);
  public readonly workingCopyError = signal<string | undefined>(undefined);
  public readonly unavailableWorkingCopy = signal(false);
  private readonly entryRuntimeHint = signal<{
    selectionId: string;
    queryId?: string;
    resultId?: string;
    environment?: string;
  } | undefined>(undefined);
  private readonly entryContextRevision = signal(0);
  private entryRouteKey = '';
  private entryLoadKey = '';
  private workingCopyScope = '';
  private workingCopyLoad = 0;
  private workingCopyRevision = -1;

  private currentWorkingCopyScope(): string {
    return JSON.stringify({ project: this.project?.ref, queryId: this.queryId,
      connection: this.queryDef()?.connectionId, environment: this.envId,
      principal: this.agentContext.securityContextId() });
  }

  private currentBrowserDispatchScope(): string {
    return JSON.stringify({ project: this.project?.ref, environment: this.envId });
  }

  public async loadWorkingCopies(): Promise<void> {
    const definition = this.queryDef();
    const ref = this.project?.ref;
    if (!ref || !definition?.connectionId || this.isTugqlAuthorJourney()) return;
    const scope = this.currentWorkingCopyScope();
    const routeKey = this.entryRouteKey;
    const load = ++this.workingCopyLoad;
    this.workingCopyLoading.set(true);
    this.workingCopyError.set(undefined);
    try {
      const options = await this.queryDispatch.availableWorkingCopies({ projectRef: ref, definition, environment: this.envId });
      if (load !== this.workingCopyLoad || scope !== this.currentWorkingCopyScope() || routeKey !== this.entryRouteKey) return;
      this.workingCopyOptions.set(options);
      this.workingCopyScope = scope;
      this.workingCopyRevision = this.queryDispatch.runtimeRevision();
      const hint = this.entryRuntimeHint();
      if (hint?.queryId && hint.queryId === this.queryId &&
        (!hint.environment || hint.environment === this.envId)) {
        this.entryRuntimeHint.set(undefined);
        this.selectedWorkingCopy.set(hint.selectionId);
      }
      const unavailable = this.selectedWorkingCopy() !== 'project' &&
        !options.some((option) => option.selectionId === this.selectedWorkingCopy());
      this.unavailableWorkingCopy.set(unavailable);
      if (unavailable) this.workingCopyError.set('The selected working copy is unavailable. Choose a current runtime explicitly.');
    } catch (error) {
      if (load === this.workingCopyLoad && routeKey === this.entryRouteKey) {
        this.unavailableWorkingCopy.set(this.selectedWorkingCopy() !== 'project');
        this.workingCopyError.set(error instanceof Error ? error.message : 'Working copies could not be checked.');
      }
    } finally {
      if (load === this.workingCopyLoad) this.workingCopyLoading.set(false);
    }
  }

  public selectWorkingCopy(selectionId: string): void {
    this.entryRuntimeHint.set(undefined);
    this.unavailableWorkingCopy.set(false);
    this.workingCopyError.set(undefined);
    if (!this.changeWorkingCopySelection(selectionId)) return;
    if (this.isCurrentRoute()) {
      void this.router.navigate([], { relativeTo: this.route, replaceUrl: true,
        queryParams: { runtime: selectionId }, queryParamsHandling: 'merge' });
    }
  }

  private changeWorkingCopySelection(selectionId: string): boolean {
    if (selectionId === this.selectedWorkingCopy()) return false;
    this.invalidateFederatedRun();
    this.stopFederatedRun();
    this.setDisplayedResult(undefined);
    this.selectedWorkingCopy.set(selectionId);
    return true;
  }

  private scheduleEntryRuntimeLoad(): void {
    if (this.selectedWorkingCopy() !== 'project' && this.workingCopyScope &&
      this.workingCopyScope !== this.currentWorkingCopyScope()) {
      ++this.workingCopyLoad;
      this.workingCopyScope = '';
      this.workingCopyOptions.set([]);
      this.unavailableWorkingCopy.set(true);
      this.workingCopyError.set('The selected working copy is unavailable in this context. Choose a current runtime explicitly.');
    }
    this.entryContextRevision.update((revision) => revision + 1);
  }
  private readonly publicSqliteQuery = inject(PublicSqliteQueryService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly detectiveClient = inject(DetectiveClientService);
  public readonly hostedDetectiveState = signal<DetectiveState | undefined>(
    undefined,
  );
  private readonly hostedDetectiveProjectRef = signal<IProjectRef | undefined>(
    undefined,
  );
  private readonly hostedDetectiveLoadedScope = signal<string | undefined>(
    undefined,
  );
  private hostedDetectiveRequestKey?: string;
  private hostedDetectiveRequestGeneration = 0;
  public readonly hostedDetectiveError = signal<string | undefined>(undefined);
  public readonly hostedEnvironment = signal('');
  private readonly hostedExecution = signal<HostedQueryExecution | undefined>(
    undefined,
  );
  private readonly localScenarioExecution = signal<
    LocalScenarioExecution | undefined
  >(undefined);
  public readonly hostedStatusFilter = signal<'all' | HostedRowStatus>('all');
  public readonly hostedSelectedRow = signal<number | undefined>(undefined);
  public readonly hostedScenarioBusy = signal(false);
  private hostedScenarioCompletionToken = 0;
  public readonly hostedScenarioMessage = signal('');
  public readonly hostedScenarioError = signal('');
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

  private workspaceTabBar?: ElementRef<HTMLElement>;
  private workspaceTabResizeObserver?: ResizeObserver;
  private workspaceTabRevealFrame?: number;

  @ViewChild('workspaceTabBar', { read: ElementRef })
  private set workspaceTabBarRef(ref: ElementRef<HTMLElement> | undefined) {
    this.workspaceTabResizeObserver?.disconnect();
    this.workspaceTabBar = ref;
    if (!ref || typeof ResizeObserver === 'undefined') return;
    this.workspaceTabResizeObserver = new ResizeObserver(() => this.scheduleWorkspaceTabReveal());
    this.workspaceTabResizeObserver.observe(ref.nativeElement);
  }

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
  public readonly authorMode = signal<'compose' | 'code' | 'preview'>(
    'compose',
  );
  public readonly workspaceTab = signal<WorkspaceTab>('tugql');
  private readonly loadedTextRepresentation = signal<
    { readonly scope: string; readonly kind: 'tugql' | 'dtql' } | undefined
  >(undefined);
  public readonly isNativeDtqlWorkspace = computed(() =>
    this.queryDef()?.request.queryType === QueryType.DTQL &&
    this.loadedTextRepresentation()?.kind === 'dtql',
  );
  public readonly isTextQueryWorkspace = computed(() => {
    const type = this.queryDef()?.request.queryType;
    return type === QueryType.SQL || type === QueryType.DTQL || type === QueryType.TugQL;
  });
  /** More columns than this and the Current row pane starts closed, so the grid has the width. */
  public readonly currentRowOpenMaxColumns = 6;
  /** The person's choice to open or close the Current row pane; undefined until they choose. */
  private readonly currentRowPaneChoice = signal<boolean | undefined>(undefined);
  public readonly currentRowPaneOpen = computed(
    () =>
      this.currentRowPaneChoice() ??
      (this.displayedRecordset()?.columns.filter(
        (c) => !isInternalKeyColumn(c.name),
      ).length ?? 0) <= this.currentRowOpenMaxColumns,
  );
  public toggleCurrentRowPane(): void {
    this.currentRowPaneChoice.set(!this.currentRowPaneOpen());
  }
  public readonly isNativeSqlWorkspace = computed(() =>
    this.queryDef()?.request.queryType === QueryType.SQL,
  );
  public readonly sqlTugqlTransfer = computed(() => transferSqlToTugql(this.queryDef()));
  private readonly authorFormatUndo = signal<AuthorFormatUndo | undefined>(
    undefined,
  );
  private readonly authorRelationshipUndo = signal<
    AuthorRelationshipUndo | undefined
  >(undefined);
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
    )
      return true;
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
  private readonly authorRunParameterAttempt = signal<
    | {
        readonly scope: string;
        readonly definition: IQueryDef | undefined;
        readonly binding: string;
        readonly draftRevision: number;
      }
    | undefined
  >(undefined);
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
    if (this.queryState.isSaving)
      return { blocked: true, message: 'Saving query…' };
    if (this.authorPreviewLoading())
      return { blocked: true, message: 'Preparing SQL preview…' };
    if (!this.queryId || !this.project || !this.queryDef())
      return {
        blocked: true,
        message: 'Waiting for the query and project to load.',
      };
    if (this.authorUnsupportedParameterNames().length)
      return {
        blocked: true,
        message: 'This draft has parameters that this form cannot bind.',
        action: 'code',
      };
    if (!this.authorHasCustomerIdParameter())
      return {
        blocked: true,
        message:
          'This parameter-free draft is unavailable in the current runner. Review a supported parameterized draft.',
        action: 'code',
      };
    const plan = this.authorPlan();
    if (
      this.authorError() &&
      (!plan || plan.draftRevision !== this.authorDraftRevision())
    )
      return {
        blocked: true,
        message: 'SQL preview needs attention. Review the draft error.',
        action: this.canNavigateToAuthorPreviewSyntaxDiagnostic()
          ? 'error'
          : 'code',
      };
    if (!this.authorCustomerIdValid())
      return {
        blocked: true,
        message: this.authorCustomerIdMissing()
          ? 'Customer ID is required to Run.'
          : 'Customer ID must be a whole number.',
        action: 'parameters',
      };
    if (!plan || plan.draftRevision !== this.authorDraftRevision()) {
      return {
        blocked: true,
        message: 'Preview the current draft to enable Run.',
        action: 'preview',
      };
    }
    return {
      blocked: false,
      message: this.authorHasCustomerIdParameter()
        ? 'Ready to Run with Customer ID ' + this.authorCustomerId() + '.'
        : 'Ready to Run the current preview.',
    };
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
      case 'error':
        this.navigateToAuthorPreviewSyntaxDiagnostic();
        break;
      case 'code':
        this.setAuthorMode('code');
        break;
    }
  }

  @ViewChild('authorCustomerInput') private authorCustomerInput?: IonInput;
  private authorParameterFocusRevision = 0;

  private focusAuthorParameterAfterRender(): void {
    const revision = ++this.authorParameterFocusRevision;
    const definition = this.queryDef();
    const scope = this.historyScope();
    const current = (): boolean =>
      revision === this.authorParameterFocusRevision &&
      this.queryDef() === definition &&
      this.historyScope() === scope &&
      this.queryView() === 'author' &&
      this.activeAuthorContextTab() === 'parameters' &&
      !this.running() &&
      !this.queryState.isSaving;
    this.changeDetector.markForCheck();
    afterNextRender(
      () => {
        if (current()) void this.authorCustomerInput?.setFocus();
      },
      { injector: this.injector },
    );
  }
  public readonly queryView = signal<'author' | 'compare'>('author');
  public readonly comparisonSnapshot = signal<
    ComparisonSessionSnapshot | undefined
  >(undefined);
  public readonly comparisonResult = signal<SessionCompareResult | undefined>(
    undefined,
  );
  public readonly comparisonBusy = signal(false);
  public readonly comparisonMessage = signal('');
  public readonly comparisonCustomerBinding = signal(
    'No comparison pair has been run.',
  );
  public readonly comparisonQueryLimit = signal('—');
  /** Access comes from the ref-matched project summary, never ambient auth state. */
  public readonly comparisonProjectAccess = signal<
    'public' | 'private' | 'protected' | undefined
  >(undefined);
  public readonly comparisonBlocker = computed(() => {
    const project = this.project?.ref;
    if (
      !project ||
      !isGithubStoreId(project.storeId) ||
      project.spaceID !== undefined ||
      project.projectApi === 'cloud'
    )
      return 'Compare is available for admitted public GitHub projects.';
    if (this.comparisonProjectAccess() !== 'public')
      return 'Public project access is required; wait for the matching project summary to load.';
    const definition = this.queryDef();
    if (
      !definition ||
      !this.isTugqlAuthorJourney() ||
      definition.connectionId !== 'chinook-sqlite'
    )
      return 'Compare is available for the admitted Chinook Invoice TugQL query.';
    const plan = this.authorPlan();
    if (!plan || plan.draftRevision !== this.authorDraftRevision())
      return 'Preview SQL to check the current draft before running both fixtures.';
    if (plan.expandedSource !== undefined)
      return 'Review and apply the displayed relationship completion in Code, then Preview the updated draft before comparing.';
    if (
      plan.authorProof.profile !== 'invoice-query' ||
      !plan.relationship ||
      !Number.isSafeInteger(plan.authorProof.resolvedQuery.limit) ||
      (plan.authorProof.resolvedQuery.limit ?? 0) < 1 ||
      (plan.authorProof.resolvedQuery.limit ?? 101) > 100
    )
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
    if (this.isNativeDtqlWorkspace()) return false;
    const source = this.queryBodyText();
    if (!source) return false;
    const parsed = parseTugQL(source);
    const hasDeclaredParameter = parsed.document.tree?.parameters?.some(
      (parameter) => parameter.name.toLowerCase() === 'customerid',
    );
    if (hasDeclaredParameter) return true;
    if (parsed.diagnostics.length) return /@CustomerId\b/iu.test(source);
    return false;
  });
  public readonly authorParameterDeclarationCount = computed(() => {
    if (this.isNativeSqlWorkspace() || this.isNativeDtqlWorkspace())
      return this.queryDef()?.parameters?.length ?? 0;
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
    if (!this.isTugqlAuthorJourney()) return undefined;
    const metadata = this.authorSourceMetadata();
    const inventory = this.authorParticipatingSourceInventory();
    if (!metadata || !inventory.available) return undefined;
    const main = inventory.sources.find((source) => source.kind === 'main');
    if (
      main?.name.toLowerCase() !== 'invoice' ||
      (main.schema !== undefined && main.schema !== 'main') ||
      main.database
    )
      return undefined;
    if (
      inventory.sources.some(
        (source) =>
          source.kind !== 'main' &&
          !(
            source.kind === 'join' &&
            source.name.toLowerCase() === 'customer' &&
            source.removable &&
            (source.schema === undefined || source.schema === 'main') &&
            !source.database
          ),
      )
    )
      return undefined;
    return inventory.customerJoined ? 0 : 1;
  }
  public authorSourceOccurrenceCount(): number | undefined {
    if (this.isNativeDtqlWorkspace()) return undefined;
    if (this.isNativeSqlWorkspace()) {
      const transfer = this.sqlTugqlTransfer();
      return transfer.supported ? transfer.sourceCount : undefined;
    }
    const inventory = this.authorParticipatingSourceInventory();
    return inventory.available ? inventory.sources.length : undefined;
  }
  public authorParameterCountLabel(): string {
    const count = this.authorParameterDeclarationCount();
    return count === undefined
      ? 'Parameter count unavailable'
      : `${count} parameter${count === 1 ? '' : 's'}`;
  }
  public authorSourceCountLabel(): string {
    const count = this.authorSourceOccurrenceCount();
    return count === undefined
      ? 'Source count unavailable'
      : `${count} participating source${count === 1 ? '' : 's'}`;
  }
  public authorRelatedSourceCountLabel(): string {
    const count = this.authorRelatedSourceCount();
    return count === undefined
      ? 'Related source count unavailable'
      : `${count} available related source${count === 1 ? '' : 's'}`;
  }
  public readonly activeAuthorContextTab = computed(
    () => {
      const tab = this.workspaceTab();
      return tab === 'parameters' || tab === 'sources' || tab === 'related'
        ? tab
        : undefined;
    },
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
  public readonly authorSourceDiscovery = signal<
    PublicSqliteSourceDiscovery | undefined
  >(undefined);
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
    readonly relationship: NonNullable<
      IQueryDef['relationshipBindings']
    >[number];
  };
  public readonly authorSourceReview = signal<
    AuthorRelationshipSourceReview | undefined
  >(undefined);
  public readonly authorSourceSelectedFields = signal<
    readonly AuthorCustomerField[]
  >(['FirstName']);
  public readonly authorCanJoinRelationship = computed(() => {
    if (
      this.authorSourceLoading() ||
      this.running() ||
      this.queryState.isSaving === true
    )
      return false;
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    return (
      !!context &&
      !!discovery &&
      reviewAuthorRelationshipSource(context.source, [], discovery.relationship)
        .ok
    );
  });
  public readonly authorCanRemoveCustomerJoin = computed(() => {
    if (
      this.authorSourceLoading() ||
      this.running() ||
      this.queryState.isSaving === true
    )
      return false;
    const context = this.currentAuthorSourceContext();
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    const binding = definition?.relationshipBindings?.find(
      (candidate) =>
        candidate.id === discovery?.relationship.id &&
        candidate.version === discovery.relationship.version,
    );
    return (
      !!context &&
      !!definition &&
      !!binding &&
      removeAuthorCustomerJoin(context.source, binding).ok
    );
  });
  public authorCustomerJoinRemovalReason(): string | undefined {
    if (this.running() || this.queryState.isSaving === true)
      return 'Source edits are unavailable while the query is running or saving.';
    const context = this.currentAuthorSourceContext();
    if (!context)
      return 'The current project and query context is unavailable.';
    const definition = this.queryDef();
    const discovery = this.authorSourceMetadata();
    if (!discovery)
      return 'Current source metadata must be admitted again before this JOIN can be removed.';
    const binding = definition?.relationshipBindings?.find(
      (candidate) =>
        candidate.id === discovery.relationship.id &&
        candidate.version === discovery.relationship.version,
    );
    if (!binding)
      return 'This JOIN has no matching admitted relationship binding.';
    const proposal = removeAuthorCustomerJoin(context.source, binding);
    return proposal.ok ? undefined : proposal.reason;
  }
  public readonly authorCustomerOutputChoices: readonly AuthorCustomerField[] =
    Object.freeze(['FirstName', 'LastName', 'Email']);
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
      this.queryDef()?.request.queryType === QueryType.DTQL &&
      !this.isNativeDtqlWorkspace(),
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
  private readonly authorSavedDefinition = signal<
    | {
        readonly queryId: string;
        readonly saved: IQueryDef;
        readonly local: IQueryDef;
      }
    | undefined
  >(undefined);

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

  public get isHostedProject(): boolean {
    return (
      !!this.project &&
      isSharedProjectRef(this.project.ref) &&
      !isDevicePersonalQuery(this.queryId ?? '')
    );
  }

  public hostedScenarioTarget():
    | {
        caseId: string;
        applicationId: string;
        stepId: string;
      }
    | undefined {
    if (isDevicePersonalQuery(this.queryId ?? '')) return undefined;
    const params = this.route.snapshot.queryParamMap;
    const caseId = params.get('caseId');
    const applicationId = params.get('applicationId');
    const stepId = params.get('scenarioStepId');
    const item = this.hostedDetectiveState()?.cases.find(
      (candidate) => candidate.id === caseId,
    );
    const application = item?.scenarioApplications?.find(
      (candidate) => candidate.id === applicationId,
    );
    const step = application?.snapshot.steps.find(
      (candidate) => candidate.id === stepId,
    );
    const receipt = application?.steps.find(
      (candidate) => candidate.stepId === stepId,
    );
    return caseId &&
      applicationId &&
      stepId &&
      item?.status === 'active' &&
      step?.kind === 'query' &&
      step.ref === this.queryId &&
      receipt?.status === 'pending'
      ? { caseId, applicationId, stepId }
      : undefined;
  }

  public activeLocalScenarioExecution(): LocalScenarioExecution | undefined {
    const ref = this.project?.ref;
    const receipt = this.localScenarioExecution();
    const target = this.hostedScenarioTarget();
    return ref &&
      target &&
      !isSharedProjectRef(ref) &&
      receipt?.projectKey === JSON.stringify(ref) &&
      receipt.queryId === this.queryId &&
      receipt.environment === (this.queryState.activeEnv?.id ?? this.envId)
      ? receipt
      : undefined;
  }

  private detectiveContext(
    ref: IProjectRef,
  ): DetectiveRequestContext | undefined {
    if (isSharedProjectRef(ref)) {
      return ref.spaceID
        ? {
            kind: 'cloud',
            storage: 'firestore',
            spaceID: ref.spaceID,
            project: ref.projectId,
          }
        : undefined;
    }
    if (
      isBrowserSqlProject(ref) ||
      ref.storeId === 'firestore' ||
      ref.projectApi === 'cloud'
    )
      return undefined;
    const securityContextId = this.agentContext
      .contextFor(agentBaseUrl(ref.storeId))
      .securityContextId();
    return securityContextId
      ? {
          kind: 'agent',
          agentStoreId: ref.storeId,
          project: ref.projectId,
          securityContextId,
          branch: ref.branch,
        }
      : undefined;
  }

  private detectiveScopeKey(
    ref: IProjectRef,
    context: DetectiveRequestContext,
  ): string {
    return JSON.stringify({ ref, context });
  }

  private hasCurrentDetectiveState(): boolean {
    const ref = this.project?.ref;
    const context = ref ? this.detectiveContext(ref) : undefined;
    return !!ref &&
      !!context &&
      this.hostedDetectiveLoadedScope() ===
        this.detectiveScopeKey(ref, context);
  }

  public get queryValidatorsHref(): string | undefined {
    const queryId = this.queryId;
    if (
      !queryId ||
      isDevicePersonalQuery(queryId) ||
      this.queryState.isNew ||
      !this.project?.ref
    ) return undefined;
    const href = projectPageHref(this.project.ref, 'checks');
    return `${href}${href.includes('?') ? '&' : '?'}query=${encodeURIComponent(queryId)}`;
  }

  public queryFolderPath = '';
  private readonly backTarget = signal(0);

  /** Where the back button goes with no history: the project's queries, in the folder of this query. */
  public get queriesBackHref(): string {
    // Read so the template binding is re-evaluated when the project or the folder is known later than the first render.
    this.backTarget();
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
  private readonly nativeParameterDrafts = signal<ReadonlyMap<string, string>>(new Map());
  private readonly nativeParameterErrors = signal<ReadonlyMap<string, string>>(new Map());
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
    hasBlockingBindings(this.bindings()) || this.nativeParameterErrors().size > 0,
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
  /** Presentation choices belong to the current held result, never the query definition. */
  public readonly resultChartView = signal<'grid' | 'chart'>('grid');
  public readonly resultChartCategory = signal('');
  public readonly resultChartMeasure = signal('');
  public readonly resultChartOptions = computed(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    return result && recordset
      ? queryResultChartOptions(result, recordset, this.resultTotalRows())
      : { categories: [], measures: [], reason: 'Run a query to choose chart columns.' };
  });
  public readonly resultChartFields = computed(() => ({
    categoryColumn: this.resultChartCategory(),
    measureColumn: this.resultChartMeasure(),
    title: 'Saved query result',
  }));
  public readonly resultChartReason = computed(() => {
    const options = this.resultChartOptions();
    if (options.reason) return options.reason;
    if (!options.categories.includes(this.resultChartCategory()) ||
        !options.measures.includes(this.resultChartMeasure()))
      return 'Choose a category and count column to chart this result.';
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    if (!result || !recordset) return 'Run a query to choose chart columns.';
    const prepared = prepareQueryResultChart(result, recordset, this.resultChartFields());
    return prepared.ok ? '' : prepared.message;
  });
  public readonly resultChartVisible = computed(() =>
    this.resultChartView() === 'chart' && !this.resultChartReason(),
  );
  /**
   * What the Results panel says when no chart can be drawn. The saved rows of a stored result are a snapshot read
   * from a file, with no source usage rights to chart by, so they say when charts become available instead of a
   * rights error.
   */
  public readonly resultChartUnavailableText = computed(() => {
    const reason = this.resultChartOptions().reason;
    if (!reason) return '';
    return this.runResult()?.provenance.mode === 'snapshot' &&
      this.savedResultBanner()?.kind === 'shown'
      ? 'Full-result chart preview is available after running the query.'
      : `Full-result chart preview unavailable: ${reason} Loaded rows remain available in the grid.`;
  });
  public readonly resultChartHeld = computed(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    return result && recordset ? { ...result, recordset } : null;
  });
  public setResultChartCategory(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.resultChartCategory.set(value);
    this.resultChartView.set('grid');
  }
  public setResultChartMeasure(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.resultChartMeasure.set(value);
    this.resultChartView.set('grid');
  }
  private readonly executionCopyFeedback = signal<
    | {
        readonly receipt: PublicSqliteExecutionReceipt;
        readonly text: string;
      }
    | undefined
  >(undefined);
  private executionCopyGeneration = 0;
  public readonly executionCopyStatus = computed(() => {
    const feedback = this.executionCopyFeedback();
    return feedback &&
      feedback.receipt === this.runResult()?.publicSqliteReceipt
      ? feedback.text
      : '';
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
        this.executionCopyFeedback.set({
          receipt,
          text: `Couldn't copy ${label}. Try again.`,
        });
      return;
    }
    try {
      await write;
      if (
        this.executionCopyGeneration === generation &&
        this.runResult()?.publicSqliteReceipt === receipt
      )
        this.executionCopyFeedback.set({ receipt, text: `${label} copied` });
    } catch {
      if (
        this.executionCopyGeneration === generation &&
        this.runResult()?.publicSqliteReceipt === receipt
      )
        this.executionCopyFeedback.set({
          receipt,
          text: `Couldn't copy ${label}. Try again.`,
        });
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
  public readonly activeHostedExecution = computed(() => {
    const execution = this.hostedExecution();
    return !isDevicePersonalQuery(this.queryDef()?.id ?? this.queryId ?? '') &&
      execution &&
      execution.result === this.runResult() &&
      execution.generation === this.displayedResultGeneration() &&
      execution.projectKey === JSON.stringify(this.project?.ref) &&
      execution.queryId === this.queryId &&
      execution.environment === this.hostedEnvironment() &&
      !this.selectedHistoricalResult() &&
      !this.displayedResultIsPreviousRun() &&
      this.relatedResultSet() === 'affiliations'
      ? execution
      : undefined;
  });
  public readonly hostedRowStatuses = computed(() => {
    const execution = this.activeHostedExecution();
    const statuses = new Map<number, HostedRowStatus>();
    if (
      !execution?.run ||
      execution.run.executionStatus !== 'completed' ||
      !sameExecution(execution.execution, execution.run.steps[0]?.execution)
    )
      return statuses;
    // Nested Check rows belong to their own query execution and must not be
    // projected onto the root query's row indexes.
    for (const row of execution.run.steps[0].validators || []) {
      if (row.rowIndex === undefined) continue;
      const outcome: HostedRowStatus =
        row.outcome === 'fail'
          ? 'fail'
          : row.outcome === 'pass'
            ? 'pass'
            : 'unknown';
      const old = statuses.get(row.rowIndex);
      if (
        outcome === 'fail' ||
        (outcome === 'unknown' && old !== 'fail') ||
        !old
      )
        statuses.set(row.rowIndex, outcome);
    }
    return statuses;
  });
  public readonly hostedSelectedRowCells = computed(() => {
    const index = this.hostedSelectedRow();
    const execution = this.activeHostedExecution();
    if (index === undefined || !execution) return undefined;
    const row = execution.result.recordset.rows[index];
    return row?.map((value, column) => ({
      name:
        execution.result.recordset.columns[column]?.name ??
        `Column ${column + 1}`,
      value: displayQueryResultValue(value),
    }));
  });
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
    return (
      result.relatedRecordsets?.some(
        (set) => set.id === this.relatedResultSet(),
      ) ?? true
    );
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
  readonly semanticValidation = computed(() => semanticValidationState(
    this.queryDef()?.semanticModel, this.semanticBasis(), this.semanticCurrentHash(), this.displayedResultIsPreviousRun(),
  ));
  readonly semanticNeedsReview = computed(() => this.semanticValidation() === 'review');
  semanticColumnLabel(index: number): string {
    const bundle = this.semanticSaving() ? this.semanticBeforeSave() : this.queryDef()?.semanticModel;
    const binding = bundle?.bindings.find(item => item.columnIndex === index);
    const property = bundle?.meaning.concepts.find(item => item.id === binding?.concept);
    const entity = bundle?.meaning.concepts.find(item => item.id === property?.of);
    return property ? [entity?.labels.en, property.labels.en, binding?.role].filter(Boolean).join(' · ') : '';
  }
  async openColumnMeaning(index: number): Promise<void> {
    if (!this.project) return;
    const basis = this.semanticBasis();
    if (!basis || !this.semanticCurrentHash()) { this.semanticNotice.set('Checking the current query output. Try again in a moment.'); return; }
    const lifetime = ++this.semanticMappingLifetime, project = this.project, queryId = this.queryState.id ?? '', ref = project.ref;
    const active = () => lifetime === this.semanticMappingLifetime && this.project?.ref === ref && this.queryState.id === queryId;
    if (this.displayedResultIsPreviousRun() || this.semanticCurrentHash() !== basis.queryHash) { this.semanticNotice.set('Run the updated query before mapping its columns. Existing meanings need review.'); return; }
    this.semanticNotice.set('');
    this.semanticError.set(''); this.semanticColumn.set(index);
    const current = this.queryDef()?.semanticModel;
    const fresh = createSemanticModel(basis);
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
            this.commitSuccessfulResult(result, copy, undefined, false);
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
  /**
   * Where the result grid remembers its layout (column order, widths, visibility, pinning, sort, density): ids only,
   * never a row value, a filter or the query text. A stored result is its own context; otherwise the saved query, else
   * the data source.
   */
  public resultGridStateKey(): string | undefined {
    const project = this.project?.ref.projectId;
    const resultId = this.savedResultId();
    if (resultId)
      return gridStateKey({ project, context: resultId, kind: 'result' });
    if (this.queryId)
      return gridStateKey({ project, context: this.queryId, kind: 'query' });
    return gridStateKey({
      project,
      context: this.selectedSource(),
      kind: 'source',
    });
  }
  public readonly resultGridColumnDefs = computed<ColDef<QueryResultGridRow>[]>(
    () => {
      const result = this.runResult();
      // Primary-key columns of a stored result are identifiers whatever their name: their digits are never grouped.
      const keyNames = new Set(
        (this.savedResultMeta()?.columns ?? [])
          .filter((c) => (c.pk ?? 0) > 0)
          .map((c) => c.name),
      );
      const receipt = result?.publicSqliteReceipt;
      const canOfferLookup =
        !!result &&
        this.relatedResultSet() === 'affiliations' &&
        !this.selectedHistoricalResult() &&
        !this.displayedResultIsPreviousRun() &&
        !this.publicSqliteRunIsStale(result);
      const columns = (this.displayedRecordset()?.columns ?? []).map<
        ColDef<QueryResultGridRow>
      >(
        (column, index) => {
          const columnId = `result_${index}`;
          const canLookupCustomer =
            hasVerifiedCustomerIdLineage(receipt, index, column.name) &&
            canOfferLookup;
          return {
            ...resultColumnDef(
              { ...column, primaryKey: keyNames.has(column.name) },
              columnId,
            ),
            headerComponent: SemanticColumnHeaderComponent,
            headerComponentParams: {
              meaningLabel: this.semanticColumnLabel(index),
              checking: this.semanticValidation() === 'checking',
              needsReview:
                !!this.queryDef()?.semanticModel?.bindings.some(
                  (binding) => binding.columnIndex === index,
                ) && this.semanticNeedsReview(),
              openMeaning: () => { void this.openColumnMeaning(index); },
            },
            ...(canLookupCustomer ||
            (index === 0 && this.isTugqlAuthorJourney())
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
        },
      );
      // The columns as the recordset gives them. The saved rows of a stored result put the primary key first when the
      // saved metadata names it.
      const meta = this.savedResultMeta();
      const keyFirst =
        meta && result?.provenance.mode === 'snapshot'
          ? pkFirstOrder(meta, this.displayedRecordset()?.columns ?? [])
          : undefined;
      const ordered = keyFirst ? keyFirst.map((i) => columns[i]) : columns;
      if (this.activeHostedExecution()?.run?.executionStatus === 'completed')
        ordered.unshift({
          colId: 'validation_status',
          field: 'validation_status',
          headerName: 'Validation',
          sortable: true,
          minWidth: 135,
        });
      return ordered;
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
  private readonly authorRowFilterFeedback = signal<
    | {
        readonly row: readonly TypedValue[];
        readonly snapshotKey: unknown;
        readonly text: string;
      }
    | undefined
  >(undefined);
  public readonly authorRowFilterStatus = computed(() => {
    const feedback = this.authorRowFilterFeedback();
    return feedback &&
      feedback.row === this.currentAuthorResultRow()?.row &&
      feedback.snapshotKey === this.authorResultSnapshotKey()
      ? feedback.text
      : '';
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
      this.authorRowFilterFeedback.set({
        row: action.row,
        snapshotKey: action.snapshotKey,
        text,
      });
    };
    if (
      !selected ||
      selected.row !== action.row ||
      action.snapshotKey !== this.authorResultSnapshotKey()
    ) {
      status('This row changed. Select a current result row and try again.');
      return;
    }
    if (!this.isTugqlAuthorJourney()) {
      status('Use as filter requires verified InvoiceId lineage from a supported TugQL run. Edit the original source to filter this query.');
      return;
    }
    const receipt = selected.result.publicSqliteReceipt;
    const output = receipt?.outputColumns?.[action.index];
    const column = selected.recordset.columns[action.index];
    const value = action.row[action.index];
    if (
      this.running() ||
      this.queryState.isSaving ||
      this.resultPageLoading() ||
      this.selectedHistoricalResult() ||
      this.displayedResultIsPreviousRun() ||
      this.publicSqliteRunIsStale(selected.result) ||
      this.authorPlan()?.draftRevision !== this.authorDraftRevision()
    ) {
      status(
        'These results belong to a previous draft. Preview and run the current draft before filtering.',
      );
      return;
    }
    if (
      !receipt ||
      !column ||
      !output ||
      output.name !== column.name ||
      output.type !== 'integer' ||
      output.lineage.length !== 1 ||
      (receipt.relationship &&
        output.lineage[0]?.source !== receipt.relationship.fromSource) ||
      output.lineage[0]?.field !== 'InvoiceId' ||
      value?.type !== 'integer' ||
      !/^[1-9]\d*$/u.test(value.value) ||
      !Number.isSafeInteger(Number(value.value))
    ) {
      status(
        'Filtering is available for a verified InvoiceId integer cell. Copy this value or edit other filters in TugQL Code.',
      );
      return;
    }
    const source = this.queryBodyText();
    if (source === undefined) {
      status(
        'The current TugQL draft is unavailable. Reopen this query before filtering.',
      );
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
    this.queryTextChanged(
      new CustomEvent('ionInput', { detail: { value: edit.after } }),
      false,
    );
    const current = this.currentAuthorFormatContext();
    if (current)
      this.authorFormatUndo.set({
        action: 'filter',
        originalSource: source,
        formattedSource: edit.after,
        scopeKey: current.scopeKey,
        queryIdentity: current.queryIdentity,
      });
    this.setAuthorMode('code');
    this.authorFormatStatus.set('InvoiceId filter added. Undo available.');
    status(`InvoiceId ${value.value} added to TugQL Query. Undo available.`);
    if (this.authorRowDetailsOpen()) {
      this.authorRowDetailsShowEditorAfterDismiss = true;
      this.authorRowDetailsOpen.set(false);
    }
  }
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
        if (
          this.authorViewActive &&
          this.queryView() === 'author' &&
          query === this.currentQueryIdentity() &&
          scope === this.historyScope()
        )
          this.authorWorkspaceLayout?.showEditor();
      });
      return;
    }
    // Ionic emits didDismiss before completing overlay/focus-trap teardown.
    // Restore on the next frame, only while the originating view and row still own it.
    requestAnimationFrame(() => {
      if (
        !caller?.isConnected ||
        !this.authorViewActive ||
        this.queryView() !== 'author' ||
        generation !== this.authorRowDetailsFocusGeneration ||
        this.authorRowDetailsOpen() ||
        query !== this.currentQueryIdentity() ||
        scope !== this.historyScope() ||
        snapshot !== this.authorResultSnapshotKey() ||
        !this.currentAuthorResultRow()
      )
        return;
      const focusTarget =
        caller.shadowRoot?.querySelector<HTMLElement>('button, a') ?? caller;
      focusTarget.focus({ preventScroll: true });
    });
  }

  public readonly authorResultRowClassRules: RowClassRules<QueryResultGridRow> =
    {
      'author-inspected-row': (params) => {
        const snapshot =
          params.data && this.resultGridRowSnapshots.get(params.data);
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
    const content = this.renderCustomerLookupCell(
      params,
      receipt,
      queryIdentity,
      columnIndex,
      columnName,
    );
    if (
      columnIndex !== 0 ||
      !params.data ||
      this.resultGridRowSnapshots.get(params.data) !==
        this.currentAuthorResultRow()
    )
      return content;
    const cell = document.createElement('span');
    cell.className = 'author-inspected-cell';
    const marker = document.createElement('span');
    marker.className = 'author-inspected-row-marker';
    marker.textContent = '▶';
    marker.setAttribute('role', 'img');
    marker.setAttribute(
      'aria-label',
      'Current row, position ' + this.currentAuthorResultRow()?.position,
    );
    marker.title = 'Current row';
    cell.append(marker, content);
    return cell;
  }
  public readonly resultGridAnalyticsScope = computed(() =>
    `Analytics use ${this.resultGridRows().length} loaded ${this.resultGridRows().length === 1 ? 'row' : 'rows'} on page ${this.resultPageIndex() + 1}` +
    (this.resultHasMore() || (this.resultPageIndex() + 1) * this.resultPageSize < this.resultTotalRows() ? ' (more rows available)' : '') + '; grouping and charts do not load other pages',
  );
  public readonly resultGridRows = computed<QueryResultGridRow[]>(() => {
    const result = this.runResult();
    const recordset = this.displayedRecordset();
    const rows = this.visibleResultRows();
    if (!result || !recordset) return [];
    const execution = this.activeHostedExecution();
    const statuses = this.hostedRowStatuses();
    const filter = this.hostedStatusFilter();
    return rows.flatMap((row, index) => {
      const rowIndex = this.resultPageIndex() * this.resultPageSize + index;
      const status =
        execution?.run?.executionStatus === 'completed'
          ? (statuses.get(rowIndex) ?? 'unknown')
          : undefined;
      if (status && filter !== 'all' && filter !== status) return [];
      const projected = Object.fromEntries(
        row.map((cell, columnIndex) => [
          `result_${columnIndex}`,
          cell.type === 'null' ? null : displayQueryResultValue(cell),
        ]),
      );
      if (status) projected['validation_status'] = status;
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
      return [projected];
    });
  });
  public readonly resultGridNoRowsTemplate =
    '<span class="ag-overlay-no-rows-center">No rows.</span>';

  public selectHostedValidationRow(selection: ValidationRowSelection): void {
    const execution = this.activeHostedExecution();
    if (
      !execution?.run ||
      selection.queryId !== execution.queryId ||
      !sameExecution(selection.execution, execution.execution) ||
      !/^root\/0\/validator\/\d+$/u.test(selection.nodePath) ||
      selection.rowIndex === undefined ||
      selection.rowIndex < 0 ||
      selection.rowIndex >= execution.result.recordset.rows.length
    )
      return;
    const rowIndex = selection.rowIndex;
    this.hostedStatusFilter.set('all');
    this.resultPageIndex.set(Math.floor(rowIndex / this.resultPageSize));
    this.hostedSelectedRow.set(rowIndex);
  }

  private renderCustomerLookupCell(
    params: ICellRendererParams<QueryResultGridRow, string>,
    receipt: PublicSqliteExecutionReceipt | undefined,
    queryIdentity: symbol,
    columnIndex: number,
    columnName: string,
  ): HTMLElement {
    const value = document.createElement('span');
    value.textContent = params.valueFormatted ?? params.value ?? '';
    // The row on screen (sorting and filtering move it) and the row of the result it shows are different things:
    // the lookup reads the result's own row, found through the snapshot of the grid row.
    const rowIndex = params.node.rowIndex;
    const snapshot = params.data && this.resultGridRowSnapshots.get(params.data);
    const dataIndex =
      snapshot && snapshot.rows === this.visibleResultRows()
        ? snapshot.rows.indexOf(snapshot.row)
        : -1;
    const result = this.runResult();
    const current =
      !!result &&
      rowIndex !== null &&
      dataIndex >= 0 &&
      this.relatedResultSet() === 'affiliations' &&
      !this.selectedHistoricalResult() &&
      !this.displayedResultIsPreviousRun() &&
      !this.publicSqliteRunIsStale(result);
    const customerId = customerIdLookupValue(
      receipt,
      columnIndex,
      columnName,
      dataIndex < 0
        ? undefined
        : this.visibleResultRows()[dataIndex]?.[columnIndex],
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
      if (dataIndex >= 0 && receipt?.executionId) {
        this.openAuthorCustomerLookup(
          columnIndex,
          columnName,
          dataIndex,
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
    const executionDefinition = { ...definition };
    delete executionDefinition.semanticModel;
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
    return (
      isDevicePersonalQuery(this.queryState.id ?? '') ||
      !this.project ||
      !isSharedProjectRef(this.project.ref) ||
      this.sharedQuerySaveAllowed()
    );
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
    if (snapshot)
      this.comparisonMessage.set(
        `${reason} The earlier observation is retained as previous page-memory output.`,
      );
  }

  private expireComparisonSession(reason: string): void {
    this.invalidateComparison(reason);
    this.comparisonSession.clear();
    this.comparisonSnapshot.set(undefined);
    this.comparisonResult.set(undefined);
    this.comparisonPreparedPlan = undefined;
    this.comparisonCustomerBinding.set('No comparison pair has been run.');
    this.comparisonQueryLimit.set('—');
    this.comparisonMessage.set(
      'The comparison session ended when this page was left or closed.',
    );
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
    // Ionic retains this component after navigation. The dispatcher session owns
    // the result worker and its temporary IndexedDB pages until this route ends.
    const hadActiveDispatchSession = this.activeDispatchSession !== undefined;
    this.invalidateFederatedRun();
    this.stopFederatedRun();
    this.invalidateHistoryRequests();
    if (hadActiveDispatchSession) {
      this.setDisplayedResult(undefined);
      this.committedRun.set(undefined);
      this.resultPageRows.set([]);
      this.resultPageIndex.set(0);
      this.selectedHistoricalResult.set(undefined);
      this.historicalDefinition.set(undefined);
      this.executedGraphDefinition = undefined;
    }
    ++this.authorRowDetailsFocusGeneration;
    ++this.authorPreviewLifetime;
    this.authorPreviewLoading.set(false);
    this.authorRowDetailsOpen.set(false);
    this.authorFormatNavigationSnapshot.set(undefined);
    this.clearPreviewDiagnosticNavigation();
    this.expireComparisonSession(
      'The comparison session ended when this page was left.',
    );
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
      ? bindingSlots.map((slot) =>
          slot.kind === 'customer-id' ? customerId : slot.value,
        )
      : (() => {
          if (preview.bindingNames[0] !== 'CustomerId')
            throw new Error(
              'The frozen query is missing its CustomerId binding.',
            );
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
    if (!relationship)
      throw new Error(
        'Preview the declared Invoice-to-Customer relationship first.',
      );
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
      typedBindingsFingerprint: await sha256Text(
        JSON.stringify({ CustomerId: plan.bindings[0] }),
      ),
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
      throw new Error(
        'Public project access is required for this comparison session.',
      );
  }

  private assertComparisonInputCurrent(key: string): void {
    if (this.comparisonInputKey() !== key)
      throw new Error(
        'The draft, binding, project, or access context changed. Preview again before comparing.',
      );
  }

  public async runComparisonBoth(): Promise<void> {
    if (this.contextSessionId()) { this.runError.set('Session comparison needs separately pinned side inputs. Use the supported single-query session path.'); return; }
    if (!this.comparisonBlocker().startsWith('Ready')) return;
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (!project || !definition) return;
    const inputKey = this.comparisonInputKey();
    const reviewedPreview = this.authorPlan();
    if (
      !reviewedPreview ||
      reviewedPreview.draftRevision !== this.authorDraftRevision()
    )
      return;
    const reviewedPreviewJson = JSON.stringify(reviewedPreview);
    const operation = ++this.comparisonGeneration;
    this.comparisonBusy.set(true);
    this.comparisonMessage.set(
      'Rechecking the admitted project metadata before either worker starts.',
    );
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
        throw new Error(
          'The live query profile does not support fixture comparison.',
        );
      this.comparisonCustomerBinding.set(
        `CustomerId ${String(plan.bindings[0])} · frozen integer binding`,
      );
      this.comparisonQueryLimit.set(
        String(plan.authorProof.resolvedQuery.limit),
      );
      const context = await this.comparisonContext(plan, project);
      this.assertComparisonInputCurrent(inputKey);
      if (operation !== this.comparisonGeneration) return;
      const snapshot = this.comparisonSession.begin(context);
      // A previous diff remains visible until the replacement pair has passed its
      // fresh metadata, Preview-plan and authorization-context admission checks.
      this.comparisonResult.set(undefined);
      this.comparisonPreparedPlan = plan;
      this.comparisonSnapshot.set(snapshot);
      this.comparisonMessage.set(
        'Both independent fixture queries are running.',
      );
      await Promise.all(
        PUBLIC_CHINOOK_COMPARISON_TARGETS.map(async (target) => {
          const token = this.comparisonSession.startSide(target.id);
          this.comparisonSnapshot.set(this.comparisonSession.snapshot());
          await this.runComparisonSide(
            token,
            project,
            definition,
            plan,
            operation,
          );
        }),
      );
    } catch (error) {
      if (operation === this.comparisonGeneration) {
        this.comparisonMessage.set(
          error instanceof Error
            ? error.message
            : 'The comparison pair could not start.',
        );
        this.setAuthorError(
          error instanceof Error
            ? error.message
            : 'The comparison pair could not start.',
        );
      }
    } finally {
      if (operation === this.comparisonGeneration)
        this.comparisonBusy.set(false);
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
    if (operation !== this.comparisonGeneration || this.comparisonResult())
      return;
    const snapshot = this.comparisonSession.snapshot();
    if (!snapshot || snapshot.invalidated) return;

    const running = snapshot.sides.filter((side) => side.status === 'running');
    const queued = snapshot.sides.filter((side) => side.status === 'queued');
    const failed = snapshot.sides.filter((side) => side.status === 'failed');
    const cancelled = snapshot.sides.filter(
      (side) => side.status === 'cancelled',
    );
    const label = (side: (typeof snapshot.sides)[number]): string =>
      side.target.role === 'baseline' ? 'Baseline' : 'Candidate';
    if (running.length || queued.length) {
      const pending = [...running, ...queued].map(label);
      const finishedFailures = failed.map(label);
      const finishedCancellations = cancelled.map(label);
      const finished = [
        ...(finishedFailures.length
          ? [
              `${finishedFailures.join(' and ')} fixture quer${finishedFailures.length === 1 ? 'y failed' : 'ies failed'}`,
            ]
          : []),
        ...(finishedCancellations.length
          ? [
              `${finishedCancellations.join(' and ')} fixture quer${finishedCancellations.length === 1 ? 'y was' : 'ies were'} cancelled`,
            ]
          : []),
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
      this.comparisonMessage.set(
        'Both fixture queries completed with complete bounded results.',
      );
    }
  }

  public async retryComparisonSide(
    targetId: ComparisonFixtureTarget['id'],
  ): Promise<void> {
    const snapshot = this.comparisonSession.snapshot();
    const plan = this.comparisonPreparedPlan;
    const project = this.project?.ref;
    const definition = this.queryDef();
    if (
      !snapshot ||
      snapshot.invalidated ||
      !plan ||
      !project ||
      !definition ||
      this.comparisonBusy()
    )
      return;
    try {
      this.assertPublicComparisonScope(project);
    } catch (error) {
      this.invalidateComparison(
        error instanceof Error
          ? error.message
          : 'The public project scope changed.',
      );
      return;
    }
    const inputKey = this.comparisonInputKey();
    this.comparisonBusy.set(true);
    this.comparisonMessage.set(
      `Retrying the ${targetId === 'chinook-baseline' ? 'Baseline' : 'Candidate'} query.`,
    );
    const operation = this.comparisonGeneration;
    try {
      this.assertComparisonInputCurrent(inputKey);
      const token = this.comparisonSession.startSide(targetId);
      this.comparisonSnapshot.set(this.comparisonSession.snapshot());
      await this.runComparisonSide(token, project, definition, plan, operation);
    } finally {
      if (operation === this.comparisonGeneration)
        this.comparisonBusy.set(false);
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
    if (
      !snapshot ||
      snapshot.invalidated ||
      !plan ||
      !project ||
      !definition ||
      this.comparisonBusy()
    )
      return;
    try {
      this.assertPublicComparisonScope(project);
    } catch (error) {
      this.invalidateComparison(
        error instanceof Error
          ? error.message
          : 'The public project scope changed.',
      );
      return;
    }
    if (
      !snapshot.sides.every(
        (side) => side.status === 'complete' && side.observation,
      )
    )
      return;
    if (!this.comparisonWasmPin) {
      this.setAuthorError(
        'The verified Core comparison asset is not configured for this build.',
      );
      return;
    }
    const inputKey = this.comparisonInputKey();
    const operation = ++this.comparisonGeneration;
    const controller = new AbortController();
    this.comparisonAbort = controller;
    this.comparisonBusy.set(true);
    this.comparisonMessage.set(
      'Checking current project metadata and the verified Core comparison module.',
    );
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
        throw new Error(
          'The current catalog, schema, relationship, or query no longer matches both observations. Run both again.',
        );
      const liveContext = await this.comparisonContext(livePlan, project);
      if (JSON.stringify(liveContext) !== JSON.stringify(snapshot.context))
        throw new Error(
          'The draft, typed binding, project, or principal changed. Run both again.',
        );
      const baseline = snapshot.sides.find(
        (side) => side.target.role === 'baseline',
      )?.observation;
      const candidate = snapshot.sides.find(
        (side) => side.target.role === 'candidate',
      )?.observation;
      if (!baseline || !candidate)
        throw new Error(
          'Both fixture observations must be complete before Compare.',
        );
      const result = await compareSessionObservations(
        baseline,
        candidate,
        snapshot.context,
        snapshot.generation,
        this.comparisonWasmPin,
        controller.signal,
      );
      this.assertComparisonInputCurrent(inputKey);
      if (
        operation !== this.comparisonGeneration ||
        this.comparisonSession.snapshot()?.generation !== snapshot.generation
      )
        return;
      this.comparisonResult.set(result);
      this.comparisonMessage.set(
        'Comparison finished from two complete bounded query observations.',
      );
    } catch (error) {
      if (operation === this.comparisonGeneration) {
        this.comparisonMessage.set(
          error instanceof Error
            ? error.message
            : 'Core could not compare these complete results.',
        );
        this.setAuthorError(
          error instanceof Error
            ? error.message
            : 'Core could not compare these complete results.',
        );
      }
    } finally {
      if (this.comparisonAbort === controller) this.comparisonAbort = undefined;
      if (operation === this.comparisonGeneration)
        this.comparisonBusy.set(false);
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
    if (
      this.queryState.saveSupported === false &&
      !isAuthorDraft &&
      !this.project?.ref.spaceID
    )
      return;
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
    const sourceContextVisible =
      isAuthorDraft &&
      text !== previousText &&
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
      this.invalidateComparison(
        'The query draft changed; run both fixtures again.',
      );
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

  private revealWorkspaceTab(tab: WorkspaceTab): void {
    const segment = this.workspaceTabBar?.nativeElement;
    if (!segment?.isConnected || segment.getBoundingClientRect().width === 0) return;
    const button = segment.querySelector<HTMLElement>(`ion-segment-button[value="${tab}"]`);
    if (!button || segment.scrollWidth <= segment.clientWidth) return;
    const viewport = segment.getBoundingClientRect();
    const selected = button.getBoundingClientRect();
    const delta = selected.left < viewport.left
      ? selected.left - viewport.left
      : selected.right > viewport.right
        ? selected.right - viewport.right
        : 0;
    if (Math.abs(delta) > 1)
      segment.scrollTo({ left: segment.scrollLeft + delta, behavior: 'instant' });
  }

  private scheduleWorkspaceTabReveal(): void {
    if (this.workspaceTabRevealFrame !== undefined)
      cancelAnimationFrame(this.workspaceTabRevealFrame);
    this.workspaceTabRevealFrame = requestAnimationFrame(() => {
      this.workspaceTabRevealFrame = requestAnimationFrame(() => {
        this.workspaceTabRevealFrame = undefined;
        this.revealWorkspaceTab(this.workspaceTab());
      });
    });
  }

  @HostListener('window:resize')
  public onWorkspaceWindowResize(): void {
    // Ionic can relayout its scrollable segment after the host's observer has
    // run. A viewport resize also reveals the selected tab after that reflow.
    this.scheduleWorkspaceTabReveal();
  }

  private selectWorkspaceTab(tab: WorkspaceTab): void {
    const previous = this.workspaceTab();
    if ((previous === 'sources' || previous === 'related') &&
      tab !== 'sources' && tab !== 'related')
      this.authorSourcesToggled(false);
    this.workspaceTab.set(tab);
    this.changeDetector.markForCheck();
    afterNextRender(() => {
      if (this.workspaceTab() !== tab) return;
      this.revealWorkspaceTab(tab);
    }, { injector: this.injector });
  }

  public setAuthorMode(mode: 'compose' | 'code' | 'preview'): void {
    if (mode !== 'compose' && mode !== 'code' && mode !== 'preview') return;
    if (mode !== 'code') {
      this.authorFormatNavigationSnapshot.set(undefined);
      this.clearPreviewDiagnosticNavigation();
    }
    this.authorModeExplicit = true;
    this.authorMode.set(mode);
    this.selectWorkspaceTab(mode === 'code' ? 'tugql' : mode);
  }

  public setWorkspaceTab(value: unknown): void {
    if (value === 'compose' || value === 'tugql' || value === 'preview') {
      if (this.isTugqlAuthorJourney()) this.setAuthorMode(value === 'tugql' ? 'code' : value);
      else this.selectWorkspaceTab(value);
      return;
    }
    if (value === 'sql' && this.isNativeSqlWorkspace()) {
      this.selectWorkspaceTab('sql');
      return;
    }
    if (value === 'dtql' && this.isNativeDtqlWorkspace()) {
      this.selectWorkspaceTab('dtql');
      return;
    }
    this.authorContextTabChanged(value);
  }

  public authorContextTabChanged(value: unknown): void {
    if (value !== 'parameters' && value !== 'sources' && value !== 'related')
      return;
    this.selectWorkspaceTab(value);
  }

  public authorResultSelectionChanged(
    event: SelectionChangedEvent<QueryResultGridRow>,
  ): void {
    // The grid's checkboxes select rows for export and copy. The Current row is the focused or clicked row, never
    // the checked ones, so a selection change only keeps the api.
    if (!this.isTextQueryWorkspace()) return;
    this.authorResultGridApi = event.api;
  }

  public authorResultCellFocused(
    event: CellFocusedEvent<QueryResultGridRow>,
  ): void {
    if (!this.isTextQueryWorkspace() || event.rowIndex === null) return;
    this.authorResultGridApi = event.api;
    const node = event.api.getDisplayedRowAtIndex(event.rowIndex);
    if (node?.group || node?.footer) return;
    this.setAuthorResultRow(node?.data);
  }

  public authorResultRowClicked(
    event: RowClickedEvent<QueryResultGridRow>,
  ): void {
    if (!this.isTextQueryWorkspace()) return;
    this.authorResultGridApi = event.api;
    if (event.node?.group || event.node?.footer) return;
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
      if (node.data && (snapshot === previous || snapshot === inspected))
        node.setData(node.data);
    });
    this.authorResultGridApi?.refreshCells?.({
      columns: ['result_0'],
      force: true,
    });
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

  private currentAuthorSourceContext():
    | {
        readonly project: IProjectRef;
        readonly queryId: string;
        readonly draftRevision: number;
        readonly source: string;
        readonly scopeKey: string;
        readonly queryIdentity: symbol;
      }
    | undefined {
    const project = this.project?.ref;
    const definition = this.queryDef();
    const source = this.queryBodyText();
    if (
      !project ||
      !definition ||
      !source ||
      !this.queryState.id ||
      !this.isTugqlAuthorJourney()
    )
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
    const mainSource = inventory.sources.find(
      (source) => source.kind === 'main',
    );
    const supportedSources = inventory.sources.every(
      (source) =>
        (source.kind === 'main' &&
          source.name.toLowerCase() === 'invoice' &&
          (source.schema === undefined || source.schema === 'main') &&
          !source.database) ||
        (source.kind === 'join' &&
          source.name.toLowerCase() === 'customer' &&
          source.removable &&
          (source.schema === undefined || source.schema === 'main') &&
          !source.database),
    );
    return context?.scopeKey === this.authorSourceScopeKey &&
      context.source === this.authorSourceMetadataSource &&
      context.queryIdentity === this.authorSourceMetadataIdentity &&
      inventory.available &&
      mainSource?.name.toLowerCase() === 'invoice' &&
      (mainSource.schema === undefined || mainSource.schema === 'main') &&
      !mainSource.database &&
      supportedSources
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
    context:
      | {
          readonly project: IProjectRef;
          readonly queryId: string;
          readonly draftRevision: number;
          readonly source: string;
          readonly scopeKey: string;
          readonly queryIdentity: symbol;
        }
      | undefined,
  ): boolean {
    const current = this.currentAuthorSourceContext();
    return (
      !!context &&
      !!current &&
      current.project.projectId === context.project.projectId &&
      current.queryId === context.queryId &&
      current.draftRevision === context.draftRevision &&
      current.source === context.source &&
      current.scopeKey === context.scopeKey &&
      current.queryIdentity === context.queryIdentity
    );
  }

  private async loadAuthorSources(): Promise<void> {
    const context = this.currentAuthorSourceContext();
    if (!context) {
      this.authorSourceMessage.set(
        'Open a loaded Chinook Invoice draft to inspect its admitted sources.',
      );
      return;
    }
    const inventory = this.authorParticipatingSourceInventory();
    const main = inventory.sources.find((source) => source.kind === 'main');
    const supportedSources = inventory.sources.every(
      (source) =>
        (source.kind === 'main' &&
          source.name.toLowerCase() === 'invoice' &&
          (source.schema === undefined || source.schema === 'main') &&
          !source.database) ||
        (source.kind === 'join' &&
          source.name.toLowerCase() === 'customer' &&
          source.removable &&
          (source.schema === undefined || source.schema === 'main') &&
          !source.database),
    );
    if (
      !inventory.available ||
      main?.name.toLowerCase() !== 'invoice' ||
      (main.schema !== undefined && main.schema !== 'main') ||
      main.database ||
      !supportedSources
    ) {
      ++this.authorSourceRequestGeneration;
      this.authorSourceLoading.set(false);
      this.authorSourceDiscovery.set(undefined);
      this.authorSourceMetadataSource = '';
      this.authorSourceMetadataIdentity = undefined;
      this.authorSourceMessage.set(
        !inventory.available
          ? (inventory.reason ??
              'Source metadata is unavailable until the TugQL draft parses.')
          : 'Source metadata is unavailable for this structure. This panel admits only main.Invoice and the declared Invoice–Customer relationship.',
      );
      return;
    }
    const generation = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set(
      'Checking the current project catalog, fields, and declared relationship…',
    );
    this.authorSourceReview.set(undefined);
    this.authorSourceReviewContext = undefined;
    try {
      const discovery =
        await this.publicSqliteQuery.discoverInvoiceCustomerSources(
          context.project,
        );
      if (
        generation !== this.authorSourceRequestGeneration ||
        !this.isCurrentAuthorSourceContext(context)
      )
        return;
      this.authorSourceDiscovery.set(discovery);
      this.authorSourceScopeKey = context.scopeKey;
      this.authorSourceMetadataSource = context.source;
      this.authorSourceMetadataIdentity = context.queryIdentity;
      this.authorSourceMessage.set('');
    } catch (error) {
      if (
        generation !== this.authorSourceRequestGeneration ||
        !this.isCurrentAuthorSourceContext(context)
      )
        return;
      this.authorSourceDiscovery.set(undefined);
      this.authorSourceMetadataSource = '';
      this.authorSourceMetadataIdentity = undefined;
      this.authorSourceMessage.set(
        error instanceof Error
          ? error.message
          : 'The current source metadata could not be admitted.',
      );
    } finally {
      if (generation === this.authorSourceRequestGeneration)
        this.authorSourceLoading.set(false);
    }
  }

  public authorSourceFieldChanged(
    field: AuthorCustomerField,
    event: Event,
  ): void {
    const checked =
      (event.currentTarget as HTMLInputElement | null)?.checked === true;
    this.authorSourceFieldSelectionChanged(field, checked);
  }

  public authorSourceFieldSelectionChanged(
    field: AuthorCustomerField,
    checked: boolean,
  ): void {
    const fields = this.authorSourceSelectedFields();
    const next = checked
      ? [...fields.filter((item) => item !== field), field]
      : fields.filter((item) => item !== field);
    const order: readonly AuthorCustomerField[] = [
      'FirstName',
      'LastName',
      'Email',
    ];
    this.authorSourceSelectedFields.set(
      order.filter((item) => next.includes(item)),
    );
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
    const originalRelationshipBindings =
      originalDefinition.relationshipBindings;
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
        (binding) =>
          binding.id === review.relationship.id &&
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
    const binding = definition?.relationshipBindings?.find(
      (candidate) =>
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
    if (
      !pending ||
      !context ||
      !definition ||
      !discovery ||
      pending.source !== context.source ||
      pending.draftRevision !== context.draftRevision ||
      pending.scopeKey !== context.scopeKey ||
      pending.queryIdentity !== context.queryIdentity ||
      pending.relationship.id !== discovery.relationship.id ||
      pending.relationship.version !== discovery.relationship.version ||
      !this.isCurrentAuthorSourceContext(context)
    ) {
      this.pendingAuthorCustomerRemoval = undefined;
      this.authorCustomerRemovalOutputs.set([]);
      this.authorSourceMessage.set(
        'The source changed before removal. Reopen Sources and inspect the current draft.',
      );
      return;
    }
    const generation = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set(
      'Rechecking the admitted relationship before removing it…',
    );
    try {
      const currentDiscovery =
        await this.publicSqliteQuery.discoverInvoiceCustomerSources(
          context.project,
        );
      if (
        generation !== this.authorSourceRequestGeneration ||
        !this.isCurrentAuthorSourceContext(context) ||
        this.queryDef() !== definition ||
        currentDiscovery.schemaVersion !== discovery.schemaVersion ||
        JSON.stringify(currentDiscovery.relationship) !==
          JSON.stringify(pending.relationship)
      ) {
        this.authorSourceMessage.set(
          'The source metadata changed. No source was removed; inspect the current draft again.',
        );
        return;
      }
      const proposal = removeAuthorCustomerJoin(
        context.source,
        pending.relationship,
      );
      if (
        !proposal.ok ||
        JSON.stringify(proposal.removedOutputs) !==
          JSON.stringify(this.authorCustomerRemovalOutputs())
      ) {
        this.authorSourceMessage.set(
          proposal.ok
            ? 'The Customer outputs changed before removal. No source was removed; inspect the current draft again.'
            : proposal.reason,
        );
        return;
      }
      const updatedDefinition: IQueryDef = {
        ...definition,
        request: {
          ...definition.request,
          text: proposal.after,
        } as ITextQueryRequest,
        relationshipBindings: (definition.relationshipBindings ?? []).filter(
          (candidate) =>
            candidate.id !== pending.relationship.id ||
            candidate.version !== pending.relationship.version,
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
      if (current)
        this.authorRelationshipUndo.set({
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
      this.selectWorkspaceTab('tugql');
      this.authorSourceMessage.set(
        'Removed the Customer JOIN and its dependent outputs locally. Prior results are retained; Preview SQL and Run remain explicit.',
      );
      this.refreshAuthorSourcesIfVisible();
    } catch (error) {
      this.authorSourceMessage.set(
        error instanceof Error
          ? error.message
          : 'The source could not be removed.',
      );
    } finally {
      if (generation === this.authorSourceRequestGeneration)
        this.authorSourceLoading.set(false);
      this.pendingAuthorCustomerRemoval = undefined;
      this.authorCustomerRemovalOutputs.set([]);
    }
  }

  private buildAuthorSourceReview(): void {
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    if (!context || !discovery) {
      this.authorSourceReviewGeneration++;
      this.authorSourceMessage.set(
        'Admit current source metadata before reviewing an edit.',
      );
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
    this.authorSourceMessage.set(
      'Review the source and relationship binding before applying. No query has run.',
    );
  }

  public async applyAuthorRelationshipReview(): Promise<void> {
    const review = this.authorSourceReview();
    const reviewed = this.authorSourceReviewContext;
    const reviewGeneration = this.authorSourceReviewGeneration;
    const selectedFields = Object.freeze([
      ...this.authorSourceSelectedFields(),
    ]);
    const context = this.currentAuthorSourceContext();
    const discovery = this.authorSourceMetadata();
    if (
      !review ||
      !reviewed ||
      !context ||
      !discovery ||
      !this.isCurrentAuthorSourceContext(context) ||
      reviewed.scopeKey !== context.scopeKey ||
      reviewed.queryIdentity !== context.queryIdentity ||
      reviewed.source !== context.source ||
      reviewed.draftRevision !== context.draftRevision ||
      reviewed.reviewGeneration !== reviewGeneration ||
      JSON.stringify(reviewed.selectedFields) !==
        JSON.stringify(selectedFields) ||
      reviewed.schemaVersion !== discovery.schemaVersion
    ) {
      this.authorSourceMessage.set(
        'This review is stale. Reopen Sources and relationships, then review the edit again.',
      );
      this.authorSourceReview.set(undefined);
      return;
    }
    const applyGeneration = ++this.authorSourceRequestGeneration;
    this.authorSourceLoading.set(true);
    this.authorSourceMessage.set(
      'Rechecking source metadata before applying the reviewed draft…',
    );
    try {
      const currentDiscovery =
        await this.publicSqliteQuery.discoverInvoiceCustomerSources(
          context.project,
        );
      if (
        applyGeneration !== this.authorSourceRequestGeneration ||
        this.authorSourceReview() !== review ||
        this.authorSourceReviewGeneration !== reviewGeneration ||
        this.authorDraftRevision() !== reviewed.draftRevision ||
        JSON.stringify(this.authorSourceSelectedFields()) !==
          JSON.stringify(selectedFields) ||
        this.authorSourceReviewContext !== reviewed ||
        !this.isCurrentAuthorSourceContext(context) ||
        currentDiscovery.schemaVersion !== reviewed.schemaVersion ||
        JSON.stringify(currentDiscovery.relationship) !==
          JSON.stringify(review.relationship)
      ) {
        this.authorSourceReview.set(undefined);
        this.authorSourceMessage.set(
          'The source metadata or relationship pin changed. Review the current source again.',
        );
        return;
      }
      const definition = this.queryDef();
      if (!definition || definition.request.queryType !== QueryType.DTQL)
        return;
      const updatedDefinition: IQueryDef = {
        ...definition,
        request: {
          ...definition.request,
          text: review.after,
        } as ITextQueryRequest,
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
      this.authorSourceReview.set(undefined);
      this.authorSourceReviewGeneration++;
      this.authorSourceReviewContext = undefined;
      this.authorModeExplicit = true;
      this.authorMode.set('code');
      this.selectWorkspaceTab('tugql');
      this.authorSourceMessage.set('');
      this.authorFormatStatus.set(
        selectedFields.length
          ? `Applied the admitted join with ${selectedFields.join(', ')} outputs. The prior result is retained; Preview SQL before Run.`
          : 'Applied the admitted join with no added output columns. The prior result is retained; Preview SQL before Run.',
      );
    } catch (error) {
      this.authorSourceMessage.set(
        error instanceof Error
          ? error.message
          : 'The reviewed source edit could not be applied.',
      );
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
    return (
      !!current &&
      current.scopeKey === snapshot.scopeKey &&
      current.queryIdentity === snapshot.queryIdentity
    );
  }

  public navigateToAuthorFormatDiagnostic(diagnostic: TugQLDiagnostic): void {
    const snapshot = this.authorFormatNavigationSnapshot();
    if (
      !this.isCurrentAuthorFormatDiagnosticSnapshot(snapshot) ||
      !snapshot.diagnostics.includes(diagnostic)
    )
      return;
    this.authorCodeEditor?.navigateToFormatDiagnostic(
      snapshot.source,
      diagnostic,
    );
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
    if (this.workspaceTab() !== 'tugql') return true;
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

    if (this.workspaceTab() !== 'tugql') {
      const generation = ++this.previewDiagnosticNavigationGeneration;
      this.pendingPreviewDiagnosticNavigation = { generation, snapshot };
      this.setAuthorMode('code');
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
    return (
      !!current &&
      current.scopeKey === snapshot.scopeKey &&
      current.queryIdentity === snapshot.queryIdentity
    );
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
    if (relationshipUndo && this.canUndoAuthorRelationship(relationshipUndo)) {
      const definition = this.queryDef();
      if (!definition || definition.request.queryType !== QueryType.DTQL)
        return;
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
      this.authorFormatStatus.set(
        relationshipUndo.action === 'remove'
          ? 'Source removal undone.'
          : 'Join undone.',
      );
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
      this.authorSourceMessage.set(
        relationshipUndo.action === 'remove'
          ? 'Undid the local source removal and restored the relationship binding. The prior result is retained.'
          : 'Undid the local join and restored the original relationship bindings. The prior result is retained.',
      );
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
    this.authorFormatStatus.set(
      undo.action === 'filter'
        ? 'InvoiceId filter undone.'
        : 'Formatting undone.',
    );
  }

  private canUndoAuthorRelationship(undo: AuthorRelationshipUndo): boolean {
    const current = this.currentAuthorFormatContext();
    return (
      !!current &&
      this.authorMode() === 'code' &&
      !this.running() &&
      !this.queryState.isSaving &&
      current.scopeKey === undo.scopeKey &&
      current.queryIdentity === undo.queryIdentity &&
      this.queryBodyText() === undo.joinedSource
    );
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
      this.selectWorkspaceTab(definition?.request.queryType === QueryType.SQL ? 'sql' : this.isNativeDtqlWorkspace() ? 'dtql' : 'tugql');
    }
    if (
      resolveDefault &&
      definition &&
      !this.authorModeDefaultResolved &&
      !this.authorModeExplicit
    ) {
      this.authorMode.set('code');
      this.selectWorkspaceTab(definition.request.queryType === QueryType.SQL ? 'sql' : this.isNativeDtqlWorkspace() ? 'dtql' : 'tugql');
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
      this.invalidateComparison(
        'The CustomerId binding changed; run both fixtures again.',
      );
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
    const activeEnvironment = this.queryState.activeEnv?.id ?? this.envId;
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
    const routeStillOwned =
      this.isLatestAuthorLookupNavigation(pendingNavigation);
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
            parsed.diagnostics
              .map((diagnostic) => diagnostic.message)
              .join(' '),
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
          this.setAuthorMode('code');
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
      if (lifetime === this.authorPreviewLifetime)
        this.authorPreviewLoading.set(false);
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

  // ---- Opened from a stored query result: `store/:storeId/project/:projectId/query?result=<id>` ----

  /** What the strip above the editor says about the saved result the editor was opened from. */
  public readonly savedResultBanner = signal<SavedResultBannerState | undefined>(
    undefined,
  );
  public readonly savedResultStoreId = signal('');
  public readonly savedResultId = signal('');
  private openedResultKey = '';
  /** The environment the opened result ran in, kept selected while the saved result is open. */
  private resultEnvId?: string;
  private resultTargetAdded = false;
  /** The saved metadata of the opened result: names its primary key, to put the key columns first in the grid. */
  private readonly savedResultMeta = signal<ResultMeta | undefined>(undefined);
  /** The document title before the saved result set its own, and the one it set. */
  private titleBeforeResult?: string;
  private resultTitle?: string;
  /** The query the result opened: the new draft's id, or the saved query's. */
  private resultQueryId?: string;
  private resultMode?: ResultEditorMode;
  private pendingResultDisplay?: {
    readonly queryId: string;
    readonly plan: ResultEditorPlan;
  };
  private resultSubscription?: Subscription;
  /**
   * The saved rows of the stored result while they are what the grid shows. A cold load resolves the project and the
   * security context after the result was read, and each of those clears the displayed result (a scope change); the
   * saved rows do not depend on that scope, so {@link invalidateHistoryScope} puts them back until another result is
   * shown (a run, a history entry) or another query is opened.
   */
  private savedRowsShown?: FederatedQueryResult;

  /** Reads the stored result again (Check again on the banner). */
  public reloadSavedResult(): void {
    const id = this.savedResultId();
    this.openedResultKey = '';
    if (id) this.openFromResult(id);
  }

  /**
   * Opens the editor from a result stored by the local agent: reads it once (`GET results/<id>`, loopback agents only,
   * through the same service and session as the result page), fills the editor from its query, selects its database
   * and environment, and shows its saved rows without running anything. The id is never logged.
   */
  private openFromResult(resultId: string): void {
    const storeId =
      routeParam(this.route.snapshot, routingParamStoreId) ??
      this.project?.ref.storeId ??
      '';
    const key = `${storeId}\n${resultId}`;
    if (key === this.openedResultKey) return;
    this.openedResultKey = key;
    this.resultSubscription?.unsubscribe();
    this.pendingResultDisplay = undefined;
    this.savedResultStoreId.set(storeId);
    this.savedResultId.set(resultId);
    if (!isLoopbackStore(storeId)) {
      // Results live on this computer only: no other address is ever asked for one.
      this.savedResultBanner.set({ kind: 'problem', problem: 'agent-unreachable' });
      return;
    }
    if (!validResultId(resultId)) {
      this.savedResultBanner.set({ kind: 'problem', problem: 'result-not-found' });
      return;
    }
    this.savedResultBanner.set({ kind: 'loading' });
    this.resultSubscription = this.injector
      .get(AgentLinkApiService)
      .storedResult(storeId, resultId)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (result) => {
          if (this.openedResultKey === key && this.savedResultId() === resultId)
            this.applyStoredResult(result, resultId);
        },
        error: (err: unknown) =>
          this.savedResultBanner.set({
            kind: 'problem',
            problem: err instanceof LinkProblemError ? err.problem : 'read-failed',
          }),
      });
  }

  private applyStoredResult(result: StoredResult, resultId: string): void {
    try {
      let plan = resultEditorPlan(result, this.randomIdService.newRandomId());
      const here = this.project?.ref.projectId;
      if (plan.ids && here && plan.ids.project !== here) {
        // An address that names another project than the result's: its query and database are not this project's.
        plan = {
          ...plan,
          mode: 'rows-only',
          definition: undefined,
          savedQueryId: undefined,
          ids: undefined,
          parameters: [],
          notice:
            'This result was saved for another project than this one, so the editor has no query for it. The saved rows are shown below.',
        };
      }
      const env = plan.ids?.env;
      const knownEnvs = this.project?.summary?.environments;
      const envUnknown = !!env && !!knownEnvs && !knownEnvs.some((e) => e.id === env);
      if (envUnknown) {
        plan = {
          ...plan,
          notice: [
            plan.notice,
            `Environment ${env} of this result is not in this project, so no environment is selected.`,
          ]
            .filter(Boolean)
            .join(' '),
        };
      }
      // Before the rows: a change of environment clears a displayed result.
      this.resultEnvId = env && !envUnknown ? env : undefined;
      if (this.resultEnvId)
        this.datatugNavContextService.setCurrentEnvironment(this.resultEnvId);
      this.selectedSource.set(plan.ids?.source);
      // The database that ran the query is shown in the editor's Target field, as for any query with a chosen source.
      if (this.resultTargetAdded) {
        this.resultTargetAdded = false;
        this.availableTargets.set([]);
      }
      if (plan.ids && !this.availableTargets().length) {
        this.availableTargets.set([
          { source: plan.ids.source, label: plan.ids.source },
        ]);
        this.resultTargetAdded = true;
      }
      this.savedResultMeta.set(result.meta);
      this.resultMode = plan.mode;
      this.resultQueryId = plan.definition?.id ?? plan.savedQueryId;
      // A result-only URL has no query identity until this read completes.
      // Bind its opaque runtime hint only to the query this result opens.
      const hint = this.entryRuntimeHint();
      if (hint?.resultId === resultId && !hint.queryId && this.resultQueryId)
        this.entryRuntimeHint.set({ ...hint, queryId: this.resultQueryId });
      this.savedResultBanner.set({
        kind: 'shown',
        mode: plan.mode,
        savedAt: plan.savedAt,
        rowsKept: plan.rowsKept,
        hasMore: plan.hasMore,
        ...(plan.notice ? { notice: plan.notice } : {}),
        ...(plan.ids
          ? { database: `${plan.ids.source} · environment ${plan.ids.env}` }
          : {}),
        summary: plan.summary,
        skippedParameters: plan.parameters.filter((p) => !p.value).map((p) => p.id),
        ...(result.prompt ? { prompt: result.prompt } : {}),
      });
      this.updateResultTitle();
      const definition = plan.definition;
      if (plan.mode === 'draft' && definition) {
        this.queryEditorStateService.newQuery({
          id: definition.id,
          title: definition.title,
          queryType: definition.request.queryType,
          request: definition.request,
          def: definition,
          isNew: true,
        });
        this.showSavedRows(plan.displayed);
        this.bindResultParameters(plan, new Set(plan.parameters.map((p) => p.id)));
      } else if (plan.mode === 'saved' && plan.savedQueryId) {
        // The saved query opens by id as it does from the queries list; its rows follow once it is loaded.
        this.pendingResultDisplay = { queryId: plan.savedQueryId, plan };
        this.queryEditorStateService.openQuery(plan.savedQueryId);
      } else {
        this.showSavedRows(plan.displayed);
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to open the saved result in the editor');
      this.savedResultBanner.set({ kind: 'problem', problem: 'read-failed' });
    }
  }

  private showSavedRows(rows: FederatedQueryResult): void {
    this.showAttemptResult(rows);
    this.savedRowsShown = rows;
  }

  private bindResultParameters(plan: ResultEditorPlan, declared: ReadonlySet<string>): void {
    for (const p of plan.parameters) {
      if (p.value && declared.has(p.id)) this.editBinding(p.id, p.value);
    }
  }

  private closeSavedResult(): void {
    this.resultSubscription?.unsubscribe();
    this.pendingResultDisplay = undefined;
    this.openedResultKey = '';
    this.savedResultId.set('');
    this.savedResultStoreId.set('');
    this.resultQueryId = undefined;
    this.resultMode = undefined;
    this.savedRowsShown = undefined;
    this.resultEnvId = undefined;
    if (this.resultTargetAdded) {
      this.resultTargetAdded = false;
      this.availableTargets.set([]);
    }
    this.savedResultMeta.set(undefined);
    this.savedResultBanner.set(undefined);
    this.restoreTitle();
  }

  /** "Query from result · <project>" while the editor shows a stored result; the app's own title otherwise. */
  private updateResultTitle(): void {
    if (this.savedResultBanner()?.kind !== 'shown') return;
    const project = this.project;
    const name =
      project?.brief?.title || project?.summary?.title || project?.ref.projectId;
    const title = name ? `Query from result · ${name}` : 'Query from result';
    if (this.resultTitle === undefined)
      this.titleBeforeResult = this.documentTitle.getTitle();
    this.resultTitle = title;
    this.documentTitle.setTitle(title);
  }

  private restoreTitle(): void {
    if (this.resultTitle === undefined) return;
    if (this.documentTitle.getTitle() === this.resultTitle)
      this.documentTitle.setTitle(this.titleBeforeResult ?? 'DataTug.app');
    this.resultTitle = undefined;
    this.titleBeforeResult = undefined;
  }

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
      this.agentContext.securityContextId();
      untracked(() => this.scheduleEntryRuntimeLoad());
    });
    effect(() => {
      const hint = this.entryRuntimeHint();
      // A stored result can reveal its saved query only after the result has
      // loaded. Its URL has no query id, but an opaque runtime selection still
      // needs the same current-catalog validation before Run is available.
      const needsValidation = this.selectedWorkingCopy() !== 'project' &&
        this.unavailableWorkingCopy();
      const definition = this.queryDef();
      this.entryContextRevision();
      if ((!hint && !needsValidation) || hint?.selectionId === 'project' ||
        !definition?.connectionId || !this.project?.ref ||
        (hint && (!hint.queryId || this.queryId !== hint.queryId)) ||
        (hint?.environment && this.envId !== hint.environment) ||
        this.isTugqlAuthorJourney()) return;
      const key = `${this.entryRouteKey}:${this.currentWorkingCopyScope()}`;
      if (this.entryLoadKey === key) return;
      this.entryLoadKey = key;
      untracked(() => { void this.loadWorkingCopies(); });
    });
    effect(() => {
      const revision = this.queryDispatch.runtimeRevision();
      untracked(() => {
        if (!this.workingCopyScope || revision === this.workingCopyRevision) return;
        const selected = this.selectedWorkingCopy() !== 'project';
        this.workingCopyRevision = revision;
        ++this.workingCopyLoad;
        this.workingCopyLoading.set(false);
        if (selected) {
          this.unavailableWorkingCopy.set(true);
          this.workingCopyError.set('The selected working copy changed. Choose a current runtime explicitly.');
        }
        this.workingCopyOptions.set([]);
        void this.loadWorkingCopies();
      });
    });
    effect(() => {
      const definition = this.queryDef(), recordset = this.displayedRecordset(), resultSet = this.relatedResultSet(), executed = this.semanticExecutedDefinition();
      const generation = ++this.semanticBasisGeneration;
      this.semanticBasis.set(undefined);
      this.semanticCurrentHash.set('');
      if (!definition) return;
      const project = this.project;
      if (project) void this.queriesService.devicePersonal.list(project.ref).then(items => { if (generation === this.semanticBasisGeneration) this.semanticPersonalCopies.set(items.map(item => item.query)); }).catch(() => undefined);
      void semanticQueryHash(definition.request.queryType, (definition.request as ISqlQueryRequest).text ?? '', definition.connectionId ?? '', definition.federation ?? null).then(hash => { if (generation === this.semanticBasisGeneration) this.semanticCurrentHash.set(hash); });
      if (!recordset || !executed) return;
      void semanticQueryHash(executed.request.queryType, (executed.request as ISqlQueryRequest).text ?? '', executed.connectionId ?? '', executed.federation ?? null).then(queryHash => {
        if (generation === this.semanticBasisGeneration) this.semanticBasis.set({ queryHash, resultIndex: resultSet === 'affiliations' ? 0 : 1 + (this.runResult()?.relatedRecordsets?.findIndex(item => item.id === resultSet) ?? 0), columns: recordset.columns.map(column => ({ name: column.name, dataType: column.type ?? 'unknown' })) });
      });
    });
    addIcons({ copyOutline, informationCircleOutline, shieldCheckmarkOutline });
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
      const sessionId = this.contextSessionId();
      if (sessionId) this.sessionWorkspace?.snapshotFor(sessionId);
      this.syncScopeAndBindings();
    });
    // Agent security contexts are project/base-URL specific reactive handles.
    // A cold route can arrive before agent-info resolves; keep this effect
    // subscribed to the exact handle so its eventual identity starts the read.
    effect(() => {
      const ref = this.hostedDetectiveProjectRef();
      if (!ref) return;
      const context = this.detectiveContext(ref);
      const requestKey = context
        ? this.detectiveScopeKey(ref, context)
        : `${JSON.stringify(ref)}:unavailable`;
      if (requestKey === this.hostedDetectiveRequestKey) return;
      this.hostedDetectiveRequestKey = requestKey;
      const generation = ++this.hostedDetectiveRequestGeneration;
      this.hostedDetectiveLoadedScope.set(undefined);
      this.hostedDetectiveState.set(undefined);
      this.hostedDetectiveError.set(undefined);
      if (!context) return;
      this.detectiveClient
        .state(context)
        .pipe(takeUntil(this.destroyed))
        .subscribe({
          next: (state) => {
            if (
              generation === this.hostedDetectiveRequestGeneration &&
              this.hostedDetectiveRequestKey === requestKey &&
              equalProjectRef(this.project?.ref, ref)
            ) {
              this.hostedDetectiveState.set(state);
              this.hostedDetectiveLoadedScope.set(requestKey);
            }
          },
          error: (error: unknown) => {
            if (
              generation === this.hostedDetectiveRequestGeneration &&
              this.hostedDetectiveRequestKey === requestKey &&
              equalProjectRef(this.project?.ref, ref)
            )
              this.hostedDetectiveError.set(
                detectiveErrorMessage(error, context.kind === 'cloud'),
              );
          },
        });
    });
    effect(() => {
      const runId = this.sessionRecordedRun();
      const running = this.running(), pinning = this.sessionPinning(), error = this.runError();
      if (runId && !running && !pinning) untracked(() => { void this.finishSessionQuery('failed', error ? 'source-query-failed' : 'client-run-interrupted'); });
    });
    effect(() => {
      const selected = this.selectedAuthorResultRow();
      if (selected && this.currentAuthorResultRow() !== selected)
        this.selectedAuthorResultRow.set(undefined);
      if (
        this.authorRowDetailsOpen() &&
        (!this.currentAuthorResultRow() ||
          this.resultPageLoading() ||
          this.authorRowDetailsSnapshot !== this.authorResultSnapshotKey())
      )
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
    if (
      parameterAttempt &&
      parameterAttempt.scope !== this.authorRunParameterScope()
    )
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
    if (
      this.comparisonObservedScopeIdentity &&
      this.comparisonObservedScopeIdentity !== scopeIdentity
    )
      this.invalidateComparison(
        'The project, access classification, query, or agent context changed.',
      );
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
    if (!this.authorViewActive || !this.isCurrentRoute()) return;
    try {
      this.updateUrl(); // If called in constructor breaks back button
      const semanticCopy = QueryPageComponent.pendingSemanticCopy;
      if (semanticCopy && semanticCopy.id === this.queryState.id) {
        QueryPageComponent.pendingSemanticCopy = undefined;
        this.envId = semanticCopy.environment;
        this.selectedSource.set(semanticCopy.selectedSource);
        this.setDisplayedResult(semanticCopy.result);
        this.commitSuccessfulResult(semanticCopy.result, semanticCopy.definition, undefined, false);
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process ionViewDidEnter event');
    }
  }

  ionViewWillEnter(): void {
    this.authorViewActive = true;
  }

  private readonly onQueryEditorStateChanged = (
    editorState?: IQueryEditorState,
  ): void => {
    try {
      this.editorState = editorState;
      if (!editorState?.currentQueryId) {
        this.loadedTextRepresentation.set(undefined);
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
      // The editor service emits a loading placeholder before a same-ID saved
      // reload. Its next definition is a new source-format decision, while
      // ordinary draft emissions keep the original representation pinned.
      if (queryState.isLoading && !queryState.def)
        this.loadedTextRepresentation.set(undefined);
      const structuralDraft = this.authorSavedDefinition();
      if (
        structuralDraft &&
        (structuralDraft.queryId !== queryState.id ||
          (queryState.def !== structuralDraft.local &&
            queryState.def !== structuralDraft.saved))
      )
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
        this.hostedExecution.set(undefined);
        this.localScenarioExecution.set(undefined);
        this.hostedSelectedRow.set(undefined);
        this.hostedStatusFilter.set('all');
        ++this.semanticMappingLifetime;
        this.semanticSaving.set(false);
        this.semanticDialog.set(undefined);
        this.authorRunParameterAttempt.set(undefined);
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
      const representationScope = JSON.stringify([this.project?.ref, queryState.id]);
      if (effectiveDefinition && this.loadedTextRepresentation()?.scope !== representationScope) {
        this.nativeParameterDrafts.set(new Map());
        this.nativeParameterErrors.set(new Map());
        this.userBindingValues.set(new Map());
        this.clearedParamIds.set(new Set());
        this.selectedContextFactKeys.set(new Map());
        this.confirmedConflicts.set(new Map());
        this.bindingSnapshotKey = '';
        const original = (queryState.def?.request as ITextQueryRequest | undefined)?.text ?? '';
        const legacyDtql = effectiveDefinition.request.queryType === QueryType.DTQL &&
          isLegacyDtqlSource(original);
        this.loadedTextRepresentation.set({
          scope: representationScope,
          kind: legacyDtql ? 'dtql' : 'tugql',
        });
        this.selectWorkspaceTab(effectiveDefinition.request.queryType === QueryType.SQL
          ? 'sql' : legacyDtql ? 'dtql' : 'tugql');
      }
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
        ((this.project?.ref.projectApi === 'cloud' ||
          (this.project && isSharedProjectRef(this.project.ref))) &&
          previousDefinition &&
          !effectiveDefinition)
      ) {
        this.invalidateComparison(
          'The selected query or project scope changed.',
        );
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
      this.scheduleEntryRuntimeLoad();
      this.changeDetector.markForCheck();
      if (effectiveDefinition?.federation?.nativeGraph)
        void this.refreshLocalHistory();
      const hasBoundSqlConnection =
        effectiveDefinition?.request.queryType === QueryType.SQL &&
        !!effectiveDefinition.connectionId;
      if (
        this.queryState.environments &&
        !this.queryState.activeEnv &&
        !this.queryState.isLoading &&
        !hasBoundSqlConnection
      ) {
        this.setActiveEnv(this.queryState.environments[0].id);
      }
      if (queryState.activeEnv?.id && queryState.activeEnv.id !== this.envId) {
        this.envId = queryState?.activeEnv.id;
        this.datatugNavContextService.setCurrentEnvironment(this.envId);
        this.scheduleEntryRuntimeLoad();
      }
      this.syncScopeAndBindings();
      const semanticCopy = QueryPageComponent.pendingSemanticCopy;
      if (semanticCopy && semanticCopy.id === queryState.id && this.route.snapshot.queryParamMap.get('id') === semanticCopy.id) {
        QueryPageComponent.pendingSemanticCopy = undefined;
        this.envId = semanticCopy.environment;
        this.selectedSource.set(semanticCopy.selectedSource);
        this.setDisplayedResult(semanticCopy.result);
        this.commitSuccessfulResult(semanticCopy.result, semanticCopy.definition, undefined, false);
      }
      const pendingResult = this.pendingResultDisplay;
      if (
        pendingResult &&
        queryState.id === pendingResult.queryId &&
        queryState.def &&
        !queryState.isLoading
      ) {
        // A saved query opened from a stored result: its rows are shown once the query itself is loaded.
        this.pendingResultDisplay = undefined;
        this.showSavedRows(pendingResult.plan.displayed);
        this.bindResultParameters(
          pendingResult.plan,
          new Set((queryState.def.parameters ?? []).map((p) => p.id)),
        );
      }
    } catch (e) {
      this.errorLogger.logError(
        e,
        'Failed to process query editor state change',
      );
    }
  };

  ngOnDestroy(): void {
    this.resultSubscription?.unsubscribe();
    this.restoreTitle();
    this.workspaceTabResizeObserver?.disconnect();
    if (this.workspaceTabRevealFrame !== undefined)
      cancelAnimationFrame(this.workspaceTabRevealFrame);
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
    this.stopFederatedRun();
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
            this.keepResultEnvironment();
            return;
          }
          const { id } = currentEnv;
          if (!id) {
            return;
          }
          if (this.envId !== undefined && this.envId !== id) {
            this.invalidateFederatedRun();
            this.stopFederatedRun();
            this.setDisplayedResult(undefined);
          }
          this.envId = id;
          this.scheduleEntryRuntimeLoad();
          this.agentSelectedEnvironment.set(id);

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

  /**
   * An address with no environment (`…/query?result=<id>`) clears the environment a moment after the result selected
   * it, when the page is opened in a tab that chose none. While the saved result is open the environment it ran in
   * stays selected (a different environment the person picks is kept; only a cleared one is put back).
   */
  private keepResultEnvironment(): void {
    const env = this.resultEnvId;
    if (!env || this.savedResultBanner()?.kind !== 'shown') return;
    queueMicrotask(() => {
      if (this.resultEnvId === env)
        this.datatugNavContextService.setCurrentEnvironment(env);
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
            this.invalidateComparison(
              'The current project context was cleared.',
            );
          }
          return; // TODO: cleanup query state?
        }
        if (
          this.comparisonRouteProjectRef &&
          !equalProjectRef(this.comparisonRouteProjectRef, currentProject.ref)
        )
          return;
        if (
          equalProjectRef(this.project?.ref, currentProject.ref) &&
          this.project?.summary?.environments?.length ===
            currentProject.summary?.environments?.length &&
          this.project?.summary?.access === currentProject.summary?.access &&
          this.comparisonProjectAccess() === currentProject.summary?.access
        ) {
          this.restoreNavigationDraft(currentProject.ref);
          void this.restoreDemoTableDraft();
          return;
        }
        if (
          this.project?.ref.projectId !== currentProject.ref.projectId ||
          this.project?.ref.storeId !== currentProject.ref.storeId
        )
          this.invalidateHistoryScope();
        const previousRef = this.project?.ref;
        this.project = currentProject;
        this.backTarget.update((n) => n + 1);
        this.updateResultTitle();
        this.refreshHostedProject(currentProject.ref, previousRef);
        this.comparisonAccessProjectRef = currentProject.ref;
        this.comparisonProjectAccess.set(currentProject.summary?.access);
        this.initializeCustomerInvoiceExample();
        if (!equalProjectRef(previousRef, currentProject.ref)) {
          this.agentRunEnvironments.set([]);
          this.agentRunEnvironmentsError.set('');
          this.agentSelectedEnvironment.set('');
          this.authorSourcesToggled(false);
          this.selectedAuthorResultRow.set(undefined);
          this.sharedQuerySaveAllowed.set(false);
          if (isSharedProjectRef(currentProject.ref)) {
            this.queriesService
              .capabilities(currentProject.ref)
              .pipe(takeUntil(this.destroyed))
              .subscribe({
                next: (capabilities) => {
                  if (equalProjectRef(this.project?.ref, currentProject.ref))
                    this.sharedQuerySaveAllowed.set(
                      capabilities.querySave === true,
                    );
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
                { show: false, feedback: false },
              ),
          });
        }
        this.restoreNavigationDraft(currentProject.ref);
        void this.restoreDemoTableDraft();
        if (
          (currentProject.ref.projectApi ||
            isSharedProjectRef(currentProject.ref)) &&
          !equalProjectRef(previousRef, currentProject.ref)
        ) {
          const routeId = this.route.snapshot.paramMap.get('queryId');
          const parameterId = this.route.snapshot.queryParamMap.get('id');
          const id =
            routeId && parameterId && routeId !== parameterId
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

  public async loadAgentRunEnvironments(): Promise<void> {
    const ref = this.project?.ref;
    if (!ref || isBrowserSqlProject(ref) || this.agentRunEnvironmentsLoading())
      return;
    this.agentRunEnvironmentsLoading.set(true);
    this.agentRunEnvironmentsError.set('');
    try {
      const project = await firstValueFrom(
        this.injector.get(ProjectService).getFull(ref),
      );
      if (!equalProjectRef(this.project?.ref, ref)) return;
      this.agentRunEnvironments.set(project.environments || []);
      if (!project.environments?.length)
        this.agentRunEnvironmentsError.set(
          'No logical environments are configured for this project.',
        );
    } catch {
      if (equalProjectRef(this.project?.ref, ref))
        this.agentRunEnvironmentsError.set(
          'Could not load project environments from the agent. Retry or reconnect.',
        );
    } finally {
      this.agentRunEnvironmentsLoading.set(false);
    }
  }

  public isAgentRunProject(): boolean {
    return !!this.project && !isBrowserSqlProject(this.project.ref);
  }

  public selectAgentRunEnvironment(id: string): void {
    if (
      !this.agentRunEnvironments().some((environment) => environment.id === id)
    )
      return;
    this.agentSelectedEnvironment.set(id);
    this.envId = id;
    this.datatugNavContextService.setCurrentEnvironment(id);
    this.setActiveEnv(id);
    this.runError.set(undefined);
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
        // Names only: a value may be a stored result's id.
        console.log(
          'QueryPageComponent.trackQueryParams(): queryParams:',
          queryParams.keys,
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
        const resultId = queryParams.get(RESULT_QUERY_PARAM);
        if (routeId && parameterId && routeId !== parameterId) {
          this.customerInvoiceExample.set(false);
          this.runError.set('Query URL and query ID disagree.');
          return;
        }
        // `?result=` keeps an unsaved draft out of the address. Reuse the
        // editor identity obtained from that result on later URL emissions;
        // a new random id here would make a runtime/env normalization look
        // like a different query and discard the restored draft.
        const addressQueryId = routeId || parameterId;
        let queryId = addressQueryId ||
          (resultId && this.resultQueryId ? this.resultQueryId : undefined);
        const runtime = queryParams.get('runtime');
        const requestedEnv = queryParams.get('env') ?? undefined;
        const demoDraft = queryParams.get('demoDraft');
        const routeKey = JSON.stringify({ queryId: addressQueryId, resultId, demoDraft, runtime, requestedEnv,
          storeId: this.route.snapshot.paramMap.get('storeId'),
          projectId: this.route.snapshot.paramMap.get('projectId'),
          branch: queryParams.get('branch'), projectApi: queryParams.get('projectApi') });
        // A table entry is an unsaved editor, not a saved-query address. Keep
        // one identity across editor/env URL normalization while its scoped
        // draft is authenticated and resolved asynchronously.
        if (demoDraft && !addressQueryId && !resultId) {
          if (this.demoDraftEntry?.routeKey !== routeKey) {
            this.demoDraftEntry = { token: demoDraft, routeKey,
              queryId: this.randomIdService.newRandomId() };
          }
          queryId = this.demoDraftEntry.queryId;
        }
        const previousRoute = this.entryRouteKey ? JSON.parse(this.entryRouteKey) as {
          queryId?: string; resultId?: string | null; demoDraft?: string | null; runtime?: string | null;
        } : undefined;
        const entryChanged = routeKey !== this.entryRouteKey;
        const newSelection = !previousRoute || previousRoute.queryId !== addressQueryId ||
          previousRoute.resultId !== resultId || previousRoute.demoDraft !== demoDraft ||
          (previousRoute.runtime !== runtime && runtime !== this.selectedWorkingCopy());
        if (entryChanged) {
          if (previousRoute && previousRoute.resultId !== resultId) {
            // A and B can share a query and runtime while having distinct
            // result addresses. A's run must not replace B's saved rows.
            ++this.semanticRunLifetime;
            this.invalidateFederatedRun();
            this.stopFederatedRun();
            this.savedRowsShown = undefined;
            this.setDisplayedResult(undefined);
            this.committedRun.set(undefined);
            this.resultPageRows.set([]);
            this.runError.set(undefined);
          }
          this.entryRouteKey = routeKey;
          this.entryLoadKey = '';
          ++this.workingCopyLoad;
          if (newSelection) {
            this.workingCopyScope = '';
            this.workingCopyOptions.set([]);
            this.workingCopyError.set(undefined);
            this.unavailableWorkingCopy.set(!!runtime && runtime !== 'project');
            this.changeWorkingCopySelection(runtime || 'project');
            this.entryRuntimeHint.set(runtime && runtime !== 'project'
              ? { selectionId: runtime,
                  queryId: addressQueryId || (resultId ? undefined : queryId),
                  resultId: resultId || undefined,
                  environment: requestedEnv }
              : undefined);
          }
        }
        const isNew = !addressQueryId;
        if (!queryId) {
          queryId = this.randomIdService.newRandomId();
        }
        if (demoDraft && !addressQueryId && !resultId) {
          if (!this.queryEditorStateService.getQueryState(queryId)) {
            this.queryEditorStateService.newQuery({
              id: queryId, isNew: true, isLoading: false,
              queryType: QueryType.SQL,
              request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
              // Seed this before the synchronous editor emission can normalize
              // the URL; the draft service still validates the declared env.
              ...(requestedEnv ? { activeEnv: { id: requestedEnv } } : {}),
            });
          } else if (this.queryId !== queryId) {
            this.queryEditorStateService.setCurrentQuery(queryId);
          }
        }
        this.setQueryId(queryId, isNew);
        if (entryChanged && newSelection && runtime && queryId) {
          const cached = this.queryEditorStateService.getQueryState(queryId);
          if (cached?.def && !cached.isLoading && !cached.isNew)
            this.queryEditorStateService.reloadQuery(queryId);
        }
        this.initializeCustomerInvoiceExample();

        const envId = queryParams.get('env');
        if (envId) {
          this.setActiveEnv(envId);
        }
        this.scheduleEntryRuntimeLoad();
        void this.restoreDemoTableDraft();
        if (resultId) {
          this.openFromResult(resultId);
        } else if (this.savedResultId() &&
          (!parameterId || parameterId !== this.resultQueryId)) {
          this.closeSavedResult();
        }
      },
    });
  }

  private refreshHostedProject(
    ref: IProjectRef,
    previousRef?: IProjectRef,
  ): void {
    if (equalProjectRef(previousRef, ref)) return;
    this.hostedDetectiveState.set(undefined);
    this.hostedDetectiveError.set(undefined);
    this.hostedEnvironment.set('');
    this.hostedExecution.set(undefined);
    this.localScenarioExecution.set(undefined);
    this.hostedSelectedRow.set(undefined);
    this.hostedStatusFilter.set('all');
    this.hostedDetectiveLoadedScope.set(undefined);
    this.hostedDetectiveProjectRef.set(ref);
    const context = this.detectiveContext(ref);
    const requestKey = context
      ? this.detectiveScopeKey(ref, context)
      : `${JSON.stringify(ref)}:unavailable`;
    this.hostedDetectiveRequestKey = requestKey;
    const generation = ++this.hostedDetectiveRequestGeneration;
    if (!context) return;
    this.detectiveClient
      .state(context)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (state) => {
          if (
            generation === this.hostedDetectiveRequestGeneration &&
            this.hostedDetectiveRequestKey === requestKey &&
            equalProjectRef(this.project?.ref, ref)
          ) {
            this.hostedDetectiveState.set(state);
            this.hostedDetectiveLoadedScope.set(requestKey);
          }
        },
        error: (error: unknown) => {
          if (
            generation === this.hostedDetectiveRequestGeneration &&
            this.hostedDetectiveRequestKey === requestKey &&
            equalProjectRef(this.project?.ref, ref)
          )
            this.hostedDetectiveError.set(
              detectiveErrorMessage(error, context.kind === 'cloud'),
            );
        },
      });
  }

  private onProjRefChanged = (ref: IProjectRef) => {
    this.comparisonRouteProjectRef = ref;
    const prevProject = this.project;
    if (prevProject && !equalProjectRef(prevProject.ref, ref)) {
      this.invalidateFederatedRun();
      this.stopFederatedRun();
      this.setDisplayedResult(undefined);
    }
    if (
      ref.projectId !== prevProject?.ref.projectId ||
      ref.storeId !== prevProject?.ref.storeId
    )
      this.invalidateHistoryScope();
    const sameResolvedProject =
      equalProjectRef(prevProject?.ref, ref) && !!prevProject?.summary;
    this.project = sameResolvedProject
      ? prevProject
      : newProjectContextFromRef(ref);
    this.scheduleEntryRuntimeLoad();
    this.backTarget.update((n) => n + 1);
    this.refreshHostedProject(ref, prevProject?.ref);
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
      this.backTarget.update((n) => n + 1);
      return;
    }
    const i = id.lastIndexOf('/');
    if (i >= 0) {
      this.queryFolderPath = id.substring(0, i);
      this.backTarget.update((n) => n + 1);
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
    return (
      JSON.stringify({
        request: this.queryState.request,
        relationshipBindings: this.queryState.def?.relationshipBindings?.length
          ? this.queryState.def.relationshipBindings
          : undefined,
      }) !==
      JSON.stringify({
        request: draft.saved.request,
        relationshipBindings: draft.saved.relationshipBindings?.length
          ? draft.saved.relationshipBindings
          : undefined,
      })
    );
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
    if (this.queryState.saveSupported === false && !this.project?.ref.spaceID)
      return;
    const ce = event as CustomEvent;
    this.queryState = {
      ...this.queryState,
      title: ce.detail.value || '',
    };
    this.queryEditorStateService.updateQueryState(this.queryState);
  }

  updateUrl(): void {
    if (!this.authorViewActive || !this.isCurrentRoute()) return;
    // TODO: make sure not clashes with SqlQueryEditComponent
    // A draft opened from a stored result has no saved id to put in the address: `result` reopens it after a refresh.
    // Once the draft is saved it has an id of its own and `result` is dropped.
    const fromResult =
      this.resultQueryId !== undefined && this.resultQueryId === this.queryId;
    // A result with no query to edit leaves the editor with no query of its own either.
    const unsavedResultDraft =
      (fromResult && this.queryState.isNew === true) ||
      this.resultMode === 'rows-only';
    const savedResultDraft =
      fromResult && this.resultMode === 'draft' && this.queryState.isNew !== true;
    const unsavedTableDraft = this.queryState.isNew === true &&
      this.demoDraftEntry?.queryId === this.queryId &&
      this.demoDraftEntry?.token === this.route.snapshot.queryParamMap.get('demoDraft') &&
      !this.route.snapshot.queryParamMap.get('id') &&
      !this.route.snapshot.paramMap.get('queryId');
    const queryParams: Params = {
      id: unsavedResultDraft || unsavedTableDraft ? undefined : this.queryId,
      editor: this.editorTab,
      env: this.queryState.activeEnv?.id,
      ...(savedResultDraft ? { [RESULT_QUERY_PARAM]: undefined } : {}),
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

  /** Ionic gives routed pages a proxy, so ownership follows its active snapshot. */
  private isCurrentRoute(): boolean {
    if (this.router.currentNavigation?.()) return false;
    const root = this.router.routerState?.root;
    if (!root) return false;
    const pending: ActivatedRoute[] = [root];
    while (pending.length) {
      const route = pending.pop();
      if (!route) continue;
      if (route.snapshot === this.route.snapshot) return true;
      pending.push(...route.children);
    }
    return false;
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
      .map((p) => ({ id: p.id, meta: p.meta, required: p.isRequired }));
    if (!parameters.length) {
      this.bindings.set([]);
      this.clearedParamIds.set(new Set());
      this.confirmedConflicts.set(new Map());
      return;
    }
    const selectionFacts = this.buildSelectionFacts(parameters);
    const sessionId = this.contextSessionId();
    const sessionScope = this.sessionWorkspace && sessionId ? queryContextScope(this.sessionWorkspace.capabilities(), this.envId ?? '', this.queryDef()) : undefined;
    const contextFacts = this.sessionWorkspace && sessionId
      ? sessionScope ? this.sessionWorkspace.appliedFactsFor(sessionId, sessionScope) : []
      : this.investigationContext
      .items()
      .filter((item) => item.enabled && isFactSelectedForBinding(item));
    const activeContextScope = this.investigationContext.scope();
    const contextScopeKey = this.sessionWorkspace && sessionId
      ? sessionScope ? this.sessionWorkspace.bindingScopeKey(sessionId, sessionScope) : undefined
      : activeContextScope
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
      sessionId,
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

  public nativeParameterValue(parameterId: string): string {
    const draft = this.nativeParameterDrafts().get(parameterId);
    if (draft !== undefined) return draft;
    const value = this.bindings().find((binding) => binding.parameterId === parameterId)?.value;
    return value === undefined ? '' : String(value.value);
  }

  public nativeParameterBinding(parameterId: string): ResolvedBinding | undefined {
    return this.bindings().find((binding) => binding.parameterId === parameterId);
  }

  public nativeParameterError(parameterId: string): string | undefined {
    return this.nativeParameterErrors().get(parameterId);
  }

  public nativeParameterInputKind(parameter: IParameterDef): 'text' | 'decimal' | 'numeric' {
    return parameter.type === 'integer' ? 'numeric' :
      ['number', 'float', 'decimal', 'money'].includes(parameter.type) ? 'decimal' : 'text';
  }

  public nativeParameterHint(parameter: IParameterDef): string {
    const parts = [parameter.type, parameter.isRequired ? 'Required' : 'Optional'];
    const binding = this.nativeParameterBinding(parameter.id);
    if (binding?.value !== undefined && binding.origin && binding.origin !== 'user') {
      parts.push(`from ${binding.origin}`);
      if (binding.origin === 'context' && binding.role) parts.push(binding.role);
    }
    return parts.join(' · ');
  }

  public nativeParameterSupported(parameter: IParameterDef): boolean {
    return parameter.type !== 'binary' && !parameter.isMultiValue;
  }

  public clearNativeParameter(parameterId: string): void {
    this.nativeParameterDrafts.set(new Map(this.nativeParameterDrafts()).set(parameterId, ''));
    this.nativeParameterErrors.set(new Map([...this.nativeParameterErrors()].filter(([id]) => id !== parameterId)));
    this.clearBinding(parameterId);
  }

  public setNativeParameterInput(parameter: IParameterDef, input: string | null | undefined): void {
    const raw = input ?? '';
    this.nativeParameterDrafts.set(new Map(this.nativeParameterDrafts()).set(parameter.id, raw));
    if (!raw.length) {
      this.clearNativeParameter(parameter.id);
      return;
    }
    const kind = parameter.type === 'integer' ? 'integer' :
      parameter.type === 'decimal' || parameter.type === 'money' ? 'decimal' :
      parameter.type === 'number' || parameter.type === 'float' ? 'number' :
      parameter.type === 'boolean' || parameter.type === 'bit' ? 'boolean' :
      parameter.type === 'date' ? 'date' :
      parameter.type === 'datetime' ? 'datetime' :
      ['string', 'text', 'UUID', 'GUID'].includes(parameter.type) ? 'string' : undefined;
    try {
      if (!kind || parameter.isMultiValue) throw new Error('This parameter type needs a supported editor.');
      const candidate = { type: kind, value: kind === 'number' ? Number(raw) : kind === 'boolean' ? raw === 'true' ? true : raw === 'false' ? false : raw : raw };
      const value = decodeTypedValue(candidate);
      if (value.type === 'integer' && !Number.isSafeInteger(Number(value.value)))
        throw new Error('This integer cannot be represented losslessly by SQL.');
      this.nativeParameterErrors.set(new Map([...this.nativeParameterErrors()].filter(([id]) => id !== parameter.id)));
      this.editBinding(parameter.id, value);
    } catch {
      this.clearBinding(parameter.id);
      this.nativeParameterErrors.set(new Map(this.nativeParameterErrors()).set(parameter.id, `Enter a valid ${parameter.type} value before running.`));
    }
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
    this.resultChartView.set('grid');
    this.resultChartCategory.set('');
    this.resultChartMeasure.set('');
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
    if (result !== this.savedRowsShown) this.savedRowsShown = undefined;
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
      this.selectedWorkingCopy(),
      this.selectedSource(),
      this.envId,
      this.effectiveBindings().map((binding) => [
        binding.parameterId,
        binding.value,
        binding.origin,
        binding.factId,
      ]),
    ]);
  }

  private currentResultTargetLabel(
    definition = this.queryDef(),
    result?: FederatedQueryResult,
  ): string {
    if (result?.browserExecution?.runtime === 'ovdb-connection')
      return result.provenance.source || 'Open working copy';
    if (result?.browserExecution?.runtime === 'sqlite-fixture')
      return result.provenance.source || 'Published browser SQLite snapshot';
    const federationBase = definition?.federation?.ovdbBaseUrl;
    if (federationBase) {
      try {
        return `OVDB at ${new URL(federationBase).origin}`;
      } catch {
        return 'Configured OVDB endpoint';
      }
    }
    const connectionId = definition?.connectionId;
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
    recordSessionOutcome = true,
  ): void {
    if (!this.hasCompleteResult(result)) {
      if (recordSessionOutcome) void this.finishSessionQuery('failed', 'incomplete-result');
      return;
    }
    this.semanticExecutedDefinition.set(definition);
    if (recordSessionOutcome) void this.finishSessionQuery('completed');
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
  private runHostedSavedQuery(
    ref: IProjectRef,
    queryId: string,
    definition: IQueryDef | undefined,
    runRequestedAt: number,
  ): void {
    if (this.running()) return;
    if (
      !ref.spaceID ||
      !definition ||
      isDevicePersonalQuery(queryId) ||
      this.queryState.isNew ||
      this.queryState.isSaving ||
      this.isChanged
    ) {
      this.runError.set('Save this query before running its hosted revision.');
      return;
    }
    const state = this.hostedDetectiveState();
    if (!state?.capabilities.canRun) {
      this.runError.set(
        this.hostedDetectiveError() ??
          'Hosted execution is unavailable for this project. Reload after its executor is connected.',
      );
      return;
    }
    const environment = this.hostedEnvironment();
    if (!environment || !state.environments?.includes(environment)) {
      this.runError.set(
        'Select an available hosted environment before running.',
      );
      return;
    }
    if (this.hasBlockedBindings()) {
      this.runError.set(
        'Resolve every ambiguous, conflicting or required parameter before running.',
      );
      return;
    }
    const missingFact = this.effectiveBindings().find(
      (binding) =>
        (binding.origin === 'selection' || binding.origin === 'context') &&
        !binding.factId,
    );
    if (missingFact) {
      this.runError.set(
        `Cannot run ${missingFact.parameterId}: its bound value has no fact provenance.`,
      );
      return;
    }
    const inputs = Object.fromEntries(
      this.effectiveBindings().map((binding) => [
        binding.parameterId,
        binding.value as TypedValue,
      ]),
    );
    const context = {
      kind: 'cloud' as const,
      storage: 'firestore' as const,
      spaceID: ref.spaceID,
      project: ref.projectId,
    };
    const projectKey = JSON.stringify(ref);
    const definitionKey = JSON.stringify(definition);
    const lifetime = ++this.federatedRunLifetime;
    const current = (): boolean =>
      lifetime === this.federatedRunLifetime &&
      JSON.stringify(this.project?.ref) === projectKey &&
      this.queryId === queryId &&
      this.hostedEnvironment() === environment &&
      JSON.stringify(this.queryDef()) === definitionKey;
    this.hostedExecution.set(undefined);
    this.hostedSelectedRow.set(undefined);
    this.hostedStatusFilter.set('all');
    this.hostedScenarioMessage.set('');
    this.hostedScenarioError.set('');
    this.running.set(true);
    this.runError.set(undefined);
    const session = this.queryDispatch.start({
      projectRef: ref,
      definition,
      queryId,
      environment,
      target: { kind: 'hosted-cloud' },
      hostedInputs: inputs,
    });
    this.activeDispatchSession = session;
    void (session.hostedResponse ?? Promise.reject(new Error('Hosted execution session has no response.')))
      .then((response: HostedQueryResponse) => {
          if (!current()) return;
          const execution = response.result.execution;
          if (
            !execution ||
            execution.storeId !== ref.storeId ||
            execution.projectId !== ref.projectId
          ) {
            this.runError.set(
              'The hosted query returned no matching retained execution receipt.',
            );
            this.running.set(false);
            return;
          }
          const result: FederatedQueryResult = response.result;
          this.showAttemptResult(result);
          const timing: QueryRunTiming = {
            allResultsLoadedMs: Math.max(0, monotonicTime() - runRequestedAt),
            noRecords: result.recordset.rows.length === 0,
          };
          this.queryRunTiming.set(timing);
          this.commitSuccessfulResult(result, definition, timing);
          const executed: HostedQueryExecution = {
            result,
            generation: this.displayedResultGeneration(),
            projectKey,
            queryId,
            environment,
            execution,
            queryRevision: response.queryRevision,
            resultFingerprint: response.resultFingerprint,
          };
          this.hostedExecution.set(executed);
          const validateReceipt = (attempt: number): void => {
            if (!current()) return;
            this.detectiveClient
              .action(context, {
                type: 'run-query-validators',
                queryId,
                environment,
                execution,
                ...(this.hostedScenarioTarget()
                  ? { caseId: this.hostedScenarioTarget()?.caseId }
                  : {}),
              })
              .pipe(takeUntil(this.destroyed))
              .subscribe({
                next: (validated) => {
                  if (!current()) return;
                  const run = validated.run;
                  if (run?.executionStatus === 'pending') {
                    this.hostedExecution.set({
                      ...executed,
                      run,
                      validationPending: true,
                    });
                    this.running.set(false);
                    if (attempt < 20)
                      setTimeout(() => validateReceipt(attempt + 1), 1500);
                    else
                      this.hostedExecution.set({
                        ...executed,
                        run,
                        validationError:
                          'Validation is still pending. Refresh run history to inspect its final outcome.',
                      });
                    return;
                  }
                  if (
                    !run ||
                    run.kind !== 'query-validators' ||
                    run.queryId !== queryId ||
                    run.environment !== environment ||
                    run.steps[0]?.queryId !== queryId ||
                    !sameExecution(execution, run.steps[0]?.execution)
                  ) {
                    this.hostedExecution.set({
                      ...executed,
                      validationError:
                        'Validation did not return a run linked to these exact query rows.',
                    });
                  } else {
                    this.hostedExecution.set({
                      ...executed,
                      run,
                      caseLinkNotice: caseRunLinkMessage(
                        this.hostedScenarioTarget()?.caseId,
                        run.id,
                        validated.caseLinkStatus,
                        run.executionStatus,
                      ),
                    });
                  }
                  this.running.set(false);
                },
                error: (error: unknown) => {
                  if (!current()) return;
                  if (
                    error instanceof HttpErrorResponse &&
                    error.status === 409 &&
                    attempt < 20
                  ) {
                    this.hostedExecution.set({
                      ...executed,
                      validationPending: true,
                    });
                    this.running.set(false);
                    setTimeout(() => validateReceipt(attempt + 1), 1500);
                    return;
                  }
                  this.hostedExecution.set({
                    ...executed,
                    validationError: detectiveErrorMessage(error, true),
                  });
                  this.running.set(false);
                },
              });
          };
          validateReceipt(0);
        })
      .catch((error: unknown) => {
          if (!current()) return;
          this.runError.set(detectiveErrorMessage(error, true));
          this.running.set(false);
        })
      .finally(() => {
        if (this.activeDispatchSession === session) this.activeDispatchSession = undefined;
        void session.dispose();
      });
  }

  public async completeHostedScenarioStep(): Promise<void> {
    const ref = this.project?.ref;
    const target = this.hostedScenarioTarget();
    const hostedExecution = this.activeHostedExecution();
    const localExecution = this.activeLocalScenarioExecution();
    const executionRef =
      hostedExecution?.execution ?? localExecution?.execution;
    const queryId = hostedExecution?.queryId ?? localExecution?.queryId;
    const environment =
      hostedExecution?.environment ?? localExecution?.environment;
    const context = ref ? this.detectiveContext(ref) : undefined;
    if (
      !ref ||
      !target ||
      !executionRef ||
      !queryId ||
      queryId !== this.queryId ||
      !environment ||
      !context ||
      this.hostedScenarioBusy()
    )
      return;
    const completionToken = ++this.hostedScenarioCompletionToken;
    const isCurrent = (): boolean =>
      equalProjectRef(this.project?.ref, ref) &&
      this.queryId === queryId &&
      this.hostedScenarioTarget()?.caseId === target.caseId &&
      this.hostedScenarioTarget()?.applicationId === target.applicationId &&
      this.hostedScenarioTarget()?.stepId === target.stepId &&
      (hostedExecution
        ? this.activeHostedExecution() === hostedExecution
        : this.activeLocalScenarioExecution() === localExecution);
    this.hostedScenarioBusy.set(true);
    this.hostedScenarioError.set('');
    this.hostedScenarioMessage.set('');
    try {
      const latest = await firstValueFrom(this.detectiveClient.state(context));
      if (!isCurrent()) return;
      const item = latest.cases.find(
        (candidate) => candidate.id === target.caseId,
      );
      const application = item?.scenarioApplications?.find(
        (candidate) => candidate.id === target.applicationId,
      );
      const step = application?.snapshot.steps.find(
        (candidate) => candidate.id === target.stepId,
      );
      const receipt = application?.steps.find(
        (candidate) => candidate.stepId === target.stepId,
      );
      if (
        !item ||
        item.status !== 'active' ||
        step?.kind !== 'query' ||
        step.ref !== queryId ||
        receipt?.status !== 'pending'
      )
        throw new Error(
          'This Scenario step changed. Return to the Case and review it.',
        );
      const response = await firstValueFrom(
        this.detectiveClient.action(
          context,
          {
            type: 'record-scenario-step',
            caseId: item.id,
            applicationId: target.applicationId,
            stepId: target.stepId,
            stepStatus: 'completed',
            queryId,
            environment,
            execution: executionRef,
          },
          item.version,
        ),
      );
      if (!isCurrent()) return;
      const updatedCase = response.case;
      if (!updatedCase)
        throw new Error('The project store did not return the updated Case.');
      this.hostedDetectiveState.set({
        ...latest,
        cases: latest.cases.map((candidate) =>
          candidate.id === item.id ? updatedCase : candidate,
        ),
      });
      this.hostedScenarioMessage.set(
        hostedExecution
          ? 'Scenario query step recorded from this saved execution. Its evidence outcome is unknown until a Validator asserts it.'
          : 'Scenario query step recorded from the persisted local query execution. The receipt proves execution, not a validation outcome.',
      );
    } catch (error) {
      if (isCurrent())
        this.hostedScenarioError.set(
          detectiveErrorMessage(error, context.kind === 'cloud'),
        );
    } finally {
      if (completionToken === this.hostedScenarioCompletionToken)
        this.hostedScenarioBusy.set(false);
    }
  }

  public runQuery(): void {
    if (this.sessionWorkspace && this.contextSessionId()) {
      if (!this.sessionPinning() && !this.running() && !this.sessionRecordedRun()) void this.runSessionQuery();
      return;
    }
    this.runQueryWithPinnedInput();
  }

  private async runSessionQuery(): Promise<void> {
    const workspace = this.sessionWorkspace;
    const definition = this.queryDef();
    const sessionId = this.contextSessionId();
    if (!workspace || !definition || !sessionId || !workspace.canExecuteFor(sessionId)) {
      this.runError.set('Resume this session before running a query.'); return;
    }
    const queryScope = queryContextScope(workspace.capabilities(), this.envId ?? '', definition);
    const scopes = queryScope ? [queryScope] : [];
    if (scopes.length !== 1) { this.runError.set('This query has no unique admitted source identity in this environment. Review the source mapping before running.'); return; }
    const request = definition.request as ITextQueryRequest;
    if (![QueryType.SQL, QueryType.DTQL, QueryType.TugQL].includes(request.queryType) || typeof request.text !== 'string') {
      this.runError.set('This session adapter can record SQL and TugQL executions. This request type has no supported private definition snapshot yet.'); return;
    }
    if (this.rebindSuggestions().length || this.hasBlockedBindings()) {
      this.runError.set('Review and accept the current context bindings before creating a saved session run.'); return;
    }
    this.sessionCompletionGeneration++;
    const latestFacts = workspace.appliedFactsFor(sessionId, scopes[0]);
    const bindings = this.effectiveBindings();
    if (bindings.some((binding) => binding.origin === 'context' && !latestFacts.some((fact) => fact.id === binding.factId && fact.value && binding.value && typedValuesEqual(fact.value, binding.value)))) {
      this.runError.set('These frozen bindings differ from the current applied manifest. Review the new context before running.'); return;
    }
    const resolvedParameters: Record<string, TypedValue> = Object.fromEntries(bindings.flatMap((binding) =>
      binding.value ? [[binding.parameterId, binding.value] as const] : []));
    if (this.isTugqlAuthorJourney() && this.authorHasCustomerIdParameter()) {
      if (!this.authorCustomerIdValid()) { this.runError.set('Enter a whole-number CustomerId before running.'); return; }
      resolvedParameters['CustomerId'] = { type: 'integer', value: this.authorCustomerId() };
    }
    const document: ContextDefinitionDocument = { schemaVersion: 1, kind: 'query', queries: [{ id: definition.id ?? this.queryId ?? 'query', queryType: request.queryType as 'SQL' | 'DTQL' | 'TugQL', text: request.text,
      ...(definition.connectionId ? { connectionId: definition.connectionId } : {}), parameters: (definition.parameters ?? []).map(({ id, type, isRequired }) => ({ id, type, ...(isRequired !== undefined ? { isRequired } : {}) })),
    }] };
    const encoded = JSON.stringify(document);
    const contextSetId = workspace.snapshotFor(sessionId)?.contextSet.id;
    const admittedCapabilities = workspace.capabilities();
    const projectRef = this.project?.ref ? structuredClone(this.project.ref) : undefined;
    const executionIdentity = (): string => JSON.stringify({
      sessionId: this.contextSessionId(), queryId: this.queryId, project: this.project?.ref,
      environmentId: this.envId, scopes: workspace.capabilities()?.environments.filter((scope) => scope.environmentId === this.envId),
      contextSetId: workspace.snapshotFor(sessionId)?.contextSet.id, definition: this.queryDef(),
      bindings: this.effectiveBindings(), source: this.selectedSource(),
      securityContextId: this.agentContext.securityContextId(), authorCustomerId: this.authorCustomerId(),
      authorCustomerIdValid: this.authorCustomerIdValid(), authorCustomerIdOrigin: this.authorCustomerIdOrigin(),
      authorDraftRevision: this.authorDraftRevision(), authorBindingRevision: this.authorBindingRevision(),
      authorPlan: this.authorPlan(), actorId: workspace.capabilities()?.actorId,
      databaseId: workspace.capabilities()?.databaseId, projectId: workspace.capabilities()?.projectId,
    });
    const capturedExecutionIdentity = executionIdentity();
    const queryId = definition.id ?? this.queryId ?? 'query';
    const scope = structuredClone(scopes[0]);
    const pinnedParameters = structuredClone(resolvedParameters);
    const pinnedDocument = structuredClone(document);
    const samePlan = (): boolean => executionIdentity() === capturedExecutionIdentity &&
      workspace.canExecuteFor(sessionId) && !!admittedCapabilities &&
      admittedCapabilities.actorId === workspace.capabilities()?.actorId &&
      admittedCapabilities.databaseId === workspace.capabilities()?.databaseId &&
      admittedCapabilities.projectId === workspace.capabilities()?.projectId &&
      JSON.stringify(projectRef) === JSON.stringify(this.project?.ref);
    this.sessionPinning.set(true);
    try {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded)))].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (!samePlan()) throw new Error('The query definition, context or scope changed before pinning. Review it and run again.');
      const pinned = await workspace.pinInput(sessionId, scope, 'query', queryId, `sha256:${digest}`, undefined, pinnedParameters, pinnedDocument);
      if (!pinned) throw new Error(workspace.error() || 'The query input could not be confirmed.');
      if (pinned.run.executionAuthority !== 'client') {
        this.runError.set('The server accepted this query run. The browser will not dispatch it; check saved session history for the outcome.');
        return;
      }
      this.sessionRecordedSessionId.set(sessionId);
      this.sessionRecordedRun.set(pinned.runId);
      this.sessionRecordedInput.set(pinned.input.id);
      if (!samePlan() || workspace.snapshotFor(sessionId)?.contextSet.id !== contextSetId)
        throw new Error('The query definition, parameters, source, scope or session changed after input pinning. Dispatch was stopped; the run outcome still needs confirmation. Review it before starting a new run.');
      this.runQueryWithPinnedInput();
    } catch (error) {
      if (samePlan()) this.runError.set(error instanceof Error ? error.message : 'The session query could not start.');
      await this.finishSessionQuery('failed', 'client-dispatch-rejected', sessionId);
    } finally { this.sessionPinning.set(false); }
  }

  private async finishSessionQuery(state: 'completed' | 'failed', errorCode?: string, capturedSessionId = this.sessionRecordedSessionId() || this.contextSessionId()): Promise<void> {
    const runId = this.sessionRecordedRun();
    if (!runId || !this.sessionWorkspace || !capturedSessionId) return;
    const completionGeneration = ++this.sessionCompletionGeneration;
    const workspace = this.sessionWorkspace;
    const inputId = this.sessionRecordedInput();
    const currentResult = state === 'completed' ? this.runResult() : undefined;
    const result = currentResult === undefined ? undefined : structuredClone(currentResult);
    const capabilities = workspace.capabilities();
    const projectRef = this.project?.ref ? structuredClone(this.project.ref) : undefined;
    const samePrincipal = (): boolean =>
      workspace.capabilities()?.actorId === capabilities?.actorId &&
      workspace.capabilities()?.databaseId === capabilities?.databaseId &&
      workspace.capabilities()?.projectId === capabilities?.projectId &&
      JSON.stringify(this.project?.ref) === JSON.stringify(projectRef);
    const mayUpdateView = (): boolean => samePrincipal() && completionGeneration === this.sessionCompletionGeneration && this.contextSessionId() === capturedSessionId;
    // Clear the old run synchronously. Async fingerprint/cache work from this
    // run must not overwrite the state of a newer run or session.
    this.sessionRecordedRun.set(undefined);
    this.sessionRecordedInput.set('');
    this.sessionRecordedSessionId.set('');
    let finalState = state;
    let finalErrorCode = errorCode?.replaceAll('-', '_').toUpperCase();
    let resultRef: string | undefined;
    if (state === 'completed') {
      if (!result || !inputId) {
        finalState = 'failed'; finalErrorCode = 'CLIENT_RESULT_MISSING';
      } else {
        try {
          resultRef = await sessionResultFingerprint(result);
          if (!samePrincipal()) return;
          const cacheKey = workspace.deviceViewKey(capturedSessionId, `query-result-${resultRef}`, {
            actorId: capabilities?.actorId, databaseId: capabilities?.databaseId, project: projectRef,
          });
          const saved = await tryWriteSessionResultCache(this.sessionResultCache, cacheKey, { runId, inputId, result });
          if (!saved && mayUpdateView()) this.runError.set('The query result is available in this tab, but its display cache could not be saved. The source will not be rerun.');
        } catch {
          if (!resultRef) { finalState = 'failed'; finalErrorCode = 'CLIENT_RESULT_FINGERPRINT_FAILED'; }
        }
      }
    }
    if (!samePrincipal()) return;
    const confirmed = await workspace.reportClientRun(capturedSessionId, runId, 'query', [{ id: 'query', state: finalState,
      ...(finalState === 'completed' && resultRef ? { resultRef } : {}), ...(finalState === 'failed' ? { errorCode: finalErrorCode ?? 'CLIENT_EXECUTION_FAILED' } : {}) }]);
    if (!confirmed && mayUpdateView()) this.runError.set('The query finished; its session outcome is unconfirmed. Retry the retained operation.');
  }

  private runQueryWithPinnedInput(): void {
    const sessionId = this.contextSessionId();
    if (this.sessionWorkspace && sessionId && !this.sessionWorkspace.canExecuteFor(sessionId)) {
      this.runError.set('Resume this session before running a query.');
      return;
    }
    this.authorFormatNavigationSnapshot.set(undefined);
    if (
      this.isTugqlAuthorJourney() &&
      this.authorRunReadiness().action === 'parameters'
    ) {
      this.authorRunParameterAttempt.set({
        scope: this.authorRunParameterScope(),
        definition: this.queryDef(),
        binding: this.authorCustomerId(),
        draftRevision: this.authorDraftRevision(),
      });
      return;
    }
    this.authorRunParameterAttempt.set(undefined);
    if (this.nativeParameterErrors().size) {
      this.runError.set('Correct or clear invalid parameter values before Run.');
      return;
    }
    // The bounded TugQL runner validates its own CustomerId input below;
    // generic saved-query bindings are not the inputs sent to that worker.
    if (!this.isTugqlAuthorJourney() && this.hasBlockedBindings()) {
      this.runError.set('Resolve every ambiguous, conflicting or required parameter before Run.');
      return;
    }
    const runRequestedAt = monotonicTime();
    const projectRef = this.project?.ref;
    const projectId = projectRef?.projectId;
    const queryId = this.queryId;
    if (!projectId || !queryId) {
      return;
    }
    const definition = this.queryDef();
    if (this.unavailableWorkingCopy()) {
      this.runError.set('The selected working copy is unavailable. Choose a current runtime explicitly.');
      return;
    }
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
    if (projectRef && this.isHostedProject && this.selectedWorkingCopy() === 'project') {
      this.runHostedSavedQuery(projectRef, queryId, definition, runRequestedAt);
      return;
    }
    if (
      isGithubStoreId(this.project?.ref.storeId) &&
      definition &&
      this.isTugqlAuthorJourney()
    ) {
      if (this.running()) return;
      if (!this.authorCustomerIdValid()) {
        this.runError.set(
          'Enter a whole-number CustomerId before running this query.',
        );
        return;
      }
      const previewPlan = this.authorPlan();
      if (
        !previewPlan ||
        previewPlan.draftRevision !== this.authorDraftRevision()
      ) {
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
    if (this.selectedWorkingCopy() !== 'project' && definition && !this.isTugqlAuthorJourney()) {
      const selectionId = this.selectedWorkingCopy();
      if (this.workingCopyScope !== this.currentWorkingCopyScope() ||
        !this.workingCopyOptions().some((option) => option.selectionId === selectionId)) {
        this.runError.set('Refresh the open working copies and choose the runtime for this saved query.');
        return;
      }
      if (![QueryType.DTQL, QueryType.TugQL].includes(definition.request.queryType)) {
        this.runError.set('This working copy accepts structured queries. Choose the project runtime for raw SQL.');
        return;
      }
      if (this.effectiveBindings().length || definition.parameters?.length) {
        this.runError.set('This working-copy runtime cannot bind query parameters yet. Choose another runtime.');
        return;
      }
      if (this.running()) return;
      if (!projectRef) return;
      const executedDefinition = structuredClone(definition);
      const scope = this.historyScope();
      const dispatchScope = this.currentBrowserDispatchScope();
      const revision = this.queryDispatch.runtimeRevision();
      const lifetime = ++this.federatedRunLifetime;
      const current = (): boolean =>
        lifetime === this.federatedRunLifetime && this.historyScope() === scope &&
        this.currentBrowserDispatchScope() === dispatchScope &&
        this.selectedWorkingCopy() === selectionId && this.queryDispatch.runtimeRevision() === revision &&
        JSON.stringify(this.queryDef()) === JSON.stringify(executedDefinition);
      this.running.set(true);
      this.runError.set(undefined);
      const session = this.queryDispatch.start({
        projectRef, definition: executedDefinition, queryId,
        environment: this.envId, runtimeSelectionId: selectionId,
      });
      void this.activeDispatchSession?.cancel().catch(() => undefined);
      this.activeDispatchSession = session;
      void session.result.then((result) => {
        if (!current()) return;
        this.showAttemptResult(result);
        const timing: QueryRunTiming = {
          allResultsLoadedMs: Math.max(0, monotonicTime() - runRequestedAt),
          noRecords: result.recordset.rows.length === 0,
        };
        this.queryRunTiming.set(timing);
        if (!result.truncated && !result.hasMore) this.commitSuccessfulResult(result, executedDefinition, timing);
      }).catch((error: unknown) => {
        if (current()) this.runError.set(error instanceof Error ? error.message : 'The working-copy query failed.');
      }).finally(() => {
        if (this.activeDispatchSession === session) this.activeDispatchSession = undefined;
        void session.dispose();
        if (lifetime === this.federatedRunLifetime) this.running.set(false);
      });
      return;
    }
    if (
      isBrowserSqlProject(this.project?.ref) &&
      definition?.connectionId &&
      definition.request.queryType === QueryType.SQL
    ) {
      if (this.running()) return;
      const declared = definition.parameters ?? [];
      const effective = this.effectiveBindings();
      const exactBindings = declared.map((parameter) =>
        effective.find((binding) => binding.parameterId === parameter.id)?.value,
      );
      const declaredIds = new Set(declared.map((parameter) => parameter.id));
      if (declared.some((parameter, index) => parameter.isRequired !== false && exactBindings[index] === undefined) ||
        effective.some((binding) => !declaredIds.has(binding.parameterId))) {
        this.runError.set('This browser SQLite source needs values for its required declared parameters.');
        return;
      }
      const parameterValues: Record<string, TypedValue> = Object.fromEntries(
        declared.flatMap((parameter, index) => exactBindings[index] === undefined
          ? [] : [[parameter.id, structuredClone(exactBindings[index] as TypedValue)]]),
      );
      // The browser worker reports the executed rows, but its generic SQL envelope
      // does not echo bindings. Retain the exact validated inputs dispatched with
      // this request as client-reported facts for the result header and prior run.
      const dispatched: Binding[] = [];
      for (const parameter of declared) {
        const binding = effective.find((candidate) => candidate.parameterId === parameter.id);
        if (!binding) continue;
        dispatched.push({
          parameterId: parameter.id,
          value: parameterValues[parameter.id],
          origin: binding.origin === 'user' ? 'manual' : (binding.origin ?? 'default'),
          originEvidence: 'client-reported' as const,
          ...(binding.factId ? { factId: binding.factId } : {}),
        });
      }
      const dispatchedBindings: readonly Binding[] = cloneAndFreeze(dispatched);
      const runScope = this.historyScope();
      const dispatchScope = this.currentBrowserDispatchScope();
      const executedDefinition = structuredClone(definition);
      const executedBindings = JSON.stringify(effective);
      const lifetime = ++this.federatedRunLifetime;
      const current = (): boolean =>
        lifetime === this.federatedRunLifetime &&
        this.historyScope() === runScope &&
        this.currentBrowserDispatchScope() === dispatchScope &&
        JSON.stringify(this.queryDef()) === JSON.stringify(executedDefinition) &&
        JSON.stringify(this.effectiveBindings()) === executedBindings;
      this.running.set(true);
      this.runError.set(undefined);
      const dispatchedOrigins = dispatchedBindings.map((binding) => ({
        parameterId: binding.parameterId,
        origin: binding.origin,
        ...(binding.factId ? { factId: binding.factId } : {}),
      }));
      const controller = new AbortController();
      const session = this.queryDispatch.start({
        projectRef,
        definition: executedDefinition,
        queryId,
        environment: this.envId,
        target: { kind: 'browser-sqlite' },
        parameters: parameterValues,
        bindingOrigins: dispatchedOrigins,
        onDispatched: () => this.reportGitHubQueryDispatch(projectRef),
        signal: controller.signal,
      });
      this.activeDispatchSession = session;
      void session.result
        .then((result) => {
          if (!current()) return;
          const displayedResult = dispatchedBindings.length
            ? { ...result, bindingsApplied: dispatchedBindings }
            : result;
          this.lastRunBindingRoles.set(new Map(effective.flatMap((binding) =>
            binding.role ? [[binding.parameterId, binding.role] as const] : [])));
          this.showAttemptResult(displayedResult);
          const timing: QueryRunTiming = {
            allResultsLoadedMs: Math.max(0, monotonicTime() - runRequestedAt),
            noRecords: result.recordset.rows.length === 0,
          };
          this.queryRunTiming.set(timing);
          this.commitSuccessfulResult(displayedResult, executedDefinition, timing);
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
          if (this.activeDispatchSession === session)
            this.activeDispatchSession = undefined;
          void session.dispose();
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
      if (!projectRef) return;
      const session = this.queryDispatch.start({
        projectRef,
        definition: executedDefinition,
        target: { kind: 'ovdb-federation' },
        federationRun: {
          token: runtimeToken,
          mode: runMode,
          onProgress: (progress) => {
            if (current()) this.federatedProgress.set(progress);
          },
          onFinished: (totalRows) => {
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
          extras: runMode === 'full'
            ? {
                onFirstRecord: (at) => {
                  if (current() && firstRecordAt === undefined)
                    firstRecordAt = at;
                },
              }
            : {},
        },
      });
      void this.activeDispatchSession?.cancel().catch(() => undefined);
      this.activeDispatchSession = session;
      void session.result
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
              void Promise.resolve(session.associateLocalResult?.(
                this.project.ref,
                queryId,
                completedResult.localResult,
              ))
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
          if (this.activeDispatchSession !== session) void session.dispose();
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
      this.runError.set(
        this.project && isSharedProjectRef(this.project.ref)
          ? SHARED_QUERY_RUN_MESSAGE
          : GITHUB_QUERY_RUN_MESSAGE,
      );
      return;
    }
    if (this.queryState.isNew || this.queryState.isSaving || this.isChanged) {
      this.runError.set('Save this query before running its agent revision.');
      return;
    }
    const environment = this.envId;
    const securityContextId = this.agentContext.securityContextId();
    if (!environment || !securityContextId) {
      this.runError.set(
        !environment
          ? 'Select a logical project environment below before running this query.'
          : 'The agent security context is unavailable. Reconnect to the project agent and retry.',
      );
      if (!environment) void this.loadAgentRunEnvironments();
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
        ...(this.hasCurrentDetectiveState() && this.hostedScenarioTarget()
          ? { record: true }
          : {}),
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
    const previousRows =
      cachedRows.length > 0
        ? cachedRows
        : this.resultPageIndex() === 0
          ? (this.displayedRecordset()?.rows ?? [])
          : cachedRows;
    const requestGeneration = ++this.resultPageRequestGeneration;
    const selection = this.historySelection,
      set = this.relatedResultSet();
    this.resultPageRows.set([]);
    this.resultPageLoading.set(true);
    try {
      const historicalRef = this.selectedHistoricalResult();
      const rows = historicalRef || result?.localResult
        ? await this.federatedQuery.getPage(next, set, historicalRef ?? result?.localResult)
        : await this.activeDispatchSession?.getPage?.(next, set);
      if (!rows) throw new Error('The result pages are unavailable.');
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
    const session = this.activeDispatchSession;
    this.activeDispatchSession = undefined;
    void (session?.cancel() ?? Promise.resolve()).catch((error: unknown) => {
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
    const saved = this.savedRowsShown;
    if (saved && !this.running()) this.showSavedRows(saved);
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
      await this.activeDispatchSession?.cancel();
      this.activeDispatchSession = undefined;
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
    this.resultChartView.set('grid');
    this.resultChartCategory.set('');
    this.resultChartMeasure.set('');
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
    if (this.contextSessionId()) { this.runError.set('Recorded-source replay needs its own session input pin. Use Run for the supported live query path.'); return; }
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
    if (!ref || !hasQueryActivity(ref)) {
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
            { show: false, feedback: false },
          ),
      });
  }

  private reportGitHubQueryEdit(ref?: IProjectRef): void {
    if (!ref || !hasQueryActivity(ref)) {
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
            { show: false, feedback: false },
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
    this.localScenarioExecution.set(undefined);
    const definition = this.queryDef();
    if (!definition) return;
    this.reportGitHubQueryDispatch(this.project?.ref);
    const executedDefinition = structuredClone(definition);
    const queryIdentity = this.currentQueryIdentity();
    const targetIdentity = this.currentResultTargetIdentity();
    const scenarioTarget = request.record
      ? this.hostedScenarioTarget()
      : undefined;
    const runStartedAt = monotonicTime();
    const lifetime = ++this.semanticRunLifetime;
    const current = (): boolean =>
      lifetime === this.semanticRunLifetime &&
      this.investigationContext.isCurrentScope(requestScope) &&
      this.currentQueryIdentity() === queryIdentity &&
      this.currentResultTargetIdentity() === targetIdentity;
    const projectRef = this.project?.ref;
    if (!projectRef) return;
    const session = this.queryDispatch.start({
      projectRef,
      definition: executedDefinition,
      queryId: request.queryId,
      environment: request.environment,
      securityContextId: request.securityContextId,
      target: { kind: 'local-agent', agentStoreId: projectRef.storeId },
      agentRequest: request,
    });
    void this.activeDispatchSession?.cancel().catch(() => undefined);
    this.activeDispatchSession = session;
    void session.result.then((response) => {
        // Task 15 item 4 — discard a late response for a scope the user has since left
        // (project/environment/principal switch mid-flight): api-contract.md "late
        // responses from another scope are discarded".
        if (!current()) return;
        this.localScenarioExecution.set(
          request.record &&
            scenarioTarget &&
            this.hostedScenarioTarget()?.caseId === scenarioTarget.caseId &&
            this.hostedScenarioTarget()?.applicationId ===
              scenarioTarget.applicationId &&
            this.hostedScenarioTarget()?.stepId === scenarioTarget.stepId &&
            response.execution &&
            !response.truncated &&
            response.provenance.queryId === request.queryId
            ? {
                projectKey: JSON.stringify(this.project?.ref),
                queryId: request.queryId || '',
                environment: requestScope.environment,
                execution: response.execution,
              }
            : undefined,
        );
        const timing: QueryRunTiming = {
          allResultsLoadedMs: Math.max(0, monotonicTime() - runStartedAt),
          noRecords: response.recordset.rows.length === 0,
        };
        this.showAttemptResult(response);
        this.queryRunTiming.set(timing);
        this.commitSuccessfulResult(response, executedDefinition, timing);
        this.running.set(false);
      }).catch((err: unknown) => {
        if (current()) this.handleRunError(err, request, requestScope);
      }).finally(() => {
        if (this.activeDispatchSession === session) this.activeDispatchSession = undefined;
        void session.dispose();
        if (current()) this.running.set(false);
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

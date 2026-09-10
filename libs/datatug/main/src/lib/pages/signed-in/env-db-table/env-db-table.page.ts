import {
  Component,
  Injector,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { filter, first } from 'rxjs/operators';
import { CodeEditor } from '@acrodata/code-editor';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSplitPane,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IGridColumn, IGridDef } from '@sneat/grid';
import { Subject } from 'rxjs';
import { DataGridComponent } from '@sneat/datagrid';
import {
  AgentContextService,
  ContextPanelComponent,
  ExecutionProfile,
  InvestigationContextService,
  Limitation,
  LimitationHeaderComponent,
  OpenQueryRequest,
  SemanticApiService,
  SemanticColumnMapping,
  SemanticSelection,
} from '@sneat/datatug-semantic';
import { addIcons } from 'ionicons';
import { helpCircleOutline, pricetag } from 'ionicons/icons';
import {
  routingParamDbCatalogId,
  routingParamEnvironmentId,
  routingParamTableType,
} from '../../../core/datatug-routing-params';
import { ISelectResponse } from '../../../dto/execute';
import { IForeignKey, IIndex } from '../../../models/definition/apis/database';
import {
  getStoreId,
  IEnvDbTableContext,
  IProjectContext,
} from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import {
  DatatugNavService,
  IDbObjectNavParams,
} from '../../../services/nav/datatug-nav.service';
import { ProjectService } from '../../../services/project/project.service';
import { AgentService } from '../../../services/repo/agent.service';
import { DatatugCoreModule } from '../../../core/datatug-core.module';
import { DatatugServicesNavModule } from '../../../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { ForeignKeyCardComponent } from './foreign-key-card/foreign-key-card.component';

// Registers the same two icon names SemanticMarkerComponent uses
// (libs/datatug/semantic/.../semantic-marker.component.ts) so they resolve when this
// page renders them into a raw Tabulator column-header HTML string (see
// columnTitleWithMarker() below) — the installed @sneat/datagrid@0.27.6 doesn't
// forward IGridColumn.titleFormatter to Tabulator (only field/title/tooltip/
// formatter/hozAlign/headerHozAlign/width(Grow|Shrink) are copied through, see
// setTabulatorOptions() in its fesm2022 bundle), and Tabulator itself renders a
// column's `title` as raw innerHTML, so embedding the marker's markup directly in
// `title` is the mechanism this package version actually supports. `addIcons` merges
// into the global icon map, so calling it here too (in case this module loads before
// SemanticMarkerComponent's) is safe — see libs/datatug/semantic/INTEGRATION.md.
addIcons({ pricetag, helpCircleOutline });

@Component({
  selector: 'sneat-datatug-env-db-table',
  templateUrl: './env-db-table.page.html',
  styleUrls: ['./env-db-table.page.scss'],
  imports: [
    // `DatatugNavContextService` (injected directly below), and
    // `ProjectContextService`/`AppContextService`/`EnvironmentService`/
    // `ProjectService` (reached transitively through it, and `ProjectService`
    // also injected directly below), are all now `providedIn: 'root'`
    // (nav-context-root-singletons). `AgentService` (also injected directly
    // below) is still a plain `@Injectable()`, provided only by
    // `DatatugServicesStoreModule` — that's the one remaining reason this
    // page still needs a module import; `DatatugCoreModule`/
    // `DatatugServicesNavModule`/`DatatugServicesProjectModule`/
    // `DatatugServicesUnsortedModule` are redundant alongside it now and
    // left in for a follow-up cleanup rather than folded into this fix.
    // Historically (before that fix) none of the modules below were
    // declared here at all, so opening a table by URL threw `NG0201: No
    // provider found for DatatugNavContextService. Source:
    // Standalone[EnvDbTablePageComponent]` and the grid never rendered
    // (journey J1's Album step). No ancestor route provides them either —
    // `env-db-table-routing.module.ts` and every parent in
    // `routes/datatug-routing*.ts` have no `providers:` entry. Same fix, and
    // same cause, as `DatatugStorePageComponent` (PR #63) and
    // `ProjectPageComponent`, whose module set this mirrors.
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    ForeignKeyCardComponent,
    ContextPanelComponent,
    LimitationHeaderComponent,
    CodeEditor,
    DataGridComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonItem,
    IonSplitPane,
    FormsModule,
    IonButton,
    IonSegmentButton,
    IonLabel,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonSelectOption,
    IonSelect,
    IonIcon,
    IonInput,
    IonSegment,
    IonItemDivider,
    IonBadge,
    IonList,
    IonCardContent,
    IonText,
  ],
})
export class EnvDbTablePageComponent implements OnDestroy {
  private readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly projService = inject(ProjectService);
  private readonly agentService = inject(AgentService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  project?: IProjectContext;
  envId?: string;
  dbId?: string;

  // REQ:semantic-markers-in-grid / REQ:context-basket (libs/datatug/semantic
  // INTEGRATION.md §2-3) — the per-column semantic mapping for the open table
  // (fetched once per table load) and the currently selected cell, which drives the
  // context panel in the split pane. Signals, not plain fields, per this repo's
  // zoneless-ready convention (AGENTS.md).
  public readonly semanticColumns = signal<readonly SemanticColumnMapping[]>(
    [],
  );
  public readonly selection = signal<SemanticSelection | undefined>(undefined);
  public readonly hasSelection = computed(() => !!this.selection());

  public tab: 'grid' | 'record' | 'keys' | 'references' = 'grid';
  public cardTab: 'fks' | 'refs' = 'fks';

  public table?: IEnvDbTableContext;
  public tableNavParams?: IDbObjectNavParams;

  public groupByFk?: string;
  public groupByFks?: IForeignKey[];
  // A signal, not a plain field: this app is zoneless
  // (provideZonelessChangeDetection(), main.ts), so a plain field mutated
  // from an RxJS `.subscribe()` callback (loadData()'s response, the
  // currentEnvDbTable subscription below) never triggers change detection —
  // the grid's own inputs never re-evaluate, `DataGridComponent` (OnPush)
  // never gets a new `[data]`/`[columns]` reference, and Tabulator never
  // (re-)renders, even though `this.recordset`/the underlying HTTP response
  // were already correct. Confirmed empirically (lane S89): with a plain
  // field here, `setupGrid()` verifiably ran to completion with real
  // `{columns: 3, rows: 100}` data, yet zero `.tabulator-row` elements ever
  // appeared. A signal write notifies change detection directly, per this
  // repo's own zoneless convention (AGENTS.md).
  public readonly grid = signal<IGridDef | undefined>(undefined);
  public currentRow?: {
    index: number;
    data?: Record<string, unknown>;
  };
  public sql = 'select * from';

  public step = 'initial';
  public recordset?: ISelectResponse;

  // REQ:limitation-visible (feature J4) — `ISelectResponse.limitations`/`.provenance`
  // are set asynchronously from `processResponse()` (the `AgentService.select()`
  // subscribe callback), so — same zoneless reasoning as `grid` above — these are
  // signals, not plain fields: `sneat-datatug-limitation-header`'s OnPush inputs would
  // never see a plain-field write. Empty/`undefined` (today's servers, which don't
  // send these fields yet) makes the shared component render nothing, per its own
  // spec.
  public readonly limitations = signal<readonly Limitation[]>([]);
  public readonly executionProfile = signal<ExecutionProfile | undefined>(
    undefined,
  );

  private readonly destroyed = new Subject<void>();

  constructor() {
    const route = this.route;
    // const projectTracker = new ProjectTracker(this.destroyed, route);
    try {
      const { paramMap } = route.snapshot;
      // These read the wrong route-param keys ('tableId', 'dbId') — the routes
      // registered in datatug-routing-proj-env-db.ts / datatug-routing-proj-env.ts
      // use routingParamTableType ('tableType') and routingParamDbCatalogId
      // ('dbCatalogId'). 'tableId' happened to be masked by the reactive
      // currentEnvDbTable subscription below (which re-parses schema/name from the
      // URL directly), but nothing ever re-sets `this.dbId` — so it stayed
      // `undefined` forever and loadData()'s `!this.dbId` guard always bailed before
      // ever calling the agent, i.e. the grid never rendered any rows. Found while
      // diagnosing why journey e2e J1 doesn't see `.tabulator-row` after this
      // stream's table-page changes.
      const [schema, name] = (paramMap.get(routingParamTableType) || '').split(
        '.',
      );
      this.table = { schema, name };
      this.envId = paramMap.get(routingParamEnvironmentId) || undefined;
      this.dbId = paramMap.get(routingParamDbCatalogId) || undefined;
      if (this.envId && this.dbId && this.project) {
        this.tableNavParams = {
          project: this.project,
          env: this.envId,
          db: this.dbId,
          schema,
          name,
        };
      }

      this.datatugNavContextService.currentProject.subscribe({
        next: (currentProject) => {
          console.log(
            'EnvDbTablePage.constructor() => currentProject',
            currentProject,
          );
          try {
            this.project = currentProject;
          } catch (e) {
            this.errorLogger.logError(e, 'Failed to process current project');
          }
        },
        error: (err) =>
          this.errorLogger.logError(
            err,
            'EnvDbTablePage: failed to get current project',
          ),
      });
      this.datatugNavContextService.currentEnvDbTable.subscribe({
        next: (currentTable) => {
          try {
            this.table = currentTable;
            if (!currentTable) {
              return;
            }
            this.groupByFks = currentTable.meta?.foreignKeys?.filter(
              (fk) => fk.columns.length === 1,
            );
            this.sql = `select *
from ${this.tableFromClause(currentTable)}`;
            // this.codemirrorComponent?.codeMirror?.refresh();
            // Row fetch and the initial grid scaffold only ever need the
            // table's schema+name, never gated on `currentTable.meta`.
            // `DatatugNavContextService.processEnvDbTable()` never actually
            // resolves `meta` (columns/FKs/indexes) — the code that would is
            // commented out ("TODO(help-wanted)") — so every navigation only
            // ever gets `{schema, name}`. Gating here on `currentTable.meta`
            // meant `loadData()` (`AgentService.select` -> `GET
            // /exec/select`) never fired at all: no request, no error,
            // "drawTable() columns: undefined data: undefined" printed once
            // and nothing else (journey J1/J2/J3's `.tabulator-row` never
            // visible, lane S89). `buildGridColumns()` already tolerates a
            // missing `meta` (empty scaffold), and `setupGrid()` replaces it
            // from the real recordset's own columns once `loadData()`
            // resolves — `meta` was never actually load-bearing for the row
            // fetch itself, only for the FK group-by feature above and the
            // pre-recordset column scaffold.
            this.grid.set({
              columns: this.buildGridColumns(),
            });
            this.loadData();
            this.loadSemanticColumns(currentTable.name);
          } catch (e) {
            this.errorLogger.logError(e, 'Failed to process current table');
          }
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to get current table context'),
      });
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to create EnvDbTablePage');
    }
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  public tabChanged(): void {
    // Tab change handler - no action needed
  }

  // public selectRow(event: RowDoubleClickedEvent): void {
  // 	console.log('selectRow', event);
  // 	this.setCurrentRow(event.rowIndex, event.data);
  // 	this.tab = 'record';
  // }

  public setCurrentRow(index: number, data?: Record<string, unknown>): void {
    try {
      if (!data) {
        const rows = this.grid()?.rows;
        data = rows && rows[index];
      }
      this.currentRow = { index, data };
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to set current row');
    }
  }

  public onGroupByFkChanged(): void {
    this.setupGrid();
  }

  goTable(schema: string, name: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.project || !this.envId || !this.dbId) {
      return;
    }
    this.datatugNavService.goTable({
      project: this.project,
      env: this.envId,
      db: this.dbId,
      schema,
      name,
    });
  }

  protected colValue(colName: string): string {
    return this.currentRow?.data ? '' + this.currentRow.data[colName] : '';
  }

  protected indexColumns(index: IIndex): string {
    return (index.columns || []).map((c) => c.name).join(', ');
  }

  /** Initial column scaffold from table metadata, before the recordset (and any row
   * data) has loaded — replaced by setupGrid()'s columns once loadData() resolves. */
  private buildGridColumns(): IGridColumn[] {
    return (this.table?.meta?.columns || []).map((col) => ({
      field: col.name,
      colName: col.name,
      dbType: col.dbType,
      title: this.columnTitleWithMarker(col.name, col.name),
    }));
  }

  // REQ:semantic-markers-in-grid, REQ:context-basket (INTEGRATION.md §2-3).
  private loadSemanticColumns(collection: string): void {
    const projectId = this.project?.ref.projectId;
    const environment = this.envId;
    if (!projectId || !environment) {
      return;
    }
    const securityContextId = this.agentContext.securityContextId();
    if (securityContextId) {
      this.fetchSemanticColumns(
        projectId,
        environment,
        securityContextId,
        collection,
      );
      return;
    }
    // `securityContextId` (the Task 15 scope gate every Scope-bearing call
    // must carry) resolves asynchronously from `GET /agent-info`
    // (AgentContextService), independently of — and, in practice, often
    // later than — this table-load path. A single synchronous read here
    // raced it and lost every time in production: `GET
    // /datatug/semantic/columns` was never requested at all (confirmed
    // live), even though `/datatug/agent-info` always eventually resolved a
    // few requests later. Nothing re-triggered this call once the context
    // became available, so `semanticColumns` stayed empty forever,
    // `onGridRowClick` never found a mapping, and
    // `sneat-datatug-context-panel` never opened (journey J2/J3, lane S90).
    // `toObservable()` never emits synchronously even when the signal
    // already has a value (it always defers at least one microtask via its
    // own `effect()`), so this fallback path is deliberately only reached
    // when the fast, synchronous check above found nothing yet — taking it
    // unconditionally would add a needless async delay to the common case
    // (and silently break every caller that reads `semanticColumns()`
    // synchronously right after construction, as this file's own earlier
    // tests do).
    toObservable(this.agentContext.securityContextId, {
      injector: this.injector,
    })
      .pipe(
        filter((id): id is string => !!id),
        first(),
      )
      .subscribe((id) =>
        this.fetchSemanticColumns(projectId, environment, id, collection),
      );
  }

  private fetchSemanticColumns(
    projectId: string,
    environment: string,
    securityContextId: string,
    collection: string,
  ): void {
    this.semanticApi
      .getSemanticColumns({
        project: projectId,
        environment,
        securityContextId,
        // ASSUMPTION (S9b): "source" is this page's db catalog id (the same value
        // already passed to AgentService.select's `db` param above) — the closest
        // identifier this page has on hand.
        source: this.dbId || '',
        collection,
      })
      .pipe(first())
      .subscribe({
        next: (response) => {
          this.semanticColumns.set(response.columns);
          this.refreshColumnMarkers();
        },
        error: (err) =>
          this.errorLogger.logError(err, 'Failed to load semantic columns'),
      });
  }

  /** Re-derives every column's `title` from its clean `colName` base plus the
   * now-loaded semantic mapping (if any) — safe to call repeatedly, never
   * double-embeds the marker's HTML. */
  private refreshColumnMarkers(): void {
    const grid = this.grid();
    if (!grid) {
      return;
    }
    this.grid.set({
      ...grid,
      columns: grid.columns.map((col) => ({
        ...col,
        title: this.columnTitleWithMarker(
          col.colName || col.field || '',
          col.field || '',
        ),
      })),
    });
  }

  /**
   * Builds a Tabulator column `title` as an HTML string with the semantic marker's
   * markup appended when `columnName` has a mapping — mirrors
   * SemanticMarkerComponent's own rendering (icon by provenance, `entity.field ·
   * provenance` tooltip) since that Angular component can't be instantiated inside a
   * raw Tabulator header (see the addIcons() comment above). Tabulator sets a
   * column's `title` as the header cell's innerHTML directly (no titleFormatter
   * needed) — see _formatColumnHeaderTitle in tabulator-tables' source. The marker's
   * provenance MUST come from `semanticColumns` (i.e. the server), never computed
   * here (REQ:semantic-markers-in-grid).
   */
  private columnTitleWithMarker(
    displayTitle: string,
    columnName: string,
  ): string {
    const mapping = this.semanticColumns().find((m) => m.column === columnName);
    const escapedTitle = this.escapeHtml(displayTitle);
    if (!mapping) {
      return escapedTitle;
    }
    const icon =
      mapping.provenance === 'declared' ? 'pricetag' : 'helpCircleOutline';
    const cssClass =
      mapping.provenance === 'inferred'
        ? 'semantic-marker semantic-marker--inferred'
        : 'semantic-marker';
    const tooltip = this.escapeHtml(
      `${mapping.entity}.${mapping.field} · ${mapping.provenance}`,
    );
    return `${escapedTitle} <ion-icon class="${cssClass}" name="${icon}" title="${tooltip}" aria-label="${tooltip}"></ion-icon>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Cell click -> context panel (INTEGRATION.md §3). @sneat/datagrid@0.27.6 has no
   * `cellSelected` output (only `rowSelected`/`rowDeselected`, whole-row, and this
   * `rowClick` callback prop — see sneat-datagrid.d.ts), so this falls back to the
   * existing `rowClick` and recovers the clicked *column* from the native event's
   * target: Tabulator stamps every cell element with a `tabulator-field` attribute
   * (see tabulator.js, `element.setAttribute("tabulator-field", field)`).
   */
  public onGridRowClick = (event: Event, row: unknown): void => {
    try {
      const target = event.target as HTMLElement | null;
      const field = target
        ?.closest('[tabulator-field]')
        ?.getAttribute('tabulator-field');
      if (!field) {
        return;
      }
      const mapping = this.semanticColumns().find((m) => m.column === field);
      if (!mapping) {
        this.selection.set(undefined);
        return;
      }
      const data = (
        row as { getData?: () => Record<string, unknown> } | undefined
      )?.getData?.();
      const value = data?.[field];
      if (value === undefined || value === null) {
        this.selection.set(undefined);
        return;
      }
      this.selection.set({
        entity: mapping.entity,
        field: mapping.field,
        value: value as SemanticSelection['value'],
        label: `${mapping.entity}.${mapping.field} = ${value}`,
        source: this.dbId || 'grid',
        // `Fact.physical` — the server rejects `semantic/related` without it
        // ("is required to compute related lookups"). Every part of this is
        // already on hand from the same GET /semantic/columns call that
        // resolved `mapping` (loadSemanticColumns sends the same
        // `source`/`collection` pair; `mapping.column` is this clicked
        // field's own key in that response) — see SemanticSelection.physical's
        // own doc comment (lane S90).
        physical: this.table
          ? {
              source: this.dbId || '',
              collection: this.table.name,
              column: mapping.column,
            }
          : undefined,
      });
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to process grid cell click');
    }
  };

  public closeContextPanel(): void {
    this.selection.set(undefined);
  }

  /** Context panel's (openQuery) — this library deliberately doesn't depend on
   * @angular/router, so navigating to the query page with the resolved bindings is
   * this host page's job (INTEGRATION.md §3). */
  public onOpenQuery = (request: OpenQueryRequest): void => {
    const project = this.project;
    if (!project) {
      return;
    }
    this.router
      .navigate(
        [
          '/store',
          getStoreId(project.ref.storeId),
          'project',
          project.ref.projectId,
          'query',
          // `encodeURIComponent` — `request.queryId` may be folder-qualified
          // (e.g. `customers/customer-invoices`, the shape `queries/applicable`'s
          // `Candidate.queryId` returns as of datatug-cli#219). `router.navigate()`
          // splits a *string* command containing `/` into several path segments
          // regardless of its position in the array, so an un-encoded
          // folder-qualified id would land as `.../query/customers/customer-invoices`
          // — two extra segments the `query/:queryId` route (single param) does not
          // match. Encoding keeps it one segment; Angular's router decodes it back
          // to the raw id for anything that reads the `:queryId` param (nothing
          // does today — see `id` queryParam below, which is the actual contract).
          encodeURIComponent(request.queryId),
        ],
        {
          // QueryPageComponent.trackQueryParams() resolves the query it opens from
          // the `id` *query-string* param (`route.queryParamMap`), not the
          // `:queryId` *path* segment above — the same contract
          // DatatugNavService.goQuery() (the queries-list page's own "open a
          // query" path) already follows. Without this, the path segment is
          // cosmetic only and the page opens a blank/new query instead of
          // `request.queryId`. Found while writing this stream's J2/J3 journey
          // e2e (plan task 10) against the real app.
          // `id` is passed RAW (not encoded) here — it's a query-string value,
          // not a path segment, and `HttpClient`/`Router` already form-encode
          // query-string values on the way out.
          queryParams: { id: request.queryId },
          // `targets`/`selectedSource` carry a needs-target Candidate's authorized
          // options through to the query page's target selector (plan Task 12 item 3;
          // api-contract.md "needs-target").
          state: {
            bindings: request.bindings,
            targets: request.targets,
            selectedSource: request.selectedSource,
          },
        },
      )
      .catch((err) => this.errorLogger.logError(err, 'Failed to open query'));
  };

  /** Schema-qualified `from` clause for both the SQL preview text and the
   * actual row-fetch (`AgentService.select({ from })`) call. `dbo` (MSSQL's
   * common default schema) is omitted for readability; everything else is
   * `schema.name` — matches the server's own `exec/select` contract (e.g.
   * `main.Album` for SQLite, verified against a live agent in lane S87's
   * report). Only ever needs the table's identity, never its `meta`. */
  private tableFromClause(table: IEnvDbTableContext): string {
    return table.schema === 'dbo'
      ? table.name
      : `${table.schema}.${table.name}`;
  }

  private loadData(): void {
    if (!this.project || !this.envId || !this.dbId || !this.table?.name) {
      return;
    }
    try {
      this.step = 'loadData';
      this.agentService
        .select(this.project?.ref.storeId, {
          proj: this.project?.ref?.projectId,
          env: this.envId,
          db: this.dbId,
          from: this.tableFromClause(this.table),
          limit: 100,
        })
        .pipe(first())
        .subscribe({
          next: (response) => {
            this.step = 'got response';
            this.processResponse(response);
          },
          error: (err) =>
            this.errorLogger.logError(err, 'Failed to select from table'),
        });
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to load data');
    }
  }

  private processResponse = (response: ISelectResponse): void => {
    try {
      this.step = 'processResponse';
      this.recordset = response;
      this.limitations.set(response.limitations || []);
      this.executionProfile.set(response.provenance?.executionProfile);
      this.setupGrid();
    } catch (ex) {
      this.errorLogger.logError(ex, 'Failed to process response');
    }
  };

  private setupGrid(): void {
    this.step = 'setupGrid';
    const cols = this.recordset?.columns;
    if (!cols) {
      throw new Error('!cols');
    }
    try {
      const groupBy =
        this.groupByFk &&
        this.table?.meta?.foreignKeys?.find((fk) => fk.name === this.groupByFk)
          ?.columns[0];
      const newGrid: IGridDef = {
        groupBy,
        // `/exec/select`'s response only ever carries column NAMES
        // (ISelectResponse — see its own doc comment), never dbType/title;
        // there is no server-side metadata here to derive `hozAlign` from
        // the way the old (never-actually-reachable) code assumed.
        columns: cols
          .filter((name) => name !== groupBy)
          .map((name) => {
            const col: IGridColumn = {
              field: name,
              colName: name,
              title: this.columnTitleWithMarker(name, name),
              // IGridColumn.dbType is required by @sneat/grid, but
              // /exec/select's response carries no type info to fill it
              // with (see the comment above) — 'unknown' is an honest
              // placeholder, not a guess; only affects hozAlign (unset here).
              dbType: 'unknown',
              // Per-cell click affordance (FK "blue text" + popover) used to live here as
              // a Tabulator `formatter`; removed with CellPopoverComponent (REQ:context-basket,
              // libs/datatug/semantic INTEGRATION.md §3) — cell selection now flows through
              // onGridRowClick() below into the semantic-mapping-driven context panel, which
              // covers FK-backed columns via the server's `related` lookups once mapped.
            };
            return col;
          }),
        // Rows already arrive column-name-keyed (ISelectResponse), so no
        // positional zip is needed — the old code assumed `IRecordsetResult`'s
        // positional `RecordsetValue[]` rows, a shape `/exec/select` never
        // actually returns (lane S89's report).
        rows: this.recordset?.rows,
      };
      this.grid.set(newGrid);
      const gridRows = newGrid.rows;
      const l = newGrid.rows?.length;
      if (gridRows && l) {
        const index = Math.min(this.currentRow?.index || 0, l - 1);
        const data = gridRows[index];
        this.setCurrentRow(index, data);
      }
    } catch (e) {
      this.errorLogger.logError(e, 'Failed to setup grid');
    }
  }
}

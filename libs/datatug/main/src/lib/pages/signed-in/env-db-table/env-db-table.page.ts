import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { first } from 'rxjs/operators';
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
  ContextPanelComponent,
  InvestigationContextService,
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
import { IExecuteResponse, IRecordsetResult } from '../../../dto/execute';
import { ICommandResponseWithRecordset } from '../../../dto/response';
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
    // `DatatugNavContextService`, `ProjectService`/`ProjectContextService`,
    // `AgentService`, `AppContextService` and `EnvironmentService` are all
    // plain `@Injectable()`, provided by these modules rather than
    // `providedIn: 'root'`. This component injects the first three directly
    // and reaches the last two through `DatatugNavContextService`, but
    // declared none of the modules, so opening a table by URL threw
    // `NG0201: No provider found for DatatugNavContextService. Source:
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
  private readonly investigationContext = inject(InvestigationContextService);
  private readonly router = inject(Router);

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
  public grid?: IGridDef;
  public currentRow?: {
    index: number;
    data?: Record<string, unknown>;
  };
  public sql = 'select * from';

  public step = 'initial';
  public recordset?: IRecordsetResult;

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
            const from =
              currentTable.schema === 'dbo'
                ? currentTable.name
                : `${currentTable.schema}.${currentTable.name}`;
            this.sql = `select *
from ${from}`;
            // this.codemirrorComponent?.codeMirror?.refresh();
            if (currentTable.meta) {
              this.grid = {
                columns: this.buildGridColumns(),
              };
              this.loadData();
              this.loadSemanticColumns(currentTable.name);
            }
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
        const rows = this.grid?.rows;
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
    if (!projectId) {
      return;
    }
    this.semanticApi
      .getSemanticColumns({
        project: projectId,
        // ASSUMPTION (S9b): "source" is this page's db catalog id (the same value
        // already passed to AgentService.select's `db` param above) — the closest
        // identifier this page has on hand. The server contract for GET
        // /datatug/semantic/columns doesn't exist yet (datatug-cli main has no
        // /datatug/semantic/* routes), so this can't be confirmed against a real
        // response yet; flag for review once that endpoint lands.
        source: this.dbId || '',
        collection,
      })
      .pipe(first())
      .subscribe({
        next: (columns) => {
          this.semanticColumns.set(columns);
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
    if (!this.grid) {
      return;
    }
    this.grid = {
      ...this.grid,
      columns: this.grid.columns.map((col) => ({
        ...col,
        title: this.columnTitleWithMarker(
          col.colName || col.field || '',
          col.field || '',
        ),
      })),
    };
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
          request.queryId,
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
          queryParams: { id: request.queryId },
          state: { bindings: request.bindings },
        },
      )
      .catch((err) => this.errorLogger.logError(err, 'Failed to open query'));
  };

  private loadData(): void {
    if (!this.project || !this.envId || !this.dbId || !this.table?.meta?.name) {
      return;
    }
    try {
      this.step = 'loadData';
      this.agentService
        .select(this.project?.ref.storeId, {
          proj: this.project?.ref?.projectId,
          env: this.envId,
          db: this.dbId,
          from: this.table.meta.name,
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

  private processResponse = (response: IExecuteResponse): void => {
    try {
      this.step = 'processResponse';
      const firstCommand = response.commands?.length
        ? response.commands[0]
        : undefined;
      const firstItem = firstCommand?.items?.[0];
      const itemWithRecordset = firstItem as ICommandResponseWithRecordset;
      this.recordset = itemWithRecordset?.value;
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
      this.grid = {
        groupBy,
        columns: cols
          .filter((c) => c.name !== groupBy)
          .map((c) => {
            const baseTitle = c.title || c.name;
            const col: IGridColumn = {
              field: c.name,
              colName: baseTitle,
              dbType: c.dbType,
              title: this.columnTitleWithMarker(baseTitle, c.name),
              // sortable: true,
              // tooltip: (cell: CellComponent) =>
              // 	// function should return a string for the tooltip of false to hide the tooltip
              // 	`${cell.getColumn().getField()}: ${cell.getValue()}`, // return cells "field - value";
              // Per-cell click affordance (FK "blue text" + popover) used to live here as
              // a Tabulator `formatter`; removed with CellPopoverComponent (REQ:context-basket,
              // libs/datatug/semantic INTEGRATION.md §3) — cell selection now flows through
              // onGridRowClick() below into the semantic-mapping-driven context panel, which
              // covers FK-backed columns via the server's `related` lookups once mapped.
              hozAlign: c.dbType === 'integer' ? 'right' : undefined,
            };
            return col;
          }),
        rows: this.recordset?.rows.map((row) => {
          const r: Record<string, unknown> = {};
          cols?.forEach((col, i) => (r[col.name] = row[i]));
          return r;
        }),
      };
      const gridRows = this.grid?.rows;
      const l = this.grid?.rows?.length;
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

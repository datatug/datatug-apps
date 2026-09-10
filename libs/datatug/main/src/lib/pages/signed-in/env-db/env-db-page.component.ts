import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IProjectRef } from '../../../core/project-context';
import {
  IonBackButton,
  IonBadge,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import {
  GlobalTooltipOption,
  InteractionModule,
  Options,
  Tabulator,
} from 'tabulator-tables';
import { ErrorLogger, IErrorLogger, STORE_ID_GITHUB_COM, STORE_TYPE_GITHUB } from '@sneat/core';

const isGithubStoreId = (storeId: string): boolean =>
  storeId === STORE_ID_GITHUB_COM || storeId === STORE_TYPE_GITHUB;

// Task 17 item B.1 (S121): `Tabulator.registerModule(...)` is a one-time,
// PROCESS-GLOBAL registration (Tabulator's own static API — see
// `@sneat/datagrid`'s `DataGridComponent`, which registers `InteractionModule`/
// `SelectRowModule`/`MenuModule` the same way, as a module-load side effect).
// This page constructs its own `new Tabulator(...)` directly (not through
// `DataGridComponent`) and had never registered anything, so `tab.modules`
// only ever carried Tabulator's own always-on core (`comms`/`layout`/
// `localize`) — confirmed live (S121): `rowClick` (wired in createTabulator()
// below) never fired on a real, fully-trusted click (mousedown/mouseup/click
// all landing squarely on the row element, verified via getBoundingClientRect
// + elementFromPoint), because Tabulator's own click-delegation listener is
// itself lazily bound only once a "row-click"-shaped subscription exists,
// and nothing here ever created one. `env-db-table.page.ts` (the next page
// down, using `DataGridComponent`) was never affected: its own `@sneat/
// datagrid` import carries the registration as a side effect, and route-level
// code-splitting meant that chunk had usually already loaded by the time a
// real user journey reached this page (journeys always went TABLE-first);
// this page was unreachable via any real navigation before this same task,
// so nothing had ever exercised its row click cold, without that lucky
// ordering, until now. `InteractionModule` alone (not Select/Menu, which
// this page's own `rowClick` option doesn't need) is registered here so this
// page's own row-click keeps working table by itself, not by accident of
// import order.
Tabulator.registerModule([InteractionModule]);
import { getTabulatorCols, IGridColumn } from '@sneat/grid';
import { Subject } from 'rxjs';
import {
  routingParamDbCatalogId,
  routingParamEnvironmentId,
} from '../../../core/datatug-routing-params';
import {
  ICatalogTables,
  ITableFull,
} from '../../../models/definition/apis/database';
import { IEnvironmentFull } from '../../../models/definition/environments';
import { IProjectFull } from '../../../models/definition/project';
import {
  IProjectContext,
  newProjectContextFromRef,
} from '../../../nav/nav-models';
import { ProjectTracker } from '../../../services/nav/contexts/project.tracker';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugServicesProjectModule } from '../../../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../../../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../../../services/unsorted/datatug-services-unsorted.module';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { ProjectService } from '../../../services/project/project.service';

interface IRecordsetInfo {
  schema: string;
  name: string;
  cols?: number;
  rows?: number;
  fks?: number;
  refsBy?: number;
  t: ITableFull;
}

@Component({
  selector: 'sneat-datatug-env-db',
  templateUrl: './env-db-page.component.html',
  imports: [
    // `ProjectService` (injected below) is a plain `@Injectable()`, provided
    // by `DatatugServicesProjectModule` rather than `providedIn: 'root'`.
    // `env/:envId/db/:catalogId` (this page's own bare route, one level
    // above `env-db-table.page.ts`'s `/table/<type>` route) had no ancestor
    // route or module supplying it, so a direct URL load threw `NG0201: No
    // provider found for ProjectService. Source: Standalone[EnvDbPageComponent]`
    // and the page never rendered — J1-J4/epilogues only ever navigate
    // straight to the `/table/<type>` route one level deeper, so this class
    // of bug went uncaught here even after `EnvDbTablePageComponent`
    // (`env-db-table.page.ts:113`), `DatatugStorePageComponent` (PR #63) and
    // `ProjectPageComponent` were already fixed for the identical reason.
    // Same fix: declare the module the missing service actually lives in.
    // `EnvironmentService` (Task 17 item A.2/B.1, S121 — getCatalogTables())
    // is likewise plain `@Injectable()`, provided by
    // `DatatugServicesUnsortedModule` — which itself injects `StoreApiService`
    // (provided by `DatatugServicesStoreModule`, not `providedIn: 'root'`
    // either), so both are declared here, mirroring the same pairing
    // `env-db-table.page.ts` already uses for the identical transitive need.
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonItem,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonBadge,
    IonCardContent,
  ],
})
export class EnvDbPageComponent implements OnDestroy, OnInit {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projService = inject(ProjectService);
  private readonly environmentService = inject(EnvironmentService);
  private datatugNavService = inject(DatatugNavService);
  private readonly route = inject(ActivatedRoute);
  // Zoneless (AGENTS.md; see `entities-page.component.ts`'s own identical
  // doc comment, this task's sibling fix): `project`/`env`/`envDb`/
  // `projectFull` below are plain fields, mutated from RxJS `.subscribe()`
  // callbacks.
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  @ViewChild('grid', { static: false }) gridElRef?: ElementRef;

  filter = '';
  tab: 'tables' | 'views' = 'tables';

  project?: IProjectContext;
  projectFull?: IProjectFull;
  env?: IEnvironmentFull;
  dbId?: string;
  // `id`/`tables`/`views` — Task 17 item A.2/B.1 (S121): fetched from
  // GET /datatug/catalog-tables (loadCatalogTables() below), replacing the
  // old `history.state.db` read, which nothing in this app ever pushed
  // (S120's report) — this page was unreachable via any real navigation,
  // and would show 0 rows even once its NG0201 DI bug (fixed separately,
  // PR #89) was gone. `id` is filled in client-side from the route's own
  // catalog id (the endpoint's response carries only tables/views — see
  // ICatalogTables's own doc comment).
  envDb?: ICatalogTables & { id: string };

  defaultColDef = {
    resizable: true,
  };

  allRows: Record<string, IRecordsetInfo[]> = {};
  filteredRows: Record<string, IRecordsetInfo[]> = {};

  private tabulator?: Tabulator;

  private readonly destroyed = new Subject<void>();

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  ngOnInit(): void {
    const projectTracker = new ProjectTracker(this.destroyed, this.route);
    projectTracker.projectRef.subscribe({
      next: (projectRef) => {
        // `this.project` was never assigned here, so the rowClick handler below
        // (built in createTabulator()) always bailed out of `goTable()` on its
        // `if (!project || ...)` guard — a row click silently did nothing. Found by
        // S10's journey e2e (see e2e/journey/README.md "Known gap").
        this.project = newProjectContextFromRef(projectRef);
        const envId = this.route.snapshot.params[routingParamEnvironmentId];
        this.dbId = this.route.snapshot.params[routingParamDbCatalogId];
        this.changeDetectorRef.markForCheck();
        if (isGithubStoreId(projectRef.storeId)) {
          // GitHub-store: `ProjectService.getFull()` (below) always calls
          // `buildAgentUrl(storeId, ...)`, invalid for `storeId="github.com"`
          // (same root cause as `EnvironmentsPageComponent`'s own fix, founder
          // ruling 2026-09-11). `this.env` only needs `{id}` here — the
          // tabulator row-click handler (`createTabulator()` below) reads
          // `env.id` — so the GitHub-aware `EnvironmentService.getEnvSummary()`
          // supplies it without needing the whole project tree.
          this.environmentService
            .getEnvSummary(projectRef, envId)
            .subscribe((envSummary) => {
              this.env = envSummary;
              this.changeDetectorRef.markForCheck();
            });
          this.loadCatalogTables(projectRef, envId, this.dbId);
          return;
        }
        this.projService.getFull(projectRef).subscribe((p) => {
          this.projectFull = p;
          this.env = p.environments?.find((e) => e.id === envId);
          this.changeDetectorRef.markForCheck();
          this.loadCatalogTables(projectRef, envId, this.dbId);
        });
      },
    });
  }

  private loadCatalogTables(
    projectRef: IProjectRef,
    envId?: string,
    dbId?: string,
  ): void {
    if (!envId || !dbId) {
      this.errorLogger.logError(
        new Error(
          `Missing environment or catalog id (env=${envId}, db=${dbId})`,
        ),
        'Failed to load catalog tables',
      );
      return;
    }
    this.environmentService.getCatalogTables(projectRef, envId, dbId).subscribe({
      next: (catalogTables) => {
        this.envDb = { id: dbId, ...catalogTables };
        this.onDataChanged();
        this.changeDetectorRef.markForCheck();
      },
      error: (err) =>
        this.errorLogger.logError(err, 'Failed to load catalog tables'),
    });
  }

  public tabChanged(): void {
    const map2row = (t: ITableFull) => {
      const row: IRecordsetInfo = {
        schema: t.schema,
        name: t.name,
        cols: t.columns?.length,
        fks: t.foreignKeys?.length,
        refsBy: t.referencedBy?.length,
        t,
      };
      return row;
    };
    if (this.filteredRows[this.tab]) {
      this.tabulator?.setData(this.filteredRows[this.tab]).catch(console.error);
    } else if (!this.allRows[this.tab]) {
      switch (this.tab) {
        case 'tables':
          this.allRows[this.tab] = this.envDb?.tables?.map(map2row) || [];
          break;
        case 'views':
          this.allRows[this.tab] = this.envDb?.views?.map(map2row) || [];
          break;
      }
      this.filterRows();
    }
  }

  public filterRows(): void {
    let rows = this.allRows[this.tab];
    if (this.filter) {
      const v = this.filter.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(v));
    }
    this.filteredRows[this.tab] = rows;
    if (this.tabulator) {
      this.tabulator.setData(rows).catch(console.error);
    } else {
      this.createTabulator();
    }
  }

  private createTabulator(): void {
    const columns: IGridColumn[] = [
      // {field: 'schema', dbType: 'str', title: 'Schema', widthGrow: 2},
      {
        field: 'name',
        dbType: 'str',
        title: 'Name',
        widthGrow: 4, // resizable: true,
        // cellRendererFramework: RouterLinkRendererComponent,
        // cellRendererParams: {
        // 	routerLinkRendererComponentOptions: (param): IRouterLinkRendererComponentOptions => {
        // 		if (param.data.name) {
        // 			const linkParams = ['./' + this.tab, `${param.data.schema}.${param.data.name}`];
        // 			return {
        // 				routerLinkParams: linkParams,
        // 				linkDescription: param.data.name,
        // 			};
        // 		} else {
        // 			return {
        // 				textOnly: JSON.stringify(param.data),
        // 			};
        // 		}
        // 	}
        // },
      },
      {
        title: 'Cols',
        dbType: 'integer',
        field: 'cols',
        widthGrow: 1,
        hozAlign: 'right',
        tooltip: this.colsTooltip as unknown as GlobalTooltipOption, // TODO: fix
      },
      {
        title: 'FKs',
        dbType: 'integer',
        field: 'fks',
        widthGrow: 1,
        hozAlign: 'right',
        tooltip: this.fksTooltip as unknown as GlobalTooltipOption,
      },
      {
        title: 'Refs By',
        dbType: 'integer',
        field: 'refsBy',
        widthGrow: 1,
        hozAlign: 'right',
        tooltip: this.refsByTooltip as unknown as GlobalTooltipOption,
      },
      {
        title: 'Rows',
        dbType: 'integer',
        field: 'rows',
        widthGrow: 1,
        hozAlign: 'right',
      },
    ];

    const options = {
      data: this.filteredRows[this.tab],
      layout: 'fitColumns',
      groupBy: 'schema',
      columns: getTabulatorCols(columns),
    };
    if (this.gridElRef) {
      this.tabulator = new Tabulator(
        this.gridElRef?.nativeElement,
        options as unknown as Options,
      );
      // `rowClick` as a raw CONSTRUCTOR OPTION (the form this used before,
      // matching every other Tabulator callback option here) never actually
      // wires up a click listener in tabulator-tables 6.3.1 — Task 17 item
      // B.1 (S121): confirmed live that a real, fully-trusted click
      // (mousedown/mouseup/click all landing squarely on the row element,
      // per getBoundingClientRect+elementFromPoint) never invoked it, even
      // after registering InteractionModule (see this file's own
      // `Tabulator.registerModule` doc comment above) — because
      // `Interaction.initializeExternalEvents()` only watches for the
      // EXTERNAL-EVENT SUBSCRIPTION going from 0 to 1 (`tab.on('rowClick',
      // ...)`) to lazily bind its delegated DOM listener; nothing in
      // Tabulator's own option-processing ever converts a same-named
      // `options.rowClick` callback into that subscription for THIS event
      // (unlike, e.g., per-column `cellClick`, which IS a registered column
      // option). `@sneat/datagrid`'s own `DataGridComponent` (this app's
      // other, working Tabulator wrapper, `env-db-table.page.ts`'s grid)
      // already uses exactly this `.on('rowClick', ...)` form, never the
      // options-object one — this page just never matched that pattern.
      this.tabulator.on('rowClick', (e, row) => {
        const data = row.getData() as unknown as IRecordsetInfo;
        const project = this.project;
        const env = this.env;
        const envDb = this.envDb;
        if (!project || !env || !envDb) {
          return;
        }
        this.datatugNavService.goTable({
          project,
          env: env.id,
          db: envDb.id,
          schema: data.t.schema,
          name: data.t.name,
        });
      });
    }
  }

  private onDataChanged(): void {
    this.allRows = {};
    this.tabChanged();
  }

  private colsTooltip = (cell: { getData: () => IRecordsetInfo }) => {
    const data: IRecordsetInfo = cell.getData();
    return (
      'COLUMNS:\n' +
      data.t.columns?.map((c) => `${c.name}: ${c.dbType}`).join('\n')
    );
  };

  private fksTooltip = (cell: { getData: () => IRecordsetInfo }) => {
    const data: IRecordsetInfo = cell.getData();
    return (
      'FOREIGN KEYS:\n' +
      data.t.foreignKeys
        ?.map((fk) => `${fk.name} (${fk.columns.join(', ')})`)
        .join('\n')
    );
  };

  private refsByTooltip = (cell: { getData: () => IRecordsetInfo }) => {
    const data: IRecordsetInfo = cell.getData();
    return (
      'REFERENCED BY:\n' +
      data.t.referencedBy
        ?.map(
          (ref) =>
            `${ref.schema}.${ref.name} (${ref.foreignKeys
              .map((fk) => fk.name)
              .join(', ')})`,
        )
        .join('\n')
    );
  };
}

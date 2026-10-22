import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  AgGridReadyDirective,
  agGridEnterpriseEnabled,
} from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import type {
  CellFocusedEvent,
  ChartCreatedEvent,
  ColDef,
  ColumnResizedEvent,
  GridApi,
  GridReadyEvent,
  RowClassRules,
  RowClickedEvent,
  SelectionChangedEvent,
} from 'ag-grid-community';
import {
  GridRow,
  RESULTS_GRID_COLUMN_TYPES,
  ROW_NUMBER_COLUMN,
} from './results-grid-columns';
import {
  GRID_STATE_VERSION,
  GridDensity,
  StoredColumnState,
  columnSignature,
  readGridState,
  toTsv,
  writeGridState,
} from './results-grid-state';

/** Community multi-row selection with a checkbox column; a click on a row selects nothing (only the box does). */
const ROW_SELECTION = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
  selectAll: 'filtered',
} as const;
const SELECTION_COLUMN_DEF = {
  pinned: 'left',
  width: 44,
  minWidth: 44,
  maxWidth: 44,
  resizable: false,
  chartDataType: 'excluded',
  enableValue: false,
  enableRowGroup: false,
  enablePivot: false,
} as const;
/** Row height of the compact density; the comfortable density is the theme's own. */
const COMPACT_ROW_HEIGHT = 28;
/**
 * Height of the floating-filter row under the column headers. AG Grid's own default is the (tall) header height; the
 * inputs stay usable at 40px (the control itself is 28px) and the row, which sits before the first result row, costs
 * 24px less of the fold.
 */
export const FLOATING_FILTERS_HEIGHT = 40;
const STATUS_MS = 5000;

interface LayoutScope {
  readonly key: string | undefined;
  readonly signature: string;
  readonly ids: readonly string[];
}

/** One column in the column chooser. */
export interface ChooserColumn {
  readonly colId: string;
  readonly name: string;
  readonly title: string;
  readonly visible: boolean;
  readonly pinned: boolean;
}

/** Side bar of the enterprise build: column chooser and filters tool panels. */
const ENTERPRISE_SIDE_BAR = {
  toolPanels: ['columns', 'filters'],
  defaultToolPanel: '',
};
/** Status bar of the enterprise build: row counts and the aggregate of a selected range. */
const ENTERPRISE_STATUS_BAR = {
  statusPanels: [
    { statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' },
    { statusPanel: 'agSelectedRowCountComponent', align: 'center' },
    { statusPanel: 'agAggregationComponent', align: 'right' },
  ],
};

import {
  analyticsColumns,
  ENTERPRISE_GROUP_VISIBILITY,
} from './results-grid-analytics';
import {
  RAW_RESULT_EXCEL_STYLES,
  rawResultCell,
  skipResultSummaryRow,
} from './results-grid-export';

const NO_ROWS = '<span class="ag-overlay-no-rows-center">No rows.</span>';

/**
 * The one grid of query results (feature: the query page and the query result page show rows the same way).
 *
 * Community features, always on: sorting on every column (an unsorted column shows its sort indicator too), a filter
 * per column kind (text, number, date) with floating filters, resizable and movable columns, a row-number column,
 * type-aware cells (right-aligned numbers with thousands separators except identifiers, locale dates, check marks for
 * booleans, compact JSON, a dimmed `null`), column widths fitted to the content within bounds, a quick filter box,
 * multi-row selection with a checkbox column, CSV export (the selected rows, or all when none is selected), copying
 * the selected rows as tab-separated text, a column chooser (show/hide, order, pin) that replaces the enterprise
 * columns tool panel and column menu, "Autosize all", a compact/comfortable density, tooltips with the full text of a
 * cell and the name and type of a column, the layout remembered per context (see `results-grid-state.ts`), native text
 * selection for copy, keyboard navigation and row virtualization.
 *
 * Enterprise features, on only while `agGridEnterpriseEnabled()` is true (a license key was configured at build
 * time; otherwise none of their options is even passed to the grid): the column menu (pin, auto-size; its button is
 * always shown on every header, not only on hover), row grouping and aggregation, pivot, the side bar tool panels, the status bar, range (cell) selection with clipboard copy, integrated charts and Excel export.
 *
 * Rows are objects keyed by column id whose cells are text or `null`; see `results-grid-columns.ts`.
 */
@Component({
  selector: 'sneat-datatug-results-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AgGridAngular, AgGridReadyDirective],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'closeChooser(); closeMore(true)',
    '(keydown)': 'onMenuKeydown($event)',
    '[class.dt-rg-enterprise]': 'enterprise()',
  },
  template: `
    @if (showToolbar()) {
      <div class="dt-rg-toolbar" data-testid="results-grid-toolbar">
        <input
          type="search"
          class="dt-rg-filter"
          placeholder="Filter rows"
          aria-label="Filter rows"
          data-testid="results-grid-quick-filter"
          [value]="quickFilter()"
          (input)="onQuickFilter($event)"
        />
        <span class="dt-rg-count" data-testid="results-grid-count">{{
          rowCountLabel()
        }}</span>
        <div class="dt-rg-actions">
          <button
            type="button"
            class="dt-rg-button"
            data-testid="results-grid-export-csv"
            [title]="
              selectedCount() > 0
                ? 'Export the selected rows as CSV'
                : 'Export all rows as CSV'
            "
            (click)="exportCsv()"
          >
            {{ selectedCount() > 0 ? 'CSV selected' : 'CSV' }}
          </button>
          <!-- Filter and CSV stay on the bar; the rarer actions sit under "More". -->
          <div class="dt-rg-more">
            <button
              type="button"
              class="dt-rg-button dt-rg-more-button"
              data-testid="results-grid-more"
              aria-haspopup="menu"
              aria-label="More result actions"
              title="More result actions"
              [attr.aria-expanded]="moreOpen()"
              (click)="toggleMore($event)"
            >
              ⋯
            </button>
            <div
              class="dt-rg-menu"
              role="menu"
              aria-label="More result actions"
              data-testid="results-grid-more-menu"
              [hidden]="!moreOpen()"
            >
              <button
                type="button"
                role="menuitem"
                class="dt-rg-menu-item"
                data-testid="results-grid-columns-button"
                aria-haspopup="true"
                [attr.aria-expanded]="chooserOpen()"
                (click)="closeMore(true); toggleChooser($event)"
              >
                Columns…
              </button>
              <button
                type="button"
                role="menuitem"
                class="dt-rg-menu-item"
                data-testid="results-grid-autosize"
                title="Fit every column to its content"
                (click)="closeMore(true); autosizeAll()"
              >
                Autosize columns
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                class="dt-rg-menu-item"
                data-testid="results-grid-density"
                [attr.aria-checked]="density() === 'compact'"
                [title]="
                  density() === 'compact'
                    ? 'Compact rows (press for comfortable)'
                    : 'Comfortable rows (press for compact)'
                "
                (click)="closeMore(true); toggleDensity()"
              >
                {{ density() === 'compact' ? 'Compact' : 'Comfortable' }} rows
              </button>
              <button
                type="button"
                role="menuitem"
                class="dt-rg-menu-item"
                data-testid="results-grid-copy"
                title="Copy the selected rows, with a header line, as tab-separated text"
                [disabled]="selectedCount() === 0"
                (click)="closeMore(true); copySelected()"
              >
                Copy selected
              </button>
              @if (enterprise()) {
                <button
                  type="button"
                  role="menuitem"
                  class="dt-rg-menu-item"
                  data-testid="results-grid-chart"
                  [disabled]="!chartRangeReady()"
                  (click)="closeMore(true); chartSelectedRange()"
                  title="Select cells containing a numeric measure, then chart that range"
                >
                  Chart selected range
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="dt-rg-menu-item"
                  data-testid="results-grid-export-excel"
                  (click)="closeMore(true); exportExcel()"
                >
                  Excel
                </button>
              }
            </div>
          </div>
        </div>
        <span
          class="dt-rg-status"
          role="status"
          aria-live="polite"
          data-testid="results-grid-status"
          >{{ status() }}</span
        >
        @if (enterprise()) {
          <span class="dt-rg-status" data-testid="results-grid-analytics-scope"
            >{{ analyticsScope() }} · Numeric aggregations and charts are
            approximate.</span
          >
          @if (analytics().excluded.length) {
            <span class="dt-rg-status" role="status"
              >Exact text only (not numeric measures):
              {{ analytics().excluded.join(', ') }}.</span
            >
          }
        }
        @if (chooserOpen()) {
          <div
            class="dt-rg-chooser"
            role="group"
            aria-label="Columns"
            data-testid="results-grid-chooser"
          >
            <div class="dt-rg-chooser-head">
              <button
                type="button"
                class="dt-rg-button"
                data-testid="results-grid-show-all"
                (click)="showAllColumns()"
              >
                Show all
              </button>
              <button
                type="button"
                class="dt-rg-button"
                data-testid="results-grid-reset-columns"
                title="Forget the remembered layout: order, widths, visibility, pinning and sort"
                (click)="resetColumns()"
              >
                Reset columns
              </button>
            </div>
            <ul class="dt-rg-chooser-list">
              @for (
                col of chooserColumns();
                track col.colId;
                let i = $index;
                let last = $last
              ) {
                <li class="dt-rg-chooser-item" [attr.data-col-id]="col.colId">
                  <label [title]="col.title">
                    <input
                      type="checkbox"
                      data-testid="results-grid-column-toggle"
                      [checked]="col.visible"
                      (change)="
                        setColumnVisible(col.colId, $any($event.target).checked)
                      "
                    />
                    <span class="dt-rg-chooser-name">{{ col.name }}</span>
                  </label>
                  <button
                    type="button"
                    class="dt-rg-icon-button"
                    data-testid="results-grid-column-pin"
                    [attr.aria-pressed]="col.pinned"
                    [attr.aria-label]="
                      (col.pinned ? 'Unpin ' : 'Pin ') + col.name
                    "
                    [title]="col.pinned ? 'Unpin' : 'Pin to the left'"
                    (click)="togglePinned(col.colId)"
                  >
                    {{ col.pinned ? 'Unpin' : 'Pin' }}
                  </button>
                  <button
                    type="button"
                    class="dt-rg-icon-button"
                    data-testid="results-grid-column-up"
                    [attr.aria-label]="'Move ' + col.name + ' up'"
                    [disabled]="i === 0"
                    (click)="moveColumn(col.colId, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="dt-rg-icon-button"
                    data-testid="results-grid-column-down"
                    [attr.aria-label]="'Move ' + col.name + ' down'"
                    [disabled]="last"
                    (click)="moveColumn(col.colId, 1)"
                  >
                    ↓
                  </button>
                </li>
              }
            </ul>
          </div>
        }
      </div>
    }
    <div class="dt-rg-host">
      <ag-grid-angular
        *datatugAgGridReady
        class="ag-theme-quartz"
        style="width: 100%"
        [style.height]="enterprise() ? '520px' : '100%'"
        [columnDefs]="defs()"
        [columnTypes]="columnTypes"
        [rowData]="rowData()"
        [defaultColDef]="defaultColDef()"
        [headerHeight]="headerHeight()"
        [floatingFiltersHeight]="floatingFiltersHeight"
        [rowHeight]="rowHeight()"
        [rowSelection]="rowSelection"
        [selectionColumnDef]="selectionColumnDef"
        [rowClassRules]="rowClassRules()"
        [loading]="loading()"
        [overlayNoRowsTemplate]="overlayNoRowsTemplate()"
        [quickFilterText]="quickFilter()"
        [autoSizeStrategy]="autoSizeStrategy()"
        [enableCellTextSelection]="!enterprise()"
        [columnHoverHighlight]="true"
        [tooltipShowDelay]="600"
        [suppressMenuHide]="true"
        [sideBar]="enterprise() ? sideBar : undefined"
        [statusBar]="enterprise() ? statusBar : undefined"
        [suppressGroupChangesColumnVisibility]="
          enterprise()
            ? groupVisibility.suppressGroupChangesColumnVisibility
            : undefined
        "
        [suppressDragLeaveHidesColumns]="
          enterprise()
            ? groupVisibility.suppressDragLeaveHidesColumns
            : undefined
        "
        [rowGroupPanelShow]="enterprise() ? 'always' : undefined"
        [cellSelection]="enterprise() ? true : undefined"
        [enableCharts]="enterprise()"
        [excelStyles]="enterprise() ? rawExcelStyles : undefined"
        [processCellForClipboard]="enterprise() ? clipboardCell : undefined"
        (cellSelectionChanged)="updateChartRange()"
        (chartCreated)="onChartCreated($event)"
        (gridReady)="onGridReady($event)"
        (rowClicked)="rowClicked.emit($event)"
        (selectionChanged)="onSelectionChanged($event)"
        (cellFocused)="cellFocused.emit($event)"
        (modelUpdated)="onModelUpdated()"
        (newColumnsLoaded)="onNewColumnsLoaded()"
        (columnMoved)="onLayoutChanged($event)"
        (columnVisible)="onLayoutChanged($event)"
        (columnPinned)="onLayoutChanged($event)"
        (sortChanged)="onLayoutChanged($event)"
        (columnResized)="onColumnResized($event)"
      />
    </div>
  `,
  styles: `
    sneat-datatug-results-grid {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      width: 100%;
    }
    .dt-rg-toolbar {
      align-items: center;
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: 0.35rem 0.5rem;
      min-width: 0;
      padding: 0 0 0.35rem;
      position: relative;
    }
    .dt-rg-filter {
      background: var(--ion-item-background, #fff);
      border: 1px solid var(--ion-color-step-250, #c8c8c8);
      border-radius: 0.35rem;
      color: var(--ion-text-color, inherit);
      flex: 1 1 10rem;
      max-width: 22rem;
      min-width: 6rem;
      padding: 0.3rem 0.5rem;
    }
    .dt-rg-count {
      color: var(--dt-text-muted, #666);
      flex: 1 1 auto;
      font-size: 0.8rem;
    }
    .dt-rg-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-inline-start: auto;
      min-width: 0;
    }
    .dt-rg-status {
      color: var(--dt-text-muted, #666);
      flex: 1 0 100%;
      font-size: 0.8rem;
    }
    .dt-rg-status:empty {
      display: none;
    }
    .dt-rg-button {
      background: transparent;
      border: 1px solid var(--ion-color-step-250, #c8c8c8);
      border-radius: 0.35rem;
      color: var(--ion-color-primary, inherit);
      cursor: pointer;
      padding: 0.25rem 0.6rem;
    }
    .dt-rg-more {
      position: relative;
    }
    .dt-rg-more-button {
      color: var(--ion-color-medium, #666);
      font-weight: 700;
      line-height: 1;
    }
    .dt-rg-menu {
      background: var(--ion-item-background, #fff);
      border: 1px solid var(--ion-color-step-250, #c8c8c8);
      border-radius: 0.5rem;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      display: flex;
      flex-direction: column;
      min-width: 12rem;
      padding: 0.25rem 0;
      position: absolute;
      right: 0;
      top: calc(100% + 0.25rem);
      z-index: 31;
    }
    .dt-rg-menu[hidden] {
      display: none;
    }
    .dt-rg-menu-item {
      background: transparent;
      border: 0;
      color: var(--ion-text-color, inherit);
      cursor: pointer;
      padding: 0.5rem 0.9rem;
      text-align: start;
    }
    .dt-rg-menu-item:hover:not(:disabled),
    .dt-rg-menu-item:focus-visible {
      background: var(--ion-color-step-100, rgba(0, 0, 0, 0.06));
    }
    .dt-rg-menu-item:disabled {
      cursor: default;
      opacity: 0.45;
    }
    .dt-rg-button:disabled,
    .dt-rg-icon-button:disabled {
      cursor: default;
      opacity: 0.45;
    }
    .dt-rg-chooser {
      background: var(--ion-item-background, #fff);
      border: 1px solid var(--ion-color-step-250, #c8c8c8);
      border-radius: 0.5rem;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
      left: 0;
      max-height: min(24rem, 60vh);
      max-width: 100%;
      overflow: auto;
      padding: 0.5rem;
      position: absolute;
      top: 100%;
      width: 24rem;
      z-index: 30;
    }
    .dt-rg-chooser-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-bottom: 0.4rem;
    }
    .dt-rg-chooser-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .dt-rg-chooser-item {
      align-items: center;
      display: flex;
      gap: 0.25rem;
    }
    .dt-rg-chooser-item label {
      align-items: center;
      display: flex;
      flex: 1 1 auto;
      gap: 0.4rem;
      min-width: 0;
    }
    .dt-rg-chooser-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dt-rg-icon-button {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 0.3rem;
      color: var(--ion-color-primary, inherit);
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0.1rem 0.35rem;
    }
    .dt-rg-icon-button[aria-pressed='true'] {
      border-color: var(--ion-color-step-250, #c8c8c8);
    }
    sneat-datatug-results-grid.dt-rg-enterprise {
      height: auto;
    }
    .dt-rg-enterprise .dt-rg-host {
      /* The grid child has a definite height; grow the page around it, rather than resolving 100% of auto. */
      flex: none;
    }
    .dt-rg-host {
      flex: 1 1 auto;
      min-height: 0;
    }
    sneat-datatug-results-grid .dt-rg-null {
      color: var(--dt-text-muted, #888);
      font-style: italic;
      opacity: 0.6;
    }
    sneat-datatug-results-grid .dt-rg-center-cell,
    sneat-datatug-results-grid .dt-rg-center-header .ag-header-cell-label {
      justify-content: center;
      text-align: center;
    }
    sneat-datatug-results-grid .dt-rg-json-cell {
      font-family: var(--ion-font-family-mono, ui-monospace, monospace);
      font-size: 0.85em;
    }
    sneat-datatug-results-grid .dt-rg-row-number {
      color: var(--dt-text-muted, #888);
    }
    /* A short number needs no 16px gutters: the row-number column fits its digits at about 45px instead of 61px. */
    sneat-datatug-results-grid .ag-header-cell.dt-rg-row-number-header,
    sneat-datatug-results-grid .ag-cell.dt-rg-row-number {
      padding-inline: 8px;
    }
  `,
})
export class ResultsGridComponent {
  /** Columns, already built (usually from `resultColumnDef`); the row-number column is added here. */
  readonly columnDefs = input.required<readonly ColDef<GridRow>[]>();
  readonly rowData = input<GridRow[]>([]);
  /** Query/result/page identity, never focus or presentation state. */
  readonly snapshotKey = input<unknown>(undefined);
  readonly analyticsScope = input('Analytics use the loaded rows');
  readonly chartRangeReady = signal(false);
  readonly analytics = computed(() =>
    analyticsColumns(this.columnDefs(), this.rowData()),
  );
  readonly loading = input(false);
  readonly headerHeight = input<number | undefined>(undefined);
  readonly rowClassRules = input<RowClassRules | undefined>(undefined);
  readonly overlayNoRowsTemplate = input(NO_ROWS);
  readonly showToolbar = input(true);
  readonly showRowNumbers = input(true);
  /** Base name of the exported files (`<name>.csv`). */
  readonly exportName = input('results');
  /**
   * Where the column layout and density are remembered (see `gridStateKey`: ids only). Without it nothing is stored.
   */
  readonly stateKey = input<string | undefined>(undefined);

  readonly rowClicked = output<RowClickedEvent<GridRow>>();
  /** The checked rows changed (the checkbox selection; a click on a row does not select it). */
  readonly selectionChanged = output<SelectionChangedEvent<GridRow>>();
  readonly cellFocused = output<CellFocusedEvent<GridRow>>();

  readonly floatingFiltersHeight = FLOATING_FILTERS_HEIGHT;
  readonly columnTypes = RESULTS_GRID_COLUMN_TYPES;
  readonly autoSize = { type: 'fitCellContents' } as const;
  readonly rowSelection = ROW_SELECTION;
  readonly selectionColumnDef = SELECTION_COLUMN_DEF;
  readonly groupVisibility = ENTERPRISE_GROUP_VISIBILITY;
  readonly rawExcelStyles = RAW_RESULT_EXCEL_STYLES;
  readonly sideBar = ENTERPRISE_SIDE_BAR;
  readonly statusBar = ENTERPRISE_STATUS_BAR;
  readonly quickFilter = signal('');
  /** True once the enterprise modules were registered with a license key. */
  readonly enterprise = agGridEnterpriseEnabled;

  readonly density = signal<GridDensity>('comfortable');
  readonly chooserOpen = signal(false);
  /** The toolbar's "More" menu: Columns, Autosize, density, Copy, Chart, Excel. */
  readonly moreOpen = signal(false);
  readonly chooserColumns = signal<ChooserColumn[]>([]);
  readonly selectedCount = signal(0);
  /** A short named message about the last copy/export action (never a row value). */
  readonly status = signal('');

  private api?: GridApi<GridRow>;
  private readonly chartIds = new Set<string>();
  private readonly shown = signal<number | undefined>(undefined);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private statusTimer?: ReturnType<typeof setTimeout>;
  private autosizeTimer?: ReturnType<typeof setTimeout>;
  private layoutScope?: LayoutScope;
  private appliedLayout?: { scope: LayoutScope; columns: string };
  private readonly autosizeOperation = signal<
    { scope: LayoutScope; remember: boolean } | undefined
  >(undefined);
  /** True once the person (or a restored layout) set the layout: only then are widths/order/sort stored. */
  private readonly layoutTouched = signal(false);

  readonly defs = computed<ColDef<GridRow>[]>(() => [
    ...(this.showRowNumbers() ? [ROW_NUMBER_COLUMN] : []),
    ...(this.enterprise() ? this.analytics().columns : this.columnDefs()),
  ]);

  /** Ids of the data columns (not the row-number or selection column), in the order given. */
  private readonly dataColumnIds = computed(() =>
    this.columnDefs()
      .map((d) => d.colId)
      .filter((id): id is string => !!id),
  );
  /** The columns the chooser offers: all but those that are not data (the internal `$key`). */
  private readonly chooserIds = computed(
    () =>
      new Set(
        this.columnDefs()
          .filter((d) => !d.suppressColumnsToolPanel)
          .map((d) => d.colId)
          .filter((id): id is string => !!id),
      ),
  );
  private readonly signature = computed(() =>
    columnSignature(
      this.columnDefs().map((d) => ({
        colId: d.colId ?? '',
        name: d.headerName,
        type: typeof d.type === 'string' ? d.type : undefined,
      })),
    ),
  );

  /** Fit to content only when no remembered layout (which has its own widths) is going to be applied. */
  readonly autoSizeStrategy = computed(() => {
    const stored = readGridState(
      this.stateKey(),
      this.signature(),
      this.dataColumnIds(),
    );
    return stored?.cols ? undefined : this.autoSize;
  });

  readonly rowHeight = computed(() =>
    this.density() === 'compact' ? COMPACT_ROW_HEIGHT : undefined,
  );

  readonly defaultColDef = computed<ColDef<GridRow>>(() => ({
    resizable: true,
    sortable: true,
    unSortIcon: true,
    filter: true,
    floatingFilter: true,
    ...(this.enterprise() ? { enableRowGroup: true, enablePivot: true } : {}),
  }));

  readonly rowCountLabel = computed(() => {
    const total = this.rowData().length;
    const shown = this.shown() ?? total;
    const base =
      shown === total
        ? `${total} ${total === 1 ? 'row' : 'rows'}`
        : `${shown} of ${total} rows`;
    return this.selectedCount() > 0
      ? `${base}, ${this.selectedCount()} selected`
      : base;
  });

  constructor() {
    // The density is remembered per context: read it before the grid is created, so rows do not jump.
    effect(() => {
      const key = this.stateKey();
      const signature = this.signature();
      const ids = this.dataColumnIds();
      untracked(() => {
        // A deferred grid event must not write a previous result's state under new inputs.
        if (
          !this.layoutScope ||
          this.layoutScope.key !== key ||
          this.layoutScope.signature !== signature
        ) {
          this.layoutScope = { key, signature, ids };
          this.appliedLayout = undefined;
          clearTimeout(this.autosizeTimer);
          this.autosizeOperation.set(undefined);
        }
        const stored = readGridState(key, signature, ids);
        this.density.set(stored?.density ?? 'comfortable');
        this.layoutTouched.set(!!stored?.cols);
        if (this.api) this.applyStoredLayout();
      });
    });
    effect(() => {
      if (this.snapshotKey() === undefined) this.rowData();
      this.signature();
      untracked(() => this.destroyCharts());
    });
    this.destroyRef.onDestroy(() => {
      this.destroyCharts();
      clearTimeout(this.autosizeTimer);
      clearTimeout(this.statusTimer);
    });
  }

  onQuickFilter(event: Event): void {
    this.quickFilter.set((event.target as HTMLInputElement).value);
  }

  onGridReady(event: GridReadyEvent<GridRow>): void {
    this.api = event.api;
    this.applyStoredLayout();
    this.refreshChooser();
  }

  onNewColumnsLoaded(): void {
    if (!this.api) return;
    this.applyStoredLayout();
    this.refreshChooser();
  }

  onModelUpdated(): void {
    const api = this.api;
    let leaves = 0;
    api?.forEachNodeAfterFilter?.((node) => {
      if (!node.group && !node.footer && node.data) leaves++;
    });
    this.shown.set(api ? leaves : undefined);
    this.updateChartRange();
    this.refreshSelectedCount();
  }

  onSelectionChanged(event: SelectionChangedEvent<GridRow>): void {
    this.refreshSelectedCount();
    this.selectionChanged.emit(event);
  }

  private refreshSelectedCount(): void {
    this.selectedCount.set(
      this.api
        ?.getSelectedNodes?.()
        .filter((n) => !n.group && !n.footer && !!n.data).length ?? 0,
    );
  }

  // ---- remembered layout ----

  private applyStoredLayout(): void {
    const api = this.api;
    const scope = this.layoutScope;
    if (!api || !scope) return;
    const stored = readGridState(scope.key, scope.signature, scope.ids);
    this.setDensityOnGrid(stored?.density ?? this.density());
    if (stored?.cols) {
      api.applyColumnState({
        state: stored.cols.map((c) => ({
          colId: c.colId,
          hide: c.hide,
          ...(c.width !== undefined ? { width: c.width } : {}),
          pinned: c.pinned,
          sort: c.sort,
          sortIndex: c.sortIndex,
        })),
        applyOrder: true,
      });
      this.layoutTouched.set(true);
    }
    this.rememberAppliedLayout();
  }

  onLayoutChanged(event?: { source?: string; finished?: boolean }): void {
    this.refreshChooser();
    if (event?.finished === false) return;
    // Replacing definitions dispatches state changes before newColumnsLoaded,
    // where the remembered layout is restored. They are not completed choices.
    if (
      event?.source === 'gridOptionsChanged' ||
      event?.source === 'gridInitializing' ||
      event?.source === 'cellDataTypeInferred'
    )
      return;
    const columns = this.captureColumns();
    if (!columns) return;
    // AG dispatches restore events asynchronously. Ignore only unchanged replay;
    // changed API actions (including the column chooser) are still real changes.
    const applied = this.appliedLayout;
    if (
      event?.source === 'api' &&
      applied &&
      applied.scope === this.layoutScope &&
      applied.columns === JSON.stringify(columns)
    )
      return;
    this.layoutTouched.set(true);
    this.saveLayout(columns);
  }

  onColumnResized(event: ColumnResizedEvent): void {
    if (!event.finished) return;
    const operation = this.autosizeOperation();
    if (event.source === 'autosizeColumns') {
      this.autosizeOperation.set(undefined);
      if (operation && operation.scope === this.layoutScope) {
        if (!operation.remember) this.rememberAppliedLayout();
      }
      return; // Initial fit is implicit; the explicit button owns its save.
    }
    // autoSizeAllColumns also emits intermediate API resize events before its
    // completion notification. The captured operation owns those, not a timer.
    if (
      event.source === 'api' &&
      operation &&
      (!operation.remember || operation.scope !== this.layoutScope)
    )
      return;
    this.onLayoutChanged(event);
  }

  private rememberAppliedLayout(): void {
    const scope = this.layoutScope;
    const columns = this.captureColumns();
    this.appliedLayout =
      scope && columns
        ? { scope, columns: JSON.stringify(columns) }
        : undefined;
  }

  private captureColumns(): StoredColumnState[] | undefined {
    const api = this.api;
    const scope = this.layoutScope;
    if (!api || !scope) return;
    const ids = new Set(scope.ids);
    const columns: StoredColumnState[] = api
      .getColumnState()
      .filter((c) => ids.has(c.colId))
      .map((c) => ({
        colId: c.colId,
        hide: !!c.hide,
        ...(typeof c.width === 'number' ? { width: c.width } : {}),
        pinned: c.pinned === 'left' || c.pinned === 'right' ? c.pinned : null,
        sort: c.sort ?? null,
        sortIndex: c.sortIndex ?? null,
      }));
    if (
      columns.length !== ids.size ||
      new Set(columns.map((c) => c.colId)).size !== ids.size
    )
      return;
    return columns;
  }

  private saveLayout(columns = this.captureColumns()): void {
    const scope = this.layoutScope;
    if (!scope?.key || !columns) return;
    // Capture and write completed changes in the same turn: navigation, metadata
    // redraw or grid destruction must not cancel or resample the person's choice.
    writeGridState(scope.key, {
      v: GRID_STATE_VERSION,
      density: this.density(),
      ...(this.layoutTouched() && columns.length
        ? { sig: scope.signature, cols: columns }
        : {}),
    });
    this.appliedLayout = { scope, columns: JSON.stringify(columns) };
  }

  resetColumns(): void {
    const api = this.api;
    if (!api) return;
    clearTimeout(this.autosizeTimer);
    this.layoutTouched.set(false);
    // Forget the stored layout first: the grid's own reset events must not find it and apply it again.
    this.saveLayout();
    api.resetColumnState();
    this.fitColumns(false);
    this.rememberAppliedLayout();
    this.refreshChooser();
    this.say('Columns reset.');
  }

  // ---- density ----

  toggleDensity(): void {
    const next: GridDensity =
      this.density() === 'compact' ? 'comfortable' : 'compact';
    this.density.set(next);
    this.setDensityOnGrid(next);
    this.saveLayout();
  }

  private setDensityOnGrid(density: GridDensity): void {
    const api = this.api;
    if (!api) return;
    api.setGridOption(
      'rowHeight',
      density === 'compact' ? COMPACT_ROW_HEIGHT : undefined,
    );
    api.resetRowHeights();
  }

  // ---- column chooser ----

  toggleChooser(event: Event): void {
    event.stopPropagation();
    if (!this.chooserOpen()) this.refreshChooser();
    this.chooserOpen.update((open) => !open);
  }

  closeChooser(): void {
    this.chooserOpen.set(false);
  }

  toggleMore(event: Event): void {
    event.stopPropagation();
    const opening = !this.moreOpen();
    this.moreOpen.set(opening);
    // Menu pattern: opening moves focus to the first available item.
    if (opening) setTimeout(() => this.menuItems()[0]?.focus());
  }

  /** Closes the More menu; `restoreFocus` returns focus to its ⋯ trigger. */
  closeMore(restoreFocus = false): void {
    if (!this.moreOpen()) return;
    this.moreOpen.set(false);
    if (restoreFocus)
      this.host.nativeElement
        .querySelector<HTMLElement>('[data-testid="results-grid-more"]')
        ?.focus();
  }

  /** Arrow keys, Home and End move between the menu's enabled items; Tab closes it. */
  onMenuKeydown(event: KeyboardEvent): void {
    if (
      !this.moreOpen() ||
      !(event.target instanceof Element) ||
      !event.target.closest('.dt-rg-menu')
    )
      return;
    const items = this.menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (current - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Tab':
        this.closeMore();
        return;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  private menuItems(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        '.dt-rg-menu button:not(:disabled)',
      ),
    );
  }

  onDocumentClick(event: Event): void {
    const target = event.target;
    if (
      this.moreOpen() &&
      !(target instanceof Element && target.closest('.dt-rg-more'))
    )
      this.closeMore();
    if (!this.chooserOpen()) return;
    if (
      target instanceof Element &&
      target.closest('[data-testid="results-grid-chooser"]')
    ) {
      return;
    }
    this.closeChooser();
  }

  private refreshChooser(): void {
    const api = this.api;
    if (!api?.getAllGridColumns) return;
    const ids = this.chooserIds();
    this.chooserColumns.set(
      api
        .getAllGridColumns()
        .filter((c) => ids.has(c.getColId()))
        .map((c) => {
          const def = c.getColDef();
          const tip = def.headerTooltip;
          const name = def.headerName ?? c.getColId();
          return {
            colId: c.getColId(),
            name,
            title: typeof tip === 'string' ? tip : name,
            visible: c.isVisible(),
            pinned: !!c.getPinned(),
          };
        }),
    );
  }

  setColumnVisible(colId: string, visible: boolean): void {
    this.api?.setColumnsVisible([colId], visible);
  }

  showAllColumns(): void {
    this.api?.setColumnsVisible(
      this.chooserColumns().map((c) => c.colId),
      true,
    );
  }

  togglePinned(colId: string): void {
    const col = this.chooserColumns().find((c) => c.colId === colId);
    this.api?.setColumnsPinned([colId], col?.pinned ? null : 'left');
  }

  /** Moves a column one place up (-1) or down (+1) among the chooser's columns. */
  moveColumn(colId: string, step: -1 | 1): void {
    const api = this.api;
    const list = this.chooserColumns();
    const at = list.findIndex((c) => c.colId === colId);
    const neighbour = list[at + step];
    if (!api || at < 0 || !neighbour) return;
    const toIndex = api
      .getAllGridColumns()
      .findIndex((c) => c.getColId() === neighbour.colId);
    if (toIndex >= 0) api.moveColumns([colId], toIndex);
  }

  autosizeAll(): void {
    this.fitColumns(true);
  }

  private fitColumns(remember: boolean): void {
    const api = this.api;
    const scope = this.layoutScope;
    if (!api || !scope) return;
    clearTimeout(this.autosizeTimer);
    const operation = { scope, remember };
    this.autosizeOperation.set(operation);
    api.autoSizeAllColumns();
    // Retain the button's delayed fit save, but never sample a different result
    // when it runs. AG may emit no completion when nothing can be measured, so
    // both Reset and Autosize intent also expire here without needing an event.
    this.autosizeTimer = setTimeout(() => {
      if (this.autosizeOperation() === operation)
        this.autosizeOperation.set(undefined);
      if (!remember || this.layoutScope !== scope || this.api !== api) return;
      this.layoutTouched.set(true);
      this.saveLayout();
    }, 600);
  }

  onChartCreated(event: ChartCreatedEvent<GridRow>): void {
    this.chartIds.add(event.chartId);
  }

  private destroyCharts(): void {
    if (this.api?.isDestroyed?.()) {
      this.chartIds.clear();
      this.chartRangeReady.set(false);
      return;
    }
    for (const id of this.chartIds) this.api?.getChartRef?.(id)?.destroyChart();
    this.chartIds.clear();
    if (this.enterprise()) this.api?.clearCellSelection?.();
    this.chartRangeReady.set(false);
  }

  updateChartRange(): void {
    if (!this.enterprise()) {
      this.chartRangeReady.set(false);
      return;
    }
    const ranges = this.api?.getCellRanges?.() ?? [];
    const measures = new Set(
      this.analytics()
        .columns.filter((c) => c.chartDataType === 'series')
        .map((c) => c.colId),
    );
    this.chartRangeReady.set(
      ranges.length === 1 &&
        ranges[0].columns.some((c) => measures.has(c.getColId())),
    );
  }

  chartSelectedRange(): void {
    this.updateChartRange();
    if (!this.enterprise() || !this.chartRangeReady()) return;
    const range = this.api?.getCellRanges?.()?.[0];
    if (!range) return;
    this.api?.createRangeChart({
      chartType: 'groupedColumn',
      cellRange: {
        rowStartIndex: range.startRow?.rowIndex ?? null,
        rowEndIndex: range.endRow?.rowIndex ?? null,
        columns: range.columns.map((c) => c.getColId()),
      },
    });
  }

  readonly clipboardCell = rawResultCell;

  // ---- export and copy ----

  /** The data columns on screen, in screen order (not the row-number or checkbox column, not a hidden one). */
  private exportColumnIds(): string[] | undefined {
    const ids = new Set(this.dataColumnIds());
    return this.api
      ?.getAllDisplayedColumns?.()
      .map((c) => c.getColId())
      .filter((id) => ids.has(id));
  }

  exportCsv(): void {
    const api = this.api;
    if (!api) return;
    const columnKeys = this.exportColumnIds();
    const onlySelected = this.selectedCount() > 0;
    api.exportDataAsCsv({
      fileName: `${this.exportName()}.csv`,
      ...(columnKeys ? { columnKeys } : {}),
      ...(onlySelected ? { onlySelected: true } : {}),
      // The cell's own text (not the grouped or localized display text), so a spreadsheet gets the number.
      skipRowGroups: true,
      shouldRowBeSkipped: skipResultSummaryRow,
      processCellCallback: this.clipboardCell,
    });
  }

  /** The selected rows as tab-separated text with a header line, in screen order; undefined when none is selected. */
  selectionAsTsv(): { text: string; rows: number } | undefined {
    const api = this.api;
    const nodes = api?.getSelectedNodes?.() ?? [];
    const columns = api?.getAllDisplayedColumns?.() ?? [];
    const ids = new Set(this.dataColumnIds());
    const dataColumns = columns.filter((c) => ids.has(c.getColId()));
    const shownNodes = nodes
      .filter(
        (n) =>
          !n.group &&
          !n.footer &&
          !!n.data &&
          n.rowIndex !== null &&
          n.rowIndex !== undefined,
      )
      .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
    if (!shownNodes.length || !dataColumns.length) return undefined;
    const text = toTsv(
      dataColumns.map((c) => c.getColDef().headerName ?? c.getColId()),
      shownNodes.map((n) =>
        dataColumns.map(
          (c) =>
            (n.data as GridRow | undefined)?.[
              c.getColDef().field ?? c.getColId()
            ],
        ),
      ),
    );
    return { text, rows: shownNodes.length };
  }

  async copySelected(): Promise<void> {
    const selection = this.selectionAsTsv();
    if (!selection) {
      this.say('Copy: select rows with their checkboxes first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(selection.text);
      this.say(
        `Copied ${selection.rows} ${selection.rows === 1 ? 'row' : 'rows'} to the clipboard.`,
      );
    } catch {
      // Never the text, never the reason string (it could quote it): only the named failure.
      this.say(
        'Copy failed: the browser did not allow clipboard access. Use Export CSV instead.',
      );
    }
  }

  private say(message: string): void {
    this.status.set(message);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set(''), STATUS_MS);
  }

  exportExcel(): void {
    if (this.enterprise()) {
      this.api?.exportDataAsExcel({
        fileName: `${this.exportName()}.xlsx`,
        columnKeys: this.exportColumnIds(),
        skipRowGroups: true,
        shouldRowBeSkipped: skipResultSummaryRow,
        processCellCallback: this.clipboardCell,
      });
    }
  }
}

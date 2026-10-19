import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
} as const;
/** Row height of the compact density; the comfortable density is the theme's own. */
const COMPACT_ROW_HEIGHT = 28;
/**
 * Height of the floating-filter row under the column headers. AG Grid's own default is the (tall) header height; the
 * inputs stay usable at 40px (the control itself is 28px) and the row, which sits before the first result row, costs
 * 24px less of the fold.
 */
export const FLOATING_FILTERS_HEIGHT = 40;
const SAVE_DELAY_MS = 300;
const STATUS_MS = 5000;

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
    '(keydown.escape)': 'closeChooser()',
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
            data-testid="results-grid-columns-button"
            aria-haspopup="true"
            [attr.aria-expanded]="chooserOpen()"
            (click)="toggleChooser($event)"
          >
            Columns
          </button>
          <button
            type="button"
            class="dt-rg-button"
            data-testid="results-grid-autosize"
            title="Fit every column to its content"
            (click)="autosizeAll()"
          >
            Autosize
          </button>
          <button
            type="button"
            class="dt-rg-button"
            data-testid="results-grid-density"
            [attr.aria-pressed]="density() === 'compact'"
            [title]="
              density() === 'compact'
                ? 'Compact rows (press for comfortable)'
                : 'Comfortable rows (press for compact)'
            "
            (click)="toggleDensity()"
          >
            {{ density() === 'compact' ? 'Compact' : 'Comfortable' }}
          </button>
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
          <button
            type="button"
            class="dt-rg-button"
            data-testid="results-grid-copy"
            title="Copy the selected rows, with a header line, as tab-separated text"
            [disabled]="selectedCount() === 0"
            (click)="copySelected()"
          >
            Copy selected
          </button>
          @if (enterprise()) {
            <button
              type="button"
              class="dt-rg-button"
              data-testid="results-grid-export-excel"
              (click)="exportExcel()"
            >
              Excel
            </button>
          }
        </div>
        <span
          class="dt-rg-status"
          role="status"
          aria-live="polite"
          data-testid="results-grid-status"
          >{{ status() }}</span
        >
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
        style="height: 100%; width: 100%"
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
        [enableCellTextSelection]="true"
        [columnHoverHighlight]="true"
        [tooltipShowDelay]="600"
        [suppressMenuHide]="true"
        [sideBar]="enterprise() ? sideBar : undefined"
        [statusBar]="enterprise() ? statusBar : undefined"
        [rowGroupPanelShow]="enterprise() ? 'onlyWhenGrouping' : undefined"
        [cellSelection]="enterprise() ? true : undefined"
        [enableCharts]="enterprise()"
        (gridReady)="onGridReady($event)"
        (rowClicked)="rowClicked.emit($event)"
        (selectionChanged)="onSelectionChanged($event)"
        (cellFocused)="cellFocused.emit($event)"
        (modelUpdated)="onModelUpdated()"
        (newColumnsLoaded)="onNewColumnsLoaded()"
        (columnMoved)="onLayoutChanged()"
        (columnVisible)="onLayoutChanged()"
        (columnPinned)="onLayoutChanged()"
        (sortChanged)="onLayoutChanged()"
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
      color: var(--ion-color-medium, #666);
      flex: 1 1 auto;
      font-size: 0.8rem;
    }
    .dt-rg-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      min-width: 0;
    }
    .dt-rg-status {
      color: var(--ion-color-medium, #666);
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
    .dt-rg-host {
      flex: 1 1 auto;
      min-height: 0;
    }
    sneat-datatug-results-grid .dt-rg-null {
      color: var(--ion-color-medium, #888);
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
      color: var(--ion-color-medium, #888);
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
  readonly sideBar = ENTERPRISE_SIDE_BAR;
  readonly statusBar = ENTERPRISE_STATUS_BAR;
  readonly quickFilter = signal('');
  /** True once the enterprise modules were registered with a license key. */
  readonly enterprise = agGridEnterpriseEnabled;

  readonly density = signal<GridDensity>('comfortable');
  readonly chooserOpen = signal(false);
  readonly chooserColumns = signal<ChooserColumn[]>([]);
  readonly selectedCount = signal(0);
  /** A short named message about the last copy/export action (never a row value). */
  readonly status = signal('');

  private api?: GridApi<GridRow>;
  private readonly shown = signal<number | undefined>(undefined);
  private readonly destroyRef = inject(DestroyRef);
  private saveTimer?: ReturnType<typeof setTimeout>;
  private statusTimer?: ReturnType<typeof setTimeout>;
  /** Layout events are not saved before this time (the grid's own events while a layout is applied). */
  private holdUntil = 0;
  /** True once the person (or a restored layout) set the layout: only then are widths/order/sort stored. */
  private layoutTouched = false;

  readonly defs = computed<ColDef<GridRow>[]>(() => [
    ...(this.showRowNumbers() ? [ROW_NUMBER_COLUMN] : []),
    ...this.columnDefs(),
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
    ...(this.enterprise()
      ? { enableRowGroup: true, enablePivot: true, enableValue: true }
      : {}),
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
        const stored = readGridState(key, signature, ids);
        this.density.set(stored?.density ?? 'comfortable');
        this.layoutTouched = !!stored?.cols;
        if (this.api) this.applyStoredLayout();
      });
    });
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.saveTimer);
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
    this.shown.set(api ? api.getDisplayedRowCount() : undefined);
    this.refreshSelectedCount();
  }

  onSelectionChanged(event: SelectionChangedEvent<GridRow>): void {
    this.refreshSelectedCount();
    this.selectionChanged.emit(event);
  }

  private refreshSelectedCount(): void {
    this.selectedCount.set(this.api?.getSelectedNodes?.().length ?? 0);
  }

  // ---- remembered layout ----

  private applyStoredLayout(): void {
    const api = this.api;
    if (!api) return;
    const stored = readGridState(
      this.stateKey(),
      this.signature(),
      this.dataColumnIds(),
    );
    this.setDensityOnGrid(stored?.density ?? this.density());
    if (!stored?.cols) return;
    this.hold(500);
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
    this.layoutTouched = true;
  }

  private hold(ms: number): void {
    this.holdUntil = Date.now() + ms;
  }

  onLayoutChanged(): void {
    this.refreshChooser();
    if (Date.now() < this.holdUntil) return;
    this.layoutTouched = true;
    this.scheduleSave();
  }

  onColumnResized(event: ColumnResizedEvent): void {
    // A fit to content (the first data, or the Autosize button, which saves by itself) is not a person's choice.
    if (!event.finished || event.source === 'autosizeColumns') return;
    this.onLayoutChanged();
  }

  private scheduleSave(delay = SAVE_DELAY_MS): void {
    if (!this.stateKey()) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveLayout(), delay);
  }

  private saveLayout(): void {
    const key = this.stateKey();
    const api = this.api;
    if (!key || !api) return;
    const ids = new Set(this.dataColumnIds());
    const cols: StoredColumnState[] = this.layoutTouched
      ? api
          .getColumnState()
          .filter((c) => ids.has(c.colId))
          .map((c) => ({
            colId: c.colId,
            hide: !!c.hide,
            ...(typeof c.width === 'number' ? { width: c.width } : {}),
            pinned:
              c.pinned === 'left' || c.pinned === 'right' ? c.pinned : null,
            sort: c.sort ?? null,
            sortIndex: c.sortIndex ?? null,
          }))
      : [];
    writeGridState(key, {
      v: GRID_STATE_VERSION,
      density: this.density(),
      ...(cols.length ? { sig: this.signature(), cols } : {}),
    });
  }

  resetColumns(): void {
    const api = this.api;
    if (!api) return;
    clearTimeout(this.saveTimer);
    this.hold(800);
    this.layoutTouched = false;
    // Forget the stored layout first: the grid's own reset events must not find it and apply it again.
    this.saveLayout();
    api.resetColumnState();
    api.autoSizeAllColumns();
    this.refreshChooser();
    this.say('Columns reset.');
  }

  // ---- density ----

  toggleDensity(): void {
    const next: GridDensity =
      this.density() === 'compact' ? 'comfortable' : 'compact';
    this.density.set(next);
    this.setDensityOnGrid(next);
    this.scheduleSave(0);
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

  onDocumentClick(event: Event): void {
    if (!this.chooserOpen()) return;
    const target = event.target;
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
    const api = this.api;
    if (!api) return;
    api.autoSizeAllColumns();
    this.layoutTouched = true;
    // The fit reports itself as a program's resize, so the layout is saved by this call, once the fit has finished.
    this.scheduleSave(600);
  }

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
    const onlySelected = (api.getSelectedNodes?.().length ?? 0) > 0;
    api.exportDataAsCsv({
      fileName: `${this.exportName()}.csv`,
      ...(columnKeys ? { columnKeys } : {}),
      ...(onlySelected ? { onlySelected: true } : {}),
      // The cell's own text (not the grouped or localized display text), so a spreadsheet gets the number.
      processCellCallback: (p) =>
        p.value === null || p.value === undefined ? '' : String(p.value),
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
      .filter((n) => n.rowIndex !== null && n.rowIndex !== undefined)
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
      // The method exists only while the enterprise modules are registered, so its type is not in the community API.
      (
        this.api as unknown as {
          exportDataAsExcel?: (params: { fileName: string }) => void;
        }
      )?.exportDataAsExcel?.({ fileName: `${this.exportName()}.xlsx` });
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AgGridReadyDirective,
  agGridEnterpriseEnabled,
} from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import type {
  CellFocusedEvent,
  ColDef,
  GridApi,
  GridOptions,
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
 * Community features, always on: sorting on every column, a filter per column kind (text, number, date) with
 * floating filters, resizable and movable columns, pinning and auto-size from the column menu, a row-number column,
 * type-aware cells (right-aligned numbers, locale dates, check marks for booleans, compact JSON, a dimmed `null`),
 * column widths fitted to the content within bounds, a quick filter box, CSV export, native text selection for copy,
 * keyboard navigation and row virtualization.
 *
 * Enterprise features, on only while `agGridEnterpriseEnabled()` is true (a license key was configured at build
 * time; otherwise none of their options is even passed to the grid): row grouping and aggregation, pivot, the side bar
 * tool panels, the status bar, range (cell) selection with clipboard copy, integrated charts and Excel export.
 *
 * Rows are objects keyed by column id whose cells are text or `null`; see `results-grid-columns.ts`.
 */
@Component({
  selector: 'sneat-datatug-results-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [AgGridAngular, AgGridReadyDirective],
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
        <button
          type="button"
          class="dt-rg-button"
          data-testid="results-grid-export-csv"
          (click)="exportCsv()"
        >
          CSV
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
        [rowSelection]="rowSelection()"
        [rowClassRules]="rowClassRules()"
        [loading]="loading()"
        [overlayNoRowsTemplate]="overlayNoRowsTemplate()"
        [quickFilterText]="quickFilter()"
        [autoSizeStrategy]="autoSize"
        [enableCellTextSelection]="true"
        [tooltipShowDelay]="600"
        [sideBar]="enterprise() ? sideBar : undefined"
        [statusBar]="enterprise() ? statusBar : undefined"
        [rowGroupPanelShow]="enterprise() ? 'onlyWhenGrouping' : undefined"
        [cellSelection]="enterprise() ? true : undefined"
        [enableCharts]="enterprise()"
        (gridReady)="onGridReady($event)"
        (rowClicked)="rowClicked.emit($event)"
        (selectionChanged)="selectionChanged.emit($event)"
        (cellFocused)="cellFocused.emit($event)"
        (modelUpdated)="onModelUpdated()"
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
      gap: 0.5rem;
      padding: 0 0 0.35rem;
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
    .dt-rg-button {
      background: transparent;
      border: 1px solid var(--ion-color-step-250, #c8c8c8);
      border-radius: 0.35rem;
      color: var(--ion-color-primary, inherit);
      cursor: pointer;
      padding: 0.25rem 0.6rem;
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
  `,
})
export class ResultsGridComponent {
  /** Columns, already built (usually from `resultColumnDef`); the row-number column is added here. */
  readonly columnDefs = input.required<readonly ColDef<GridRow>[]>();
  readonly rowData = input<GridRow[]>([]);
  readonly loading = input(false);
  readonly headerHeight = input<number | undefined>(undefined);
  readonly rowSelection =
    input<GridOptions<GridRow>['rowSelection']>(undefined);
  readonly rowClassRules = input<RowClassRules | undefined>(undefined);
  readonly overlayNoRowsTemplate = input(NO_ROWS);
  readonly showToolbar = input(true);
  readonly showRowNumbers = input(true);
  /** Base name of the exported files (`<name>.csv`). */
  readonly exportName = input('results');

  readonly rowClicked = output<RowClickedEvent<GridRow>>();
  readonly selectionChanged = output<SelectionChangedEvent<GridRow>>();
  readonly cellFocused = output<CellFocusedEvent<GridRow>>();

  readonly columnTypes = RESULTS_GRID_COLUMN_TYPES;
  readonly autoSize = { type: 'fitCellContents' } as const;
  readonly sideBar = ENTERPRISE_SIDE_BAR;
  readonly statusBar = ENTERPRISE_STATUS_BAR;
  readonly quickFilter = signal('');
  /** True once the enterprise modules were registered with a license key. */
  readonly enterprise = agGridEnterpriseEnabled;

  private api?: GridApi<GridRow>;
  private readonly shown = signal<number | undefined>(undefined);

  readonly defs = computed<ColDef<GridRow>[]>(() => [
    ...(this.showRowNumbers() ? [ROW_NUMBER_COLUMN] : []),
    ...this.columnDefs(),
  ]);

  readonly defaultColDef = computed<ColDef<GridRow>>(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    floatingFilter: true,
    ...(this.enterprise()
      ? { enableRowGroup: true, enablePivot: true, enableValue: true }
      : {}),
  }));

  readonly rowCountLabel = computed(() => {
    const total = this.rowData().length;
    const shown = this.shown() ?? total;
    return shown === total
      ? `${total} ${total === 1 ? 'row' : 'rows'}`
      : `${shown} of ${total} rows`;
  });

  onQuickFilter(event: Event): void {
    this.quickFilter.set((event.target as HTMLInputElement).value);
  }

  onGridReady(event: GridReadyEvent<GridRow>): void {
    this.api = event.api;
  }

  onModelUpdated(): void {
    const api = this.api;
    this.shown.set(api ? api.getDisplayedRowCount() : undefined);
  }

  exportCsv(): void {
    const columnKeys = this.api
      ?.getAllDisplayedColumns?.()
      .map((c) => c.getColId())
      // The row-number column is a screen aid, not data.
      .filter((id) => id !== ROW_NUMBER_COLUMN.colId);
    this.api?.exportDataAsCsv({
      fileName: `${this.exportName()}.csv`,
      ...(columnKeys ? { columnKeys } : {}),
    });
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

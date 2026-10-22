import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  configureAgGrid,
  ensureAgGrid,
  resetAgGridSetupForTests,
} from '@datatug/ag-grid';
import { AgGridAngular } from 'ag-grid-angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsGridComponent } from './results-grid.component';
import { resultColumnDef } from './results-grid-columns';
import {
  createGrid,
  ModuleRegistry,
  AllCommunityModule,
  type GridApi,
} from 'ag-grid-community';
import { RowGroupingModule } from 'ag-grid-enterprise';
import { restoreStorageSpies } from '../../restore-storage-spies.spec-helper';

afterEach(restoreStorageSpies);

/** A column as the grid's api hands it out. */
const col = (
  colId: string,
  extra: {
    headerName?: string;
    visible?: boolean;
    pinned?: 'left' | null;
  } = {},
) => ({
  getColId: () => colId,
  getColDef: () => ({
    field: colId,
    headerName: extra.headerName ?? colId.toUpperCase(),
    headerTooltip: `${colId} (type)`,
  }),
  isVisible: () => extra.visible ?? true,
  getPinned: () => extra.pinned ?? null,
});

const api = {
  exportDataAsCsv: vi.fn(),
  exportDataAsExcel: vi.fn(),
  getDisplayedRowCount: vi.fn(() => 1),
  forEachNodeAfterFilter: vi.fn((visit: (node: unknown) => void) =>
    visit({ data: { c0: '1' } }),
  ),
  getCellRanges: vi.fn((): unknown[] => []),
  createRangeChart: vi.fn(),
  getChartRef: vi.fn(),
  clearCellSelection: vi.fn(),
  getAllDisplayedColumns: vi.fn(() => [
    col('ag-Grid-SelectionColumn'),
    col('__row'),
    col('c0'),
  ]),
  getAllGridColumns: vi.fn(() => [col('__row'), col('c0'), col('c1')]),
  getSelectedNodes: vi.fn((): unknown[] => []),
  getColumnState: vi.fn(() => [
    { colId: '__row', width: 64 },
    {
      colId: 'c0',
      width: 120,
      hide: false,
      pinned: null,
      sort: 'asc',
      sortIndex: 0,
    },
  ]),
  applyColumnState: vi.fn(),
  resetColumnState: vi.fn(),
  autoSizeAllColumns: vi.fn(),
  setColumnsVisible: vi.fn(),
  setColumnsPinned: vi.fn(),
  moveColumns: vi.fn(),
  setGridOption: vi.fn(),
  resetRowHeights: vi.fn(),
};

/** The grid as the component drives it: its inputs are recorded, the real grid does not render in this environment. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- stands in for the grid's own element
  selector: 'ag-grid-angular',
  template: '<div data-testid="grid-stub"></div>',
})
class GridStubComponent {
  readonly columnDefs = input<unknown>();
  readonly columnTypes = input<unknown>();
  readonly rowData = input<unknown>();
  readonly defaultColDef = input<Record<string, unknown>>();
  readonly headerHeight = input<unknown>();
  readonly floatingFiltersHeight = input<unknown>();
  readonly rowSelection = input<unknown>();
  readonly selectionColumnDef = input<unknown>();
  readonly rowHeight = input<unknown>();
  readonly columnHoverHighlight = input<unknown>();
  readonly rowClassRules = input<unknown>();
  readonly loading = input<unknown>();
  readonly overlayNoRowsTemplate = input<unknown>();
  readonly quickFilterText = input<unknown>();
  readonly autoSizeStrategy = input<unknown>();
  readonly enableCellTextSelection = input<unknown>();
  readonly tooltipShowDelay = input<unknown>();
  readonly suppressMenuHide = input<unknown>();
  readonly sideBar = input<unknown>();
  readonly statusBar = input<unknown>();
  readonly rowGroupPanelShow = input<unknown>();
  readonly suppressGroupChangesColumnVisibility = input<unknown>();
  readonly suppressDragLeaveHidesColumns = input<unknown>();
  readonly cellSelection = input<unknown>();
  readonly enableCharts = input<unknown>();
  readonly processCellForClipboard = input<unknown>();
  readonly excelStyles = input<unknown>();
  readonly chartCreated = output<unknown>();
  readonly cellSelectionChanged = output<unknown>();
  readonly gridReady = output<unknown>();
  readonly rowClicked = output<unknown>();
  readonly selectionChanged = output<unknown>();
  readonly cellFocused = output<unknown>();
  readonly modelUpdated = output<unknown>();
  readonly newColumnsLoaded = output<unknown>();
  readonly columnMoved = output<unknown>();
  readonly columnVisible = output<unknown>();
  readonly columnPinned = output<unknown>();
  readonly sortChanged = output<unknown>();
  readonly columnResized = output<unknown>();
}

async function mount(
  rows: Record<string, string | null>[] = [{ c0: '1' }, { c0: null }],
  stateKey?: string,
  columnCount = 1,
) {
  TestBed.overrideComponent(ResultsGridComponent, {
    remove: { imports: [AgGridAngular] },
    add: { imports: [GridStubComponent] },
  });
  const fixture = TestBed.createComponent(ResultsGridComponent);
  fixture.componentRef.setInput(
    'columnDefs',
    Array.from({ length: columnCount }, (_, i) =>
      resultColumnDef({ name: `N${i}`, type: 'integer' }, `c${i}`),
    ),
  );
  fixture.componentRef.setInput('rowData', rows);
  if (stateKey) fixture.componentRef.setInput('stateKey', stateKey);
  fixture.detectChanges();
  await ensureAgGrid();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const grid = fixture.debugElement.children
    .flatMap((c) => [c, ...c.children])
    .find((d) => d.componentInstance instanceof GridStubComponent)
    ?.componentInstance as GridStubComponent | undefined;
  return { fixture, el, grid, cmp: fixture.componentInstance };
}

describe('ResultsGridComponent', () => {
  beforeEach(() => {
    resetAgGridSetupForTests();
    vi.clearAllMocks();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    resetAgGridSetupForTests();
  });

  describe('community build (no license key)', () => {
    const community = {
      community: async () => ({ registerAgGridCommunity: () => undefined }),
      enterprise: async () => {
        throw new Error('the enterprise modules must not load without a key');
      },
    };

    it('passes the community features and none of the enterprise options', async () => {
      await ensureAgGrid(community);
      const { grid, cmp } = await mount();
      expect(grid).toBeDefined();
      expect(cmp.enterprise()).toBe(false);
      expect(grid?.sideBar()).toBeUndefined();
      expect(grid?.excelStyles()).toBeUndefined();
      expect(grid?.statusBar()).toBeUndefined();
      expect(grid?.rowGroupPanelShow()).toBeUndefined();
      expect(grid?.suppressGroupChangesColumnVisibility()).toBeUndefined();
      expect(grid?.suppressDragLeaveHidesColumns()).toBeUndefined();
      expect((cmp as ResultsGridComponent).enterprise()).toBe(false);
      expect(grid?.cellSelection()).toBeUndefined();
      expect(grid?.enableCharts()).toBe(false);
      const def = grid?.defaultColDef() ?? {};
      expect(def).toMatchObject({
        resizable: true,
        sortable: true,
        filter: true,
        floatingFilter: true,
      });
      expect(def).not.toHaveProperty('enableRowGroup');
      expect(def).not.toHaveProperty('enablePivot');
      // The column menu button and the sort indicator are reachable on every header, not only on hover.
      expect(grid?.suppressMenuHide()).toBe(true);
      expect(def).toMatchObject({ unSortIcon: true });
      expect(grid?.enableCellTextSelection()).toBe(true);
      // The floating-filter row sits before row 1: its height is a ratchet on the fold, not the grid's default.
      expect(grid?.floatingFiltersHeight()).toBe(40);
      expect(grid?.autoSizeStrategy()).toEqual({ type: 'fitCellContents' });
      const ids = (grid?.columnDefs() as { colId: string }[]).map(
        (c) => c.colId,
      );
      expect(ids).toEqual(['__row', 'c0']);
    });

    it('has no Excel button', async () => {
      await ensureAgGrid(community);
      const { el } = await mount();
      expect(
        el.querySelector('[data-testid="results-grid-export-excel"]'),
      ).toBeNull();
      expect(
        el.querySelector('[data-testid="results-grid-export-csv"]'),
      ).not.toBeNull();
    });

    it('exports CSV, never Excel', async () => {
      await ensureAgGrid(community);
      const { el, cmp, grid } = await mount();
      (grid as unknown as GridStubComponent).gridReady.emit({ api });
      (
        el.querySelector(
          '[data-testid="results-grid-export-csv"]',
        ) as HTMLElement
      ).click();
      expect(api.exportDataAsCsv).toHaveBeenCalledWith({
        fileName: 'results.csv',
        columnKeys: ['c0'],
        processCellCallback: expect.any(Function),
        skipRowGroups: true,
        shouldRowBeSkipped: expect.any(Function),
      });
      cmp.exportExcel();
      expect(api.exportDataAsExcel).not.toHaveBeenCalled();
    });

    it('feeds the quick filter box to the grid and counts the rows shown', async () => {
      await ensureAgGrid(community);
      const { fixture, el, grid, cmp } = await mount();
      expect(grid?.quickFilterText()).toBe('');
      expect(
        el.querySelector('[data-testid="results-grid-count"]')?.textContent,
      ).toContain('2 rows');
      const input = el.querySelector(
        '[data-testid="results-grid-quick-filter"]',
      ) as HTMLInputElement;
      input.value = 'abc';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(grid?.quickFilterText()).toBe('abc');
      (grid as unknown as GridStubComponent).gridReady.emit({ api });
      api.getDisplayedRowCount.mockReturnValue(5); // includes synthetic groups/footers
      api.forEachNodeAfterFilter.mockImplementation((visit) => {
        visit({ group: true });
        visit({ footer: true });
        visit({ data: { c0: '1' } });
      });
      (grid as unknown as GridStubComponent).modelUpdated.emit({});
      fixture.detectChanges();
      expect(cmp.rowCountLabel()).toBe('1 of 2 rows');
    });

    it('can hide the toolbar and the row numbers, and forwards the grid events', async () => {
      await ensureAgGrid(community);
      TestBed.overrideComponent(ResultsGridComponent, {
        remove: { imports: [AgGridAngular] },
        add: { imports: [GridStubComponent] },
      });
      const fixture = TestBed.createComponent(ResultsGridComponent);
      fixture.componentRef.setInput('columnDefs', []);
      fixture.componentRef.setInput('showToolbar', false);
      fixture.componentRef.setInput('showRowNumbers', false);
      fixture.detectChanges();
      await ensureAgGrid();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="results-grid-toolbar"]',
        ),
      ).toBeNull();
      expect(fixture.componentInstance.defs()).toEqual([]);
      const clicked = vi.fn();
      fixture.componentInstance.rowClicked.subscribe(clicked);
      const stub = fixture.debugElement.children
        .flatMap((c) => [c, ...c.children])
        .find((d) => d.componentInstance instanceof GridStubComponent)
        ?.componentInstance as GridStubComponent;
      stub.rowClicked.emit({ data: { c0: '1' } });
      expect(clicked).toHaveBeenCalledWith({ data: { c0: '1' } });
    });
  });

  describe('enterprise build (mocked license flag)', () => {
    it('switches the enterprise features on', async () => {
      configureAgGrid('test-license-key');
      const registered = vi.fn();
      await ensureAgGrid({
        community: async () => ({ registerAgGridCommunity: () => undefined }),
        enterprise: async () => ({ registerAgGridEnterprise: registered }),
      });
      expect(registered).toHaveBeenCalledOnce();
      const { grid, cmp, el } = await mount();
      expect(cmp.enterprise()).toBe(true);
      expect(grid?.sideBar()).toBeTruthy();
      expect(grid?.statusBar()).toBeTruthy();
      expect(grid?.rowGroupPanelShow()).toBe('always');
      expect(grid?.suppressGroupChangesColumnVisibility()).toBe(true);
      expect(grid?.suppressDragLeaveHidesColumns()).toBe(true);
      expect(
        (el.querySelector('ag-grid-angular') as HTMLElement).style.height,
      ).toContain('520px');
      expect(grid?.cellSelection()).toBe(true);
      expect(grid?.enableCharts()).toBe(true);
      expect(grid?.defaultColDef()).toMatchObject({
        enableRowGroup: true,
        enablePivot: true,
      });
      (grid as unknown as GridStubComponent).gridReady.emit({ api });
      (
        el.querySelector(
          '[data-testid="results-grid-export-excel"]',
        ) as HTMLElement
      ).click();
      expect(api.exportDataAsExcel).toHaveBeenCalledWith({
        fileName: 'results.xlsx',
        columnKeys: ['c0'],
        skipRowGroups: true,
        shouldRowBeSkipped: expect.any(Function),
        processCellCallback: expect.any(Function),
      });
    });
    it('charts only an explicit eligible range, retains the chart on focus/filter updates and destroys it on snapshot replacement', async () => {
      configureAgGrid('test-only');
      await ensureAgGrid({
        community: async () => ({ registerAgGridCommunity: () => undefined }),
        enterprise: async () => ({ registerAgGridEnterprise: () => undefined }),
      });
      const { fixture, grid, cmp, el } = await mount();
      const key = {};
      fixture.componentRef.setInput('snapshotKey', key);
      fixture.componentRef.setInput(
        'analyticsScope',
        'Analytics use 2 loaded rows on page 1',
      );
      fixture.detectChanges();
      (grid as GridStubComponent).gridReady.emit({ api });
      expect(grid?.enableCellTextSelection()).toBe(false);
      expect(grid?.excelStyles()).toEqual([{ id: 'cell', dataType: 'String' }]);
      expect(el.classList.contains('dt-rg-enterprise')).toBe(true);
      cmp.chartSelectedRange();
      expect(api.createRangeChart).not.toHaveBeenCalled();
      api.getCellRanges.mockReturnValue([
        {
          columns: [col('c0')],
          startRow: { rowIndex: 0 },
          endRow: { rowIndex: 1 },
        },
      ]);
      (grid as GridStubComponent).cellSelectionChanged.emit({});
      fixture.detectChanges();
      const button = el.querySelector(
        '[data-testid="results-grid-chart"]',
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      button.click();
      expect(api.createRangeChart).toHaveBeenCalledWith({
        chartType: 'groupedColumn',
        cellRange: { rowStartIndex: 0, rowEndIndex: 1, columns: ['c0'] },
      });
      const destroyChart = vi.fn();
      api.getChartRef.mockReturnValue({ destroyChart });
      (grid as GridStubComponent).chartCreated.emit({ chartId: 'chart-1' });
      fixture.componentRef.setInput('rowData', [{ c0: '1' }, { c0: null }]);
      cmp.onQuickFilter({ target: { value: '1' } } as unknown as Event);
      fixture.detectChanges();
      expect(destroyChart).not.toHaveBeenCalled();
      fixture.componentRef.setInput('snapshotKey', {});
      fixture.detectChanges();
      expect(destroyChart).toHaveBeenCalledOnce();
      expect(el.textContent).toContain(
        'Numeric aggregations and charts are approximate',
      );
    });
  });
});

describe('ResultsGridComponent layout, selection and chooser', () => {
  const community = {
    community: async () => ({ registerAgGridCommunity: () => undefined }),
    enterprise: async () => {
      throw new Error('the enterprise modules must not load without a key');
    },
  };
  const KEY = 'datatug.grid.v1:demo:q1:query';
  const ready = async (stateKey?: string, columnCount = 1) => {
    await ensureAgGrid(community);
    const m = await mount(undefined, stateKey, columnCount);
    (m.grid as unknown as GridStubComponent).gridReady.emit({ api });
    m.fixture.detectChanges();
    return m;
  };
  const click = (el: HTMLElement, testId: string) =>
    (el.querySelector(`[data-testid="${testId}"]`) as HTMLElement).click();

  beforeEach(() => {
    resetAgGridSetupForTests();
    vi.clearAllMocks();
    localStorage.clear();
    api.getSelectedNodes.mockReturnValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
    resetAgGridSetupForTests();
    localStorage.clear();
  });

  it('turns on community multi-row checkbox selection, where a click selects nothing', async () => {
    const { grid } = await ready();
    expect(grid?.rowSelection()).toMatchObject({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false,
    });
    expect(grid?.columnHoverHighlight()).toBe(true);
  });

  it('exports all rows with no selection and only the selected rows with one', async () => {
    const { el, fixture } = await ready();
    click(el, 'results-grid-export-csv');
    expect(api.exportDataAsCsv.mock.calls[0][0]).not.toHaveProperty(
      'onlySelected',
    );
    api.getSelectedNodes.mockReturnValue([{ rowIndex: 0, data: { c0: '1' } }]);
    fixture.componentInstance.onSelectionChanged({} as never);
    fixture.detectChanges();
    expect(
      el.querySelector('[data-testid="results-grid-export-csv"]')?.textContent,
    ).toContain('CSV selected');
    expect(
      el.querySelector('[data-testid="results-grid-count"]')?.textContent,
    ).toContain('1 selected');
    click(el, 'results-grid-export-csv');
    const params = api.exportDataAsCsv.mock.calls[1][0];
    expect(params).toMatchObject({ onlySelected: true, columnKeys: ['c0'] });
    // The cell text is exported as it is: no grouping, a NULL as an empty field.
    expect(params.processCellCallback({ value: '1234567' })).toBe('1234567');
    expect(params.processCellCallback({ value: null })).toBe('');
    expect(
      params.processCellCallback({
        value: 2.5,
        column: col('c0'),
        node: { data: { c0: '2.50' } },
      }),
    ).toBe('2.50');
  });

  it('copies the selected rows as tab-separated text with a header, in screen order', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, fixture, cmp } = await ready();
    expect(
      (
        el.querySelector(
          '[data-testid="results-grid-copy"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    api.getSelectedNodes.mockReturnValue([
      { rowIndex: 2, group: true },
      { rowIndex: 3, footer: true, data: { c0: 'not a source row' } },
      { rowIndex: 1, data: { c0: 'a\tb' } },
      { rowIndex: 0, data: { c0: null } },
      { rowIndex: null, data: { c0: 'hidden by a filter' } },
    ]);
    cmp.onSelectionChanged({} as never);
    fixture.detectChanges();
    await cmp.copySelected();
    expect(writeText).toHaveBeenCalledWith('C0\n\n"a\tb"');
    fixture.detectChanges();
    expect(
      el.querySelector('[data-testid="results-grid-status"]')?.textContent,
    ).toContain('Copied 2 rows');
  });

  it('names a copy failure and never puts the text in the message', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('secret-cell-text');
        }),
      },
    });
    const { el, fixture, cmp } = await ready();
    api.getSelectedNodes.mockReturnValue([
      { rowIndex: 0, data: { c0: 'secret-cell-text' } },
    ]);
    await cmp.copySelected();
    fixture.detectChanges();
    const status =
      el.querySelector('[data-testid="results-grid-status"]')?.textContent ??
      '';
    expect(status).toContain('Copy failed');
    expect(status).not.toContain('secret');
    vi.stubGlobal('navigator', {});
    await cmp.copySelected();
    expect(cmp.status()).toContain('Copy failed');
  });

  it('asks for a selection when copying with none', async () => {
    const { cmp } = await ready();
    await cmp.copySelected();
    expect(cmp.status()).toContain('select rows');
  });

  it('autosizes all columns and remembers the result', async () => {
    const { el, cmp } = await ready(KEY);
    vi.useFakeTimers();
    click(el, 'results-grid-autosize');
    expect(api.autoSizeAllColumns).toHaveBeenCalled();
    cmp.onColumnResized({ finished: true, source: 'autosizeColumns' } as never);
    vi.advanceTimersByTime(700);
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(saved.cols.map((c: { colId: string }) => c.colId)).toEqual(['c0']);
  });

  it('runs the More menu by keyboard and returns focus to its trigger', async () => {
    const { el, fixture } = await ready(KEY);
    document.body.appendChild(el);
    try {
      vi.useFakeTimers();
      const more = el.querySelector<HTMLElement>(
        '[data-testid="results-grid-more"]',
      );
      more?.click();
      fixture.detectChanges();
      vi.advanceTimersByTime(1);
      const item = (id: string) =>
        el.querySelector<HTMLElement>(`[data-testid="results-grid-${id}"]`);
      expect(more?.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(item('columns-button'));
      const menu = el.querySelector<HTMLElement>(
        '[data-testid="results-grid-more-menu"]',
      );
      const key = (k: string) =>
        menu?.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true }),
        );
      key('ArrowDown');
      expect(document.activeElement).toBe(item('autosize'));
      key('End');
      key('ArrowDown');
      expect(document.activeElement).toBe(item('columns-button'));
      key('ArrowUp');
      expect(document.activeElement).not.toBe(item('columns-button'));
      item('density')?.click();
      fixture.detectChanges();
      expect(more?.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(more);
      expect(item('density')?.getAttribute('aria-checked')).toBe('true');
      expect(item('density')?.hasAttribute('aria-pressed')).toBe(false);
    } finally {
      el.remove();
    }
  });

  it('toggles the density, shows it, and remembers it', async () => {
    const { el, grid, fixture } = await ready(KEY);
    vi.useFakeTimers();
    expect(grid?.rowHeight()).toBeUndefined();
    click(el, 'results-grid-density');
    fixture.detectChanges();
    expect(grid?.rowHeight()).toBe(28);
    expect(api.setGridOption).toHaveBeenCalledWith('rowHeight', 28);
    expect(api.resetRowHeights).toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(saved.density).toBe('compact');
    // Density alone does not freeze the fitted widths.
    expect(saved.cols).toBeUndefined();
    click(el, 'results-grid-density');
    fixture.detectChanges();
    expect(grid?.rowHeight()).toBeUndefined();
  });

  it('starts compact when the remembered state says so', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, density: 'compact' }));
    const { grid, cmp } = await ready(KEY);
    expect(cmp.density()).toBe('compact');
    expect(grid?.rowHeight()).toBe(28);
    // No remembered widths: the columns are fitted to content.
    expect(grid?.autoSizeStrategy()).toEqual({ type: 'fitCellContents' });
  });

  it('remembers a moved or resized column and restores it on the next open', async () => {
    const first = await ready(KEY);
    vi.useFakeTimers();
    (first.grid as unknown as GridStubComponent).columnMoved.emit({});
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    const text = localStorage.getItem(KEY) ?? '';
    expect(JSON.parse(text)).toMatchObject({ v: 1, sig: expect.any(String) });
    expect(text).not.toMatch(/[0-9]+ rows|Filter/);
    TestBed.resetTestingModule();
    resetAgGridSetupForTests();
    vi.clearAllMocks();
    const second = await ready(KEY);
    expect(api.applyColumnState).toHaveBeenCalledWith({
      state: [
        expect.objectContaining({ colId: 'c0', width: 120, sort: 'asc' }),
      ],
      applyOrder: true,
    });
    // The remembered widths replace the fit to content.
    expect(second.grid?.autoSizeStrategy()).toBeUndefined();
  });

  it("does not save a fit to content or the grid's own events while a layout is applied", async () => {
    const { grid } = await ready(KEY);
    vi.useFakeTimers();
    (grid as unknown as GridStubComponent).columnResized.emit({
      finished: true,
      source: 'autosizeColumns',
    });
    (grid as unknown as GridStubComponent).columnResized.emit({
      finished: false,
      source: 'uiColumnResized',
    });
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(KEY)).toBeNull();
    (grid as unknown as GridStubComponent).columnResized.emit({
      finished: true,
      source: 'uiColumnResized',
    });
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  describe('completed layout durability', () => {
    const originalState =
      api.getColumnState.getMockImplementation() ?? (() => []);
    const originalApply = api.applyColumnState.getMockImplementation();
    let width: number;
    let hidden: boolean;
    const stored = (key = KEY) =>
      JSON.parse(localStorage.getItem(key) ?? 'null');
    const resize = (cmp: ResultsGridComponent, source = 'uiColumnResized') =>
      cmp.onColumnResized({ finished: true, source } as never);
    const seed = async () => {
      const first = await ready(KEY);
      vi.useFakeTimers();
      first.cmp.onLayoutChanged();
      vi.advanceTimersByTime(400);
      expect(stored().cols[0].width).toBe(200);
      first.fixture.destroy();
      vi.useRealTimers();
      TestBed.resetTestingModule();
      resetAgGridSetupForTests();
    };
    beforeEach(() => {
      width = 200;
      hidden = false;
      api.getColumnState.mockImplementation(() => [
        {
          colId: 'c0',
          width,
          hide: hidden,
          pinned: null,
          sort: 'desc',
          sortIndex: 0,
        },
      ]);
      api.applyColumnState.mockImplementation(
        (params: { state: { width?: number; hide?: boolean }[] }) => {
          width = params.state[0].width ?? width;
          hidden = params.state[0].hide ?? false;
        },
      );
    });
    afterEach(() => {
      api.getColumnState.mockImplementation(originalState);
      api.applyColumnState.mockReset();
      if (originalApply) api.applyColumnState.mockImplementation(originalApply);
    });

    it('reopens a completed resize even when destroyed before the old debounce', async () => {
      await seed();
      const second = await ready(KEY);
      width = 220;
      resize(second.cmp);
      second.fixture.destroy();
      expect(stored().cols[0]).toMatchObject({ width: 220, sort: 'desc' });
      TestBed.resetTestingModule();
      resetAgGridSetupForTests();
      width = 90;
      await ready(KEY);
      expect(width).toBe(220);
    });

    it('does not store unfinished resize or move drag events', async () => {
      const { cmp, grid } = await ready(KEY);
      const write = vi.spyOn(localStorage, 'setItem');
      try {
        width = 220;
        cmp.onColumnResized({
          finished: false,
          source: 'uiColumnResized',
        } as never);
        (grid as unknown as GridStubComponent).columnMoved.emit({
          finished: false,
          source: 'uiColumnMoved',
        });
        expect(write).not.toHaveBeenCalled();
        (grid as unknown as GridStubComponent).columnMoved.emit({
          finished: true,
          source: 'uiColumnMoved',
        });
        expect(stored().cols[0].width).toBe(220);
        expect(write).toHaveBeenCalledTimes(1);
      } finally {
        write.mockRestore();
      }
    });

    it('does not replay an earlier width over a completed resize on new columns', async () => {
      await seed();
      const { cmp } = await ready(KEY);
      vi.useFakeTimers();
      vi.advanceTimersByTime(501);
      width = 220;
      resize(cmp);
      // A column-definition refresh dispatches its own resize before the load.
      width = 200;
      resize(cmp, 'gridOptionsChanged');
      cmp.onNewColumnsLoaded();
      expect(width).toBe(220);
      vi.advanceTimersByTime(400);
      expect(stored().cols[0].width).toBe(220);
    });

    it('ignores deferred unchanged API restoration but accepts an immediate changed API action', async () => {
      await seed();
      const { cmp, grid } = await ready(KEY);
      vi.useFakeTimers();
      const write = vi.spyOn(localStorage, 'setItem');
      try {
        setTimeout(() => resize(cmp, 'api'), 0);
        vi.advanceTimersByTime(1);
        expect(write).not.toHaveBeenCalled();
        hidden = true;
        (grid as unknown as GridStubComponent).columnVisible.emit({
          source: 'api',
        });
        expect(stored().cols[0].hide).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);
        hidden = false;
        (grid as unknown as GridStubComponent).columnVisible.emit({
          source: 'api',
        });
        expect(stored().cols[0].hide).toBe(false);
        expect(write).toHaveBeenCalledTimes(2);
      } finally {
        write.mockRestore();
      }
    });

    it('flushes a captured density change only to its original scope', async () => {
      const { cmp, fixture } = await ready(KEY);
      vi.useFakeTimers();
      cmp.toggleDensity();
      fixture.componentRef.setInput('stateKey', `${KEY}:other`);
      fixture.detectChanges();
      vi.advanceTimersByTime(400);
      expect(stored()).toMatchObject({ density: 'compact' });
      expect(stored(`${KEY}:other`)).toBeNull();
    });

    it('keeps the initial content fit implicit but records completion of explicit Autosize', async () => {
      const { cmp } = await ready(KEY);
      vi.useFakeTimers();
      resize(cmp, 'autosizeColumns');
      expect(stored()).toBeNull();
      cmp.autosizeAll();
      width = 90;
      resize(cmp, 'autosizeColumns');
      vi.advanceTimersByTime(700);
      expect(stored().cols[0].width).toBe(90);
    });

    it('cancels the previous scope Autosize timer and ignores an implicit completion', async () => {
      const { cmp, fixture } = await ready(KEY);
      vi.useFakeTimers();
      cmp.autosizeAll();
      fixture.componentRef.setInput('stateKey', `${KEY}:other`);
      fixture.detectChanges();
      width = 90;
      resize(cmp, 'autosizeColumns');
      vi.advanceTimersByTime(700);
      expect(stored()).toBeNull();
      expect(stored(`${KEY}:other`)).toBeNull();
    });

    it('accepts a changed API resize after scope change when Autosize emitted no completion', async () => {
      const { cmp, fixture } = await ready(KEY);
      vi.useFakeTimers();
      cmp.autosizeAll(); // AG emits no completion when no columns can be measured.
      fixture.componentRef.setInput('stateKey', `${KEY}:other`);
      fixture.detectChanges();
      width = 230;
      resize(cmp, 'api');
      expect(stored(`${KEY}:other`).cols[0].width).toBe(230);
      expect(stored()).toBeNull();
    });

    it('expires Reset intent even when its content fit emitted no completion', async () => {
      const { cmp } = await ready(KEY);
      vi.useFakeTimers();
      cmp.resetColumns();
      vi.advanceTimersByTime(601);
      width = 230;
      resize(cmp, 'api');
      expect(stored().cols[0].width).toBe(230);
    });
  });

  it('keeps native asynchronous Reset replay implicit', async () => {
    ModuleRegistry.registerModules([AllCommunityModule]);
    const { cmp, fixture } = await ready(KEY);
    const host = document.createElement('div');
    document.body.append(host);
    let callbacks = 0;
    const native = createGrid(host, {
      theme: 'legacy',
      columnDefs: cmp.defs(),
      rowData: cmp.rowData(),
      defaultColDef: cmp.defaultColDef(),
      onColumnVisible: (event) => {
        callbacks++;
        cmp.onLayoutChanged(event);
      },
      onColumnResized: (event) => {
        callbacks++;
        cmp.onColumnResized(event);
      },
    });
    try {
      cmp.onGridReady({ api: native } as never);
      native.setColumnWidths([{ key: 'c0', newWidth: 220 }]);
      native.setColumnsVisible(['c0'], false);
      await vi.waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(KEY) ?? '{}').cols?.[0],
        ).toMatchObject({ width: 220, hide: true }),
      );
      const before = callbacks;
      cmp.resetColumns();
      // Native grid callbacks are deferred, just like AgGridAngular's global
      // listener. A synchronous mock here would test a different ordering.
      expect(callbacks).toBe(before);
      await vi.waitFor(() => expect(callbacks).toBeGreaterThan(before));
      expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
        v: 1,
        density: 'comfortable',
      });
      expect(
        native.getColumnState().find((c) => c.colId === 'c0'),
      ).toMatchObject({ hide: false });
    } finally {
      native.destroy();
      fixture.destroy();
      host.remove();
    }
  });

  it('ignores a remembered layout of other columns', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        density: 'comfortable',
        sig: 'deadbeef',
        cols: [{ colId: 'c0' }],
      }),
    );
    const { grid } = await ready(KEY);
    expect(api.applyColumnState).not.toHaveBeenCalled();
    expect(grid?.autoSizeStrategy()).toEqual({ type: 'fitCellContents' });
  });

  it('stores nothing without a key, and survives a storage that throws', async () => {
    const none = await ready();
    vi.useFakeTimers();
    (none.grid as unknown as GridStubComponent).columnMoved.emit({});
    vi.advanceTimersByTime(1000);
    expect(localStorage.length).toBe(0);
    vi.useRealTimers();
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, length: 0 });
    TestBed.resetTestingModule();
    resetAgGridSetupForTests();
    const blocked = await ready(KEY);
    vi.useFakeTimers();
    (blocked.grid as unknown as GridStubComponent).sortChanged.emit({});
    vi.advanceTimersByTime(1000);
    expect(blocked.cmp.density()).toBe('comfortable');
  });

  it('resets the columns: forgets the layout, keeps the density, fits again', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        density: 'compact',
        sig: 'x',
        cols: [{ colId: 'c0' }],
      }),
    );
    const { el, fixture } = await ready(KEY);
    vi.useFakeTimers();
    click(el, 'results-grid-columns-button');
    fixture.detectChanges();
    click(el, 'results-grid-reset-columns');
    expect(api.resetColumnState).toHaveBeenCalled();
    expect(api.autoSizeAllColumns).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
      v: 1,
      density: 'compact',
    });
    // The grid's own events after a reset do not bring the old layout back.
    fixture.componentInstance.onLayoutChanged({ source: 'api' });
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
      v: 1,
      density: 'compact',
    });
  });

  describe('column chooser', () => {
    const open = async () => {
      const m = await ready();
      click(m.el, 'results-grid-columns-button');
      m.fixture.detectChanges();
      return m;
    };
    it('lists the data columns (not the row number) and closes on Escape and outside clicks', async () => {
      const { el, fixture, cmp } = await open();
      const items = el.querySelectorAll('.dt-rg-chooser-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('C0');
      expect(
        el
          .querySelector('[data-testid="results-grid-columns-button"]')
          ?.getAttribute('aria-expanded'),
      ).toBe('true');
      document.body.click();
      fixture.detectChanges();
      expect(cmp.chooserOpen()).toBe(false);
      click(el, 'results-grid-columns-button');
      expect(cmp.chooserOpen()).toBe(true);
      cmp.closeChooser();
      expect(cmp.chooserOpen()).toBe(false);
    });
    it('moves a column next to its neighbour in the grid order, and not past the ends', async () => {
      const { cmp } = await ready(undefined, 2);
      expect(cmp.chooserColumns().map((c) => c.colId)).toEqual(['c0', 'c1']);
      cmp.moveColumn('c1', -1);
      // The index is that of the neighbour among all the grid's columns (the row number is first).
      expect(api.moveColumns).toHaveBeenCalledWith(['c1'], 1);
      cmp.moveColumn('c0', 1);
      expect(api.moveColumns).toHaveBeenLastCalledWith(['c0'], 2);
      api.moveColumns.mockClear();
      cmp.moveColumn('c0', -1);
      cmp.moveColumn('c1', 1);
      expect(api.moveColumns).not.toHaveBeenCalled();
    });

    it('shows, hides, pins and moves columns through the community column api', async () => {
      const { cmp } = await ready();
      cmp.setColumnVisible('c0', false);
      expect(api.setColumnsVisible).toHaveBeenCalledWith(['c0'], false);
      cmp.showAllColumns();
      expect(api.setColumnsVisible).toHaveBeenCalledWith(['c0'], true);
      cmp.togglePinned('c0');
      expect(api.setColumnsPinned).toHaveBeenCalledWith(['c0'], 'left');
      cmp.moveColumn('c0', 1);
      expect(api.moveColumns).not.toHaveBeenCalled();
    });
  });
  it('keeps native grouping/drag visibility session-only while resize and explicit hide survive a recreated grid', async () => {
    ModuleRegistry.registerModules([AllCommunityModule, RowGroupingModule]);
    configureAgGrid('test-only');
    await ensureAgGrid({
      community: async () => ({ registerAgGridCommunity: () => undefined }),
      enterprise: async () => ({ registerAgGridEnterprise: () => undefined }),
    });
    const {
      fixture,
      cmp,
      grid: stub,
    } = await mount(
      [
        { c0: 'Canada', c1: '2' },
        { c0: 'USA', c1: '3' },
      ],
      KEY,
      2,
    );
    fixture.componentRef.setInput('columnDefs', [
      resultColumnDef({ name: 'Country', type: 'string' }, 'c0'),
      resultColumnDef({ name: 'Quantity', type: 'integer' }, 'c1'),
    ]);
    fixture.detectChanges();
    expect(stub?.suppressGroupChangesColumnVisibility()).toBe(true);
    const hosts: HTMLElement[] = [],
      apis: GridApi[] = [];
    const native = () => {
      const host = document.createElement('div');
      document.body.append(host);
      hosts.push(host);
      const nativeApi = createGrid(host, {
        theme: 'legacy',
        columnDefs: cmp.defs(),
        rowData: cmp.rowData(),
        defaultColDef: cmp.defaultColDef(),
        ...cmp.groupVisibility,
        onColumnVisible: () => cmp.onLayoutChanged(),
        onColumnResized: (event) => cmp.onColumnResized(event),
      });
      apis.push(nativeApi);
      cmp.onGridReady({ api: nativeApi } as never);
      return nativeApi;
    };
    try {
      const first = native();
      first.setRowGroupColumns(['c0']);
      first.setColumnWidths([{ key: 'c1', newWidth: 150 }]);
      await vi.waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(KEY) ?? '{}').cols?.find(
            (c: { colId: string }) => c.colId === 'c0',
          )?.hide,
        ).toBe(false),
      );
      expect(
        first.getColumnState().find((c) => c.colId === 'c0'),
      ).toMatchObject({ rowGroup: true, hide: false });
      first.setColumnsVisible(['c1'], false);
      await vi.waitFor(() =>
        expect(
          JSON.parse(localStorage.getItem(KEY) ?? '{}').cols?.find(
            (c: { colId: string }) => c.colId === 'c1',
          )?.hide,
        ).toBe(true),
      );
      first.destroy();
      const restored = native();
      expect(
        restored.getColumnState().find((c) => c.colId === 'c0'),
      ).toMatchObject({ rowGroup: false, hide: false });
      expect(
        restored.getColumnState().find((c) => c.colId === 'c1'),
      ).toMatchObject({ hide: true, width: 150 });
    } finally {
      for (const api of apis) if (!api.isDestroyed()) api.destroy();
      for (const host of hosts) host.remove();
    }
  });
});

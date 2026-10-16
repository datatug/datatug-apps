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

const api = {
  exportDataAsCsv: vi.fn(),
  exportDataAsExcel: vi.fn(),
  getDisplayedRowCount: vi.fn(() => 1),
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
  readonly rowSelection = input<unknown>();
  readonly rowClassRules = input<unknown>();
  readonly loading = input<unknown>();
  readonly overlayNoRowsTemplate = input<unknown>();
  readonly quickFilterText = input<unknown>();
  readonly autoSizeStrategy = input<unknown>();
  readonly enableCellTextSelection = input<unknown>();
  readonly tooltipShowDelay = input<unknown>();
  readonly sideBar = input<unknown>();
  readonly statusBar = input<unknown>();
  readonly rowGroupPanelShow = input<unknown>();
  readonly cellSelection = input<unknown>();
  readonly enableCharts = input<unknown>();
  readonly gridReady = output<unknown>();
  readonly rowClicked = output<unknown>();
  readonly selectionChanged = output<unknown>();
  readonly cellFocused = output<unknown>();
  readonly modelUpdated = output<unknown>();
}

async function mount(
  rows: Record<string, string | null>[] = [{ c0: '1' }, { c0: null }],
) {
  TestBed.overrideComponent(ResultsGridComponent, {
    remove: { imports: [AgGridAngular] },
    add: { imports: [GridStubComponent] },
  });
  const fixture = TestBed.createComponent(ResultsGridComponent);
  fixture.componentRef.setInput('columnDefs', [
    resultColumnDef({ name: 'N', type: 'integer' }, 'c0'),
  ]);
  fixture.componentRef.setInput('rowData', rows);
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
      expect(grid?.statusBar()).toBeUndefined();
      expect(grid?.rowGroupPanelShow()).toBeUndefined();
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
      expect(grid?.enableCellTextSelection()).toBe(true);
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
      api.getDisplayedRowCount.mockReturnValue(1);
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
      expect(grid?.rowGroupPanelShow()).toBe('onlyWhenGrouping');
      expect(grid?.cellSelection()).toBe(true);
      expect(grid?.enableCharts()).toBe(true);
      expect(grid?.defaultColDef()).toMatchObject({
        enableRowGroup: true,
        enablePivot: true,
        enableValue: true,
      });
      (grid as unknown as GridStubComponent).gridReady.emit({ api });
      (
        el.querySelector(
          '[data-testid="results-grid-export-excel"]',
        ) as HTMLElement
      ).click();
      expect(api.exportDataAsExcel).toHaveBeenCalledWith({
        fileName: 'results.xlsx',
      });
    });
  });
});

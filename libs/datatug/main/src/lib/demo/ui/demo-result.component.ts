import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent, type RowClassParams,
} from 'ag-grid-community';
import type { DemoLang } from '../demo-scenarios';
import { formatFixed, formatInteger } from '../investigation/format';
import { toPerCapitaRows, type PerCapitaRow } from '../investigation/observations';
import { renderMessage } from '../trace/demo-messages';
import { DemoChartComponent } from './demo-chart.component';
import { createDatatugGridTheme } from './demo-grid-theme';

ModuleRegistry.registerModules([AllCommunityModule]);

/** The answer: an AG Grid with the DataTug theme beside a bar chart. Hovering one highlights the other. */
@Component({
  selector: 'sneat-datatug-demo-result',
  templateUrl: './demo-result.component.html',
  styleUrls: ['./demo-result.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AgGridAngular, DemoChartComponent],
})
export class DemoResultComponent {
  readonly rows = input.required<readonly Record<string, unknown>[]>();
  readonly lang = input<DemoLang>('en');
  readonly populationYear = input<number | undefined>();
  /** Countries an observation asks us to show: pinned until another is chosen or cleared. */
  readonly pinned = input<ReadonlySet<string>>(new Set());
  readonly clearPinned = output<void>();
  readonly runAgain = output<void>();

  readonly theme = createDatatugGridTheme();
  private readonly hovered = signal<string | null>(null);
  private api?: GridApi;

  readonly gridRows = computed(() => [...this.rows()]);
  readonly perCapita = computed<readonly PerCapitaRow[]>(() => toPerCapitaRows(this.rows()));
  readonly largest = computed(() => [...this.perCapita()].sort((a, b) => b.totalSales - a.totalSales)[0]?.country);
  readonly linked = computed<ReadonlySet<string>>(() => {
    const hovered = this.hovered();
    return new Set([...this.pinned(), ...(hovered ? [hovered] : [])]);
  });
  readonly columns = computed<ColDef[]>(() => {
    const lang = this.lang();
    const t = (key: string): string => renderMessage(lang, key);
    return [
      { field: 'country', headerName: t('col.country'), flex: 1.3, minWidth: 130, filter: 'agTextColumnFilter' },
      { field: 'totalSales', headerName: t('col.totalSales'), type: 'rightAligned', flex: 1, minWidth: 110, filter: 'agNumberColumnFilter', valueFormatter: (p) => formatFixed(Number(p.value), 2, lang) },
      { field: 'population', headerName: t('col.population'), type: 'rightAligned', flex: 1.2, minWidth: 120, filter: 'agNumberColumnFilter', valueFormatter: (p) => formatInteger(Number(p.value), lang) },
      { field: 'populationYear', headerName: t('col.populationYear'), type: 'rightAligned', width: 90, filter: 'agNumberColumnFilter' },
      { field: 'salesPerMillion', headerName: t('col.salesPerMillion'), type: 'rightAligned', flex: 1.1, minWidth: 130, filter: 'agNumberColumnFilter', sort: 'desc', cellClass: 'primary-measure', valueFormatter: (p) => formatFixed(Number(p.value), 2, lang) },
    ];
  });
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, wrapHeaderText: true, autoHeaderHeight: true };
  readonly getRowId = (params: { data: Record<string, unknown> }): string => String(params.data['country']);
  readonly rowClass = (params: RowClassParams<Record<string, unknown>>): string | undefined =>
    this.linked().has(String(params.data?.['country'])) ? 'linked-row' : undefined;

  constructor() {
    effect(() => { this.linked(); this.api?.redrawRows(); });
  }

  t(key: string, params: Readonly<Record<string, string | number>> = {}): string { return renderMessage(this.lang(), key, params); }
  onReady(event: GridReadyEvent): void { this.api = event.api; }
  hover(country: string | null): void { this.hovered.set(country); }
  onCellHover(event: { data?: Record<string, unknown> }): void { this.hovered.set(event.data ? String(event.data['country']) : null); }
}

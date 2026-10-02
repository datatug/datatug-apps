import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { DemoLang } from '../demo-scenarios';
import { formatFixed } from '../investigation/format';
import { TOP_COUNT, type PerCapitaRow } from '../investigation/observations';
import { renderMessage } from '../trace/demo-messages';

export interface ChartBar {
  readonly country: string;
  readonly value: number;
  readonly rank: number;
  readonly percent: number;
  readonly compare: boolean;
}

/**
 * Sales per million people: the top ten countries plus one comparison country, as horizontal bars in the
 * same label / track / value pattern the app's CLI chat chart uses. The comparison country keeps its true
 * rank, so a big total that ranks low per person is visible at a glance.
 */
@Component({
  selector: 'sneat-datatug-demo-chart',
  templateUrl: './demo-chart.component.html',
  styleUrls: ['./demo-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoChartComponent {
  readonly rows = input.required<readonly PerCapitaRow[]>();
  readonly lang = input<DemoLang>('en');
  /** The country to show beside the top ten (the one with the largest total). */
  readonly compareCountry = input<string | undefined>();
  /** Countries linked from elsewhere (hovered grid row, a selected observation). */
  readonly linked = input<ReadonlySet<string>>(new Set());
  readonly hover = output<string | null>();

  readonly bars = computed<readonly ChartBar[]>(() => {
    const ranked = [...this.rows()].sort((a, b) => b.salesPerMillion - a.salesPerMillion);
    const max = Math.max(0, ...ranked.map((row) => row.salesPerMillion));
    const pick = ranked.slice(0, TOP_COUNT).map((row, index) => ({ row, rank: index + 1, compare: false }));
    const extra = ranked.findIndex((row) => row.country === this.compareCountry());
    if (extra >= TOP_COUNT) pick.push({ row: ranked[extra], rank: extra + 1, compare: true });
    return pick.map(({ row, rank, compare }) => ({
      country: row.country, value: row.salesPerMillion, rank, compare, percent: max ? row.salesPerMillion / max * 100 : 0,
    }));
  });
  readonly compareBar = computed(() => this.bars().find((bar) => bar.compare));

  t(key: string, params: Readonly<Record<string, string | number>> = {}): string { return renderMessage(this.lang(), key, params); }
  value(bar: ChartBar): string { return formatFixed(bar.value, 2, this.lang()); }
  isLinked(bar: ChartBar): boolean { return this.linked().has(bar.country); }
}

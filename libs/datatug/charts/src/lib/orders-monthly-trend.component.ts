import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import type { OrdersMonthlyTrend } from '@sneat/datatug-semantic';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ECharts } from 'echarts/core';

echarts.use([
  LineChart,
  AriaComponent,
  GridComponent,
  TooltipComponent,
  SVGRenderer,
]);

/** Lazy presentation of complete held Orders; no querying, playback, filtering or storage. */
@Component({
  selector: 'datatug-orders-monthly-trend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section role="region" aria-label="Monthly orders trend">
      @if (loading) {
        <p role="status">Preparing monthly trend…</p>
      } @else if (error) {
        <p role="alert">{{ error }}</p>
      } @else if (data; as trend) {
        <p role="status">
          {{ trend.orderCount }} orders · {{ trend.months.length }} calendar
          months · orders per month
        </p>
        <p>
          All source orders by {{ trend.dateColumn }}. Country selection and
          race Top N do not change this overview.
        </p>
        @if (trend.months.length) {
          <p>
            {{ trend.months[0].period }}–{{
              trend.months[trend.months.length - 1].period
            }}
          </p>
          <p>
            Observed {{ trend.dateColumn }}: {{ trend.firstDate }}–{{
              trend.lastDate
            }}. Counts cover available sample dates; boundary months may be
            partial.
          </p>
          <div
            #plot
            class="plot"
            role="img"
            aria-label="Orders per calendar month; exact values in Monthly data below"
          ></div>
          <details>
            <summary>Monthly data ({{ trend.months.length }} months)</summary>
            <table>
              <caption>
                All source orders per calendar month
              </caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Orders</th>
                </tr>
              </thead>
              <tbody>
                @for (month of trend.months; track month.period) {
                  <tr>
                    <th scope="row">{{ month.period }}</th>
                    <td>{{ month.orders }}</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>{{ trend.orderCount }}</td>
                </tr>
              </tfoot>
            </table>
          </details>
        } @else {
          <p role="status">No source orders in this result.</p>
        }
      } @else {
        <p role="status">
          A complete admitted Orders result is required for the monthly trend.
        </p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    p {
      font-size: 0.85rem;
      margin-block: 0.5rem;
    }
    .plot {
      width: 100%;
      height: 19rem;
    }
    summary {
      min-height: 2.75rem;
      padding-block: 0.7rem;
      cursor: pointer;
    }
    summary:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      padding: 0.5rem;
      text-align: left;
      border-bottom: 1px solid var(--ion-background-color-step-150, #dce5ef);
    }
    caption {
      text-align: left;
    }
    /* The ECharts SVG is built outside Angular's view: CSS stroke/fill beat its presentation attributes. */
    :host-context(.ion-palette-dark) .plot ::ng-deep svg path[stroke='#dbdee4' i] {
      stroke: #3d4048;
    }
    :host-context(.ion-palette-dark) .plot ::ng-deep svg text {
      fill: #b8bac2;
    }
  `,
})
export class OrdersMonthlyTrendComponent implements OnChanges, OnDestroy {
  @Input() data: OrdersMonthlyTrend | null = null;
  @Input() active = true;
  @Input() loading = false;
  @Input() error: string | null = null;
  private chart?: ECharts;
  private observer?: ResizeObserver;
  private plotElement?: HTMLElement;
  private readonly browser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
  }

  @ViewChild('plot') set plot(ref: ElementRef<HTMLElement> | undefined) {
    const element = ref?.nativeElement;
    if (element === this.plotElement) return;
    this.dispose();
    this.plotElement = element;
    if (element && this.browser) {
      this.observer = new ResizeObserver(() => {
        if (!this.active) return;
        if (this.chart) this.chart.resize();
        else this.render();
      });
      this.observer.observe(element);
      this.render();
    }
  }

  ngOnChanges(): void {
    this.render();
  }
  ngOnDestroy(): void {
    this.dispose();
    this.plotElement = undefined;
  }
  private dispose(): void {
    this.observer?.disconnect();
    this.chart?.dispose();
    this.observer = undefined;
    this.chart = undefined;
  }
  private render(): void {
    if (!this.browser || !this.active || !this.plotElement) return;
    if (!this.chart) {
      // A deferred chunk can finish after its view was hidden. Wait for real layout.
      if (!this.plotElement.clientWidth || !this.plotElement.clientHeight) return;
      this.chart = echarts.init(this.plotElement, undefined, { renderer: 'svg' });
    }
    if (!this.data || this.loading || this.error) {
      this.chart.clear();
      return;
    }
    this.chart.resize();
    this.chart.setOption({
      // A static overview has no playback; it is motion-safe in every preference.
      animation: false,
      aria: {
        enabled: true,
        label: {
          description:
            'All source orders per calendar month. Monthly data lists every exact count.',
        },
      },
      grid: { left: 40, right: 16, top: 20, bottom: 48 },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        valueFormatter: (value: number) => `${value} orders`,
      },
      xAxis: {
        type: 'category',
        data: this.data.months.map((month) => month.period),
        axisLabel: { hideOverlap: true },
      },
      yAxis: { type: 'value', min: 0, minInterval: 1, name: 'Orders' },
      series: [
        {
          id: 'monthly-orders',
          type: 'line',
          name: 'Orders',
          showSymbol: true,
          data: this.data.months.map((month) => month.orders),
          itemStyle: { color: '#1764c0' },
        },
      ],
    });
  }
}

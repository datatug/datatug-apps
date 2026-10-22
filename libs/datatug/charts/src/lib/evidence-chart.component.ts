import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type {
  EvidenceInspection,
  PreparedEvidenceChart,
  TypedValue,
} from '@sneat/datatug-semantic';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, ScatterChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart,
  HeatmapChart,
  ScatterChart,
  AriaComponent,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

/** One shared leaf for DataTug and Dashboardius. No transport, routes or storage. */
@Component({
  selector: 'datatug-evidence-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section role="region" [attr.aria-label]="title()">
      @if (showHeader()) {
        <header>
          <h3>{{ title() }}</h3>
          <span>Held query result</span>
        </header>
      }
      @if (loading()) {
        <p role="status">
          {{ embedded() ? 'Loading chart…' : 'Preparing held evidence…' }}
        </p>
      } @else if (error()) {
        <p role="alert">{{ error() }}</p>
      } @else if (data(); as held) {
        @if (held.kind === 'timeline') {
          <p class="timeline-legend" aria-label="Timeline status legend">
            ● Pass · ◆ Fail · ○ Unknown
          </p>
          @if (held.timeMode === 'elapsed') {
            <p>
              Elapsed milliseconds from each lane’s observed start. Calendar
              times remain in exact data.
            </p>
          }
        }
        @if (!embedded()) {
          <p class="scope">
            {{ held.source.id }} · generation {{ held.source.generation }} ·
            {{ held.provenance.observedAt }}
          </p>
        }
        @if (held.limitations.length) {
          <p role="note">
            Source policy limitations apply. Inspect the source result for
            details.
          </p>
        }
        @if (held.rows.length) {
          <div
            #plot
            class="plot"
            role="img"
            [attr.aria-label]="
              title() +
              '; exact held values and keyboard evidence controls below'
            "
          ></div>
          <p class="meaning">{{ meaning() }}</p>
          <details [open]="!embedded()">
            <summary>
              {{
                embedded()
                  ? 'Source and exact data'
                  : 'Exact held rows and evidence'
              }}
              ({{ held.rows.length }})
            </summary>
            @if (embedded()) {
              <p class="scope">
                {{ held.source.id }} · generation {{ held.source.generation }} ·
                {{ held.provenance.observedAt }}
              </p>
            }
            <div
              class="table-scroll"
              tabindex="0"
              role="region"
              aria-label="Scrollable exact held chart data"
            >
              <table>
                <caption>
                  {{
                    title()
                  }}
                  — original typed values
                </caption>
                <thead>
                  <tr>
                    @for (column of held.columns; track $index) {
                      <th scope="col">
                        {{ column.name }} <small>{{ column.type }}</small>
                      </th>
                    }
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of held.rows; track row.index) {
                    <tr>
                      @for (value of row.values; track $index) {
                        <td>{{ valueText(value) }}</td>
                      }
                      <td>
                        @for (entry of row.inspections; track $index) {
                          <button
                            type="button"
                            [disabled]="!active()"
                            (click)="inspect.emit(entry)"
                            [attr.aria-label]="
                              'Inspect ' +
                              row.label +
                              (entry.observationId
                                ? ' endpoint ' + entry.observationId
                                : '')
                            "
                          >
                            Inspect{{
                              entry.observationId
                                ? ' ' + entry.observationId
                                : ''
                            }}
                          </button>
                        } @empty {
                          <span>{{
                            row.unavailable || 'Evidence unavailable'
                          }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        } @else {
          <p role="status">
            {{
              embedded()
                ? 'The query returned no rows.'
                : 'No rows in this held result.'
            }}
          </p>
          @if (embedded()) {
            <details>
              <summary>Source details</summary>
              <p class="scope">
                {{ held.source.id }} · generation {{ held.source.generation }} ·
                {{ held.provenance.observedAt }}
              </p>
            </details>
          }
        }
      } @else {
        <p role="status">
          {{
            embedded()
              ? 'Run this chart to load its data.'
              : 'A complete admitted held result is required.'
          }}
        </p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      color: var(--ion-text-color, #172b4d);
    }
    section {
      min-width: 0;
    }
    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      border-bottom: 1px solid var(--ion-color-light-shade, #d8e1ec);
      padding-bottom: 0.7rem;
    }
    h3 {
      margin: 0;
      font-size: 1.1rem;
      letter-spacing: -0.025em;
      font-weight: 650;
    }
    header span,
    .scope,
    .meaning {
      font-size: 0.8rem;
      color: var(--ion-color-medium-shade, #53657a);
    }
    .scope {
      overflow-wrap: anywhere;
    }
    .plot {
      height: 22rem;
      width: 100%;
    }
    .meaning {
      line-height: 1.6;
    }
    summary {
      cursor: pointer;
      min-height: 2.75rem;
      padding: 0.7rem 0;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .table-scroll {
      overflow: auto;
      max-height: 24rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
    caption {
      text-align: left;
      padding: 0.6rem 0;
    }
    th,
    td {
      text-align: left;
      padding: 0.65rem;
      border-bottom: 1px solid var(--ion-color-light-shade, #d8e1ec);
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--ion-background-color, #fff);
    }
    small {
      display: block;
      font-weight: 400;
      color: var(--ion-color-medium-shade, #53657a);
    }
    button {
      cursor: pointer;
      min-height: 2.75rem;
      padding: 0.5rem 0.7rem;
      margin: 0.15rem;
      border: 1px solid currentColor;
      border-radius: 0.3rem;
      color: var(--ion-color-primary, #2563eb);
      background: transparent;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    :is(button, summary, .table-scroll):focus-visible {
      outline: 3px solid var(--ion-color-primary, #2563eb);
      outline-offset: 2px;
    }
    @media (max-width: 40rem) {
      .plot {
        height: 19rem;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        scroll-behavior: auto;
      }
    }
  `,
})
export class EvidenceChartComponent {
  readonly embedded = input(false);
  readonly showHeader = input(true);
  readonly heading = input<string>();
  readonly data = input<PreparedEvidenceChart | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly active = input(true);
  readonly inspect = output<EvidenceInspection>();
  private readonly plot = viewChild<ElementRef<HTMLElement>>('plot');
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  constructor() {
    effect((onCleanup) => {
      const held = this.data();
      const element = this.plot()?.nativeElement;
      if (
        !this.browser ||
        !element ||
        !held ||
        !this.active() ||
        this.loading() ||
        this.error()
      )
        return;
      const chart = echarts.init(element, undefined, { renderer: 'svg' });
      chart.setOption(evidenceChartOption(held));
      chart.on('click', (event) => {
        if (
          event.componentType !== 'series' ||
          typeof event.dataIndex !== 'number'
        )
          return;
        const rows = plottedRows(held);
        const entry = rows[event.dataIndex]?.inspections[0];
        if (entry) this.inspect.emit(entry);
      });
      const observer =
        typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(() => chart.resize());
      observer?.observe(element);
      onCleanup(() => {
        observer?.disconnect();
        chart.dispose();
      });
    });
  }
  title(): string {
    const heading = this.heading()?.trim();
    if (heading) return heading;
    return this.data()?.kind === 'timeline'
      ? 'Observed milestones'
      : this.data()?.kind === 'heatmap'
        ? 'Readiness and assignment'
        : this.data()?.kind === 'timing-bars'
          ? 'Measured endpoint timing'
          : 'Evidence chart';
  }
  meaning(): string {
    return this.data()?.kind === 'timeline'
      ? this.data()?.timeMode === 'elapsed'
        ? 'Points show elapsed milliseconds from each lane’s declared observed start. Original calendar times and row evidence are retained.'
        : 'Points show observed timestamps in declared lane sequence. No connecting span or duration is inferred.'
      : this.data()?.kind === 'heatmap'
        ? 'Pass, fail and unknown come from admitted evidence. Unavailable evidence remains unknown.'
        : 'Bars measure milliseconds between distinct admitted observations with compatible clocks and declared precision. Missing work is never zero.';
  }
  valueText(value: TypedValue): string {
    return value.type === 'null' ? 'NULL' : `${value.value}`;
  }
}
function plottedRows(data: PreparedEvidenceChart) {
  return data.rows.filter((row) =>
    data.kind === 'timeline'
      ? data.timeMode === 'elapsed'
        ? row.elapsedMs !== undefined
        : row.time !== undefined
      : data.kind === 'timing-bars'
        ? row.durationMs !== undefined
        : true,
  );
}
/** Exported for deterministic presentation tests; never prepares or alters evidence. */
export function evidenceChartOption(
  data: PreparedEvidenceChart,
): EChartsCoreOption {
  const rows = plottedRows(data);
  const groups = [...new Set(data.rows.map((r) => r.group))];
  const labels = [...new Set(data.rows.map((r) => r.label))];
  const base: EChartsCoreOption = {
    animation: false,
    aria: { enabled: true },
    grid: { left: 20, right: 32, top: 28, bottom: 36, containLabel: true },
    tooltip: { trigger: 'item', renderMode: 'richText' },
    textStyle: { fontFamily: 'system-ui, sans-serif', color: '#53657a' },
  };
  if (data.kind === 'timeline')
    return {
      ...base,
      xAxis: {
        type: data.timeMode === 'elapsed' ? 'value' : 'time',
        ...(data.timeMode === 'elapsed'
          ? { name: 'Elapsed (ms)', min: 0 }
          : {}),
        splitLine: {
          show: true,
          lineStyle: { color: '#e6edf5', type: 'dashed' },
        },
      },
      yAxis: {
        type: 'category',
        data: groups,
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 14,
          tooltip: { formatter: '{b}' },
          data: rows.map((r) => ({
            value: [
              data.timeMode === 'elapsed' ? r.elapsedMs : r.time,
              r.group,
            ],
            name: `${r.label} · ${r.status}\nObserved: ${r.end ?? new Date(r.time as number).toISOString()}${r.start ? `\nLane start: ${r.start}\nAnchor: ${r.anchorIdentity}\nElapsed: ${r.elapsedMs} ms · Precision: ${r.precisionMs} ms` : ''}`,
            symbol:
              r.status === 'pass'
                ? 'circle'
                : r.status === 'fail'
                  ? 'diamond'
                  : 'emptyCircle',
            itemStyle: {
              color:
                r.status === 'pass'
                  ? '#15803d'
                  : r.status === 'fail'
                    ? '#b91c1c'
                    : '#64748b',
              borderWidth: 2,
            },
          })),
          emphasis: { scale: 1.4 },
        },
      ],
    };
  if (data.kind === 'timing-bars')
    return {
      ...base,
      xAxis: {
        type: 'value',
        min: 0,
        name: 'ms',
        splitLine: { lineStyle: { color: '#e6edf5', type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.label),
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: '#2563eb', borderRadius: [0, 5, 5, 0] },
          label: { show: true, position: 'right', formatter: '{c} ms' },
          data: rows.map((r) => r.durationMs),
        },
      ],
    };
  return {
    ...base,
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: groups,
      axisLine: { show: false },
      axisTick: { show: false },
    },
    visualMap: {
      type: 'piecewise',
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      pieces: [
        { value: 0, label: 'Unknown', color: '#dce4ee' },
        { value: 1, label: 'Fail', color: '#be3545' },
        { value: 2, label: 'Pass', color: '#137f66' },
      ],
    },
    series: [
      {
        type: 'heatmap',
        itemStyle: { borderColor: '#fff', borderWidth: 4, borderRadius: 6 },
        label: {
          show: true,
          formatter: (params: unknown) => {
            const value = (params as { value: number[] }).value[2];
            return ['Unknown', 'Fail', 'Pass'][value];
          },
        },
        data: rows.map((r) => [
          labels.indexOf(r.label),
          groups.indexOf(r.group),
          r.status === 'pass' ? 2 : r.status === 'fail' ? 1 : 0,
        ]),
      },
    ],
  };
}

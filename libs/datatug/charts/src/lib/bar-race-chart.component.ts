import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import type {
  BarRaceData,
  BarRaceEntry,
  BarRaceFrame,
} from '@sneat/datatug-semantic';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ECharts } from 'echarts/core';

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  AriaComponent,
  SVGRenderer,
]);

/** ECharts' default tooltip renderer treats formatter strings as HTML. */
export function escapeChartTooltipText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

/** Both modes must be prepared from one result at the maximum admitted Top N. */
export interface BarRaceChartViews {
  readonly period: BarRaceData;
  readonly cumulative: BarRaceData;
}

export interface BarRaceInspectRequest {
  readonly period: string;
  readonly category: string;
  readonly value: number;
  readonly rank: number;
}

/** Presentation-only chart. The caller owns querying, record inspection and provenance display. */
@Component({
  selector: 'datatug-bar-race-chart',
  standalone: true,
  templateUrl: './bar-race-chart.component.html',
  styleUrl: './bar-race-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarRaceChartComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() embedded = false;
  @Input() emptyMessage = 'No chart data is available.';
  @Input() views: BarRaceChartViews | null = null;
  @Input() initialMode: 'period' | 'cumulative' = 'period';
  @Input() initialTopN = 10;
  @Input() active = true;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() inspectable = false;
  @Output() readonly inspect = new EventEmitter<BarRaceInspectRequest>();
  @ViewChild('plot') set plot(ref: ElementRef<HTMLElement> | undefined) {
    const element = ref?.nativeElement;
    if (element === this.plotElement) return;
    this.disposeChart();
    this.plotElement = element;
    if (element && this.browser) this.initChart(element);
  }

  readonly mode = signal<'period' | 'cumulative'>('period');
  readonly frameIndex = signal(0);
  readonly topN = signal(10);
  readonly intervalMs = signal(1000);
  readonly playing = signal(false);
  readonly reducedMotion = signal(false);
  readonly validationError = signal<string | null>(null);
  private chart?: ECharts;
  private observer?: ResizeObserver;
  private plotElement?: HTMLElement;
  private motionQuery?: MediaQueryList;
  private readonly onMotionChange = (event: MediaQueryListEvent) => {
    this.reducedMotion.set(event.matches);
    this.stop();
    this.render();
  };
  private playback?: ReturnType<typeof setInterval>;
  private readonly browser: boolean;
  private readonly numberFormat = new Intl.NumberFormat();

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.browser = isPlatformBrowser(platformId);
  }

  get data(): BarRaceData | null {
    return this.views?.[this.mode()] ?? null;
  }

  get frames(): readonly BarRaceFrame[] {
    return this.data?.frames ?? [];
  }

  get frame(): BarRaceFrame | null {
    return this.frames[this.frameIndex()] ?? null;
  }

  get entries(): readonly BarRaceEntry[] {
    return this.frame?.entries.slice(0, this.topN()) ?? [];
  }

  get maxTopN(): number {
    return this.views
      ? Math.min(this.views.period.spec.topN, this.views.cumulative.spec.topN)
      : 0;
  }

  get plotHeight(): number {
    return Math.max(320, Math.min(1600, this.topN() * 34 + 70));
  }

  get available(): boolean {
    return (
      !this.loading &&
      !this.error &&
      !this.validationError() &&
      this.frames.length > 0
    );
  }

  get atEnd(): boolean {
    return this.frameIndex() >= this.frames.length - 1;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['views']) {
      this.stop();
      this.mode.set(
        this.initialMode === 'cumulative' ? 'cumulative' : 'period',
      );
      this.frameIndex.set(0);
      this.validationError.set(this.validateViews());
      this.topN.set(
        Math.max(
          1,
          Math.min(
            Number.isSafeInteger(this.initialTopN) ? this.initialTopN : 10,
            this.maxTopN,
          ),
        ),
      );
    }
    if (this.loading || this.error || !this.active) this.stop();
    this.render();
  }

  ngAfterViewInit(): void {
    if (!this.browser) return;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.set(this.motionQuery.matches);
    this.motionQuery.addEventListener('change', this.onMotionChange);
    this.render();
  }

  private initChart(element: HTMLElement): void {
    this.chart = echarts.init(element, undefined, { renderer: 'svg' });
    this.observer = new ResizeObserver(() => this.chart?.resize());
    this.observer.observe(element);
    this.render();
  }

  private disposeChart(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.chart?.dispose();
    this.chart = undefined;
  }

  ngOnDestroy(): void {
    this.stop();
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.disposeChart();
    this.plotElement = undefined;
  }

  previous(): void {
    this.seek(this.frameIndex() - 1);
  }

  next(): void {
    this.seek(this.frameIndex() + 1);
  }

  seek(index: number): void {
    this.stop();
    if (!this.available || !Number.isInteger(index)) return;
    this.frameIndex.set(Math.max(0, Math.min(index, this.frames.length - 1)));
    this.render();
  }

  onScrub(event: Event): void {
    this.seek(Number((event.target as HTMLInputElement).value));
  }

  onMode(event: Event): void {
    const mode = (event.target as HTMLSelectElement).value;
    if (mode !== 'period' && mode !== 'cumulative') return;
    this.stop();
    this.mode.set(mode);
    this.render();
  }

  onTopN(event: Event): void {
    const requested = Number((event.target as HTMLInputElement).value);
    if (!Number.isInteger(requested)) return;
    this.topN.set(Math.max(1, Math.min(requested, this.maxTopN)));
    (event.target as HTMLInputElement).value = String(this.topN());
    this.render();
  }

  onInterval(event: Event): void {
    const interval = Number((event.target as HTMLSelectElement).value);
    if (![500, 1000, 2000].includes(interval)) return;
    this.intervalMs.set(interval);
    if (this.playing()) {
      this.stop();
      this.play();
    }
  }

  togglePlayback(): void {
    if (this.playing()) this.stop();
    else this.play();
  }

  formatValue(value: number): string {
    return this.numberFormat.format(value);
  }

  requestInspection(entry: BarRaceEntry): void {
    if (!this.inspectable || !this.frame) return;
    this.inspect.emit({
      period: this.frame.period,
      category: entry.category,
      value: entry.value,
      rank: entry.rank,
    });
  }

  private play(): void {
    if (!this.available || this.playing()) return;
    if (this.atEnd) this.frameIndex.set(0);
    this.playing.set(true);
    this.render();
    this.playback = setInterval(() => {
      if (this.atEnd) {
        this.stop();
      } else {
        this.frameIndex.update((index) => index + 1);
        this.render();
      }
    }, this.intervalMs());
  }

  private stop(): void {
    if (this.playback) clearInterval(this.playback);
    this.playback = undefined;
    this.playing.set(false);
  }

  private validateViews(): string | null {
    if (!this.views) return null;
    const { period, cumulative } = this.views;
    if (
      period.spec.kind !== 'bar-race' ||
      cumulative.spec.kind !== 'bar-race' ||
      period.spec.mode !== 'period' ||
      cumulative.spec.mode !== 'cumulative'
    ) {
      return 'The prepared chart modes are incompatible.';
    }
    if (
      period.spec.topN < 1 ||
      cumulative.spec.topN < 1 ||
      period.frames.length !== cumulative.frames.length ||
      period.frames.some(
        (frame, index) => frame.period !== cumulative.frames[index].period,
      )
    ) {
      return 'The prepared chart frames do not match.';
    }
    return null;
  }

  private render(): void {
    if (!this.chart) return;
    if (!this.available) {
      this.chart.clear();
      return;
    }
    const entries = this.entries;
    this.chart.setOption({
      animation: !this.reducedMotion(),
      animationDurationUpdate: this.reducedMotion()
        ? 0
        : Math.min(350, this.intervalMs() / 2),
      aria: {
        enabled: true,
        label: {
          description: `Bar chart for ${this.frame?.period}. The synchronized table lists exact values.`,
        },
      },
      grid: {
        left: 12,
        right: 42,
        top: 8,
        bottom: 22,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      xAxis: {
        type: 'value',
        min: entries.some((entry) => entry.value < 0) ? 'dataMin' : 0,
        max: 'dataMax',
        axisLabel: { hideOverlap: true },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: entries.map((entry) => entry.category),
        axisLabel: { width: 120, overflow: 'truncate' },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: { name: string; value: number }) =>
          `${escapeChartTooltipText(params.name)}: ${this.formatValue(params.value)}`,
      },
      series: [
        {
          id: 'bar-race',
          type: 'bar',
          realtimeSort: true,
          data: entries.map((entry) => ({
            name: entry.category,
            value: entry.value,
            itemStyle: { color: entry.color },
          })),
        },
      ],
    });
  }
}

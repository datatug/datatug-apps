import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import * as echarts from 'echarts/core';
import { OrdersMonthlyTrendComponent } from './orders-monthly-trend.component';

const data = {
  orderCount: 3,
  dateColumn: 'OrderDate',
  firstDate: '2024-01-03',
  lastDate: '2024-03-12',
  months: [
    { period: '2024-01', orders: 1 },
    { period: '2024-02', orders: 0 },
    { period: '2024-03', orders: 2 },
  ],
};

describe('monthly held Orders presentation', () => {
  it('updates loading, complete accessible month data and refusal without manual detection after input changes', async () => {
    TestBed.configureTestingModule({
      imports: [OrdersMonthlyTrendComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    const fixture = TestBed.createComponent(OrdersMonthlyTrendComponent);
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Preparing monthly trend',
    );
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('data', data);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      '3 orders · 3 calendar months · orders per month',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Observed OrderDate: 2024-01-03–2024-03-12',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'boundary months may be partial',
    );
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(
      fixture.nativeElement.querySelectorAll('tbody td')[1].textContent,
    ).toBe('0');
    expect(fixture.nativeElement.querySelector('tfoot td').textContent).toBe(
      '3',
    );
    fixture.componentRef.setInput('error', 'Complete Orders required');
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('Complete Orders required');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    fixture.componentRef.setInput('error', null);
    fixture.componentRef.setInput('data', {
      ...data,
      orderCount: 0,
      months: [],
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No source orders');
    fixture.destroy();
  });

  it('renders one static zero-based SVG line with exact gaps and disposes its observer/chart', async () => {
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(304);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* bounded test observer */
        }
        disconnect() {
          disconnect();
        }
      },
    );
    try {
      TestBed.configureTestingModule({
        imports: [OrdersMonthlyTrendComponent],
        providers: [
          provideZonelessChangeDetection(),
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      const fixture = TestBed.createComponent(OrdersMonthlyTrendComponent);
      fixture.componentRef.setInput('data', data);
      fixture.componentRef.setInput('active', false);
      await fixture.whenStable();
      const hiddenPlot = fixture.nativeElement.querySelector('.plot') as HTMLElement;
      expect(echarts.getInstanceByDom(hiddenPlot)).toBeUndefined();
      fixture.componentRef.setInput('active', true);
      await fixture.whenStable();
      const plot = fixture.nativeElement.querySelector('.plot') as HTMLElement;
      const chart = echarts.getInstanceByDom(plot);
      expect(chart).toBeDefined();
      const options = chart?.getOption() as {
        animation: boolean;
        yAxis: { min: number }[];
        series: { data: number[] }[];
      };
      expect(options.animation).toBe(false);
      expect(options.yAxis[0].min).toBe(0);
      expect(options.series[0].data).toEqual([1, 0, 2]);
      fixture.componentRef.setInput('active', false);
      await fixture.whenStable();
      expect(echarts.getInstanceByDom(plot)).toBe(chart);
      fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
      expect(echarts.getInstanceByDom(plot)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

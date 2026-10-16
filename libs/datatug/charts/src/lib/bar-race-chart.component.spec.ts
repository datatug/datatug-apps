import type { ChangeDetectorRef, SimpleChanges } from '@angular/core';
import type { BarRaceData } from '@sneat/datatug-semantic';
import { describe, expect, it, vi } from 'vitest';
import { BarRaceChartComponent, type BarRaceChartViews } from './bar-race-chart.component';

function view(mode: 'period' | 'cumulative', topN = 2): BarRaceData {
  return {
    spec: { kind: 'bar-race', mode, topN, periodColumn: 'month', categoryColumn: 'place', measureColumn: 'orders', onDuplicate: 'sum' },
    frames: [
      { period: '2024-01', entries: [{ category: 'A', value: 3, rank: 1, color: '#123456' }, { category: 'B', value: 1, rank: 2, color: '#654321' }] },
      { period: '2024-02', entries: [{ category: 'B', value: 4, rank: 1, color: '#654321' }, { category: 'A', value: 2, rank: 2, color: '#123456' }] },
    ],
  } as BarRaceData;
}

function component(views: BarRaceChartViews): BarRaceChartComponent {
  const changeDetector = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  const chart = new BarRaceChartComponent('server', changeDetector);
  chart.views = views;
  chart.ngOnChanges({ views: { currentValue: views, previousValue: null, firstChange: true, isFirstChange: () => true } } as SimpleChanges);
  return chart;
}

describe('BarRaceChartComponent presentation controls', () => {
  it('starts paused, switches prepared modes and seeks without altering the supplied frames', () => {
    const views = { period: view('period'), cumulative: view('cumulative') };
    const chart = component(views);
    expect(chart.playing).toBe(false);
    expect(chart.frame?.period).toBe('2024-01');
    chart.next();
    expect(chart.frame?.period).toBe('2024-02');
    chart.onMode({ target: { value: 'cumulative' } } as unknown as Event);
    expect(chart.data).toBe(views.cumulative);
    expect(chart.frameIndex).toBe(1);
    chart.seek(99);
    expect(chart.frameIndex).toBe(1);
    expect(views.period.frames[0].entries[0].value).toBe(3);
  });

  it('caps Top N at the prepared capacity and exposes matching table entries', () => {
    const chart = component({ period: view('period', 2), cumulative: view('cumulative', 2) });
    const input = { value: '50' };
    chart.onTopN({ target: input } as unknown as Event);
    expect(chart.topN).toBe(2);
    expect(input.value).toBe('2');
    input.value = '1';
    chart.onTopN({ target: input } as unknown as Event);
    expect(chart.entries.map(entry => entry.category)).toEqual(['A']);
  });

  it('rejects mismatched periods instead of showing two unrelated prepared views', () => {
    const cumulative = view('cumulative');
    const mismatched = { ...cumulative, frames: [{ ...cumulative.frames[0], period: '2024-03' }, cumulative.frames[1]] };
    const chart = component({ period: view('period'), cumulative: mismatched });
    expect(chart.validationError).toContain('frames do not match');
    expect(chart.available).toBe(false);
  });

  it('only emits inspection when a caller offers a records journey', () => {
    const chart = component({ period: view('period'), cumulative: view('cumulative') });
    const listener = vi.fn();
    chart.inspect.subscribe(listener);
    chart.requestInspection(chart.entries[0]);
    expect(listener).not.toHaveBeenCalled();
    chart.inspectable = true;
    chart.requestInspection(chart.entries[0]);
    expect(listener).toHaveBeenCalledWith({ period: '2024-01', category: 'A', value: 3, rank: 1 });
  });

  it('does not autoplay and stops playback after the final prepared frame', () => {
    vi.useFakeTimers();
    try {
      const chart = component({ period: view('period'), cumulative: view('cumulative') });
      expect(chart.frameIndex).toBe(0);
      vi.advanceTimersByTime(3000);
      expect(chart.frameIndex).toBe(0);
      chart.togglePlayback();
      vi.advanceTimersByTime(1000);
      expect(chart.frameIndex).toBe(1);
      vi.advanceTimersByTime(1000);
      expect(chart.playing).toBe(false);
      chart.ngOnDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

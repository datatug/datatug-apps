import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import * as echarts from 'echarts/core';
import type {
  PreparedEvidenceChart,
  EvidenceInspection,
} from '@sneat/datatug-semantic';
import {
  EvidenceChartComponent,
  evidenceChartOption,
} from './evidence-chart.component';
const inspection: EvidenceInspection = {
  selector: {
    execution: {
      storeId: 'firestore',
      projectId: 'project',
      executionId: 'actual-held',
    },
    recordsetFingerprint: 'held-fingerprint',
    scope: {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
      environment: 'demo',
    },
    source: { id: 'source', generation: 'g1' },
    rowKeyColumn: 'key',
    rowKey: { type: 'integer', value: '9007199254740993' },
    slotColumn: 'evidence',
  },
};
function prepared(kind: PreparedEvidenceChart['kind']): PreparedEvidenceChart {
  return {
    kind,
    selectionId: 'selection',
    columns: [
      { name: 'label', type: 'string' },
      { name: 'evidence', type: 'string' },
    ],
    rows: [
      {
        index: 0,
        label: '<script>unsafe</script>',
        group: 'Order A',
        status: 'fail',
        time: 1526810700000,
        sequence: 1,
        durationMs: 2000,
        precisionMs: 1000,
        inspections: [inspection],
        values: [
          { type: 'string', value: '<script>unsafe</script>' },
          { type: 'null', value: null },
        ],
      },
    ],
    source: { id: 'source', generation: 'g1' },
    scope: {
      storeId: 'firestore',
      spaceID: 'space',
      projectId: 'project',
      environment: 'demo',
    },
    provenance: {
      source: 'source',
      mode: 'live',
      observedAt: '2026-10-21T00:00:00Z',
      executionProfile: 'opaque-privileged',
    },
    limitations: [],
  };
}
describe('shared three-kind evidence leaf', () => {
  it('updates loading/error/empty states and exposes safe exact cells + keyboard inspection in zoneless mode', async () => {
    TestBed.configureTestingModule({
      imports: [EvidenceChartComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    const fixture = TestBed.createComponent(EvidenceChartComponent);
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'Preparing held evidence',
    );
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('data', prepared('timeline'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('NULL');
    expect(fixture.nativeElement.textContent).toContain(
      '<script>unsafe</script>',
    );
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    const emitted: EvidenceInspection[] = [];
    fixture.componentInstance.inspect.subscribe((v) => emitted.push(v));
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.type).toBe('button');
    button.click();
    expect(emitted).toEqual([inspection]);
    fixture.componentRef.setInput('active', false);
    await fixture.whenStable();
    expect(button.disabled).toBe(true);
    fixture.componentRef.setInput('data', { ...prepared('heatmap'), rows: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No rows');
    fixture.componentRef.setInput('error', 'Source admission changed');
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('Source admission changed');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    fixture.componentRef.setInput('error', null);
    fixture.componentRef.setInput('data', null);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'complete admitted held result',
    );
    fixture.destroy();
  });
  it('keeps embedded charts primary while retaining exact data and keyboard inspection in a collapsed disclosure', async () => {
    TestBed.configureTestingModule({
      imports: [EvidenceChartComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    const fixture = TestBed.createComponent(EvidenceChartComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.componentRef.setInput('showHeader', false);
    fixture.componentRef.setInput('heading', 'Actual card title');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('header')).toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('[role="region"]')
        .getAttribute('aria-label'),
    ).toBe('Actual card title');
    expect(
      fixture.nativeElement.querySelectorAll('[role="status"]'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Run this chart');
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelectorAll('[role="status"]'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Loading chart');
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('data', {
      ...prepared('timeline'),
      limitations: [
        { policy: 'restricted-source', rowsFiltered: true, hiddenColumns: [] },
      ],
    });
    await fixture.whenStable();
    const details = fixture.nativeElement.querySelector(
      'details',
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const warning = fixture.nativeElement.querySelector('[role="note"]');
    expect(warning.textContent).toContain('Source policy limitations apply');
    expect(warning.closest('details')).toBeNull();
    expect(details.textContent).toContain('generation g1');
    expect(details.querySelector('table')?.textContent).toContain('NULL');
    const emitted: EvidenceInspection[] = [];
    fixture.componentInstance.inspect.subscribe((entry) => emitted.push(entry));
    details.open = true;
    (details.querySelector('button') as HTMLButtonElement).click();
    expect(emitted).toEqual([inspection]);
    fixture.componentRef.setInput('error', 'Connection is not ready');
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelectorAll('[role="alert"]'),
    ).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    fixture.componentRef.setInput('embedded', false);
    fixture.componentRef.setInput('showHeader', true);
    fixture.componentRef.setInput('heading', undefined);
    fixture.componentRef.setInput('error', null);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h3').textContent).toContain(
      'Observed milestones',
    );
    expect(fixture.nativeElement.querySelector('details').open).toBe(true);
    fixture.destroy();
  });
  it.each(['timeline', 'timing-bars', 'heatmap'] as const)(
    'renders actual %s SVG and disposes on input change/destroy',
    async (kind) => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
        640,
      );
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
        352,
      );
      const disconnect = vi.fn();
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {
            /* Test observer has no layout source. */
          }
          disconnect() {
            disconnect();
          }
        },
      );
      try {
        TestBed.configureTestingModule({
          imports: [EvidenceChartComponent],
          providers: [
            provideZonelessChangeDetection(),
            { provide: PLATFORM_ID, useValue: 'browser' },
          ],
        });
        const fixture = TestBed.createComponent(EvidenceChartComponent);
        fixture.componentRef.setInput('data', prepared(kind));
        await fixture.whenStable();
        const element = fixture.nativeElement.querySelector(
          '.plot',
        ) as HTMLElement;
        expect(element.querySelector('svg')).not.toBeNull();
        expect(
          echarts.getInstanceByDom(element)?.getOption()['animation'],
        ).toBe(false);
        const emitted: EvidenceInspection[] = [];
        fixture.componentInstance.inspect.subscribe((v) => emitted.push(v));
        echarts.getInstanceByDom(element)?.trigger('click', {
          type: 'click',
          $vars: [],
          componentType: 'series',
          componentSubType: 'scatter',
          componentIndex: 0,
          seriesType: 'scatter',
          seriesIndex: 0,
          seriesName: 'held',
          name: 'Assignment',
          dataIndex: 0,
          data: {},
          dataType: 'main',
          value: 0,
          color: '#2563eb',
        });
        expect(emitted).toEqual([inspection]);
        fixture.componentRef.setInput('active', false);
        await fixture.whenStable();
        expect(echarts.getInstanceByDom(element)).toBeUndefined();
        expect(disconnect).toHaveBeenCalled();
        fixture.destroy();
      } finally {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      }
    },
  );
  it('uses three distinct series and excludes unavailable timestamps/durations without inventing zero', () => {
    for (const [kind, series] of [
      ['timeline', 'scatter'],
      ['timing-bars', 'bar'],
      ['heatmap', 'heatmap'],
    ] as const) {
      const option = evidenceChartOption(prepared(kind));
      expect((option['series'] as { type: string }[])[0].type).toBe(series);
      expect((option['tooltip'] as { renderMode: string }).renderMode).toBe(
        'richText',
      );
    }
    const data = prepared('timing-bars');
    const row = { ...data.rows[0], durationMs: undefined };
    expect(
      (
        evidenceChartOption({ ...data, rows: [row] })['series'] as {
          data: unknown[];
        }[]
      )[0].data,
    ).toEqual([]);
    expect(
      (
        evidenceChartOption({ ...data, rows: [{ ...row, durationMs: 0 }] })[
          'series'
        ] as { data: unknown[] }[]
      )[0].data,
    ).toEqual([0]);
  });
});

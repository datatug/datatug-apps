import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Result, TypedValue } from '@sneat/datatug-semantic';
import { HeldResultPresentationComponent } from '../../../board/ui/components/held-result-presentation/held-result-presentation.component';

const pageTemplate = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'query-page.component.html'),
  'utf8',
);
const chartStart = pageTemplate.indexOf('      @if (resultChartHeld(); as chartResult) {');
const chartEnd = pageTemplate.indexOf('      @if (isTextQueryWorkspace()', chartStart);
if (chartStart < 0 || chartEnd < 0) throw new Error('QueryPage chart block is missing.');

/** Compile the production chart block, with only its QueryPage inputs replaced by a small host. */
@Component({
  standalone: true,
  imports: [HeldResultPresentationComponent],
  template: `
    <button type="button" (click)="resultChartView.set('grid')">Rows</button>
    <button type="button" (click)="resultChartView.set('chart')">Chart</button>
    ${pageTemplate.slice(chartStart, chartEnd)}
  `,
})
class QueryChartStateHost {
  readonly resultChartView = signal<'chart' | 'grid'>('chart');
  readonly resultChartVisible = computed(() => this.resultChartView() === 'chart');
  readonly resultChartHeld = signal<Result | null>(null);
  readonly resultChartFields = computed(() => ({
    categoryColumn: 'country', measureColumn: 'orders', title: 'Saved query result',
  }));
}

function heldResult(): Result {
  const countries = ['France', 'Germany', 'Italy', 'Spain', 'Sweden', 'UK'];
  return {
    recordset: {
      columns: [{ name: 'country', type: 'string' }, { name: 'orders', type: 'integer' }],
      rows: countries.map((country, index): TypedValue[] => [
        { type: 'string', value: country },
        { type: 'integer', value: String(index + 1) },
      ]),
    },
    limitations: [], bindingsApplied: [], truncated: false,
    provenance: { mode: 'live', source: 'Saved query', observedAt: '2026-10-16T00:00:00Z', executionProfile: 'protected' },
  } as Result;
}

describe('QueryPage held chart visibility', () => {
  it('keeps Top N and inspected source row through Chart → Rows → Chart on one result', async () => {
    await TestBed.configureTestingModule({ imports: [QueryChartStateHost] }).compileComponents();
    const fixture = TestBed.createComponent(QueryChartStateHost);
    const held = heldResult();
    fixture.componentInstance.resultChartHeld.set(held);
    fixture.detectChanges();

    const presenter = () => fixture.debugElement.query(By.directive(HeldResultPresentationComponent))
      ?.componentInstance as HeldResultPresentationComponent | undefined;
    const original = presenter();
    expect(original).toBeTruthy();
    const select = fixture.nativeElement.querySelector('select[aria-label="Number of categories shown"]') as HTMLSelectElement;
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.bars button').click();
    fixture.detectChanges();
    expect(original?.topN()).toBe(5);
    expect(original?.selectedRow()).not.toBeNull();

    (fixture.nativeElement.querySelectorAll('button')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(presenter()).toBe(original);
    expect(fixture.nativeElement.querySelector('div[hidden]')).not.toBeNull();
    (fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(presenter()).toBe(original);
    expect(original?.result).toBe(held);
    expect(original?.topN()).toBe(5);
    expect(original?.selectedRow()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('div[hidden]')).toBeNull();
  });
});

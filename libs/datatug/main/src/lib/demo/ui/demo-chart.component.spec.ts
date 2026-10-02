import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PerCapitaRow } from '../investigation/observations';
import { must } from '../testing/must';
import { DemoChartComponent } from './demo-chart.component';

const rows: PerCapitaRow[] = Array.from({ length: 24 }, (_, index) => ({ country: `C${index + 1}`, totalSales: 10, population: 1_000_000, salesPerMillion: 24 - index }));
const usaRows = rows.map((row) => row.country === 'C17' ? { ...row, country: 'USA', totalSales: 500 } : row);

describe('DemoChartComponent', () => {
  let fixture: ComponentFixture<DemoChartComponent>;
  const bars = (): HTMLElement[] => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="chart-bar"]')];

  function render(data: PerCapitaRow[], inputs: Record<string, unknown> = {}): void {
    TestBed.configureTestingModule({ imports: [DemoChartComponent], providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(DemoChartComponent);
    fixture.componentRef.setInput('rows', data);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }
  beforeEach(() => TestBed.resetTestingModule());

  it('shows the top ten and the comparison country at its true rank', () => {
    render(usaRows, { compareCountry: 'USA' });
    expect(bars().map((bar) => bar.getAttribute('data-country'))).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'USA']);
    const usa = must(bars().at(-1));
    expect(usa.classList).toContain('compare');
    expect(usa.querySelector('.rank')?.textContent).toBe('17');
    expect(usa.querySelector('.value')?.textContent).toBe('8.00');
    expect(bars()[0].querySelector<HTMLElement>('.fill')?.style.width).toBe('100%');
  });

  it('shows ten bars when the comparison country is already in the top ten, or none is named', () => {
    render(rows, { compareCountry: 'C3' });
    expect(bars()).toHaveLength(10);
    expect(bars().some((bar) => bar.classList.contains('compare'))).toBe(false);
  });

  it('highlights linked countries and reports hover and focus', () => {
    render(usaRows, { compareCountry: 'USA', linked: new Set(['C2']) });
    expect(bars()[1].classList).toContain('linked');
    expect(bars()[0].classList).not.toContain('linked');
    const events: (string | null)[] = [];
    fixture.componentInstance.hover.subscribe((value) => events.push(value));
    bars()[2].dispatchEvent(new Event('mouseenter'));
    bars()[2].dispatchEvent(new Event('mouseleave'));
    bars()[3].dispatchEvent(new Event('focus'));
    expect(events).toEqual(['C3', null, 'C4']);
  });

  it('has an accessible name and renders numbers for the language', () => {
    render(usaRows, { compareCountry: 'USA', lang: 'ru' });
    expect((fixture.nativeElement as HTMLElement).querySelector('figure')?.getAttribute('aria-label')).toContain('Столбчатая диаграмма');
    expect(must(bars().at(-1)).querySelector('.value')?.textContent).toBe('8,00');
  });
});

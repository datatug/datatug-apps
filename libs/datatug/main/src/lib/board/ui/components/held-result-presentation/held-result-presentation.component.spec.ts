import { TestBed } from '@angular/core/testing';
import type { Result, TypedValue } from '@sneat/datatug-semantic';
import {
  HeldResultPresentationComponent,
  prepareCategoryBars,
} from './held-result-presentation.component';

const fields = {
  categoryColumn: 'ShipCountry',
  measureColumn: 'orders',
  title: 'Orders by country',
  unit: 'orders',
};

function result(rows: readonly (readonly TypedValue[])[]): Result {
  return {
    recordset: {
      columns: [
        { name: 'ShipCountry', type: 'string' },
        { name: 'orders', type: 'integer' },
      ],
      rows,
    },
    limitations: [],
    bindingsApplied: [],
    provenance: {
      source: 'Northwind',
      mode: 'live',
      observedAt: '2026-10-16T00:00:00Z',
      executionProfile: 'protected',
    },
    truncated: false,
  } as Result;
}

const rows = [
  [
    { type: 'string', value: 'France' },
    { type: 'integer', value: '184' },
  ],
  [
    { type: 'string', value: 'Germany' },
    { type: 'integer', value: '204' },
  ],
] as const satisfies readonly (readonly TypedValue[])[];

describe('held result presentation', () => {
  it('sorts one admitted snapshot into bars and preserves source row references', () => {
    const prepared = prepareCategoryBars(result(rows), fields);
    expect(prepared).toEqual({
      ok: true,
      bars: [
        { category: 'Germany', value: 204, sourceRow: 1 },
        { category: 'France', value: 184, sourceRow: 0 },
      ],
    });
  });

  it('rejects duplicate categories and unsafe counts rather than silently combining them', () => {
    expect(
      prepareCategoryBars(result([rows[0], rows[0]]), fields),
    ).toMatchObject({ ok: false });
    const unsafe = result([
      [
        { type: 'string', value: 'France' },
        { type: 'integer', value: '9007199254740993' },
      ],
    ]);
    expect(prepareCategoryBars(unsafe, fields)).toMatchObject({
      ok: false,
      message: 'Row 1 has an unsupported count.',
    });
  });

  it('keeps chart and row inspection on the same held result', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('result', result(rows));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Germany');
    expect(root.querySelector('.table-scroll')).toBeNull();
    expect(root.querySelector('.source-details')?.textContent).toContain(
      'Northwind',
    );
    const bars = root.querySelectorAll<HTMLButtonElement>('.bars button');
    bars[0].click();
    fixture.detectChanges();
    expect(root.textContent).toContain('Same held result · no new query');
    expect(root.querySelector('.inspection')?.textContent).toContain('Row 2');
    expect(root.querySelector('.inspection')?.textContent).toContain('204');
    expect(document.activeElement).toBe(root.querySelector('.inspection'));
  });

  it('offers chart-only embedding with source-row inspection and no replacement table', async () => {
    await TestBed.configureTestingModule({ imports: [HeldResultPresentationComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('result', result(rows));
    fixture.componentRef.setInput('chartOnly', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.view-switch')).toBeNull();
    expect(root.querySelector('.table-scroll')).toBeNull();
    root.querySelector<HTMLButtonElement>('.bars button')?.click();
    fixture.detectChanges();
    expect(root.querySelector('.table-scroll')).toBeNull();
    expect(root.querySelector('.inspection')?.textContent).toContain('Row 2');
    expect(root.querySelector('.inspection')?.textContent).toContain('204');
    expect(fixture.componentInstance.view()).toBe('chart');
  });

  it('shows the actual policy restriction and opaque execution warning with the held result', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('result', {
      ...result(rows),
      limitations: [
        { policy: 'regional access', rowsFiltered: true, hiddenColumns: [] },
      ],
      provenance: {
        ...result(rows).provenance,
        executionProfile: 'opaque-privileged',
      },
    } satisfies Result);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain(
      'Limited by policy regional access: rows filtered',
    );
    expect(root.textContent).toContain('row/column enforcement does not apply');
    expect(root.textContent).not.toContain(
      'Source restrictions apply to this result.',
    );
  });
  it('honors a saved grid default while retaining the held chart data', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('defaultView', 'grid');
    fixture.componentRef.setInput('result', result(rows));
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe('grid');
    expect(fixture.nativeElement.querySelector('.table-scroll')).not.toBeNull();
    fixture.componentInstance.view.set('chart');
    fixture.detectChanges();
    expect(fixture.componentInstance.bars[0].category).toBe('Germany');
  });
});

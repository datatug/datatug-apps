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
    expect(root.querySelector('.source-details')?.textContent).toContain('Northwind');
    const bars = root.querySelectorAll<HTMLButtonElement>('.bars button');
    bars[0].click();
    fixture.detectChanges();
    expect(root.textContent).toContain('Same held result · no new query');
    expect(root.querySelector('.inspection')?.textContent).toContain('Row 2');
    expect(root.querySelector('.inspection')?.textContent).toContain('204');
  });
});

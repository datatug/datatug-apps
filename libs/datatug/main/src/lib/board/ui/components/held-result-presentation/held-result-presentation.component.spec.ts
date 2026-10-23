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
  it('selects a legacy bar without changing the held view, retains a separate inspect action, and clears pressed state', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    const held = result(rows);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput('result', held);
    fixture.componentRef.setInput('selectionEnabled', true);
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    const selected = vi.fn();
    fixture.componentInstance.categorySelected.subscribe(selected);
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('.bars li > button');
    button.focus();
    button.click();
    fixture.detectChanges();
    expect(selected).toHaveBeenCalledWith('Germany');
    expect(fixture.componentInstance.view()).toBe('chart');
    expect(fixture.componentInstance.result).toBe(held);
    expect(document.activeElement).toBe(button);
    fixture.componentRef.setInput('selectedCategory', 'Germany');
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fixture.componentRef.setInput('selectedCategory', null);
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Result explorer');
    fixture.nativeElement.querySelector('.inspect-category').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.view()).toBe('grid');
    expect(fixture.nativeElement.querySelector('.inspection')).not.toBeNull();
  });

  it('initializes the native Top N option to the rendered count and changes both together', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    fixture.componentRef.setInput('fields', fields);
    fixture.componentRef.setInput(
      'result',
      result(
        Array.from({ length: 15 }, (_, i) => [
          { type: 'string', value: `Country ${i}` },
          { type: 'integer', value: String(i + 1) },
        ]),
      ),
    );
    fixture.detectChanges();
    const select: HTMLSelectElement =
      fixture.nativeElement.querySelector('select');
    expect(select.value).toBe('10');
    expect(fixture.nativeElement.querySelectorAll('.bars li')).toHaveLength(10);
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(select.value).toBe('5');
    expect(fixture.nativeElement.querySelectorAll('.bars li')).toHaveLength(5);
  });

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

  it.each([undefined, 'protected'] as const)(
    'reports ordinary OVDB without inventing a profile and preserves an issued profile: %s',
    async (profile) => {
      await TestBed.configureTestingModule({
        imports: [HeldResultPresentationComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(HeldResultPresentationComponent);
      fixture.componentRef.setInput('fields', fields);
      fixture.componentRef.setInput('result', {
        ...result(rows),
        nativeDirect: true,
        provenance: {
          source: 'https://cloud.openvaultdb.com/v1/tugql (direct OVDB)',
          mode: 'live',
          observedAt: '2026-10-19T00:00:00Z',
          ...(profile ? { executionProfile: profile } : {}),
        },
      });
      fixture.detectChanges();
      const text =
        fixture.nativeElement.querySelector('.source-details').textContent;
      expect(text).toContain(profile ?? 'OVDB server');
      if (!profile) expect(text).not.toContain('protected');
      expect(text).not.toContain('MIT');
    },
  );

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
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
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

describe('grouped held-result view', () => {
  it.each([
    [1e-20, 2e-20, 50, 100],
    [-1e-20, -2e-20, 50, 100],
    [-1e-20, 2e-20, 100 / 3, 200 / 3],
    [0, 0, 0, 0],
  ])(
    'scales tiny finite values %s/%s without an epsilon floor',
    async (a, b, wa, wb) => {
      await TestBed.configureTestingModule({
        imports: [HeldResultPresentationComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(HeldResultPresentationComponent);
      fixture.componentRef.setInput('result', {
        ...result([]),
        recordset: {
          columns: [
            { name: 'category', type: 'string' },
            { name: 'a', type: 'number' },
            { name: 'b', type: 'number' },
          ],
          rows: [
            [
              { type: 'string', value: 'Tiny' },
              { type: 'number', value: a },
              { type: 'number', value: b },
            ],
          ],
        },
      });
      fixture.componentRef.setInput('fields', {
        categoryColumn: 'category',
        series: [
          { id: 'a', title: 'A', valueColumn: 'a' },
          { id: 'b', title: 'B', valueColumn: 'b' },
        ],
        unit: 'units',
      });
      fixture.detectChanges();
      const bars = fixture.nativeElement.querySelectorAll('.bar-fill');
      expect(parseFloat(bars[0].style.width)).toBeCloseTo(wa);
      expect(parseFloat(bars[1].style.width)).toBeCloseTo(wb);
      expect(Number.isFinite(fixture.componentInstance.groupedLeft(0))).toBe(
        true,
      );
    },
  );

  it('renders every declared series with exact signed/fractional values and keeps focused selection on the same held chart', async () => {
    await TestBed.configureTestingModule({
      imports: [HeldResultPresentationComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HeldResultPresentationComponent);
    const series = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      title: `Source ${i}`,
      valueColumn: `v${i}`,
    }));
    const held = {
      ...result([]),
      recordset: {
        columns: [
          { name: 'country', type: 'string' },
          ...series.map((item) => ({ name: item.valueColumn, type: 'number' })),
        ],
        rows: [
          [
            { type: 'string' as const, value: 'Canada' },
            ...series.map((_, i) => ({
              type: 'number' as const,
              value: (i - 2) * 1.25,
            })),
          ],
        ],
      },
    };
    fixture.componentRef.setInput('result', held);
    fixture.componentRef.setInput('fields', {
      categoryColumn: 'country',
      series,
      title: 'Comparison',
      unit: 'units',
    });
    fixture.componentRef.setInput('selectionEnabled', true);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('.grouped-measure'),
    ).toHaveLength(8);
    expect(
      fixture.nativeElement
        .querySelector('.grouped-bars')
        .getAttribute('aria-label'),
    ).toBe('Comparison');
    expect(fixture.nativeElement.textContent).toContain(
      'common scale from -2.5 to 6.25',
    );
    expect(
      fixture.nativeElement.querySelectorAll('.exact-value')[2].textContent,
    ).toBe('0');
    const button = fixture.nativeElement.querySelector(
      '.grouped-bars button',
    ) as HTMLButtonElement;
    const select = vi.fn();
    fixture.componentInstance.categorySelected.subscribe(select);
    button.focus();
    button.click();
    expect(select).toHaveBeenCalledWith('Canada');
    fixture.componentRef.setInput('selectedCategory', 'Canada');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.grouped-bars button')).toBe(
      button,
    );
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(button);
    fixture.componentRef.setInput('result', { ...held, truncated: true });
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelectorAll('.grouped-bars button'),
    ).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain(
      'Grouped bars require a complete held result.',
    );
  });
});

it('keeps selected country and Clear outside view-specific content while native sorting preserves held rows and focus', async () => {
  await TestBed.configureTestingModule({
    imports: [HeldResultPresentationComponent],
  }).compileComponents();
  const fixture = TestBed.createComponent(HeldResultPresentationComponent);
  const held = {
    ...result([]),
    recordset: {
      columns: [
        { name: 'country', type: 'string' },
        { name: 'n', type: 'integer' },
        { name: 'c', type: 'integer' },
      ],
      rows: [
        ['USA', 13, 13],
        ['Canada', 3, 8],
        ['Brazil', 9, 2],
      ].map(([country, n, c]) => [
        { type: 'string' as const, value: String(country) },
        { type: 'integer' as const, value: String(n) },
        { type: 'integer' as const, value: String(c) },
      ]),
    },
  };
  const before = JSON.stringify(held);
  fixture.componentRef.setInput('result', held);
  fixture.componentRef.setInput('fields', {
    categoryColumn: 'country',
    title: 'Country comparison',
    unit: 'customer records',
    series: [
      { id: 'northwind', title: 'Northwind', valueColumn: 'n' },
      { id: 'chinook', title: 'Chinook', valueColumn: 'c' },
    ],
  });
  fixture.componentRef.setInput('selectionEnabled', true);
  fixture.componentRef.setInput('selectedCategory', 'Canada');
  await fixture.whenStable();
  const select = fixture.nativeElement.querySelector(
    'select[aria-label="Chart order"]',
  ) as HTMLSelectElement;
  const names = () =>
    [...fixture.nativeElement.querySelectorAll('.grouped-bars strong')].map(
      (node) => (node as HTMLElement).textContent?.trim(),
    );
  expect(select.value).toBe('country');
  expect(names()).toEqual(['Brazil', 'Canada', 'USA']);
  select.focus();
  select.value = 'difference';
  select.dispatchEvent(new Event('change'));
  await fixture.whenStable();
  expect(names()).toEqual(['Brazil', 'USA', 'Canada']);
  expect(document.activeElement).toBe(select);
  expect(fixture.nativeElement.textContent).toContain(
    'Selected country: Canada',
  );
  expect(
    [...fixture.nativeElement.querySelectorAll('.grouped-bars button')]
      .find((node) => (node as HTMLElement).textContent?.includes('Canada'))
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
  fixture.componentInstance.view.set('grid');
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain(
    'Selected country: Canada',
  );
  expect(
    fixture.nativeElement.querySelector('tbody tr td').textContent,
  ).toContain('USA');
  const cleared = vi.fn();
  fixture.componentInstance.selectionCleared.subscribe(cleared);
  const clear = [...fixture.nativeElement.querySelectorAll('button')].find(
    (node) => (node as HTMLElement).textContent?.trim() === 'Clear country',
  ) as HTMLButtonElement;
  clear.click();
  expect(cleared).toHaveBeenCalledOnce();
  expect(JSON.stringify(held)).toBe(before);
  expect(fixture.componentInstance.result).toBe(held);
});

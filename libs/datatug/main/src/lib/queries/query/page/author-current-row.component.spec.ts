import { TestBed } from '@angular/core/testing';
import type { TypedValue } from '@sneat/datatug-semantic';
import { AuthorCurrentRowComponent } from './author-current-row.component';

describe('AuthorCurrentRowComponent', () => {
  it('does not invent a total for a partial result page', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorCurrentRowComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthorCurrentRowComponent);
    fixture.componentRef.setInput('row', [
      { type: 'integer', value: '101' },
    ] satisfies readonly TypedValue[]);
    fixture.componentRef.setInput('position', 101);
    fixture.componentRef.setInput('totalRows', 100);
    fixture.componentRef.setInput('totalKnown', false);
    fixture.detectChanges();

    const text = fixture.nativeElement.innerHTML as string;
    expect(text).toContain('Position 101');
    expect(text).toContain('total unknown');
    expect(text).not.toContain('Position 101 of 100');
  });

  it('keeps duplicate columns and typed null, missing, empty, false, and zero distinct', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorCurrentRowComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthorCurrentRowComponent);
    fixture.componentRef.setInput('columns', [
      { name: 'value', type: 'string' },
      { name: 'value', type: 'integer' },
      { name: 'nullable', type: 'null' },
      { name: 'empty', type: 'string' },
      { name: 'enabled', type: 'boolean' },
      { name: 'zero', type: 'integer' },
      { name: 'missing', type: 'string' },
    ]);
    fixture.componentRef.setInput('row', [
      { type: 'string', value: 'first' },
      { type: 'integer', value: '900719925474099312345' },
      { type: 'null', value: null },
      { type: 'string', value: '' },
      { type: 'boolean', value: false },
      { type: 'integer', value: '0' },
    ] satisfies readonly TypedValue[]);
    fixture.componentRef.setInput('position', 3);
    fixture.componentRef.setInput('totalRows', 7);
    fixture.detectChanges();

    const text = [
      ...fixture.nativeElement.querySelectorAll('h2, h3, h4, p, ion-note'),
    ]
      .map((element: Element) => element.textContent)
      .join(' ');
    expect(text).toContain('Position 3 of 7');
    expect(text).toContain('column 1');
    expect(text).toContain('column 2');
    expect(text).toContain('SQL NULL');
    expect(text).toContain('Missing value');
    expect(text).toContain('(empty string)');
    expect(text).toContain('false');
    expect(text).toContain('900719925474099312345');
    const fields = fixture.nativeElement.querySelectorAll(
      '[data-testid="author-current-row-field"]',
    ) as NodeListOf<HTMLElement>;
    expect(
      fields[5]?.querySelector('.author-current-row-value')?.textContent,
    ).toBe('0');
    expect(
      fields[6]?.querySelector('.author-current-row-value')?.textContent,
    ).toBe('Missing value');
  });

  it('resets scroll when the row or result snapshot changes and preserves it across layout checks', async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorCurrentRowComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthorCurrentRowComponent);
    const firstSnapshot = {};
    fixture.componentRef.setInput('snapshotKey', firstSnapshot);
    fixture.componentRef.setInput('row', [
      { type: 'integer', value: '1' },
    ] satisfies readonly TypedValue[]);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    host.scrollTop = 72;
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.scrollTop).toBe(72);

    fixture.componentRef.setInput('row', [
      { type: 'integer', value: '2' },
    ] satisfies readonly TypedValue[]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.scrollTop).toBe(0);

    host.scrollTop = 43;
    fixture.componentRef.setInput('snapshotKey', {});
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.scrollTop).toBe(0);
  });

  it('copies every ordered column with exact typed values and scopes actions to the selected snapshot', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    );
    const writeText = vi.fn(async (value: string) => {
      void value;
    });
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      await TestBed.configureTestingModule({
        imports: [AuthorCurrentRowComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(AuthorCurrentRowComponent);
      const row = [
        { type: 'integer', value: '900719925474099312345' },
        { type: 'boolean', value: false },
        { type: 'null', value: null },
      ] satisfies readonly TypedValue[];
      const snapshot = {};
      fixture.componentRef.setInput('columns', [
        { name: 'same', type: 'integer' },
        { name: 'same', type: 'boolean' },
        { name: 'nullable', type: 'null' },
        { name: 'missing', type: 'string' },
      ]);
      fixture.componentRef.setInput('row', row);
      fixture.componentRef.setInput('snapshotKey', snapshot);
      fixture.detectChanges();
      const filtered = vi.fn();
      fixture.componentInstance.useAsFilter.subscribe(filtered);
      fixture.componentInstance.requestFilter(0);
      expect(filtered).toHaveBeenCalledWith({
        index: 0,
        row,
        snapshotKey: snapshot,
      });
      fixture.componentInstance.copyRecord();
      await fixture.whenStable();
      expect(JSON.parse(writeText.mock.calls[0]?.[0] ?? '')).toEqual([
        {
          index: 0,
          column: 'same',
          type: 'integer',
          value: '900719925474099312345',
        },
        { index: 1, column: 'same', type: 'boolean', value: false },
        { index: 2, column: 'nullable', type: 'null', value: null },
        { index: 3, column: 'missing', type: 'missing' },
      ]);
      fixture.componentInstance.copyValue(2);
      await fixture.whenStable();
      expect(writeText.mock.calls[1]?.[0]).toBe('null');
      fixture.componentInstance.copyValue(3);
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(fixture.componentInstance.copyStatus()).toBe('No value is available to copy for this column.');
    } finally {
      if (originalClipboard)
        Object.defineProperty(
          globalThis.navigator,
          'clipboard',
          originalClipboard,
        );
      else Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });

  it('does not show late copy feedback on a different result snapshot', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    );
    let finishWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    try {
      await TestBed.configureTestingModule({
        imports: [AuthorCurrentRowComponent],
      }).compileComponents();
      const fixture = TestBed.createComponent(AuthorCurrentRowComponent);
      const row = [
        { type: 'integer', value: '1' },
      ] satisfies readonly TypedValue[];
      fixture.componentRef.setInput('columns', [
        { name: 'InvoiceId', type: 'integer' },
      ]);
      fixture.componentRef.setInput('row', row);
      fixture.componentRef.setInput('snapshotKey', {});
      fixture.detectChanges();
      fixture.componentInstance.copyRecord();
      expect(writeText).toHaveBeenCalledOnce();
      fixture.componentRef.setInput('filterStatus', 'Filter added to draft');
      fixture.componentInstance.requestFilter(0);
      expect(fixture.componentInstance.copyStatus()).toBe('');
      fixture.componentRef.setInput('snapshotKey', {});
      fixture.detectChanges();
      finishWrite?.();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(fixture.componentInstance.copyStatus()).toBe('');
      expect(fixture.componentInstance.filterStatus()).toBe('Filter added to draft');
    } finally {
      if (originalClipboard)
        Object.defineProperty(
          globalThis.navigator,
          'clipboard',
          originalClipboard,
        );
      else Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });
});

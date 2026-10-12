import { TestBed } from '@angular/core/testing';
import type { TypedValue } from '@sneat/datatug-semantic';
import { AuthorCurrentRowComponent } from './author-current-row.component';

describe('AuthorCurrentRowComponent', () => {
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

    const text = [...fixture.nativeElement.querySelectorAll('h3, h4, p, ion-note')]
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
    expect(fields[5]?.querySelector('.author-current-row-value')?.textContent).toBe(
      '0',
    );
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
});

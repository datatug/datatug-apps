import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import type { TypedValue } from '@sneat/datatug-semantic';
import { ParameterLookupComponent } from './parameter-lookup.component';
import type { ParameterLookupPage, ParameterLookupProvider } from './parameter-lookup-provider';
import type { IParameterDef } from '../../models/definition/parameter';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';

const s = (value: string): TypedValue => ({ type: 'string', value });

const page = (patch: Partial<ParameterLookupPage> = {}): ParameterLookupPage => ({
  collection: 'Customers',
  columns: [
    { name: 'CustomerID', label: 'CustomerID', key: true },
    { name: 'CompanyName', label: 'Company', key: false },
  ],
  rows: [
    [s('ALFKI'), s('Alfreds Futterkiste')],
    [s('BOTTM'), s('Bottom-Dollar Markets')],
  ],
  limited: false,
  ...patch,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('ParameterLookupComponent', () => {
  let fixture: ComponentFixture<ParameterLookupComponent>;
  let dismiss: ReturnType<typeof vi.fn>;
  let search: ReturnType<typeof vi.fn>;

  const create = async (
    provider: Partial<ParameterLookupProvider> = {},
    parameter: IParameterDef = { id: 'CustomerID', type: 'string', meta: { entity: 'Customer', field: 'ID' } },
    currentValue?: string,
    stable = true,
  ) => {
    fixture = TestBed.createComponent(ParameterLookupComponent);
    fixture.componentRef.setInput('parameter', parameter);
    fixture.componentRef.setInput('provider', {
      subject: 'Customer',
      sources: [{ id: 'nw', label: 'Customers · northwind' }],
      search,
      ...provider,
    });
    if (currentValue !== undefined) fixture.componentRef.setInput('currentValue', currentValue);
    fixture.detectChanges();
    if (stable) await fixture.whenStable();
    return fixture;
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const status = () => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="parameter-lookup-status"]')?.textContent?.trim();

  beforeEach(async () => {
    dismiss = vi.fn(() => Promise.resolve(true));
    search = vi.fn(() => Promise.resolve(page()));
    await TestBed.configureTestingModule({
      imports: [ParameterLookupComponent],
      providers: [provideMockErrorLogger(), { provide: ModalController, useValue: { dismiss } }],
    })
      .overrideComponent(ParameterLookupComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } })
      .compileComponents();
  });

  it('titles the dialog and lists the rows of the only source once they arrive (zoneless)', async () => {
    const answer = deferred<ParameterLookupPage>();
    search.mockReturnValueOnce(answer.promise);
    await create({}, undefined, undefined, false);
    fixture.detectChanges();
    expect(text()).toContain('Find Customer');
    expect(status()).toContain('Searching Customer…');
    answer.resolve(page());
    await fixture.whenStable();
    expect(search).toHaveBeenCalledWith('nw', '', expect.any(AbortSignal));
    expect(fixture.nativeElement.querySelectorAll('[data-testid="parameter-lookup-row"]')).toHaveLength(2);
    expect(text()).toContain('Bottom-Dollar Markets');
    expect(text()).toContain('Company');
    expect(status()).toBe('2 matches.');
    expect(fixture.componentInstance.selectedIndex()).toBeUndefined();
  });

  it('shows only the newest filter result and aborts the older search', async () => {
    const first = deferred<ParameterLookupPage>();
    await create();
    // Same row count: happy-dom cannot remove upgraded ion-radio rows (Ionic removeChild recursion).
    search.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page({ rows: [[s('BOTTM'), s('Bottom-Dollar Markets')], [s('BOTTX'), s('Bottom Two')]] }));
    fixture.componentInstance.onFilter('b');
    const firstSignal = search.mock.calls.at(-1)?.[2] as AbortSignal;
    fixture.componentInstance.onFilter('  bott ');
    expect(firstSignal.aborted).toBe(true);
    await Promise.resolve();
    first.resolve(page({ rows: [[s('STALE'), s('Stale')], [s('STALE2'), s('Stale 2')]] }));
    await fixture.whenStable();
    expect(search).toHaveBeenLastCalledWith('nw', 'bott', expect.any(AbortSignal));
    expect(text()).toContain('Bottom Two');
    expect(text()).not.toContain('Stale');
    fixture.componentInstance.onFilter('bott');
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('asks for a source first when several are possible and none is preselected', async () => {
    await create({ sources: [{ id: 'nw', label: 'Customers · northwind' }, { id: 'ch', label: 'Customer · chinook' }] });
    expect(search).not.toHaveBeenCalled();
    expect(status()).toBe('Choose where to look up Customer.');
    fixture.componentInstance.chooseSource('ch');
    fixture.componentInstance.chooseSource('ch');
    fixture.componentInstance.chooseSource(undefined);
    await fixture.whenStable();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('ch', '', expect.any(AbortSignal));
  });

  it('checks several sources on open and keeps only the usable ones', async () => {
    const prepare = vi.fn(() => Promise.resolve({ sources: [{ id: 'nw', label: 'Customers · northwind' }], preselectedSourceId: 'nw' }));
    await create({ sources: [{ id: 'nw', label: 'n' }, { id: 'or', label: 'Orders' }], prepare });
    expect(prepare).toHaveBeenCalled();
    expect(fixture.componentInstance.sourceOptions()).toEqual([{ id: 'nw', label: 'Customers · northwind' }]);
    expect(search).toHaveBeenCalledWith('nw', '', expect.any(AbortSignal));
  });

  it('says when no source is usable, and falls back to all sources when the check fails', async () => {
    const none = vi.fn(() => Promise.resolve({ sources: [], unavailable: 'No table can be used for this lookup: Orders it has no single-column primary key on CustomerID.' }));
    await create({ sources: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], prepare: none });
    expect(status()).toContain('No table can be used');
    expect(search).not.toHaveBeenCalled();
    const failing = vi.fn(() => Promise.reject(new Error('worker')));
    await create({ sources: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], preselectedSourceId: 'b', prepare: failing });
    expect(search).toHaveBeenCalledWith('b', '', expect.any(AbortSignal));
  });

  it('shows the check in progress', async () => {
    const pending = deferred<{ sources: { id: string; label: string }[] }>();
    await create({ sources: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], prepare: () => pending.promise }, undefined, undefined, false);
    fixture.detectChanges();
    expect(status()).toBe('Checking where to look up Customer…');
    fixture.destroy();
    pending.resolve({ sources: [] });
    await Promise.resolve();
    expect(search).not.toHaveBeenCalled();
  });

  it('preselects the host source and the current value', async () => {
    await create({
      sources: [{ id: 'nw', label: 'n' }, { id: 'ch', label: 'c' }],
      preselectedSourceId: 'nw',
    }, undefined, 'BOTTM');
    expect(search).toHaveBeenCalledWith('nw', '', expect.any(AbortSignal));
    expect(fixture.componentInstance.selectedIndex()).toBe(1);
  });

  it('explains empty, limited, unavailable, inferred and limitation states', async () => {
    search.mockResolvedValueOnce(page({ rows: [] }));
    await create();
    expect(status()).toBe('Customers has no rows.');
    search.mockResolvedValueOnce(page({ rows: [] }));
    fixture.componentInstance.onFilter('zzz');
    await fixture.whenStable();
    expect(status()).toContain('No Customers match "zzz".');
    expect(text()).toContain('Clear filter');
    search.mockResolvedValueOnce(page({ limited: true, inferredNote: 'Columns guessed: declare display on entity Customer to choose them.', limitations: ['Some columns are hidden by policy.'] }));
    fixture.componentInstance.clearFilter();
    await fixture.whenStable();
    expect(status()).toBe('Showing the first 50 matches. Type to narrow the list.');
    expect(text()).toContain('Columns guessed');
    expect(text()).toContain('Some columns are hidden by policy.');
    search.mockResolvedValueOnce(page({ limited: true, limitNotice: 'Filtering the first 1000 rows of the lookup query.' }));
    fixture.componentInstance.onFilter('a');
    await fixture.whenStable();
    expect(status()).toBe('Filtering the first 1000 rows of the lookup query.');
    search.mockResolvedValueOnce(page({ rows: [], columns: [], unavailable: 'Customers cannot be used for this lookup: it has no single-column primary key on CustomerID.' }));
    fixture.componentInstance.onFilter('ab');
    await fixture.whenStable();
    expect(status()).toContain('no single-column primary key');
  });

  it('shows a plain error with Retry and never the cause', async () => {
    search.mockRejectedValueOnce(new Error('SELECT secret FROM x'));
    await create();
    expect(status()).toContain('The lookup could not read Customer.');
    expect(text()).not.toContain('SELECT');
    expect(text()).toContain('Retry');
    fixture.componentInstance.retry();
    await fixture.whenStable();
    expect(status()).toBe('2 matches.');
  });

  it('ignores an aborted search', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    search.mockRejectedValueOnce(abort);
    await create();
    expect(fixture.componentInstance.error()).toBeUndefined();
  });

  it('dismisses with the typed key on Select, Enter or double-click, and with nothing on Cancel', async () => {
    await create();
    const component = fixture.componentInstance;
    component.select();
    expect(dismiss).not.toHaveBeenCalled();
    component.onSelectionChange(1);
    component.select();
    expect(dismiss).toHaveBeenLastCalledWith({ value: s('BOTTM') }, 'select', undefined);
    component.pickRow(0);
    expect(dismiss).toHaveBeenLastCalledWith({ value: s('ALFKI') }, 'select', undefined);
    const radio = document.createElement('ion-radio') as HTMLElement & { value?: unknown };
    radio.value = 1;
    const child = document.createElement('span');
    radio.appendChild(child);
    const enter = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(enter, 'target', { value: child });
    component.onListKeydown(enter);
    expect(dismiss).toHaveBeenLastCalledWith({ value: s('BOTTM') }, 'select', undefined);
    const calls = dismiss.mock.calls.length;
    component.onListKeydown(new KeyboardEvent('keydown', { key: 'a' }));
    const stray = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(stray, 'target', { value: document.createElement('div') });
    component.onListKeydown(stray);
    expect(dismiss.mock.calls.length).toBe(calls);
    component.onSelectionChange('x');
    expect(component.selectedIndex()).toBeUndefined();
    component.cancel();
    expect(dismiss).toHaveBeenLastCalledWith(undefined, 'cancel', undefined);
  });

  it('refuses a key the parameter cannot hold and says why', async () => {
    await create({}, { id: 'CustomerID', title: 'Customer', type: 'integer' });
    fixture.componentInstance.pickRow(0);
    await fixture.whenStable();
    expect(dismiss).not.toHaveBeenCalled();
    expect(text()).toContain("This record's key cannot be used for Customer: expected integer.");
  });

  it('builds an accessible row label and a grid template per column', async () => {
    await create();
    expect(fixture.componentInstance.rowLabel([s('BOTTM'), { type: 'null', value: null }, s('Tsawassen')])).toBe('BOTTM, Tsawassen');
    expect(fixture.componentInstance.gridTemplate()).toBe('minmax(7.5rem, 0.6fr) minmax(0, 1.5fr)');
    expect(fixture.componentInstance.cellText(undefined)).toBe('');
    fixture.destroy();
  });
});

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ParameterLookupButtonComponent, type ParameterLookupPick } from './parameter-lookup-button.component';
import { PARAMETER_LOOKUP_LOADER } from './parameter-lookup-loader';
import type { IParameterDef } from '../../models/definition/parameter';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';
import { ErrorLogger } from '@sneat/core';

const param: IParameterDef = { id: 'CustomerID', title: 'Customer', type: 'string', meta: { entity: 'Customer', field: 'ID' } };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ParameterLookupButtonComponent', () => {
  const lookup = { availability: vi.fn(), open: vi.fn(), dispose: vi.fn() };
  const loader = vi.fn(() => Promise.resolve(lookup));
  const yes = { available: true, inferred: false };
  const no = { available: false, inferred: false };

  const render = async (parameter: IParameterDef = param) => {
    const fixture = TestBed.createComponent(ParameterLookupButtonComponent);
    fixture.componentRef.setInput('parameter', parameter);
    fixture.componentRef.setInput('context', { projectRef: { storeId: 'github.com', projectId: 'p' } });
    fixture.componentRef.setInput('currentValue', 'ALFKI');
    const picks: ParameterLookupPick[] = [];
    fixture.componentInstance.picked.subscribe((p) => picks.push(p));
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
    fixture.detectChanges();
    return { fixture, picks, button: () => fixture.nativeElement.querySelector('[data-testid="parameter-lookup-button"]') as HTMLElement | null };
  };

  beforeEach(async () => {
    lookup.availability.mockReset().mockResolvedValue(yes);
    loader.mockReset().mockImplementation(() => Promise.resolve(lookup));
    lookup.open.mockReset().mockResolvedValue({ value: { type: 'string', value: 'BOTTM' } });
    await TestBed.configureTestingModule({
      imports: [ParameterLookupButtonComponent],
      providers: [provideMockErrorLogger(), { provide: PARAMETER_LOOKUP_LOADER, useValue: loader }],
    })
      .overrideComponent(ParameterLookupButtonComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  });

  it('shows a labelled button only when a lookup can work', async () => {
    const { button, fixture } = await render();
    // Ionic moves aria-label from the host into its inner native button.
    expect(button()).not.toBeNull();
    expect(fixture.componentInstance.label()).toBe('Find Customer');
    expect(button()?.getAttribute('title')).toBe('Find Customer');
    lookup.availability.mockResolvedValue(no);
    const hidden = await render({ ...param, id: 'Other', title: undefined });
    expect(hidden.button()).toBeNull();
  });

  it('says when the meaning was guessed from the parameter name', async () => {
    lookup.availability.mockResolvedValue({ available: true, inferred: true });
    const { button, fixture } = await render({ id: 'ShipCustomerID', type: 'string' });
    expect(button()).not.toBeNull();
    expect(fixture.componentInstance.label()).toBe('Find ShipCustomerID (meaning guessed from its name)');
  });

  it('emits the picked value in the parameter type and passes the current value', async () => {
    const { fixture, picks } = await render();
    await fixture.componentInstance.open();
    expect(lookup.open).toHaveBeenCalledWith(param, { projectRef: { storeId: 'github.com', projectId: 'p' } }, 'ALFKI');
    expect(picks).toEqual([{ value: 'BOTTM', key: { type: 'string', value: 'BOTTM' } }]);
    lookup.open.mockResolvedValueOnce(undefined);
    await fixture.componentInstance.open();
    lookup.open.mockResolvedValueOnce({ value: { type: 'string', value: 'X' } });
    fixture.componentRef.setInput('parameter', { ...param, type: 'integer' });
    await fixture.componentInstance.open();
    expect(picks).toHaveLength(1);
    expect(TestBed.inject(ErrorLogger).logError).toHaveBeenCalledWith(expect.any(Error), 'Parameter lookup pick dropped', { show: false });
  });

  it('logs a failure to open and ignores a second click while open', async () => {
    const { fixture } = await render();
    const errorLogger = TestBed.inject(ErrorLogger);
    let finish!: (v: undefined) => void;
    lookup.open.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const first = fixture.componentInstance.open();
    await fixture.componentInstance.open();
    expect(lookup.open).toHaveBeenCalledTimes(1);
    finish(undefined);
    await first;
    lookup.open.mockRejectedValueOnce(new Error('modal'));
    await fixture.componentInstance.open();
    expect(errorLogger.logError).toHaveBeenCalled();
  });

  it('keeps the last answer when an older availability check resolves late', async () => {
    let slow!: (v: typeof no) => void;
    lookup.availability.mockReturnValueOnce(new Promise<typeof no>((resolve) => { slow = resolve; }));
    lookup.availability.mockResolvedValueOnce(yes);
    const fixture = TestBed.createComponent(ParameterLookupButtonComponent);
    fixture.componentRef.setInput('parameter', param);
    fixture.detectChanges();
    fixture.componentRef.setInput('parameter', { ...param });
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
    slow(no);
    await settle();
    expect(fixture.componentInstance.available()).toBe(true);
    lookup.availability.mockRejectedValueOnce(new Error('x'));
    fixture.componentRef.setInput('parameter', { ...param, id: 'z' });
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
    expect(fixture.componentInstance.available()).toBe(true);
    fixture.destroy();
    await settle();
    expect(lookup.dispose).toHaveBeenCalled();
    // The lookup chunk is loaded once per button, never for a parameter that cannot have a picker.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loads nothing for a multi-value parameter, retries a failed load, and disposes a load that finishes after the host is gone', async () => {
    const multi = await render({ ...param, isMultiValue: true });
    expect(multi.button()).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    // The first load fails; a later need loads again, and opening works.
    loader.mockRejectedValueOnce(new Error('chunk'));
    const failed = await render();
    await failed.fixture.componentInstance.open();
    expect(loader.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(lookup.open).toHaveBeenCalled();
    let finish!: (api: typeof lookup) => void;
    loader.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    lookup.dispose.mockClear();
    lookup.open.mockClear();
    const late = await render();
    const opening = late.fixture.componentInstance.open();
    late.fixture.destroy();
    finish(lookup);
    await opening;
    await settle();
    expect(lookup.dispose).toHaveBeenCalled();
    expect(lookup.open).not.toHaveBeenCalled();
  });

});

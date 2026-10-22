import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ParameterLookupButtonComponent, type ParameterLookupPick } from './parameter-lookup-button.component';
import { ParameterLookupService } from './parameter-lookup.service';
import type { IParameterDef } from '../../models/definition/parameter';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';
import { ErrorLogger } from '@sneat/core';

const param: IParameterDef = { id: 'CustomerID', title: 'Customer', type: 'string', meta: { entity: 'Customer', field: 'ID' } };

describe('ParameterLookupButtonComponent', () => {
  const lookup = { isAvailable: vi.fn(), open: vi.fn() };

  const render = async (parameter: IParameterDef = param) => {
    const fixture = TestBed.createComponent(ParameterLookupButtonComponent);
    fixture.componentRef.setInput('parameter', parameter);
    fixture.componentRef.setInput('context', { projectRef: { storeId: 'github.com', projectId: 'p' } });
    fixture.componentRef.setInput('currentValue', 'ALFKI');
    const picks: ParameterLookupPick[] = [];
    fixture.componentInstance.picked.subscribe((p) => picks.push(p));
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
    return { fixture, picks, button: () => fixture.nativeElement.querySelector('[data-testid="parameter-lookup-button"]') as HTMLElement | null };
  };

  beforeEach(async () => {
    lookup.isAvailable.mockReset().mockResolvedValue(true);
    lookup.open.mockReset().mockResolvedValue({ value: { type: 'string', value: 'BOTTM' } });
    await TestBed.configureTestingModule({
      imports: [ParameterLookupButtonComponent],
      providers: [provideMockErrorLogger()],
    })
      .overrideComponent(ParameterLookupButtonComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [{ provide: ParameterLookupService, useValue: lookup }] },
      })
      .compileComponents();
  });

  it('shows a labelled button only when a lookup can work', async () => {
    const { button, fixture } = await render();
    // Ionic moves aria-label from the host into its inner native button.
    expect(button()).not.toBeNull();
    expect(fixture.componentInstance.label()).toBe('Find Customer');
    expect(button()?.getAttribute('title')).toBe('Find Customer');
    lookup.isAvailable.mockResolvedValue(false);
    const hidden = await render({ ...param, id: 'Other', title: undefined });
    expect(hidden.button()).toBeNull();
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
    let slow!: (v: boolean) => void;
    lookup.isAvailable.mockReturnValueOnce(new Promise<boolean>((resolve) => { slow = resolve; }));
    lookup.isAvailable.mockResolvedValueOnce(true);
    const fixture = TestBed.createComponent(ParameterLookupButtonComponent);
    fixture.componentRef.setInput('parameter', param);
    fixture.detectChanges();
    fixture.componentRef.setInput('parameter', { ...param });
    fixture.detectChanges();
    await fixture.whenStable();
    slow(false);
    await Promise.resolve();
    expect(fixture.componentInstance.available()).toBe(true);
    lookup.isAvailable.mockRejectedValueOnce(new Error('x'));
    fixture.componentRef.setInput('parameter', { ...param, id: 'z' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.available()).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import {
  MappedContextInputComponent,
  MappedInputChoice,
} from './mapped-context-input.component';
const choice: MappedInputChoice = {
  id: 'order',
  label: 'Order ID',
  type: 'integer',
  shape: 'scalar',
  scope: { environmentId: 'demo', identityDomain: 'source' },
  subject: {
    conceptId: 'shipping-order',
    fieldId: 'order_id',
    fieldMappingRef: 'mapping',
  },
};
describe('Mapped input explicit typed authoring', () => {
  it('uses selected admitted canonical field and preserves integer text, never a number alias', async () => {
    const f = TestBed.createComponent(MappedContextInputComponent);
    f.componentRef.setInput('choices', [choice]);
    f.detectChanges();
    await f.whenStable();
    const values = vi.fn();
    f.componentInstance.valuesChanged.subscribe(values);
    f.nativeElement
      .querySelector('ion-select')
      .dispatchEvent(
        new CustomEvent('ionChange', { detail: { value: 'order' } }),
      );
    await f.whenStable();
    f.nativeElement
      .querySelector('ion-input')
      .dispatchEvent(
        new CustomEvent('ionInput', { detail: { value: '11045' } }),
      );
    f.nativeElement.querySelector('ion-button').click();
    await f.whenStable();
    expect(values).toHaveBeenLastCalledWith({
      order_id: { type: 'integer', value: '11045' },
    });
    f.componentRef.setInput('choices', []);
    await f.whenStable();
    expect(values).toHaveBeenLastCalledWith({});
  });
  it('rejects invalid integer and unknown choices rather than coercing or inventing fields', async () => {
    const f = TestBed.createComponent(MappedContextInputComponent);
    f.componentRef.setInput('choices', [choice]);
    f.detectChanges();
    await f.whenStable();
    const values = vi.fn();
    f.componentInstance.valuesChanged.subscribe(values);
    f.componentInstance.choose('order');
    f.componentInstance.text.set('11045.5');
    f.componentInstance.add();
    await f.whenStable();
    expect(f.nativeElement.querySelector('[role=alert]')).not.toBeNull();
    expect(values).not.toHaveBeenCalled();
    f.componentInstance.choose('foreign');
    f.componentInstance.text.set('11045');
    f.componentInstance.add();
    expect(values).not.toHaveBeenCalled();
  });
});

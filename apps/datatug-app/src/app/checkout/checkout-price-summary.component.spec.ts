import { TestBed } from '@angular/core/testing';
import { CheckoutPriceSummaryComponent } from './checkout-price-summary.component';

it.each([
  ['DataTug Pro', 1900, '€19.00', '€190.00'],
  ['DataTug Business', 9900, '€99.00', '€990.00'],
])(
  'shows regular price and conditional discount before authentication for %s',
  async (name, monthly, regular, annual) => {
    const fixture = TestBed.createComponent(CheckoutPriceSummaryComponent);
    fixture.componentRef.setInput('planName', name);
    fixture.componentRef.setInput('monthlyMinor', monthly);
    fixture.componentRef.setInput('allowPeriodChange', true);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain(regular);
    expect(root.textContent).toContain(annual);
    expect(root.textContent).toContain('2 months free');
    expect(root.textContent).toContain('Confirmed after sign-in');
    const yearly = vi.fn();
    fixture.componentInstance.yearlySelected.subscribe(yearly);
    root.querySelector('button')?.click();
    expect(yearly).toHaveBeenCalledOnce();
    // Async quote and period changes must repaint without a manual detectChanges.
    fixture.componentRef.setInput('quote', {
      list: regular,
      discountAmount: '€5.70',
      due: '€13.30',
      discount: '30% launch discount',
    });
    await fixture.whenStable();
    expect(root.textContent).toContain('Final price');
    expect(root.textContent).toContain('€5.70');
    expect(root.textContent).toContain('€13.30');
    fixture.componentRef.setInput('yearly', true);
    await fixture.whenStable();
    expect(root.textContent).not.toContain('2 months free');
    expect(root.textContent).toContain('Billed yearly');
  },
);

it('discloses base and first-month terms without implying automatic Pro cancellation', async () => {
  const fixture = TestBed.createComponent(CheckoutPriceSummaryComponent);
  fixture.componentRef.setInput('planName', 'Business');
  fixture.componentRef.setInput('monthlyMinor', 9900);
  fixture.componentRef.setInput('business', true);
  fixture.componentRef.setInput('quote', {
    list: '€99.00',
    due: '€99.00',
    discountAmount: '€0.00',
  });
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain(
    'base subscription is payable',
  );
  expect(fixture.nativeElement.textContent).toContain('You can keep Pro');
  expect(fixture.nativeElement.textContent).toContain('several spaces');
  expect(fixture.nativeElement.querySelector('button')).toBeNull();
});

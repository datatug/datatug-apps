import { TestBed } from '@angular/core/testing';
import { CheckoutPriceSummaryComponent } from './checkout-price-summary.component';

it.each([
  ['DataTug Pro', 1900, '€19.00', '€13.30'],
  ['DataTug Business', 9900, '€99.00', '€69.30'],
])(
  'shows regular price and conditional discount while the quote is pending for %s',
  async (name, monthly, regular, estimate) => {
    const fixture = TestBed.createComponent(CheckoutPriceSummaryComponent);
    fixture.componentRef.setInput('planName', name);
    fixture.componentRef.setInput('monthlyMinor', monthly);
    fixture.componentRef.setInput('allowPeriodChange', true);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain(regular);
    expect(root.textContent).toContain(estimate);
    expect(root.textContent).toContain('2 months free');
    expect(root.textContent).toContain('30-day money-back guarantee');
    expect(root.textContent?.replace(/\s+/g, ' ')).toContain(
      'Separate usage and add-ons are excluded.',
    );
    expect(root.querySelector('.guarantee a')?.getAttribute('href')).toBe(
      'https://datatug.app/en/terms/',
    );
    expect(root.textContent).toContain(
      'subject to availability and eligibility',
    );
    const yearly = vi.fn();
    fixture.componentInstance.periodSelected.subscribe(yearly);
    root.querySelector<HTMLButtonElement>('.yearly-link')?.click();
    expect(yearly).toHaveBeenCalledOnce();
    // Async quote and period changes must repaint without a manual detectChanges.
    fixture.componentRef.setInput('quote', {
      list: regular,
      discountAmount: '€5.70',
      due: '€13.30',
      discount: '30% launch discount',
    });
    await fixture.whenStable();
    expect(root.textContent).toContain('Due today');
    expect(root.textContent).toContain('€5.70');
    expect(root.textContent).toContain('€13.30');
    fixture.componentRef.setInput('yearly', true);
    await fixture.whenStable();
    expect(root.textContent).not.toContain('2 months free');
    expect(
      root.querySelector('[role=tabpanel]')?.getAttribute('aria-label'),
    ).toBe('Billed yearly');
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
  expect(fixture.nativeElement.querySelector('.yearly-link')).toBeNull();
});

it('discloses invitation expiry separately from due today and preserves yearly units', async () => {
  const fixture = TestBed.createComponent(CheckoutPriceSummaryComponent);
  fixture.componentRef.setInput('planName', 'DataTug Business');
  fixture.componentRef.setInput('monthlyMinor', 9900);
  fixture.componentRef.setInput('business', true);
  fixture.componentRef.setInput('yearly', true);
  fixture.componentRef.setInput('quote', {
    list: '€990.00',
    due: '€495.00',
    renewal: '€693.00',
    invitationMonths: 12,
  });
  await fixture.whenStable();
  const text = fixture.nativeElement.textContent.replace(/\s+/g, ' ');
  expect(text).toContain('Due today');
  expect(text).toContain('discount lasts 12 months');
  expect(text).toContain('€693.00 per year');
  expect(text).toContain('does not postpone billing');
});

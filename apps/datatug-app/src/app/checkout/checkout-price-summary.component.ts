import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { CheckoutState } from './checkout-contracts';

/** Shared presentation only. Eligibility and amounts remain server-authoritative. */
@Component({
  selector: 'datatug-checkout-price-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Subscription price" class="price-card">
      <h2>{{ planName() }}</h2>
      <p>{{ yearly() ? 'Billed yearly' : 'Billed monthly' }} · VAT included</p>
      <dl>
        <dt>Regular price</dt>
        <dd>{{ quote()?.list ?? regular() }}</dd>
        <dt>Discount</dt>
        <dd>
          {{
            quote()
              ? (quote()?.discountAmount ?? '€0.00')
              : 'Confirmed after sign-in'
          }}
        </dd>
        <dt>
          {{
            quote()
              ? 'Final price'
              : 'Regular price before any eligible discount'
          }}
        </dt>
        <dd class="final">
          {{ quote()?.due ?? regular() }} / {{ yearly() ? 'year' : 'month' }}
        </dd>
      </dl>
      @if (quote()?.discount) {
        <p>{{ quote()?.discount }}</p>
      }
      @if (!quote()) {
        <p>
          Eligible subscriptions receive 30% launch discount, subject to
          availability. Your confirmed price appears before payment.
        </p>
      }
      @if (!yearly()) {
        <p>Yearly: <strong>2 months free</strong> on the base subscription.</p>
        <p>
          {{ annual() }} billed once per year before any eligible launch
          discount.
        </p>
        @if (allowPeriodChange()) {
          <button type="button" (click)="yearlySelected.emit()">
            Choose yearly
          </button>
        }
      }
      @if (business()) {
        <p>
          Your first subscription month includes unlimited active users with no
          extra usage charges. The base subscription is payable.
        </p>
        <p>
          You can keep Pro and purchase Business for several spaces. Each space
          can have one active DataTug base subscription.
        </p>
      } @else {
        <p>For your personal space · one Pro subscription per user.</p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-block: 1rem;
      }
      .price-card {
        border: 1px solid var(--ion-color-step-150, #ddd);
        border-radius: 0.8rem;
        padding: 1rem;
      }
      h2 {
        margin: 0;
        font-size: 1.25rem;
      }
      p {
        line-height: 1.45;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.65rem;
      }
      dd {
        margin: 0;
        text-align: end;
      }
      .final {
        font-weight: 700;
      }
      button {
        font: inherit;
        min-height: 2.75rem;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 3px solid var(--ion-color-primary);
        outline-offset: 2px;
      }
      @media (max-width: 360px) {
        dl {
          grid-template-columns: 1fr;
        }
        dd {
          text-align: start;
        }
      }
    `,
  ],
})
export class CheckoutPriceSummaryComponent {
  readonly planName = input.required<string>();
  readonly monthlyMinor = input.required<number>();
  readonly yearly = input(false);
  readonly business = input(false);
  readonly quote = input<CheckoutState['quote']>();
  readonly allowPeriodChange = input(false);
  readonly yearlySelected = output<void>();
  protected readonly regular = computed(() =>
    this.money(this.monthlyMinor() * (this.yearly() ? 10 : 1)),
  );
  protected readonly annual = computed(() =>
    this.money(this.monthlyMinor() * 10),
  );
  private money(minor: number): string {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(minor / 100);
  }
}

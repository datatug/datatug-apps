import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { IonCard } from '@ionic/angular/ion-card';
import { IonCardContent } from '@ionic/angular/ion-card-content';
import type { CheckoutState } from './checkout-contracts';

/** Shared presentation only. Eligibility and amounts remain server-authoritative. */
@Component({
  selector: 'datatug-checkout-price-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCard, IonCardContent],
  template: `
    <ion-card aria-label="Subscription price"
      ><ion-card-content>
        <h2>{{ planName() }}</h2>
        <div class="billing-line">
          <div
            class="period-tabs"
            role="tablist"
            aria-label="Billing period"
            (keydown)="periodKey($event)"
          >
            <button
              type="button"
              role="tab"
              aria-controls="subscription-prices"
              [attr.aria-selected]="!yearly()"
              [attr.tabindex]="yearly() ? -1 : 0"
              [disabled]="!allowPeriodChange()"
              (click)="periodSelected.emit('monthly')"
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-controls="subscription-prices"
              [attr.aria-selected]="yearly()"
              [attr.tabindex]="yearly() ? 0 : -1"
              [disabled]="!allowPeriodChange()"
              (click)="periodSelected.emit('yearly')"
            >
              Yearly
            </button>
          </div>
          <span class="tax-note">VAT included</span>
        </div>
        <dl
          id="subscription-prices"
          role="tabpanel"
          [attr.aria-label]="yearly() ? 'Billed yearly' : 'Billed monthly'"
        >
          <dt>Regular price</dt>
          <dd>{{ quote()?.list ?? regular() }}</dd>
          <dt>{{ quote() ? 'Discount' : 'Launch discount, if eligible' }}</dt>
          <dd>
            {{
              quote()
                ? (quote()?.discountAmount ?? '€0.00')
                : '−' + launchSaving() + ' (30%)'
            }}
          </dd>
          <dt>
            {{ quote() ? 'Final price' : 'Price with launch offer' }}
          </dt>
          <dd class="final">
            {{ quote()?.due ?? launchDue() }} /
            {{ yearly() ? 'year' : 'month' }}
          </dd>
        </dl>
        @if (!yearly()) {
          <p class="annual-offer">
            @if (allowPeriodChange()) {
              <button
                class="yearly-link"
                type="button"
                (click)="periodSelected.emit('yearly')"
              >
                Switch to yearly — <strong>2 months free</strong>
              </button>
            } @else {
              Yearly includes <strong>2 months free</strong> on the base
              subscription.
            }
          </p>
        }
        @if (quote()?.discount) {
          <p>{{ quote()?.discount }}</p>
        }
        @if (!quote()) {
          <p>
            Launch offer is subject to availability and eligibility. Your final
            price is confirmed before payment.
          </p>
        }
        <p class="guarantee">
          <a
            href="https://datatug.app/en/terms/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>30-day money-back guarantee</strong> </a
          ><br />
          Full refund of your first base payment if requested within 30 days,
          monthly or yearly. Separate usage and add-ons are excluded.
        </p>
        @if (business()) {
          <p>
            Your first subscription month includes unlimited active users with
            no extra usage charges. The base subscription is payable.
          </p>
          <p>
            You can keep Pro and purchase Business for several spaces. Each
            space can have one active DataTug base subscription.
          </p>
        } @else {
          <p>For your personal space · one Pro subscription per user.</p>
        }
        <ng-content /> </ion-card-content
    ></ion-card>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-block: 1rem;
      }
      ion-card {
        margin: 0;
        --background: #fff;
        --color: #19243a;
      }
      h2 {
        margin: 0 0 0.65rem;
        font-size: 1.25rem;
        font-weight: 650;
      }
      p {
        line-height: 1.5;
        margin: 0.75rem 0 0;
        font-size: 0.9rem;
        color: #536078;
      }
      .guarantee a {
        color: #254bb8;
      }
      .billing-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .period-tabs {
        display: flex;
        gap: 1.25rem;
      }
      .period-tabs button {
        min-height: 44px;
        padding: 0.5rem 0;
        border: 0;
        border-bottom: 2px solid transparent;
        background: none;
        color: #536078;
        font: inherit;
        cursor: pointer;
      }
      .period-tabs button[aria-selected='true'] {
        border-bottom-color: #315bd8;
        color: #254bb8;
        font-weight: 650;
      }
      button:disabled {
        cursor: default;
      }
      .tax-note {
        color: #536078;
        font-size: 0.8rem;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.75rem 1rem;
        margin: 1.2rem 0;
      }
      dt {
        color: #536078;
      }
      dd {
        margin: 0;
        text-align: end;
        font-variant-numeric: tabular-nums;
      }
      .final {
        color: #19243a;
        font-size: 1.15rem;
        font-weight: 700;
      }
      .annual-offer {
        text-align: end;
      }
      .yearly-link {
        padding: 0;
        min-height: 44px;
        border: 0;
        background: none;
        color: #254bb8;
        font: inherit;
        text-decoration: underline dashed;
        text-underline-offset: 0.3em;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 3px solid #315bd8;
        outline-offset: 3px;
      }
      @media (max-width: 360px) {
        dl {
          grid-template-columns: 1fr;
          gap: 0.4rem;
        }
        dd {
          text-align: start;
          margin-bottom: 0.45rem;
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
  readonly periodSelected = output<'monthly' | 'yearly'>();
  protected periodKey(event: KeyboardEvent): void {
    if (!this.allowPeriodChange()) return;
    let yearly: boolean;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        yearly = !this.yearly();
        break;
      case 'Home':
        yearly = false;
        break;
      case 'End':
        yearly = true;
        break;
      default:
        return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('button')
      [yearly ? 1 : 0]?.focus();
    this.periodSelected.emit(yearly ? 'yearly' : 'monthly');
  }
  protected readonly regular = computed(() =>
    this.money(this.monthlyMinor() * (this.yearly() ? 10 : 1)),
  );
  protected readonly launchSaving = computed(() =>
    this.money(
      Math.round(this.monthlyMinor() * (this.yearly() ? 10 : 1) * 0.3),
    ),
  );
  protected readonly launchDue = computed(() =>
    this.money(
      Math.round(this.monthlyMinor() * (this.yearly() ? 10 : 1) * 0.7),
    ),
  );
  private money(minor: number): string {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(minor / 100);
  }
}

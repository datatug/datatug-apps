import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { timeOutline } from 'ionicons/icons';
import { BusinessClockService } from './business-clock';

/**
 * The business clock of the current project's sources (heterogeneous-sources REQ:source-business-clock), shown
 * under the page title. Renders nothing when no source declares a clock or the read is unavailable.
 */
@Component({
  selector: 'sneat-datatug-business-clock',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The live region stays in the DOM so a changed clock (after a correction) is announced.
  template: `<span class="clocks" role="status">
    @for (clock of clocks(); track clock.sourceId) {
      <span
        class="clock"
        title="Business time of this data source, not your local time"
        ><ion-icon name="time-outline" aria-hidden="true" />{{ clock.label }}:
        {{ clock.text
        }}<span class="sr-only"
          >. Business time of this data source, not your local time.</span
        ></span
      >
    }
  </span>`,
  styles: `
    :host {
      display: block;
    }
    .clocks {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .clock {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      max-width: 100%;
      margin-block-start: 0.125rem;
      padding: 0 0.5rem;
      border: 1px solid var(--ion-color-step-250, rgba(0, 0, 0, 0.2));
      border-radius: 999px;
      color: var(--ion-color-step-700, var(--ion-text-color));
      font-size: 0.75rem;
      font-weight: 400;
      line-height: 1.5rem;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    ion-icon {
      flex: none;
      font-size: 0.875rem;
    }
  `,
})
export class BusinessClockChipComponent {
  // Outside the project routes (no source registrations) there is no clock to show.
  protected readonly clocks =
    inject(BusinessClockService, { optional: true })?.clocks ??
    signal([]).asReadonly();

  constructor() {
    addIcons({ timeOutline });
  }
}

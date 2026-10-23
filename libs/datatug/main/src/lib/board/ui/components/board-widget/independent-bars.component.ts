import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { IndependentBars } from './independent-bars';

@Component({
  selector: 'sneat-datatug-independent-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as bars) {
      <p>
        Exact country/category labels · {{ bars.groups.length }} categories ·
        Declared unit: {{ unit() }}
      </p>
      <p>
        Shared scale: {{ bars.minimum }} to {{ bars.maximum }}. Independent
        source comparison, not a federated query. Missing means no observation,
        never zero. No alias, currency or time normalization.
      </p>
      @if (!bars.groups.length) {
        <p>No categories in these source results.</p>
      }
      <ul aria-label="Independent source comparison">
        @for (group of bars.groups; track group.category) {
          <li>
            <strong>{{ group.category }}</strong>
            @for (source of bars.sources; track source; let i = $index) {
              <div class="series">
                <span>{{ source }}</span>
                @if (group.observations[i]; as observation) {
                  <span class="track" aria-hidden="true"
                    ><span
                      class="bar"
                      [class.second]="i === 1"
                      [style.margin-inline-start.%]="start(observation.value)"
                      [style.width.%]="width(observation.value)"
                    ></span
                  ></span>
                  <span>{{ observation.value }}</span>
                } @else {
                  <span class="missing">Missing</span>
                }
              </div>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--ion-background-color-step-150, #ddd);
    }
    .series {
      display: grid;
      grid-template-columns: minmax(4rem, 7rem) minmax(2rem, 1fr) auto;
      gap: 0.5rem;
      align-items: center;
      min-height: 1.6rem;
    }
    .track {
      display: block;
      min-width: 0;
    }
    .series > span:first-child,
    strong {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .bar {
      display: block;
      height: 0.8rem;
      background: var(--ion-color-primary, #2563eb);
      min-width: 0;
    }
    .bar.second {
      background: var(--ion-color-secondary, #0b8884);
    }
    .missing {
      grid-column: 2/4;
      color: var(--dt-text-muted, #555);
    }
  `,
})
export class IndependentBarsComponent {
  readonly data = input<IndependentBars | null>(null);
  readonly unit = input('');
  width(value: number): number {
    const data = this.data();
    return data && data.maximum !== data.minimum
      ? (Math.abs(value) / (data.maximum - data.minimum)) * 100
      : 0;
  }
  start(value: number): number {
    const data = this.data();
    return data && data.maximum !== data.minimum
      ? ((Math.min(value, 0) - data.minimum) / (data.maximum - data.minimum)) *
          100
      : 0;
  }
}

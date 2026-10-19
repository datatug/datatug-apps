import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ChartSeries } from '@datatug/board-models';

/** Presentation controls are separate from the chart/grid so selection stays visible. */
@Component({
  selector: 'sneat-datatug-held-result-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="controls">
      <label
        >Chart order
        <select
          aria-label="Chart order"
          [value]="order()"
          (change)="orderChanged.emit($any($event.target).value)"
        >
          <option value="country" [selected]="order() === 'country'">
            {{ categoryLabel().charAt(0).toUpperCase() + categoryLabel().slice(1) }} (A–Z)
          </option>
          @for (series of series(); track series.id; let i = $index) {
            <option
              [value]="'series:' + i"
              [selected]="order() === 'series:' + i"
            >
              {{ series.title }} (high to low)
            </option>
          }
          @if (series().length === 2) {
            <option
              value="difference"
              [selected]="order() === 'difference'"
              [disabled]="!differenceAvailable()"
            >
              Difference ({{ series()[0].title }} − {{ series()[1].title }})
            </option>
          }
        </select>
      </label>
      @if (series().length === 2 && !differenceAvailable()) {
        <p>Difference ordering requires integer measures.</p>
      }
      @if (selectedCategory() !== null) {
        <div role="status" class="selection">
          <span
            >Selected {{ categoryLabel().toLowerCase() }}:
            <strong>{{ selectedCategory() }}</strong></span
          >
          <button type="button" (click)="cleared.emit()">
            {{
              categoryLabel().toLowerCase() === 'country'
                ? 'Clear country'
                : 'Clear selection'
            }}
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .controls,
    label,
    .selection {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .controls {
      margin-block: 0.5rem;
      justify-content: space-between;
    }
    label {
      font-size: 0.85rem;
    }
    p {
      margin: 0;
      font-size: 0.8rem;
    }
    select,
    button {
      font: inherit;
      min-height: 2.75rem;
      padding: 0.4rem 0.65rem;
      border: 1px solid #a9bad0;
      border-radius: 0.5rem;
      color: #17213a;
      background: #f6f9fc;
    }
    button {
      cursor: pointer;
    }
    select {
      max-width: 100%;
    }
    select:focus-visible,
    button:focus-visible {
      outline: 3px solid #2563eb;
      outline-offset: 2px;
    }
  `,
})
export class HeldResultControlsComponent {
  readonly series = input<readonly ChartSeries[]>([]);
  readonly categoryLabel = input('Category');
  readonly order = input('country');
  readonly differenceAvailable = input(false);
  readonly selectedCategory = input<string | null>(null);
  readonly orderChanged = output<string>();
  readonly cleared = output<void>();
}

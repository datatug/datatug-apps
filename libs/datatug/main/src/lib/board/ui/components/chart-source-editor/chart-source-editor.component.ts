import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { IonButton } from '@ionic/angular';
import {
  editChartSources,
  type ChartSourceEdit,
  type ChartWidgetDef,
} from '@datatug/board-models';

/** Ordinary and session authoring share this control and the same pure source operation. */
@Component({
  selector: 'sneat-datatug-chart-source-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton],
  template: `
    <section aria-label="Chart sources">
      <h4>Sources</h4>
      @for (source of definition().sources; track source.id) {
        <p>
          {{ source.id }} · {{ source.queryId }}
          <ion-button
            size="small"
            fill="clear"
            [disabled]="disabled() || definition().sources.length === 1"
            (click)="remove(source.id)"
            >Remove {{ source.id }}</ion-button
          >
        </p>
      }
      @if (compatible()) {
        <p>
          Declared unit: {{ definition().chart.unit }}. Matching column names do
          not establish compatible units, dates or currencies.
        </p>
        @if (definition().sources.length < 2) {
          <label
            >Saved query to add
            <select
              aria-label="Saved query to add"
              [value]="queryId()"
              [disabled]="disabled()"
              (change)="choose($any($event.target).value)"
            >
              <option value="">Choose a saved query</option>
              @for (query of available(); track query.id) {
                <option [value]="query.id">
                  {{ query.title || query.id }}
                </option>
              }
            </select>
          </label>
          <label
            ><input
              type="checkbox"
              [checked]="confirmed()"
              [disabled]="disabled()"
              (change)="confirmed.set($any($event.target).checked)"
            />I confirm this query uses the declared common unit and compatible
            category/measure meanings.</label
          >
          <ion-button
            size="small"
            [disabled]="disabled() || !queryId() || !confirmed()"
            (click)="add()"
            >Add source</ion-button
          >
        } @else {
          <p>Two independent sources are configured.</p>
        }
      } @else {
        <p>
          Independent sources require a plain bar chart with a declared common
          unit. Races and single-result grouped/evidence charts keep their own
          source contract.
        </p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      padding-block: 0.5rem;
    }
    label {
      display: block;
      margin-block: 0.6rem;
    }
    select {
      max-width: 100%;
      min-height: 2.75rem;
    }
    input[type='checkbox'] {
      margin-inline-end: 0.5rem;
    }
  `,
})
export class ChartSourceEditorComponent {
  readonly definition = input.required<ChartWidgetDef>();
  readonly queries = input<
    readonly { id: string; title?: string; sourceId?: string }[]
  >([]);
  readonly disabled = input(false);
  readonly edit = output<ChartSourceEdit>();
  readonly queryId = signal('');
  readonly confirmed = signal(false);
  readonly error = signal('');
  readonly compatible = computed(
    () =>
      this.definition().chart.type === 'bar' &&
      !this.definition().chart.series &&
      !!this.definition().chart.unit?.trim(),
  );
  readonly available = computed(() =>
    this.queries().filter(
      (query) =>
        !this.definition().sources.some(
          (source) => source.queryId === query.id,
        ),
    ),
  );
  constructor() {
    let previousIdentity = '';
    effect(() => {
      const identity = JSON.stringify([this.definition(), this.queries()]);
      if (identity === previousIdentity) return;
      previousIdentity = identity;
      this.queryId.set('');
      this.confirmed.set(false);
      this.error.set('');
    });
  }
  choose(queryId: string): void {
    this.queryId.set(queryId);
    this.confirmed.set(false);
    this.error.set('');
  }
  add(): void {
    if (this.disabled() || !this.confirmed()) return;
    const queryId = this.queryId();
    // The saved query's final ID is a readable stable default; collisions are rejected, never silently renamed.
    const sourceId =
      this.available().find((query) => query.id === queryId)?.sourceId ||
      queryId.split('/').pop() ||
      '';
    this.apply({ type: 'add-chart-source', sourceId, queryId });
  }
  remove(sourceId: string): void {
    if (!this.disabled()) this.apply({ type: 'remove-chart-source', sourceId });
  }
  private apply(edit: ChartSourceEdit): void {
    try {
      editChartSources(
        this.definition(),
        edit,
        this.queries().map((query) => query.id),
      );
      this.edit.emit(edit);
      this.error.set('');
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'The source edit could not be applied.',
      );
    }
  }
}

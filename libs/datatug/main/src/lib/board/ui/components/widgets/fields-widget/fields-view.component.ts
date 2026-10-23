import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface FieldPair {
  label: string;
  value: string;
}

/** One record as a label/value list (the presentational half of the `fields` widget). */
@Component({
  selector: 'sneat-datatug-fields-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (title(); as heading) {
      <p class="widget-title">{{ heading }}</p>
    }
    <dl class="fields">
      @for (pair of pairs(); track $index) {
        <dt>{{ pair.label }}</dt>
        <dd>{{ pair.value }}</dd>
      }
    </dl>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .widget-title {
        margin: 0 0 0.25rem;
        font-weight: 600;
      }
      .fields {
        display: grid;
        grid-template-columns: minmax(6rem, max-content) 1fr;
        gap: 0.25rem 1rem;
        margin: 0;
      }
      dt {
        color: var(--dt-text-muted);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class FieldsViewComponent {
  readonly title = input<string>();
  readonly pairs = input<readonly FieldPair[]>([]);
}

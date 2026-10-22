import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { type SourceDetails } from './source-workspace-contract';

@Component({
  selector: 'sneat-source-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    h3,
    h4 {
      margin: 0.5rem 0 0.25rem;
      font-size: 1rem;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(6rem, 1fr) minmax(0, 3fr);
      gap: 0.25rem 0.75rem;
      margin: 0.25rem 0;
    }
    dt {
      color: var(--ion-text-color-step-350, var(--ion-text-color));
    }
    dd {
      margin: 0;
      white-space: pre-wrap;
    }
    .hash {
      font-family: monospace;
    }
    @media (max-width: 400px) {
      dl {
        grid-template-columns: 1fr;
      }
      dd {
        margin-bottom: 0.25rem;
      }
    }
  `,
  template: `<section [attr.aria-label]="details().title">
      <h3>{{ details().title }}</h3>
      @if (details().summary) {
        <p>{{ details().summary }}</p>
      }
      @for (section of details().sections; track $index) {
        @if (section.collapsed) {
          <details>
            <summary>{{ section.title }}</summary>
            <ng-container
              [ngTemplateOutlet]="factList"
              [ngTemplateOutletContext]="{ $implicit: section.facts }"
            />
          </details>
        } @else {
          <h4>{{ section.title }}</h4>
          <ng-container
            [ngTemplateOutlet]="factList"
            [ngTemplateOutletContext]="{ $implicit: section.facts }"
          />
        }
      }
    </section>
    <ng-template #factList let-facts>
      <dl>
        @for (fact of facts; track $index) {
          <dt>{{ fact.label }}</dt>
          <dd [class.hash]="fact.kind === 'hash'">
            @if (fact.kind === 'time') {
              <time [attr.datetime]="fact.value">{{ fact.value }}</time>
            } @else {
              {{ fact.value }}
            }
          </dd>
        }
      </dl>
    </ng-template>`,
})
export class SourceDetailsComponent {
  readonly details = input.required<SourceDetails>();
}

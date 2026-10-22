import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Footer of a result card (a table's rows, a query result): a compact note such as "Showing the first 100
 * rows." under the grid, set off by a thin line. A plain bordered row, not an `ion-item-divider`: the UI
 * book reserves dividers for naming groups of list items.
 */
@Component({
  selector: 'sneat-datatug-result-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'datatug-result-footer', role: 'note' },
  template: '<ng-content />',
  styles: `
    :host {
      display: block;
      padding: 8px 16px;
      border-top: 1px solid var(--ion-border-color, var(--ion-color-light-shade));
      color: var(--ion-color-medium);
      font-size: 13px;
    }
  `,
})
export class ResultFooterComponent {}

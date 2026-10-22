import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CardCellSelection, CardLookupService } from './card-lookup.service';
import { injectCardsContext } from './cards-context';
import { CellCardPanelComponent } from './cell-card-panel.component';
import { CellCardPopoverComponent } from './cell-card-popover.component';

/**
 * Project cards for the cell selected in a query result: a side pane (or a
 * tooltip popover, by the card's display) beside the results grid. The host
 * page forwards its grid's focused cell to {@link focusCell}; this component
 * owns the lookup, so the page itself stays free of card logic.
 */
@Component({
  selector: 'sneat-datatug-result-cell-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CardLookupService],
  imports: [CellCardPanelComponent, CellCardPopoverComponent],
  host: {
    '[class.cell-card-open]': 'lookup.panelOpen()',
    style: 'display: block; min-width: 0',
  },
  template: `
    <sneat-datatug-cell-card-panel />
    <sneat-datatug-cell-card-popover />
  `,
})
export class ResultCellCardsComponent {
  protected readonly lookup = inject(CardLookupService);

  constructor() {
    this.lookup.use(injectCardsContext());
  }

  /** The grid's selected cell changed (focus by mouse, touch or keyboard). */
  focusCell(cell: CardCellSelection): void {
    this.lookup.select(cell);
  }

  /** The selection is gone (no row, a group row, or the results changed). */
  clear(): void {
    this.lookup.clear();
  }
}

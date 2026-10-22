import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  output,
} from '@angular/core';
import { CardCellSelection, CardLookupService } from './card-lookup.service';
import { injectCardsContext } from './cards-context';
import { CellCardPanelComponent } from './cell-card-panel.component';
import { CellCardPopoverComponent } from './cell-card-popover.component';

/** Narrowest results area that still has room for the card beside the grid. */
export const SIDE_PANE_MIN_WIDTH = 640;

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
  },
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    :host(.cell-card-open) {
      position: sticky;
      top: 0.5rem;
      max-height: calc(100vh - 7rem);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
  `,
  template: `
    <sneat-datatug-cell-card-panel />
    <sneat-datatug-cell-card-popover />
  `,
})
export class ResultCellCardsComponent {
  protected readonly lookup = inject(CardLookupService);

  /** The card pane is open beside the results, so the page can make room for it. */
  readonly paneOpen = output<boolean>();
  private frame?: number;

  constructor() {
    this.lookup.use(injectCardsContext());
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.cancelFrame());
    effect(() => this.paneOpen.emit(this.lookup.panelOpen()));
    // Below this width of the area the results live in there is no room beside them: cards become popovers.
    const parent = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) =>
        this.lookup.compact.set(entry.contentRect.width < SIDE_PANE_MIN_WIDTH),
      );
      observer.observe(parent);
      destroyRef.onDestroy(() => observer.disconnect());
    }
  }

  private cancelFrame(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  /**
   * The grid's selected cell changed (focus by mouse, touch or keyboard). `anchorOf` finds the cell's element
   * (inside the caller's own grid) once the grid has drawn its focus, on the next frame; a newer selection or a
   * clear cancels the frame still pending.
   */
  focusCell(cell: CardCellSelection, anchorOf?: () => Element | null): void {
    this.cancelFrame();
    if (!anchorOf) {
      this.lookup.select(cell);
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const rect = anchorOf()?.getBoundingClientRect();
      this.lookup.select({
        ...cell,
        anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      });
    });
  }

  /** The selection is gone (no row, a group row, or the results changed). */
  clear(): void {
    this.cancelFrame();
    this.lookup.clear();
  }
}

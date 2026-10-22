import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { IonButton, IonPopover } from '@ionic/angular';
import { PROJECT_CARD_RESULTS } from '../board/core/board-query-results.service';
import { firstTabCard } from './card-model';
import { CardLookupService } from './card-lookup.service';
import { ProjectCardViewComponent } from './project-card-view.component';

/**
 * Tooltip mode of a matched card: a compact popover over the selected cell
 * showing the card's first tab, with "Open in panel". It opens when a cell is
 * selected (mouse, touch or keyboard focus) and closes on Escape or when the
 * selection changes. Mount it once next to the grid; it reads the page's
 * {@link CardLookupService}.
 */
@Component({
  selector: 'sneat-datatug-cell-card-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonPopover, IonButton, ProjectCardViewComponent],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <ion-popover
      reference="event"
      side="bottom"
      alignment="start"
      size="auto"
      cssClass="cell-card-popover"
      [isOpen]="lookup.tooltipOpen()"
      [event]="anchor()"
      [keepContentsMounted]="false"
      [dismissOnSelect]="false"
      [focusTrap]="false"
      [showBackdrop]="false"
      [backdropDismiss]="false"
      (didDismiss)="lookup.dismiss()"
    >
      <ng-template>
        <div class="tip" role="dialog" aria-label="Card for the selected cell">
          @if (compact(); as card) {
            <sneat-datatug-project-card-view
              [card]="card"
              [parameterValues]="lookup.values()"
              [projectRef]="lookup.projectRef()"
              [environment]="lookup.environment()"
              [boardContext]="lookup.runContext()"
              [cache]="cache"
            />
          } @else if (lookup.cardError(); as message) {
            <p role="alert">{{ message }}</p>
          } @else {
            <p role="status">Loading…</p>
          }
          <ion-button
            size="small"
            fill="clear"
            data-action="open-in-panel"
            (click)="openInPanel()"
            >Open in panel</ion-button
          >
        </div>
      </ng-template>
    </ion-popover>
  `,
  styles: [
    `
      .tip {
        min-width: 14rem;
        max-width: min(26rem, 90vw);
        max-height: 60vh;
        overflow: auto;
        padding: 0.25rem 0;
      }
      .tip p {
        margin: 0;
        padding: 0.5rem 1rem;
      }
      .tip ion-button {
        margin: 0 0.25rem;
      }
    `,
  ],
})
export class CellCardPopoverComponent {
  protected readonly lookup = inject(CardLookupService);
  protected readonly cache = inject(PROJECT_CARD_RESULTS);
  protected readonly compact = computed(() => {
    const card = this.lookup.card();
    return card ? firstTabCard(card) : undefined;
  });
  protected openInPanel(): void {
    this.lookup.setMode('panel');
  }

  /** Escape closes the tooltip; the grid behind it stays usable, so the popover has no backdrop to dismiss it. */
  protected onEscape(): void {
    if (this.lookup.tooltipOpen()) this.lookup.dismiss();
  }

  /** A pointer event at the selected cell, which is how the popover is anchored. */
  protected readonly anchor = computed(() => {
    const at = this.lookup.cell()?.anchor;
    return at
      ? new MouseEvent('click', { clientX: at.x, clientY: at.y })
      : undefined;
  });
}

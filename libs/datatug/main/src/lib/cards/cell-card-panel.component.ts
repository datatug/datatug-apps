import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  chatboxEllipsesOutline,
  closeOutline,
  refreshOutline,
} from 'ionicons/icons';
import { PROJECT_CARD_RESULTS } from '../board/core/board-query-results.service';
import { CardLookupService } from './card-lookup.service';
import { ProjectCardViewComponent } from './project-card-view.component';

addIcons({ chatboxEllipsesOutline, closeOutline, refreshOutline });

/** Up to this many matching cards show as tabs; more go in a select. */
const SEGMENT_MAX = 3;

/**
 * The card for the selected grid cell, as a side panel (spec REQ:
 * cell-to-card). One component for both grids: the table viewer puts it at
 * the top of its context side panel, query results in a side pane. It reads
 * the page's {@link CardLookupService}, shows nothing without a match, and
 * lets the user switch between matches, refresh, or show the card as a
 * tooltip for the rest of the session.
 */
@Component({
  selector: 'sneat-datatug-cell-card-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ProjectCardViewComponent,
    IonButton,
    IonButtons,
    IonIcon,
    IonLabel,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
  ],
  template: `
    @if (lookup.panelOpen()) {
      <section class="panel" aria-label="Card for the selected cell">
        <div class="bar">
          <div class="switcher">
            @if (lookup.matches().length > 1) {
              @if (useSegment()) {
                <ion-segment
                  [scrollable]="true"
                  [value]="lookup.active()?.card?.id"
                  aria-label="Matching cards"
                  (ionChange)="lookup.choose($any($event).detail.value)"
                >
                  @for (m of lookup.matches(); track m.card.id) {
                    <ion-segment-button [value]="m.card.id">
                      <ion-label>{{ m.card.title || m.card.id }}</ion-label>
                    </ion-segment-button>
                  }
                </ion-segment>
              } @else {
                <ion-select
                  aria-label="Matching cards"
                  interface="popover"
                  fill="outline"
                  [value]="lookup.active()?.card?.id"
                  (ionChange)="lookup.choose($any($event).detail.value)"
                >
                  @for (m of lookup.matches(); track m.card.id) {
                    <ion-select-option [value]="m.card.id">{{
                      m.card.title || m.card.id
                    }}</ion-select-option>
                  }
                </ion-select>
              }
            } @else {
              <span class="selected">{{ selectedText() }}</span>
            }
          </div>
          <ion-buttons>
            <ion-button
              size="small"
              fill="clear"
              data-action="refresh"
              aria-label="Refresh card"
              (click)="refresh()"
            >
              <ion-icon slot="icon-only" name="refresh-outline" />
            </ion-button>
            <ion-button
              size="small"
              fill="clear"
              data-action="as-tooltip"
              aria-label="Show this card as a tooltip over the cell"
              title="Show as tooltip"
              (click)="lookup.setMode('tooltip')"
            >
              <ion-icon slot="icon-only" name="chatbox-ellipses-outline" />
            </ion-button>
            <ion-button
              size="small"
              fill="clear"
              data-action="close"
              aria-label="Close card"
              (click)="lookup.dismiss()"
            >
              <ion-icon slot="icon-only" name="close-outline" />
            </ion-button>
          </ion-buttons>
        </div>
        @if (lookup.matches().length > 1) {
          <p class="selected">{{ selectedText() }}</p>
        }
        @if (lookup.card(); as card) {
          <sneat-datatug-project-card-view
            [card]="card"
            [parameterValues]="lookup.values()"
            [projectRef]="lookup.projectRef()"
            [environment]="lookup.environment()"
            [boardContext]="lookup.runContext()"
            [cache]="cache"
          />
        } @else if (lookup.cardError(); as message) {
          <p class="msg" role="alert">{{ message }}</p>
        } @else {
          <div class="msg" aria-label="Loading card">
            <ion-skeleton-text [animated]="true" style="width: 60%" />
            <ion-skeleton-text [animated]="true" style="width: 80%" />
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .panel {
        padding: 0.25rem 0 0.75rem;
        border-bottom: 1px solid var(--ion-background-color-step-150, #d9d9d9);
      }
      .bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0 0.5rem 0 1rem;
      }
      .switcher {
        flex: 1 1 auto;
        min-width: 0;
      }
      .selected {
        margin: 0;
        padding: 0.25rem 0;
        font-size: 0.8rem;
        color: var(--dt-text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      p.selected {
        padding: 0 1rem;
      }
      .msg {
        margin: 0;
        padding: 0.5rem 1rem;
      }
    `,
  ],
})
export class CellCardPanelComponent {
  protected readonly lookup = inject(CardLookupService);
  protected readonly cache = inject(PROJECT_CARD_RESULTS);
  private readonly view = viewChild(ProjectCardViewComponent);

  protected readonly useSegment = computed(
    () => this.lookup.matches().length <= SEGMENT_MAX,
  );
  /** "CustomerID · ALFKI": what the card was opened for. */
  protected readonly selectedText = computed(() => {
    const cell = this.lookup.resolvedCell();
    return cell ? `${cell.identity.column} · ${String(cell.value)}` : '';
  });

  protected refresh(): void {
    this.view()?.refresh();
  }
}

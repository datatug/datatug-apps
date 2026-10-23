import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
} from '@angular/core';
import { RouterLink, UrlTree } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonIcon,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
} from '@ionic/angular';
import { closeOutline } from 'ionicons/icons';

/**
 * True when every whitespace-separated term of `filter` occurs (case-insensitively) in at least one of `fields`.
 * An empty filter matches everything. Used by every project overview card for its quick client-side filter.
 */
export function matchesOverviewFilter(
  filter: string,
  ...fields: readonly (string | null | undefined)[]
): boolean {
  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = fields
    .filter((field): field is string => !!field)
    .join('\n')
    .toLowerCase();
  return terms.every((term) => text.includes(term));
}

/**
 * The one card shape of the project overview: a `color="light"` `ion-item-divider` header whose title links to the
 * section's full page, header actions in `slot="end"`, and an optional quick filter row in the same shape as the
 * Queries page filter (an `ion-item` with a "Filter" input and a clear button). The list is projected below.
 */
@Component({
  selector: 'sneat-datatug-project-overview-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonButtons,
    IonCard,
    IonIcon,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
  ],
  template: `
    <ion-card [attr.data-testid]="testId()">
      <ion-item-divider color="light" class="overview-card-header">
        <ion-label>
          <h2>
            @if (link(); as href) {
              <a [routerLink]="href" data-testid="overview-card-title-link">{{
                cardTitle()
              }}</a>
            } @else {
              {{ cardTitle() }}
            }
          </h2>
        </ion-label>
        <ion-buttons slot="end">
          <ng-content select="[overviewCardAction]" />
        </ion-buttons>
      </ion-item-divider>
      @if (filterable()) {
        <ion-item lines="full" class="overview-card-filter">
          <ion-input
            [placeholder]="'Filter ' + filterNoun()"
            [attr.aria-label]="'Filter ' + filterNoun()"
            [value]="filter()"
            (ionInput)="filter.set($any($event).detail.value ?? '')"
          />
          @if (filter()) {
            <ion-buttons slot="end">
              <ion-button
                color="medium"
                title="Clear filter"
                aria-label="Clear filter"
                (click)="filter.set('')"
              >
                <ion-icon [icon]="clearIcon" aria-hidden="true" />
              </ion-button>
            </ion-buttons>
          }
        </ion-item>
      }
      <ng-content />
    </ion-card>
  `,
  styles: `
    .overview-card-header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .overview-card-header a {
      color: var(--ion-color-primary);
      text-decoration: none;
    }
    .overview-card-header a:hover,
    .overview-card-header a:focus-visible {
      text-decoration: underline;
    }
  `,
})
export class ProjectOverviewCardComponent {
  readonly cardTitle = input.required<string>();
  /** The section's full page; the root (`/`, "no exact address") renders the title without a link. */
  readonly titleHref = input<string | UrlTree | undefined>(undefined);
  readonly filterable = input(true);
  /** Plural noun for the filter placeholder, e.g. "boards". */
  readonly filterNoun = input('items');
  readonly testId = input<string | undefined>(undefined);
  readonly filter = model('');
  protected readonly clearIcon = closeOutline;
  protected readonly link = computed(() => {
    const href = this.titleHref();
    return href && href.toString() !== '/' ? href : undefined;
  });
}

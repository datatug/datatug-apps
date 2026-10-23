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
  IonIcon,
  IonInput,
  IonItem,
} from '@ionic/angular';
import { closeOutline } from 'ionicons/icons';

/**
 * True when every whitespace-separated term of `filter` occurs (case-insensitively) in at least one of `fields`.
 * An empty filter matches everything. Used by every project overview tab for its quick client-side filter.
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
 * The content of one project overview tab (Boards, Queries, Entities, Databases).
 *
 * Deliberately NOT an `ion-card`: the tab row above already names and frames this content, so a card (with its own
 * shaded card header) would read as a standalone block detached from its tab (founder, 2026-10-23: "it's not
 * standalone cards"). The panel is a plain section: one unshaded header row holding the title (a link to the
 * section's full page) and any view controls on the same line, then an optional quick filter row in the shape of
 * the Queries page filter (an `ion-item` with a "Filter" input and a clear button), then the projected list.
 */
@Component({
  selector: 'sneat-datatug-project-tab-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonButton, IonButtons, IonIcon, IonInput, IonItem],
  template: `
    <section
      class="overview-tab-panel"
      [attr.aria-label]="panelTitle()"
      [attr.data-testid]="testId()"
    >
      <div class="tab-panel-header">
        <h2>
          @if (link(); as href) {
            <a [routerLink]="href" data-testid="overview-panel-title-link">{{
              panelTitle()
            }}</a>
          } @else {
            {{ panelTitle() }}
          }
        </h2>
        <div class="tab-panel-controls">
          <ng-content select="[tabPanelControls]" />
        </div>
      </div>
      @if (filterable()) {
        <ion-item lines="full" class="tab-panel-filter">
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
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .overview-tab-panel {
      margin: 0 0 16px;
    }
    .tab-panel-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 12px;
      min-height: 44px;
      padding: 4px 16px;
    }
    .tab-panel-header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .tab-panel-header a {
      color: var(--ion-color-primary);
      text-decoration: none;
    }
    .tab-panel-header a:hover,
    .tab-panel-header a:focus-visible {
      text-decoration: underline;
    }
    .tab-panel-controls {
      display: flex;
      align-items: center;
      gap: 4px 8px;
      margin-left: auto;
      min-width: 0;
    }
    .tab-panel-controls:empty {
      display: none;
    }
  `,
})
export class ProjectTabPanelComponent {
  readonly panelTitle = input.required<string>();
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

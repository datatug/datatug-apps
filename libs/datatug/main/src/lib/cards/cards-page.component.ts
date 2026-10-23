import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSearchbar,
  IonSkeletonText,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, idCardOutline } from 'ionicons/icons';
import type { ProjectCardBrief } from '@datatug/board-models';
import { SneatDatatugPageTitleComponent } from '../components/page-title/sneat-datatug-page-title.component';
import { DatatugCoreModule } from '../core/datatug-core.module';
import { DatatugServicesNavModule } from '../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../services/unsorted/datatug-services-unsorted.module';
import { injectCardsContext } from './cards-context';
import { displayLabel, parameterChips } from './card-model';
import { ProjectCardsService } from './project-cards.service';

addIcons({ addOutline, idCardOutline });

const FILTER_FROM = 8;

interface CardRow {
  readonly card: ProjectCardBrief;
  readonly chips: string[];
  readonly display: string;
}

/**
 * Cards list: every project card with what it needs (parameter chips such as
 * `customerId ← Customer.CustomerID`) and how it shows beside a grid.
 *
 * Flow: Cards ──"New card"──▶ cards/new ──Save──▶ card/:id ──Back/Delete──▶ Cards
 */
@Component({
  selector: 'sneat-datatug-cards-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    FormsModule,
    RouterLink,
    SneatDatatugPageTitleComponent,
    IonBackButton,
    IonButton,
    IonButtons,
    IonChip,
    IonContent,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSearchbar,
    IonSkeletonText,
    IonToolbar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button [defaultHref]="ctx.href('overview')" />
          <ion-menu-button />
        </ion-buttons>
        <sneat-datatug-page-title pageTitle="Cards" />
        @if (ctx.canWrite() && !ctx.needsEnvironment()) {
          <ion-buttons slot="end">
            <ion-button [routerLink]="ctx.url(['cards', 'new'])">
              <ion-icon slot="start" name="add-outline" />
              New card
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>

    <ion-content color="light">
      @if (ctx.needsEnvironment()) {
        <div class="state" role="status">
          <h2>Choose an environment</h2>
          <p>
            Cards of a shared project live in an environment. Add
            <code>?environment=&lt;name&gt;</code> to the address, or open the
            project from an environment.
          </p>
        </div>
      } @else if (error(); as message) {
        <div class="state">
          <p role="alert">{{ message }}</p>
          <ion-button fill="outline" (click)="reload()">Retry</ion-button>
        </div>
      } @else if (!rows()) {
        <ion-list aria-label="Loading cards" lines="full">
          @for (n of [1, 2, 3]; track n) {
            <ion-item>
              <ion-label>
                <ion-skeleton-text [animated]="true" style="width: 40%" />
                <ion-skeleton-text [animated]="true" style="width: 70%" />
              </ion-label>
            </ion-item>
          }
        </ion-list>
      } @else if (!rows()!.length) {
        <div class="state empty">
          <ion-icon name="id-card-outline" aria-hidden="true" />
          <h2>No cards yet</h2>
          <p>
            A card shows one thing about a record: a customer, an order, a
            device. Select a matching cell in a table or a query result and the
            card appears beside the grid, ready to read without leaving the
            data.
          </p>
          @if (ctx.canWrite()) {
            <ion-button [routerLink]="ctx.url(['cards', 'new'])">
              <ion-icon slot="start" name="add-outline" />
              New card
            </ion-button>
          } @else {
            <p class="muted">Cards of this project are read-only here.</p>
          }
        </div>
      } @else {
        @if (showFilter()) {
          <ion-searchbar
            placeholder="Filter cards"
            [debounce]="100"
            (ionInput)="filter.set($any($event).detail.value ?? '')"
          />
        }
        <ion-list aria-label="Project cards" lines="full">
          @for (row of visible(); track row.card.id) {
            <ion-item button detail [routerLink]="ctx.url(['card', row.card.id])">
              <ion-label>
                <h2>{{ row.card.title || row.card.id }}</h2>
                @if (row.card.description) {
                  <p>{{ row.card.description }}</p>
                }
                @if (row.chips.length) {
                  <div class="chips">
                    @for (chip of row.chips; track chip) {
                      <ion-chip outline>{{ chip }}</ion-chip>
                    }
                  </div>
                }
              </ion-label>
              <ion-note slot="end">{{ row.display }}</ion-note>
            </ion-item>
          } @empty {
            <ion-item lines="none">
              <ion-label>No card matches "{{ filter() }}".</ion-label>
            </ion-item>
          }
        </ion-list>
        @if (!ctx.canWrite()) {
          <p class="muted ion-padding">
            Cards of this project are read-only here.
          </p>
        }
      }
    </ion-content>
  `,
  styles: [
    `
      .state {
        max-width: 34rem;
        margin: 0 auto;
        padding: 2rem 1rem;
      }
      .state.empty {
        text-align: center;
      }
      .state.empty ion-icon {
        font-size: 2.5rem;
        color: var(--dt-text-muted);
      }
      .state h2 {
        margin: 0.5rem 0;
      }
      .muted {
        color: var(--dt-text-muted);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }
      ion-chip {
        margin: 0;
        min-height: 1.5rem;
        font-size: 0.8rem;
      }
    `,
  ],
})
export class CardsPageComponent {
  private readonly cards = inject(ProjectCardsService);
  protected readonly ctx = injectCardsContext();

  protected readonly briefs = signal<ProjectCardBrief[] | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly filter = signal('');
  private readonly reloads = signal(0);
  private forceReload = false;

  protected readonly rows = computed<CardRow[] | undefined>(() =>
    this.briefs()?.map((card) => ({
      card,
      chips: parameterChips(card),
      display: displayLabel(card.display),
    })),
  );
  protected readonly showFilter = computed(
    () => (this.rows()?.length ?? 0) >= FILTER_FROM,
  );
  protected readonly visible = computed(() => {
    const rows = this.rows() ?? [];
    const q = this.filter().trim().toLowerCase();
    return q
      ? rows.filter((r) =>
          `${r.card.title} ${r.card.id} ${r.card.description ?? ''}`
            .toLowerCase()
            .includes(q),
        )
      : rows;
  });

  constructor() {
    effect((onCleanup) => {
      const ref = this.ctx.ref();
      const environment = this.ctx.environment();
      const blocked = this.ctx.needsEnvironment();
      this.reloads();
      untracked(() => {
        this.briefs.set(undefined);
        this.error.set(undefined);
      });
      if (!ref || blocked) return;
      const force = this.forceReload;
      this.forceReload = false;
      const subscription = this.cards
        .listCards(ref, environment, force)
        .subscribe({
          next: (briefs) => this.briefs.set(briefs),
          error: (err: unknown) =>
            this.error.set(
              err instanceof Error && err.message
                ? err.message
                : 'The cards could not be loaded.',
            ),
        });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  /** Ionic keeps routed pages alive: re-entering shows the cards as saved elsewhere. */
  ionViewWillEnter(): void {
    if (this.briefs()) this.reload();
  }

  protected reload(): void {
    this.forceReload = true;
    this.reloads.update((n) => n + 1);
  }
}

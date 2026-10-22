import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
  input,
  computed,
  effect,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IonButton, IonCard, IonItem, IonLabel, IonSkeletonText } from '@ionic/angular';
import { Subject } from 'rxjs';
import {
  BoardCard,
  BoardWidgetName,
  ProjectCard,
} from '@datatug/board-models';
import {
  CardNotFoundError,
  ProjectCardsService,
} from '../../../../cards/project-cards.service';
import {
  cardBoardContext,
  refParameterValues,
} from '../../../../cards/card-parameters';
import type { BoardQueryResults } from '../../../core/board-query-results.service';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import { QueryType } from '../../../../models/definition/query-def';
import { BoardWidgetComponent } from '../board-widget/board-widget.component';
import { BoardReadForRun } from '../../../core/board-read-for-run';
import { TutorialBoardRuntime } from '../../../core/tutorial-board-runtime';

@Injectable()
export class BoardCardTabService {
  public $changed = new Subject<string>();
  public changed = this.$changed.asObservable();

  private tab?: QueryType | 'grid' | 'card';

  public get currentTab() {
    return this.tab;
  }

  public setTab(tab: BoardWidgetName | 'grid' | 'card'): void {
    this.tab = tab as QueryType | 'grid' | 'card';
  }
}

@Component({
  selector: 'sneat-datatug-board-card',
  templateUrl: './board-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BoardCardTabService],
  imports: [
    IonButton,
    IonCard,
    IonItem,
    IonLabel,
    IonSkeletonText,
    NgTemplateOutlet,
    BoardWidgetComponent,
  ],
  host: {
    '[attr.data-board-card-id]': 'boarCardDef()?.id',
    '[attr.tabindex]':
      'tutorialRuntime?.activeFor(projectRef(), boardId()) ? -1 : null',
    '[attr.aria-label]': 'boarCardDef()?.title || boarCardDef()?.id',
  },
  styles: [
    `
      .tutorial-card-guide {
        margin: 0.75rem;
        padding: 1rem;
        border: 2px solid #356393;
        border-radius: 0.7rem;
        background: #f5f9fd;
        color: #17213a;
      }
      .tutorial-card-guide h3 {
        margin-top: 0;
      }
      .tutorial-card-guide h3:focus-visible {
        outline: 3px solid #2563eb;
        outline-offset: 3px;
      }
      .tutorial-card-guide nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .tutorial-card-guide button {
        min-height: 44px;
        padding: 0.5rem 0.75rem;
        border: 1px solid #356393;
        border-radius: 0.5rem;
        color: #174b7c;
        background: white;
        font: inherit;
      }
      .tutorial-card-guide button:focus-visible {
        outline: 3px solid #2563eb;
        outline-offset: 2px;
      }
    `,
  ],
})
export class BoardCardComponent {
  readonly tutorialRuntime = inject(TutorialBoardRuntime, { optional: true });
  readonly tutorialNotice = computed(() => {
    if (!this.tutorialRuntime?.activeFor(this.projectRef(), this.boardId()))
      return undefined;
    const notice = this.tutorialRuntime.notice();
    return notice?.cardId === this.boarCardDef()?.id ? notice : undefined;
  });
  readonly boardCardTab = inject(BoardCardTabService);
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boarCardDef = input<BoardCard>();
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
  readonly boardId = input<string>();
  readonly readBoardForRun = input<BoardReadForRun>();
  /**
   * Standalone project-card rendering (a card beside a grid, or a card a
   * dashboard cell references): loading / error / empty states on every
   * widget, runs start by themselves.
   */
  readonly cardMode = input(false);
  /** Renders the body only; the host supplies the surrounding card and title. */
  readonly bare = input(false);
  /** A shared result cache for this card; dashboards fall back to their own. */
  readonly resultCache = input<BoardQueryResults>();

  private readonly cards = inject(ProjectCardsService);
  readonly refDef = computed(() => this.boarCardDef()?.ref);
  /** Resolution of a `ref` cell: the project card, or why there is none. */
  readonly refState = signal<
    | { kind: 'loading' }
    | { kind: 'ready'; card: ProjectCard }
    | { kind: 'missing'; cardId: string }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  private readonly reload = signal(0);
  readonly refReady = computed(() => {
    const state = this.refState();
    return state.kind === 'ready' ? state.card : undefined;
  });
  /** The referenced card as a plain board card, bound to this cell's id. */
  readonly refBoardCard = computed<BoardCard | undefined>(() => {
    const card = this.refReady();
    const cell = this.boarCardDef();
    return card && cell
      ? { id: cell.id, title: '', widget: card.widget }
      : undefined;
  });
  /** The referenced card's parameters bound from the cell's `ref.parameters`. */
  readonly refContext = computed(() => {
    const card = this.refReady();
    const ref = this.refDef();
    if (!card || !ref) return undefined;
    const board = this.boardContext();
    return cardBoardContext(
      board,
      card,
      refParameterValues(card, ref, board),
    );
  });

  /** Only the environment of the context matters to loading the card, not every parameter change. */
  private readonly environment = computed(() => this.boardContext()?.environment);

  constructor() {
    effect((onCleanup) => {
      const ref = this.refDef();
      const project = this.projectRef();
      const environment = this.environment();
      this.reload();
      if (!ref) return;
      if (!project) {
        this.refState.set({ kind: 'loading' });
        return;
      }
      this.refState.set({ kind: 'loading' });
      const subscription = this.cards
        .getCard(project, ref.cardId, environment)
        .subscribe({
          next: (card) => this.refState.set({ kind: 'ready', card }),
          error: (error: unknown) =>
            this.refState.set(
              error instanceof CardNotFoundError
                ? { kind: 'missing', cardId: ref.cardId }
                : {
                    kind: 'error',
                    message:
                      error instanceof Error && error.message
                        ? error.message
                        : 'The card could not be loaded.',
                  },
            ),
        });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  retryRef(): void {
    const project = this.projectRef();
    if (project) this.cards.invalidate(project);
    this.reload.update((n) => n + 1);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
  input,
  computed,
} from '@angular/core';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonToolbar,
  IonButtons,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import { NgTemplateOutlet } from '@angular/common';
import { BoardCard, BoardWidgetName } from '@datatug/board-models';
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
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonToolbar,
    IonButtons,
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
      ion-card {
        container: datatug-board-header / inline-size;
      }
      ion-card-header {
        padding: 0;
      }
      ion-toolbar {
        --min-height: 3rem;
        --padding-start: 1rem;
        --padding-end: 0.5rem;
      }
      ion-card-title {
        font-size: 1rem;
        padding-block: 0.65rem;
        overflow-wrap: anywhere;
      }
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
}

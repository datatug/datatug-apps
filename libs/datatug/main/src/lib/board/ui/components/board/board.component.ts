import { BoardPresentationSelection } from '../../../core/board-presentation-selection';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { IonCol, IonGrid, IonRow, IonText } from '@ionic/angular';
import { Board, validateBoardPresentation } from '@datatug/board-models';
import { IProjectRef } from '../../../../core/project-context';
import { IBoardContext } from '../../../../models/definition/board/board';
import { BoardRowComponent } from '../board-row/board-row.component';
import { BoardQueryResults } from '../../../core/board-query-results.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';

@Component({
  selector: 'sneat-datatug-board',
  templateUrl: './board.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BoardQueryResults, BoardPresentationSelection],
  imports: [BoardRowComponent, IonGrid, IonRow, IonCol, IonText],
})
export class BoardComponent {
  private readonly selection = inject(BoardPresentationSelection);
  readonly validation = computed(() => {
    try {
      return {
        ids: this.boardDef() ? validateBoardPresentation(this.boardDef()) : [],
      };
    } catch (error) {
      return {
        ids: [],
        error:
          error instanceof Error
            ? error.message
            : 'Invalid board presentation.',
      };
    }
  });
  private readonly identity = computed(() =>
    JSON.stringify([this.boardDef()?.id, this.projectRef()]),
  );
  constructor() {
    effect(() => {
      this.selectionReset();
      this.identity();
      untracked(() => this.selection.clear());
    });
    effect(() => {
      const ids = this.validation().ids;
      untracked(() => this.selection.retain(ids));
    });
  }

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boardDef = input<Board>();
  readonly selectionReset = input(0);
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
  readonly readBoardForRun = input<BoardReadForRun>();
}

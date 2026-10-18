import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonCol, IonGrid, IonRow, IonText } from '@ionic/angular';
import { Board } from '@datatug/board-models';
import { IProjectRef } from '../../../../core/project-context';
import { IBoardContext } from '../../../../models/definition/board/board';
import { BoardRowComponent } from '../board-row/board-row.component';
import { BoardQueryResults } from '../../../core/board-query-results.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';

@Component({
  selector: 'sneat-datatug-board',
  templateUrl: './board.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BoardQueryResults],
  imports: [BoardRowComponent, IonGrid, IonRow, IonCol, IonText],
})
export class BoardComponent {
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boardDef = input<Board>();
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
  readonly readBoardForRun = input<BoardReadForRun>();
}

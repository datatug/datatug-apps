import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonCol, IonRow } from '@ionic/angular';
import { BoardRow } from '@datatug/board-models';
import { IProjectRef } from '../../../../core/project-context';
import { IBoardContext } from '../../../../models/definition/board/board';
import { BoardCardComponent } from '../board-card/board-card.component';

@Component({
  selector: 'sneat-datatug-board-row',
  templateUrl: './board-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCol, IonRow, BoardCardComponent],
})
export class BoardRowComponent {
  cardCols(cols: number | undefined): string {
    return typeof cols === 'number' &&
      Number.isInteger(cols) &&
      cols >= 1 &&
      cols <= 12
      ? String(cols)
      : '6';
  }
  readonly boardRowDef = input<BoardRow>();
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}

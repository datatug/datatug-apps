import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonCol, IonRow } from '@ionic/angular';
import {
  IBoardContext,
  IBoardRowDef,
} from '../../../../models/definition/board/board';
import { BoardCardComponent } from '../board-card/board-card.component';

@Component({
  selector: 'sneat-datatug-board-row',
  templateUrl: './board-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonCol, IonRow, BoardCardComponent],
})
export class BoardRowComponent {
  readonly boardRowDef = input<IBoardRowDef>();
  readonly boardContext = input<IBoardContext>();
}

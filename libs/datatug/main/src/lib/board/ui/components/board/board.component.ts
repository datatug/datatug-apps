import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import {
  IonButton,
  IonCol,
  IonGrid,
  IonIcon,
  IonLabel,
  IonRow,
  IonText,
  ModalController,
} from '@ionic/angular';
import {
  IBoardContext,
  IBoardDef,
} from '../../../../models/definition/board/board';
import { NewCardDialogComponent } from '../../modals/new-card-dialog/new-card-dialog.component';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { BoardRowComponent } from '../board-row/board-row.component';

@Component({
  selector: 'sneat-datatug-board',
  templateUrl: './board.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BoardRowComponent,
    IonGrid,
    IonRow,
    IonCol,
    IonText,
    IonButton,
    IonIcon,
    IonLabel,
  ],
})
export class BoardComponent {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly modalCtrl = inject(ModalController);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boardDef = input<IBoardDef>();
  readonly boardContext = input<IBoardContext>();

  async newCard() {
    const modal = await this.modalCtrl.create({
      component: NewCardDialogComponent,
    });
    await modal.present();
    // try {
    // 	const id = Math.random().toString().split('.')[1];
    // 	if (!this.boardDef.rows) {
    // 		this.boardDef.rows = [];
    // 	}
    // 	this.boardDef.rows.push({
    // 		cards: [{
    // 			id,
    // 			title: 'New card',
    // 			widget: {id: 'sql-query', data: {text: 'select' + ' * from SomeTable'}}
    // 		}]
    // 	});
    // } catch (e) {
    // 	this.errorLogger.logError(e, 'Failed to create a new card');
    // }
  }
}

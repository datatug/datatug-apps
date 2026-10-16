import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
  input,
} from '@angular/core';
import { IonCard, IonItem, IonLabel } from '@ionic/angular';
import { Subject } from 'rxjs';
import { BoardCard, BoardWidgetName } from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import { QueryType } from '../../../../models/definition/query-def';
import { BoardWidgetComponent } from '../board-widget/board-widget.component';

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
  imports: [IonCard, IonItem, IonLabel, BoardWidgetComponent],
})
export class BoardCardComponent {
  readonly boardCardTab = inject(BoardCardTabService);
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boarCardDef = input<BoardCard>();
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}

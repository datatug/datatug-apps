import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injectable,
  OnChanges,
  SimpleChanges,
  inject,
  input
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonIcon,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { Subject } from 'rxjs';
import {
  IBoardCardDef,
  IBoardContext,
} from '../../../../models/definition/board/board';
import { WidgetName } from '../../../../models/definition/board/widget-name';
import { sqlWidgetName } from '../../../../models/definition/board/widget-sql';
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

  public setTab(tab: WidgetName): void {
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
    IonItem,
    IonLabel,
    IonButtons,
    IonSegment,
    FormsModule,
    IonSegmentButton,
    IonButton,
    IonIcon,
    BoardWidgetComponent,
  ],
})
export class BoardCardComponent implements OnChanges {
  readonly boardCardTab = inject(BoardCardTabService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly boarCardDef = input<IBoardCardDef>();
  readonly boardContext = input<IBoardContext>();

  ngOnChanges(changes: SimpleChanges): void {
    const boarCardDef = this.boarCardDef();
    if (changes['boarCardDef'] && boarCardDef) {
      if (boarCardDef?.widget?.name === sqlWidgetName) {
        this.boardCardTab.setTab(sqlWidgetName);
      }
    }
  }

  setTab(event: Event) {
    const ce = event as CustomEvent;
    this.boardCardTab.setTab(ce.detail.value as WidgetName);
    this.changeDetectorRef.markForCheck();
  }
}

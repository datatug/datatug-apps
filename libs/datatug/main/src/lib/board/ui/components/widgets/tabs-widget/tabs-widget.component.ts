import {
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  SimpleChanges,
  input
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonLabel,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular';
import { TabsWidgetDef } from '@datatug/board-models';
import { IBoardContext } from '../../../../../models/definition/board/board';

@Component({
  selector: 'sneat-datatug-tabs-widget',
  templateUrl: './tabs-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, FormsModule, IonSegmentButton, IonLabel],
})
export class TabsWidgetComponent implements OnChanges {
  public selectedTab?: string;

  readonly level = input<number>();
  readonly tabsWidgetDef = input<TabsWidgetDef>();
  readonly boardContext = input<IBoardContext>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tabsWidgetDef'] && !this.selectedTab) {
      const tabsWidgetDef = this.tabsWidgetDef();
      this.selectedTab =
        (tabsWidgetDef?.tabs?.length && tabsWidgetDef.tabs[0].title) ||
        undefined;
    }
  }
}

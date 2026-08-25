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
import { IBoardContext } from '../../../../../models/definition/board/board';
import { ITabsWidgetSettings } from '../../../../../models/definition/board/widget-tabs';

@Component({
  selector: 'sneat-datatug-tabs-widget',
  templateUrl: './tabs-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, FormsModule, IonSegmentButton, IonLabel],
})
export class TabsWidgetComponent implements OnChanges {
  public selectedTab?: string;

  readonly level = input<number>();
  readonly tabsWidgetSettings = input<ITabsWidgetSettings>();
  readonly boardContext = input<IBoardContext>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tabsWidgetDef'] && !this.selectedTab) {
      const tabsWidgetSettings = this.tabsWidgetSettings();
      this.selectedTab =
        (tabsWidgetSettings?.tabs?.length &&
          tabsWidgetSettings.tabs[0].title) ||
        undefined;
    }
  }
}

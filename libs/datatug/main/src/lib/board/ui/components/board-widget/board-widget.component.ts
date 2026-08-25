import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IBoardContext } from '../../../../models/definition/board/board';
import { WidgetDef } from '../../../../models/definition/board/widget-def';
import { ISqlWidgetSettings } from '../../../../models/definition/board/widget-sql';
import { ITabsWidgetSettings } from '../../../../models/definition/board/widget-tabs';
import { QueryType } from '../../../../models/definition/query-def';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TabsWidgetComponent],
})
export class BoardWidgetComponent {
  readonly level = input<number>();
  readonly cardTab = input<QueryType | 'grid' | 'card'>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly widgetDef = input<WidgetDef>();

  get tabsWidgetSettings() {
    return this.widgetDef()?.data as ITabsWidgetSettings;
  }

  get sqlWidgetSettings() {
    return this.widgetDef()?.data as ISqlWidgetSettings;
  }

  readonly boardContext = input<IBoardContext>();
}

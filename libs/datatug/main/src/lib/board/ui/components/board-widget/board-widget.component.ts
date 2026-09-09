import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BoardWidget, SQLWidgetDef, TabsWidgetDef } from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
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
  readonly widgetDef = input<BoardWidget>();

  // In boards.go, BoardWidget.data for name "SQL" is the whole SQLWidgetDef
  // ({ title?, parameters?, sql: { query } }), not the inner settings.
  readonly tabsWidgetDef = computed(
    () => this.widgetDef()?.data as TabsWidgetDef | undefined,
  );
  readonly sqlWidgetDef = computed(
    () => this.widgetDef()?.data as SQLWidgetDef | undefined,
  );

  readonly boardContext = input<IBoardContext>();
}

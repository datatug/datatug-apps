import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  Type,
  WritableSignal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { TabsWidgetDef } from '@datatug/board-models';
import { IBoardContext } from '../../../../../models/definition/board/board';
import { IProjectRef } from '../../../../../core/project-context';
import { BoardReadForRun } from '../../../../core/board-read-for-run';
import type { BoardResultSnapshot } from '../../board-widget/board-widget.component';
import {
  MAX_NESTED_TAB_DEPTH,
  tabKey,
} from '../../board-widget/nested-tab-path';

@Component({
  selector: 'sneat-datatug-tabs-widget',
  templateUrl: './tabs-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, IonSegmentButton, IonLabel, NgComponentOutlet],
})
export class TabsWidgetComponent {
  readonly level = input(0);
  readonly tabsWidgetDef = input<TabsWidgetDef>();
  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
  readonly boardId = input<string>();
  readonly cardId = input<string>();
  readonly readBoardForRun = input<BoardReadForRun>();
  readonly widgetPath = input<readonly string[]>([]);
  readonly boardWidgetComponent = input.required<Type<unknown>>();
  readonly resultSnapshot =
    input.required<WritableSignal<BoardResultSnapshot | undefined>>();
  readonly maxDepth = MAX_NESTED_TAB_DEPTH;
  readonly selectedKey = signal<string | undefined>(undefined);
  readonly tabs = computed(() =>
    (this.tabsWidgetDef()?.tabs ?? []).map((tab, index) => ({
      tab,
      key: tabKey(tab, index),
    })),
  );
  readonly active = computed(() => {
    const tabs = this.tabs();
    const selected = this.selectedKey();
    return tabs.find(({ key }) => key === selected) ?? tabs[0];
  });
  readonly activePath = computed(() => {
    const active = this.active();
    return active ? [...this.widgetPath(), active.key] : this.widgetPath();
  });
  readonly childInputs = computed(() => ({
    level: this.level() + 1,
    widgetDef: this.active()?.tab.widget,
    boardContext: this.boardContext(),
    projectRef: this.projectRef(),
    boardId: this.boardId(),
    cardId: this.cardId(),
    readBoardForRun: this.readBoardForRun(),
    widgetPath: this.activePath(),
    resultSnapshot: this.resultSnapshot(),
  }));

  select(key: string): void {
    if (this.tabs().some((tab) => tab.key === key)) this.selectedKey.set(key);
  }
}

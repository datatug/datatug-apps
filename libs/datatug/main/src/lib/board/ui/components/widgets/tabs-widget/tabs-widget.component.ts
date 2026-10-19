import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  inject,
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
import { TutorialBoardRuntime } from '../../../../core/tutorial-board-runtime';
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
  private static nextID = 0;
  readonly panelID = `board-tabs-${TabsWidgetComponent.nextID++}-panel`;
  tabDOMID(key: string): string { return `${this.panelID}-tab-${encodeURIComponent(key)}`; }
  private readonly tutorialRuntime = inject(TutorialBoardRuntime, {
    optional: true,
  });
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
  readonly autoRunAttempts = input<WritableSignal<ReadonlySet<string>>>();
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
    const selected = this.tutorialRuntime?.activeFor(
      this.projectRef(),
      this.boardId(),
    )
      ? (this.tutorialRuntime.selectedTab(this.cardId(), this.widgetPath()) ??
        this.selectedKey())
      : this.selectedKey();
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
    autoRunAttempts: this.autoRunAttempts(),
  }));

  select(key: string): void {
    if (!this.tabs().some((tab) => tab.key === key)) return;
    const cardId = this.cardId();
    if (
      cardId &&
      this.tutorialRuntime?.activeFor(this.projectRef(), this.boardId())
    ) {
      this.tutorialRuntime.dispatch({
        type: 'select-tab',
        cardId,
        widgetPath: this.widgetPath(),
        tabKey: key,
      });
    } else this.selectedKey.set(key);
  }
}

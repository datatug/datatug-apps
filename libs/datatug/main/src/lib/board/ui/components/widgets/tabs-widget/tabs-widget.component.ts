import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  inject,
  signal,
  Type,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { SegmentPanelDirective } from './segment-panel.directive';
import { NgComponentOutlet } from '@angular/common';
import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { BoardWidget, TabsWidgetDef } from '@datatug/board-models';
import { IBoardContext } from '../../../../../models/definition/board/board';
import { IProjectRef } from '../../../../../core/project-context';
import { BoardReadForRun } from '../../../../core/board-read-for-run';
import { TutorialBoardRuntime } from '../../../../core/tutorial-board-runtime';
import type { BoardResultSnapshot } from '../../board-widget/board-widget.component';
import {
  MAX_NESTED_TAB_DEPTH,
  stackedWidgetKey,
  tabKey,
} from '../../board-widget/nested-tab-path';
import type { BoardQueryResults } from '../../../../core/board-query-results.service';
import { revealSegmentButton } from '../../../../../components/segment-reveal/reveal-segment-button';

@Component({
  selector: 'sneat-datatug-tabs-widget',
  templateUrl: './tabs-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSegment, IonSegmentButton, IonLabel, NgComponentOutlet, SegmentPanelDirective],
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
  /** Standalone project-card rendering, passed down to every widget. */
  readonly cardMode = input(false);
  readonly resultCache = input<BoardQueryResults>();
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
  /**
   * The active tab's widgets, stacked in order: the legacy single `widget`
   * first (path = the tab path, unchanged), then `widgets[]` (path + `w:<i>`).
   */
  readonly children = computed(() => {
    const active = this.active();
    if (!active) return [];
    const entries: { key: string; widget: BoardWidget; path: readonly string[] }[] = [];
    if (active.tab.widget)
      entries.push({ key: 'legacy', widget: active.tab.widget, path: this.activePath() });
    (Array.isArray(active.tab.widgets) ? active.tab.widgets : []).forEach((widget, index) => {
      if (widget)
        entries.push({
          key: stackedWidgetKey(index),
          widget,
          path: [...this.activePath(), stackedWidgetKey(index)],
        });
    });
    return entries.map((entry) => ({
      key: entry.key,
      inputs: {
        level: this.level() + 1,
        widgetDef: entry.widget,
        boardContext: this.boardContext(),
        projectRef: this.projectRef(),
        boardId: this.boardId(),
        cardId: this.cardId(),
        readBoardForRun: this.readBoardForRun(),
        widgetPath: entry.path,
        resultSnapshot: this.resultSnapshot(),
        autoRunAttempts: this.autoRunAttempts(),
        cardMode: this.cardMode(),
        resultCache: this.resultCache(),
      },
    }));
  });
  /** One tab needs no strip. */
  readonly showStrip = computed(() => this.tabs().length > 1);
  private readonly strip = viewChild<string, ElementRef<HTMLElement>>('strip', {
    read: ElementRef,
  });

  constructor() {
    // Keep the selected tab fully in view on a narrow screen once Ionic and the new panel have rendered.
    effect((onCleanup) => {
      const segment = this.strip()?.nativeElement;
      const key = this.active()?.key;
      if (!segment || key === undefined) return;
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const buttons: (HTMLElement & { value?: unknown })[] = Array.from(
            segment.querySelectorAll('ion-segment-button'),
          );
          const button = buttons.find((candidate) => candidate.value === key);
          if (button) revealSegmentButton(segment, button);
        });
      });
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }

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

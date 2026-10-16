import {
  Board,
  BoardSessionAction,
  ChartWidgetDef,
  TabsWidgetDef,
  TutorialBoardSession,
} from '@datatug/board-models';
import { tabKey } from '../../components/board-widget/nested-tab-path';

export interface TutorialStep {
  readonly title: string;
  readonly detail: string;
  readonly action?: BoardSessionAction;
  readonly limitation?: string;
}

/** Uses canonical IDs/settings only; the driver never embeds queries or result rows. */
export function tutorialSteps(board: Board): readonly TutorialStep[] {
  const steps: TutorialStep[] = [];
  const cards = (board.rows ?? []).flatMap((row) => row.cards ?? []);
  for (const card of cards) {
    steps.push({
      title: `Add ${card.title || card.id}`,
      detail:
        'Reveal this saved card. Its admitted saved query starts when visible.',
      action: { type: 'add-card', cardId: card.id },
    });
    if (card.widget?.name === 'chart') {
      const chart = card.widget.data as ChartWidgetDef;
      if (chart.chart.type === 'bar-race') {
        steps.push({
          title: 'Inspect the source rows',
          detail:
            'Switch the race to its held source rows without running another query.',
          action: { type: 'set-view', cardId: card.id, view: 'grid' },
        });
        steps.push({
          title: 'Return to the paused race',
          detail:
            'Use the same result snapshot. Playback and scrubbing remain under your control.',
          action: { type: 'set-view', cardId: card.id, view: 'chart' },
        });
      }
    }
    if (card.widget?.name === 'tabs') {
      const tabs = (card.widget.data as TabsWidgetDef).tabs ?? [];
      if (tabs.length > 1)
        steps.push({
          title: `Inspect ${tabs[1].title}`,
          detail:
            'Select a distinct saved query. Its result and provenance remain separate from sibling tabs.',
          action: {
            type: 'select-tab',
            cardId: card.id,
            tabKey: tabKey(tabs[1], 1),
          },
        });
    }
  }
  steps.push({
    title: 'Explore another source',
    detail: 'Each source needs its own admitted execution and rights.',
    limitation:
      'Adding a second source is unavailable until independent execution and composition are supported. Chinook billing is available in its own inspectable tab; it is not combined with the Northwind chart.',
  });
  return steps;
}

function tutorialActionsMatch(
  action: BoardSessionAction,
  expected: BoardSessionAction | undefined,
): boolean {
  if (!expected) return false;
  const normalize = (value: BoardSessionAction) => {
    const normalized = { ...value } as Record<string, unknown>;
    const widgetPath = normalized['widgetPath'];
    if (Array.isArray(widgetPath) && widgetPath.length === 0)
      delete normalized['widgetPath'];
    return normalized;
  };
  return (
    JSON.stringify(normalize(action)) === JSON.stringify(normalize(expected))
  );
}

export function currentTutorialStep(session: TutorialBoardSession): {
  readonly index: number;
  readonly step: TutorialStep;
} {
  const steps = tutorialSteps(session.canonical);
  const { actions, cursor } = session.history;
  let index = 0;
  for (const action of actions.slice(0, cursor)) {
    if (tutorialActionsMatch(action, steps[index]?.action)) index++;
  }
  const workingCards = (session.board.rows ?? []).flatMap(
    (row) => row.cards ?? [],
  );
  while (index < steps.length - 1) {
    const action = steps[index].action;
    const card = workingCards.find((card) => card.id === action?.cardId);
    if (action?.type === 'add-card' && card) {
      index++;
      continue;
    }
    if (
      action?.type === 'select-tab' &&
      session.selectedTab(action.cardId, action.widgetPath) === action.tabKey
    ) {
      index++;
      continue;
    }
    if (
      action?.type === 'set-view' &&
      card?.widget?.name === 'chart' &&
      (card.widget.data as ChartWidgetDef).defaultView === action.view
    ) {
      index++;
      continue;
    }
    break;
  }
  index = Math.min(index, steps.length - 1);
  const step = steps[index];
  if (step.action && step.action.type !== 'add-card') {
    const card = (session.board.rows ?? [])
      .flatMap((row) => row.cards ?? [])
      .find((card) => card.id === step.action?.cardId);
    if (!card)
      return {
        index,
        step: {
          title: 'Restore the next card',
          detail:
            'Resume retains your edits. Restore this saved card before continuing the guide.',
          action: { type: 'add-card', cardId: step.action.cardId },
        },
      };
  }
  return { index, step };
}

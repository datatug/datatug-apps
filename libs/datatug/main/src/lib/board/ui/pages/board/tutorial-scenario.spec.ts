import { describe, expect, it } from 'vitest';
import {
  Board,
  ChartWidgetDef,
  TutorialBoardSession,
} from '@datatug/board-models';
import { currentTutorialStep } from './tutorial-scenario';

const canonical: Board = {
  id: 'showcase',
  title: 'Showcase',
  rows: [
    {
      cards: [
        {
          id: 'race',
          title: 'Orders race',
          widget: {
            name: 'chart',
            data: {
              sources: [{ id: 'orders', queryId: 'demodb/orders' }],
              chart: {
                type: 'bar-race',
                periodColumn: 'month',
                categoryColumn: 'country',
                valueColumn: 'orders',
                unit: 'orders',
                grain: 'month',
                onDuplicate: 'reject',
                mode: 'period',
                topN: 10,
              },
              defaultView: 'chart',
            },
          },
        },
        {
          id: 'countries',
          title: 'Northwind orders by shipping country',
          widget: {
            name: 'SQL',
            data: { sql: { queryId: 'demodb/countries' } },
          },
        },
        {
          id: 'inspect',
          title: 'Source inspection',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                {
                  id: 'sqlite',
                  title: 'SQLite',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/orders' } },
                  },
                },
                {
                  id: 'countries',
                  title: 'Northwind · SQLite countries',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/countries' } },
                  },
                },
                {
                  id: 'billing',
                  title: 'Chinook · customer billing',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/chinook-billing' } },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  ],
};

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('tutorial scenario uses standard session actions', () => {
  it('reveals the race, switches one snapshot view twice, selects an independent tab, and gates source composition', async () => {
    const session = await TutorialBoardSession.open(canonical, 'project');
    expect(currentTutorialStep(session).step.title).toContain('Add Orders');
    for (const type of [
      'add-card',
      'set-view',
      'set-view',
      'add-card',
      'add-card',
      'select-tab',
    ]) {
      const action = currentTutorialStep(session).step.action;
      expect(action?.type).toBe(type);
      if (!action) throw new Error('Missing guide action');
      expect(session.dispatch(action)).toBe(true);
    }
    expect(session.selectedTab('inspect')).toBe('id:countries');
    expect(
      (session.board.rows?.[0].cards?.[0].widget?.data as ChartWidgetDef)
        .defaultView,
    ).toBe('chart');
    expect(currentTutorialStep(session).step.action).toBeUndefined();
    expect(currentTutorialStep(session).step.limitation).toContain(
      'unavailable',
    );
    expect(session.previous()).toBe(true);
    expect(currentTutorialStep(session).step.action?.type).toBe('select-tab');
    expect(session.next()).toBe(true);
    expect(currentTutorialStep(session).step.limitation).toBeTruthy();
    expect(canonical.rows?.[0].cards).toHaveLength(3);
    expect(
      (canonical.rows?.[0].cards?.[0].widget?.data as ChartWidgetDef)
        .defaultView,
    ).toBe('chart');
  });

  it('restores the guided cursor after reloading a three-card session', async () => {
    const storage = new MemoryStorage();
    const session = await TutorialBoardSession.open(
      canonical,
      'project',
      storage,
    );
    for (let index = 0; index < 5; index++) {
      const action = currentTutorialStep(session).step.action;
      if (!action) throw new Error('Missing guide action');
      expect(session.dispatch(action)).toBe(true);
    }

    expect(session.board.rows?.[0].cards?.map((card) => card.id)).toEqual([
      'race',
      'countries',
      'inspect',
    ]);
    expect(currentTutorialStep(session)).toMatchObject({
      index: 5,
      step: { title: 'Inspect Northwind · SQLite countries' },
    });
    const persisted = JSON.parse(storage.getItem(session.storageKey) ?? 'null');
    expect(persisted.actions[1][2]).toEqual([]);

    const restored = await TutorialBoardSession.open(
      canonical,
      'project',
      storage,
    );
    expect(restored.history.actions[1]).toMatchObject({
      type: 'set-view',
      widgetPath: [],
    });
    expect(restored.board.rows?.[0].cards?.map((card) => card.id)).toEqual([
      'race',
      'countries',
      'inspect',
    ]);
    expect(currentTutorialStep(restored)).toMatchObject({
      index: 5,
      step: { title: 'Inspect Northwind · SQLite countries' },
    });
    const action = currentTutorialStep(restored).step.action;
    expect(action?.type).toBe('select-tab');
    if (!action) throw new Error('Missing guide action');
    expect(restored.dispatch(action)).toBe(true);
    const finalStep = currentTutorialStep(restored);
    expect(finalStep.index).toBe(6);
    expect(finalStep.step.limitation).toContain('Chinook billing');
    expect(finalStep.step.limitation).toContain('Northwind chart');
    expect(finalStep.step.limitation).not.toContain('PostgreSQL');
  });

  it('continues old card-only histories and restores a removed prerequisite after Take Control', async () => {
    const session = await TutorialBoardSession.open(canonical, 'project');
    session.next();
    session.next();
    expect(currentTutorialStep(session).step.action?.type).toBe('set-view');
    session.takeControl();
    session.dispatch({ type: 'remove-card', cardId: 'race' });
    session.resume();
    expect(currentTutorialStep(session).step.action).toEqual({
      type: 'add-card',
      cardId: 'race',
    });
    const action = currentTutorialStep(session).step.action;
    if (!action) throw new Error('Missing restore action');
    session.dispatch(action);
    expect(currentTutorialStep(session).step.action?.type).toBe('set-view');
    session.restart();
    expect(currentTutorialStep(session).index).toBe(0);
  });
});

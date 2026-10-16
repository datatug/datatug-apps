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
                  id: 'pg',
                  title: 'PostgreSQL',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/countries' } },
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

describe('tutorial scenario uses standard session actions', () => {
  it('reveals the race, switches one snapshot view twice, selects an independent tab, and gates source composition', async () => {
    const session = await TutorialBoardSession.open(canonical, 'project');
    expect(currentTutorialStep(session).step.title).toContain('Add Orders');
    for (const type of [
      'add-card',
      'set-view',
      'set-view',
      'add-card',
      'select-tab',
    ]) {
      const action = currentTutorialStep(session).step.action;
      expect(action?.type).toBe(type);
      if (!action) throw new Error('Missing guide action');
      expect(session.dispatch(action)).toBe(true);
    }
    expect(session.selectedTab('inspect')).toBe('id:pg');
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
    expect(canonical.rows?.[0].cards).toHaveLength(2);
    expect(
      (canonical.rows?.[0].cards?.[0].widget?.data as ChartWidgetDef)
        .defaultView,
    ).toBe('chart');
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

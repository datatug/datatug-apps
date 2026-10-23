import { describe, expect, it } from 'vitest';
import {
  Board,
  BoardWidget,
  TutorialBoardSession,
} from '@datatug/board-models';
import { TutorialBoardRuntime } from './tutorial-board-runtime';

const ref = { storeId: 'github.com', projectId: 'r@o@' };
const canonical: Board = {
  id: 'board',
  title: 'Saved',
  rows: [
    {
      cards: [
        {
          id: 'inspect',
          title: 'Inspect',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                {
                  id: 'orders',
                  title: 'Orders',
                  widget: {
                    name: 'SQL',
                    data: { sql: { queryId: 'demodb/orders' } },
                  },
                },
                {
                  id: 'countries',
                  title: 'Countries',
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

describe('session widget admission', () => {
  async function setup() {
    const session = await TutorialBoardSession.open(canonical, 'scope');
    session.dispatch({ type: 'add-card', cardId: 'inspect' });
    session.dispatch({
      type: 'add-tab',
      cardId: 'inspect',
      tabId: 'mine',
      title: 'My saved query',
      queryId: 'demodb/countries',
    });
    const runtime = new TutorialBoardRuntime();
    runtime.publish(ref, session, () => undefined);
    const expected: BoardWidget = {
      name: 'SQL',
      data: { sql: { queryId: 'demodb/countries' } },
    };
    return { runtime, session, expected };
  }

  it('admits only the replayed session path against the exact freshly read canonical revision', async () => {
    const { runtime, expected } = await setup();
    expect(
      await runtime.admit(canonical, ref, 'inspect', ['id:mine'], expected),
    ).toBe(true);
    expect(
      await runtime.admit(
        { ...canonical, title: 'Changed remotely' },
        ref,
        'inspect',
        ['id:mine'],
        expected,
      ),
    ).toBe(false);
    expect(
      await runtime.admit(
        canonical,
        { ...ref, projectId: 'other@o@' },
        'inspect',
        ['id:mine'],
        expected,
      ),
    ).toBe(false);
    expect(
      await runtime.admit(canonical, ref, 'inspect', ['id:forged'], expected),
    ).toBe(false);
    expect(
      await runtime.admit(canonical, ref, 'inspect', ['id:mine'], {
        name: 'SQL',
        data: { sql: { queryId: 'demodb/orders' } },
      }),
    ).toBe(false);
  });

  it('rejects forged queries and source identifiers without admitting an arbitrary working board', async () => {
    const { runtime, session, expected } = await setup();
    expect(
      session.dispatch({
        type: 'set-tab-query',
        cardId: 'inspect',
        tabKey: 'id:mine',
        queryId: 'attacker/query',
      }),
    ).toBe(false);
    expect(
      session.dispatch({
        type: 'add-chart-source',
        cardId: 'inspect',
        sourceId: 'forged',
        queryId: 'demodb/orders',
      }),
    ).toBe(false);
    const working = session.board;
    if (working.rows?.[0].cards)
      working.rows[0].cards[0].widget = {
        name: 'SQL',
        data: { sql: { queryId: 'attacker/query' } },
      };
    expect(
      await runtime.admit(
        canonical,
        ref,
        'inspect',
        [],
        working.rows?.[0].cards?.[0].widget as BoardWidget,
      ),
    ).toBe(false);
    expect(
      await runtime.admit(canonical, ref, 'inspect', ['id:mine'], expected),
    ).toBe(true);
    runtime.clear();
    expect(
      await runtime.admit(canonical, ref, 'inspect', ['id:mine'], expected),
    ).toBe(false);
  });

  it('resets tampered v3 storage and keeps history getter mutations outside the admitted session', async () => {
    const { session } = await setup();
    let stored = '';
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = '';
      },
    };
    const original = await TutorialBoardSession.open(
      canonical,
      'scope',
      storage,
    );
    for (const action of session.history.actions) original.dispatch(action);
    const log = JSON.parse(stored);
    log.actions[1][3].queryId = 'attacker/query';
    stored = JSON.stringify(log);
    const restored = await TutorialBoardSession.open(
      canonical,
      'scope',
      storage,
    );
    expect(restored.board.rows?.[0].cards).toHaveLength(0);
    const history = original.history;
    (history.actions as unknown[]).push({
      type: 'set-tab-query',
      cardId: 'inspect',
      tabKey: 'id:mine',
      queryId: 'attacker/query',
    });
    expect(original.history.actions).toHaveLength(2);
  });

  it.each([
    { unit: undefined, label: 'missing unit denies a source edit', supported: false },
    { unit: '', label: 'empty unit denies a source edit', supported: false },
    { unit: '  ', label: 'whitespace unit rejects canonical session open', supported: false },
    { unit: 'orders', label: 'declared unit admits the authorized second source', supported: true },
  ])('$label', async ({ unit, supported }) => {
    const chart: BoardWidget = {
      name: 'chart',
      data: {
        sources: [{ id: 'countries', queryId: 'demodb/countries' }],
        chart: {
          type: 'bar',
          categoryColumn: 'country',
          valueColumn: 'orders',
          unit,
        },
      },
    };
    const board: Board = {
      ...canonical,
      rows: [
        {
          cards: [
            { id: 'chart', title: 'Chart', widget: chart },
            ...(canonical.rows?.[0].cards ?? []),
          ],
        },
      ],
    };
    // Whitespace-only units are rejected by canonical schema validation even before an edit.
    if (unit && !unit.trim()) {
      await expect(TutorialBoardSession.open(board, 'scope')).rejects.toThrow(
        'Invalid chart configuration.',
      );
      return;
    }
    const session = await TutorialBoardSession.open(board, 'scope');
    expect(session.dispatch({ type: 'add-card', cardId: 'chart' })).toBe(true);
    const runtime = new TutorialBoardRuntime();
    runtime.publish(ref, session, () => undefined);
    const forged: BoardWidget = {
      ...chart,
      data: {
        ...(chart.data as object),
        sources: [{ id: 'forged', queryId: 'demodb/countries' }],
      },
    };
    expect(await runtime.admit(board, ref, 'chart', [], forged)).toBe(false);
    const before = JSON.stringify(session.board);
    expect(
      session.dispatch({
        type: 'add-chart-source',
        cardId: 'chart',
        sourceId: 'second',
        queryId: 'demodb/orders',
      }),
    ).toBe(supported);
    if (!supported) {
      expect(JSON.stringify(session.board)).toBe(before);
      expect(await runtime.admit(board, ref, 'chart', [], forged)).toBe(false);
      return;
    }
    runtime.publish(ref, session, () => undefined);
    const edited = session.board.rows?.[0].cards?.[0].widget;
    if (!edited) throw new Error('Missing edited chart');
    expect(await runtime.admit(board, ref, 'chart', [], edited)).toBe(true);
    expect(await runtime.admit(board, ref, 'chart', [], forged)).toBe(false);
  });
});

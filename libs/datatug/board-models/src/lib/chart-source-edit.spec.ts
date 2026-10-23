import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import type { ChartWidgetDef } from './widget-chart';
import { editChartSources, seedChartSources } from './chart-source-edit';
import { editBoardDefinition } from './board-definition-edit';
import { TutorialBoardSession } from './tutorial-board';

const chart: ChartWidgetDef = {
  sources: [
    { id: 'northwind', queryId: 'demo/n' },
    { id: 'chinook', queryId: 'demo/c' },
  ],
  chart: {
    type: 'bar',
    categoryColumn: 'country',
    valueColumn: 'customers',
    unit: 'customer records',
  },
  defaultView: 'chart',
};
const canonical: Board = {
  id: 'showcase',
  title: 'Sources',
  rows: [
    { cards: [{ id: 'comparison', widget: { name: 'chart', data: chart } }] },
  ],
};
const data = (board: Board) =>
  board.rows?.[0].cards?.[0].widget?.data as ChartWidgetDef;

describe('ordinary independent-source actions', () => {
  it('shares append/remove validation with ordinary board definition edits', () => {
    const single = seedChartSources(chart, ['northwind']);
    const board = {
      ...canonical,
      rows: [
        {
          cards: [
            { id: 'comparison', widget: { name: 'chart', data: single } },
          ],
        },
      ],
    };
    const add = {
      type: 'add-chart-source' as const,
      cardId: 'comparison',
      sourceId: 'chinook',
      queryId: 'demo/c',
    };
    expect(data(editBoardDefinition(board, add, ['demo/n', 'demo/c']))).toEqual(
      chart,
    );
    expect(editChartSources(single, add, ['demo/n', 'demo/c'])).toEqual(chart);
    expect(
      editChartSources(
        chart,
        { type: 'remove-chart-source', sourceId: 'chinook' },
        [],
      ),
    ).toEqual(single);
    expect(board.rows[0].cards[0].widget.data).toEqual(single);
    expect(() => editChartSources(single, add, ['demo/n'])).toThrow(
      /available/,
    );
    expect(() => editChartSources(chart, add, ['demo/c'])).toThrow(
      /at most two/,
    );
    expect(() =>
      editChartSources(single, { ...add, queryId: 'demo/n' }, ['demo/n']),
    ).toThrow(/already/);
    expect(() =>
      editChartSources(
        single,
        { type: 'remove-chart-source', sourceId: 'northwind' },
        [],
      ),
    ).toThrow(/at least one/);
  });
  it('only seeds a canonical nonempty distinct source subset and preserves the exact bindings', () => {
    for (const ids of [[], ['missing'], ['northwind', 'northwind']])
      expect(() => seedChartSources(chart, ids)).toThrow();
    const missingUnit: ChartWidgetDef = {
      ...chart,
      chart: {
        type: 'bar',
        categoryColumn: 'country',
        valueColumn: 'customers',
      },
    };
    expect(() => seedChartSources(missingUnit, ['northwind'])).toThrow();
    expect(seedChartSources(chart, ['chinook']).sources).toEqual([
      chart.sources[1],
    ]);
  });
  it('restores a seeded source action, ordinary addition, undo/redo and canonical equality without changing the saved board', async () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    const session = await TutorialBoardSession.open(
      canonical,
      'sources',
      adapter,
    );
    expect(
      session.dispatch({
        type: 'add-card',
        cardId: 'comparison',
        initialSourceIds: ['northwind'],
      }),
    ).toBe(true);
    expect(data(session.board).sources).toEqual([chart.sources[0]]);
    expect(
      session.dispatch({
        type: 'add-chart-source',
        cardId: 'comparison',
        sourceId: 'chinook',
        queryId: 'demo/c',
      }),
    ).toBe(true);
    expect(session.board).toEqual(canonical);
    const restored = await TutorialBoardSession.open(
      canonical,
      'sources',
      adapter,
    );
    expect(restored.board).toEqual(canonical);
    expect(restored.previous()).toBe(true);
    expect(data(restored.board).sources).toEqual([chart.sources[0]]);
    expect(restored.next()).toBe(true);
    expect(restored.board).toEqual(canonical);
    restored.restart();
    expect(restored.board.rows?.[0].cards).toEqual([]);
    expect(canonical.rows?.[0].cards?.[0].widget?.data).toEqual(chart);
  });
});

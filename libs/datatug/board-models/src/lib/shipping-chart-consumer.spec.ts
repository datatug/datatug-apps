import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  editBoardDefinition,
  parseHostedBoardDefinition,
} from './board-definition-edit';
import { validateChartDefinition, validChartSpec } from './board-presentation';
import { ChartWidgetDef } from './widget-chart';
import { Board } from './board';
// Unmodified published-contract fixture: Demo da6f75453cfcfaecdb127a39e013dda3f2c19107.
const raw = readFileSync(
  resolve(import.meta.dirname, 'testdata/shipping-board.core-v063.json'),
  'utf8',
);
const board = () => parseHostedBoardDefinition(raw);
const charts = () =>
  board()
    .rows?.flatMap((row) => row.cards ?? [])
    .map((card) => card.widget?.data as ChartWidgetDef) ?? [];
describe('canonical shipping chart wire', () => {
  it('admits the unchanged three-chart Demo board and losslessly roundtrips all mappings and dynamic inputs', () => {
    const value = board();
    expect(parseHostedBoardDefinition(JSON.stringify(value))).toEqual(
      JSON.parse(raw),
    );
    expect(charts().map((data) => data.chart.type)).toEqual([
      'timeline',
      'timing-bars',
      'heatmap',
    ]);
    expect(value.parameters?.[0]).toEqual({
      id: 'order_id',
      title: 'Order ID',
      type: 'integer',
      isRequired: true,
    });
  });
  it('rejects unknown/null/mixed variants and legacy fields even when explicitly empty', () => {
    for (const data of charts()) {
      for (const extra of [
        { valueColumn: '' },
        { categoryColumn: null },
        { unit: 'ms' },
        { topN: 0 },
        { series: [] },
        { other: 1 },
      ])
        expect(validChartSpec({ ...data.chart, ...extra })).toBe(false);
      expect(validChartSpec({ ...data.chart, selectionId: null })).toBe(false);
      expect(() =>
        validateChartDefinition({
          ...data,
          sources: [...data.sources, ...data.sources],
        }),
      ).toThrow();
      expect(() =>
        validateChartDefinition({
          ...data,
          sources: [
            {
              ...data.sources[0],
              transform: {
                name: 'orders-monthly-country-count',
                orderIdColumn: 'a',
                dateColumn: 'b',
                countryColumn: 'c',
              },
            },
          ],
        }),
      ).toThrow();
    }
  });
  it('accepts shared timing clock/precision mappings but rejects identical endpoint observation roles', () => {
    const data = charts()[1];
    expect(validChartSpec(data.chart)).toBe(true);
    if (data.chart.type !== 'timing-bars') throw new Error('fixture');
    expect(
      validChartSpec({
        ...data.chart,
        timing: {
          ...data.chart.timing,
          endIdentityColumn: data.chart.timing.startIdentityColumn,
        },
      }),
    ).toBe(false);
  });
  it('uses Core whitespace semantics rather than JS BOM trimming', () => {
    const data = charts()[2];
    expect(
      validChartSpec({ ...data.chart, selectionId: '\ufeffselection' }),
    ).toBe(true);
    expect(
      validChartSpec({ ...data.chart, selectionId: '\u0085selection' }),
    ).toBe(false);
  });
  it('applies structured chart edits and declared input references without changing untouched cards', () => {
    const source = board(),
      available = ['shipping/events', 'shipping/timings', 'shipping/readiness'];
    let next: Board = {
      id: 'new',
      title: 'New',
      rows: [
        {
          cards: [
            {
              id: 'new-card',
              widget: { name: 'SQL', data: { sql: { queryId: available[0] } } },
            },
          ],
        },
      ],
    };
    next = editBoardDefinition(
      next,
      {
        type: 'set-parameter',
        parameter: { id: 'order_id', type: 'integer', isRequired: true },
      },
      available,
    );
    for (const data of charts())
      next = editBoardDefinition(
        next,
        { type: 'set-chart', cardId: 'new-card', definition: data },
        available,
      );
    next = editBoardDefinition(
      next,
      {
        type: 'bind-board-parameter',
        cardId: 'new-card',
        parameterId: 'order_id',
        boardParameterId: 'order_id',
      },
      available,
    );
    expect(parseHostedBoardDefinition(JSON.stringify(next))).toEqual(next);
    expect(() =>
      editBoardDefinition(
        next,
        {
          type: 'bind-board-parameter',
          cardId: 'new-card',
          parameterId: 'order_id',
          boardParameterId: 'missing',
        },
        available,
      ),
    ).toThrow();
    expect(() =>
      editBoardDefinition(
        next,
        { type: 'set-chart', cardId: 'new-card', definition: charts()[0] },
        [],
      ),
    ).toThrow();
    for (const value of [9007199254740992, -0]) {
      const data = charts()[0];
      expect(() =>
        editBoardDefinition(
          source,
          {
            type: 'set-chart',
            cardId: 'milestones',
            definition: {
              ...data,
              sources: [
                { ...data.sources[0], parameters: [{ id: 'order_id', value }] },
              ],
            },
          },
          available,
        ),
      ).toThrow(/precision|exact/);
    }
    const renamed = editBoardDefinition(
      source,
      { type: 'title', title: 'Renamed' },
      available,
    );
    expect(renamed.rows).toEqual(source.rows);
    expect(() =>
      parseHostedBoardDefinition(
        raw.replace('"cols": 12', '"cols": 9007199254740993'),
      ),
    ).toThrow(/precision/);
  });
});

import parameterWireCases from './__fixtures__/board-parameter-wire.json';
import {
  validateBoardPresentation,
  validChartSpec,
  validateChartDefinition,
} from './board-presentation';
import { replayBoardActions } from './tutorial-board';
import type { Board } from './board';
const chart = () => ({
  type: 'bar',
  categoryColumn: 'country',
  unit: 'customer records',
  series: [
    { id: 'northwind', title: 'Northwind', valueColumn: 'n' },
    { id: 'chinook', title: 'Chinook', valueColumn: 'c' },
  ],
  selectionId: 'country',
});
const producer = () => ({
  name: 'chart',
  data: {
    sources: [{ id: 'comparison', queryId: 'comparison' }],
    chart: chart(),
  },
});
const consumer = () => ({
  name: 'SQL',
  data: {
    sql: {
      queryId: 'orders',
      presentationFilter: { selectionId: 'country', column: 'ShipCountry' },
    },
  },
});
const board = () => ({
  id: 'b',
  title: 'Board',
  rows: [
    {
      cards: [
        { id: 'a', title: 'A', widget: producer() },
        {
          id: 'b',
          title: 'B',
          widget: {
            name: 'tabs',
            data: {
              tabs: [
                { title: 'Empty' },
                { title: 'Inactive', widget: consumer() },
              ],
            },
          },
        },
      ],
    },
  ],
});
describe('whole-board presentation admission', () => {
  it.each([NaN, Infinity, -Infinity])(
    'rejects non-finite integer/bit defaults before JSON serialization: %s',
    (value) => {
      for (const type of ['integer', 'bit']) {
        const data = {
          sources: [{ id: 'q', queryId: 'q' }],
          chart: {
            type: 'bar',
            categoryColumn: 'country',
            valueColumn: 'orders',
          },
          parameters: [{ id: 'n', type, defaultValue: value }],
        };
        expect(() => validateChartDefinition(data)).toThrow(
          'Invalid chart parameters.',
        );
      }
    },
  );

  // Core json.Unmarshal(Board) + Board.Validate interoperability matrix;
  // integer/bit defaults follow the coordinated JSON-safe integer patch.
  // No Go/WASM dependency at test runtime; the same payloads exercise all TS entry paths.
  it.each(parameterWireCases)(
    'matches Core raw parameter/source/transform wire: $name',
    ({ data, expectedValid }) => {
      const raw = {
        id: 'b',
        title: 'Board',
        rows: [{ cards: [{ id: 'c', widget: { name: 'chart', data } }] }],
      };
      const original = JSON.stringify(raw);
      for (const validate of [
        () => validateChartDefinition(data),
        () => validateBoardPresentation(raw),
        () =>
          replayBoardActions(raw as Board, [{ type: 'add-card', cardId: 'c' }]),
      ]) {
        if (expectedValid) expect(validate).not.toThrow();
        else expect(validate).toThrow();
      }
      expect(JSON.stringify(raw)).toBe(original);
    },
  );
  it.each([undefined, null, {}, { tabs: null }, { tabs: [] }])(
    'preserves Core-valid empty tabs %j through raw admission and tutorial replay',
    (data) => {
      const empty = {
        id: 'empty',
        title: 'Empty',
        rows: [
          {
            cards: [
              {
                id: 'placeholder',
                title: 'Placeholder',
                widget: { name: 'tabs', data },
              },
            ],
          },
        ],
      };
      expect(validateBoardPresentation(empty)).toEqual([]);
      expect(
        replayBoardActions(empty as Board, [
          { type: 'add-card', cardId: 'placeholder' },
        ]).board,
      ).toEqual(empty);
    },
  );
  it('shares closed source/transform admission while preserving legacy independent sources and SQL fields', () => {
    const legacy = {
      sources: [
        { id: 'a', queryId: 'a' },
        { id: 'b', queryId: 'b' },
      ],
      chart: { type: 'bar', categoryColumn: 'country', valueColumn: 'n' },
    };
    expect(() => validateChartDefinition(legacy)).not.toThrow();
    const race = {
      type: 'bar-race',
      categoryColumn: 'category',
      valueColumn: 'value',
      periodColumn: 'period',
      unit: 'orders',
      grain: 'month',
      mode: 'period',
      onDuplicate: 'reject',
      topN: 10,
    };
    const transform = {
      name: 'orders-monthly-country-count',
      orderIdColumn: 'OrderID',
      dateColumn: 'OrderDate',
      countryColumn: 'ShipCountry',
    };
    const definition = {
      sources: [{ id: 'orders', queryId: 'orders', transform }],
      chart: race,
    };
    expect(() => validateChartDefinition(definition)).not.toThrow();
    expect(() =>
      validateChartDefinition({
        ...definition,
        sources: [{ id: 'orders', queryId: 'orders', transform: null }],
      }),
    ).not.toThrow();
    for (const invalid of [
      {
        ...definition,
        sources: [...definition.sources, { id: 'second', queryId: 'second' }],
      },
      { ...definition, chart: chart() },
      {
        ...definition,
        sources: [{ ...definition.sources[0], expression: 'run()' }],
      },
      ...[
        {},
        { ...transform, extra: true },
        { ...transform, dateColumn: 'OrderID' },
        { ...transform, countryColumn: '' },
      ].map((t) => ({
        ...definition,
        sources: [{ id: 'orders', queryId: 'orders', transform: t }],
      })),
    ]) {
      expect(() => validateChartDefinition(invalid)).toThrow();
      expect(() =>
        validateBoardPresentation({
          rows: [{ cards: [{ widget: { name: 'chart', data: invalid } }] }],
        }),
      ).toThrow();
    }
    expect(() =>
      validateBoardPresentation({
        rows: [
          {
            cards: [
              {
                widget: {
                  name: 'SQL',
                  data: {
                    legacy: true,
                    sql: { queryId: 'orders', legacy: true },
                  },
                },
              },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it('admits raw nested producers/references and empty tabs, including two through eight series', () => {
    expect(validateBoardPresentation(board())).toEqual(['country']);
    for (let n = 2; n <= 8; n++)
      expect(
        validChartSpec({
          ...chart(),
          series: Array.from({ length: n }, (_, i) => ({
            id: `s${i}`,
            title: `Series ${i}`,
            valueColumn: `v${i}`,
          })),
        }),
      ).toBe(true);
  });
  it.each([
    { ...chart(), valueColumn: null },
    { ...chart(), series: null },
    { ...chart(), series: [] },
    { ...chart(), selectionId: null },
    {
      ...chart(),
      series: [
        { id: 'a', title: 'a', valueColumn: 'x' },
        { id: 'b', title: 'b', valueColumn: 'x' },
      ],
    },
    {
      ...chart(),
      series: [
        { id: 'a', title: 'a', valueColumn: 'x', expression: 'run()' },
        { id: 'b', title: 'b', valueColumn: 'y' },
      ],
    },
    { ...chart(), unknown: 'value' },
    { ...chart(), Series: [] },
    { ...chart(), ValueColumn: '' },
    { ...chart(), SelectionID: 'other' },
  ])('rejects closed new fields %#', (spec) =>
    expect(validChartSpec(spec)).toBe(false),
  );
  it('checks duplicate producers and unresolved references in inactive nested tabs', () => {
    const b = board();
    b.rows[0].cards.push({ id: 'other', title: 'Other', widget: producer() });
    expect(() => validateBoardPresentation(b)).toThrow();
    const missing = board();
    missing.rows[0].cards.shift();
    expect(() => validateBoardPresentation(missing)).toThrow();
  });
  it('rejects unknown/null executable filters, excessive nesting and cyclic raw objects', () => {
    for (const filter of [
      null,
      { selectionId: 'country', column: 'ShipCountry', expression: 'run()' },
      { SelectionId: 'country', column: 'ShipCountry' },
      { selectionId: 'country', Column: 'ShipCountry' },
    ]) {
      const b: Board = board();
      const cards = b.rows?.[0].cards;
      if (!cards) throw new Error('Missing fixture cards');
      cards[1].widget = {
        name: 'SQL',
        data: { sql: { queryId: 'orders', presentationFilter: filter } },
      };
      expect(() => validateBoardPresentation(b)).toThrow();
    }
    for (const name of [
      'PresentationFilter',
      'presentationfilter',
      'PRESENTATIONFILTER',
    ]) {
      const raw = {
        rows: [
          {
            cards: [
              {
                widget: {
                  name: 'SQL',
                  data: { sql: { queryId: 'orders', [name]: null } },
                },
              },
            ],
          },
        ],
      };
      expect(() => validateBoardPresentation(raw)).toThrow();
    }
    const cyclic = { name: 'tabs', data: { tabs: [] as unknown[] } };
    cyclic.data.tabs.push({ widget: cyclic });
    expect(() =>
      validateBoardPresentation({ rows: [{ cards: [{ widget: cyclic }] }] }),
    ).toThrow();
  });
  it('keeps legacy bars/races valid and validates canonical data before tutorial replay', () => {
    expect(
      validChartSpec({
        type: 'bar',
        categoryColumn: 'country',
        valueColumn: 'orders',
      }),
    ).toBe(true);
    expect(() => replayBoardActions(board() as Board, [])).not.toThrow();
    const invalid = board();
    invalid.rows[0].cards.shift();
    expect(() => replayBoardActions(invalid as Board, [])).toThrow();
  });
});


it('mirrors the closed Core70 elapsed mapping without loosening absolute or mixed arms', () => {
  const fields = ['laneColumn', 'eventColumn', 'sequenceColumn', 'timeColumn', 'clockDomainColumn', 'precisionColumn', 'statusColumn', 'evidenceRefColumn'];
  const timeline = Object.fromEntries(fields.map((field) => [field, field]));
  const chart = { type: 'timeline', selectionId: 'events', timeline };
  expect(validChartSpec(chart)).toBe(true);
  expect(validChartSpec({ ...chart, timeline: { ...timeline, timeMode: 'elapsed', anchorColumn: 'anchor' } })).toBe(true);
  for (const extra of [{ timeMode: null }, { timeMode: 'elapsed' }, { timeMode: 'absolute', anchorColumn: 'anchor' }, { timeMode: 'elapsed', anchorColumn: 'laneColumn' }])
    expect(validChartSpec({ ...chart, timeline: { ...timeline, ...extra } })).toBe(false);
});

/* eslint-disable @typescript-eslint/no-explicit-any -- negative tests mutate untyped JSON */
import {
  parseProjectCard,
  validateHostedBoardDefinition,
  validateProjectCard,
} from './board-definition-edit';
import { Board } from './board';
import { validateBoardPresentation } from './board-presentation';

const sql = (queryId = 'customers/by-id') => ({
  name: 'SQL',
  data: { sql: { queryId, parameters: [{ id: 'id', boardParameterId: 'customerId' }] } },
});
const card = (): Record<string, unknown> => ({
  id: 'customer',
  title: 'Customer',
  description: 'One customer',
  display: 'tooltip',
  parameters: [
    {
      id: 'customerId',
      type: 'string',
      isRequired: true,
      match: [{ column: 'CustomerID' }, { table: 'Orders', column: 'CustomerID' }, { entity: 'customer', field: 'id' }],
    },
    { id: 'row', type: 'record' },
  ],
  widget: {
    name: 'tabs',
    data: {
      tabs: [
        {
          title: 'Main',
          widgets: [
            { name: 'text', data: { title: 'Hi', markdown: 'Hello {{customerId}}' } },
            { name: 'fields', data: { source: { queryId: 'customers/by-id' }, fields: [{ column: 'Name', label: 'Name' }] } },
            { name: 'fields', data: { source: { parameter: 'row' } } },
          ],
        },
        { title: 'Legacy', widget: sql() },
      ],
    },
  },
});

describe('validateProjectCard', () => {
  it('admits a full card', () => {
    expect(validateProjectCard(card()).id).toBe('customer');
  });
  it('rejects unknown keys at every level', () => {
    const mutate = (fn: (c: any) => void) => {
      const c = card();
      fn(c);
      expect(() => validateProjectCard(c)).toThrow();
    };
    mutate((c) => (c.extra = 1));
    mutate((c) => (c.parameters[0].extra = 1));
    mutate((c) => (c.widget.data.tabs[0].extra = 1));
    mutate((c) => (c.widget.data.tabs[0].widgets[0].data.extra = 1));
    mutate((c) => (c.widget.data.tabs[0].widgets[1].data.source.extra = 1));
    mutate((c) => (c.parameters[0].match[0].bogus = 'x'));
  });
  it('rejects ref, cols, missing widget, bad id and bad display', () => {
    for (const patch of [
      { ref: { cardId: 'x' } },
      { cols: 6 },
      { widget: undefined },
      { id: 'a/b' },
      { id: '' },
      { display: 'popup' },
      { title: 3 },
    ])
      expect(() => validateProjectCard({ ...card(), ...patch })).toThrow();
    expect(() => validateProjectCard(null)).toThrow();
    expect(() => validateProjectCard([])).toThrow();
  });
  it('rejects duplicate parameter ids, record defaults and non-string match values', () => {
    const c = card() as any;
    c.parameters.push({ id: 'customerId', type: 'string' });
    expect(() => validateProjectCard(c)).toThrow();
    const r = card() as any;
    r.parameters = [{ id: 'row', type: 'record', defaultValue: { a: 1 } }];
    expect(() => validateProjectCard(r)).toThrow();
    const m = card() as any;
    m.parameters[0].match = [{ column: 3 }];
    expect(() => validateProjectCard(m)).toThrow();
    m.parameters[0].match = 'x';
    expect(() => validateProjectCard(m)).toThrow();
  });
  it('admits semantically malformed match rules (ignored at match time)', () => {
    const c = card() as any;
    c.parameters[0].match = [{ entity: 'x' }, { table: 'Orders' }, {}];
    expect(validateProjectCard(c)).toBeTruthy();
  });
  it('rejects unknown widgets and record parameters used as record defaults', () => {
    const c = card() as any;
    c.widget = { name: 'carousel', data: {} };
    expect(() => validateProjectCard(c)).toThrow();
    c.widget = { name: 'text', data: { markdown: 4 } };
    expect(() => validateProjectCard(c)).toThrow();
    c.widget = { name: 'fields', data: { source: { parameter: 'a', queryId: 'q' } } };
    expect(() => validateProjectCard(c)).toThrow();
  });
});

describe('parameter-sourced SQL grid widget', () => {
  const withWidget = (widget: unknown) => ({
    ...card(),
    parameters: [{ id: 'orders', type: 'recordset' }],
    widget,
  });
  it('admits source: {parameter} and presentation validation', () => {
    const c = withWidget({
      name: 'SQL',
      data: { title: 'Orders', source: { parameter: 'orders' } },
    });
    expect(validateProjectCard(c).id).toBe('customer');
    expect(() =>
      validateBoardPresentation({
        id: 'b',
        title: 'B',
        rows: [{ cards: [{ id: 'c', title: 'C', widget: (c as any).widget }] }],
      } as Board),
    ).not.toThrow();
  });
  it('rejects source together with sql, extra keys, or an empty parameter', () => {
    for (const data of [
      { source: { parameter: 'a' }, sql: { queryId: 'q' } },
      { source: { parameter: 'a', extra: 1 } },
      { source: { parameter: '' } },
      { source: 'a' },
    ])
      expect(() =>
        validateProjectCard(withWidget({ name: 'SQL', data })),
      ).toThrow();
  });
});

describe('rows sources and tab shapes', () => {
  it('requires source.parameter to be a declared record or recordset input', () => {
    const grid = (parameter: string, parameters: unknown[]) =>
      validateProjectCard({
        id: 'c',
        title: 'C',
        parameters,
        widget: { name: 'SQL', data: { source: { parameter } } },
      });
    expect(grid('orders', [{ id: 'orders', type: 'recordset' }]).id).toBe('c');
    expect(grid('row', [{ id: 'row', type: 'record' }]).id).toBe('c');
    expect(() => grid('orders', [])).toThrow('declared record or recordset');
    expect(() => grid('orders', [{ id: 'orders', type: 'string' }])).toThrow(
      'declared record or recordset',
    );
    // also inside tabs, for fields
    expect(() =>
      validateProjectCard({
        id: 'c',
        title: 'C',
        widget: {
          name: 'tabs',
          data: { tabs: [{ title: 'T', widgets: [{ name: 'fields', data: { source: { parameter: 'nope' } } }] }] },
        },
      }),
    ).toThrow('declared record or recordset');
  });
  it('makes tab.widget and tab.widgets exclusive', () => {
    const text = { name: 'text', data: { markdown: 'x' } };
    const tab = (extra: object) =>
      validateProjectCard({
        id: 'c',
        title: 'C',
        widget: { name: 'tabs', data: { tabs: [{ title: 'T', ...extra }] } },
      });
    expect(tab({ widget: text }).id).toBe('c');
    expect(tab({ widgets: [text] }).id).toBe('c');
    expect(() => tab({ widget: text, widgets: [text] })).toThrow('either widget or widgets');
  });
});

describe('validateHostedBoardDefinition with project cards', () => {
  const board = (cardOverride: Record<string, unknown>): Board =>
    ({
      id: 'b',
      title: 'B',
      parameters: [{ id: 'customerId', type: 'string' }],
      rows: [{ cards: [{ id: 'c1', title: 'C', ...cardOverride }] }],
    }) as Board;
  it('admits ref, text, fields and tabs widgets[]', () => {
    expect(() =>
      validateHostedBoardDefinition(
        board({ ref: { cardId: 'customer', parameters: [{ id: 'customerId', boardParameterId: 'customerId' }, { id: 'x', value: 4 }] } }),
      ),
    ).not.toThrow();
    expect(() =>
      validateHostedBoardDefinition(
        board({ widget: (card()['widget'] as unknown) }),
      ),
    ).not.toThrow();
  });
  it('requires exactly one of widget or ref and rejects unknown ref keys', () => {
    expect(() => validateHostedBoardDefinition(board({}))).toThrow();
    expect(() =>
      validateHostedBoardDefinition(board({ ref: { cardId: 'x' }, widget: sql() })),
    ).toThrow();
    expect(() => validateHostedBoardDefinition(board({ ref: { cardId: 'x', extra: 1 } }))).toThrow();
    expect(() => validateHostedBoardDefinition(board({ ref: { cardId: '../x' } }))).toThrow();
    expect(() =>
      validateHostedBoardDefinition(board({ ref: { cardId: 'x', parameters: [{ id: 'a', value: 1, boardParameterId: 'b' }] } })),
    ).toThrow();
  });
  it('rejects match on board parameters', () => {
    const b = board({ widget: sql() });
    b.parameters = [{ id: 'p', type: 'string', match: [{ column: 'a' }] } as never];
    expect(() => validateHostedBoardDefinition(b)).toThrow();
  });
});

describe('parseProjectCard and presentation of widgets[]', () => {
  it('parses a card body and rejects unsafe number lexemes', () => {
    expect(parseProjectCard(JSON.stringify(card())).id).toBe('customer');
    const raw = JSON.stringify(card()).replace('"isRequired":true', '"isRequired":true,"maxLength":9007199254740993');
    expect(() => parseProjectCard(raw)).toThrow('numeric precision');
    expect(() => parseProjectCard('x'.repeat(300 * 1024))).toThrow('read limit');
  });
  it('checks charts inside widgets[] for duplicate selection producers', () => {
    const chart = (id: string) => ({
      name: 'chart',
      data: {
        sources: [{ id: 's', queryId: 'q' }],
        chart: { type: 'bar', categoryColumn: 'a', valueColumn: 'b', selectionId: id },
      },
    });
    const board = (widgets: unknown[]) => ({
      rows: [{ cards: [{ widget: { name: 'tabs', data: { tabs: [{ title: 't', widgets }] } } }] }],
    });
    expect(validateBoardPresentation(board([chart('x'), chart('y')]))).toEqual(['x', 'y']);
    expect(() => validateBoardPresentation(board([chart('x'), chart('x')]))).toThrow();
  });
});

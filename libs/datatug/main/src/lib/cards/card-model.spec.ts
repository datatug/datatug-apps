import type { Board, BoardCard, ProjectCard } from '@datatug/board-models';
import {
  boundBoardParameterIds,
  buildCellIdentity,
  cardFromBoardCard,
  cardValidationError,
  coercePreviewValue,
  finishCard,
  firstTabCard,
  flattenQueryFolder,
  matchRuleKind,
  matchRuleOfKind,
  matchRuleText,
  newCardTemplate,
  parameterChips,
  slugifyCardId,
  uniqueCardId,
} from './card-model';

describe('card ids', () => {
  it('slugifies titles', () => {
    expect(slugifyCardId('Customer details')).toBe('customer-details');
    expect(slugifyCardId('  Café / Ünï  ')).toBe('cafe-uni');
    expect(slugifyCardId('***')).toBe('card');
    expect(slugifyCardId('x'.repeat(300)).length).toBeLessThanOrEqual(120);
  });
  it('suffixes -2, -3 on collision', () => {
    expect(uniqueCardId('customer', [])).toBe('customer');
    expect(uniqueCardId('customer', ['customer'])).toBe('customer-2');
    expect(uniqueCardId('customer', ['customer', 'customer-2'])).toBe(
      'customer-3',
    );
  });
});

describe('newCardTemplate', () => {
  it('passes card validation, with one tab and one text widget', () => {
    const card = newCardTemplate();
    expect(cardValidationError(card)).toBeUndefined();
    const tabs = (card.widget?.data as { tabs: { widgets: unknown[] }[] }).tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].widgets).toHaveLength(1);
  });
});

describe('match rule helpers', () => {
  it('names the kind and the text of a rule', () => {
    expect(matchRuleKind({ entity: 'Customer', field: 'ID' })).toBe('entity');
    expect(matchRuleKind({ table: 'Orders', column: 'CustomerID' })).toBe('table');
    expect(matchRuleKind({ column: 'CustomerID' })).toBe('column');
    expect(matchRuleText({ entity: 'Customer', field: 'ID' })).toBe('Customer.ID');
    expect(matchRuleText({ table: 'Orders', column: 'CustomerID' })).toBe(
      'Orders.CustomerID',
    );
    expect(matchRuleText({ column: 'CustomerID' })).toBe('CustomerID');
  });
  it('keeps what was typed when the kind changes', () => {
    expect(matchRuleOfKind('table', { column: 'CustomerID' })).toEqual({
      table: '',
      column: 'CustomerID',
    });
    expect(matchRuleOfKind('entity', { table: 'T', column: 'C' })).toEqual({
      entity: '',
      field: 'C',
    });
    expect(matchRuleOfKind('column', { entity: 'E', field: 'F' })).toEqual({
      column: 'F',
    });
    expect(matchRuleOfKind('column')).toEqual({ column: '' });
  });
  it('shows chips such as customerId ← Customer.CustomerID', () => {
    expect(
      parameterChips({
        parameters: [
          {
            id: 'customerId',
            type: 'string',
            match: [
              { entity: 'Customer', field: 'CustomerID' },
              { column: 'CustomerID' },
            ],
          },
          { id: 'plain', type: 'string' },
        ],
      }),
    ).toEqual(['customerId ← Customer.CustomerID +1', 'plain']);
    expect(parameterChips({})).toEqual([]);
  });
});

describe('finishCard', () => {
  it('drops blank rules, empty descriptions and empty parameter lists', () => {
    const card: ProjectCard = {
      ...newCardTemplate(),
      description: '  ',
      parameters: [
        {
          id: 'a',
          type: 'string',
          match: [{ column: '' }, { column: 'A' }, { table: 'T', column: ' ' }],
        },
        { id: 'b', type: 'string', match: [{ column: '' }] },
      ],
    };
    const done = finishCard(card);
    expect(done.description).toBeUndefined();
    expect(done.parameters).toEqual([
      { id: 'a', type: 'string', match: [{ column: 'A' }] },
      { id: 'b', type: 'string' },
    ]);
    expect(finishCard({ ...newCardTemplate(), parameters: [] }).parameters).toBeUndefined();
  });
  it('reports validation messages instead of throwing', () => {
    expect(cardValidationError({ id: 'bad id', title: 'x' })).toBeTruthy();
  });
});

describe('firstTabCard', () => {
  it('keeps only the first tab of several', () => {
    const card: ProjectCard = {
      id: 'c',
      title: 'C',
      widget: {
        name: 'tabs',
        data: {
          tabs: [
            { title: 'One', widgets: [] },
            { title: 'Two', widgets: [] },
          ],
        },
      },
    };
    const compact = firstTabCard(card);
    expect((compact.widget?.data as { tabs: unknown[] }).tabs).toHaveLength(1);
    expect(firstTabCard(newCardTemplate())).toEqual(newCardTemplate());
    expect(firstTabCard({ id: 'c', title: 'C' })).toEqual({ id: 'c', title: 'C' });
  });
});

describe('cardFromBoardCard (Save as project card)', () => {
  const board: Pick<Board, 'parameters'> = {
    parameters: [
      { id: 'customerId', type: 'string', isRequired: true },
      { id: 'unused', type: 'string' },
    ],
  };
  const inline: BoardCard = {
    id: 'cell',
    title: 'Customer orders',
    widget: {
      name: 'tabs',
      data: {
        tabs: [
          {
            title: 'Orders',
            widgets: [
              {
                name: 'SQL',
                data: {
                  sql: {
                    queryId: 'orders/by-customer',
                    parameters: [{ id: 'cid', boardParameterId: 'customerId' }],
                  },
                },
              },
            ],
          },
        ],
      },
    },
  };

  it('finds the bound board parameters across tabs, charts and fields', () => {
    expect(boundBoardParameterIds(inline.widget)).toEqual(['customerId']);
    expect(
      boundBoardParameterIds({
        name: 'chart',
        data: { sources: [{ id: 's', queryId: 'q', parameters: [{ id: 'a', boardParameterId: 'x' }] }] },
      }),
    ).toEqual(['x']);
    expect(
      boundBoardParameterIds({
        name: 'fields',
        data: { source: { queryId: 'q', parameters: [{ id: 'a', boardParameterId: 'y' }] } },
      }),
    ).toEqual(['y']);
    expect(boundBoardParameterIds(undefined)).toEqual([]);
  });

  it('copies bound board parameters with the same ids and returns the ref that binds them', () => {
    const { card, ref } = cardFromBoardCard(inline, board, []);
    expect(card.id).toBe('customer-orders');
    expect(card.parameters).toEqual([
      { id: 'customerId', type: 'string', isRequired: true },
    ]);
    expect(card.widget).toEqual(inline.widget);
    expect(card.widget).not.toBe(inline.widget);
    expect(ref).toEqual({
      cardId: 'customer-orders',
      parameters: [{ id: 'customerId', boardParameterId: 'customerId' }],
    });
  });

  it('suffixes the id on collision and refuses a reference cell', () => {
    expect(
      cardFromBoardCard(inline, board, ['customer-orders', 'customer-orders-2']).card.id,
    ).toBe('customer-orders-3');
    expect(() =>
      cardFromBoardCard({ id: 'r', title: 'R', ref: { cardId: 'x' } }, board, []),
    ).toThrow();
  });

  it('makes a card without parameters when the widget binds none', () => {
    const { card, ref } = cardFromBoardCard(
      { id: 'n', title: 'Notes', widget: { name: 'text', data: { markdown: 'hi' } } },
      board,
      [],
    );
    expect(card.parameters).toBeUndefined();
    expect(ref).toEqual({ cardId: 'notes' });
  });
});

describe('buildCellIdentity', () => {
  it('uses the physical table and column', () => {
    expect(buildCellIdentity({ schema: 'dbo', table: 'Orders', column: 'CustomerID' })).toEqual({
      table: 'dbo.Orders',
      column: 'CustomerID',
    });
    expect(buildCellIdentity({ column: 'x' })).toEqual({ column: 'x' });
  });
  it('prefers the semantic mapping over the foreign key', () => {
    const identity = buildCellIdentity({
      table: 'Orders',
      column: 'CustomerID',
      semantic: { entity: 'Customer', field: 'Id' },
      foreignKeys: [{ columns: ['CustomerID'], refTable: { name: 'Customers' }, refColumns: ['CustomerID'] }],
    });
    expect(identity.entity).toEqual({ entity: 'Customer', field: 'Id' });
  });
  it('falls back to the foreign key referenced table and column', () => {
    expect(
      buildCellIdentity({
        table: 'Orders',
        column: 'customerid',
        foreignKeys: [
          { columns: ['A', 'CustomerID'], refTable: { name: 'Customers' }, refColumns: ['X', 'Id'] },
        ],
      }).entity,
    ).toEqual({ entity: 'Customers', field: 'Id' });
    // without referenced columns the foreign key column's own name stands in
    expect(
      buildCellIdentity({
        column: 'CustomerID',
        foreignKeys: [{ columns: ['CustomerID'], refTable: { name: 'Customers' } }],
      }).entity,
    ).toEqual({ entity: 'Customers', field: 'CustomerID' });
    expect(
      buildCellIdentity({ column: 'Other', foreignKeys: [{ columns: ['A'], refTable: { name: 'T' } }] }).entity,
    ).toBeUndefined();
  });
});

describe('query pickers and preview values', () => {
  it('flattens a query folder tree', () => {
    const list = flattenQueryFolder({
      items: [{ id: 'a', title: 'A', parameters: [{ id: 'p', type: 'string', isRequired: true }] }],
      folders: [{ items: [{ id: 'b' }], folders: [{ items: [{ id: 'c' }] }] }],
    });
    expect(list.map((q) => q.id)).toEqual(['a', 'b', 'c']);
    expect(list[0].parameters?.[0]).toEqual({ id: 'p', type: 'string', isRequired: true });
    expect(flattenQueryFolder(undefined)).toEqual([]);
    expect(flattenQueryFolder({ items: [{ id: 'a' }, { id: 'b' }] }, 1)).toHaveLength(1);
  });
  it('types preview values', () => {
    expect(coercePreviewValue('string', 'x')).toBe('x');
    expect(coercePreviewValue('integer', '42')).toBe(42);
    expect(coercePreviewValue('integer', 'abc')).toBe('abc');
    expect(coercePreviewValue('boolean', 'TRUE')).toBe(true);
    expect(coercePreviewValue('string', '')).toBeUndefined();
    expect(coercePreviewValue('record', '{"a":1}')).toEqual({ a: 1 });
    expect(coercePreviewValue('recordset', ' ')).toBeUndefined();
    expect(() => coercePreviewValue('record', '{oops')).toThrow();
  });
});

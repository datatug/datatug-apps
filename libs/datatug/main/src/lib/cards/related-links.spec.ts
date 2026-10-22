import {
  cardEntityNames,
  cardQueryIds,
  cardShowsEntity,
  queriesForEntity,
} from './related-links';

describe('related links', () => {
  const card = {
    id: 'customer',
    parameters: [
      {
        meta: { entity: 'Customer' },
        match: [{ entity: 'Customer' }, { entity: ' Account ' }, {}],
      },
      { meta: null, match: null },
    ],
    widget: {
      name: 'tabs',
      data: {
        tabs: [
          {
            widgets: [
              { data: { source: { queryId: 'northwind/customer-by-id' } } },
            ],
          },
          { widgets: [{ data: { queryId: 'northwind/orders-by-customer' } }] },
          {
            widgets: [
              { data: { queryId: 'northwind/customer-by-id' } },
              { data: { queryId: '  ' } },
            ],
          },
        ],
      },
    },
  };

  it('lists a card’s entities once, in first-mention order', () => {
    expect(cardEntityNames(card)).toEqual(['Customer', 'Account']);
    expect(cardEntityNames({})).toEqual([]);
  });

  it('collects the saved queries anywhere in a card’s widget tree', () => {
    expect(cardQueryIds(card)).toEqual([
      'northwind/customer-by-id',
      'northwind/orders-by-customer',
    ]);
    expect(cardQueryIds({ widget: 'text' })).toEqual([]);
  });

  it('matches an entity case-insensitively and never a blank one', () => {
    expect(cardShowsEntity(card, 'customer')).toBe(true);
    expect(cardShowsEntity(card, 'Order')).toBe(false);
    expect(cardShowsEntity(card, ' ')).toBe(false);
  });

  it('finds saved queries whose parameters mean the entity, in nested folders', () => {
    const folder = {
      items: [
        { id: 'a', parameters: [{ meta: { entity: 'Customer' } }] },
        { id: 'b', parameters: [{ meta: { entity: 'Order' } }] },
        { id: 'c' },
      ],
      folders: [
        {
          items: [
            { id: 'd/e', parameters: [{ meta: { entity: 'customer' } }] },
          ],
        },
      ],
    };
    expect(queriesForEntity(folder, 'Customer').map((q) => q.id)).toEqual([
      'a',
      'd/e',
    ]);
    expect(queriesForEntity(folder, 'Customer', 1).map((q) => q.id)).toEqual([
      'a',
    ]);
    expect(queriesForEntity(undefined, 'Customer')).toEqual([]);
    expect(queriesForEntity(folder, '')).toEqual([]);
  });
});

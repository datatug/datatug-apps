import { describe, expect, it } from 'vitest';
import { ProjectCardBrief } from './card';
import { CardMatchRank, matchCards, matchRuleRank } from './card-match';

const card = (
  id: string,
  match: ProjectCardBrief['parameters'] extends (infer P)[] | undefined
    ? P extends { match?: infer M }
      ? M
      : never
    : never,
): ProjectCardBrief => ({
  id,
  title: id,
  parameters: [{ id: 'p', type: 'string', isRequired: true, match }],
});

describe('matchRuleRank', () => {
  const cell = {
    table: 'dbo.Orders',
    column: 'CustomerID',
    entity: { entity: 'Customer', field: 'CustomerID' },
  };

  it('matches entity.field case-insensitively', () => {
    expect(matchRuleRank({ entity: 'customer', field: 'customerid' }, cell)).toBe(
      CardMatchRank.EntityField,
    );
    expect(matchRuleRank({ entity: 'Order', field: 'CustomerID' }, cell)).toBeUndefined();
    expect(
      matchRuleRank({ entity: 'Customer', field: 'CustomerID' }, { column: 'CustomerID' }),
    ).toBeUndefined();
  });

  it('matches table and column, with or without schema', () => {
    expect(matchRuleRank({ table: 'Orders', column: 'CustomerID' }, cell)).toBe(
      CardMatchRank.TableColumn,
    );
    expect(matchRuleRank({ table: 'dbo.Orders', column: 'customerid' }, cell)).toBe(
      CardMatchRank.TableColumn,
    );
    expect(matchRuleRank({ table: 'sales.Orders', column: 'CustomerID' }, cell)).toBeUndefined();
    expect(
      matchRuleRank({ table: 'Orders', column: 'CustomerID' }, { column: 'CustomerID' }),
    ).toBeUndefined();
  });

  it('matches globs as patterns', () => {
    expect(matchRuleRank({ table: '*', column: 'Customer*Id' }, cell)).toBe(
      CardMatchRank.Pattern,
    );
    expect(matchRuleRank({ table: 'Ord?rs', column: 'CustomerID' }, cell)).toBe(
      CardMatchRank.Pattern,
    );
    expect(matchRuleRank({ table: '*', column: 'Cust.merID' }, cell)).toBeUndefined();
    expect(matchRuleRank({ table: '*.orders', column: 'CustomerID' }, cell)).toBe(
      CardMatchRank.Pattern,
    );
  });

  it('compares schema symmetrically and strips identifier quoting', () => {
    const bare = { table: 'Orders', column: 'CustomerID' };
    expect(matchRuleRank({ table: 'dbo.Orders', column: 'CustomerID' }, bare)).toBe(
      CardMatchRank.TableColumn,
    );
    expect(
      matchRuleRank({ table: '[dbo].[Orders]', column: 'CustomerID' }, cell),
    ).toBe(CardMatchRank.TableColumn);
    expect(
      matchRuleRank({ table: '"public"."orders"', column: 'CustomerID' }, cell),
    ).toBeUndefined();
  });

  it('ignores malformed rules', () => {
    const bad = [
      {},
      { table: 'Orders' },
      { entity: 'Customer' },
      { entity: 'Customer', field: 'CustomerID', column: 'CustomerID' },
      { column: 42 },
      { column: 'x'.repeat(200) },
      null,
    ] as unknown as Parameters<typeof matchRuleRank>[0][];
    for (const rule of bad) expect(matchRuleRank(rule, cell)).toBeUndefined();
  });

  it('matches column only', () => {
    expect(matchRuleRank({ column: 'CustomerID' }, { column: 'customerid' })).toBe(
      CardMatchRank.Column,
    );
    expect(matchRuleRank({ column: '*ID' }, { column: 'CustomerID' })).toBe(
      CardMatchRank.ColumnPattern,
    );
    expect(matchRuleRank({ column: 'OrderID' }, cell)).toBeUndefined();
  });
});

describe('matchCards', () => {
  it('ranks entity, table+column, pattern, column, column glob; drops optional and non-matches', () => {
    const cards = [
      card('e-column-glob', [{ column: '*ID' }]),
      card('d-column', [{ column: 'CustomerID' }]),
      card('c-pattern', [{ table: '*', column: 'Customer*' }]),
      card('b-table', [{ table: 'Orders', column: 'CustomerID' }]),
      card('a-entity', [{ entity: 'Customer', field: 'CustomerID' }]),
      card('f-none', [{ column: 'ProductID' }]),
      { id: 'g-noparams', title: 'g-noparams' },
      {
        id: 'h-optional',
        title: 'h-optional',
        parameters: [{ id: 'p', type: 'string', match: [{ column: 'CustomerID' }] }],
      },
      {
        id: 'i-malformed',
        title: 'i-malformed',
        parameters: [
          { id: 'p', type: 'string', isRequired: true, match: null },
        ] as unknown as ProjectCardBrief['parameters'],
      },
    ];
    const result = matchCards(cards, {
      table: 'Orders',
      column: 'CustomerID',
      entity: { entity: 'Customer', field: 'CustomerID' },
    });
    expect(result.map((m) => [m.card.id, m.rank, m.parameterId])).toEqual([
      ['a-entity', 1, 'p'],
      ['b-table', 2, 'p'],
      ['c-pattern', 3, 'p'],
      ['d-column', 4, 'p'],
      ['e-column-glob', 5, 'p'],
    ]);
  });

  it('uses the best rule of a card once', () => {
    const result = matchCards(
      [card('x', [{ column: 'CustomerID' }, { table: 'Orders', column: 'CustomerID' }])],
      { table: 'Orders', column: 'CustomerID' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(CardMatchRank.TableColumn);
  });
});

describe('matchRuleRank hardening', () => {
  const cell = { table: 'dbo.Orders', column: 'CustomerID', entity: { entity: 'customer', field: 'id' } };
  it('rejects rules mixing keys of two shapes', () => {
    for (const rule of [
      { entity: 'customer', field: 'id', table: 'Orders' },
      { entity: 'customer', field: 'id', column: 'CustomerID' },
      { table: 'Orders', column: 'CustomerID', field: 'id' },
      { table: 'Orders' },
      { entity: 'customer' },
      {},
    ])
      expect(matchRuleRank(rule as never, cell)).toBeUndefined();
    expect(matchRuleRank({ entity: 'customer', field: 'id' }, cell)).toBe(CardMatchRank.EntityField);
  });
  it('matches wildcards without backtracking blow-up and ignores case', () => {
    const evil = '*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b';
    const started = Date.now();
    expect(matchRuleRank({ column: evil }, { column: 'a'.repeat(400) })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(500);
    expect(matchRuleRank({ column: 'customer*' }, { column: 'CUSTOMERID' })).toBe(CardMatchRank.ColumnPattern);
    expect(matchRuleRank({ column: 'c?stomerid' }, { column: 'CustomerID' })).toBe(CardMatchRank.ColumnPattern);
    expect(matchRuleRank({ column: '*ID' }, { column: 'CustomerID' })).toBe(CardMatchRank.ColumnPattern);
    expect(matchRuleRank({ column: '*I' }, { column: 'CustomerID' })).toBeUndefined();
    expect(matchRuleRank({ column: '**' }, { column: '' })).toBe(CardMatchRank.ColumnPattern);
    expect(matchRuleRank({ column: 'x' }, { column: 'y'.repeat(2000) })).toBeUndefined();
  });
});

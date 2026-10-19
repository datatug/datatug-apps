import {
  groupedDifferenceAvailable,
  orderGroupedBars,
} from './grouped-bar-order';
import type { GroupedBars } from './grouped-bars';

function data(
  rows: readonly (readonly [string, number, number])[],
): GroupedBars {
  return {
    minimum: -Number.MAX_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
    groups: rows.map(([category, ...values], sourceRow) => ({
      category,
      sourceRow,
      values,
    })),
  };
}
const labels = (result: GroupedBars['groups']) =>
  result.map((group) => group.category);

describe('held grouped ordering', () => {
  it('orders exact labels, each series and signed first-minus-second independently without mutating rows', () => {
    const held = data([
      ['USA', 13, 13],
      ['Canada', 3, 8],
      ['Brazil', 9, 2],
      ['Austria', 2, 7],
    ]);
    const before = JSON.stringify(held);
    expect(labels(orderGroupedBars(held, 'country'))).toEqual([
      'Austria',
      'Brazil',
      'Canada',
      'USA',
    ]);
    expect(labels(orderGroupedBars(held, 'series:0'))).toEqual([
      'USA',
      'Brazil',
      'Canada',
      'Austria',
    ]);
    expect(labels(orderGroupedBars(held, 'series:1'))).toEqual([
      'USA',
      'Canada',
      'Austria',
      'Brazil',
    ]);
    expect(labels(orderGroupedBars(held, 'difference'))).toEqual([
      'Brazil',
      'USA',
      'Austria',
      'Canada',
    ]);
    expect(JSON.stringify(held)).toBe(before);
    expect(orderGroupedBars(held, 'country')[0]).toBe(held.groups[3]);
  });

  it('compares differences exactly beyond safe integer range, with exact-label and source-index ties', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const held = data([
      ['A', max, -1],
      ['Z', max, -2],
      ['C', -max, 2],
      ['D', -max, 1],
      ['Z', max - 1, -3],
    ]);
    expect(labels(orderGroupedBars(held, 'difference'))).toEqual([
      'Z',
      'Z',
      'A',
      'D',
      'C',
    ]);
    expect(
      orderGroupedBars(held, 'difference')
        .slice(0, 2)
        .map((group) => group.sourceRow),
    ).toEqual([1, 4]);
  });

  it('keeps fractional and tiny numeric series usable while refusing imprecise Difference', () => {
    const held = data([
      ['Z', 2.5, -1.25],
      ['A', -2.5, 0],
      ['B', 1e-300, 1e-301],
    ]);
    expect(groupedDifferenceAvailable(held)).toBe(false);
    expect(labels(orderGroupedBars(held, 'series:0'))).toEqual(['Z', 'B', 'A']);
    expect(labels(orderGroupedBars(held, 'country'))).toEqual(['A', 'B', 'Z']);
    expect(() => orderGroupedBars(held, 'difference')).toThrow(
      'requires two integer measures',
    );
  });

  it('rejects nonexistent series and excludes generic three-series Difference', () => {
    const held = data([['A', 1, 2]]);
    expect(() => orderGroupedBars(held, 'series:2')).toThrow();
    expect(() => orderGroupedBars(held, 'series:NaN' as 'series:0')).toThrow();
    expect(
      groupedDifferenceAvailable({
        ...held,
        groups: [{ ...held.groups[0], values: [1, 2, 3] }],
      }),
    ).toBe(false);
    expect(orderGroupedBars(data([]), 'country')).toEqual([]);
  });
});

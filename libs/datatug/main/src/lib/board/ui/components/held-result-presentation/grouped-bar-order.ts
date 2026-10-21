import type { GroupedBars } from './grouped-bars';

export type GroupedBarOrder = 'country' | 'difference' | `series:${number}`;

export function groupedDifferenceAvailable(data: GroupedBars): boolean {
  return data.groups.every(
    (group) =>
      group.values.length === 2 && group.values.every(Number.isSafeInteger),
  );
}

/** Exact label ordering is independent of locale, with source position as the final tie. */
function tie(
  left: GroupedBars['groups'][number],
  right: GroupedBars['groups'][number],
): number {
  return left.category < right.category
    ? -1
    : left.category > right.category
      ? 1
      : left.sourceRow - right.sourceRow;
}

/** Sort a projection only: original rows, category identity and the common scale are untouched. */
export function orderGroupedBars(
  data: GroupedBars,
  order: GroupedBarOrder,
): GroupedBars['groups'] {
  if (order === 'difference' && !groupedDifferenceAvailable(data))
    throw new Error(
      'Difference ordering requires two integer measures. Country and series ordering remain available.',
    );
  const index = /^series:(0|[1-9]\d*)$/.test(order)
    ? Number(order.slice(7))
    : undefined;
  if (
    order !== 'country' &&
    order !== 'difference' &&
    (index === undefined ||
      data.groups.some((group) => index >= group.values.length))
  )
    throw new Error('Choose a declared chart series to order these values.');
  return [...data.groups].sort((left, right) => {
    if (order === 'country') return tie(left, right);
    if (order === 'difference') {
      // Each operand is safe, but their signed difference need not fit a Number.
      const a = BigInt(left.values[0]) - BigInt(left.values[1]);
      const b = BigInt(right.values[0]) - BigInt(right.values[1]);
      return a > b ? -1 : a < b ? 1 : tie(left, right);
    }
    const a = left.values[index as number],
      b = right.values[index as number];
    return a > b ? -1 : a < b ? 1 : tie(left, right);
  });
}

import type { Result } from '@sneat/datatug-semantic';
import type { ChartSeries } from '@datatug/board-models';
export interface GroupedBars {
  readonly groups: readonly {
    category: string;
    sourceRow: number;
    values: readonly number[];
  }[];
  readonly maximum: number;
  readonly minimum: number;
}
/** Stage every row before exposing any bar; all series share this single zero-based scale. */
export function prepareGroupedBars(
  result: Pick<Result, 'recordset'>,
  category: string,
  series: readonly ChartSeries[],
): GroupedBars {
  const { columns, rows } = result.recordset;
  const names = columns.map((column) => column.name);
  const fail = (): never => {
    throw new Error(
      'Grouped bars require distinct categories and exact numeric measures in every row.',
    );
  };
  if (
    series.length < 2 ||
    series.length > 8 ||
    new Set(names).size !== names.length ||
    new Set(series.map((s) => s.id)).size !== series.length ||
    new Set(series.map((s) => s.valueColumn)).size !== series.length
  )
    fail();
  const categoryIndex = names.indexOf(category),
    indexes = series.map((item) => names.indexOf(item.valueColumn));
  if (
    categoryIndex < 0 ||
    columns[categoryIndex].type !== 'string' ||
    indexes.some(
      (index) =>
        index < 0 ||
        index === categoryIndex ||
        !['integer', 'number'].includes(columns[index].type),
    )
  )
    fail();
  const seen = new Set<string>();
  let maximum = 0,
    minimum = 0;
  const groups = rows.map((row, sourceRow) => {
    const key = row[categoryIndex];
    if (
      row.length !== columns.length ||
      key?.type !== 'string' ||
      !key.value.trim() ||
      seen.has(key.value)
    )
      return fail();
    seen.add(key.value);
    const values = indexes.map((index) => {
      const cell = row[index];
      if (!cell || cell.type !== columns[index].type) return fail();
      let value: number;
      if (cell.type === 'integer') {
        if (
          typeof cell.value !== 'number' &&
          (typeof cell.value !== 'string' ||
            !/^-?(0|[1-9]\d*)$/.test(cell.value))
        )
          return fail();
        value = Number(cell.value);
        if (!Number.isSafeInteger(value)) return fail();
      } else if (cell.type === 'number' && typeof cell.value === 'number') {
        value = cell.value;
        if (
          !Number.isFinite(value) ||
          Math.abs(value) > Number.MAX_SAFE_INTEGER
        )
          return fail();
      } else return fail();
      maximum = Math.max(maximum, value);
      minimum = Math.min(minimum, value);
      return value;
    });
    return { category: key.value, sourceRow, values };
  });
  return { groups, maximum, minimum };
}

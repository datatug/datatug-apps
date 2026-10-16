import type { TypedValue } from '../contract/types';
import { chartEvidenceError, deriveChartRecordset, type ChartLineage, type ChartRecordset } from './bar-race';

export interface OrdersMonthlyCountryCountSpec {
  readonly name: 'orders-monthly-country-count';
  readonly orderIdColumn: string;
  readonly dateColumn: string;
  readonly countryColumn: string;
}

export interface OrdersMonthlyCountryCount {
  readonly recordset: ChartRecordset;
  readonly lineage: readonly ChartLineage[];
  readonly orderCount: number;
  readonly months: number;
  readonly countries: number;
}

export type OrdersMonthlyCountryCountResult =
  | { readonly ok: true; readonly data: OrdersMonthlyCountryCount }
  | { readonly ok: false; readonly code: 'INCOMPLETE' | 'RIGHTS' | 'SHAPE' | 'ROW' | 'LIMIT'; readonly message: string };

const MAX_ORDERS = 1000;
const MAX_MONTHS = 240;
const MAX_COUNTRIES = 100;
const monthPattern = /^([0-9]{4})-(0[1-9]|1[0-2])$/;
const datePattern = /^([0-9]{4})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/;

function fail(code: Exclude<OrdersMonthlyCountryCountResult, { ok: true }>['code'], message: string): OrdersMonthlyCountryCountResult {
  return { ok: false, code, message };
}

function calendarMonth(value: TypedValue): string | undefined {
  if (value.type !== 'string') return undefined;
  const parts = datePattern.exec(value.value);
  if (!parts) return undefined;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1000) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${parts[1]}-${parts[2]}`;
}

function orderId(value: TypedValue): string | undefined {
  if (value.type === 'integer') return /^-?(0|[1-9][0-9]*)$/.test(value.value) ? value.value : undefined;
  if (value.type === 'number' && Number.isSafeInteger(value.value)) return String(value.value);
  return undefined;
}

function monthIndex(value: string): number {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
}

function monthLabel(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
}

/** Turn admitted raw order rows into a complete month × country result for grid and chart. */
export function transformOrdersMonthlyCountryCount(
  input: ChartRecordset,
  spec: OrdersMonthlyCountryCountSpec,
): OrdersMonthlyCountryCountResult {
  if (!input.complete || input.hasMore || input.truncated || input.limitations.some((item) => item.rowsFiltered))
    return fail('INCOMPLETE', 'The complete, unrestricted Orders result is required to count every order.');
  if (input.recordset.rows.length > MAX_ORDERS)
    return fail('LIMIT', `The Orders transform accepts at most ${MAX_ORDERS} rows.`);
  const evidenceError = chartEvidenceError(input);
  if (evidenceError) return fail('RIGHTS', evidenceError);
  if (spec.name !== 'orders-monthly-country-count') return fail('SHAPE', 'Unknown Orders transform.');
  if (!input.provenance.collection?.trim()) return fail('SHAPE', 'The Orders source collection must be identified.');
  const selectors = [spec.orderIdColumn, spec.dateColumn, spec.countryColumn];
  if (selectors.some((value) => !value?.trim()) || new Set(selectors).size !== selectors.length)
    return fail('SHAPE', 'Order ID, date and country must name distinct columns.');
  const columns = input.recordset.columns;
  const names = columns.map((column) => column.name);
  if (new Set(names).size !== names.length || selectors.some((name) => !names.includes(name)))
    return fail('SHAPE', 'The Orders result lacks unique required columns.');
  const indices = selectors.map((name) => names.indexOf(name));
  if (!['integer', 'number'].includes(columns[indices[0]].type) ||
    columns[indices[1]].type !== 'string' || columns[indices[2]].type !== 'string')
    return fail('SHAPE', 'Orders columns must declare numeric ID, ISO text date and text country.');

  const ids = new Set<string>();
  const countries = new Set<string>();
  const counts = new Map<string, Map<string, number>>();
  for (const [index, row] of input.recordset.rows.entries()) {
    if (row.length !== names.length) return fail('ROW', `Order row ${index + 1} has the wrong column count.`);
    const id = orderId(row[indices[0]]);
    const month = calendarMonth(row[indices[1]]);
    const countryValue = row[indices[2]];
    const country = countryValue.type === 'string' && countryValue.value.trim() === countryValue.value
      ? countryValue.value : undefined;
    if (!id || !month || !country) return fail('ROW', `Order row ${index + 1} has an invalid ID, ISO date or country.`);
    if (ids.has(id)) return fail('ROW', `Order row ${index + 1} repeats OrderID ${id}.`);
    ids.add(id);
    countries.add(country);
    if (countries.size > MAX_COUNTRIES) return fail('LIMIT', `The Orders transform accepts at most ${MAX_COUNTRIES} countries.`);
    const monthCounts = counts.get(month) ?? new Map<string, number>();
    monthCounts.set(country, (monthCounts.get(country) ?? 0) + 1);
    counts.set(month, monthCounts);
  }
  const observed = [...counts.keys()].sort();
  const first = observed[0];
  const last = observed[observed.length - 1];
  const months = first && last ? monthIndex(last) - monthIndex(first) + 1 : 0;
  const firstIndex = first ? monthIndex(first) : 0;
  if (months > MAX_MONTHS) return fail('LIMIT', `The Orders transform accepts at most ${MAX_MONTHS} months.`);
  const sortedCountries = [...countries].sort();
  const rows: TypedValue[][] = [];
  for (let offset = 0; offset < months; offset++) {
    const period = monthLabel(firstIndex + offset);
    if (!monthPattern.test(period)) return fail('ROW', 'An Orders date produced an invalid month.');
    for (const country of sortedCountries) {
      rows.push([
        { type: 'string', value: period },
        { type: 'string', value: country },
        { type: 'number', value: counts.get(period)?.get(country) ?? 0 },
      ]);
    }
  }
  const collection = input.provenance.collection;
  const lineage: ChartLineage[] = [
    { output: 'period', input: `${collection}.${spec.dateColumn}`, operation: 'calendar-month' },
    { output: 'category', input: `${collection}.${spec.countryColumn}`, operation: 'identity' },
    { output: 'value', input: `${collection}.${spec.orderIdColumn}`, operation: 'distinct-count' },
  ];
  const recordset = deriveChartRecordset(input, {
      columns: [
        { name: 'period', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'value', type: 'number' },
      ],
      rows,
    }, lineage);
  if (!recordset) return fail('RIGHTS', 'The raw API receipt must match its actual row count before charting.');
  return {
    ok: true,
    data: {
      recordset,
      orderCount: ids.size,
      months,
      countries: sortedCountries.length,
      lineage,
    },
  };
}

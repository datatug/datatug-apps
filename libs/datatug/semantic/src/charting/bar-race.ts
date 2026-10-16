import type { Result, TypedValue } from '../contract/types';

/** Presentation input from a DataTug result. It is never a durable board field. */
export type ChartRecordset = Pick<Result, 'recordset' | 'provenance'>;

export interface ChartSourceIdentity {
  readonly source: string;
  readonly collection?: string;
  readonly queryId?: string;
  readonly mode: Result['provenance']['mode'];
  readonly snapshotId?: string;
  readonly observedAt: string;
}

export interface ChartField {
  readonly column: string;
  /** Actual query-result column type, not a chart-side guess. */
  readonly type: string;
  readonly unit?: string;
}

export interface BarRaceSpec {
  readonly kind: 'bar-race';
  /** A sortable period key, preferably ISO year/month/date or datetime. */
  readonly periodColumn: string;
  readonly categoryColumn: string;
  readonly measureColumn: string;
  /** Display unit from a declared dataset/query meaning, never inferred. */
  readonly unit?: string;
  readonly mode: 'period' | 'cumulative';
  readonly topN: number;
}

export interface BarRaceEntry {
  readonly category: string;
  readonly value: number;
  readonly rank: number;
  /** Stable across every frame, including after a category leaves and re-enters top N. */
  readonly color: string;
}

export interface BarRaceFrame {
  readonly period: string;
  readonly entries: readonly BarRaceEntry[];
}

export interface BarRaceData {
  readonly source: ChartSourceIdentity;
  readonly spec: BarRaceSpec;
  readonly dimensions: readonly ChartField[];
  readonly measures: readonly ChartField[];
  readonly frames: readonly BarRaceFrame[];
}

export type ChartEligibilityErrorCode =
  | 'INVALID_SPEC'
  | 'MISSING_COLUMN'
  | 'DUPLICATE_COLUMN'
  | 'INVALID_ROW'
  | 'INCOMPATIBLE_VALUE';

export type BarRacePreparation =
  | { readonly ok: true; readonly data: BarRaceData }
  | { readonly ok: false; readonly code: ChartEligibilityErrorCode; readonly message: string };

const palette = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#be185d', '#4f46e5'] as const;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** FNV-1a over UTF-16 code units; independent of row order and locale. */
export function barRaceColor(category: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < category.length; i++) {
    hash ^= category.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return palette[(hash >>> 0) % palette.length];
}

function label(value: TypedValue): string | undefined {
  if (value.type === 'null') return undefined;
  if (value.type === 'string' || value.type === 'date' || value.type === 'datetime') {
    return value.value.trim() || undefined;
  }
  return undefined;
}

function measure(value: TypedValue): number | undefined {
  if (value.type === 'null') return 0;
  if (value.type === 'number') return Number.isFinite(value.value) ? value.value : undefined;
  if (value.type !== 'integer' && value.type !== 'decimal') return undefined;
  const converted = Number(value.value);
  if (!Number.isFinite(converted)) return undefined;
  if (value.type === 'integer' && !Number.isSafeInteger(converted)) return undefined;
  return converted;
}

function error(code: ChartEligibilityErrorCode, message: string): BarRacePreparation {
  return { ok: false, code, message };
}

/** Build deterministic frames without fetching data or mutating the source result. */
export function prepareBarRace(result: ChartRecordset, spec: BarRaceSpec): BarRacePreparation {
  if (spec.kind !== 'bar-race') return error('INVALID_SPEC', 'Chart kind must be bar-race.');
  if (!Number.isInteger(spec.topN) || spec.topN < 1 || spec.topN > 100)
    return error('INVALID_SPEC', 'Top N must be a whole number from 1 to 100.');
  if (![spec.periodColumn, spec.categoryColumn, spec.measureColumn].every((name) => name.trim()))
    return error('INVALID_SPEC', 'Period, category and measure columns must be named.');
  if (new Set([spec.periodColumn, spec.categoryColumn, spec.measureColumn]).size !== 3)
    return error('INVALID_SPEC', 'Period, category and measure must use different columns.');
  if (spec.mode !== 'period' && spec.mode !== 'cumulative')
    return error('INVALID_SPEC', 'Bar race mode must be period or cumulative.');
  const names = result.recordset.columns.map((column) => column.name);
  if (new Set(names).size !== names.length)
    return error('DUPLICATE_COLUMN', 'The result contains duplicate column names.');
  const periodIndex = names.indexOf(spec.periodColumn);
  const categoryIndex = names.indexOf(spec.categoryColumn);
  const measureIndex = names.indexOf(spec.measureColumn);
  const missing = [spec.periodColumn, spec.categoryColumn, spec.measureColumn].filter((name) => !names.includes(name));
  if (missing.length) return error('MISSING_COLUMN', `The result has no column: ${missing.join(', ')}.`);

  const byPeriod = new Map<string, Map<string, number>>();
  for (const [index, row] of result.recordset.rows.entries()) {
    if (row.length !== names.length)
      return error('INVALID_ROW', `Row ${index + 1} has ${row.length} values; expected ${names.length}.`);
    const periodValue = row[periodIndex];
    const categoryValue = row[categoryIndex];
    const period = label(periodValue);
    const category = label(categoryValue);
    // Missing dimension/category has no honest bucket. Missing measure is zero.
    if (periodValue.type !== 'null' && !period)
      return error('INCOMPATIBLE_VALUE', `Row ${index + 1} needs a text or date ${spec.periodColumn} value.`);
    if (categoryValue.type !== 'null' && !category)
      return error('INCOMPATIBLE_VALUE', `Row ${index + 1} needs a text or date ${spec.categoryColumn} value.`);
    if (!period || !category) continue;
    const value = measure(row[measureIndex]);
    if (value === undefined)
      return error('INCOMPATIBLE_VALUE', `Row ${index + 1} needs a finite numeric ${spec.measureColumn} value.`);
    const periodValues = byPeriod.get(period) ?? new Map<string, number>();
    const total = (periodValues.get(category) ?? 0) + value;
    if (!Number.isFinite(total))
      return error('INCOMPATIBLE_VALUE', `Aggregating ${spec.measureColumn} produced a non-finite value.`);
    periodValues.set(category, total);
    byPeriod.set(period, periodValues);
  }

  const cumulative = new Map<string, number>();
  const frames: BarRaceFrame[] = [];
  for (const period of [...byPeriod.keys()].sort(compare)) {
    const current = byPeriod.get(period) ?? new Map<string, number>();
    for (const [category, value] of current) {
      const total = spec.mode === 'cumulative' ? (cumulative.get(category) ?? 0) + value : 0;
      if (!Number.isFinite(total))
        return error('INCOMPATIBLE_VALUE', 'Cumulative chart measure exceeded the finite number range.');
      cumulative.set(category, total);
    }
    const values = spec.mode === 'cumulative' ? cumulative : new Map(
      [...cumulative.keys()].map((category) => [category, current.get(category) ?? 0] as const),
    );
    const entries = [...values].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
      .slice(0, spec.topN)
      .map(([category, value], index): BarRaceEntry => ({ category, value, rank: index + 1, color: barRaceColor(category) }));
    frames.push({ period, entries });
  }
  return {
    ok: true,
    data: {
      source: {
        source: result.provenance.source,
        collection: result.provenance.collection,
        queryId: result.provenance.queryId,
        mode: result.provenance.mode,
        snapshotId: result.provenance.snapshotId,
        observedAt: result.provenance.observedAt,
      },
      spec,
      dimensions: [
        { column: spec.periodColumn, type: result.recordset.columns[periodIndex].type },
        { column: spec.categoryColumn, type: result.recordset.columns[categoryIndex].type },
      ],
      measures: [{ column: spec.measureColumn, type: result.recordset.columns[measureIndex].type, unit: spec.unit }],
      frames,
    },
  };
}

import type { Result, TypedValue } from '../contract/types';
import { decodeSourceRightsEvidence, safeTermsUrl } from '../contract/source-rights';

export interface ChartLineage {
  readonly output: string;
  readonly input: string;
  readonly operation: 'calendar-month' | 'identity' | 'distinct-count';
}

/** Execution admission and page completeness are supplied by the dispatcher. */
interface ChartRecordsetBase extends Pick<Result,
  'recordset' | 'limitations' | 'bindingsApplied' | 'truncated' | 'sourceRights' | 'usedSourceIds'> {
  readonly complete: boolean;
  readonly hasMore: boolean;
  readonly lineage?: readonly ChartLineage[];
  /** Original admitted API row count when this recordset contains derived rows. */
  readonly sourceRowsReturned?: number;
}

export interface ServerChartRecordset extends ChartRecordsetBase {
  readonly runtime: 'server';
  readonly provenance: Result['provenance'];
  readonly execution?: Result['execution'];
  readonly publicApiReceipt?: never;
}

export interface PublicApiChartReceipt {
  readonly endpoint: string;
  readonly databaseId: string;
  /** Human-facing collection mapped by the admitted saved query. */
  readonly logicalCollection: string;
  /** Physical collection from the live execution.sources response. */
  readonly collectionId: string;
  readonly queryId: string;
  readonly rowsReturned: number;
  readonly observedAt: string;
  readonly executionSources: readonly { readonly database: string; readonly collection: string }[];
  /** Supplied only after the runtime fetches and hashes a publisher-owned artifact. */
  readonly rightsPublication?: {
    readonly url: string;
    readonly sha256: string;
    readonly sourceId: string;
    readonly providerSourceSha256: string;
  };
}

export interface BrowserPublicApiChartRecordset extends ChartRecordsetBase {
  readonly runtime: 'browser-public-api';
  readonly provenance: {
    readonly source: string;
    readonly collection: string;
    readonly queryId: string;
    readonly mode: 'live';
    readonly observedAt: string;
    readonly endpoint: string;
    readonly databaseId: string;
    readonly executionProfile?: never;
  };
  readonly execution?: never;
  readonly publicApiReceipt: PublicApiChartReceipt;
}

/** Presentation input; neither arm belongs in durable board JSON. */
export type ChartRecordset = ServerChartRecordset | BrowserPublicApiChartRecordset;

export interface ChartField {
  readonly column: string;
  /** Actual query-result column type, not a chart-side guess. */
  readonly type: string;
  readonly unit?: string;
}

export interface BarRaceSpec {
  readonly kind: 'bar-race';
  /** Canonical YYYY-MM string only. Typed dates need an explicit grain before gap filling. */
  readonly periodColumn: string;
  readonly categoryColumn: string;
  /** Safe integer number/integer values only. Decimal/fractional/null values reject. */
  readonly measureColumn: string;
  /** Display unit from a declared dataset/query meaning, never inferred. */
  readonly unit?: string;
  /** Duplicate period/category rows are never combined implicitly. */
  readonly onDuplicate: 'sum' | 'reject';
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

interface BarRaceDataBase {
  readonly limitations: Result['limitations'];
  readonly bindingsApplied: Result['bindingsApplied'];
  readonly truncated: Result['truncated'];
  readonly sourceRights: Result['sourceRights'];
  readonly usedSourceIds: Result['usedSourceIds'];
  readonly complete: boolean;
  readonly hasMore: boolean;
  readonly lineage?: readonly ChartLineage[];
  readonly sourceRowsReturned?: number;
  readonly spec: BarRaceSpec;
  readonly dimensions: readonly ChartField[];
  readonly measures: readonly ChartField[];
  readonly frames: readonly BarRaceFrame[];
}

export type BarRaceData = BarRaceDataBase & (
  | Pick<ServerChartRecordset, 'runtime' | 'execution'> & { readonly source: ServerChartRecordset['provenance']; readonly publicApiReceipt?: never }
  | Pick<BrowserPublicApiChartRecordset, 'runtime' | 'publicApiReceipt'> & { readonly source: BrowserPublicApiChartRecordset['provenance']; readonly execution?: never }
);

export type ChartEligibilityErrorCode =
  | 'INVALID_SPEC'
  | 'INCOMPLETE'
  | 'SOURCE_RIGHTS_UNAVAILABLE'
  | 'MISSING_COLUMN'
  | 'DUPLICATE_COLUMN'
  | 'DUPLICATE_CATEGORY_PERIOD'
  | 'INVALID_ROW'
  | 'INCOMPATIBLE_VALUE'
  | 'NULL_VALUE'
  | 'UNSUPPORTED_PERIOD'
  | 'PRECISION_UNSUPPORTED';

export type BarRacePreparation =
  | { readonly ok: true; readonly data: BarRaceData }
  | { readonly ok: false; readonly code: ChartEligibilityErrorCode; readonly message: string };

const palette = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#be185d', '#4f46e5'] as const;
const MAX_FRAMES = 240;
const derivedRecordsets = new WeakSet<object>();

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

function categoryLabel(value: TypedValue): string | undefined {
  return value.type === 'string' && value.value.trim() ? value.value : undefined;
}

function measure(value: TypedValue): number | undefined {
  if (value.type === 'number') return Number.isSafeInteger(value.value) ? value.value : undefined;
  if (value.type !== 'integer') return undefined;
  const converted = Number(value.value);
  return Number.isSafeInteger(converted) ? converted : undefined;
}

/** Canonical monthly keys sort chronologically with code-point order. No locale parsing. */
function periodKey(value: TypedValue): string | undefined {
  return value.type === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.value)
    ? value.value : undefined;
}

function error(code: ChartEligibilityErrorCode, message: string): BarRacePreparation {
  return { ok: false, code, message };
}

/** Presentation consistency only. The dispatcher must authenticate the API and rights artifact first. */
export function chartEvidenceError(result: ChartRecordset): string | undefined {
  if (result.sourceRowsReturned !== undefined && !derivedRecordsets.has(result))
    return 'An original API row count may only be attached by an admitted chart transform.';
  let rights;
  try {
    rights = decodeSourceRightsEvidence(result as unknown as Record<string, unknown>);
  } catch {
    return 'Chart source-rights evidence is malformed.';
  }
  if (!rights.usedSourceIds?.length || !rights.sourceRights?.length ||
    rights.usedSourceIds.some((id) => !rights.sourceRights?.some((right) => right.sourceId === id && right.evidenceOrigin !== 'legacy-metadata')))
    return 'Current publisher or server source-rights evidence is required for every used chart source.';
  if (result.runtime !== 'browser-public-api') return undefined;
  const receipt = result.publicApiReceipt;
  let host: string;
  try {
    safeTermsUrl(receipt.endpoint);
    host = new URL(receipt.endpoint).hostname;
  } catch {
    return 'The public API endpoint is not an admitted HTTPS URL.';
  }
  if (receipt.endpoint !== result.provenance.endpoint ||
    receipt.databaseId !== result.provenance.databaseId ||
    receipt.databaseId !== result.provenance.source ||
    receipt.logicalCollection !== result.provenance.collection ||
    receipt.queryId !== result.provenance.queryId ||
    receipt.observedAt !== result.provenance.observedAt ||
    receipt.rowsReturned !== (result.sourceRowsReturned ?? result.recordset.rows.length) ||
    receipt.executionSources.length !== 1 ||
    receipt.executionSources[0].database !== receipt.databaseId ||
    receipt.executionSources[0].collection !== receipt.collectionId)
    return 'The public API receipt does not match the observed query, rows or physical source.';
  const publication = receipt.rightsPublication;
  if (!publication || !/^[a-f0-9]{64}$/.test(publication.sha256) ||
    !/^[a-f0-9]{64}$/.test(publication.providerSourceSha256))
    return 'A verified publisher rights artifact is required for this public API source.';
  try {
    safeTermsUrl(publication.url);
  } catch {
    return 'The publisher rights artifact must have an HTTPS URL.';
  }
  if (rights.usedSourceIds.length !== 1 || rights.usedSourceIds[0] !== publication.sourceId ||
    !rights.sourceRights.some((right) =>
      right.sourceId === publication.sourceId && right.evidenceOrigin === 'publisher-verified' &&
      right.source.serverId === host && right.source.databaseId === receipt.databaseId &&
      right.source.recordset === receipt.collectionId &&
      right.pins.some((pin) => pin.role === 'provider' && pin.sha256 === publication.providerSourceSha256)))
    return 'The publisher rights artifact does not bind this physical public API source.';
  return undefined;
}

/** Preserve the admitted raw receipt while replacing rows in a reviewed presentation transform. */
export function deriveChartRecordset(
  input: ChartRecordset,
  recordset: ChartRecordset['recordset'],
  lineage: readonly ChartLineage[],
): ChartRecordset | undefined {
  if (input.sourceRowsReturned !== undefined || chartEvidenceError(input)) return undefined;
  const derived: ChartRecordset = {
    ...input,
    sourceRowsReturned: input.recordset.rows.length,
    lineage,
    recordset,
  };
  derivedRecordsets.add(derived);
  return derived;
}

/** Include every calendar month between the observed endpoints, with a fixed work bound. */
function calendarMonths(first: string, last: string): string[] | undefined {
  const start = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1;
  const end = Number(last.slice(0, 4)) * 12 + Number(last.slice(5, 7)) - 1;
  if (end - start + 1 > MAX_FRAMES) return undefined;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const month = start + index;
    return `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}`;
  });
}

/** Build deterministic frames without fetching data or mutating the source result. */
export function prepareBarRace(result: ChartRecordset, spec: BarRaceSpec): BarRacePreparation {
  if (!result.complete || result.hasMore || result.truncated || result.limitations.some((item) => item.rowsFiltered))
    return error('INCOMPLETE', 'A complete, unrestricted result is required for a bar race.');
  const evidenceError = chartEvidenceError(result);
  if (evidenceError) return error('SOURCE_RIGHTS_UNAVAILABLE', evidenceError);
  if (spec.kind !== 'bar-race') return error('INVALID_SPEC', 'Chart kind must be bar-race.');
  if (!Number.isInteger(spec.topN) || spec.topN < 1 || spec.topN > 100)
    return error('INVALID_SPEC', 'Top N must be a whole number from 1 to 100.');
  if (![spec.periodColumn, spec.categoryColumn, spec.measureColumn].every((name) => name.trim()))
    return error('INVALID_SPEC', 'Period, category and measure columns must be named.');
  if (new Set([spec.periodColumn, spec.categoryColumn, spec.measureColumn]).size !== 3)
    return error('INVALID_SPEC', 'Period, category and measure must use different columns.');
  if (spec.mode !== 'period' && spec.mode !== 'cumulative')
    return error('INVALID_SPEC', 'Bar race mode must be period or cumulative.');
  if (spec.onDuplicate !== 'sum' && spec.onDuplicate !== 'reject')
    return error('INVALID_SPEC', 'Choose sum or reject for duplicate period/category rows.');
  const names = result.recordset.columns.map((column) => column.name);
  if (new Set(names).size !== names.length)
    return error('DUPLICATE_COLUMN', 'The result contains duplicate column names.');
  const periodIndex = names.indexOf(spec.periodColumn);
  const categoryIndex = names.indexOf(spec.categoryColumn);
  const measureIndex = names.indexOf(spec.measureColumn);
  const missing = [spec.periodColumn, spec.categoryColumn, spec.measureColumn].filter((name) => !names.includes(name));
  if (missing.length) return error('MISSING_COLUMN', `The result has no column: ${missing.join(', ')}.`);
  const columns = result.recordset.columns;
  if (columns[periodIndex].type !== 'string')
    return error('UNSUPPORTED_PERIOD', `Column ${spec.periodColumn} must declare YYYY-MM string periods.`);
  if (columns[categoryIndex].type !== 'string' || !['number', 'integer'].includes(columns[measureIndex].type))
    return error('INCOMPATIBLE_VALUE', 'Category must declare string and measure must declare number or integer.');

  const byPeriod = new Map<string, Map<string, number>>();
  for (const [index, row] of result.recordset.rows.entries()) {
    if (row.length !== names.length)
      return error('INVALID_ROW', `Row ${index + 1} has ${row.length} values; expected ${names.length}.`);
    const periodValue = row[periodIndex];
    const categoryValue = row[categoryIndex];
    const measureValue = row[measureIndex];
    if ([periodValue, categoryValue, measureValue].some((value) => value.type === 'null'))
      return error('NULL_VALUE', `Row ${index + 1} has a null period, category or measure; choose an explicit missing-value policy before charting.`);
    const period = periodKey(periodValue);
    if (!period)
      return error('UNSUPPORTED_PERIOD', `Row ${index + 1} needs a YYYY-MM string period.`);
    const category = categoryLabel(categoryValue);
    if (!category)
      return error('INCOMPATIBLE_VALUE', `Row ${index + 1} needs a nonempty text ${spec.categoryColumn} value.`);
    if (measureValue.type === 'decimal' || (measureValue.type === 'number' && !Number.isSafeInteger(measureValue.value)) ||
      (measureValue.type === 'integer' && measure(measureValue) === undefined))
      return error('PRECISION_UNSUPPORTED', `Row ${index + 1} needs a safe integer ${spec.measureColumn}; decimal or fractional aggregation requires an explicit precision policy.`);
    const value = measure(measureValue);
    if (value === undefined)
      return error('INCOMPATIBLE_VALUE', `Row ${index + 1} needs a numeric ${spec.measureColumn} value.`);
    const periodValues = byPeriod.get(period) ?? new Map<string, number>();
    if (spec.onDuplicate === 'reject' && periodValues.has(category))
      return error('DUPLICATE_CATEGORY_PERIOD', `Row ${index + 1} repeats ${category} in ${period}.`);
    const total = (periodValues.get(category) ?? 0) + value;
    if (!Number.isSafeInteger(total))
      return error('PRECISION_UNSUPPORTED', `Aggregating ${spec.measureColumn} exceeded the safe integer range.`);
    periodValues.set(category, total);
    byPeriod.set(period, periodValues);
  }

  const cumulative = new Map<string, number>();
  const frames: BarRaceFrame[] = [];
  const observedPeriods = [...byPeriod.keys()].sort(compare);
  const periods = observedPeriods.length
    ? calendarMonths(observedPeriods[0], observedPeriods[observedPeriods.length - 1])
    : [];
  if (!periods)
    return error('UNSUPPORTED_PERIOD', `The chart exceeds ${MAX_FRAMES} frames; choose a shorter range.`);
  for (const period of periods) {
    const current = byPeriod.get(period) ?? new Map<string, number>();
    for (const [category, value] of current) {
      const total = spec.mode === 'cumulative' ? (cumulative.get(category) ?? 0) + value : 0;
      if (!Number.isSafeInteger(total))
        return error('PRECISION_UNSUPPORTED', 'Cumulative chart measure exceeded the safe integer range.');
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
  const shared: BarRaceDataBase = {
    limitations: result.limitations,
    bindingsApplied: result.bindingsApplied,
    truncated: result.truncated,
    sourceRights: result.sourceRights,
    usedSourceIds: result.usedSourceIds,
    complete: result.complete,
    hasMore: result.hasMore,
    lineage: result.lineage,
    sourceRowsReturned: result.sourceRowsReturned,
    spec,
    dimensions: [
      { column: spec.periodColumn, type: result.recordset.columns[periodIndex].type },
      { column: spec.categoryColumn, type: result.recordset.columns[categoryIndex].type },
    ],
    measures: [{ column: spec.measureColumn, type: result.recordset.columns[measureIndex].type, unit: spec.unit }],
    frames,
  };
  return result.runtime === 'server'
    ? { ok: true, data: { ...shared, runtime: 'server', source: result.provenance, execution: result.execution } }
    : { ok: true, data: { ...shared, runtime: 'browser-public-api', source: result.provenance, publicApiReceipt: result.publicApiReceipt } };
}

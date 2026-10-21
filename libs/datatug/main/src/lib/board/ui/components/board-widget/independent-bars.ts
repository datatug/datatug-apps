import { queryResultChartOptions } from '../../../../queries/query/page/query-result-chart';
import {
  decodeSourceRightsEvidence,
  chartEvidenceError,
} from '@sneat/datatug-semantic';
import type { IQueryDef } from '../../../../models/definition/query-def';
import type { BarChartSpec } from '@datatug/board-models';
import type { BoardResultSnapshot } from './board-widget.component';

export interface IndependentSourceState {
  readonly loading: boolean;
  readonly error?: string;
  readonly snapshot?: BoardResultSnapshot;
  readonly admission?: IndependentSourceAdmission;
}
export interface IndependentBarSource {
  readonly id: string;
  readonly state: IndependentSourceState;
}
export interface IndependentBars {
  readonly sources: readonly string[];
  readonly minimum: number;
  readonly maximum: number;
  readonly groups: readonly {
    readonly category: string;
    readonly observations: readonly ({
      readonly value: number;
      readonly sourceRow: number;
    } | null)[];
  }[];
}

export interface IndependentSourceAdmission {
  readonly snapshot: BoardResultSnapshot;
  readonly basis:
    | 'ordinary-direct'
    | 'stream-eof'
    | 'profiled-server'
    | 'browser-evidence';
}
const admissions = new WeakSet<IndependentSourceAdmission>();
/** Called by a current widget controller after its usual fresh definition/membership checks. No provider field is added. */
export function admitIndependentSource(
  snapshot: BoardResultSnapshot,
  definition: IQueryDef,
  publicDirect: boolean,
): IndependentSourceAdmission {
  const result = snapshot.result;
  decodeSourceRightsEvidence(result as unknown as Record<string, unknown>);
  if (
    definition.id !== snapshot.queryId &&
    !snapshot.queryId.endsWith('/' + definition.id)
  )
    throw new Error(
      'The source query identity differs from its saved definition.',
    );
  let basis: IndependentSourceAdmission['basis'];
  if (
    'runtime' in result &&
    (result.runtime === 'browser-public-api' ||
      result.runtime === 'browser-sqlite')
  ) {
    if (
      !result.complete ||
      result.hasMore ||
      result.truncated ||
      chartEvidenceError(result)
    )
      throw new Error(
        'The source needs complete admitted data and current source evidence.',
      );
    basis = 'browser-evidence';
  } else if ('runtime' in result && result.runtime === 'server') {
    if (
      !result.complete ||
      result.hasMore ||
      result.truncated ||
      !result.provenance.executionProfile
    )
      throw new Error(
        'The server source needs a complete admitted execution profile.',
      );
    basis = 'profiled-server';
  } else if ('nativeStream' in result && result.nativeStream) {
    const read = result.nativeStreamRead,
      tables = definition.federation?.tables;
    const base = definition.federation?.ovdbBaseUrl?.replace(/\/$/, '');
    if (
      !publicDirect ||
      !read ||
      !read.terminalComplete ||
      tables?.length !== 1 ||
      !base ||
      read.endpoint !==
        `${base}/v1/databases/${encodeURIComponent(tables[0].database || '')}/dtql` ||
      read.queryId !== definition.id ||
      result.provenance.queryId !== definition.id ||
      result.provenance.source !==
        `${base}/v1/databases/${tables[0].database || ''} (direct OVDB)` ||
      result.execution ||
      result.hasMore ||
      result.truncated ||
      read.observedRows !== result.totalRows ||
      result.totalRows !== result.recordset.rows.length ||
      read.plannedSources.length !== 1 ||
      read.plannedSources[0].database !== tables[0].database ||
      read.plannedSources[0].collection !== tables[0].name ||
      (read.providerRows !== undefined &&
        read.providerRows !== result.totalRows) ||
      (read.providerSources !== undefined &&
        (read.providerSources.length !== 1 ||
          read.providerSources[0].database !== tables[0].database ||
          read.providerSources[0].collection !== tables[0].name))
    )
      throw new Error(
        'The public stream needs its terminal read, full rows and exact selected source plan.',
      );
    basis = 'stream-eof';
  } else if ('nativeDirect' in result && result.nativeDirect) {
    const tables = definition.federation?.tables;
    if (
      !publicDirect ||
      !result.ordinaryComplete ||
      result.hasMore ||
      result.truncated ||
      result.execution ||
      result.totalRows !== result.recordset.rows.length ||
      tables?.length !== 1 ||
      result.ordinarySources?.length !== 1 ||
      result.ordinarySources[0].database !== tables[0].database ||
      result.ordinarySources[0].collection !== tables[0].name
    )
      throw new Error(
        'The ordinary public source needs complete rows and its exact declared physical source.',
      );
    const base = definition.federation?.ovdbBaseUrl?.replace(/\/$/, '');
    const expected = `${base}/v1/databases/${tables[0].database || ''} (direct OVDB)`;
    if (
      !base ||
      result.provenance.source !== expected ||
      result.provenance.queryId !== definition.id
    )
      throw new Error(
        'The ordinary source endpoint or query does not match its saved definition.',
      );
    basis = 'ordinary-direct';
  } else
    throw new Error(
      'The source is not admitted for independent chart comparison.',
    );
  const eligibility = queryResultChartOptions(
    result,
    result.recordset,
    'totalRows' in result ? result.totalRows : result.recordset.rows.length,
  );
  if (eligibility.reason) throw new Error(eligibility.reason);
  const admission = { snapshot, basis };
  admissions.add(admission);
  return admission;
}

/** Presentation only: original per-source recordsets and receipts never become a fictitious joined Result. */
export function prepareIndependentBars(
  chart: BarChartSpec,
  sources: readonly IndependentBarSource[],
): IndependentBars {
  if (
    !chart.unit?.trim() ||
    sources.length < 1 ||
    sources.length > 2 ||
    new Set(sources.map((s) => s.id)).size !== sources.length
  )
    throw new Error(
      'Compare one or two independent sources with an explicitly declared common unit.',
    );
  const categories = new Set<string>();
  let minimum = 0,
    maximum = 0;
  const maps = sources.map(({ state }) => {
    if (state.loading || state.error || !state.snapshot)
      throw new Error(
        'Every source needs a successful complete result before comparison.',
      );
    const result = state.snapshot.result;
    if (
      !state.admission ||
      !admissions.has(state.admission) ||
      state.admission.snapshot !== state.snapshot
    )
      throw new Error(
        'The current source result has not been admitted for comparison.',
      );
    const { columns, rows } = result.recordset;
    const names = columns.map((column) => column.name);
    const category = names.indexOf(chart.categoryColumn),
      value = names.indexOf(chart.valueColumn);
    if (
      new Set(names).size !== names.length ||
      category < 0 ||
      value < 0 ||
      category === value ||
      columns[category].type !== 'string' ||
      !['integer', 'number'].includes(columns[value].type)
    )
      throw new Error(
        'Every source needs the declared distinct category and numeric measure columns.',
      );
    const map = new Map<string, { value: number; sourceRow: number }>();
    rows.forEach((row, sourceRow) => {
      const label = row[category],
        measure = row[value];
      if (
        row.length !== columns.length ||
        label?.type !== 'string' ||
        !label.value.trim() ||
        map.has(label.value) ||
        !measure ||
        measure.type !== columns[value].type
      )
        throw new Error(
          'Independent sources need unique nonempty exact categories and valid numeric rows.',
        );
      if (
        (measure.type === 'integer' &&
          typeof measure.value !== 'number' &&
          (typeof measure.value !== 'string' ||
            !/^-?(0|[1-9]\d*)$/.test(measure.value))) ||
        (measure.type === 'number' && typeof measure.value !== 'number')
      )
        throw new Error(
          'The source measure cannot be represented exactly for this chart.',
        );
      const number = Number(measure.value);
      if (
        !Number.isFinite(number) ||
        Math.abs(number) > Number.MAX_SAFE_INTEGER ||
        (measure.type === 'integer' && !Number.isSafeInteger(number))
      )
        throw new Error(
          'The source measure exceeds the supported numeric precision.',
        );
      map.set(label.value, { value: number, sourceRow });
      categories.add(label.value);
      minimum = Math.min(minimum, number);
      maximum = Math.max(maximum, number);
    });
    return map;
  });
  return {
    sources: sources.map((source) => source.id),
    minimum,
    maximum,
    groups: [...categories]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((category) => ({
        category,
        observations: maps.map((map) => map.get(category) ?? null),
      })),
  };
}

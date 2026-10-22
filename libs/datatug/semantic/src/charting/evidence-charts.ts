import { trimCoreSpace } from '../contract/core-whitespace';
import { verifyRowEvidence } from './evidence-integrity';
import { decodeResult } from '../contract/decoders';
import type { Result, TypedValue, ExecutionRef } from '../contract/types';
import {
  evidenceKey,
  evidenceObject,
  evidenceText,
  sameExecution,
} from './row-evidence';
import type {
  EvidenceScope,
  EvidenceSource,
  RowEvidenceSelector,
} from './row-evidence';

export interface TimelineChartSpec {
  readonly timeMode?: 'absolute' | 'elapsed';
  readonly anchorColumn?: string;
  readonly laneColumn: string;
  readonly eventColumn: string;
  readonly sequenceColumn: string;
  readonly timeColumn: string;
  readonly clockDomainColumn: string;
  readonly precisionColumn: string;
  readonly statusColumn: string;
  readonly evidenceRefColumn: string;
}
export interface HeatmapChartSpec {
  readonly rowColumn: string;
  readonly columnColumn: string;
  readonly statusColumn: string;
  readonly evidenceRefColumn: string;
}
export interface TimingChartSpec {
  readonly rowKeyColumn: string;
  readonly labelColumn: string;
  readonly startTimeColumn: string;
  readonly endTimeColumn: string;
  readonly startClockDomainColumn: string;
  readonly endClockDomainColumn: string;
  readonly startPrecisionColumn: string;
  readonly endPrecisionColumn: string;
  readonly startEvidenceRefColumn: string;
  readonly endEvidenceRefColumn: string;
  readonly startIdentityColumn: string;
  readonly endIdentityColumn: string;
}
export type EvidenceChartSpec =
  | {
      readonly type: 'timeline';
      readonly selectionId: string;
      readonly timeline: TimelineChartSpec;
    }
  | {
      readonly type: 'heatmap';
      readonly selectionId: string;
      readonly heatmap: HeatmapChartSpec;
    }
  | {
      readonly type: 'timing-bars';
      readonly selectionId: string;
      readonly timing: TimingChartSpec;
    };
export interface HeldEvidenceIdentity {
  /** Expected held context, never a grant of authorization. */
  readonly execution?: ExecutionRef;
  readonly scope: EvidenceScope;
  readonly source: EvidenceSource;
  readonly complete: boolean;
  readonly hasMore: boolean;
}
export interface EvidenceInspection {
  readonly selector: RowEvidenceSelector;
  readonly observationId?: string;
}
export interface EvidenceChartRow {
  readonly index: number;
  readonly label: string;
  readonly group: string;
  readonly status: string;
  readonly time?: number;
  readonly elapsedMs?: number;
  readonly anchorIdentity?: string;
  readonly sequence?: number;
  readonly durationMs?: number;
  readonly start?: string;
  readonly end?: string;
  readonly precisionMs?: number;
  readonly unavailable?: string;
  readonly inspections: readonly EvidenceInspection[];
  readonly values: readonly TypedValue[];
}
export interface PreparedEvidenceChart {
  readonly kind: EvidenceChartSpec['type'];
  readonly timeMode?: 'absolute' | 'elapsed';
  readonly selectionId: string;
  readonly columns: Result['recordset']['columns'];
  readonly rows: readonly EvidenceChartRow[];
  readonly provenance: Result['provenance'];
  readonly limitations: Result['limitations'];
  readonly source: EvidenceSource;
  readonly scope: EvidenceScope;
}
const timelineFields = [
  'laneColumn',
  'eventColumn',
  'sequenceColumn',
  'timeColumn',
  'clockDomainColumn',
  'precisionColumn',
  'statusColumn',
  'evidenceRefColumn',
] as const;
const heatmapFields = [
  'rowColumn',
  'columnColumn',
  'statusColumn',
  'evidenceRefColumn',
] as const;
const timingFields = [
  'rowKeyColumn',
  'labelColumn',
  'startTimeColumn',
  'endTimeColumn',
  'startClockDomainColumn',
  'endClockDomainColumn',
  'startPrecisionColumn',
  'endPrecisionColumn',
  'startEvidenceRefColumn',
  'endEvidenceRefColumn',
  'startIdentityColumn',
  'endIdentityColumn',
] as const;
export function decodeEvidenceChartSpec(value: unknown): EvidenceChartSpec {
  const o = evidenceObject(value, [
    'type',
    'selectionId',
    'timeline',
    'heatmap',
    'timing',
  ]);
  const type = o['type'];
  const selectionId = evidenceText(o['selectionId']);
  const arm =
    type === 'timeline'
      ? 'timeline'
      : type === 'heatmap'
        ? 'heatmap'
        : type === 'timing-bars'
          ? 'timing'
          : '';
  if (
    !arm ||
    ['timeline', 'heatmap', 'timing'].some(
      (k) => k !== arm && o[k] !== undefined,
    )
  )
    throw new Error('Mixed or unsupported evidence chart');
  const fields =
    type === 'timeline'
      ? timelineFields
      : type === 'heatmap'
        ? heatmapFields
        : timingFields;
  const map = evidenceObject(
    o[arm],
    type === 'timeline' ? [...fields, 'timeMode', 'anchorColumn'] : fields,
  );
  if (type === 'timeline') {
    if (
      'timeMode' in map &&
      map['timeMode'] !== 'absolute' &&
      map['timeMode'] !== 'elapsed'
    )
      throw new Error('Unsupported timeline timeMode');
    if (map['timeMode'] === 'elapsed') {
      evidenceText(map['anchorColumn']);
    } else if ('anchorColumn' in map)
      throw new Error('anchorColumn requires elapsed timeMode');
  }
  const seen = new Set<string>();
  for (const field of [
    ...fields,
    ...(type === 'timeline' && map['timeMode'] === 'elapsed'
      ? ['anchorColumn']
      : []),
  ]) {
    const column = evidenceText(map[field]);
    if (
      (field === 'endClockDomainColumn' &&
        column === map['startClockDomainColumn']) ||
      (field === 'endPrecisionColumn' && column === map['startPrecisionColumn'])
    )
      continue;
    if (seen.has(column)) throw new Error('Chart column roles must differ');
    seen.add(column);
  }
  return structuredClone({
    type,
    selectionId,
    [arm]: map,
  }) as EvidenceChartSpec;
}
function scalar(v: TypedValue): string {
  if (v.type === 'null') return '';
  return String(v.value);
}
function integer(v: TypedValue): number | undefined {
  if (v.type !== 'integer' && v.type !== 'number') return undefined;
  const n = Number(v.value);
  return Number.isSafeInteger(n) ? n : undefined;
}
/** Millisecond arithmetic refuses sub-millisecond or out-of-range endpoints. */
function instant(v: TypedValue): number | undefined {
  if (v.type === 'null') return undefined;
  if (v.type !== 'datetime' && v.type !== 'string')
    throw new Error('Observed endpoint must be an RFC3339 timestamp');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.value))
    return undefined;
  const n = Date.parse(v.value);
  if (
    !Number.isSafeInteger(n) ||
    new Date(n).toISOString().slice(0, 19) !== v.value.slice(0, 19)
  )
    return undefined;
  return n;
}

/** Strict millisecond RFC3339 parsing for elapsed arithmetic, including explicit offsets. */
function elapsedInstant(value: TypedValue): number | undefined {
  if (value.type === 'null') return undefined;
  if (value.type !== 'string' && value.type !== 'datetime') return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value.value,
    );
  if (!match || match[8] === '-00:00') return undefined;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const local = new Date(0);
  local.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  local.setUTCHours(
    parts[3],
    parts[4],
    parts[5],
    Number((fraction ?? '').padEnd(3, '0')),
  );
  if (
    [
      local.getUTCFullYear(),
      local.getUTCMonth() + 1,
      local.getUTCDate(),
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
    ].some((part, index) => part !== parts[index])
  )
    return undefined;
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3)),
    offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4));
  if (offsetHour > 23 || offsetMinute > 59) return undefined;
  const offset =
    (offsetHour * 60 + offsetMinute) * (zone.startsWith('-') ? -1 : 1);
  const point = local.getTime() - offset * 60_000;
  return Number.isSafeInteger(point) ? point : undefined;
}

/** Await before publishing; consumers must fence scope/revocation changes across the await.
 * No execution, persistence or authority: prepare only the supplied exact held data. */
export async function prepareEvidenceChart(
  rawSpec: unknown,
  rawResult: Result,
  identity: HeldEvidenceIdentity,
): Promise<PreparedEvidenceChart> {
  const expectedIdentity = structuredClone(identity);
  const spec = decodeEvidenceChartSpec(rawSpec);
  const result = decodeResult(rawResult);
  if (
    !expectedIdentity.complete ||
    expectedIdentity.hasMore ||
    result.truncated
  )
    throw new Error('A complete held result is required');
  if (
    expectedIdentity.execution &&
    (!result.execution ||
      !sameExecution(expectedIdentity.execution, result.execution))
  )
    throw new Error('Held execution context mismatch');
  const names = result.recordset.columns.map((c) => c.name);
  if (
    new Set(names).size !== names.length ||
    result.recordset.rows.some((r) => r.length !== names.length)
  )
    throw new Error('Ambiguous or incomplete held recordset');
  const mapping =
    spec.type === 'timeline'
      ? spec.timeline
      : spec.type === 'heatmap'
        ? spec.heatmap
        : spec.timing;
  for (const name of Object.entries(mapping)
    .filter(([key]) => key !== 'timeMode')
    .map(([, value]) => value))
    if (!names.includes(name))
      throw new Error(`Missing mapped chart column: ${name}`);
  const evidence = result.rowEvidence
    ? await verifyRowEvidence(result.rowEvidence, result)
    : undefined;
  if (
    evidence &&
    (!expectedIdentity.execution ||
      !sameExecution(evidence.execution, expectedIdentity.execution) ||
      evidence.scope.storeId !== expectedIdentity.scope.storeId ||
      evidence.scope.projectId !== expectedIdentity.scope.projectId ||
      evidence.scope.environment !== expectedIdentity.scope.environment ||
      evidence.scope.spaceID !== expectedIdentity.scope.spaceID ||
      evidence.source.id !== expectedIdentity.source.id ||
      evidence.source.generation !== expectedIdentity.source.generation)
  )
    throw new Error('Held evidence context mismatch');
  if (
    spec.type === 'timing-bars' &&
    evidence &&
    evidence.rowKeyColumn !== spec.timing.rowKeyColumn
  )
    throw new Error('Timing row identity mismatch');
  const requireTypes = (
    columns: readonly string[],
    types: readonly string[],
  ) => {
    for (const column of columns) {
      if (!types.includes(result.recordset.columns[names.indexOf(column)].type))
        throw new Error('Unsupported mapped chart column type');
    }
  };
  if (spec.type === 'timeline') {
    const m = spec.timeline;
    requireTypes(
      [m.laneColumn, m.eventColumn, m.clockDomainColumn, m.statusColumn],
      ['string'],
    );
    requireTypes([m.sequenceColumn, m.precisionColumn], ['integer', 'number']);
    requireTypes([m.timeColumn], ['string', 'datetime']);
    if (m.timeMode === 'elapsed')
      requireTypes(
        [m.anchorColumn as string, m.sequenceColumn, m.precisionColumn],
        ['integer'],
      );
  } else if (spec.type === 'heatmap') {
    requireTypes(
      [
        spec.heatmap.rowColumn,
        spec.heatmap.columnColumn,
        spec.heatmap.statusColumn,
      ],
      ['string'],
    );
  } else {
    const m = spec.timing;
    requireTypes([m.rowKeyColumn], ['string', 'integer']);
    requireTypes(
      [
        m.labelColumn,
        m.startClockDomainColumn,
        m.endClockDomainColumn,
        m.startIdentityColumn,
        m.endIdentityColumn,
      ],
      ['string'],
    );
    requireTypes([m.startTimeColumn, m.endTimeColumn], ['string', 'datetime']);
    requireTypes(
      [m.startPrecisionColumn, m.endPrecisionColumn],
      ['integer', 'number'],
    );
  }
  const cells = new Set<string>();
  const sequences = new Set<string>();
  const rowKeys = new Set<string>();
  const rows = result.recordset.rows.map((values, index): EvidenceChartRow => {
    const get = (name: string) => {
      const v = values[names.indexOf(name)];
      const declared = result.recordset.columns[names.indexOf(name)].type;
      if (
        v.type !== 'null' &&
        !(
          v.type === declared ||
          (['number', 'integer'].includes(v.type) &&
            ['number', 'integer'].includes(declared))
        )
      )
        throw new Error('Mapped held cell type mismatch');
      return v;
    };
    const inspect = (
      column: string,
      observationId?: string,
    ): EvidenceInspection | undefined => {
      if (!evidence) return undefined;
      const rowKey = get(evidence.rowKeyColumn);
      evidenceKey(rowKey);
      const selector: RowEvidenceSelector = {
        execution: evidence.execution,
        recordsetFingerprint: evidence.recordsetFingerprint,
        scope: evidence.scope,
        source: evidence.source,
        rowKeyColumn: evidence.rowKeyColumn,
        rowKey: rowKey as RowEvidenceSelector['rowKey'],
        slotColumn: column,
      };
      return evidence.rows.find(
        (r) => evidenceKey(r.rowKey) === evidenceKey(rowKey),
      )?.slots[column]?.state === 'available'
        ? {
            selector: structuredClone(selector),
            ...(observationId ? { observationId } : {}),
          }
        : undefined;
    };
    const common = { index, values: structuredClone(values) };
    if (spec.type === 'timeline') {
      const m = spec.timeline;
      if (
        get(m.laneColumn).type !== 'string' ||
        get(m.eventColumn).type !== 'string'
      )
        throw new Error('Timeline lane and event must be text');
      const group = evidenceText(scalar(get(m.laneColumn)));
      const label = evidenceText(scalar(get(m.eventColumn)));
      const sequence = integer(get(m.sequenceColumn));
      if (sequence === undefined)
        throw new Error('Timeline sequence must be an exact integer');
      const key = JSON.stringify([group, sequence]);
      if (sequences.has(key))
        throw new Error('Duplicate timeline lane sequence');
      sequences.add(key);
      const point =
        m.timeMode === 'elapsed'
          ? elapsedInstant(get(m.timeColumn))
          : instant(get(m.timeColumn));
      const precision = integer(get(m.precisionColumn));
      const clock = scalar(get(m.clockDomainColumn));
      const selected = inspect(m.evidenceRefColumn);
      const status = scalar(get(m.statusColumn));
      if (
        get(m.statusColumn).type !== 'string' ||
        !['pass', 'fail', 'unknown'].includes(status)
      )
        throw new Error('Timeline status must be pass, fail or unknown');
      const observed =
        point !== undefined &&
        get(m.clockDomainColumn).type === 'string' &&
        trimCoreSpace(clock) !== '' &&
        precision !== undefined &&
        precision > 0;
      return {
        ...common,
        group,
        label,
        sequence,
        status,
        ...(observed ? { time: point, precisionMs: precision } : {}),
        inspections: observed && selected ? [selected] : [],
        ...(!observed
          ? { unavailable: 'No compatible observed timestamp' }
          : !selected
            ? { unavailable: 'Evidence unavailable' }
            : {}),
      };
    }
    if (spec.type === 'heatmap') {
      const m = spec.heatmap;
      const group = evidenceText(scalar(get(m.rowColumn)));
      const label = evidenceText(scalar(get(m.columnColumn)));
      const key = JSON.stringify([group, label]);
      if (cells.has(key)) throw new Error('Duplicate heatmap cell');
      cells.add(key);
      const status =
        get(m.statusColumn).type === 'null'
          ? 'unknown'
          : scalar(get(m.statusColumn));
      if (!['pass', 'fail', 'unknown'].includes(status))
        throw new Error('Unsupported heatmap status');
      const selected = inspect(m.evidenceRefColumn);
      return {
        ...common,
        group,
        label,
        status: selected ? status : 'unknown',
        inspections: selected ? [selected] : [],
        ...(!selected ? { unavailable: 'Evidence unavailable' } : {}),
      };
    }
    const m = spec.timing;
    const key = evidenceKey(get(m.rowKeyColumn));
    if (rowKeys.has(key)) throw new Error('Duplicate timing row key');
    rowKeys.add(key);
    const label = evidenceText(scalar(get(m.labelColumn)));
    const group = 'Measured endpoints';
    const start = instant(get(m.startTimeColumn));
    const end = instant(get(m.endTimeColumn));
    const first = scalar(get(m.startIdentityColumn));
    const last = scalar(get(m.endIdentityColumn));
    const clock = scalar(get(m.startClockDomainColumn));
    const endClock = scalar(get(m.endClockDomainColumn));
    const precision = integer(get(m.startPrecisionColumn));
    const endPrecision = integer(get(m.endPrecisionColumn));
    const startInspection = inspect(m.startEvidenceRefColumn, first);
    const endInspection = inspect(m.endEvidenceRefColumn, last);
    const measured =
      start !== undefined &&
      end !== undefined &&
      end >= start &&
      Number.isSafeInteger(end - start) &&
      trimCoreSpace(first) !== '' &&
      trimCoreSpace(last) !== '' &&
      first !== last &&
      trimCoreSpace(clock) !== '' &&
      clock === endClock &&
      precision !== undefined &&
      precision > 0 &&
      precision === endPrecision &&
      startInspection &&
      endInspection;
    return {
      ...common,
      group,
      label,
      status: measured ? 'observed' : 'unavailable',
      ...(measured
        ? {
            durationMs: end - start,
            precisionMs: precision,
            start: scalar(get(m.startTimeColumn)),
            end: scalar(get(m.endTimeColumn)),
          }
        : {
            unavailable: 'Measured endpoints or admitted evidence unavailable',
          }),
      inspections: measured ? [startInspection, endInspection] : [],
    };
  });
  if (spec.type === 'timeline' && spec.timeline.timeMode === 'elapsed') {
    const m = spec.timeline;
    const cell = (row: EvidenceChartRow, column: string) =>
      row.values[names.indexOf(column)];
    const anchors = new Map<string, EvidenceChartRow>();
    for (const row of rows) {
      const marker = cell(row, m.anchorColumn as string);
      if (marker.type !== 'integer' || !['0', '1'].includes(marker.value))
        throw new Error('Elapsed anchor must be exactly integer 0 or 1');
      if (marker.value === '1') {
        if (anchors.has(row.group))
          throw new Error('Duplicate observed start in timeline lane');
        if (row.time === undefined || !row.inspections.length)
          throw new Error(
            'Observed start requires an admitted nonnull timestamp and row identity',
          );
        anchors.set(row.group, row);
      }
    }
    for (const row of rows) {
      const anchor = anchors.get(row.group);
      if (!anchor) throw new Error('No observed start for timeline lane');
      if (cell(row, m.timeColumn).type === 'null') continue;
      const point = elapsedInstant(cell(row, m.timeColumn));
      const clock = scalar(cell(row, m.clockDomainColumn));
      const precision = integer(cell(row, m.precisionColumn));
      if (
        cell(row, m.sequenceColumn).type !== 'integer' ||
        cell(row, m.precisionColumn).type !== 'integer' ||
        point === undefined ||
        row.time === undefined ||
        clock !== scalar(cell(anchor, m.clockDomainColumn)) ||
        !trimCoreSpace(clock) ||
        precision !== anchor.precisionMs ||
        !precision ||
        precision < 1
      )
        throw new Error(
          'Elapsed timeline requires compatible observed clocks, times and precision',
        );
      const elapsedMs = point - (anchor.time as number);
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0)
        throw new Error(
          'Elapsed timeline has reversed or unsafe observed times',
        );
      Object.assign(row, {
        elapsedMs,
        start: scalar(cell(anchor, m.timeColumn)),
        end: scalar(cell(row, m.timeColumn)),
        anchorIdentity: evidenceKey(anchor.inspections[0].selector.rowKey),
      });
    }
  }
  if (spec.type === 'timeline')
    rows.sort(
      (a, b) =>
        a.group.localeCompare(b.group) || (a.sequence ?? 0) - (b.sequence ?? 0),
    );
  return {
    kind: spec.type,
    ...(spec.type === 'timeline' && spec.timeline.timeMode
      ? { timeMode: spec.timeline.timeMode }
      : {}),
    selectionId: spec.selectionId,
    columns: structuredClone(result.recordset.columns),
    rows,
    provenance: structuredClone(result.provenance),
    limitations: structuredClone(result.limitations),
    scope: structuredClone(expectedIdentity.scope),
    source: structuredClone(expectedIdentity.source),
  };
}

import type { ExecutionRef, Result, TypedValue } from '../contract/types';

export interface EvidenceScope {
  readonly storeId: string;
  readonly spaceID?: string;
  readonly projectId: string;
  readonly environment: string;
}
export interface EvidenceSource {
  readonly id: string;
  readonly generation: string;
}
export type EvidenceRowKey = Extract<
  TypedValue,
  { type: 'string' | 'integer' }
>;
export interface EvidenceProjectRef {
  readonly storeId: string;
  readonly projectId: string;
  readonly environment?: string;
}
export interface EvidenceArtifactRef extends EvidenceProjectRef {
  readonly id: string;
  readonly folder?: string;
}
export type ArtifactRef =
  | {
      readonly kind: 'execution' | 'snapshot';
      readonly execution: ExecutionRef;
    }
  | { readonly kind: 'project'; readonly project: EvidenceProjectRef }
  | {
      readonly kind: 'incident';
      readonly incident: {
        readonly storeId: string;
        readonly incidentId: string;
      };
    }
  | { readonly kind: 'event' | 'hypothesis'; readonly id: string }
  | {
      readonly kind: 'query' | 'check' | 'board' | 'fact' | 'annotation';
      readonly artifact: EvidenceArtifactRef;
    }
  | {
      readonly kind: 'compare';
      readonly comparison: {
        readonly left: ExecutionRef;
        readonly right: ExecutionRef;
      };
    }
  | {
      readonly kind: 'check-run';
      readonly checkRun: {
        readonly storeId: string;
        readonly projectId: string;
        readonly environment: string;
        readonly checkId: string;
        readonly checkVersion: number;
        readonly runId: string;
      };
    };
export interface RowEvidenceSlot {
  readonly state: 'available' | 'unavailable';
  readonly refs?: readonly ArtifactRef[];
}
export interface RowEvidence {
  readonly version: 1;
  readonly execution: ExecutionRef;
  readonly recordsetFingerprint: string;
  readonly scope: EvidenceScope;
  readonly source: EvidenceSource;
  readonly rowKeyColumn: string;
  readonly rows: readonly {
    readonly rowKey: EvidenceRowKey;
    readonly slots: Readonly<Record<string, RowEvidenceSlot>>;
  }[];
}
export interface RowEvidenceSelector {
  readonly execution: ExecutionRef;
  readonly recordsetFingerprint: string;
  readonly scope: EvidenceScope;
  readonly source: EvidenceSource;
  readonly rowKeyColumn: string;
  readonly rowKey: EvidenceRowKey;
  readonly slotColumn: string;
}
export function evidenceObject(
  v: unknown,
  keys?: readonly string[],
): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Evidence requires an object');
  const obj = v as Record<string, unknown>;
  if (keys && Object.keys(obj).some((k) => !keys.includes(k)))
    throw new Error('Unknown evidence field');
  return obj;
}
export function evidenceText(v: unknown): string {
  if (typeof v !== 'string' || !v || v.trim() !== v)
    throw new Error('Evidence identity must be canonical');
  return v;
}
function segment(v: unknown): string {
  const s = evidenceText(v);
  if (s === '.' || s === '..' || /[/\\\p{Cc}]/u.test(s))
    throw new Error('Invalid evidence segment');
  return s;
}
function array(v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) throw new Error('Evidence requires an array');
  return v;
}
function execution(v: unknown): ExecutionRef {
  const o = evidenceObject(v, ['storeId', 'projectId', 'executionId']);
  return {
    storeId: segment(o['storeId']),
    projectId: segment(o['projectId']),
    executionId: segment(o['executionId']),
  };
}
function project(
  v: unknown,
  extra: readonly string[] = [],
): EvidenceProjectRef {
  const o = evidenceObject(v, [
    'storeId',
    'projectId',
    'environment',
    ...extra,
  ]);
  return {
    storeId: segment(o['storeId']),
    projectId: segment(o['projectId']),
    ...(o['environment'] === undefined
      ? {}
      : { environment: segment(o['environment']) }),
  };
}
export function decodeEvidenceArtifactRef(v: unknown): ArtifactRef {
  const o = evidenceObject(v);
  const kind = o['kind'];
  const field =
    kind === 'execution' || kind === 'snapshot'
      ? 'execution'
      : kind === 'event' || kind === 'hypothesis'
        ? 'id'
        : kind === 'query' ||
            kind === 'check' ||
            kind === 'board' ||
            kind === 'fact' ||
            kind === 'annotation'
          ? 'artifact'
          : kind === 'check-run'
            ? 'checkRun'
            : kind === 'incident'
              ? 'incident'
              : kind === 'project'
                ? 'project'
                : kind === 'compare'
                  ? 'comparison'
                  : '';
  if (!field) throw new Error('Unsupported artifact kind');
  evidenceObject(o, ['kind', field]);
  const value = o[field];
  switch (kind) {
    case 'execution':
    case 'snapshot':
      return { kind, execution: execution(value) };
    case 'event':
    case 'hypothesis':
      return { kind, id: segment(value) };
    case 'project':
      return { kind, project: project(value) };
    case 'incident': {
      const i = evidenceObject(value, ['storeId', 'incidentId']);
      return {
        kind,
        incident: {
          storeId: segment(i['storeId']),
          incidentId: segment(i['incidentId']),
        },
      };
    }
    case 'compare': {
      const c = evidenceObject(value, ['left', 'right']);
      return {
        kind,
        comparison: {
          left: execution(c['left']),
          right: execution(c['right']),
        },
      };
    }
    case 'check-run': {
      const c = evidenceObject(value, [
        'storeId',
        'projectId',
        'environment',
        'checkId',
        'checkVersion',
        'runId',
      ]);
      if (
        !Number.isSafeInteger(c['checkVersion']) ||
        (c['checkVersion'] as number) < 1
      )
        throw new Error('Unsafe check version');
      return {
        kind,
        checkRun: {
          storeId: segment(c['storeId']),
          projectId: segment(c['projectId']),
          environment: segment(c['environment']),
          checkId: segment(c['checkId']),
          checkVersion: c['checkVersion'] as number,
          runId: segment(c['runId']),
        },
      };
    }
    default: {
      const a = evidenceObject(value, [
        'storeId',
        'projectId',
        'environment',
        'id',
        'folder',
      ]);
      const folder =
        a['folder'] === undefined ? undefined : evidenceText(a['folder']);
      if (folder)
        for (const part of folder.split('/')) {
          segment(part);
          if (part.includes('%')) throw new Error('Invalid artifact folder');
        }
      return {
        kind: kind as 'query' | 'check' | 'board' | 'fact' | 'annotation',
        artifact: {
          ...project(a, ['id', 'folder']),
          id: segment(a['id']),
          ...(folder ? { folder } : {}),
        },
      };
    }
  }
}
export function evidenceKey(v: unknown): string {
  const o = evidenceObject(v, ['type', 'value']);
  if (o['type'] !== 'string' && o['type'] !== 'integer')
    throw new Error('Row keys must be typed strings or integers');
  if (
    typeof o['value'] !== 'string' ||
    (o['type'] === 'integer' && !/^(0|-?[1-9]\d*)$/.test(o['value']))
  )
    throw new Error('Invalid typed row key');
  return `${o['type']}:${o['value']}`;
}
export function sameExecution(a: ExecutionRef, b: ExecutionRef): boolean {
  return (
    a.storeId === b.storeId &&
    a.projectId === b.projectId &&
    a.executionId === b.executionId
  );
}

/** Canonical Core json.Marshal order/escaping, including negative zero. */
export function canonicalRecordsetJSON(recordset: Result['recordset']): string {
  const quote = (s: string) =>
    JSON.stringify(s).replace(
      /[<>&\u2028\u2029]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  const columns = recordset.columns ?? [];
  const rows = recordset.rows ?? [];
  const cell = (v: TypedValue): string => {
    if (v.type === 'number' && !Number.isFinite(v.value))
      throw new Error('Nonfinite recordset value');
    const value =
      v.type === 'number'
        ? Object.is(v.value, -0)
          ? '-0'
          : JSON.stringify(v.value)
        : typeof v.value === 'string'
          ? quote(v.value)
          : JSON.stringify(v.value);
    return `{"type":${quote(v.type)},"value":${value}}`;
  };
  return `{"columns":[${columns.map((c) => `{"name":${quote(c.name)},"type":${quote(c.type)}}`).join(',')}],"rows":[${rows
    .map((row) => {
      if ((row?.length ?? 0) !== columns.length)
        throw new Error('Malformed held row');
      return `[${(row ?? []).map(cell).join(',')}]`;
    })
    .join(',')}]}`;
}

/** Standard browser SHA-256 over the exact published Core canonical bytes. */
export async function recordsetFingerprint(
  recordset: Result['recordset'],
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRecordsetJSON(recordset));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}

/** Structural decoding only. Use verifyRowEvidence before exposing prepared evidence. */
export function decodeRowEvidence(
  value: unknown,
  result: Pick<Result, 'recordset' | 'execution'>,
): RowEvidence {
  const o = evidenceObject(value, [
    'version',
    'execution',
    'recordsetFingerprint',
    'scope',
    'source',
    'rowKeyColumn',
    'rows',
  ]);
  if (o['version'] !== 1 || !result.execution)
    throw new Error('Unsupported or unretained row evidence');
  const exec = execution(o['execution']);
  if (!sameExecution(exec, result.execution))
    throw new Error('Row evidence execution mismatch');
  const scopeObj = evidenceObject(o['scope'], [
    'storeId',
    'spaceID',
    'projectId',
    'environment',
  ]);
  const scope: EvidenceScope = {
    storeId: segment(scopeObj['storeId']),
    projectId: segment(scopeObj['projectId']),
    environment: segment(scopeObj['environment']),
    ...(scopeObj['spaceID'] === undefined
      ? {}
      : { spaceID: evidenceText(scopeObj['spaceID']) }),
  };
  if (
    scope.storeId !== exec.storeId ||
    scope.projectId !== exec.projectId ||
    (scope.storeId === 'firestore' && !scope.spaceID)
  )
    throw new Error('Row evidence scope mismatch');
  const src = evidenceObject(o['source'], ['id', 'generation']);
  const source = {
    id: evidenceText(src['id']),
    generation: evidenceText(src['generation']),
  };
  const fingerprint = evidenceText(o['recordsetFingerprint']);
  if (!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error('Invalid row evidence fingerprint');
  const columns = result.recordset.columns.map((c) => evidenceText(c.name));
  if (new Set(columns).size !== columns.length)
    throw new Error('Duplicate held column');
  const rowKeyColumn = evidenceText(o['rowKeyColumn']);
  const index = columns.indexOf(rowKeyColumn);
  if (index < 0) throw new Error('Missing row key column');
  const held = result.recordset.rows.map((row) => evidenceKey(row[index]));
  if (new Set(held).size !== held.length) throw new Error('Duplicate held key');
  const seen = new Set<string>();
  const rows = array(o['rows'] ?? []).map((v) => {
    const row = evidenceObject(v, ['rowKey', 'slots']);
    const key = evidenceKey(row['rowKey']);
    if (!held.includes(key) || seen.has(key))
      throw new Error('Unknown or duplicate metadata key');
    seen.add(key);
    const slots: Record<string, RowEvidenceSlot> = Object.create(null);
    for (const [column, raw] of Object.entries(
      evidenceObject(row['slots'] ?? {}),
    )) {
      if (!columns.includes(column)) throw new Error('Unknown evidence slot');
      const slot = evidenceObject(raw, ['state', 'refs']);
      const refs =
        slot['refs'] === undefined
          ? []
          : array(slot['refs']).map(decodeEvidenceArtifactRef);
      if (slot['state'] === 'unavailable') {
        if (refs.length) throw new Error('Unavailable slot has refs');
        slots[column] = { state: 'unavailable' };
      } else if (
        slot['state'] === 'available' &&
        refs.some(
          (r) => r.kind === 'execution' && sameExecution(r.execution, exec),
        )
      )
        slots[column] = { state: 'available', refs };
      else
        throw new Error('Available slot requires matching retained execution');
    }
    return { rowKey: structuredClone(row['rowKey']) as EvidenceRowKey, slots };
  });
  return {
    version: 1,
    execution: exec,
    recordsetFingerprint: fingerprint,
    scope,
    source,
    rowKeyColumn,
    rows,
  };
}

/** Digest admission is asynchronous and occurs before selectors/refs leave preparation. */
export async function verifyRowEvidence(
  value: unknown,
  result: Pick<Result, 'recordset' | 'execution'>,
): Promise<RowEvidence> {
  const evidence = decodeRowEvidence(value, result);
  if (
    evidence.recordsetFingerprint !==
    (await recordsetFingerprint(result.recordset))
  )
    throw new Error('Row evidence fingerprint mismatch');
  return evidence;
}

/** Optional metadata is not authority. Consumers re-admit retention and rights on open. */
export async function resolveRowEvidence(
  result: Result,
  selector: RowEvidenceSelector,
): Promise<RowEvidenceSlot | undefined> {
  const expectedSelector = structuredClone(selector);
  evidenceKey(expectedSelector.rowKey);
  evidenceText(expectedSelector.slotColumn);
  if (!result.rowEvidence) return undefined;
  const e = await verifyRowEvidence(result.rowEvidence, result);
  if (
    !sameExecution(e.execution, expectedSelector.execution) ||
    e.recordsetFingerprint !== expectedSelector.recordsetFingerprint ||
    e.rowKeyColumn !== expectedSelector.rowKeyColumn ||
    e.scope.storeId !== expectedSelector.scope.storeId ||
    e.scope.projectId !== expectedSelector.scope.projectId ||
    e.scope.environment !== expectedSelector.scope.environment ||
    e.scope.spaceID !== expectedSelector.scope.spaceID ||
    e.source.id !== expectedSelector.source.id ||
    e.source.generation !== expectedSelector.source.generation
  )
    throw new Error('Evidence selector mismatch');
  const row = e.rows.find(
    (r) => evidenceKey(r.rowKey) === evidenceKey(expectedSelector.rowKey),
  );
  const slot = row?.slots[expectedSelector.slotColumn];
  return slot?.state === 'available' ? structuredClone(slot) : undefined;
}

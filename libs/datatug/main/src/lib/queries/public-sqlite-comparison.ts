import { isValidProjectRef, type IProjectRef } from '../core/project-context';
import type { PublicSqliteCompareWasmPin } from './public-sqlite-comparison-pin.token';

export interface ComparisonFixtureProvenance {
  readonly providerRepository: string;
  readonly providerCommit: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly hostMergeCommit: string;
}

export interface ComparisonFixtureTarget {
  readonly id: 'chinook-baseline' | 'chinook-candidate';
  readonly role: 'baseline' | 'candidate';
  readonly displayLabel: string;
  readonly environmentLabel: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly schemaSha256: string;
  readonly provenance: ComparisonFixtureProvenance;
}

export interface PublicSqliteComparisonProjection {
  readonly outputColumns?: readonly {
    readonly name: string;
    readonly type: 'integer' | 'string';
    readonly lineage: readonly { readonly source: string; readonly field: string }[];
  }[];
  readonly relationship?: {
    readonly fromSource: string;
    readonly toSource: string;
  };
}

/** Shared page/service eligibility check for the exact bounded raw-text diff profile. */
export function isSupportedPublicSqliteComparisonProjection(
  projection: PublicSqliteComparisonProjection,
): boolean {
  const columns = projection.outputColumns;
  const relationship = projection.relationship;
  const key = columns?.[0];
  return Boolean(
    relationship && columns && columns.length >= 2 && columns.length <= 40 &&
    key?.name === 'InvoiceId' && key.type === 'integer' && key.lineage.length === 1 &&
    key.lineage[0]?.source === relationship.fromSource &&
    key.lineage[0]?.field === 'InvoiceId' &&
    columns.slice(1).every((column) =>
      column.type === 'string' && column.lineage.length === 1 &&
      ((column.lineage[0]?.source === relationship.fromSource &&
        column.lineage[0]?.field === 'InvoiceDate') ||
        (column.lineage[0]?.source === relationship.toSource &&
          ['FirstName', 'LastName', 'Email'].includes(column.lineage[0]?.field ?? ''))),
    ),
  );
}

const PROVIDER = Object.freeze({
  providerRepository: 'https://github.com/demo-db/chinook',
  providerCommit: '95d14a11256f8db512d5ecd7ea5be56e01d51781',
  manifestPath: 'fixtures/compare/manifest.json',
  manifestSha256:
    'aa80280419d5e0e8bd99ae97574b5d91cbf4df6e560e536f8699f42ec175c887',
  hostMergeCommit: '44d9f354ed5b7bf8aaf496dfde15e81d4307730c',
});

export const PUBLIC_CHINOOK_COMPARISON_TARGETS: readonly ComparisonFixtureTarget[] =
  Object.freeze([
    Object.freeze({
      id: 'chinook-baseline',
      role: 'baseline',
      displayLabel: 'Pinned upstream baseline',
      environmentLabel: 'Public baseline endpoint',
      url: 'https://chinook.demodb.dev/data/chinook.sqlite',
      sha256:
        '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15',
      bytes: 1007616,
      schemaSha256:
        '8392c76c7fd8da3bce20d1cec2c60223692a08915787f5c7393cec1c0b6acb94',
      provenance: PROVIDER,
    }),
    Object.freeze({
      id: 'chinook-candidate',
      role: 'candidate',
      displayLabel: 'Synthetic comparison fixture (not production data)',
      environmentLabel: 'Publicly hosted comparison fixture',
      url: 'https://chinook.demodb.dev/data/compare/3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f.sqlite',
      sha256:
        '3369d25729dea9e21facc7226aee3d5247fa0f3d8d4be4678aa9247fd064845f',
      bytes: 1007616,
      schemaSha256:
        '8392c76c7fd8da3bce20d1cec2c60223692a08915787f5c7393cec1c0b6acb94',
      provenance: PROVIDER,
    }),
  ]);

export interface ComparisonFixtureCatalog {
  readonly comparisonFixtures?: readonly unknown[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compare admits exactly the two reviewed descriptors; saved connections are not authority. */
export function admitPublicSqliteComparisonFixtures(
  catalog: ComparisonFixtureCatalog | null | undefined,
): readonly ComparisonFixtureTarget[] {
  const entries = catalog?.comparisonFixtures;
  if (
    !Array.isArray(entries) ||
    entries.length !== PUBLIC_CHINOOK_COMPARISON_TARGETS.length ||
    entries.some(
      (entry, index) =>
        stableJson(entry) !==
        stableJson(PUBLIC_CHINOOK_COMPARISON_TARGETS[index]),
    )
  ) {
    throw new Error('The project does not admit the pinned Chinook comparison pair.');
  }
  return PUBLIC_CHINOOK_COMPARISON_TARGETS;
}

export function publicSqliteComparisonTarget(
  targetId: ComparisonFixtureTarget['id'],
): ComparisonFixtureTarget {
  const target = PUBLIC_CHINOOK_COMPARISON_TARGETS.find(
    (item) => item.id === targetId,
  );
  if (!target) throw new Error('The comparison target is not admitted.');
  return target;
}

export function assertComparisonProject(project: IProjectRef): void {
  if (
    !isValidProjectRef(project) ||
    !project.storeId ||
    !project.projectId ||
    !['github.com', 'github'].includes(project.storeId) ||
    project.spaceID !== undefined ||
    project.projectApi === 'cloud' ||
    project.storeId === 'firestore'
  ) {
    throw new Error('Public fixture comparison requires a directly authorized project.');
  }
}

export interface ComparisonContextSnapshot {
  readonly projectRef: string;
  /** Ephemeral page-memory scope, not an authenticated identity or permission. */
  readonly pageMemoryScope: string;
  readonly accessClassification: 'public';
  /** Independent fence when the page also has a real agent security context. */
  readonly agentSecurityContextId?: string;
  readonly accessGeneration: number;
  readonly draftRevision: number;
  readonly authoredSourceFingerprint: string;
  readonly relationshipFingerprint: string;
  readonly typedBindingsFingerprint: string;
}

export interface ComparisonWorkerObservation {
  readonly kind: 'browser-session';
  readonly targetId: ComparisonFixtureTarget['id'];
  readonly fixtureSha256: string;
  /** Provider's admitted schema digest; the runtime profile is schemaFingerprint. */
  readonly schemaSha256: string;
  /** Apps' independently inspected SQLite PRAGMA schema and FK profile. */
  readonly schemaFingerprint: string;
  readonly columns: readonly { readonly name: string; readonly type: 'integer' | 'string' }[];
  readonly executionId: string;
  readonly observedAt: string;
  readonly rowCount: number;
  readonly rows: readonly (readonly (string | number | null)[])[];
  readonly resultComplete: true;
}

export interface ComparisonSideObservation extends ComparisonWorkerObservation {
  readonly projectRef: string;
  readonly pageMemoryScope: string;
  readonly accessClassification: 'public';
  readonly agentSecurityContextId?: string;
  readonly accessGeneration: number;
  readonly sessionGeneration: number;
  readonly draftRevision: number;
  readonly authoredSourceFingerprint: string;
  readonly relationshipFingerprint: string;
  readonly typedBindingsFingerprint: string;
  readonly limitations: readonly string[];
  readonly expiresWithSession: true;
}

export interface CoreCompareTypedValue {
  readonly type: 'integer' | 'string' | 'null';
  readonly value: string | null;
}

export interface CoreCompareChangedRow {
  readonly key: readonly CoreCompareTypedValue[];
  readonly columns: readonly {
    readonly column: string;
    readonly left: CoreCompareTypedValue;
    readonly right: CoreCompareTypedValue;
  }[];
}

export interface CoreCompareRow {
  readonly key: readonly CoreCompareTypedValue[];
  readonly row: readonly CoreCompareTypedValue[];
}

export interface CoreSessionCompareDiff {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly key: readonly string[];
  readonly added: readonly CoreCompareRow[];
  readonly removed: readonly CoreCompareRow[];
  readonly changed: readonly CoreCompareChangedRow[];
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly unchanged: number;
    readonly columnsOnlyOnOneSide: readonly { readonly column: string; readonly side: string }[];
  };
  readonly policyLimited: boolean;
  readonly truncated: boolean;
}

export interface SessionCompareResult {
  readonly kind: 'session-comparison';
  readonly abi: 'recordsetcompare/1';
  readonly diff: CoreSessionCompareDiff;
  readonly label: 'Session comparison · expires when this page closes or refreshes';
  readonly observedAt: string;
  readonly expiresWithSession: true;
}

export interface RecordsetComparerModule {
  readonly RECORDSET_COMPARE_ABI: string;
  createRecordsetComparer(options: {
    readonly workerURL: string | URL;
    readonly timeoutMs: number;
    readonly wasmSHA256: string;
    readonly wasmBytes: number;
  }): { compareJSON(input: string, options?: { readonly signal?: AbortSignal }): Promise<string> };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function coreDiff(value: unknown): CoreSessionCompareDiff {
  if (!isRecord(value) || !Array.isArray(value['columns']) || !Array.isArray(value['key']) ||
      !Array.isArray(value['added']) || !Array.isArray(value['removed']) || !Array.isArray(value['changed']) ||
      !isRecord(value['summary']) || typeof value['policyLimited'] !== 'boolean' || typeof value['truncated'] !== 'boolean')
    throw new Error('The Core comparison worker returned an invalid diff.');
  const summary = value['summary'];
  const counts = ['added', 'removed', 'changed', 'unchanged'] as const;
  if (counts.some((key) => !Number.isSafeInteger(summary[key]) || (summary[key] as number) < 0) ||
      !Array.isArray(summary['columnsOnlyOnOneSide']))
    throw new Error('The Core comparison worker returned invalid summary counts.');
  return value as unknown as CoreSessionCompareDiff;
}

function hasSameVisibleSchema(
  actual: readonly { readonly name: string; readonly type: string }[],
  expected: readonly { readonly name: string; readonly type: string }[],
): boolean {
  if (actual.length !== expected.length) return false;
  const remaining = new Map(expected.map((column) => [column.name, column.type]));
  for (const column of actual) {
    if (!column || typeof column.name !== 'string' || typeof column.type !== 'string' ||
        remaining.get(column.name) !== column.type)
      return false;
    remaining.delete(column.name);
  }
  return remaining.size === 0;
}

function typedRows(side: ComparisonSideObservation): {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly (readonly CoreCompareTypedValue[])[];
} {
  if (side.rowCount > 100 || side.rowCount !== side.rows.length || side.resultComplete !== true)
    throw new Error('Core comparison requires two complete results of at most 100 rows.');
  const columns = side.columns;
  if (columns.length < 2 || columns.length > 40)
    throw new Error('Core comparison requires the supported InvoiceId and text projection.');
  if (columns[0]?.name !== 'InvoiceId' || columns[0].type !== 'integer' ||
      columns.slice(1).some((column) => column.type !== 'string') ||
      columns.some((column) => !column.name))
    throw new Error('The browser result is missing its pinned projection names.');
  const rows = side.rows.map((row) => {
    if (row.length !== columns.length) throw new Error('The browser result row width changed.');
    const key = row[0];
    if (!Number.isSafeInteger(key)) throw new Error('Core comparison requires safe integer InvoiceId keys.');
    return Object.freeze(row.map((cell, index): CoreCompareTypedValue => {
      if (index === 0) return Object.freeze({ type: 'integer', value: String(key) });
      if (cell !== null && typeof cell !== 'string')
        throw new Error('Core comparison accepts only raw text cells after InvoiceId.');
      if (typeof cell === 'string' && new TextEncoder().encode(cell).byteLength > 16 * 1024)
        throw new Error('A result cell exceeds the Core comparison limit.');
      return Object.freeze({ type: cell === null ? 'null' : 'string', value: cell });
    }));
  });
  return Object.freeze({
    columns: Object.freeze(columns.map((column) => Object.freeze({ name: column.name, type: column.type }))),
    rows: Object.freeze(rows),
  });
}

/** Calls only the released receipt-free Core WASM ABI from same-origin verified assets. */
export async function compareSessionObservations(
  baseline: ComparisonSideObservation,
  candidate: ComparisonSideObservation,
  expectedContext: ComparisonContextSnapshot,
  expectedSessionGeneration: number,
  wasmPin: PublicSqliteCompareWasmPin,
  signal?: AbortSignal,
  loadCoreComparer?: (moduleUrl: string) => Promise<RecordsetComparerModule>,
): Promise<SessionCompareResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const baselineTarget = publicSqliteComparisonTarget('chinook-baseline');
  const candidateTarget = publicSqliteComparisonTarget('chinook-candidate');
  const contextMatches = (observation: ComparisonSideObservation): boolean =>
    observation.projectRef === expectedContext.projectRef &&
    observation.pageMemoryScope === expectedContext.pageMemoryScope &&
    observation.accessClassification === expectedContext.accessClassification &&
    observation.agentSecurityContextId === expectedContext.agentSecurityContextId &&
    observation.accessGeneration === expectedContext.accessGeneration &&
    observation.sessionGeneration === expectedSessionGeneration &&
    observation.draftRevision === expectedContext.draftRevision &&
    observation.authoredSourceFingerprint === expectedContext.authoredSourceFingerprint &&
    observation.relationshipFingerprint === expectedContext.relationshipFingerprint &&
    observation.typedBindingsFingerprint === expectedContext.typedBindingsFingerprint;
  if (
    baseline.targetId !== 'chinook-baseline' || candidate.targetId !== 'chinook-candidate' ||
    baseline.fixtureSha256 !== baselineTarget.sha256 ||
    baseline.schemaSha256 !== baselineTarget.schemaSha256 ||
    candidate.fixtureSha256 !== candidateTarget.sha256 ||
    candidate.schemaSha256 !== candidateTarget.schemaSha256 ||
    !contextMatches(baseline) || !contextMatches(candidate) ||
    baseline.projectRef !== candidate.projectRef ||
    baseline.pageMemoryScope !== candidate.pageMemoryScope ||
    baseline.accessClassification !== candidate.accessClassification ||
    baseline.agentSecurityContextId !== candidate.agentSecurityContextId ||
    baseline.accessGeneration !== candidate.accessGeneration ||
    baseline.sessionGeneration !== candidate.sessionGeneration ||
    baseline.draftRevision !== candidate.draftRevision ||
    baseline.authoredSourceFingerprint !== candidate.authoredSourceFingerprint ||
    baseline.relationshipFingerprint !== candidate.relationshipFingerprint ||
    baseline.typedBindingsFingerprint !== candidate.typedBindingsFingerprint ||
    baseline.schemaFingerprint !== candidate.schemaFingerprint ||
    baseline.schemaSha256 !== candidate.schemaSha256 ||
    baseline.resultComplete !== true || candidate.resultComplete !== true ||
    baseline.expiresWithSession !== true || candidate.expiresWithSession !== true ||
    !/^[0-9a-f]{64}$/u.test(wasmPin.wasmSHA256) || !Number.isSafeInteger(wasmPin.wasmBytes) || wasmPin.wasmBytes < 1
  ) throw new Error('The frozen comparison pair or released Core pin is invalid.');
  const left = typedRows(baseline);
  const right = typedRows(candidate);
  if (JSON.stringify(left.columns) !== JSON.stringify(right.columns))
    throw new Error('Baseline and candidate output columns are incompatible.');
  const moduleUrl = new URL('/assets/recordsetcompare/index.mjs', window.location.origin);
  const loadModule = loadCoreComparer ?? ((url: string): Promise<RecordsetComparerModule> => import(/* @vite-ignore */ url));
  const module = await loadModule(moduleUrl.href);
  if (module.RECORDSET_COMPARE_ABI !== 'recordsetcompare/1')
    throw new Error('The installed Core comparison ABI is not supported.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const comparer = module.createRecordsetComparer({
    workerURL: new URL('/assets/recordsetcompare/recordsetcompare-worker.js', window.location.origin),
    timeoutMs: 10_000,
    wasmSHA256: wasmPin.wasmSHA256,
    wasmBytes: wasmPin.wasmBytes,
  });
  const responseJson = await comparer.compareJSON(JSON.stringify({
    abi: 'recordsetcompare/1',
    left,
    right,
    leftInfo: { rowCount: baseline.rowCount, limitations: [] },
    rightInfo: { rowCount: candidate.rowCount, limitations: [] },
    key: ['InvoiceId'],
    limit: 100,
  }), { signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let response: unknown;
  try {
    response = JSON.parse(responseJson);
  } catch {
    throw new Error('The Core comparison worker returned invalid JSON.');
  }
  if (!isRecord(response) || response['abi'] !== 'recordsetcompare/1' || response['ok'] !== true)
    throw new Error('The Core comparison worker could not compare this result pair.');
  const diff = coreDiff(response['diff']);
  if (diff.policyLimited || diff.summary.columnsOnlyOnOneSide.length ||
      JSON.stringify(diff.key) !== JSON.stringify(['InvoiceId']) ||
      !hasSameVisibleSchema(diff.columns, left.columns))
    throw new Error('The Core comparison result does not match the shared visible schema.');
  return Object.freeze({
    kind: 'session-comparison',
    abi: 'recordsetcompare/1',
    diff,
    label: 'Session comparison · expires when this page closes or refreshes',
    observedAt: new Date().toISOString(),
    expiresWithSession: true,
  });
}

export type ComparisonSideStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ComparisonSideState {
  readonly target: ComparisonFixtureTarget;
  readonly status: ComparisonSideStatus;
  readonly attempt: number;
  readonly observation?: ComparisonSideObservation;
  readonly error?: string;
}

export interface ComparisonSideToken {
  readonly generation: number;
  readonly attempt: number;
  readonly target: ComparisonFixtureTarget;
  readonly signal: AbortSignal;
}

export interface ComparisonSessionSnapshot {
  readonly generation: number;
  readonly context: ComparisonContextSnapshot;
  readonly invalidated: boolean;
  readonly invalidationReason?: string;
  readonly sides: readonly ComparisonSideState[];
}

/** Page-memory pair state. It creates no durable execution or comparison evidence. */
export class PublicSqliteComparisonSession {
  private generation = 0;
  private state?: ComparisonSessionSnapshot;
  private controllers = new Map<ComparisonFixtureTarget['id'], AbortController>();

  begin(context: ComparisonContextSnapshot): ComparisonSessionSnapshot {
    if (
      !context.projectRef ||
      context.pageMemoryScope !== `public-github:${context.projectRef}` ||
      context.accessClassification !== 'public' ||
      !Number.isSafeInteger(context.accessGeneration) ||
      !Number.isSafeInteger(context.draftRevision) ||
      context.draftRevision < 0 ||
      !context.authoredSourceFingerprint ||
      !context.relationshipFingerprint ||
      !context.typedBindingsFingerprint
    ) {
      throw new Error('The comparison context is incomplete.');
    }
    this.abortAll();
    this.generation++;
    this.state = Object.freeze({
      generation: this.generation,
      context: Object.freeze({ ...context }),
      invalidated: false,
      sides: Object.freeze(
        PUBLIC_CHINOOK_COMPARISON_TARGETS.map((target) =>
          Object.freeze({ target, status: 'queued' as const, attempt: 0 }),
        ),
      ),
    });
    return this.state;
  }

  snapshot(): ComparisonSessionSnapshot | undefined {
    return this.state;
  }

  clear(): void {
    this.abortAll();
    this.generation++;
    this.state = undefined;
  }

  startSide(
    targetId: ComparisonFixtureTarget['id'],
  ): ComparisonSideToken {
    const state = this.requireCurrent();
    if (state.invalidated) throw new Error('The comparison context is stale.');
    const index = state.sides.findIndex((side) => side.target.id === targetId);
    const side = state.sides[index];
    if (!side || !['queued', 'failed', 'cancelled'].includes(side.status))
      throw new Error('This comparison side is not ready to run.');
    this.controllers.get(targetId)?.abort();
    const controller = new AbortController();
    this.controllers.set(targetId, controller);
    const nextSide = Object.freeze({
      target: side.target,
      status: 'running' as const,
      attempt: side.attempt + 1,
    });
    this.replaceSide(index, nextSide);
    return Object.freeze({
      generation: state.generation,
      attempt: nextSide.attempt,
      target: side.target,
      signal: controller.signal,
    });
  }

  completeSide(
    token: ComparisonSideToken,
    workerObservation: ComparisonWorkerObservation,
  ): boolean {
    const index = this.tokenIndex(token);
    if (index < 0) return false;
    const state = this.requireCurrent();
    const side = state.sides[index];
    if (!side || side.status !== 'running') return false;
    if (
      workerObservation.kind !== 'browser-session' ||
      workerObservation.targetId !== token.target.id ||
      workerObservation.fixtureSha256 !== token.target.sha256 ||
      workerObservation.schemaSha256 !== token.target.schemaSha256 ||
      !workerObservation.schemaFingerprint ||
      !workerObservation.executionId ||
      !Number.isSafeInteger(workerObservation.rowCount) ||
      workerObservation.rowCount !== workerObservation.rows.length ||
      workerObservation.resultComplete !== true ||
      !this.hasSupportedRows(workerObservation.rows)
    ) {
      this.failSide(token, 'The worker observation did not match its target.');
      return false;
    }
    const frozenObservation = Object.freeze({
      ...workerObservation,
      projectRef: state.context.projectRef,
      pageMemoryScope: state.context.pageMemoryScope,
      accessClassification: state.context.accessClassification,
      ...(state.context.agentSecurityContextId
        ? { agentSecurityContextId: state.context.agentSecurityContextId }
        : {}),
      accessGeneration: state.context.accessGeneration,
      sessionGeneration: state.generation,
      draftRevision: state.context.draftRevision,
      authoredSourceFingerprint: state.context.authoredSourceFingerprint,
      relationshipFingerprint: state.context.relationshipFingerprint,
      typedBindingsFingerprint: state.context.typedBindingsFingerprint,
      limitations: Object.freeze([]),
      rows: Object.freeze(workerObservation.rows.map((row) => Object.freeze([...row]))),
      expiresWithSession: true as const,
    });
    this.replaceSide(index, Object.freeze({
      ...side,
      status: 'complete',
      observation: frozenObservation,
    }));
    this.controllers.delete(token.target.id);
    return true;
  }

  failSide(token: ComparisonSideToken, error: string): boolean {
    const index = this.tokenIndex(token);
    if (index < 0) return false;
    const side = this.requireCurrent().sides[index];
    if (!side || side.status !== 'running') return false;
    this.replaceSide(index, Object.freeze({
      target: side.target,
      status: 'failed',
      attempt: side.attempt,
      error: error || 'The comparison side failed.',
    }));
    this.controllers.delete(token.target.id);
    return true;
  }

  cancelSide(targetId: ComparisonFixtureTarget['id']): void {
    const state = this.requireCurrent();
    const index = state.sides.findIndex((side) => side.target.id === targetId);
    const side = state.sides[index];
    if (!side || side.status !== 'running') return;
    this.controllers.get(targetId)?.abort();
    this.controllers.delete(targetId);
    this.replaceSide(index, Object.freeze({
      target: side.target,
      status: 'cancelled',
      attempt: side.attempt,
    }));
  }

  invalidate(reason: string): void {
    const state = this.requireCurrent();
    this.abortAll();
    this.state = Object.freeze({
      ...state,
      invalidated: true,
      invalidationReason: reason || 'The comparison context changed.',
      sides: Object.freeze(state.sides.map((side) =>
        side.status === 'running'
          ? Object.freeze({
              target: side.target,
              status: 'cancelled' as const,
              attempt: side.attempt,
            })
          : side,
      )),
    });
  }

  private tokenIndex(token: ComparisonSideToken): number {
    const state = this.state;
    if (!state || state.invalidated || state.generation !== token.generation) return -1;
    const index = state.sides.findIndex((side) => side.target.id === token.target.id);
    const current = state.sides[index];
    return current?.attempt === token.attempt ? index : -1;
  }

  private replaceSide(index: number, side: ComparisonSideState): void {
    const state = this.requireCurrent();
    const sides = [...state.sides];
    sides[index] = side;
    this.state = Object.freeze({ ...state, sides: Object.freeze(sides) });
  }

  private requireCurrent(): ComparisonSessionSnapshot {
    if (!this.state) throw new Error('Start a comparison pair first.');
    return this.state;
  }

  private hasSupportedRows(
    rows: readonly (readonly (string | number | null)[])[],
  ): boolean {
    const keys = new Set<number>();
    return rows.every((row) => {
      const key = row[0];
      if (!Number.isSafeInteger(key) || keys.has(key as number)) return false;
      keys.add(key as number);
      return row.slice(1).every((cell) => cell === null || typeof cell === 'string');
    });
  }

  private abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

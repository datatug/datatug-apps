import {
  executeJoinedDTQLQuery,
  isJoinedDTQLQuery,
  key,
  parseDTQL,
  type JoinedDTQLQuery,
  type QueryExecutor,
  type QueryPage,
} from '@dalgo/core';
import type { TypedValue, RunQueryResponse } from '@sneat/datatug-semantic';
import type { BoundedRecord } from './bounded-federation';
import { boundedResponseText } from './bounded-response';
import { BoundedRunBudget, monotonicTime } from './bounded-run-budget';
import {
  immutableUrl,
  sha256,
  CanonicalMetadataCache,
  CanonicalMetadataReader,
  readCanonicalIndexes,
  array,
  object,
  type CanonicalPins,
  type ImmutableFile,
} from './canonical-metadata';
import {
  parseNativeGraphEnvelope,
  parseHistoricalNativeGraphEnvelope,
  NATIVE_GRAPH_ORIGINAL_DECISION,
  NATIVE_GRAPH_CURRENT_DECISION,
  readNativeGraphMetadata,
  type NativeGraphEnvelope,
  type NativeGraph,
  type NativeStageId,
  type NativeProjection,
} from './native-graph-contract';
import {
  checkedResponsePins,
  runtimePinHeaders,
  validateRuntimePins,
  type CompleteRuntimeReadPins,
} from './runtime-read-pins';
import { validNativeRorUrl } from './public-data-scenario';
import { JsonNumberToken, strictJsonWireNumbers } from './strict-json';
import { localResultBytes } from '../local-result-bytes';
import {
  classifyP1Token,
  p1WireEvidence,
  boundedJsonEvidence,
} from './p1-wire-evidence';
import type {
  OrdinaryPage,
  OrdinaryPageReceipt,
  RuntimeReadReport,
} from './immutable-federation';

export type GraphStatus =
  | 'matched'
  | 'unmatched'
  | 'ambiguous'
  | 'incomplete'
  | 'unattempted'
  | 'missing'
  | 'null'
  | 'empty'
  | 'invalid'
  | 'unsupported-precision'
  | 'not-requested'
  | 'no-locations';
export interface ProjectionValue {
  readonly key?: string;
  readonly status: GraphStatus;
  readonly reason?: string;
}
/** Raw native values are retained separately. Operators never repair or coerce them. */
export function nativeProjection(
  operator: NativeProjection,
  values: readonly unknown[],
): ProjectionValue {
  for (const value of values) {
    if (value === undefined) return { status: 'missing' };
    if (value === null) return { status: 'null' };
    if (value === '') return { status: 'empty' };
  }
  if (operator === 'ror-positive-int-geonames-decimal/1') {
    const value = values[0];
    if (values.length !== 1)
      return { status: 'invalid', reason: 'native-type violation' };
    if (value instanceof JsonNumberToken) return classifyP1Token(value.token);
    return {
      status: 'invalid',
      reason:
        typeof value === 'number'
          ? 'missing exact wire evidence'
          : 'native-type violation',
    };
  }
  if (operator === 'geonames-country-admin1/1') {
    const [country, region] = values;
    if (
      values.length !== 2 ||
      typeof country !== 'string' ||
      typeof region !== 'string' ||
      !/^[A-Z]{2}$/.test(country) ||
      region.includes('.')
    )
      return { status: 'invalid' };
    return { key: `${country}.${region}`, status: 'matched' };
  }
  if (
    operator !== 'exact-string/1' ||
    values.length !== 1 ||
    typeof values[0] !== 'string'
  )
    return { status: 'invalid' };
  return { key: values[0], status: 'matched' };
}
export function graphStableIdentity(value: unknown): string {
  return JSON.stringify(value, (_name, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}
function freezeGraphData<T>(value: T, visited = new WeakSet<object>()): T {
  if (value && typeof value === 'object' && !visited.has(value)) {
    visited.add(value);
    for (const child of Object.values(value)) freezeGraphData(child, visited);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
const bytes = localResultBytes;
const sameKeys = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((key, i) => key === right[i]);
const locallyVerifiedPlans = new WeakSet<NativeGraphPlan>();
/** A parsed/saved envelope is never a verification receipt. Each execution context
 * re-reads original bytes through one shared bounded reader before ordinary I/O.
 * Main-thread saving re-verifies independently after the Worker clone boundary. */
export async function verifyNativeGraphPlan(
  plan: NativeGraphPlan, http: typeof fetch, signal: AbortSignal,
): Promise<void> {
  assertNativeGraphPlan(plan);
  // Every awaited read and the receiving Save marker bind this same immutable
  // candidate; a caller cannot replace canonical roles while a read is pending.
  freezeGraphData(plan);
  const reader = new CanonicalMetadataReader(http, new CanonicalMetadataCache(), signal);
  const indexes = await readCanonicalIndexes(plan.canonical, reader);
  const providers = array(indexes.directory['databases'], 'graph providers').map((value) => object(value, 'graph provider'))
    .filter((provider) => provider['repository'] === plan.attachment.repository && provider['commit'] === plan.attachment.revision);
  if (providers.length !== 1) throw new Error('The graph attachment provider is unregistered or ambiguous.');
  const checked = await readNativeGraphMetadata(plan.attachment, providers[0], indexes, reader);
  if (graphStableIdentity(checked.envelope) !== graphStableIdentity(plan.envelope))
    throw new Error('The graph envelope differs from its verified original attachment bytes.');
  for (const mount of Object.values(plan.stages)) await reader.text(mount.publisherManifest);
  const identities = (refs: readonly ImmutableFile[]) => refs.map(immutableUrl).map((url, i) => url + '#' + refs[i].sha256).sort();
  if (graphStableIdentity(identities(reader.files)) !== graphStableIdentity(identities(plan.references)))
    throw new Error('The graph references differ from its complete verified metadata closure.');
  signal.throwIfAborted();
  locallyVerifiedPlans.add(plan);
}
export function assertLocallyVerifiedNativeGraphPlan(plan: NativeGraphPlan): void {
  assertNativeGraphPlan(plan);
  if (!locallyVerifiedPlans.has(plan))
    throw new Error('The current graph requires locally verified original attachment and full metadata closure.');
}
function exactIntegerToken(token: string, native: number): boolean {
  if (!Number.isSafeInteger(native)) return false;
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(
    token,
  );
  if (!match) return false;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return native === 0;
  const trimmed = digits.replace(/0+$/, ''),
    trailing = digits.length - trimmed.length;
  digits = trimmed;
  const scale = Number(match[4] ?? 0) - (match[3]?.length ?? 0) + trailing;
  if (!Number.isSafeInteger(scale) || scale < 0 || digits.length + scale > 16)
    return false;
  return (
    BigInt((match[1] || '') + digits + '0'.repeat(scale)) === BigInt(native)
  );
}
/** Extra serialized wrapper/key bytes beyond the already reserved typed row payload. */
export function graphStorageOverhead(result: Pick<NativeGraphResult, 'recordset' | 'relatedRecordsets'>): number {
  let total = result.recordset.rows.reduce((sum, _row, index) => sum + bytes(index + 1), 0);
  for (const set of result.relatedRecordsets)
    total += set.recordset.rows.reduce((sum, _row, index) => sum + bytes({ set: set.id, index, rows: [] }) - 2 + bytes([set.id, index]), 0);
  return total;
}
export class GraphCapacityError extends Error {}
/** Cumulative logical records/candidates, plus retained and staging serialized bytes. No refunds after DALgo starts. */
export class NativeGraphLedger {
  private materialized = 0;
  private candidateDebit = 0;
  retainedOutput = 0;
  private readonly retention = new Map<string, number>();
  get intermediate(): number {
    return this.materialized;
  }
  get candidates(): number {
    return this.candidateDebit;
  }
  get parentHolds(): number {
    return this.holds;
  }
  retain(name: string, value: unknown): void {
    const size = bytes(value);
    this.assertBytes(size);
    this.retention.set(name, size);
  }
  serializedIdentity(name: string, value: unknown): string {
    this.assertBytes(bytes(value) * 2 + 2);
    const identity = graphStableIdentity(value);
    this.retain(name, identity);
    return identity;
  }
  private holds = 0;
  private retainedBytes = 0;
  private pendingNativeBytes = 0;
  private pendingTransferBytes = 0;
  private pendingRows = 0;
  private committedMetadataBytes = 0;
  private pendingMetadataBytes = 0;
  private committedStorageBytes = 0;
  private pendingStorageBytes = 0;
  private statusBytes: number;
  constructor(
    readonly budget: BoundedRunBudget,
    parents: number,
    private readonly provenance: unknown,
    statusBytes?: number,
  ) {
    this.statusBytes = statusBytes ?? 4096 + parents * 128 + bytes(provenance);
    this.reserve(parents);
    this.holds = parents;
    this.assertBytes(0);
  }
  get availableRecords(): number {
    return 5000 - this.intermediate - this.holds;
  }
  reserve(rows: number, candidates = 0, fulfill = 0): void {
    this.budget.check();
    if (
      ![rows, candidates, fulfill].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      fulfill > this.holds ||
      this.intermediate + rows + this.holds - fulfill > 5000 ||
      this.candidates + candidates > 100000
    )
      throw new GraphCapacityError(
        'The native graph exhausted its cumulative row or candidate allowance. Run an explicit narrower selection.',
      );
    this.materialized += rows;
    this.candidateDebit += candidates;
    this.holds -= fulfill;
  }
  hold(rows: number): void {
    this.reserve(0);
    if (rows > this.availableRecords)
      throw new GraphCapacityError(
        'Location fan-out cannot fit while retaining its affiliation parents.',
      );
    this.holds += rows;
  }
  assertBytes(extra: number): void {
    this.budget.check();
    if (
      this.statusBytes +
        this.retainedBytes +
        this.pendingNativeBytes +
        this.pendingTransferBytes +
        this.committedStorageBytes + this.pendingStorageBytes +
        this.committedMetadataBytes +
        this.pendingMetadataBytes +
        [...this.retention.values()].reduce((sum, n) => sum + n, 0) +
        extra >
      5 * 1024 * 1024
    )
      throw new GraphCapacityError(
        'The graph exceeds the separate materialized output byte bound.',
      );
  }
  assertOutputRows(rows: number): void {
    if (
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      this.retainedOutput + rows > 5000
    )
      throw new GraphCapacityError(
        'Old and replacement result sets exceed the shared 5000 live output row bound.',
      );
  }
  output(
    value: unknown,
    rowCount: number,
    _parents: number,
    phase: 'materialization' | 'transfer' = 'materialization',
  ): void {
    this.assertOutputRows(rowCount);
    const size = bytes(value);
    // All old committed output, new native representation, transfer and a staging
    // representation remain charged until the Worker reports the atomic commit.
    const heldStatus = this.statusBytes;
    if (phase === 'materialization') this.statusBytes = 0;
    try {
      this.assertBytes(size * 2);
    } catch (error) {
      this.statusBytes = heldStatus;
      throw error;
    }
    if (phase === 'materialization') this.pendingNativeBytes = size;
    else this.pendingTransferBytes = size * 2;
    this.pendingRows = rowCount;
  }
  reserveOutputMetadata(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new GraphCapacityError(
        'Invalid graph output metadata byte reservation.',
      );
    this.assertBytes(Math.max(0, size * 2 - this.pendingMetadataBytes));
    this.pendingMetadataBytes = Math.max(this.pendingMetadataBytes, size * 2);
  }
  preflightOutput(value: unknown, transfer: unknown): void {
    const hold = this.statusBytes;
    this.statusBytes = 0;
    try {
      this.assertBytes(bytes(value) + bytes(transfer) * 2);
    } finally {
      this.statusBytes = hold;
    }
  }
  preholdOutput(value: unknown, transfer: unknown): void {
    const required = bytes(value) + bytes(transfer) * 2;
    this.assertBytes(Math.max(0, required - this.statusBytes));
    this.statusBytes = Math.max(this.statusBytes, required);
  }
  reserveOutputStorage(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) throw new GraphCapacityError('Invalid output storage reservation.');
    this.assertBytes(Math.max(0, size * 2 - this.pendingStorageBytes));
    this.pendingStorageBytes = Math.max(this.pendingStorageBytes, size * 2);
  }
  commitOutputMetadata(): void { this.committedMetadataBytes = this.pendingMetadataBytes / 2; this.pendingMetadataBytes = 0; }
  rollbackOutputMetadata(): void { this.pendingMetadataBytes = 0; }
  commitOutput(): void {
    this.committedStorageBytes = this.pendingStorageBytes / 2; this.pendingStorageBytes = 0;
    this.committedMetadataBytes = this.pendingMetadataBytes / 2;
    this.pendingMetadataBytes = 0;
    this.retainedBytes = this.pendingNativeBytes + this.pendingTransferBytes;
    this.retainedOutput = this.pendingRows;
    this.pendingNativeBytes = 0;
    this.pendingTransferBytes = 0;
    this.pendingRows = 0;
  }
  rollbackOutput(): void {
    this.pendingStorageBytes = 0;
    this.pendingMetadataBytes = 0;
    this.pendingNativeBytes = 0;
    this.pendingTransferBytes = 0;
    this.pendingRows = 0;
  }
}
interface TokenRow {
  readonly token: string;
  readonly lookup: string;
}
interface Link {
  readonly parent: string;
  readonly child: string | null;
}
/** The only admitted local engine shape; no saved query text reaches this seam. */
export function finiteGraphJoin(
  leftName: string,
  rightName: string,
): JoinedDTQLQuery {
  const parsed = parseDTQL(
    {
      from: {
        name: leftName,
        alias: 'l',
        joins: [
          {
            type: 'left',
            hints: { algorithms: ['hash'] },
            from: { name: rightName, alias: 'r' },
            on: [
              {
                left: { source: 'l', field: 'lookup' },
                op: '==',
                right: { source: 'r', field: 'lookup' },
              },
            ],
          },
        ],
      },
      columns: [
        { source: 'l', field: 'token', as: 'parent' },
        { source: 'r', field: 'token', as: 'child' },
      ],
    },
    {
      tables: [
        { name: leftName, fields: ['token', 'lookup'] },
        { name: rightName, fields: ['token', 'lookup'] },
      ],
    },
  );
  if (!isJoinedDTQLQuery(parsed))
    throw new Error('The finite graph join could not be parsed.');
  assertFiniteGraphJoin(parsed);
  return parsed;
}
export function assertFiniteGraphJoin(q: JoinedDTQLQuery): void {
  const j = q.from.joins[0],
    predicate = j?.on[0];
  const left = q.columns?.[0],
    right = q.columns?.[1];
  if (
    q.from.joins.length !== 1 ||
    !j ||
    j.type !== 'left' ||
    j.from.joins.length ||
    !q.from.alias ||
    !j.from.alias ||
    q.from.alias === j.from.alias ||
    q.from.scan !== undefined ||
    j.from.scan !== undefined ||
    j.on.length !== 1 ||
    j.hints?.algorithms?.join(',') !== 'hash' ||
    predicate?.operator !== '==' ||
    predicate.left.source !== q.from.alias ||
    predicate.right.source !== j.from.alias ||
    predicate.left.field !== 'lookup' ||
    predicate.right.field !== 'lookup' ||
    q.filters.length ||
    q.orders.length ||
    q.groupBy !== undefined ||
    q.having !== undefined ||
    q.offset !== undefined ||
    q.limit !== undefined ||
    q.columns?.length !== 2 ||
    left?.as !== 'parent' ||
    left.expression?.kind !== 'field' ||
    left.expression.field.source !== q.from.alias ||
    left.expression.field.field !== 'token' ||
    right?.as !== 'child' ||
    right.expression?.kind !== 'field' ||
    right.expression.field.source !== j.from.alias ||
    right.expression.field.field !== 'token'
  )
    throw new Error(
      'The local native graph requires exactly one flat hash equality join.',
    );
}

export async function executeFiniteGraphJoin(
  left: readonly TokenRow[],
  right: readonly TokenRow[],
  ledger: NativeGraphLedger,
  fulfill = 0,
): Promise<readonly Link[]> {
  const histogram = new Map<string, number>();
  for (const row of right) {
    if (typeof row.lookup !== 'string')
      throw new Error('Wrong right lookup type.');
    histogram.set(row.lookup, (histogram.get(row.lookup) ?? 0) + 1);
  }
  let candidates = 0,
    unmatched = 0;
  for (const row of left) {
    if (typeof row.lookup !== 'string')
      throw new Error('Wrong left lookup type.');
    const n = histogram.get(row.lookup) ?? 0;
    candidates += n;
    if (!n) unmatched++;
  }
  const count = candidates + unmatched;
  freezeGraphData(left); freezeGraphData(right);
  ledger.assertBytes(bytes([left, right]) * 2 + (left.length + right.length) * 256);
  const leftRows = left.map((data) => ({
      key: key('left', data.token),
      exists: true as const,
      data,
    })),
    rightRows = right.map((data) => ({
      key: key('right', data.token),
      exists: true as const,
      data,
    }));
  const linkBytes =
    count *
    (Math.max(0, ...left.map((r) => bytes(r.token))) +
      Math.max(4, ...right.map((r) => bytes(r.token))) +
      64);
  ledger.assertBytes(bytes([leftRows, rightRows]) * 2 + linkBytes * 2);
  ledger.reserve(count, candidates, fulfill);
  const executor: QueryExecutor = {
    query: async <T>(
      query: import('@dalgo/core').StructuredQuery<T>,
    ): Promise<QueryPage<T>> => {
      ledger.budget.check();
      const rows =
        query.source.name === 'left'
          ? leftRows
          : query.source.name === 'right'
            ? rightRows
            : undefined;
      if (!rows) throw new Error('An undeclared local relation was requested.');
      return { records: rows as unknown as QueryPage<T>['records'] };
    },
  };
  const result = await executeJoinedDTQLQuery(
    executor,
    finiteGraphJoin('left', 'right'),
    {
      maxFetchedRows: Math.max(left.length + right.length, 1),
      maxResultRows: Math.max(left.length, right.length, count, 1),
      maxCandidateEvaluations: Math.max(candidates, 1),
      maxRetainedBytes: 5 * 1024 * 1024,
    },
  );
  ledger.budget.check();
  if (result.records.length !== count)
    throw new Error('Finite engine output differed from its reservation.');
  return result.records.map((row) => row.data as unknown as Link);
}
export interface NativeStageMount {
  readonly database: string;
  readonly collection: string;
  readonly publisherManifest: ImmutableFile;
  readonly nativeSnapshot: ImmutableFile;
  readonly nativeDataset: ImmutableFile;
  readonly fields: readonly string[];
  readonly grain: readonly string[];
  readonly runtime: CompleteRuntimeReadPins;
}
/** All pins and maps are saved inputs. This config never grants canonical admission. */
export interface NativeGraphPlan {
  readonly envelope: NativeGraphEnvelope;
  readonly attachment: ImmutableFile;
  readonly canonical: CanonicalPins;
  readonly references: readonly ImmutableFile[];
  readonly stages: Readonly<Record<NativeStageId, NativeStageMount>>;
  readonly aliases: boolean;
  readonly selection: {
    readonly offset: number;
    readonly rows: number;
    readonly fingerprint: string;
  };
}
export interface GraphAffiliation {
  readonly token: string;
  readonly raw: BoundedRecord;
  readonly organization?: string;
  readonly status: GraphStatus;
  readonly locations: GraphStatus;
}
export interface GraphLocation {
  readonly token: string;
  readonly affiliation: string;
  readonly native: string;
  readonly organizationStatus: string;
  readonly placeKey?: string;
  readonly place?: string;
  readonly country?: string;
  readonly admin1?: string;
  readonly referenceEvidence: ReturnType<typeof p1WireEvidence>;
  readonly placeStatus: GraphStatus;
  readonly countryStatus: GraphStatus;
  readonly admin1Status: GraphStatus;
  readonly aliasesStatus: GraphStatus;
}
export interface GraphAlias {
  readonly token: string;
  readonly location: string;
  readonly native: string;
}
export interface GraphRelatedRecordset {
  readonly id: 'locations' | 'aliases';
  readonly label: string;
  readonly parentSet: 'affiliations' | 'locations';
  readonly parentField: string;
  readonly recordset: RunQueryResponse['recordset'];
  readonly totalRows: number;
}
export interface GraphEdgeReport {
  readonly inputOccurrences: number;
  readonly nativeInputRows: number;
  readonly missing: number;
  readonly null: number;
  readonly empty: number;
  readonly invalid: number;
  readonly unsupportedPrecision: number;
  readonly eligibleOccurrences: number;
  readonly distinctRequestedKeys: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly ambiguous: number;
  readonly incomplete: number;
  readonly unattempted: number;
  readonly notRequested: number;
  readonly childRows: number;
  readonly multipliedParents: number;
  readonly evidenceTruncated: boolean;
}
export interface GraphStageAction {
  readonly id: NativeStageId;
  readonly offset: number;
  readonly state:
    | 'available'
    | 'complete'
    | 'waiting-parent'
    | 'not-requested'
    | 'changed-filter';
}
export interface NativeGraphResult {
  readonly stageActions: readonly GraphStageAction[];
  readonly stopped?: string;
  readonly edges: Readonly<Record<string, GraphEdgeReport>>;
  readonly affiliations: readonly GraphAffiliation[];
  readonly locations: readonly GraphLocation[];
  readonly aliases: readonly GraphAlias[];
  readonly native: Readonly<
    Partial<Record<NativeStageId, readonly BoundedRecord[]>>
  >;
  readonly recordset: RunQueryResponse['recordset'];
  readonly relatedRecordsets: readonly GraphRelatedRecordset[];
  readonly coverage: Readonly<Partial<Record<NativeStageId, GraphCoverage>>>;
  readonly ledger: {
    readonly intermediate: number;
    readonly candidates: number;
    readonly outputRows: number;
    readonly networkBytes: number;
  };
  readonly planIdentity: string;
}
export interface GraphCoverage {
  readonly fingerprint: string;
  readonly keys: readonly string[];
  readonly history: readonly OrdinaryPageReceipt[];
  readonly nextOffset: number;
  readonly complete: boolean;
}
const typed = (value: unknown): TypedValue => {
  if (value instanceof JsonNumberToken) {
    if (/^-?(?:0|[1-9][0-9]*)$/.test(value.token))
      return { type: 'integer', value: value.token };
    if (/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/.test(value.token))
      return { type: 'decimal', value: value.token };
    return { type: 'string', value: 'JSON numeric token: ' + value.token };
  }
  if (value === undefined || value === null)
    return { type: 'null', value: null };
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'number' && Number.isFinite(value))
    return { type: 'number', value };
  return {
    type: 'string',
    value: 'JSON diagnostic: ' + boundedJsonEvidence(value).token,
  };
};
const grid = (
  names: readonly string[],
  values: readonly (readonly unknown[])[],
): RunQueryResponse['recordset'] => ({
  columns: names.map((name) => ({ name, type: 'unknown' })),
  rows: values.map((row) => row.map(typed)),
});
const closedFields = (obj: object, allowed: readonly string[]): void => {
  if (Object.keys(obj).some((name) => !allowed.includes(name)))
    throw new Error('Unknown graph plan member.');
};
export function assertNativeGraphPlan(plan: NativeGraphPlan): NativeGraph { return assertKnownNativeGraphPlan(plan, false); }
/** Validate immutable historical shape locally; deliberately returns no execution object. */
export function assertHistoricalNativeGraphPlan(plan: NativeGraphPlan): void { assertKnownNativeGraphPlan(plan, true); }
function assertKnownNativeGraphPlan(plan: NativeGraphPlan, historical: boolean): NativeGraph {
  closedFields(plan, [
    'envelope',
    'attachment',
    'canonical',
    'references',
    'stages',
    'aliases',
    'selection',
  ]);
  const graph = (historical ? parseHistoricalNativeGraphEnvelope : parseNativeGraphEnvelope)(plan.envelope).graphs[0];
  const originalOnly = graphStableIdentity(graph.decision.document) === graphStableIdentity(NATIVE_GRAPH_ORIGINAL_DECISION);
  const required = originalOnly && historical ? [NATIVE_GRAPH_ORIGINAL_DECISION] : [NATIVE_GRAPH_ORIGINAL_DECISION, NATIVE_GRAPH_CURRENT_DECISION];
  if (!Array.isArray(plan.references) || plan.references.length > 96 || required.some((ref) => !plan.references.some((saved) => graphStableIdentity(saved) === graphStableIdentity(ref))))
    throw new Error('The native graph requires its complete immutable decision lineage.');
  if (!historical && (!plan.canonical || Object.keys(plan.canonical).sort().join(',') !== 'directory,meanings,models'))
    throw new Error('A current graph requires all three immutable canonical indexes.');
  immutableUrl(plan.attachment);
  for (const ref of [...Object.values(plan.canonical), ...plan.references])
    immutableUrl(ref);
  if (!historical) {
    const mandatory = [plan.attachment, ...Object.values(plan.canonical), graph.entry.attachment,
      ...Object.values(graph.sources).flatMap((source) => [source.model, source.binding, source.snapshot]),
      ...Object.values(plan.stages).map((stage) => stage.publisherManifest)];
    const identities = new Set(plan.references.map((ref) => immutableUrl(ref) + '#' + ref.sha256));
    if (identities.size !== plan.references.length || mandatory.some((ref) => !identities.has(immutableUrl(ref) + '#' + ref.sha256)))
      throw new Error('The current graph is missing or duplicates a canonical, attachment or stage dependency.');
  }
  if (
    typeof plan.aliases !== 'boolean' ||
    !plan.selection ||
    !Number.isSafeInteger(plan.selection.offset) ||
    plan.selection.offset < 0 ||
    !Number.isSafeInteger(plan.selection.rows) ||
    plan.selection.rows < 1 ||
    plan.selection.rows > 1000 ||
    !/^[a-f0-9]{64}$/.test(plan.selection.fingerprint)
  )
    throw new Error('Invalid explicit native graph selection.');
  if (
    Object.keys(plan.stages).sort().join(',') !==
    'admin1,aliases,countries,locations,organizations,places'
  )
    throw new Error('A graph requires exactly its six stage mounts.');
  for (const stage of graph.stages) {
    const mount = plan.stages[stage.id];
    closedFields(mount, [
      'database',
      'collection',
      'publisherManifest',
      'nativeSnapshot',
      'nativeDataset',
      'fields',
      'grain',
      'runtime',
    ]);
    if (
      !/^[A-Za-z0-9_-]+$/.test(mount.database) ||
      mount.collection !== stage.entity ||
      graphStableIdentity(mount.grain) !== graphStableIdentity(stage.grain) ||
      graphStableIdentity(mount.nativeSnapshot) !==
        graphStableIdentity(graph.sources[stage.source].snapshot) ||
      graphStableIdentity(mount.nativeDataset) !==
        graphStableIdentity(graph.sources[stage.source].dataset)
    )
      throw new Error('Graph stage native-to-serving association differs.');
    immutableUrl(mount.publisherManifest);
    validateRuntimePins(mount.runtime, true);
    if (
      mount.runtime.sourceSha256 !== mount.nativeDataset.sha256 ||
      mount.publisherManifest.revision !== mount.runtime.providerRevision ||
      mount.publisherManifest.repository !== mount.nativeDataset.repository
    )
      throw new Error(
        'Graph serving manifest does not bind the selected native snapshot.',
      );
    for (const field of [
      ...stage.grain,
      ...graph.edges
        .filter((e) => e.from === stage.id)
        .flatMap((e) => e.fields),
      ...graph.edges.filter((e) => e.to === stage.id).map((e) => e.lookupField),
    ])
      if (!mount.fields.includes(field))
        throw new Error(
          'Graph serving map is missing a required native field.',
        );
  }
  for (const source of ['ror', 'geo'] as const) {
    const mounts = graph.stages
      .filter((s) => s.source === source)
      .map((s) => plan.stages[s.id]);
    if (
      mounts.some(
        (m) =>
          m.database !== mounts[0].database ||
          graphStableIdentity(m.runtime) !==
            graphStableIdentity(mounts[0].runtime) ||
          graphStableIdentity(m.publisherManifest) !==
            graphStableIdentity(mounts[0].publisherManifest),
      )
    )
      throw new Error(
        'Stages of one native source must use one exact serving mount.',
      );
  }
  return graph;
}
/** Low-level checked fixture/runtime implementation. Public caller must first pass canonical admission, currently unconditionally closed. */
export class NativeGraphExecution {
  readonly plan: NativeGraphPlan;
  readonly identity: string;
  readonly ledger: NativeGraphLedger;
  private readonly graph: NativeGraph;
  private readonly observedPins = new Map<string, CompleteRuntimeReadPins>();
  private readonly rows = new Map<NativeStageId, readonly BoundedRecord[]>();
  private readonly coverage = new Map<NativeStageId, GraphCoverage>();
  /** Organization keys depend only on the frozen selected-affiliation snapshot. */
  private organizationKeys?: readonly string[];
  private readonly joins = new Map<
    string,
    { left: readonly TokenRow[]; right: readonly TokenRow[]; rows: readonly Link[] }
  >();
  private readonly derived = new Map<
    string,
    { input: readonly BoundedRecord[]; operator: NativeProjection; fields: readonly string[]; rows: readonly TokenRow[] }
  >();
  private readonly affiliations: readonly BoundedRecord[];
  private busy = false;
  private started = false;
  private stopped = '';
  private primaryPending: number;
  private lastResult?: NativeGraphResult;
  private committedResult?: NativeGraphResult;
  private metadataSizer?: (
    response: ReturnType<typeof nativeGraphResponseEnvelope>,
  ) => number;
  private outputQueryId = '';
  private outputSource = '';
  private readonly providedPlan: NativeGraphPlan;
  private planDigest = '';
  constructor(
    plan: NativeGraphPlan,
    affiliations: readonly BoundedRecord[],
    readonly budget: BoundedRunBudget,
    private readonly http: typeof fetch,
    private readonly base: string,
    private readonly metadataHttp: typeof fetch = http,
  ) {
    if (
      budget.maximumBytes !== 5 * 1024 * 1024 ||
      budget.deadline > monotonicTime() + 10000
    )
      throw new Error(
        'The native graph cannot increase the accepted byte or deadline bounds.',
      );
    this.graph = assertNativeGraphPlan(plan);
    freezeGraphData(this.graph);
    this.providedPlan = plan;
    if (
      affiliations.length > plan.selection.rows ||
      affiliations.length > 1000 ||
      affiliations.some(
        (r) =>
          !r ||
          typeof r.key !== 'string' ||
          !r.key ||
          !r.data ||
          typeof r.data !== 'object' ||
          Array.isArray(r.data),
      ) ||
      new Set(affiliations.map((r) => r.key)).size !== affiliations.length
    )
      throw new Error('Invalid selected affiliation occurrences.');
    this.ledger = new NativeGraphLedger(budget, affiliations.length, plan);
    this.ledger.retain('plan', plan);
    this.ledger.retain('input', affiliations);
    this.plan = freezeGraphData(structuredClone(plan));
    this.identity = this.ledger.serializedIdentity('plan-identity', this.plan);
    this.affiliations = freezeGraphData(structuredClone(affiliations));
    this.primaryPending = affiliations.length;
    const heldParents = this.affiliations.map((raw) => ({
      token: raw.key,
      raw,
      status: 'unsupported-precision',
      locations: 'unsupported-precision',
    }));
    const heldGrid = grid(
      ['Affiliation', 'ROR ID', 'Organization lookup', 'Locations'],
      heldParents.map((row) => [
        row.token,
        row.raw.data['ror_id'],
        row.status,
        row.locations,
      ]),
    );
    this.ledger.preholdOutput({ affiliations: heldParents, recordset: heldGrid, planIdentity: this.identity }, {});
    const url = new URL(base);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error('Invalid graph runtime URL.');
    this.keys('organizations');
    this.preholdFallback();
  }
  /** Worker registers its exact definition/output-ID descriptor sizer before source work. */
  prepareOutputMetadata(
    sizer: (response: ReturnType<typeof nativeGraphResponseEnvelope>) => number,
    queryId = '',
    source = '',
  ): void {
    if (this.started || this.metadataSizer)
      throw new Error('Graph output preparation must precede execution.');
    this.metadataSizer = sizer;
    this.outputQueryId = queryId;
    this.outputSource = source;
    this.preholdFallback();
  }
  private preholdFallback(
    coverage: NativeGraphResult['coverage'] = Object.fromEntries(this.coverage),
    runtime: RuntimeReadReport = this.runtimeReport,
  ): void {
    if (this.committedResult) return;
    const preview = this.capacitySnapshot(true, coverage);
    const response = nativeGraphResponseEnvelope(
      preview,
      runtime,
      this.outputQueryId,
      this.outputSource,
    );
    this.ledger.preholdOutput(preview, response);
    this.ledger.reserveOutputStorage(graphStorageOverhead(preview));
    if (this.metadataSizer)
      this.ledger.reserveOutputMetadata(this.metadataSizer(response));
  }
  reserveOutputStorage(size: number): void { this.ledger.reserveOutputStorage(size); }
  commitOutputMetadata(): void { this.ledger.commitOutputMetadata(); }
  rollbackOutputMetadata(): void { this.ledger.rollbackOutputMetadata(); }
  reserveOutputMetadata(size: number): void {
    this.ledger.reserveOutputMetadata(size);
  }
  /** Only the owning Worker calls this after all three grids and descriptor commit. */
  commitOutput(): void {
    if (!this.lastResult) throw new Error('No graph output is staged.');
    this.ledger.commitOutput();
    this.committedResult = this.lastResult;
  }
  /** Failed storage discards staging allowance only; engine/cache/candidate work stays spent. */
  rollbackOutput(): void {
    this.ledger.rollbackOutput();
    this.lastResult = this.committedResult;
    this.stopped =
      'The graph output could not commit. Start a fresh explicit run.';
  }
  get stageActions(): readonly GraphStageAction[] {
    if (this.stopped) return [];
    return this.graph.stages.map((stage) => {
      const coverage = this.coverage.get(stage.id),
        keys = this.keys(stage.id),
        parent = this.graph.edges.find((edge) => edge.to === stage.id)?.from;
      const state =
        stage.id === 'aliases' && !this.plan.aliases
          ? 'not-requested'
          : coverage && !sameKeys(coverage.keys, keys)
            ? 'changed-filter'
            : coverage?.complete
              ? 'complete'
              : parent &&
                  parent !== 'locations' &&
                  !this.currentCoverage(parent)?.complete
                ? 'waiting-parent'
                : 'available';
      return { id: stage.id, offset: coverage?.nextOffset ?? 0, state };
    });
  }
  get runtimeReport(): RuntimeReadReport {
    return {
      pins: Object.fromEntries(this.observedPins),
      pages: Object.fromEntries(
        [...this.coverage].flatMap(([id, coverage]) => {
          const page = coverage.history.at(-1);
          return page ? [[id, page]] : [];
        }),
      ),
      history: Object.fromEntries(
        [...this.coverage].map(([id, coverage]) => [id, coverage.history]),
      ),
    };
  }
  close(): void {
    this.budget.controller.abort(new Error('The native graph was cancelled.'));
    this.budget.close();
  }
  private token(stage: NativeStageId, row: BoundedRecord): string {
    const grain = this.graph.stages.find((s) => s.id === stage)?.grain ?? [];
    const value = [stage, this.plan.stages[stage].nativeSnapshot.sha256, ...grain.map((field) => row.data[field])];
    this.ledger.assertBytes(bytes(value) * 2 + 2);
    return graphStableIdentity(value);
  }
  private keys(id: NativeStageId): readonly string[] {
    if (id === 'organizations' && this.organizationKeys)
      return this.organizationKeys;
    const edge = this.graph.edges.find((e) => e.to === id),
      values = new Set<string>();
    if (id === 'organizations') {
      for (const row of this.affiliations) {
        const raw = row.data['ror_id'];
        if (typeof raw === 'string' && validNativeRorUrl(raw)) values.add(raw);
      }
    } else if (edge && (id !== 'aliases' || this.plan.aliases)) {
      // Singleton parents stay provisional until exhaustive coverage.
      const parentRows =
        edge.from === 'locations'
          ? this.currentCoverage(edge.from)
            ? (this.rows.get(edge.from) ?? [])
            : []
          : this.uniqueRows(edge.from);
      for (const row of parentRows) {
        const p = nativeProjection(
          edge.projection,
          edge.fields.map((field) => row.data[field]),
        );
        if (p.key !== undefined) values.add(p.key);
      }
    }
    const result = [...values].sort();
    if (
      result.length > (id === 'organizations' || id === 'locations' ? 50 : 100)
    )
      throw new Error(
        'The native graph exceeds its distinct ROR/place identifier bound.',
      );
    if (id === 'organizations') {
      this.organizationKeys = result;
      // This is the one retained copy of this immutable bounded key set.
      // readStage stores the same array in coverage and must not charge it again.
      this.ledger.retain('coverage-keys:organizations', result);
    }
    return result;
  }
  private currentCoverage(stage: NativeStageId): GraphCoverage | undefined {
    const coverage = this.coverage.get(stage);
    if (!coverage || !sameKeys(coverage.keys, this.keys(stage))) return undefined;
    return coverage;
  }
  private uniqueRows(stage: NativeStageId): readonly BoundedRecord[] {
    if (!this.currentCoverage(stage)?.complete) return [];
    const field = this.graph.stages.find((s) => s.id === stage)
      ?.grain[0] as string;
    const groups = this.groups(stage, field);
    return [...groups.values()]
      .filter((rows) => rows.length === 1)
      .map((rows) => rows[0]);
  }
  private groups(
    stage: NativeStageId,
    field: string,
  ): Map<string, BoundedRecord[]> {
    const groups = new Map<string, BoundedRecord[]>();
    for (const row of this.rows.get(stage) ?? []) {
      const value = row.data[field];
      if (typeof value !== 'string')
        throw new Error('Wrong native lookup wire type.');
      const group = groups.get(value) ?? [];
      group.push(row);
      groups.set(value, group);
    }
    return groups;
  }
  private singleton(
    stage: NativeStageId,
    projection: ProjectionValue,
  ): { status: GraphStatus; row?: BoundedRecord } {
    if (projection.key === undefined) return { status: projection.status };
    if (this.coverage.has(stage) && !this.currentCoverage(stage))
      return { status: 'incomplete' };
    const field =
        this.graph.edges.find((e) => e.to === stage)?.lookupField ?? 'id',
      group = this.groups(stage, field).get(projection.key) ?? [];
    if (group.length > 1) return { status: 'ambiguous' };
    if (!this.coverage.get(stage)) return { status: 'unattempted' };
    if (!this.coverage.get(stage)?.complete) return { status: 'incomplete' };
    return group.length
      ? { status: 'matched', row: group[0] }
      : { status: 'unmatched' };
  }
  private async readStage(
    id: NativeStageId,
    requested: OrdinaryPage,
  ): Promise<void> {
    this.budget.check();
    if (!Object.isFrozen(this.plan))
      throw new Error('The graph plan changed. Start a fresh explicit run.');
    if (
      !Number.isSafeInteger(requested.limit) ||
      requested.limit < 1 ||
      requested.limit > 1000 ||
      !Number.isSafeInteger(requested.offset) ||
      requested.offset < 0 ||
      (id === 'aliases' && !this.plan.aliases)
    )
      throw new Error('Invalid explicit graph stage page.');
    const mount = this.plan.stages[id],
      keys = this.keys(id),
      fingerprint = this.ledger.serializedIdentity('coverage-identity:' + id, [this.planDigest, id, keys, mount]);
    if (id !== 'organizations')
      this.ledger.retain('coverage-keys:' + id, keys);
    const previous = this.coverage.get(id);
    if (previous && previous.fingerprint !== fingerprint)
      throw new Error(
        'The parent eligible key set changed. Start a fresh explicit run for this branch.',
      );
    if (previous?.complete)
      throw new Error('This exact stage already has exhaustive coverage.');
    if (requested.offset !== (previous?.nextOffset ?? 0))
      throw new Error(
        'Stage continuation requires the next contiguous ordinary offset.',
      );
    if (!keys.length && id !== 'organizations') {
      const parent = this.graph.edges.find((e) => e.to === id)?.from;
      if (parent && !this.currentCoverage(parent)?.complete) return;
    }
    if (!keys.length) {
      this.rows.set(id, []);
      this.coverage.set(id, {
        fingerprint,
        keys,
        history: [],
        nextOffset: 0,
        complete: true,
      });
      return;
    }
    const limit = Math.min(requested.limit, this.ledger.availableRecords);
    if (limit < 1)
      throw new GraphCapacityError(
        'The run exhausted its native cache allowance.',
      );
    const field =
      this.graph.edges.find((edge) => edge.to === id)?.lookupField ?? 'id';
    const query = {
      from: { name: mount.collection },
      limit,
      offset: requested.offset,
      where: { left: { field }, op: 'In', right: { values: keys } },
    };
    parseDTQL(
      query,
      { tables: [{ name: mount.collection, fields: mount.fields }] },
      { maxLimit: 1000 },
    );
    const headers = runtimePinHeaders(mount.runtime);
    headers.set('Content-Type', 'application/yaml');
    headers.set('Accept', 'application/json');
    this.budget.admitNetwork();
    const response = await this.http(
      `${this.base.replace(/\/$/, '')}/v1/databases/${mount.database}/dtql`,
      {
        method: 'POST',
        body: JSON.stringify(query),
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: this.budget.signal,
      },
    );
    const read = await boundedResponseText(
      response,
      this.budget.remaining,
      this.budget.signal,
      (n) => this.budget.consumeNetwork(n),
    );
    if (response.status !== 200)
      throw new Error(
        response.status === 409
          ? 'The immutable graph runtime changed. Acknowledge new pins and run explicitly again.'
          : 'The graph source is unavailable.',
      );
    const checkedPins = checkedResponsePins(response, mount.runtime);
    const doc = strictJsonWireNumbers(read.text) as { records?: BoundedRecord[] };
    if (doc && Array.isArray(doc.records))
      for (const row of doc.records) {
        if (row?.data && typeof row.data === 'object')
          for (const [field, value] of Object.entries(row.data))
            if (value instanceof JsonNumberToken) {
              const native = Number(value.token);
              if (id === 'locations' && field === 'geonames_id') continue;
              if (
                !Number.isFinite(native) ||
                (id === 'locations' &&
                  field === 'ordinal' &&
                  (!/^-?(?:0|[1-9][0-9]*)$/.test(value.token) ||
                    !exactIntegerToken(value.token, native)))
              )
                throw new Error(
                  'A native identity integer cannot be represented without rounding.',
                );
              (row.data as Record<string, unknown>)[field] = native;
            }
      }
    if (
      !doc ||
      Object.keys(doc).some((name) => name !== 'records') ||
      !Array.isArray(doc.records) ||
      doc.records.length > limit
    )
      throw new Error('Invalid graph ordinary page.');
    const accepted = this.rows.get(id) ?? [],
      servingKeys = new Set(accepted.map((row) => row.key)),
      grains = new Set<string>();
    if (id === 'locations' || id === 'aliases')
      for (const row of accepted)
        grains.add(
          graphStableIdentity(
            this.plan.stages[id].grain.map((f) => row.data[f]),
          ),
        );
    for (const row of doc.records) {
      if (
        !row ||
        typeof row.key !== 'string' ||
        !row.key ||
        servingKeys.has(row.key) ||
        !row.data ||
        typeof row.data !== 'object' ||
        Array.isArray(row.data) ||
        typeof row.data[field] !== 'string' ||
        !keys.includes(row.data[field] as string)
      )
        throw new Error('Malformed, overlapping or unfiltered native row.');
      servingKeys.add(row.key);
      for (const f of mount.grain)
        if (
          f === 'ordinal'
            ? !Number.isSafeInteger(row.data[f]) || Number(row.data[f]) < 0
            : typeof row.data[f] !== 'string' || row.data[f] === ''
        )
          throw new Error('Invalid native row grain.');
      if (id === 'locations' || id === 'aliases') {
        const grain = graphStableIdentity(mount.grain.map((f) => row.data[f]));
        if (grains.has(grain))
          throw new Error('Duplicate native child identity.');
        grains.add(grain);
      }
    }
    const complete = doc.records.length < limit,
      receipt = {
        ...requested,
        limit,
        rows: doc.records.length,
        possiblyMore: !complete,
        complete,
      };
    const nextCoverage: GraphCoverage = {
      fingerprint,
      keys,
      history: [...(previous?.history ?? []), receipt],
      nextOffset: requested.offset + doc.records.length,
      complete,
    };
    const prospectiveCoverage = {
      ...Object.fromEntries(this.coverage),
      [id]: nextCoverage,
    };
    const prospectiveRuntime: RuntimeReadReport = {
      pins: {
        ...Object.fromEntries(this.observedPins),
        [mount.database]: checkedPins,
      },
      pages: Object.fromEntries(
        Object.entries(prospectiveCoverage).flatMap(([stage, value]) => {
          const latest = value.history.at(-1);
          return latest ? [[stage, latest]] : [];
        }),
      ),
      history: Object.fromEntries(
        Object.entries(prospectiveCoverage).map(([stage, value]) => [
          stage,
          value.history,
        ]),
      ),
    };
    // No cache/coverage acceptance or dependent work may consume the held fallback.
    this.preholdFallback(prospectiveCoverage, prospectiveRuntime);
    this.ledger.assertBytes(bytes([...accepted, ...doc.records]) * 2);
    // Reserve occurrence space before child cache/alias work can spend it.
    if (id === 'locations') {
      const parents = new Map<string, number>();
      for (const row of this.affiliations) {
        const raw = row.data['ror_id'];
        if (typeof raw === 'string')
          parents.set(raw, (parents.get(raw) ?? 0) + 1);
      }
      const fanout = doc.records.reduce(
        (n, row) =>
          n + (parents.get(row.data['organization_id'] as string) ?? 0),
        0,
      );
      this.ledger.hold(fanout);
    }
    this.ledger.reserve(doc.records.length);
    const stored = freezeGraphData([...accepted, ...doc.records]);
    this.ledger.retain('cache:' + id, stored);
    this.rows.set(id, stored);
    this.observedPins.set(mount.database, checkedPins);
    this.coverage.set(id, nextCoverage);
  }
  async run(pageLimit = 1000): Promise<NativeGraphResult> {
    if (this.started || this.busy)
      throw new Error(
        'A graph session runs once; continuation must name a stage.',
      );
    this.started = true;
    this.busy = true;
    try {
      await verifyNativeGraphPlan(this.plan, this.metadataHttp, this.budget.controller.signal);
      this.budget.check();
      // Coverage keeps a bounded hash of the full immutable executed plan. The
      // complete plan and its exact identity remain retained separately.
      this.ledger.assertBytes(bytes(this.identity) * 2 + 128);
      this.planDigest = await sha256(this.identity);
      this.ledger.retain('plan-digest', this.planDigest);
      this.ledger.assertBytes(bytes(this.providedPlan) * 2 + 2);
      if (graphStableIdentity(this.providedPlan) !== this.identity) throw new Error('The caller graph changed during metadata verification.');
      freezeGraphData(this.providedPlan); locallyVerifiedPlans.add(this.providedPlan);
      for (const id of [
        'organizations',
        'locations',
        'places',
        'countries',
        'admin1',
        ...(this.plan.aliases ? ['aliases'] : []),
      ] as NativeStageId[]) {
        await this.readStage(id, { limit: pageLimit, offset: 0 });
      }
      return await this.materialize();
    } catch (error) {
      if (error instanceof GraphCapacityError)
        return this.stopAtCapacity();
      this.budget.controller.abort(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  /** Exactly one named network action. Local recomputation never drains or cascades another stage. */
  async continueStage(
    id: NativeStageId,
    page: OrdinaryPage,
    expectedPlan = this.identity,
  ): Promise<NativeGraphResult> {
    if (
      !this.started ||
      !this.committedResult ||
      this.busy ||
      this.stopped ||
      expectedPlan !== this.identity ||
      !this.graph.stages.some((s) => s.id === id)
    )
      throw new Error('Graph continuation is unavailable or the plan changed.');
    this.busy = true;
    try {
      await this.readStage(id, page);
      return await this.materialize();
    } catch (error) {
      if (error instanceof GraphCapacityError) {
        this.stopped = error.message;
        this.ledger.rollbackOutput();
        this.lastResult = this.committedResult;
      } else this.budget.controller.abort(error);
      throw error;
    } finally {
      this.busy = false;
    }
  }
  private stopAtCapacity(): NativeGraphResult {
    this.stopped =
      'The native graph exhausted its shared row, candidate or output byte bound. Run a narrower explicit selection.';
    this.ledger.rollbackOutput();
    this.preholdFallback();
    this.ledger.reserve(this.primaryPending, 0, this.primaryPending);
    this.primaryPending = 0;
    const result = this.capacitySnapshot(false);
    this.ledger.output(
      result,
      result.ledger.outputRows,
      result.affiliations.length,
    );
    this.lastResult = freezeGraphData(result);
    return this.lastResult;
  }
  private capacitySnapshot(
    preview: boolean,
    coverage: NativeGraphResult['coverage'] = Object.fromEntries(this.coverage),
  ): NativeGraphResult {
    const affiliations: GraphAffiliation[] = this.affiliations.map((raw) => {
      const value = raw.data['ror_id'],
        projection = nativeProjection('exact-string/1', [value]);
      const observed = preview
        ? 'unsupported-precision'
        : typeof value === 'string' && value !== '' && !validNativeRorUrl(value)
          ? 'invalid'
          : this.singleton('organizations', projection).status;
      const status =
        !preview && observed === 'unattempted' && projection.key
          ? 'incomplete'
          : observed;
      return {
        token: raw.key,
        raw,
        status,
        locations: status === 'matched' ? 'incomplete' : status,
      };
    });
    const entry = {
      inputOccurrences: affiliations.length,
      nativeInputRows: affiliations.length,
      missing: 0,
      null: 0,
      empty: 0,
      invalid: 0,
      unsupportedPrecision: 0,
      eligibleOccurrences: 0,
      distinctRequestedKeys:
        this.coverage.get('organizations')?.keys.length ?? 0,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      incomplete: 0,
      unattempted: 0,
      notRequested: 0,
      childRows: 0,
      multipliedParents: 0,
      evidenceTruncated: true,
    };
    for (const row of affiliations) {
      if (['missing', 'null', 'empty', 'invalid'].includes(row.status))
        entry[row.status as 'missing' | 'null' | 'empty' | 'invalid']++;
      else {
        entry.eligibleOccurrences++;
        if (
          row.status === 'matched' ||
          row.status === 'unmatched' ||
          row.status === 'ambiguous' ||
          row.status === 'incomplete' ||
          row.status === 'unattempted'
        )
          entry[row.status]++;
      }
    }
    if (preview)
      for (const key of Object.keys(entry))
        if (typeof entry[key as keyof typeof entry] === 'number')
          (entry as unknown as Record<string, unknown>)[key] = 1000;
    const result: NativeGraphResult = {
      stopped:
        'The native graph exhausted its shared row, candidate or output byte bound. Run a narrower explicit selection.',
      stageActions: [],
      edges: { entry },
      affiliations,
      locations: [],
      aliases: [],
      native: {},
      recordset: grid(
        ['Affiliation', 'ROR ID', 'Organization lookup', 'Locations'],
        affiliations.map((row) => [
          row.token,
          row.raw.data['ror_id'],
          row.status,
          row.locations,
        ]),
      ),
      relatedRecordsets: [
        {
          id: 'locations',
          label: 'Locations',
          parentSet: 'affiliations',
          parentField: 'Affiliation',
          recordset: grid(['Location', 'Affiliation'], []),
          totalRows: 0,
        },
        {
          id: 'aliases',
          label: 'Alternate names',
          parentSet: 'locations',
          parentField: 'Location',
          recordset: grid(['Alias occurrence', 'Location'], []),
          totalRows: 0,
        },
      ],
      coverage,
      ledger: {
        intermediate: preview ? 5000 : this.ledger.intermediate,
        candidates: preview ? 100000 : this.ledger.candidates,
        outputRows: affiliations.length,
        networkBytes: preview ? 5 * 1024 * 1024 : this.budget.bytes,
      },
      planIdentity: this.identity,
    };
    return result;
  }
  private derive(
    name: string,
    stage: NativeStageId,
    operator: NativeProjection,
    fields: readonly string[],
  ): readonly TokenRow[] {
    const rows =
        stage === 'places'
          ? this.uniqueRows(stage)
          : (this.rows.get(stage) ?? []),
      previous = this.derived.get(name);
    freezeGraphData(rows); freezeGraphData(fields);
    if (previous && previous.operator === operator && previous.fields.length === fields.length && previous.fields.every((field, i) => field === fields[i]) && previous.input.length === rows.length && previous.input.every((row, i) => row === rows[i])) return previous.rows;
    this.ledger.assertBytes(rows.reduce((sum, row) => sum + bytes(fields.map((field) => row.data[field])) * 2 + bytes(this.graph.stages.find((item) => item.id === stage)?.grain.map((field) => row.data[field])) * 2 + 256, 2));
    this.ledger.reserve(rows.length);
    const result = rows
      .map((row) => ({
        row,
        p: nativeProjection(
          operator,
          fields.map((f) => row.data[f]),
        ),
      }))
      .filter((r) => r.p.key !== undefined)
      .map(({ row, p }) => ({
        token: this.token(stage, row),
        lookup: p.key as string,
      }));
    this.ledger.retain('derived:' + name, result);
    this.derived.set(name, { input: rows, operator, fields, rows: freezeGraphData(result) });
    return result;
  }
  private async join(
    name: string,
    left: readonly TokenRow[],
    right: readonly TokenRow[],
    fulfill = 0,
  ): Promise<readonly Link[]> {
    const old = this.joins.get(name);
    if (old?.left === left && old.right === right) return old.rows;
    freezeGraphData(left); freezeGraphData(right);
    const rows = await executeFiniteGraphJoin(
      left,
      right,
      this.ledger,
      fulfill,
    );
    this.ledger.retain('join:' + name, { left, right, rows });
    this.joins.set(name, { left, right, rows: freezeGraphData(rows) });
    return rows;
  }
  private async materialize(): Promise<NativeGraphResult> {
    this.budget.check();
    const tokens = (
      stage: NativeStageId,
      field: string,
      unique = false,
    ): readonly TokenRow[] => {
      const selected = unique ? this.uniqueRows(stage) : (this.rows.get(stage) ?? []);
      const grain = this.graph.stages.find((item) => item.id === stage)?.grain ?? [];
      this.ledger.assertBytes(selected.reduce((sum, row) => sum + bytes([stage, this.plan.stages[stage].nativeSnapshot.sha256, ...grain.map((key) => row.data[key])]) * 2 + bytes(row.data[field]) + 64, 2));
      return selected
        .filter(
          (row) =>
            nativeProjection('exact-string/1', [row.data[field]]).key !==
            undefined,
        )
        .map((row) => ({
          token: this.token(stage, row),
          lookup: row.data[field] as string,
        }));
    };
    const valid = this.affiliations.filter(
      (row) =>
        typeof row.data['ror_id'] === 'string' &&
        validNativeRorUrl(row.data['ror_id']),
    );
    const firstEntry = !this.joins.has('entry');
    const entry = await this.join(
      'entry',
      valid.map((row) => ({
        token: row.key,
        lookup: row.data['ror_id'] as string,
      })),
      tokens('organizations', 'id', true),
      firstEntry ? valid.length : 0,
    );
    if (firstEntry) this.primaryPending -= valid.length;
    if (!this.joins.has('invalid-primary')) {
      this.ledger.reserve(
        this.affiliations.length - valid.length,
        0,
        this.affiliations.length - valid.length,
      );
      this.primaryPending = 0;
      this.joins.set('invalid-primary', freezeGraphData({ left: [], right: [], rows: [] }));
    }
    const orgLocation = await this.join(
      'organization-locations',
      tokens('organizations', 'id', true),
      tokens('locations', 'organization_id'),
    );
    const placeKeys = this.derive(
      'P1',
      'locations',
      'ror-positive-int-geonames-decimal/1',
      ['geonames_id'],
    );
    const places = tokens('places', 'geonameid', true);
    await this.join('location-place', placeKeys, places);
    await this.join(
      'place-country',
      tokens('places', 'country_code', true),
      tokens('countries', 'iso', true),
    );
    const regionKeys = this.derive(
      'P2',
      'places',
      'geonames-country-admin1/1',
      ['country_code', 'admin1_code'],
    );
    await this.join('place-admin1', regionKeys, tokens('admin1', 'code', true));
    let aliasLinks: readonly Link[] = [];
    if (this.plan.aliases)
      aliasLinks = await this.join(
        'place-aliases',
        places,
        tokens('aliases', 'geonameid'),
      );
    const adjacency = (links: readonly Link[]): Map<string, string[]> => {
      const result = new Map<string, string[]>();
      for (const link of links)
        if (link.child !== null && link.child !== undefined) {
          const group = result.get(link.parent) ?? [];
          group.push(link.child);
          result.set(link.parent, group);
        }
      return result;
    };
    const locAdj = adjacency(orgLocation),
      aliasAdj = adjacency(aliasLinks),
      entries = new Map(entry.map((link) => [link.parent, link.child]));
    const nativeRows = new Map<string, BoundedRecord>();
    for (const [stage, rows] of this.rows)
      for (const row of rows) nativeRows.set(this.token(stage, row), row);
    const affiliations: GraphAffiliation[] = [],
      locations: GraphLocation[] = [],
      aliases: GraphAlias[] = [];
    let locationsToAllocate = 0;
    for (const input of this.affiliations) {
      const raw = input.data['ror_id'],
        p = nativeProjection('exact-string/1', [raw]);
      const status =
        typeof raw === 'string' && raw !== '' && !validNativeRorUrl(raw)
          ? 'invalid'
          : this.singleton('organizations', p).status;
      const org =
        status === 'matched'
          ? (entries.get(input.key) ?? undefined)
          : undefined;
      const native = org ? (locAdj.get(org) ?? []) : [];
      locationsToAllocate += native.length;
      affiliations.push({
        token: input.key,
        raw: input,
        status,
        ...(org ? { organization: org } : {}),
        locations: org
          ? this.currentCoverage('locations')?.complete
            ? native.length
              ? 'matched'
              : 'no-locations'
            : 'incomplete'
          : status,
      });
    }
    let aliasesToAllocate = 0;
    for (const affiliation of affiliations)
      for (const native of affiliation.organization
        ? (locAdj.get(affiliation.organization) ?? [])
        : []) {
        const raw = nativeRows.get(native) as BoundedRecord,
          place = this.singleton(
            'places',
            nativeProjection('ror-positive-int-geonames-decimal/1', [
              raw.data['geonames_id'],
            ]),
          );
        if (place.row)
          aliasesToAllocate +=
            aliasAdj.get(this.token('places', place.row))?.length ?? 0;
      }
    this.ledger.assertOutputRows(
      affiliations.length + locationsToAllocate + aliasesToAllocate,
    );
    // First observed locations consumed holds; replacement occurrences incur a fresh debit.
    const held = Math.min(this.ledger.parentHolds, locationsToAllocate);
    this.ledger.reserve(locationsToAllocate, 0, held);
    this.joins.set('location-output', freezeGraphData({ left: [], right: [], rows: [] }));
    for (const affiliation of affiliations)
      for (const native of affiliation.organization
        ? (locAdj.get(affiliation.organization) ?? [])
        : []) {
        this.budget.check();
        const raw = nativeRows.get(native) as BoundedRecord,
          p = nativeProjection('ror-positive-int-geonames-decimal/1', [
            raw.data['geonames_id'],
          ]),
          place = this.singleton('places', p);
        const country = place.row
          ? this.singleton(
              'countries',
              nativeProjection('exact-string/1', [
                place.row.data['country_code'],
              ]),
            )
          : { status: place.status };
        const region = place.row
          ? this.singleton(
              'admin1',
              nativeProjection('geonames-country-admin1/1', [
                place.row.data['country_code'],
                place.row.data['admin1_code'],
              ]),
            )
          : { status: place.status };
        const placeToken = place.row
            ? this.token('places', place.row)
            : undefined,
          children = placeToken ? (aliasAdj.get(placeToken) ?? []) : [];
        const token = graphStableIdentity([
          affiliation.token,
          this.graph.sources.ror.snapshot.sha256,
          raw.data['organization_id'],
          raw.data['ordinal'],
        ]);
        const row: GraphLocation = {
          token,
          affiliation: affiliation.token,
          native,
          organizationStatus: String(
            nativeRows.get(affiliation.organization as string)?.data[
              'status'
            ] ?? '',
          ),
          ...(p.key ? { placeKey: p.key } : {}),
          ...(placeToken ? { place: placeToken } : {}),
          ...(country.row
            ? { country: this.token('countries', country.row) }
            : {}),
          ...(region.row ? { admin1: this.token('admin1', region.row) } : {}),
          referenceEvidence: p1WireEvidence(raw.data['geonames_id']),
          placeStatus: place.status,
          countryStatus: country.status,
          admin1Status: region.status,
          aliasesStatus: !this.plan.aliases
            ? 'not-requested'
            : !place.row
              ? place.status
              : !this.currentCoverage('aliases')?.complete
                ? 'incomplete'
                : children.length
                  ? 'matched'
                  : 'unmatched',
        };
        locations.push(row);
        this.ledger.reserve(children.length);
        for (const child of children)
          aliases.push({
            token: graphStableIdentity([
              token,
              this.graph.sources.geo.snapshot.sha256,
              nativeRows.get(child)?.data['alternate_name_id'],
            ]),
            location: token,
            native: child,
          });
      }
    const inputOrder = new Map(
      this.affiliations.map((row, index) => [row.key, index]),
    );
    locations.sort(
      (a, b) =>
        (inputOrder.get(a.affiliation) as number) -
          (inputOrder.get(b.affiliation) as number) ||
        Number(nativeRows.get(a.native)?.data['ordinal']) -
          Number(nativeRows.get(b.native)?.data['ordinal']),
    );
    const primary = grid(
      [
        'Affiliation',
        'ROR ID',
        'Organization status',
        'Organization lookup',
        'Locations',
      ],
      affiliations.map((a) => [
        a.token,
        a.raw.data['ror_id'],
        a.organization ? nativeRows.get(a.organization)?.data['status'] : null,
        a.status,
        a.locations,
      ]),
    );
    const locationGrid = grid(
      [
        'Location',
        'Affiliation',
        'Ordinal',
        'Organization status',
        'Raw GeoNames ID',
        'Place key',
        'Place',
        'Country',
        'Region (GeoNames admin1)',
        'Place status',
        'Country status',
        'Region status',
        'Alternate names status',
        'Observed JSON kind',
        'Exact reference evidence',
        'Reference reason',
        'Evidence truncated',
      ],
      locations.map((l) => [
        l.token,
        l.affiliation,
        nativeRows.get(l.native)?.data['ordinal'],
        l.organizationStatus,
        nativeRows.get(l.native)?.data['geonames_id'],
        l.placeKey,
        l.place ? nativeRows.get(l.place)?.data['name'] : null,
        l.country ? nativeRows.get(l.country)?.data['country'] : null,
        l.admin1 ? nativeRows.get(l.admin1)?.data['name'] : null,
        l.placeStatus,
        l.countryStatus,
        l.admin1Status,
        l.aliasesStatus,
        l.referenceEvidence.kind,
        l.referenceEvidence.token,
        l.referenceEvidence.reason,
        l.referenceEvidence.truncated,
      ]),
    );
    const aliasFields = [
      ...new Set(
        (this.rows.get('aliases') ?? []).flatMap((r) => Object.keys(r.data)),
      ),
    ].sort();
    const aliasGrid = grid(
      ['Alias occurrence', 'Location', ...aliasFields],
      aliases.map((a) => [
        a.token,
        a.location,
        ...aliasFields.map((f) => nativeRows.get(a.native)?.data[f]),
      ]),
    );
    const relatedRecordsets: GraphRelatedRecordset[] = [
      {
        id: 'locations',
        label: "Locations — each affiliation's organization locations",
        parentSet: 'affiliations',
        parentField: 'Affiliation',
        recordset: locationGrid,
        totalRows: locations.length,
      },
      {
        id: 'aliases',
        label: 'Alternate names — names for each location',
        parentSet: 'locations',
        parentField: 'Location',
        recordset: aliasGrid,
        totalRows: aliases.length,
      },
    ];
    const edges: Record<string, GraphEdgeReport> = {};
    const report = (
      id: string,
      stage: NativeStageId,
      inputs: readonly {
        values: readonly unknown[];
        status: GraphStatus;
        children: number;
      }[],
      projection: NativeProjection,
      nativeInputRows: number,
    ): void => {
      const counts = {
        inputOccurrences: inputs.length,
        nativeInputRows,
        missing: 0,
        null: 0,
        empty: 0,
        invalid: 0,
        unsupportedPrecision: 0,
        eligibleOccurrences: 0,
        distinctRequestedKeys: this.keys(stage).length,
        matched: 0,
        unmatched: 0,
        ambiguous: 0,
        incomplete: 0,
        unattempted: 0,
        notRequested: 0,
        childRows: 0,
        multipliedParents: 0,
        evidenceTruncated:
          (this.coverage.has(stage) &&
            !this.currentCoverage(stage)?.complete) ||
          (stage === 'places' &&
            locations.some((l) => l.referenceEvidence.truncated)),
      };
      for (const input of inputs) {
        const key = nativeProjection(projection, input.values);
        if (
          key.key !== undefined &&
          ![
            'missing',
            'null',
            'empty',
            'invalid',
            'unsupported-precision',
          ].includes(input.status)
        )
          counts.eligibleOccurrences++;
        const status = input.status;
        if (
          status === 'missing' ||
          status === 'null' ||
          status === 'empty' ||
          status === 'invalid'
        )
          counts[status]++;
        else if (status === 'unsupported-precision')
          counts.unsupportedPrecision++;
        else if (status === 'not-requested') counts.notRequested++;
        else if (status === 'no-locations') counts.unmatched++;
        else counts[status]++;
        counts.childRows += input.children;
        if (input.children > 1) counts.multipliedParents++;
      }
      edges[id] = counts;
    };
    report(
      'entry',
      'organizations',
      affiliations.map((a) => ({
        values: [a.raw.data['ror_id']],
        status: a.status,
        children: a.organization ? 1 : 0,
      })),
      'exact-string/1',
      this.affiliations.length,
    );
    report(
      'organization-locations',
      'locations',
      affiliations
        .filter((a) => a.organization)
        .map((a) => ({
          values: [nativeRows.get(a.organization as string)?.data['id']],
          status: a.locations,
          children: locAdj.get(a.organization as string)?.length ?? 0,
        })),
      'exact-string/1',
      this.uniqueRows('organizations').length,
    );
    report(
      'location-place',
      'places',
      locations.map((l) => ({
        values: [nativeRows.get(l.native)?.data['geonames_id']],
        status: l.placeStatus,
        children: l.place ? 1 : 0,
      })),
      'ror-positive-int-geonames-decimal/1',
      (this.rows.get('locations') ?? []).length,
    );
    report(
      'place-country',
      'countries',
      locations.map((l) => ({
        values: [
          l.place ? nativeRows.get(l.place)?.data['country_code'] : undefined,
        ],
        status: l.countryStatus,
        children: l.country ? 1 : 0,
      })),
      'exact-string/1',
      this.uniqueRows('places').length,
    );
    report(
      'place-admin1',
      'admin1',
      locations.map((l) => ({
        values: l.place
          ? [
              nativeRows.get(l.place)?.data['country_code'],
              nativeRows.get(l.place)?.data['admin1_code'],
            ]
          : [],
        status: l.admin1Status,
        children: l.admin1 ? 1 : 0,
      })),
      'geonames-country-admin1/1',
      this.uniqueRows('places').length,
    );
    report(
      'place-aliases',
      'aliases',
      locations.map((l) => ({
        values: [
          l.place ? nativeRows.get(l.place)?.data['geonameid'] : undefined,
        ],
        status: l.aliasesStatus,
        children: l.place ? (aliasAdj.get(l.place)?.length ?? 0) : 0,
      })),
      'exact-string/1',
      this.uniqueRows('places').length,
    );
    const result: NativeGraphResult = {
      stageActions: this.stageActions,
      edges,
      affiliations,
      locations,
      aliases,
      native: Object.fromEntries(this.rows),
      recordset: primary,
      relatedRecordsets,
      coverage: Object.fromEntries(this.coverage),
      ledger: {
        intermediate: this.ledger.intermediate,
        candidates: this.ledger.candidates,
        outputRows: affiliations.length + locations.length + aliases.length,
        networkBytes: this.budget.bytes,
      },
      planIdentity: this.identity,
    };
    const response = nativeGraphResponseEnvelope(
      result,
      this.runtimeReport,
      this.outputQueryId,
      this.outputSource,
    );
    if (this.metadataSizer)
      this.ledger.reserveOutputMetadata(this.metadataSizer(response));
    this.ledger.reserveOutputStorage(graphStorageOverhead(result));
    this.ledger.preflightOutput(result, response);
    this.ledger.output(
      result,
      result.ledger.outputRows,
      affiliations.length + locations.length,
    );
    this.lastResult = freezeGraphData(result);
    return this.lastResult;
  }
}

/** Adapt the finite result to the existing query response; charge its actual serialized transfer shape. */
export function nativeGraphRunResponse(
  execution: NativeGraphExecution,
  output: NativeGraphResult,
  queryId: string,
  source: string,
): RunQueryResponse & {
  readonly relatedRecordsets: readonly GraphRelatedRecordset[];
  readonly nativeGraph: Pick<
    NativeGraphResult,
    | 'coverage'
    | 'edges'
    | 'ledger'
    | 'planIdentity'
    | 'stageActions'
    | 'stopped'
  >;
  readonly runtimeRead: RuntimeReadReport;
  readonly totalRows: number;
} {
  const result = nativeGraphResponseEnvelope(
    output,
    execution.runtimeReport,
    queryId,
    source,
  );
  execution.ledger.output(
    result,
    output.ledger.outputRows,
    output.affiliations.length + output.locations.length,
    'transfer',
  );
  return result;
}

/** Pure envelope for preflight sizing; creates no storage, transport or admission. */
export function nativeGraphResponseEnvelope(
  output: NativeGraphResult,
  runtime: RuntimeReadReport,
  queryId: string,
  source: string,
) {
  return {
    recordset: output.recordset,
    relatedRecordsets: output.relatedRecordsets,
    nativeGraph: {
      stopped: output.stopped,
      stageActions: output.stageActions,
      coverage: output.coverage,
      edges: output.edges,
      ledger: output.ledger,
      planIdentity: output.planIdentity,
    },
    runtimeRead: runtime,
    totalRows: output.affiliations.length,
    limitations: [],
    bindingsApplied: [],
    truncated:
      !!output.stopped ||
      output.stageActions.some((stage) => stage.state !== 'complete' && stage.state !== 'not-requested') ||
      output.locations.some((row) => row.referenceEvidence.truncated) ||
      Object.values(output.coverage).some((stage) => !stage?.complete),
    provenance: {
      source,
      queryId,
      mode: 'live' as const,
      observedAt: new Date().toISOString(),
      executionProfile: 'protected' as const,
    },
  };
}

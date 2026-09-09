// Strict runtime decoders for every server-originated shape in ./types.ts —
// the contract appendix requires "strict runtime decoders (no string/number
// coercion; unknown security-relevant fields rejected)" (plan Task 12, brief
// item 2). Every decoder either returns a fully-typed value or throws
// {@link ContractDecodeError}; none of them coerce a string to a number, drop
// an unrecognized field silently, or accept an object with extra keys on a
// security-relevant shape (Fact, Binding, Scope-bearing requests, TypedValue).
//
// For AI agents: add a decoder here for every new response shape in
// ./types.ts, and a matching fixture + assertion in ./contract.spec.ts.

import {
  AgentCapabilities,
  AgentInfo,
  AgentPrincipal,
  AgentProjectRef,
  ApplicableQueriesResponse,
  Binding,
  BindingOrigin,
  Candidate,
  CandidateAmbiguity,
  CandidateChainStep,
  CandidateState,
  CandidateTarget,
  ErrorBody,
  ErrorEnvelope,
  ExecutionMode,
  ExecutionProfile,
  Fact,
  FactMapping,
  FactOrigin,
  Limitation,
  OriginEvidence,
  PhysicalRef,
  RelatedLookup,
  Result,
  ResultColumn,
  ResultProvenance,
  SemanticColumnMapping,
  SemanticColumnsResponse,
  SemanticProvenance,
  SemanticRelatedResponse,
  TypedValue,
} from './types';

export class ContractDecodeError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ContractDecodeError';
  }
}

function fail(path: string, message: string): never {
  throw new ContractDecodeError(path, message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireObject(v: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(v)) {
    fail(path, `expected an object, got ${v === null ? 'null' : typeof v}`);
  }
  return v as Record<string, unknown>;
}

/** Rejects any key not in `allowed` — the "unknown security-relevant fields rejected" rule. */
function requireExactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) {
    fail(path, `unknown field(s) rejected: ${extra.join(', ')}`);
  }
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    fail(path, `expected a string, got ${typeof v} (no coercion)`);
  }
  return v as string;
}

function requireBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') {
    fail(path, `expected a boolean, got ${typeof v} (no coercion)`);
  }
  return v as boolean;
}

function requireFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(path, `expected a finite number, got ${JSON.stringify(v)} (no coercion)`);
  }
  return v as number;
}

function requireArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) {
    fail(path, `expected an array, got ${typeof v}`);
  }
  return v as unknown[];
}

function requireEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  path: string,
): T {
  const s = requireString(v, path);
  if (!(allowed as readonly string[]).includes(s)) {
    fail(path, `expected one of [${allowed.join(', ')}], got "${s}"`);
  }
  return s as T;
}

function optional<T>(
  v: unknown,
  path: string,
  decode: (value: unknown, path: string) => T,
): T | undefined {
  return v === undefined ? undefined : decode(v, path);
}

const INTEGER_PATTERN = /^-?(0|[1-9]\d*)$/;
const DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isValidCalendarDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// ---- TypedValue ----

export function decodeTypedValue(v: unknown, path = 'value'): TypedValue {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['type', 'value'], path);
  const type = obj['type'];
  switch (type) {
    case 'string':
      return { type: 'string', value: requireString(obj['value'], `${path}.value`) };
    case 'number':
      return {
        type: 'number',
        value: requireFiniteNumber(obj['value'], `${path}.value`),
      };
    case 'integer': {
      const s = requireString(obj['value'], `${path}.value`);
      if (!INTEGER_PATTERN.test(s)) {
        fail(`${path}.value`, `"${s}" is not a canonical decimal integer`);
      }
      return { type: 'integer', value: s };
    }
    case 'decimal': {
      const s = requireString(obj['value'], `${path}.value`);
      if (!DECIMAL_PATTERN.test(s)) {
        fail(`${path}.value`, `"${s}" is not a canonical decimal`);
      }
      return { type: 'decimal', value: s };
    }
    case 'boolean':
      return {
        type: 'boolean',
        value: requireBoolean(obj['value'], `${path}.value`),
      };
    case 'date': {
      const s = requireString(obj['value'], `${path}.value`);
      if (!DATE_PATTERN.test(s) || !isValidCalendarDate(s)) {
        fail(`${path}.value`, `"${s}" is not a valid YYYY-MM-DD calendar date`);
      }
      return { type: 'date', value: s };
    }
    case 'datetime': {
      const s = requireString(obj['value'], `${path}.value`);
      if (!DATETIME_PATTERN.test(s) || Number.isNaN(Date.parse(s))) {
        fail(`${path}.value`, `"${s}" is not RFC3339 normalized to UTC`);
      }
      return { type: 'datetime', value: s };
    }
    case 'null':
      if (obj['value'] !== null) {
        fail(`${path}.value`, `expected null, got ${JSON.stringify(obj['value'])}`);
      }
      return { type: 'null', value: null };
    default:
      return fail(path, `unknown TypedValue type "${String(type)}"`);
  }
}

// ---- Fact / Limitation / Binding ----

const FACT_ORIGINS: readonly FactOrigin[] = ['selection', 'context', 'manual'];
const FACT_MAPPINGS: readonly FactMapping[] = ['declared', 'inferred'];

function decodePhysicalRef(v: unknown, path: string): PhysicalRef {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['source', 'collection', 'column'], path);
  return {
    source: requireString(obj['source'], `${path}.source`),
    collection: requireString(obj['collection'], `${path}.collection`),
    column: requireString(obj['column'], `${path}.column`),
  };
}

export function decodeFact(v: unknown, path = 'fact'): Fact {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    ['id', 'entity', 'field', 'value', 'origin', 'physical', 'mapping', 'enabled'],
    path,
  );
  return {
    id: requireString(obj['id'], `${path}.id`),
    entity: requireString(obj['entity'], `${path}.entity`),
    field: requireString(obj['field'], `${path}.field`),
    value: decodeTypedValue(obj['value'], `${path}.value`),
    origin: requireEnum(obj['origin'], FACT_ORIGINS, `${path}.origin`),
    physical: optional(obj['physical'], `${path}.physical`, decodePhysicalRef),
    mapping: optional(obj['mapping'], `${path}.mapping`, (x, p) =>
      requireEnum(x, FACT_MAPPINGS, p),
    ),
    enabled: requireBoolean(obj['enabled'], `${path}.enabled`),
  };
}

export function decodeLimitation(v: unknown, path = 'limitation'): Limitation {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['policy', 'rowsFiltered', 'hiddenColumns'], path);
  const hiddenColumns = requireArray(obj['hiddenColumns'], `${path}.hiddenColumns`).map(
    (x, i) => requireString(x, `${path}.hiddenColumns[${i}]`),
  );
  return {
    policy: requireString(obj['policy'], `${path}.policy`),
    rowsFiltered: requireBoolean(obj['rowsFiltered'], `${path}.rowsFiltered`),
    hiddenColumns,
  };
}

const BINDING_ORIGINS: readonly BindingOrigin[] = [
  'selection',
  'context',
  'manual',
  'default',
];
const ORIGIN_EVIDENCE: readonly OriginEvidence[] = [
  'server-default',
  'client-reported',
];

export function decodeBinding(v: unknown, path = 'binding'): Binding {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    ['parameterId', 'value', 'origin', 'originEvidence', 'factId'],
    path,
  );
  return {
    parameterId: requireString(obj['parameterId'], `${path}.parameterId`),
    value: decodeTypedValue(obj['value'], `${path}.value`),
    origin: requireEnum(obj['origin'], BINDING_ORIGINS, `${path}.origin`),
    originEvidence: requireEnum(
      obj['originEvidence'],
      ORIGIN_EVIDENCE,
      `${path}.originEvidence`,
    ),
    factId: optional(obj['factId'], `${path}.factId`, requireString),
  };
}

// ---- Result ----

function decodeResultColumn(v: unknown, path: string): ResultColumn {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['name', 'type'], path);
  return {
    name: requireString(obj['name'], `${path}.name`),
    type: requireString(obj['type'], `${path}.type`),
  };
}

const EXECUTION_MODES: readonly ExecutionMode[] = ['live', 'snapshot'];
const EXECUTION_PROFILES: readonly ExecutionProfile[] = [
  'protected',
  'opaque-privileged',
];

function decodeResultProvenance(v: unknown, path: string): ResultProvenance {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    [
      'source',
      'collection',
      'queryId',
      'mode',
      'snapshotId',
      'observedAt',
      'executionProfile',
    ],
    path,
  );
  return {
    source: requireString(obj['source'], `${path}.source`),
    collection: optional(obj['collection'], `${path}.collection`, requireString),
    queryId: optional(obj['queryId'], `${path}.queryId`, requireString),
    mode: requireEnum(obj['mode'], EXECUTION_MODES, `${path}.mode`),
    snapshotId: optional(obj['snapshotId'], `${path}.snapshotId`, requireString),
    observedAt: requireString(obj['observedAt'], `${path}.observedAt`),
    executionProfile: requireEnum(
      obj['executionProfile'],
      EXECUTION_PROFILES,
      `${path}.executionProfile`,
    ),
  };
}

export function decodeResult(v: unknown, path = 'result'): Result {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    ['recordset', 'limitations', 'bindingsApplied', 'provenance', 'truncated'],
    path,
  );
  const recordsetObj = requireObject(obj['recordset'], `${path}.recordset`);
  requireExactKeys(recordsetObj, ['columns', 'rows'], `${path}.recordset`);
  const columns = requireArray(
    recordsetObj['columns'],
    `${path}.recordset.columns`,
  ).map((c, i) => decodeResultColumn(c, `${path}.recordset.columns[${i}]`));
  const rows = requireArray(recordsetObj['rows'], `${path}.recordset.rows`).map(
    (row, i) =>
      requireArray(row, `${path}.recordset.rows[${i}]`).map((cell, j) =>
        decodeTypedValue(cell, `${path}.recordset.rows[${i}][${j}]`),
      ),
  );
  const limitations = requireArray(obj['limitations'], `${path}.limitations`).map(
    (l, i) => decodeLimitation(l, `${path}.limitations[${i}]`),
  );
  const bindingsApplied = requireArray(
    obj['bindingsApplied'],
    `${path}.bindingsApplied`,
  ).map((b, i) => decodeBinding(b, `${path}.bindingsApplied[${i}]`));
  return {
    recordset: { columns, rows },
    limitations,
    bindingsApplied,
    provenance: decodeResultProvenance(obj['provenance'], `${path}.provenance`),
    truncated: requireBoolean(obj['truncated'], `${path}.truncated`),
  };
}

// ---- Candidate ----

function decodeCandidateTarget(v: unknown, path: string): CandidateTarget {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['source', 'label'], path);
  return {
    source: requireString(obj['source'], `${path}.source`),
    label: requireString(obj['label'], `${path}.label`),
  };
}

function decodeChainStep(v: unknown, path: string): CandidateChainStep {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['parameterId', 'factId', 'explanation'], path);
  return {
    parameterId: requireString(obj['parameterId'], `${path}.parameterId`),
    factId: optional(obj['factId'], `${path}.factId`, requireString),
    explanation: requireString(obj['explanation'], `${path}.explanation`),
  };
}

function decodeAmbiguity(v: unknown, path: string): CandidateAmbiguity {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['parameterId', 'factIds'], path);
  return {
    parameterId: requireString(obj['parameterId'], `${path}.parameterId`),
    factIds: requireArray(obj['factIds'], `${path}.factIds`).map((x, i) =>
      requireString(x, `${path}.factIds[${i}]`),
    ),
  };
}

const CANDIDATE_STATES: readonly CandidateState[] = [
  'runnable',
  'needs-input',
  'needs-target',
  'source-unavailable',
];

export function decodeCandidate(v: unknown, path = 'candidate'): Candidate {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    [
      'queryId',
      'targets',
      'selectedSource',
      'bindings',
      'chain',
      'missing',
      'ambiguous',
      'state',
    ],
    path,
  );
  return {
    queryId: requireString(obj['queryId'], `${path}.queryId`),
    targets: requireArray(obj['targets'], `${path}.targets`).map((t, i) =>
      decodeCandidateTarget(t, `${path}.targets[${i}]`),
    ),
    selectedSource: optional(
      obj['selectedSource'],
      `${path}.selectedSource`,
      requireString,
    ),
    bindings: requireArray(obj['bindings'], `${path}.bindings`).map((b, i) =>
      decodeBinding(b, `${path}.bindings[${i}]`),
    ),
    chain: requireArray(obj['chain'], `${path}.chain`).map((c, i) =>
      decodeChainStep(c, `${path}.chain[${i}]`),
    ),
    missing: requireArray(obj['missing'], `${path}.missing`).map((m, i) =>
      requireString(m, `${path}.missing[${i}]`),
    ),
    ambiguous: requireArray(obj['ambiguous'], `${path}.ambiguous`).map((a, i) =>
      decodeAmbiguity(a, `${path}.ambiguous[${i}]`),
    ),
    state: requireEnum(obj['state'], CANDIDATE_STATES, `${path}.state`),
  };
}

// ---- semantic/columns, semantic/related ----

const SEMANTIC_PROVENANCE: readonly SemanticProvenance[] = ['declared', 'inferred'];

function decodeSemanticColumnMapping(
  v: unknown,
  path: string,
): SemanticColumnMapping {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['column', 'entity', 'field', 'provenance'], path);
  return {
    column: requireString(obj['column'], `${path}.column`),
    entity: requireString(obj['entity'], `${path}.entity`),
    field: requireString(obj['field'], `${path}.field`),
    provenance: requireEnum(
      obj['provenance'],
      SEMANTIC_PROVENANCE,
      `${path}.provenance`,
    ),
  };
}

export function decodeSemanticColumnsResponse(
  v: unknown,
  path = 'response',
): SemanticColumnsResponse {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['columns'], path);
  return {
    columns: requireArray(obj['columns'], `${path}.columns`).map((c, i) =>
      decodeSemanticColumnMapping(c, `${path}.columns[${i}]`),
    ),
  };
}

function decodeRelatedLookup(v: unknown, path: string): RelatedLookup {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['lookupId', 'label', 'source', 'collection', 'count'], path);
  const countRaw = obj['count'];
  const count =
    countRaw === null ? null : requireFiniteNumber(countRaw, `${path}.count`);
  return {
    lookupId: requireString(obj['lookupId'], `${path}.lookupId`),
    label: requireString(obj['label'], `${path}.label`),
    source: requireString(obj['source'], `${path}.source`),
    collection: requireString(obj['collection'], `${path}.collection`),
    count,
  };
}

export function decodeSemanticRelatedResponse(
  v: unknown,
  path = 'response',
): SemanticRelatedResponse {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['related', 'truncated'], path);
  return {
    related: requireArray(obj['related'], `${path}.related`).map((r, i) =>
      decodeRelatedLookup(r, `${path}.related[${i}]`),
    ),
    truncated: requireBoolean(obj['truncated'], `${path}.truncated`),
  };
}

export function decodeApplicableQueriesResponse(
  v: unknown,
  path = 'response',
): ApplicableQueriesResponse {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['applicable', 'notYet'], path);
  return {
    applicable: requireArray(obj['applicable'], `${path}.applicable`).map((c, i) =>
      decodeCandidate(c, `${path}.applicable[${i}]`),
    ),
    notYet: requireArray(obj['notYet'], `${path}.notYet`).map((c, i) =>
      decodeCandidate(c, `${path}.notYet[${i}]`),
    ),
  };
}

// ---- agent-info ----

function decodeAgentPrincipal(v: unknown, path: string): AgentPrincipal {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['id', 'roles', 'groups'], path);
  return {
    id: requireString(obj['id'], `${path}.id`),
    roles: requireArray(obj['roles'], `${path}.roles`).map((r, i) =>
      requireString(r, `${path}.roles[${i}]`),
    ),
    groups: requireArray(obj['groups'], `${path}.groups`).map((g, i) =>
      requireString(g, `${path}.groups[${i}]`),
    ),
  };
}

function decodeAgentCapabilities(v: unknown, path: string): AgentCapabilities {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['protectedQueries', 'opaqueReadOnly'], path);
  return {
    protectedQueries: requireBoolean(
      obj['protectedQueries'],
      `${path}.protectedQueries`,
    ),
    opaqueReadOnly: requireBoolean(obj['opaqueReadOnly'], `${path}.opaqueReadOnly`),
  };
}

function decodeAgentProjectRef(v: unknown, path: string): AgentProjectRef {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['id'], path);
  return { id: requireString(obj['id'], `${path}.id`) };
}

export function decodeAgentInfo(v: unknown, path = 'agentInfo'): AgentInfo {
  const obj = requireObject(v, path);
  requireExactKeys(
    obj,
    ['version', 'principal', 'securityContextId', 'projects', 'capabilities'],
    path,
  );
  return {
    version: requireString(obj['version'], `${path}.version`),
    principal: decodeAgentPrincipal(obj['principal'], `${path}.principal`),
    securityContextId: requireString(
      obj['securityContextId'],
      `${path}.securityContextId`,
    ),
    projects: requireArray(obj['projects'], `${path}.projects`).map((p, i) =>
      decodeAgentProjectRef(p, `${path}.projects[${i}]`),
    ),
    capabilities: decodeAgentCapabilities(
      obj['capabilities'],
      `${path}.capabilities`,
    ),
  };
}

// ---- errors ----

export function decodeErrorBody(v: unknown, path = 'error'): ErrorBody {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['code', 'message', 'field', 'requestId', 'targets'], path);
  return {
    code: requireString(obj['code'], `${path}.code`),
    message: requireString(obj['message'], `${path}.message`),
    field: optional(obj['field'], `${path}.field`, requireString),
    requestId: requireString(obj['requestId'], `${path}.requestId`),
    targets: optional(obj['targets'], `${path}.targets`, (arr, p) =>
      requireArray(arr, p).map((t, i) => decodeCandidateTarget(t, `${p}[${i}]`)),
    ),
  };
}

export function decodeErrorEnvelope(v: unknown, path = 'envelope'): ErrorEnvelope {
  const obj = requireObject(v, path);
  requireExactKeys(obj, ['error'], path);
  return { error: decodeErrorBody(obj['error'], `${path}.error`) };
}

/** Best-effort: returns `undefined` instead of throwing, for call sites (HTTP error
 * handlers) that must not blow up when the body isn't a valid ErrorEnvelope at all
 * (e.g. a proxy's HTML error page). */
export function tryDecodeErrorEnvelope(v: unknown): ErrorEnvelope | undefined {
  try {
    return decodeErrorEnvelope(v);
  } catch {
    return undefined;
  }
}

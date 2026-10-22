import { readRetainedComparison, comparisonSelectedMember, sameComparisonValue, type RetainedComparison } from './retained-comparison-contract';
import { frozenComparison } from './retained-comparison-contract';
import type { IQueryDef } from '../models/definition/query-def';
import {
  readOriginalEvidence,
  type OriginalEvidence,
} from './original-evidence-contract';
import {
  decodeEvidenceArtifactRef,
  decodeResult,
  decodeTypedValue,
  evidenceObject,
  evidenceText,
  sameExecution,
  verifyRowEvidence,
  type ArtifactRef,
  type ExecutionRef,
  type Result,
  type RowEvidenceSelector,
  type TypedValue,
} from '@sneat/datatug-semantic';
import { CheckRun } from '../detective/models';
import {
  RetainedEvidenceScope,
  RetainedSourcePin,
  readRetainedSourcePin,
} from './retained-evidence-contract';
const obj = evidenceObject,
  txt = evidenceText;
const integer = (value: unknown, min = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new Error('Invalid retained revision or count.');
  return value;
};
const array = (value: unknown): readonly unknown[] => {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 4096)
    throw new Error('Invalid retained list.');
  return value;
};
const digest = (value: unknown): string => {
  const text = txt(value);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error('Invalid retained digest.');
  return text;
};
const exact = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
export interface RetainedManifestView {
  readonly ref: string;
  readonly actorId: string;
  readonly incidentRef: string;
  readonly sessionId: string;
  readonly databaseId: string;
  readonly projectId: string;
  readonly bagId: string;
  readonly entryId: string;
  readonly revisionId: string;
  readonly identityDomain: string;
  readonly environment: string;
  readonly inputs: Readonly<Record<string, TypedValue>>;
  readonly auditSHA256: string;
}
export interface RetainedOpenScope extends RetainedEvidenceScope {
  /** Current server-admitted private namespace. The hosted route project is
   * public routing identity; databaseId is the mounted native store identity. */
  readonly nativeDatabaseId: string;
  readonly nativeProjectId: string;
}
export interface RetainedExecutionView {
  readonly comparison?: RetainedComparison;
  readonly originalEvidence?: OriginalEvidence;
  readonly result: Result;
  readonly inputs: Readonly<Record<string, TypedValue>>;
  readonly sourcePin: RetainedSourcePin;
  readonly manifest: RetainedManifestView;
  readonly appliedManifestRef: string;
  readonly queryRevision: string;
  readonly queryId: string;
  readonly queryTitle: string;
}
export interface RetainedCheckView {
  readonly run: CheckRun;
  readonly sourcePin: RetainedSourcePin;
  readonly manifest: RetainedManifestView;
  readonly results: readonly RetainedExecutionView[];
}
export function readSelectedManifest(
  value: unknown,
  expected: Pick<
    RetainedOpenScope,
    'environment' | 'nativeDatabaseId' | 'nativeProjectId'
  >,
): RetainedManifestView {
  const wire = obj(value, [
    'version',
    'ref',
    'actorId',
    'incidentRef',
    'caseId',
    'caseVersion',
    'session',
    'contextSet',
    'scope',
    'bag',
    'entries',
    'inputs',
    'auditSHA256',
  ]);
  if (wire['version'] !== 1) throw new Error('Unsupported selected manifest.');
  const scope = obj(wire['scope'], ['environmentId', 'identityDomain']);
  if (scope['environmentId'] !== expected.environment)
    throw new Error('Manifest environment mismatch.');
  const domain = txt(scope['identityDomain']);
  const session = obj(wire['session'], [
    'id',
    'databaseId',
    'projectId',
    'owner',
    'state',
    'version',
    'contextSetId',
    'nativeFenceGeneration',
  ]);
  const actor = txt(wire['actorId']);
  if (
    session['owner'] !== actor ||
    session['state'] !== 'active' ||
    session['databaseId'] !== expected.nativeDatabaseId ||
    session['projectId'] !== expected.nativeProjectId
  )
    throw new Error('Invalid selected Session audit.');
  for (const key of ['id', 'databaseId', 'projectId', 'contextSetId'])
    txt(session[key]);
  integer(session['version'], 1);
  integer(session['nativeFenceGeneration']);
  if (wire['caseId'] !== undefined) {
    txt(wire['caseId']);
    integer(wire['caseVersion'], 1);
  } else if (wire['caseVersion'] !== undefined)
    throw new Error('Invalid Case audit.');
  const set = obj(wire['contextSet'], ['id', 'sessionId', 'enabled', 'slots']);
  if (
    set['id'] !== session['contextSetId'] ||
    set['sessionId'] !== session['id'] ||
    set['enabled'] !== true
  )
    throw new Error('Selected context is not enabled.');
  const bag = obj(wire['bag'], [
    'id',
    'sessionId',
    'scope',
    'version',
    'clearVersion',
    'entries',
  ]);
  if (bag['sessionId'] !== session['id'] || !exact(bag['scope'], scope))
    throw new Error('Selected Bag scope mismatch.');
  integer(bag['version'], 1);
  integer(bag['clearVersion']);
  const entries = array(wire['entries']);
  if (entries.length !== 1)
    throw new Error('Expected one selected scalar entry.');
  const entry = obj(entries[0], ['entryId', 'revisionId']);
  txt(entry['entryId']);
  txt(entry['revisionId']);
  if (!exact(bag['entries'], entries))
    throw new Error('Selected Bag revision mismatch.');
  const slots = array(set['slots']);
  if (slots.length !== 1)
    throw new Error('Expected one selected applied slot.');
  const slot = obj(slots[0], [
    'scope',
    'bagId',
    'bagVersion',
    'version',
    'entries',
  ]);
  if (
    !exact(slot['scope'], scope) ||
    slot['bagId'] !== bag['id'] ||
    slot['bagVersion'] !== bag['version'] ||
    !exact(slot['entries'], entries)
  )
    throw new Error('Selected applied revision mismatch.');
  integer(slot['version'], 1);
  const inputs = readSelectedInputs(wire['inputs']);
  return {
    ref: txt(wire['ref']),
    actorId: actor,
    incidentRef: txt(wire['incidentRef']),
    sessionId: txt(session['id']),
    databaseId: txt(session['databaseId']),
    projectId: txt(session['projectId']),
    bagId: txt(bag['id']),
    entryId: txt(entry['entryId']),
    revisionId: txt(entry['revisionId']),
    identityDomain: domain,
    environment: expected.environment,
    inputs,
    auditSHA256: digest(wire['auditSHA256']),
  };
}
export function readSelectedInputs(
  value: unknown,
): Readonly<Record<string, TypedValue>> {
  const wire = obj(value);
  const inputs: Record<string, TypedValue> = {};
  for (const [key, raw] of Object.entries(wire)) {
    txt(key);
    inputs[key] = decodeTypedValue(raw);
  }
  return inputs;
}
export async function readRetainedExecution(
  value: unknown,
  scope: RetainedOpenScope,
  expected?: ExecutionRef,
  selected?: RowEvidenceSelector,
): Promise<RetainedExecutionView> {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 512 * 1024)
    throw new Error('Retained response exceeds its read bound.');
  const wire = obj(value, [
    'comparison',
    'inputs',
    'manifest',
    'savedQuery',
    'actorId',
    'result',
    'sourcePin',
    'appliedManifestRef',
    'queryRevision',
    'evidence',
    'originalEvidence',
  ]);
  const result = decodeResult(wire['result']);
  if (
    !result.execution ||
    result.execution.storeId !== scope.projectRef.storeId ||
    result.execution.projectId !== scope.projectRef.projectId ||
    (expected && !sameExecution(result.execution, expected))
  )
    throw new Error('Retained execution scope mismatch.');
  if (scope.nativeProjectId !== scope.projectRef.projectId)
    throw new Error('Current retained namespace does not match the project.');
  const pin = readRetainedSourcePin(wire['sourcePin'], scope),
    manifest = readSelectedManifest(wire['manifest'], scope);
  if (wire['actorId'] !== manifest.actorId)
    throw new Error(
      'Retained execution actor does not match its immutable manifest.',
    );
  if (wire['appliedManifestRef'] !== manifest.ref)
    throw new Error('Selected manifest receipt mismatch.');
  const query = obj(wire['savedQuery']);
  const folder = txt(query['folderPath']),
    leaf = txt(query['id']);
  decodeEvidenceArtifactRef({
    kind: 'query',
    artifact: {
      storeId: scope.projectRef.storeId,
      projectId: scope.projectRef.projectId,
      environment: scope.environment,
      id: leaf,
      ...(folder === '~' ? {} : { folder }),
    },
  });
  const queryId = folder === '~' ? leaf : `${folder}/${leaf}`;
  if (queryId !== result.provenance.queryId)
    throw new Error('Retained saved query mismatch.');
  const inputs = readSelectedInputs(wire['inputs']);
  if (
    Object.entries(manifest.inputs).some(
      ([name, value]) => !exact(inputs[name], value),
    )
  )
    throw new Error('Retained selected input mismatch.');
  const declaration = frozenComparison(query as unknown as IQueryDef, inputs);
  if (declaration) {
    if (Object.keys(manifest.inputs).length !== 1 || !manifest.inputs['order_id']) throw new Error('Comparison primary manifest is unavailable.');
  }
  if (!declaration && wire['comparison'] !== undefined) throw new Error('Unexpected retained comparison.');
  const comparison = readRetainedComparison(wire['comparison'], {
    queryId, queryRevision: txt(wire['queryRevision']), manifestRef: manifest.ref, result, declaration, inputs, primary: manifest.inputs['order_id'],
  });
  if (result.rowEvidence) {
    const sidecar = await verifyRowEvidence(result.rowEvidence, result);
    if (
      sidecar.scope.storeId !== scope.projectRef.storeId ||
      sidecar.scope.spaceID !== pin.spaceID ||
      sidecar.scope.projectId !== pin.projectId ||
      sidecar.scope.environment !== pin.environment ||
      sidecar.source.id !== pin.sourceId ||
      sidecar.source.generation !== pin.revision.generation
    )
      throw new Error('Retained sidecar source mismatch.');
  }
  if (selected && wire['originalEvidence'] === undefined)
    throw new Error(
      'Original evidence status is missing from the row response.',
    );
  const originalEvidence =
    wire['originalEvidence'] === undefined
      ? undefined
      : await readOriginalEvidence(
          wire['originalEvidence'],
          result,
          pin,
          selected,
        );
  if (
    originalEvidence?.status === 'available' &&
    !sameComparisonValue(
      originalEvidence.records[2].fields['order_id'],
      comparison ? comparisonSelectedMember(comparison, result, originalEvidence.selection) : manifest.inputs['order_id'],
    )
  )
    throw new Error('Original order does not match the admitted manifest.');
  return {
    ...(comparison ? { comparison } : {}),
    ...(originalEvidence ? { originalEvidence } : {}),
    result,
    inputs,
    sourcePin: pin,
    manifest,
    appliedManifestRef: manifest.ref,
    queryRevision: txt(wire['queryRevision']),
    queryId,
    queryTitle:
      typeof query['title'] === 'string' ? query['title'] : txt(query['id']),
  };
}
function binding(value: unknown): void {
  const wire = obj(value, ['input', 'fromInput', 'part', 'fromColumn']);
  txt(wire['input']);
  for (const key of ['fromInput', 'fromColumn'])
    if (wire[key] !== undefined) txt(wire[key]);
  if (
    wire['part'] !== undefined &&
    !['start', 'end'].includes(String(wire['part']))
  )
    throw new Error('Unsupported binding part.');
}
function validator(value: unknown): void {
  const wire = obj(value, [
    'id',
    'validatorId',
    'scope',
    'kind',
    'severity',
    'field',
    'otherField',
    'expected',
    'checkId',
    'bindings',
    'onUnavailable',
  ]);
  txt(wire['id']);
  if (
    !['row', 'set'].includes(String(wire['scope'])) ||
    ![
      'non-null',
      'equals-fields',
      'row-count',
      'unique',
      'sum-equals',
      'check',
    ].includes(String(wire['kind'])) ||
    !['critical', 'error', 'warning', 'info'].includes(String(wire['severity']))
  )
    throw new Error('Unsupported retained validator.');
  if (wire['expected'] !== undefined) decodeTypedValue(wire['expected']);
  for (const key of ['validatorId', 'field', 'otherField', 'checkId'])
    if (wire[key] !== undefined) txt(wire[key]);
  if (wire['bindings'] !== undefined) array(wire['bindings']).forEach(binding);
}
function definition(value: unknown): void {
  const wire = obj(value, [
    'id',
    'title',
    'description',
    'version',
    'inputs',
    'steps',
    'updatedAt',
    'updatedBy',
  ]);
  txt(wire['id']);
  txt(wire['title']);
  integer(wire['version'], 1);
  for (const raw of array(wire['inputs'])) {
    const item = obj(raw, ['name', 'type', 'cardinality', 'required']);
    txt(item['name']);
    if (
      !['scalar', 'set', 'range'].includes(String(item['cardinality'])) ||
      ![
        'string',
        'integer',
        'decimal',
        'number',
        'boolean',
        'null',
        'date',
        'datetime',
      ].includes(String(item['type'])) ||
      (item['required'] !== undefined && typeof item['required'] !== 'boolean')
    )
      throw new Error('Invalid retained input schema.');
  }
  for (const raw of array(wire['steps'])) {
    const step = obj(raw, [
      'id',
      'kind',
      'queryId',
      'checkId',
      'bindings',
      'validators',
      'onUnavailable',
    ]);
    txt(step['id']);
    if (!['query', 'check'].includes(String(step['kind'])))
      throw new Error('Invalid retained Check step.');
    if (step['bindings'] !== undefined)
      array(step['bindings']).forEach(binding);
    if (step['validators'] !== undefined)
      array(step['validators']).forEach(validator);
  }
}
export async function readRetainedCheck(
  value: unknown,
  scope: RetainedOpenScope,
  ref: Extract<ArtifactRef, { kind: 'check-run' }>['checkRun'],
): Promise<RetainedCheckView> {
  const wire = obj(value, ['run', 'sourcePin', 'manifest', 'results']);
  const run = obj(wire['run'], [
    'id',
    'kind',
    'checkId',
    'queryId',
    'definition',
    'dependencies',
    'publishedValidators',
    'queryValidators',
    'caseId',
    'environment',
    'inputNames',
    'inputReference',
    'executionStatus',
    'outcome',
    'severity',
    'steps',
    'startedAt',
    'durationMs',
    'actor',
    'checkInvocations',
    'queryExecutions',
  ]);
  const actual = decodeEvidenceArtifactRef({
    kind: 'check-run',
    checkRun: { ...ref, runId: run['id'], checkId: run['checkId'] },
  });
  if (
    actual.kind !== 'check-run' ||
    run['id'] !== ref.runId ||
    run['checkId'] !== ref.checkId ||
    run['environment'] !== ref.environment ||
    run['kind'] !== 'check' ||
    run['executionStatus'] !== 'completed' ||
    !['pass', 'fail', 'unknown'].includes(String(run['outcome']))
  )
    throw new Error('Retained Check identity mismatch.');
  definition(run['definition']);
  const def = obj(run['definition']);
  if (def['id'] !== ref.checkId || def['version'] !== ref.checkVersion)
    throw new Error('Retained Check version mismatch.');
  array(run['dependencies']).forEach(definition);
  for (const raw of array(run['publishedValidators'])) {
    const published = obj(raw, ['id', 'title', 'version', 'validator']);
    txt(published['id']);
    txt(published['title']);
    integer(published['version'], 1);
    validator(published['validator']);
  }
  for (const raw of array(run['queryValidators'])) {
    const local = obj(raw, ['queryId', 'version', 'validators']);
    txt(local['queryId']);
    integer(local['version'], 1);
    array(local['validators']).forEach(validator);
  }
  txt(run['actor']);
  txt(run['startedAt']);
  integer(run['durationMs']);
  integer(run['checkInvocations']);
  integer(run['queryExecutions']);
  array(run['inputNames']).forEach(txt);
  const executions: Record<string, unknown>[] = [];
  let count = 0;
  const steps = (values: unknown, depth = 0): void => {
    if (depth > 16)
      throw new Error('Retained Check nesting exceeds the limit.');
    for (const raw of array(values)) {
      if (++count > 4096) throw new Error('Retained Check exceeds the limit.');
      const step = obj(raw, [
        'stepId',
        'kind',
        'queryId',
        'queryRevision',
        'resultFingerprint',
        'source',
        'observedAt',
        'executionProfile',
        'execution',
        'errorCode',
        'durationMs',
        'checkId',
        'executionStatus',
        'outcome',
        'evidenceOutcome',
        'onUnavailable',
        'disposition',
        'limitations',
        'severity',
        'rowCount',
        'message',
        'validators',
        'children',
      ]);
      txt(step['stepId']);
      txt(step['kind']);
      txt(step['executionStatus']);
      if (!['pass', 'fail', 'unknown'].includes(String(step['outcome'])))
        throw new Error('Invalid retained step outcome.');
      if (step['execution'] !== undefined) {
        const execution = decodeEvidenceArtifactRef({
          kind: 'execution',
          execution: step['execution'],
        });
        if (execution.kind !== 'execution' || step['kind'] !== 'query')
          throw new Error('Invalid retained node execution.');
        executions.push(step);
      }
      if (step['children'] !== undefined) steps(step['children'], depth + 1);
      for (const rawValidator of step['validators'] === undefined
        ? []
        : array(step['validators'])) {
        const result = obj(rawValidator, [
          'validatorId',
          'executionStatus',
          'outcome',
          'evidenceOutcome',
          'onUnavailable',
          'disposition',
          'severity',
          'rowIndex',
          'message',
          'children',
        ]);
        txt(result['validatorId']);
        txt(result['executionStatus']);
        if (!['pass', 'fail', 'unknown'].includes(String(result['outcome'])))
          throw new Error('Invalid validator result.');
        if (result['children'] !== undefined)
          steps(result['children'], depth + 1);
      }
    }
  };
  steps(run['steps']);
  if (scope.nativeProjectId !== scope.projectRef.projectId)
    throw new Error('Current retained namespace does not match the project.');
  const pin = readRetainedSourcePin(wire['sourcePin'], scope),
    manifest = readSelectedManifest(wire['manifest'], scope),
    results: RetainedExecutionView[] = [];
  if (run['actor'] !== manifest.actorId)
    throw new Error('Retained Check actor mismatch.');
  const seen = new Set<string>();
  for (const raw of array(wire['results'])) {
    const node = obj(raw, [
      'inputs',
      'savedQuery',
      'queryId',
      'queryRevision',
      'resultFingerprint',
      'result',
    ]);
    const result = decodeResult(node['result']);
    const id = result.execution?.executionId;
    const step = executions.find(
      (item) => (item['execution'] as ExecutionRef).executionId === id,
    );
    if (
      !id ||
      seen.has(id) ||
      !step ||
      step['queryId'] !== node['queryId'] ||
      step['queryRevision'] !== node['queryRevision'] ||
      step['resultFingerprint'] !== node['resultFingerprint']
    )
      throw new Error('Retained node proof mismatch.');
    seen.add(id);
    digest(node['resultFingerprint']);
    results.push(
      await readRetainedExecution(
        {
          inputs: node['inputs'],
          savedQuery: node['savedQuery'],
          result,
          actorId: run['actor'],
          sourcePin: pin,
          manifest: wire['manifest'],
          appliedManifestRef: manifest.ref,
          queryRevision: node['queryRevision'],
        },
        scope,
        step['execution'] as ExecutionRef,
      ),
    );
  }
  if (
    results.length !== integer(run['queryExecutions']) ||
    executions.length !== results.length ||
    !results.length
  )
    throw new Error('Retained node results are incomplete.');
  const normalized = structuredClone(run);
  for (const key of [
    'dependencies',
    'publishedValidators',
    'queryValidators',
    'inputNames',
    'steps',
  ])
    normalized[key] = array(normalized[key]);
  const normalizeSteps = (values: unknown): unknown[] =>
    array(values).map((raw) => {
      const step = obj(raw);
      step['validators'] =
        step['validators'] === undefined ? [] : array(step['validators']);
      if (step['children'] !== undefined)
        step['children'] = normalizeSteps(step['children']);
      return step;
    });
  normalized['steps'] = normalizeSteps(normalized['steps']);
  return {
    run: normalized as unknown as CheckRun,
    sourcePin: pin,
    manifest,
    results,
  };
}

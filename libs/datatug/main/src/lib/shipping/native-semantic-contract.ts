import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import { AppliedEvidenceRequest } from '../evidence/applied-evidence';

export const nativeID = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const nativeToken = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const entityRevision = (v: unknown): v is string =>
  typeof v === 'string' && /^entity1-[a-f0-9]{64}$/.test(v);
export function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Native response is unavailable.');
  return v as Record<string, unknown>;
}
export function exact(v: unknown, required: string[], optional: string[] = []) {
  const o = object(v);
  if (
    required.some((k) => !Object.hasOwn(o, k)) ||
    Object.keys(o).some((k) => !required.includes(k) && !optional.includes(k))
  )
    throw new Error('Native response shape is unavailable.');
  return o;
}
export function text(v: unknown): string {
  if (typeof v !== 'string' || v.length > 4096)
    throw new Error('Native text is unavailable.');
  return v;
}
function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length > 1000)
    throw new Error('Native list is unavailable.');
  return v;
}
function positive(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 1)
    throw new Error('Native revision is unavailable.');
  return v as number;
}
export interface NativeColumn {
  name: string;
  type: string;
  nullable: boolean;
}
export interface NativeCollection {
  name: string;
  kind: string;
  columns: NativeColumn[];
  primaryKey?: { columns: string[] };
  foreignKeys: {
    columns: string[];
    collection: string;
    referencedColumns: string[];
  }[];
}
export interface NativeSchema {
  schemaToken: string;
  source: {
    sourceId: string;
    environment: string;
    generation: string;
    revision: number;
    sha256: string;
    bindingRevision: number;
    schemaSHA256: string;
  };
  collections: NativeCollection[];
}
export interface NativeRows {
  schemaToken: string;
  collection: string;
  columns: NativeColumn[];
  rows: { rowToken: string; cells: TypedValue[] }[];
  truncated: boolean;
}
export interface NativeScope {
  spaceID: string;
  projectId: string;
  environment: string;
  sourceId: 'shipping-working-copy';
  evidence: AppliedEvidenceRequest;
}
export interface NativeSelection {
  schemaToken: string;
  collection: string;
  rowToken: string;
  column: string;
}
export interface NativeRequest extends NativeScope {
  selection: NativeSelection;
}
export interface NativeMapping extends NativeRequest {
  operationId: string;
  entityId: string;
  fieldId: string;
  ifMatch: string;
}
export interface NativeResolution {
  column: string;
  value: TypedValue;
  entity?: string;
  field?: string;
  provenance?: 'declared' | 'inferred';
  rule?: string;
}
export interface NativeLookup {
  sourceId: string;
  collection: string;
  column: string;
  kind: 'sameField' | 'foreignKey' | 'referencedBy';
  via: string;
}
export interface NativeRelated {
  selection: NativeSelection;
  lookups: NativeLookup[];
  unsupported: string[];
}
export interface CanonicalEntity {
  id: string;
  title?: string;
  fields: {
    id: string;
    type: string;
    mappings?: { source: string; collection: string; column: string }[];
  }[];
}
export interface EntitySnapshot {
  entity: CanonicalEntity;
  revision?: string;
  revisionError?: string;
}
export function decodeEntity(v: unknown): CanonicalEntity {
  const o = object(v);
  if (!nativeID(o['id']))
    throw new Error('Canonical entity identity is unavailable.');
  const fields = list(o['fields'] ?? []).map((item) => {
    const f = object(item);
    if (!nativeID(f['id']))
      throw new Error('Canonical field identity is unavailable.');
    const mappings = list(f['mappings'] ?? []).map((m) => {
      const p = exact(m, ['source', 'collection', 'column']);
      return {
        source: text(p['source']),
        collection: text(p['collection']),
        column: text(p['column']),
      };
    });
    return { id: f['id'], type: text(f['type']), mappings };
  });
  if (new Set(fields.map((f) => f.id)).size !== fields.length)
    throw new Error('Canonical fields are ambiguous.');
  return {
    id: o['id'],
    ...(o['title'] !== undefined ? { title: text(o['title']) } : {}),
    fields,
  };
}
function columns(v: unknown): NativeColumn[] {
  const out = list(v).map((item) => {
    const c = exact(item, ['name', 'type', 'nullable']);
    if (typeof c['nullable'] !== 'boolean')
      throw new Error('Column shape is unavailable.');
    return {
      name: text(c['name']),
      type: text(c['type']),
      nullable: c['nullable'],
    };
  });
  if (!out.length || new Set(out.map((c) => c.name)).size !== out.length)
    throw new Error('Column identity is unavailable.');
  return out;
}
export function decodeSchema(v: unknown): NativeSchema {
  const o = exact(v, ['schemaToken', 'source', 'collections']),
    s = exact(o['source'], [
      'sourceId',
      'environment',
      'generation',
      'revision',
      'sha256',
      'bindingRevision',
      'schemaSHA256',
    ]);
  if (
    !nativeToken(o['schemaToken']) ||
    !nativeToken(s['sha256']) ||
    !nativeToken(s['schemaSHA256']) ||
    s['sourceId'] !== 'shipping-working-copy' ||
    !nativeID(s['environment']) ||
    !nativeID(s['generation'])
  )
    throw new Error('Source observation is unavailable.');
  const collections = list(o['collections']).map((item) => {
    const c = exact(
      item,
      ['name', 'kind', 'columns', 'foreignKeys'],
      ['primaryKey'],
    );
    const key =
      c['primaryKey'] === undefined
        ? undefined
        : {
            columns: list(exact(c['primaryKey'], ['columns'])['columns']).map(
              text,
            ),
          };
    return {
      name: text(c['name']),
      kind: text(c['kind']),
      columns: columns(c['columns']),
      ...(key ? { primaryKey: key } : {}),
      foreignKeys: list(c['foreignKeys']).map((item) => {
        const f = exact(item, ['columns', 'collection', 'referencedColumns']);
        return {
          columns: list(f['columns']).map(text),
          collection: text(f['collection']),
          referencedColumns: list(f['referencedColumns']).map(text),
        };
      }),
    };
  });
  if (new Set(collections.map((c) => c.name)).size !== collections.length)
    throw new Error('Table identity is ambiguous.');
  return {
    schemaToken: o['schemaToken'],
    source: {
      sourceId: s['sourceId'],
      environment: s['environment'],
      generation: s['generation'],
      revision: positive(s['revision']),
      sha256: s['sha256'],
      bindingRevision: positive(s['bindingRevision']),
      schemaSHA256: s['schemaSHA256'],
    },
    collections,
  };
}
export function decodeRows(v: unknown): NativeRows {
  const o = exact(v, [
    'schemaToken',
    'collection',
    'columns',
    'rows',
    'truncated',
  ]);
  if (!nativeToken(o['schemaToken']) || typeof o['truncated'] !== 'boolean')
    throw new Error('Rows are unavailable.');
  const cols = columns(o['columns']);
  const rows = list(o['rows']).map((item) => {
    const r = exact(item, ['rowToken', 'cells']);
    if (!nativeToken(r['rowToken']))
      throw new Error('Row identity is unavailable.');
    const cells = list(r['cells']).map((v) => decodeTypedValue(v));
    if (cells.length !== cols.length)
      throw new Error('Row width is unavailable.');
    return { rowToken: r['rowToken'], cells };
  });
  return {
    schemaToken: o['schemaToken'],
    collection: text(o['collection']),
    columns: cols,
    rows,
    truncated: o['truncated'],
  };
}
export function validateSelection(v: unknown): NativeSelection {
  const s = exact(v, ['schemaToken', 'collection', 'rowToken', 'column']);
  if (
    !nativeToken(s['schemaToken']) ||
    !nativeToken(s['rowToken']) ||
    !['requests', 'current_routes'].includes(text(s['collection'])) ||
    !text(s['column'])
  )
    throw new Error('Physical selection is unavailable.');
  return s as unknown as NativeSelection;
}
export function validateScope(v: unknown): NativeScope {
  const s = object(v);
  if (
    !nativeID(s['spaceID']) ||
    !nativeID(s['projectId']) ||
    !nativeID(s['environment']) ||
    s['sourceId'] !== 'shipping-working-copy'
  )
    throw new Error('Native scope is unavailable.');
  const e = exact(
    s['evidence'],
    ['retention', 'incidentRef', 'context'],
    ['caseId'],
  );
  if (
    e['retention'] !== 'project-pinned' ||
    !/^[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}$/.test(
      text(e['incidentRef']),
    ) ||
    (e['caseId'] !== undefined && !nativeID(e['caseId']))
  )
    throw new Error('Incident context is unavailable.');
  const c = exact(e['context'], [
    'sessionId',
    'expectedSessionVersion',
    'expectedContextSetId',
    'scope',
    'bindings',
  ]);
  if (!nativeID(c['sessionId']) || !nativeID(c['expectedContextSetId']))
    throw new Error('Session identity is unavailable.');
  positive(c['expectedSessionVersion']);
  const scope = exact(c['scope'], ['environmentId', 'identityDomain']);
  if (
    scope['environmentId'] !== s['environment'] ||
    !text(scope['identityDomain'])
  )
    throw new Error('Applied environment differs.');
  const bindings = list(c['bindings']);
  if (bindings.length !== 1)
    throw new Error('Choose one applied scalar order.');
  const b = exact(bindings[0], ['inputName', 'entryId', 'revisionId']);
  if (
    b['inputName'] !== 'order_id' ||
    !nativeID(b['entryId']) ||
    !nativeID(b['revisionId'])
  )
    throw new Error('Applied order is unavailable.');
  return s as unknown as NativeScope;
}
export function validateMapping(v: unknown): NativeMapping {
  const o = exact(v, [
    'spaceID',
    'projectId',
    'environment',
    'sourceId',
    'evidence',
    'selection',
    'operationId',
    'entityId',
    'fieldId',
    'ifMatch',
  ]);
  validateScope(o);
  validateSelection(o['selection']);
  if (
    !nativeID(o['operationId']) ||
    !nativeID(o['entityId']) ||
    !nativeID(o['fieldId']) ||
    !entityRevision(o['ifMatch']) ||
    new TextEncoder().encode(JSON.stringify(o)).length > 16384
  )
    throw new Error('Mapping operation is unavailable.');
  return o as unknown as NativeMapping;
}
export function decodeResolution(v: unknown): NativeResolution {
  const o = exact(
    v,
    ['column', 'value'],
    ['entity', 'field', 'provenance', 'rule'],
  );
  if (
    (o['entity'] === undefined) !== (o['field'] === undefined) ||
    (o['entity'] !== undefined &&
      (!nativeID(o['entity']) ||
        !nativeID(o['field']) ||
        !['declared', 'inferred'].includes(text(o['provenance']))))
  )
    throw new Error('Resolved identity is unavailable.');
  return {
    column: text(o['column']),
    value: decodeTypedValue(o['value']),
    ...(o['entity'] !== undefined
      ? {
          entity: o['entity'] as string,
          field: o['field'] as string,
          provenance: o['provenance'] as 'declared' | 'inferred',
        }
      : {}),
    ...(o['rule'] !== undefined ? { rule: text(o['rule']) } : {}),
  };
}
export function decodeRelated(v: unknown): NativeRelated {
  const o = exact(v, ['selection', 'lookups', 'unsupported']);
  return {
    selection: validateSelection(o['selection']),
    unsupported: list(o['unsupported']).map(text),
    lookups: list(o['lookups']).map((item) => {
      const l = exact(item, [
        'sourceId',
        'collection',
        'column',
        'kind',
        'via',
      ]);
      if (
        l['sourceId'] !== 'shipping-working-copy' ||
        !['sameField', 'foreignKey', 'referencedBy'].includes(text(l['kind']))
      )
        throw new Error('Related offer is unavailable.');
      return {
        sourceId: l['sourceId'],
        collection: text(l['collection']),
        column: text(l['column']),
        kind: l['kind'] as NativeLookup['kind'],
        via: text(l['via']),
      };
    }),
  };
}
export async function intentDigest(request: NativeMapping): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(request)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function mappingJournalKey(scopeIdentity: string): string {
  return 'datatug.native-mapping.v1:' + scopeIdentity;
}
export async function encodeMappingJournal(
  scope: string,
  request: NativeMapping,
) {
  validateMapping(request);
  return JSON.stringify({
    version: 1,
    scope,
    request,
    digest: await intentDigest(request),
  });
}
export async function decodeMappingJournal(
  raw: string,
  scope: string,
): Promise<NativeMapping> {
  if (raw.length > 32768) throw new Error('Stored mapping requires review.');
  const e = exact(JSON.parse(raw), ['version', 'scope', 'request', 'digest']);
  if (e['version'] !== 1 || e['scope'] !== scope || !nativeToken(e['digest']))
    throw new Error('Stored mapping requires review.');
  const request = validateMapping(e['request']);
  const identity = JSON.parse(scope) as unknown;
  if (
    !Array.isArray(identity) ||
    identity.length !== 6 ||
    !nativeID(identity[0]) ||
    identity[1] !== 'firestore' ||
    identity[2] !== request.spaceID ||
    identity[3] !== request.projectId ||
    identity[4] !== request.environment ||
    identity[5] !== request.sourceId
  )
    throw new Error('Stored scope differs from intent.');
  if ((await intentDigest(request)) !== e['digest'])
    throw new Error('Stored mapping requires review.');
  return request;
}

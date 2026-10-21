/** Query-scoped semantic documents. No sampled row values enter this contract. */
export interface SemanticMeaningScope {
  readonly storage: 'firestore' | 'github.com' | 'local';
  readonly project: string;
  readonly spaceID?: string;
  readonly branch?: string;
}
export interface SemanticMeaningRef {
  readonly documentId: 'project';
  readonly conceptId: string;
  readonly scope: SemanticMeaningScope;
}
export interface SemanticConcept {
  meaningRef?: SemanticMeaningRef;
  id: string;
  kind: 'entity' | 'property';
  labels: { en: string };
  description: string;
  of?: string;
  bindings?: {
    model: 'modelspec:///query.QueryResult';
    field?: string;
    role: 'value';
  }[];
}
export interface SemanticModel {
  version: 1;
  basis: {
    queryHash: string;
    resultIndex: number;
    columns: { name: string; dataType: string }[];
  };
  meaning: {
    format: 'meaning/draft-2';
    id: string;
    name: string;
    description: string;
    models: { query: 'query.modelspec.json' };
    concepts: SemanticConcept[];
  };
  model: {
    modelspec: '1.0-draft-2';
    module: { id: 'datatug/query'; name: 'query'; version: '0.1.0' };
    records: { QueryResult: { fields: Record<string, { type: string }> } };
  };
  bindings: {
    columnIndex: number;
    field: string;
    concept: string;
    role?: string;
  }[];
}
export async function semanticQueryHash(
  queryType: string,
  text: string,
  connectionId = '',
  federation: unknown = null,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([queryType, text, connectionId, federation]),
    ),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function createSemanticModel(
  basis: SemanticModel['basis'],
): SemanticModel {
  const types: Record<string, string> = {
    string: 'string',
    integer: 'int',
    int: 'int',
    number: 'float',
    float: 'float',
    boolean: 'bool',
    bool: 'bool',
  };
  return {
    version: 1,
    basis: structuredClone(basis),
    meaning: {
      format: 'meaning/draft-2',
      id: 'query-meaning',
      name: 'Query meanings',
      description: 'User-authored meanings of query output columns.',
      models: { query: 'query.modelspec.json' },
      concepts: [],
    },
    model: {
      modelspec: '1.0-draft-2',
      module: { id: 'datatug/query', name: 'query', version: '0.1.0' },
      records: {
        QueryResult: {
          fields: Object.fromEntries(
            basis.columns.map((column, index) => [
              `column${index + 1}`,
              { type: types[column.dataType.toLowerCase()] ?? 'any' },
            ]),
          ),
        },
      },
    },
    bindings: [],
  };
}
export function conceptId(label: string, existing: SemanticConcept[]): string {
  const stem =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .filter((word) => /^[a-z]/.test(word))
      .join('-')
      .slice(0, 65) || 'meaning';
  let id = stem,
    suffix = 1;
  while (existing.some((concept) => concept.id === id))
    id = `${stem}-item${++suffix}`;
  return id;
}
export function rebuildMeaningBindings(bundle: SemanticModel): SemanticModel {
  return {
    ...bundle,
    meaning: {
      ...bundle.meaning,
      concepts: bundle.meaning.concepts.map((concept) => {
        const definition = { ...concept };
        delete definition.bindings;
        const bindings = bundle.bindings
          .filter((binding) => binding.concept === concept.id)
          .map((binding) => ({
            model: 'modelspec:///query.QueryResult' as const,
            field: binding.field,
            role: 'value' as const,
          }));
        return { ...definition, ...(bindings.length ? { bindings } : {}) };
      }),
    },
  };
}
export function sameSemanticBasis(
  a: SemanticModel['basis'],
  b: SemanticModel['basis'],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Missing asynchronous fingerprints are pending, not evidence of a changed result. */
export function semanticValidationState(
  saved: SemanticModel | undefined,
  basis: SemanticModel['basis'] | undefined,
  currentHash: string,
  previousRun: boolean,
): 'unmapped' | 'checking' | 'review' | 'confirmed' {
  if (!saved) return 'unmapped';
  if (!basis || !currentHash) return 'checking';
  return previousRun ||
    currentHash !== basis.queryHash ||
    !sameSemanticBasis(saved.basis, basis)
    ? 'review'
    : 'confirmed';
}

/** Fail closed at every persistence/import boundary; no permissive metadata casts. */
export function validateSemanticModel(
  value: unknown,
): asserts value is SemanticModel {
  const fail = (): never => {
    throw new Error(
      'Meaning document is invalid or unsupported. Your saved query was not changed.',
    );
  };
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (
      !v ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      Object.keys(v).some((k) => !keys.includes(k))
    )
      fail();
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max = 512): v is string =>
    typeof v === 'string' &&
    v.trim().length > 0 &&
    new TextEncoder().encode(v).length <= max &&
    !Array.from(v).some(
      (character) =>
        character.charCodeAt(0) < 32 &&
        ![9, 10, 13].includes(character.charCodeAt(0)),
    ) &&
    !/(?:bearer\s+[a-z0-9._-]+|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s@]+@)/i.test(
      v,
    );
  const array = (v: unknown, maximum = 512): unknown[] => {
    if (!Array.isArray(v) || v.length > maximum) fail();
    return v as unknown[];
  };
  if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024)
    fail();
  const root = object(value, [
    'version',
    'basis',
    'meaning',
    'model',
    'bindings',
  ]);
  if (root['version'] !== 1) fail();
  const basis = object(root['basis'], ['queryHash', 'resultIndex', 'columns']);
  if (
    typeof basis['queryHash'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(basis['queryHash']) ||
    !Number.isInteger(basis['resultIndex']) ||
    (basis['resultIndex'] as number) < 0
  )
    fail();
  const columns = array(basis['columns']);
  if (!columns.length) fail();
  for (const value of columns) {
    const c = object(value, ['name', 'dataType']);
    if (!text(c['name']) || !text(c['dataType'])) fail();
  }
  const meaning = object(root['meaning'], [
    'format',
    'id',
    'name',
    'description',
    'models',
    'concepts',
  ]);
  if (
    meaning['format'] !== 'meaning/draft-2' ||
    !text(meaning['id'], 80) ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(meaning['id']) ||
    !text(meaning['name']) ||
    !text(meaning['description'], 4096)
  )
    fail();
  const models = object(meaning['models'], ['query']);
  if (models['query'] !== 'query.modelspec.json') fail();
  const concepts = array(meaning['concepts'], 1024);
  if (!concepts.length) fail();
  const ids = new Map<string, Record<string, unknown>>();
  for (const value of concepts) {
    const c = object(value, [
      'id',
      'kind',
      'labels',
      'description',
      'of',
      'bindings',
      'meaningRef',
    ]);
    if (
      !text(c['id'], 80) ||
      !/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(c['id']) ||
      ids.has(c['id']) ||
      !['entity', 'property'].includes(c['kind'] as string) ||
      !text(c['description'], 4096)
    )
      fail();
    if (c['meaningRef'] !== undefined) {
      const ref = object(c['meaningRef'], ['documentId', 'conceptId', 'scope']);
      if (
        ref['documentId'] !== 'project' ||
        typeof ref['conceptId'] !== 'string' ||
        ref['conceptId'].length > 80 ||
        !/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(ref['conceptId'])
      )
        fail();
      const scope = object(ref['scope'], [
        'storage',
        'project',
        'spaceID',
        'branch',
      ]);
      if (
        !['firestore', 'github.com', 'local'].includes(
          scope['storage'] as string,
        ) ||
        !text(scope['project'], 1024) ||
        ('spaceID' in scope && !text(scope['spaceID'], 256)) ||
        ('branch' in scope && !text(scope['branch'], 256)) ||
        (scope['storage'] === 'firestore'
          ? 'branch' in scope
          : 'spaceID' in scope)
      )
        fail();
    }
    const labels = object(c['labels'], ['en']);
    if (!text(labels['en'])) fail();
    if (c['kind'] === 'entity' && ('of' in c || 'bindings' in c)) fail();
    if ('bindings' in c && !Array.isArray(c['bindings'])) fail();
    ids.set(c['id'] as string, c);
  }
  const model = object(root['model'], ['modelspec', 'module', 'records']);
  if (model['modelspec'] !== '1.0-draft-2') fail();
  const module = object(model['module'], ['id', 'name', 'version']);
  if (
    module['id'] !== 'datatug/query' ||
    module['name'] !== 'query' ||
    module['version'] !== '0.1.0'
  )
    fail();
  const records = object(model['records'], ['QueryResult']);
  const record = object(records['QueryResult'], ['fields']);
  const fields = object(
    record['fields'],
    columns.map((_, i) => `column${i + 1}`),
  );
  if (Object.keys(fields).length !== columns.length) fail();
  for (const value of Object.values(fields)) {
    const field = object(value, ['type']);
    if (
      ![
        'string',
        'int',
        'float',
        'bool',
        'decimal',
        'uuid',
        'date',
        'time',
        'datetime',
        'document',
        'json',
        'any',
      ].includes(field['type'] as string)
    )
      fail();
  }
  const bindings = array(root['bindings']),
    indices = new Set<number>(),
    expected = new Set<string>(),
    actual = new Set<string>();
  for (const value of bindings) {
    const b = object(value, ['columnIndex', 'field', 'concept', 'role']);
    const index = b['columnIndex'] as number;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= columns.length ||
      indices.has(index) ||
      b['field'] !== `column${index + 1}` ||
      !text(b['concept'], 80) ||
      ids.get(b['concept'])?.['kind'] !== 'property' ||
      ('role' in b && !text(b['role']))
    )
      fail();
    indices.add(index);
    expected.add(`${b['concept']}:${b['field']}`);
  }
  for (const [id, c] of ids) {
    if (
      c['kind'] === 'property' &&
      (typeof c['of'] !== 'string' || ids.get(c['of'])?.['kind'] !== 'entity')
    )
      fail();
    for (const value of c['bindings'] ? array(c['bindings']) : []) {
      const b = object(value, ['model', 'field', 'role']);
      const key = `${id}:${b['field']}`;
      if (
        b['model'] !== 'modelspec:///query.QueryResult' ||
        b['role'] !== 'value' ||
        typeof b['field'] !== 'string' ||
        !fields[b['field']] ||
        actual.has(key)
      )
        fail();
      actual.add(key);
    }
  }
  if (
    expected.size !== actual.size ||
    [...expected].some((key) => !actual.has(key))
  )
    fail();
}

/** Personal copies preserve the definition snapshot without claiming a provider-managed reference. */
export function detachProjectMeaningReferences(
  model: SemanticModel,
): SemanticModel {
  const copy = structuredClone(model);
  for (const concept of copy.meaning.concepts) delete concept.meaningRef;
  return copy;
}

/** Removing the last mapped use detaches its retained definition snapshot from project lifecycle. */
export function detachUnusedProjectMeaningReferences(
  model: SemanticModel,
): SemanticModel {
  const copy = structuredClone(model);
  const mapped = new Set(copy.bindings.map((binding) => binding.concept));
  const owners = new Set(
    copy.meaning.concepts
      .filter(
        (concept) =>
          concept.kind === 'property' &&
          mapped.has(concept.id) &&
          concept.meaningRef,
      )
      .map((concept) => concept.of),
  );
  for (const concept of copy.meaning.concepts)
    if (
      concept.meaningRef &&
      (concept.kind === 'property'
        ? !mapped.has(concept.id)
        : !owners.has(concept.id))
    )
      delete concept.meaningRef;
  return copy;
}

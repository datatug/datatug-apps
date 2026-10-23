import { parseDocument } from 'yaml';
import {
  array,
  object,
  string,
  immutableUrl,
  sha256,
  type ImmutableFile,
  type MetadataObject,
} from '../queries/public-data/canonical-metadata';
import { boundedResponseText } from '../queries/public-data/bounded-response';
import {
  JsonNumberToken,
  strictJsonNumbers,
} from '../queries/public-data/strict-json';

export interface DataModelSummary {
  readonly id: string;
  readonly title: string;
  readonly address: string;
  readonly revisionId: string;
  readonly commit: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
}
export interface LogicalField {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly constraints: Readonly<Record<string, string>>;
  readonly origin?: string;
}
export interface LogicalRecord {
  readonly name: string;
  readonly key: readonly string[];
  readonly uses: readonly string[];
  readonly fields: readonly LogicalField[];
}
export interface LogicalEnum {
  readonly name: string;
  readonly values: readonly string[];
}
export interface DataModelDetail extends DataModelSummary {
  readonly records: readonly LogicalRecord[];
  readonly components: readonly LogicalRecord[];
  readonly enums: readonly LogicalEnum[];
  readonly sourceFiles: readonly {
    readonly name: string;
    readonly url: string;
  }[];
}
const SHARED = 'https://github.com/meaninggraph/registry';
const LEGACY = 'https://github.com/modelspec-org/registry';
const SHA40 = /^[0-9a-f]{40}$/,
  SHA64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPO = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ADDRESS =
  /^modelspec:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z_][A-Za-z0-9_]*$/;
const LIMIT = 5 * 1024 * 1024;
const own = (value: MetadataObject, key: string): boolean =>
  Object.hasOwn(value, key);
const canonical = (value: string): string => {
  const p = value.split('/');
  p[3] = p[3]?.toLowerCase();
  p[4] = p[4]?.toLowerCase();
  return p.join('/');
};
function plain(value: unknown, context: string): MetadataObject {
  if (value instanceof JsonNumberToken) throw new Error(`Invalid ${context}.`);
  return object(value, context);
}
function closed(
  value: MetadataObject,
  allowed: readonly string[],
  context: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`Unsupported ${context} field.`);
}
function text(value: unknown, context: string): string {
  return string(value, context);
}
function strings(value: unknown, context: string): string[] {
  return array(value, context).map((value) => sourceName(value, context));
}
function sourceName(value: unknown, context: string): string {
  if (typeof value !== 'string' || /^\p{White_Space}*$/u.test(value))
    throw new Error(`Invalid ${context}.`);
  return value;
}
function safeSourcePath(value: unknown): string {
  const path = text(value, 'source path');
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    [...path].some((char) => char.charCodeAt(0) < 32) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Unsafe retained source path.');
  return path;
}
function digest(value: unknown): string {
  const hash = text(value, 'SHA-256');
  if (!SHA64.test(hash)) throw new Error('Invalid SHA-256.');
  return hash;
}
function commit(value: unknown): string {
  const sha = text(value, 'commit');
  if (!SHA40.test(sha)) throw new Error('An exact full commit is required.');
  return sha;
}
/** Exact tokens are emitted without converting constraint values to Number. */
export function nativeModelJSON(value: unknown): string {
  if (value instanceof JsonNumberToken) return value.token;
  if (Array.isArray(value)) return `[${value.map(nativeModelJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const r = value as MetadataObject;
    return `{${Object.keys(r)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${nativeModelJSON(r[key])}`)
      .join(',')}}`;
  }
  const result = JSON.stringify(value);
  if (result === undefined || typeof value === 'number')
    throw new Error('Unsupported rounded JSON value.');
  return result;
}
function decimal(token: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!m) throw new Error('Invalid exact numeric constraint.');
  let digits = `${m[2]}${m[3] ?? ''}`.replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(m[4] ?? '0') - BigInt((m[3] ?? '').length);
  const trimmed = digits.replace(/0+$/, '');
  exponent += BigInt(digits.length - trimmed.length);
  digits = trimmed;
  return `${m[1]}${digits}e${exponent}`;
}
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof JsonNumberToken || b instanceof JsonNumberToken)
    return (
      a instanceof JsonNumberToken &&
      b instanceof JsonNumberToken &&
      decimal(a.token) === decimal(b.token)
    );
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => equal(v, b[i]))
    );
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as MetadataObject,
      right = b as MetadataObject,
      keys = Object.keys(left).sort(),
      other = Object.keys(right).sort();
    return (
      keys.length === other.length &&
      keys.every((key, i) => key === other[i] && equal(left[key], right[key]))
    );
  }
  return a === b;
}
function display(value: unknown): string {
  return typeof value === 'string' ? value : nativeModelJSON(value);
}
function yaml(textValue: string, context: string): MetadataObject {
  const doc = parseDocument(textValue, {
    prettyErrors: false,
    intAsBigInt: true,
  });
  if (doc.errors.length) throw new Error(`Invalid archived ${context} YAML.`);
  return plain(doc.toJS({ maxAliasCount: 50 }), context);
}
interface IndexRow {
  readonly id: string;
  readonly kind: 'model' | 'meaning';
  readonly address: string;
  readonly commit: string;
  readonly path: string;
}
interface Catalog {
  readonly models: readonly MetadataObject[];
  readonly rows: ReadonlyMap<string, IndexRow>;
}
interface Loaded {
  readonly row: IndexRow;
  readonly receipt: MetadataObject;
  readonly ast: MetadataObject;
  readonly registration: MetadataObject;
  readonly module: MetadataObject;
  readonly alias: string;
  readonly files: readonly { readonly name: string; readonly url: string }[];
  readonly locks: ReadonlyMap<string, string>;
}

class Reader {
  private bytes = 0;
  private reads = 0;
  private readonly cache = new Map<
    string,
    { readonly text: string; readonly raw: Uint8Array }
  >();
  constructor(
    private readonly pin: ImmutableFile,
    private readonly http: typeof fetch,
    private readonly signal: AbortSignal,
  ) {
    if (pin.repository !== SHARED || pin.path !== 'catalog.json')
      throw new Error(
        'Native models require the reviewed shared registry catalog pin.',
      );
    immutableUrl(pin);
  }
  private url(path: string, hash?: string): string {
    return immutableUrl({ ...this.pin, path, sha256: hash ?? '0'.repeat(64) });
  }
  async read(path: string, hash?: string): Promise<string> {
    this.signal.throwIfAborted();
    const url = this.url(path, hash);
    let result = this.cache.get(path);
    if (!result) {
      if (++this.reads > 96)
        throw new Error('Native catalog exceeds 96 immutable files.');
      const response = await this.http(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: this.signal,
        headers: { Accept: 'application/json, application/yaml, text/plain' },
      });
      result = await boundedResponseText(
        response,
        LIMIT - this.bytes,
        this.signal,
        (bytes) => {
          this.bytes += bytes;
        },
      );
      if (!response.ok)
        throw new Error(
          `Retained native file unavailable (${response.status}).`,
        );
      this.cache.set(path, result);
    }
    if (hash && (await sha256(result.raw)) !== hash)
      throw new Error(`Retained native digest mismatch: ${path}.`);
    this.signal.throwIfAborted();
    return result.text;
  }
  async catalog(): Promise<Catalog> {
    const c = plain(
      strictJsonNumbers(await this.read('catalog.json', this.pin.sha256)),
      'native catalog',
    );
    if (c['format'] !== 'meaninggraph-catalog/draft-1')
      throw new Error('Unsupported native catalog format.');
    const { checksum, ...body } = c;
    if (checksum !== `sha256:${await sha256(nativeModelJSON(body))}`)
      throw new Error('Native catalog checksum mismatch.');
    const ref = plain(c['revision_index'], 'revision index reference');
    if (ref['path'] !== 'revisions/index.json')
      throw new Error('Unsafe revision index path.');
    const index = plain(
      strictJsonNumbers(
        await this.read('revisions/index.json', digest(ref['sha256'])),
      ),
      'revision index',
    );
    if (index['format'] !== 'meaninggraph-revision-index/draft-1')
      throw new Error('Unsupported revision index.');
    const rows = new Map<string, IndexRow>();
    for (const value of array(index['revisions'], 'revisions')) {
      const row = plain(value, 'revision row'),
        kind = row['kind'],
        address = text(row['address'], 'revision address'),
        sha = commit(row['commit']),
        id = digest(row['id']);
      if (
        (kind !== 'model' && kind !== 'meaning') ||
        !(
          kind === 'model'
            ? ADDRESS
            : /^meaning:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
        ).test(address) ||
        address.split('/').some((p) => p === '.' || p === '..') ||
        id !==
          (await sha256(
            JSON.stringify([
              'meaninggraph-revision/v1',
              kind,
              canonical(address),
              sha,
            ]),
          )) ||
        row['path'] !== `revisions/$records/${id}.yaml` ||
        rows.has(id)
      )
        throw new Error('Invalid exact revision identity/path.');
      rows.set(id, {
        id,
        kind,
        address,
        commit: sha,
        path: text(row['path'], 'revision path'),
      });
    }
    const models = array(c['models'], 'native models').map((m) =>
      plain(m, 'model selection'),
    );
    const meanings = array(c['graphs'], 'native meanings').map((m) =>
      plain(m, 'meaning selection'),
    );
    const pins = plain(c['source_revisions'], 'source revisions'),
      repositories = new Map<string, string>(),
      identities = new Set<string>(),
      names = new Set<string>();
    for (const [kind, entries] of [
      ['model', models],
      ['meaning', meanings],
    ] as const)
      for (const entry of entries) {
        const id = digest(entry['revision_id']),
          row = rows.get(id),
          address = text(entry['address'], 'selected address'),
          sha = commit(entry['commit']),
          repository = text(entry['repository'], 'publisher repository'),
          name = text(entry['id'], 'registry ID');
        const sourcePins = Object.entries(pins).filter(
          ([repo]) => repo.toLowerCase() === repository.toLowerCase(),
        );
        const identity = `${kind}:${canonical(address)}`,
          qualifiedName = `${kind}:${name}`;
        if (
          !ID.test(name) ||
          !row ||
          row.kind !== kind ||
          canonical(row.address) !== canonical(address) ||
          row.commit !== sha ||
          !REPO.test(repository) ||
          canonical(address)
            .split('/')
            .slice(0, 5)
            .join('/')
            .replace(
              kind === 'model' ? 'modelspec://' : 'meaning://',
              'https://',
            ) !== repository.toLowerCase() ||
          sourcePins.length !== 1 ||
          sourcePins[0][1] !== sha ||
          (repositories.has(repository.toLowerCase()) &&
            repositories.get(repository.toLowerCase()) !== sha) ||
          identities.has(identity) ||
          names.has(qualifiedName)
        )
          throw new Error(
            'Invalid native selection or selected repository pin disagreement.',
          );
        const definition = plain(entry['definition'], 'selected definition');
        if (definition['path'] !== `definitions/${id}.json`)
          throw new Error('Unsafe selected definition path.');
        digest(definition['sha256']);
        identities.add(identity);
        names.add(qualifiedName);
        repositories.set(repository.toLowerCase(), sha);
      }
    return { models, rows };
  }
  async load(row: IndexRow): Promise<Loaded> {
    // Receipts have no separate hash in revision-index/draft-1. Their path and
    // bytes are bound to this same reviewed immutable shared Git commit; all
    // referenced definitions/artifacts/provenance additionally require hashes.
    const r = plain(
      strictJsonNumbers(await this.read(row.path)),
      'model receipt',
    );
    if (
      r['format'] !== 'meaninggraph-revision/draft-1' ||
      r['kind'] !== 'model' ||
      r['id'] !== row.id ||
      canonical(text(r['address'], 'receipt address')) !==
        canonical(row.address) ||
      r['commit'] !== row.commit ||
      !ID.test(text(r['registry_id'], 'registry ID'))
    )
      throw new Error('Retained model receipt identity mismatch.');
    const publisher = text(r['repository'], 'publisher repository');
    if (
      !REPO.test(publisher) ||
      canonical(row.address)
        .split('/')
        .slice(0, 5)
        .join('/')
        .replace('modelspec://', 'https://') !== publisher.toLowerCase()
    )
      throw new Error('Retained publisher identity mismatch.');
    const evidence = async (raw: unknown, label: string): Promise<string> => {
      const e = plain(raw, label),
        hash = digest(e['sha256']);
      safeSourcePath(e['path']);
      commit(e['commit']);
      if (
        (e['repository'] !== SHARED && e['repository'] !== LEGACY) ||
        e['artifactPath'] !== `artifacts/sha256/${hash.slice(0, 2)}/${hash}`
      )
        throw new Error('Invalid retained registration provenance.');
      return this.read(text(e['artifactPath'], 'artifact path'), hash);
    };
    const sourceRef = plain(r['source_record'], 'registration provenance');
    if (
      sourceRef['path'] !==
      `models/$records/${text(r['registry_id'], 'registry ID')}.yaml`
    )
      throw new Error('Registration record path differs from registry ID.');
    const source = yaml(
      await evidence(sourceRef, 'registration'),
      'registration',
    );
    if (own(r, 'acquisition_record'))
      await evidence(r['acquisition_record'], 'acquisition record');
    const fileValues = array(r['files'], 'retained files'),
      fileTexts = new Map<string, string>(),
      files: { name: string; url: string }[] = [];
    for (const raw of fileValues) {
      const file = plain(raw, 'retained artifact'),
        name = safeSourcePath(file['path']),
        hash = digest(file['sha256']),
        path = `artifacts/sha256/${hash.slice(0, 2)}/${hash}`;
      if (fileTexts.has(name) || file['artifactPath'] !== path)
        throw new Error('Duplicate or unsafe retained artifact.');
      text(file['mediaType'], 'artifact media type');
      fileTexts.set(name, await this.read(path, hash));
      files.push({ name, url: this.url(path, hash) });
    }
    const paths = plain(r['source_paths'], 'source paths'),
      hcl = safeSourcePath(paths['hcl']),
      jsonPath = safeSourcePath(paths['json']);
    if (hcl === jsonPath || !fileTexts.has(hcl) || !fileTexts.has(jsonPath))
      throw new Error('Incomplete archived model source pair.');
    const original = plain(
      strictJsonNumbers(fileTexts.get(jsonPath) ?? ''),
      'original model AST',
    );
    const module = plain(r['module'], 'model module'),
      originalModule = plain(original['module'], 'original module');
    const alias = text(source['module'], 'registered module alias');
    if (
      !ALIAS.test(alias) ||
      source['format'] !== 'modelspec-registry/draft-1' ||
      source['commit'] !== row.commit ||
      canonical(text(source['address'], 'registered address')) !==
        canonical(row.address) ||
      text(source['repository'], 'registered repository').toLowerCase() !==
        publisher.toLowerCase() ||
      source['source_file'] !== hcl ||
      source['json_file'] !== jsonPath ||
      !equal(module, originalModule) ||
      original['modelspec'] !== r['format_identifier'] ||
      typeof module['id'] !== 'string' ||
      !module['id'] ||
      typeof module['version'] !== 'string' ||
      !module['version'] ||
      (own(module, 'name') && module['name'] !== alias)
    )
      throw new Error('Original registration/module/source identity mismatch.');
    const logical = plain(r['logical_digest'], 'logical digest');
    if (logical['algorithm'] !== 'meaninggraph-logical-digest/v1')
      throw new Error('Unsupported logical digest algorithm.');
    digest(logical['sha256']);
    const licences = plain(r['licences'], 'model licences');
    if (
      licences['model'] !== source['licence'] ||
      !text(licences['model'], 'model licence') ||
      !equal(
        array(r['maintainers'], 'maintainers'),
        array(source['maintainers'], 'source maintainers'),
      )
    )
      throw new Error('Archived attribution mismatch.');
    const definitionRef = plain(r['definition'], 'definition reference');
    if (definitionRef['path'] !== `definitions/${row.id}.json`)
      throw new Error('Unsafe definition path.');
    const def = plain(
      strictJsonNumbers(
        await this.read(
          text(definitionRef['path'], 'definition path'),
          digest(definitionRef['sha256']),
        ),
      ),
      'native definition',
    );
    const ast = normalizeOriginalModel(original);
    if (
      def['format'] !== 'meaninggraph-definition/draft-1' ||
      def['kind'] !== 'model' ||
      def['revision_id'] !== row.id ||
      !equal(ast, def['ast'])
    )
      throw new Error('Native AST differs from the archived original model.');
    const locks = new Map<string, string>();
    for (const raw of array(r['dependency_pins'], 'module locks')) {
      const lock = plain(raw, 'module lock'),
        alias = text(lock['alias'], 'module alias');
      if (!ALIAS.test(alias) || locks.has(alias))
        throw new Error('Ambiguous module lock.');
      locks.set(alias, digest(lock['revision_id']));
    }
    return {
      row,
      receipt: r,
      ast,
      registration: source,
      module,
      alias,
      files,
      locks,
    };
  }
  async closure(
    root: Loaded,
    rows: ReadonlyMap<string, IndexRow>,
  ): Promise<ReadonlyMap<string, Loaded>> {
    const result = new Map<string, Loaded>([[root.row.id, root]]),
      pending = [root];
    for (let index = 0; index < pending.length; index++)
      for (const [alias, id] of pending[index].locks) {
        let target = result.get(id);
        if (!target) {
          const row = rows.get(id);
          if (!row || row.kind !== 'model')
            throw new Error(
              'Missing exact model dependency; no latest fallback.',
            );
          target = await this.load(row);
          result.set(id, target);
          pending.push(target);
        }
        if (target.alias !== alias)
          throw new Error(
            'Exact dependency alias differs from the archived module.',
          );
      }
    return result;
  }
}

/** Normalize only the two supported ModelSpec vocabularies, preserving values. */
export function normalizeOriginalModel(
  original: MetadataObject,
): MetadataObject {
  const old = original['modelspec'] === '1.0-draft';
  if (!old && original['modelspec'] !== '1.0-draft-2')
    throw new Error('Unsupported archived ModelSpec format.');
  const recordKey = old ? 'entities' : 'records';
  closed(
    original,
    ['modelspec', 'module', 'components', 'enums', recordKey],
    'ModelSpec root',
  );
  const result: MetadataObject = {
    modelspec: '1.0-draft-2',
    module: original['module'],
  };
  for (const [sourceKey, key] of [
    ['components', 'components'],
    ['enums', 'enums'],
    [recordKey, 'records'],
  ] as const) {
    if (!own(original, sourceKey)) continue;
    const entries: MetadataObject = Object.create(null);
    for (const [name, value] of Object.entries(
      plain(original[sourceKey], sourceKey),
    )) {
      const concept = plain(value, 'model declaration');
      const fieldKey = old && key === 'records' ? 'properties' : 'fields';
      closed(
        concept,
        key === 'enums'
          ? ['values']
          : key === 'records'
            ? ['key', 'use', fieldKey]
            : [fieldKey],
        'model declaration',
      );
      if (key === 'enums') {
        entries[name] = concept;
        continue;
      }
      const fields: MetadataObject = Object.create(null);
      for (const [fieldName, fieldValue] of Object.entries(
        plain(concept[fieldKey], 'declared fields'),
      )) {
        const field = plain(fieldValue, 'model field');
        closed(
          field,
          [
            'type',
            old ? 'entity' : 'record',
            'component',
            'enum',
            'required',
            'unique',
            'min_len',
            'max_len',
            'pattern',
            'format',
          ],
          'model field',
        );
        const normalized: MetadataObject = Object.create(null);
        for (const [key, value] of Object.entries(field))
          normalized[key === 'entity' ? 'record' : key] = value;
        fields[fieldName] = normalized;
      }
      const normalized: MetadataObject = { fields };
      if (own(concept, 'key')) normalized['key'] = concept['key'];
      if (own(concept, 'use')) normalized['use'] = concept['use'];
      entries[name] = normalized;
    }
    result[key] = entries;
  }
  return result;
}
function summary(entry: MetadataObject): DataModelSummary {
  return {
    id: text(entry['id'], 'model ID'),
    title: text(entry['title'], 'model title'),
    address: text(entry['address'], 'model address'),
    revisionId: digest(entry['revision_id']),
    commit: commit(entry['commit']),
    moduleId: text(entry['module_id'], 'module ID'),
    moduleVersion: text(entry['module_version'], 'module version'),
  };
}
function declaration(
  module: Loaded,
  kind: 'records' | 'components' | 'enums',
  name: string,
): MetadataObject {
  const group = plain(module.ast[kind] ?? {}, kind);
  if (!own(group, name))
    throw new Error(`Missing exact ${kind} declaration ${name}.`);
  return plain(group[name], `exact ${kind} declaration ${name}`);
}
function resolveReference(
  module: Loaded,
  ref: string,
  kind: 'records' | 'components' | 'enums',
  closure: ReadonlyMap<string, Loaded>,
): { module: Loaded; name: string; value: MetadataObject } {
  const parts = ref.split('.');
  if (parts.length > 2 || parts.some((part) => !part))
    throw new Error('Invalid qualified model reference.');
  let target = module;
  const name = parts.at(-1) ?? '';
  if (parts.length === 2 && parts[0] !== module.alias) {
    const id = module.locks.get(parts[0]);
    const locked = id ? closure.get(id) : undefined;
    if (!locked)
      throw new Error(
        'Unresolved qualified model reference; no latest fallback.',
      );
    target = locked;
  }
  return { module: target, name, value: declaration(target, kind, name) };
}
function fieldView(
  module: Loaded,
  kind: string,
  owner: string,
  name: string,
  value: unknown,
  closure: ReadonlyMap<string, Loaded>,
  via = '',
): LogicalField {
  const field = plain(value, 'field');
  const kinds = ['type', 'record', 'component'].filter((key) =>
    own(field, key),
  );
  if (kinds.length !== 1) throw new Error('Invalid archived model field type.');
  const discriminator = kinds[0],
    ref = discriminator === 'type'
      ? text(field[discriminator], 'field type')
      : sourceName(field[discriminator], 'field reference');
  const targets: string[] = [];
  if (discriminator !== 'type') {
    const target = resolveReference(
      module,
      ref,
      discriminator === 'record' ? 'records' : 'components',
      closure,
    );
    targets.push(
      `${discriminator} ${ref} => ${target.module.row.address}@${target.module.row.commit}`,
    );
  }
  if (typeof field['enum'] === 'string') {
    const target = resolveReference(module, field['enum'], 'enums', closure);
    targets.push(
      `enum ${field['enum']} => ${target.module.row.address}@${target.module.row.commit}`,
    );
  }
  const constraints: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(field))
    if (!['type', 'record', 'component'].includes(key))
      constraints[key] = display(value);
  if (own(field, 'required') && typeof field['required'] !== 'boolean')
    throw new Error('Invalid requiredness.');
  return {
    name,
    type: discriminator === 'type' ? ref : `${discriminator} ${ref}`,
    ...(own(field, 'required')
      ? { required: field['required'] as boolean }
      : {}),
    constraints,
    origin: `${module.row.address}@${module.row.commit} ${kind} ${owner}.${name}${via}${targets.length ? `; references ${targets.join('; ')}` : ''}`,
  };
}
function project(
  root: Loaded,
  closure: ReadonlyMap<string, Loaded>,
): Pick<DataModelDetail, 'records' | 'components' | 'enums'> {
  // Verify every finite declaration/reference in the closure. No nested value is
  // expanded, so legal component and record-reference cycles stay finite.
  for (const module of closure.values())
    for (const kind of ['records', 'components'] as const)
      for (const [name, value] of Object.entries(
        plain(module.ast[kind] ?? {}, kind),
      )) {
        const concept = plain(value, 'declaration');
        for (const [field, value] of Object.entries(
          plain(concept['fields'], 'fields'),
        ))
          fieldView(module, kind, name, field, value, closure);
        if (kind === 'records')
          for (const ref of strings(concept['use'] ?? [], 'components used'))
            resolveReference(module, ref, 'components', closure);
      }
  let viewBytes = 0;
  const retainField = (field: LogicalField): LogicalField => {
    viewBytes +=
      field.name.length +
      field.type.length +
      (field.origin?.length ?? 0) +
      Object.entries(field.constraints).reduce(
        (sum, [key, value]) => sum + key.length + value.length,
        0,
      );
    if (viewBytes > LIMIT)
      throw new Error(
        'Logical composition exceeds the bounded projection budget.',
      );
    return field;
  };
  const records = (kind: 'records' | 'components'): LogicalRecord[] =>
    Object.entries(plain(root.ast[kind] ?? {}, kind)).map(([name, value]) => {
      const c = plain(value, 'logical record'),
        ownFields = plain(c['fields'], 'own fields'),
        uses = strings(c['use'] ?? [], 'uses');
      const fields = Object.entries(ownFields).map(([field, value]) =>
        retainField(fieldView(root, kind, name, field, value, closure)),
      );
      for (const [position, ref] of uses.entries()) {
        const target = resolveReference(root, ref, 'components', closure);
        for (const [field, value] of Object.entries(
          plain(target.value['fields'], 'component fields'),
        ))
          if (!own(ownFields, field))
            fields.push(
              retainField(
                fieldView(
                  target.module,
                  'components',
                  target.name,
                  field,
                  value,
                  closure,
                  ` via ${root.row.address}@${root.row.commit} ${name}.use[${position}]=${ref}`,
                ),
              ),
            );
      }
      const key = strings(c['key'] ?? [], 'record key');
      const effectiveNames = new Set(fields.map((field) => field.name));
      if (key.some((key) => !effectiveNames.has(key)))
        throw new Error('Archived key does not resolve after composition.');
      return { name, key, uses, fields };
    });
  return {
    records: records('records'),
    components: records('components'),
    enums: Object.entries(plain(root.ast['enums'] ?? {}, 'enums')).map(
      ([name, value]) => ({
        name,
        values: array(plain(value, 'enum')['values'], 'enum values').map(
          display,
        ),
      }),
    ),
  };
}
async function operation<T>(
  pin: ImmutableFile,
  http: typeof fetch,
  external: AbortSignal,
  action: (reader: Reader) => Promise<T>,
): Promise<T> {
  external.throwIfAborted();
  const controller = new AbortController(),
    abort = (): void => controller.abort(external.reason);
  external.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('Native catalog deadline exceeded.')),
    10_000,
  );
  const stopped = new Promise<never>((_resolve, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(controller.signal.reason),
      { once: true },
    ),
  );
  void stopped.catch(() => undefined); // Setup may fail before the transport race.
  try {
    return await Promise.race([
      action(new Reader(pin, http, controller.signal)),
      stopped,
    ]);
  } finally {
    clearTimeout(timeout);
    external.removeEventListener('abort', abort);
    controller.abort(new Error('Native model read finished.'));
  }
}
export async function listNativeDataModels(
  pin: ImmutableFile,
  http: typeof fetch,
  signal: AbortSignal,
): Promise<readonly DataModelSummary[]> {
  return operation(pin, http, signal, async (reader) =>
    (await reader.catalog()).models.map(summary),
  );
}
export async function readNativeDataModel(
  pin: ImmutableFile,
  id: string,
  exactCommit: string,
  http: typeof fetch,
  signal: AbortSignal,
): Promise<DataModelDetail> {
  if (!ID.test(id) || !SHA40.test(exactCommit))
    throw new Error('Exact retained model ID and full commit are required.');
  return operation(pin, http, signal, async (reader) => {
    const catalog = await reader.catalog(),
      selected = catalog.models.find((entry) => entry['id'] === id);
    const candidates = [...catalog.rows.values()].filter(
      (row) =>
        row.kind === 'model' &&
        row.commit === exactCommit &&
        (!selected ||
          canonical(row.address) ===
            canonical(text(selected['address'], 'selected address'))),
    );
    const matches: Loaded[] = [];
    for (const row of candidates) {
      const item = await reader.load(row);
      if (item.receipt['registry_id'] === id) matches.push(item);
    }
    if (matches.length !== 1)
      throw new Error(
        'Exact retained model revision is missing or ambiguous; no latest fallback.',
      );
    const root = matches[0],
      closure = await reader.closure(root, catalog.rows);
    if (selected && selected['revision_id'] === root.row.id) {
      const definition = plain(selected['definition'], 'selected definition'),
        expected = plain(root.receipt['definition'], 'retained definition');
      if (
        !equal(definition, expected) ||
        selected['module_id'] !== root.module['id'] ||
        selected['module_version'] !== root.module['version']
      )
        throw new Error('Selection differs from retained native definition.');
    }
    return {
      id,
      title: text(root.registration['title'], 'model title'),
      address: root.row.address,
      revisionId: root.row.id,
      commit: root.row.commit,
      moduleId: text(root.module['id'], 'module ID'),
      moduleVersion: text(root.module['version'], 'module version'),
      ...project(root, closure),
      sourceFiles: root.files,
    };
  });
}

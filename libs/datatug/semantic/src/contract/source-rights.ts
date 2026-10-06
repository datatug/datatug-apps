/** Additive OVDB source-data terms contract. Descriptive metadata is never
 * authorization, public-data admission, or a licence for a derived result. */
export interface DataLicenseDeclaration {
  readonly name?: string;
  readonly spdx?: string;
  readonly url?: string;
  readonly text?: string;
}
export interface RightsSource {
  readonly serverId: string;
  readonly databaseId?: string;
  readonly recordset?: string;
}
export interface SourceRight {
  readonly sourceId: string;
  readonly source: RightsSource;
  readonly declaration: DataLicenseDeclaration;
  readonly declarationScope: 'server' | 'database' | 'recordset';
  readonly declaredAt: RightsSource;
  readonly evidenceOrigin:
    | 'publisher-verified'
    | 'server-declared'
    | 'legacy-metadata';
  readonly pins: readonly {
    readonly role:
      | 'provider'
      | 'declaration'
      | 'provenance'
      | 'input'
      | 'terms';
    readonly repository: string;
    readonly revision: string;
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
  readonly attribution?: { readonly text: string; readonly url?: string };
  readonly freeSource?: { readonly text: string; readonly url: string };
  readonly transformations: readonly string[];
}
export interface SourceRightsEvidence {
  readonly sourceRights?: readonly SourceRight[];
  readonly usedSourceIds?: readonly string[];
}
const bad = (): never => {
  throw new Error('Malformed source-data terms evidence.');
};
const encoder = new TextEncoder();
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return bad();
  return record;
}
function text(value: unknown, max = 4096, multiline = false): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    encoder.encode(value).length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 ||
        (code < 32 && (!multiline || ![9, 10, 13].includes(code)))
      );
    })
  )
    return bad();
  return value;
}
export function safeTermsUrl(value: unknown): string {
  const raw = text(value, 2048);
  if (raw !== raw.trim() || /\s|\\/.test(raw) || !raw.startsWith('https://'))
    return bad();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return bad();
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password
  )
    return bad();
  return raw;
}
/** Validate identity components without rewriting the server-owned opaque id. */
function sourceId(value: unknown, expected?: RightsSource): string {
  const id = text(value);
  if (!id.startsWith('ovdb:')) return bad();
  const raw = id.slice(5).split('/');
  if (raw.length < 1 || raw.length > 3) return bad();
  let parts: string[];
  try {
    parts = raw.map((part) => text(decodeURIComponent(part)));
  } catch {
    return bad();
  }
  if (
    expected &&
    (parts[0] !== expected.serverId ||
      parts[1] !== expected.databaseId ||
      parts[2] !== expected.recordset)
  )
    return bad();
  return id;
}
export function decodeDataLicenseDeclaration(
  value: unknown,
): DataLicenseDeclaration {
  // Existing scalar summaries remain readable, including custom legacy labels.
  if (typeof value === 'string') return { spdx: text(value, 4096) };
  const raw = object(value, ['name', 'spdx', 'url', 'text']);
  const result: DataLicenseDeclaration = {
    ...(raw['name'] !== undefined ? { name: text(raw['name'], 256) } : {}),
    ...(raw['spdx'] !== undefined ? { spdx: text(raw['spdx'], 64) } : {}),
    ...(raw['url'] !== undefined ? { url: safeTermsUrl(raw['url']) } : {}),
    ...(raw['text'] !== undefined
      ? { text: text(raw['text'], 65536, true) }
      : {}),
  };
  if (!result.spdx && !result.url && !result.text) return bad();
  return result;
}
function source(value: unknown): RightsSource {
  const raw = object(value, ['serverId', 'databaseId', 'recordset']);
  const result = {
    serverId: text(raw['serverId']),
    ...(raw['databaseId'] !== undefined
      ? { databaseId: text(raw['databaseId']) }
      : {}),
    ...(raw['recordset'] !== undefined
      ? { recordset: text(raw['recordset']) }
      : {}),
  };
  if (result.recordset && !result.databaseId) return bad();
  return result;
}
function notice(
  value: unknown,
  requiredUrl = false,
): { text: string; url?: string } {
  const raw = object(value, ['text', 'url']);
  if (requiredUrl && raw['url'] === undefined) return bad();
  return {
    text: text(raw['text'], 65536, true),
    ...(raw['url'] !== undefined ? { url: safeTermsUrl(raw['url']) } : {}),
  };
}
function member<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) return bad();
  return value as T;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return bad();
  return value;
}
export function decodeSourceRights(value: unknown): readonly SourceRight[] {
  if (encoder.encode(JSON.stringify(value) ?? '').length > 262144) return bad();
  const entries = new Map<string, SourceRight>();
  for (const item of array(value)) {
    const raw = object(item, [
      'sourceId',
      'source',
      'declaration',
      'declarationScope',
      'declaredAt',
      'evidenceOrigin',
      'pins',
      'attribution',
      'freeSource',
      'transformations',
    ]);
    const actual = source(raw['source']),
      declared = source(raw['declaredAt']);
    const scope = member(raw['declarationScope'], [
      'server',
      'database',
      'recordset',
    ]);
    if (
      actual.serverId !== declared.serverId ||
      (scope === 'server' && (declared.databaseId || declared.recordset)) ||
      (scope === 'database' &&
        (!declared.databaseId ||
          declared.databaseId !== actual.databaseId ||
          declared.recordset)) ||
      (scope === 'recordset' &&
        (!declared.recordset ||
          declared.databaseId !== actual.databaseId ||
          declared.recordset !== actual.recordset))
    )
      return bad();
    const pins = array(raw['pins']).map((value) => {
      const pin = object(value, [
        'role',
        'repository',
        'revision',
        'path',
        'sha256',
        'bytes',
      ]);
      const revision = text(pin['revision']),
        hash = text(pin['sha256']),
        path = text(pin['path']);
      if (
        !/^[a-f0-9]{40}$/.test(revision) ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        /(^\/|\/$|\\|(^|\/)(\.|\.\.)($|\/))/.test(path) ||
        !Number.isSafeInteger(pin['bytes']) ||
        (pin['bytes'] as number) < 0
      )
        return bad();
      return {
        role: member(pin['role'], [
          'provider',
          'declaration',
          'provenance',
          'input',
          'terms',
        ]),
        repository: safeTermsUrl(pin['repository']),
        revision,
        path,
        sha256: hash,
        bytes: pin['bytes'] as number,
      };
    });
    const entry: SourceRight = {
      sourceId: sourceId(raw['sourceId'], actual),
      source: actual,
      declaration: decodeDataLicenseDeclaration(raw['declaration']),
      declarationScope: scope,
      declaredAt: declared,
      evidenceOrigin: member(raw['evidenceOrigin'], [
        'publisher-verified',
        'server-declared',
        'legacy-metadata',
      ]),
      pins,
      ...(raw['attribution'] !== undefined
        ? { attribution: notice(raw['attribution']) }
        : {}),
      ...(raw['freeSource'] !== undefined
        ? {
            freeSource: notice(raw['freeSource'], true) as {
              text: string;
              url: string;
            },
          }
        : {}),
      transformations: array(raw['transformations']).map((value) =>
        text(value, 65536, true),
      ),
    };
    const previous = entries.get(entry.sourceId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
      return bad();
    entries.set(entry.sourceId, entry);
  }
  return [...entries.values()].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
}
/** dataRights is the Directory inventory alias, not result evidence. */
export function decodeRightsInventory(
  value: Record<string, unknown>,
): readonly SourceRight[] | undefined {
  if (value['sourceRights'] !== undefined && value['dataRights'] !== undefined)
    return bad();
  const raw =
    value['sourceRights'] !== undefined
      ? value['sourceRights']
      : value['dataRights'];
  return raw === undefined ? undefined : decodeSourceRights(raw);
}
export function decodeSourceRightsEvidence(
  value: Record<string, unknown>,
): SourceRightsEvidence {
  const rights = value['sourceRights'];
  if (rights === undefined && value['usedSourceIds'] === undefined) return {};
  if (rights === undefined) {
    const ids = array(value['usedSourceIds']).map((id) => sourceId(id));
    if (
      new Set(ids).size !== ids.length ||
      encoder.encode(JSON.stringify(ids)).length > 262144
    )
      return bad();
    return { usedSourceIds: [...ids].sort() };
  }
  const sourceRights = decodeSourceRights(rights);
  if (value['usedSourceIds'] === undefined) return { sourceRights };
  const ids = array(value['usedSourceIds']).map((id) => sourceId(id));
  if (new Set(ids).size !== ids.length) return bad();
  if (
    encoder.encode(JSON.stringify({ sourceRights, usedSourceIds: ids }))
      .length > 262144
  )
    return bad();
  return { sourceRights, usedSourceIds: [...ids].sort() };
}
export function dataLicenseSummary(value: unknown): string {
  const declaration = decodeDataLicenseDeclaration(value);
  return (
    declaration.name ??
    declaration.spdx ??
    (declaration.url ? 'Custom source terms' : 'Source terms text')
  );
}

import type { TypedValue } from '@sneat/datatug-semantic';
import type { IParameterDef } from '../../models/definition/parameter';
import type { QueryConnectionDescriptor } from '../../queries/query-dispatch';

/**
 * Pure rules of the parameter lookup picker (datatug/backstage
 * spec/features/parameter-lookup). The Go twin of the resolution rules is
 * `semantic.LookupSources` in datatug-core; this file mirrors it for the
 * public browser runtime, which has no server to ask.
 */

/** A key column's kind: the TypedValue type a picked key is returned as. */
export type LookupKeyKind = 'integer' | 'string';

/** At most this many rows are shown; the runtime asks for one more. */
export const LOOKUP_PAGE_SIZE = 50;
/** Filter text longer than this is cut. */
export const LOOKUP_FILTER_MAX = 100;
/** An explicit (author SQL) lookup shows at most this many of its rows. */
export const EXPLICIT_LOOKUP_MAX_ROWS = 1000;
const MAX_DECLARED_DISPLAY = 6;
const MAX_INFERRED_DISPLAY = 3;

/** A Core `StringPattern` (`*.entity.json` `namePatterns[]`). */
export interface LookupNamePattern {
  readonly type?: string;
  readonly value?: string;
  readonly caseSensitive?: boolean;
}

/** The subset of a Core entity field the picker reads. */
export interface LookupEntityField {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  /** Core `EntityField.IsKeyField`: only key fields' name patterns can give a parameter its meaning. */
  readonly isKeyField?: boolean;
  readonly namePatterns?: readonly (LookupNamePattern | null | undefined)[] | null;
  readonly mappings?: readonly {
    readonly source: string;
    readonly collection: string;
    readonly column: string;
  }[];
}

/** The subset of a Core entity (`*.entity.json`) the picker reads. */
export interface LookupEntity {
  readonly id?: string;
  readonly title?: string;
  readonly display?: readonly string[];
  readonly fields?: readonly (LookupEntityField | null | undefined)[];
}

/** A declared mapping of the parameter's meaning: a lookup source until the schema says otherwise. */
export interface LookupCandidate {
  readonly source: string;
  readonly collection: string;
  readonly keyColumn: string;
  /** From the entity field's declared type; verified against the schema on open. */
  readonly fieldKind: LookupKeyKind;
}

export interface LookupColumn {
  readonly name: string;
  readonly type: string;
}

export interface LookupDisplayColumn {
  readonly column: string;
  readonly field?: string;
  readonly label: string;
}

export interface LookupDisplay {
  readonly columns: readonly LookupDisplayColumn[];
  /** True when the columns were guessed (no usable `display` on the entity). */
  readonly inferred: boolean;
}

/** SQLite-style affinity: INT → integer; CHAR/CLOB/TEXT (or "string") → string; anything else is no key. */
export function columnKeyKind(columnType: string | undefined): LookupKeyKind | undefined {
  const t = (columnType ?? '').trim().toUpperCase();
  if (t.includes('INT')) return 'integer';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT') || t === 'STRING') return 'string';
  return undefined;
}

/** A string parameter takes either key kind (integer as decimal text); an integer parameter only integer keys. */
export function parameterAcceptsKey(parameterType: string, kind: LookupKeyKind | undefined): boolean {
  if (!kind) return false;
  if (['string', 'text', 'UUID', 'GUID'].includes(parameterType)) return true;
  return parameterType === 'integer' && kind === 'integer';
}

/** A parameter that could ever have a picker: not multi-value, not a record or recordset. */
export function isScalarLookupParameter(parameter: IParameterDef | undefined): parameter is IParameterDef {
  return !!parameter && !parameter.isMultiValue &&
    parameter.type !== ('record' as string) && parameter.type !== ('recordset' as string);
}

/**
 * The meaning a parameter's lookup resolves through (REQ:inferred-parameter-meaning),
 * the twin of Core `semantic.ResolveParameterMeaning`.
 */
export interface ParameterMeaning {
  readonly entity: string;
  readonly field: string;
  readonly provenance: 'declared' | 'inferred';
  /** For an inferred meaning: the pattern that matched, e.g. `namePattern:regexp:\w+CustomerID`. */
  readonly rule?: string;
}

/**
 * Whether `name` matches a Core name pattern, as Core `semantic.Resolve`
 * matches columns: `exact` compares the whole name, `regexp` searches it
 * (unanchored), and both ignore case unless `caseSensitive`. A pattern that
 * cannot be evaluated never matches.
 */
export function matchesNamePattern(pattern: LookupNamePattern | null | undefined, name: string): boolean {
  if (!pattern?.value) return false;
  if (pattern.type === 'exact')
    return pattern.caseSensitive ? pattern.value === name : pattern.value.toLowerCase() === name.toLowerCase();
  if (pattern.type !== 'regexp') return false;
  try {
    return new RegExp(pattern.value, pattern.caseSensitive ? '' : 'i').test(name);
  } catch {
    return false;
  }
}

/**
 * A parameter's declared `meta`, else the one key field across `entities`
 * whose name patterns match the parameter's name without `@` (inferred).
 * Undefined when nothing matches or more than one entity field does: an
 * ambiguous name gets no button.
 */
export function resolveParameterMeaning(
  entities: readonly (LookupEntity | null | undefined)[],
  parameter: Pick<IParameterDef, 'id' | 'meta'>,
): ParameterMeaning | undefined {
  if (parameter.meta) {
    // A declared meta with a blank part is invalid: no meaning, and the name is not tried instead (Core twin).
    const { entity, field } = parameter.meta;
    return entity?.trim() && field?.trim() ? { entity, field, provenance: 'declared' } : undefined;
  }
  const name = parameter.id.replace(/^@/, '');
  if (!name) return undefined;
  const matches: ParameterMeaning[] = [];
  for (const entity of entities) {
    if (!entity?.id) continue;
    for (const field of entity.fields ?? []) {
      if (!field?.isKeyField) continue;
      const pattern = (field.namePatterns ?? []).find((p) => matchesNamePattern(p, name));
      if (pattern)
        matches.push({ entity: entity.id, field: field.id, provenance: 'inferred', rule: `namePattern:${pattern.type}:${pattern.value}` });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** A parameter that could ever have a meaning-keyed picker: scalar, with `meta`. */
export function isMeaningLookupParameter(parameter: IParameterDef | undefined): parameter is IParameterDef & { meta: NonNullable<IParameterDef['meta']> } {
  return !!parameter?.meta?.entity && !!parameter.meta.field && !parameter.isMultiValue &&
    parameter.type !== ('record' as string) && parameter.type !== ('recordset' as string);
}

/**
 * The declared mappings of the parameter's meaning whose entity field type the
 * parameter can hold (REQ:lookup-source-resolution, eligible candidates).
 * Name patterns never count. `entity` must be the entity `parameter.meta.entity` names.
 */
export function lookupCandidates(entity: LookupEntity | undefined, parameter: IParameterDef): LookupCandidate[] {
  if (!entity || !isMeaningLookupParameter(parameter)) return [];
  const field = entity.fields?.find((f) => f?.id === parameter.meta.field);
  const fieldKind = columnKeyKind(field?.type);
  if (!field || !fieldKind || !parameterAcceptsKey(parameter.type, fieldKind)) return [];
  return (field.mappings ?? [])
    .filter((m) => !!m?.source && !!m.collection && !!m.column)
    .map((m) => ({ source: m.source, collection: m.collection, keyColumn: m.column, fieldKind }));
}

/** Orders candidates: the host's own source first, then by source, then by collection. */
export function orderCandidates(candidates: readonly LookupCandidate[], hostSource?: string): LookupCandidate[] {
  return [...candidates].sort((a, b) => {
    const ha = a.source === hostSource, hb = b.source === hostSource;
    if (ha !== hb) return ha ? -1 : 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0;
  });
}

/** The display columns of a source (REQ:display-columns): `display`, else up to three labelled guesses. */
export function lookupDisplayColumns(
  entity: LookupEntity,
  candidate: Pick<LookupCandidate, 'source' | 'collection' | 'keyColumn'>,
  schemaColumns: readonly LookupColumn[],
): LookupDisplay {
  const chosen = new Set([candidate.keyColumn]);
  const known = new Set(schemaColumns.map((c) => c.name));
  const fields = (entity.fields ?? []).filter((f): f is LookupEntityField => !!f);
  const columnOf = (f: LookupEntityField): string | undefined => {
    const ref = f.mappings?.find((m) => m.source === candidate.source && m.collection === candidate.collection);
    return ref && !chosen.has(ref.column) && known.has(ref.column) ? ref.column : undefined;
  };
  const declared: LookupDisplayColumn[] = [];
  for (const id of entity.display ?? []) {
    if (declared.length === MAX_DECLARED_DISPLAY) break;
    const f = fields.find((field) => field.id === id);
    const column = f && columnOf(f);
    if (f && column) {
      chosen.add(column);
      declared.push({ column, field: f.id, label: f.title || humanizeName(f.id) });
    }
  }
  if (declared.length) return { columns: declared, inferred: false };
  const inferred: LookupDisplayColumn[] = [];
  for (const f of fields) {
    if (inferred.length === MAX_INFERRED_DISPLAY) break;
    const column = columnOf(f);
    if (column) {
      chosen.add(column);
      inferred.push({ column, field: f.id, label: f.title || humanizeName(f.id) });
    }
  }
  for (const c of schemaColumns) {
    if (inferred.length === MAX_INFERRED_DISPLAY) break;
    if (chosen.has(c.name) || columnKeyKind(c.type) !== 'string') continue;
    chosen.add(c.name);
    inferred.push({ column: c.name, label: humanizeName(c.name) });
  }
  return { columns: inferred, inferred: inferred.length > 0 };
}

/**
 * A schema or field name in the visitor's words: `CompanyName` → "Company name",
 * `CustomerID` → "Customer ID", `ship_city` → "Ship city". Acronyms keep their case.
 */
export function humanizeName(name: string): string {
  const words = name
    .replace(/[_\s-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word, i) => {
      if (word.length > 1 && /^[A-Z0-9]+$/.test(word)) return word;
      return i === 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase();
    })
    .join(' ');
}

/** Double-quotes an SQLite identifier. Callers pass only names found in the fixture's own catalog. */
export function quoteSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Makes `%`, `_` and `\` literal for `LIKE … ESCAPE '\'`, wrapped for a contains-match. */
export function likeContainsPattern(filter: string): string {
  return `%${filter.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Trims and bounds filter text. */
export function normalizeLookupFilter(filter: string | null | undefined): string {
  return (filter ?? '').trim().slice(0, LOOKUP_FILTER_MAX);
}

/** The schema probe: one row per column with its declared type and primary-key position. */
export const LOOKUP_SCHEMA_SQL = 'SELECT name, type, pk FROM pragma_table_info(@collection) ORDER BY cid';

/**
 * The bounded rows statement (REQ:filter, REQ:bounded-results). Every name must
 * already have been checked against the fixture catalog; the filter is bound
 * as `@filter`, and an empty filter adds no WHERE.
 */
export function lookupRowsSql(collection: string, keyColumn: string, displayColumns: readonly string[], filter: string): { sql: string; parameters: { id: string; type: 'string' }[]; values: Record<string, TypedValue> } {
  const columns = [keyColumn, ...displayColumns];
  const select = columns.map(quoteSqlIdentifier).join(', ');
  const where = filter
    ? ` WHERE ${columns.map((c) => `CAST(${quoteSqlIdentifier(c)} AS TEXT) LIKE @filter ESCAPE '\\'`).join(' OR ')}`
    : '';
  const sql = `SELECT ${select} FROM ${quoteSqlIdentifier(collection)}${where} ORDER BY ${quoteSqlIdentifier(keyColumn)} LIMIT ${LOOKUP_PAGE_SIZE + 1}`;
  return filter
    ? { sql, parameters: [{ id: 'filter', type: 'string' }], values: { filter: { type: 'string', value: likeContainsPattern(filter) } } }
    : { sql, parameters: [], values: {} };
}

/**
 * The browser-runnable catalog connection a lookup source reads
 * (REQ:runtime-execution match order), or undefined when none or several match.
 */
export function lookupConnection(
  connections: readonly QueryConnectionDescriptor[],
  source: string,
  hostConnectionId: string | undefined,
  environment: string | undefined,
): QueryConnectionDescriptor | undefined {
  const runnable = connections.filter((c) => {
    if (c.storage !== 'sqlite' || !c.browserFixture || typeof c.browserFixture.url !== 'string' || !c.fixtureSha256) return false;
    const envs = c.environments ?? (c.environment !== undefined ? [c.environment] : undefined);
    if (!envs) return true;
    return environment ? envs.includes(environment) : envs.length === 1;
  });
  const matching = runnable.filter((c) => c.id === source || c.dataset === source);
  const host = hostConnectionId ? matching.find((c) => c.id === hostConnectionId) : undefined;
  if (host) return host;
  return matching.length === 1 ? matching[0] : undefined;
}

/** The environment to run a connection in: the host's, else the connection's only one. */
export function lookupEnvironment(connection: QueryConnectionDescriptor, environment: string | undefined): string | undefined {
  if (environment) return environment;
  const envs = connection.environments ?? (connection.environment !== undefined ? [connection.environment] : undefined);
  return envs?.length === 1 ? envs[0] : undefined;
}

/** A row value as text, for display and in-page matching. */
export function lookupCellText(value: TypedValue | undefined): string {
  if (!value || value.type === 'null') return '';
  return String(value.value);
}

/** In-page contains-match (explicit lookups only): ASCII case-insensitive, like SQLite LIKE. */
export function rowMatchesFilter(cells: readonly TypedValue[], filter: string): boolean {
  if (!filter) return true;
  const needle = asciiLower(filter);
  return cells.some((cell) => asciiLower(lookupCellText(cell)).includes(needle));
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The parameter value for a picked key (REQ:typed-key-and-origin), or an
 * error message when the parameter cannot hold it.
 */
export function pickedParameterValue(
  parameter: Pick<IParameterDef, 'id' | 'title' | 'type'>,
  key: TypedValue,
): { value: string | number } | { error: string } {
  const kind = key.type === 'integer' || key.type === 'string' ? key.type : undefined;
  const label = parameter.title || parameter.id;
  if (!kind || !parameterAcceptsKey(parameter.type, kind))
    return { error: `This record's key cannot be used for ${label}: expected ${parameter.type}.` };
  if (parameter.type === 'integer') {
    const n = Number(key.value);
    if (!Number.isSafeInteger(n)) return { error: `This record's key is too large for ${label}.` };
    return { value: n };
  }
  return { value: String(key.value) };
}

/** Converts a raw explicit-lookup cell (agent JSON) into a TypedValue. */
export function rawCellToTypedValue(value: unknown): TypedValue {
  if (value === null || value === undefined) return { type: 'null', value: null } as TypedValue;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return { type: 'integer', value: String(value) };
  if (typeof value === 'number') return { type: 'number', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  return { type: 'string', value: String(value) };
}

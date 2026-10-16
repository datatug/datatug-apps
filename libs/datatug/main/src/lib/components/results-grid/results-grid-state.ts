/**
 * Pure helpers of the results grid's remembered layout and of its row exports: the storage key, the stored shape and
 * its validation, and the CSV/TSV text. No AG Grid code and no Angular here, so every rule is unit-testable.
 *
 * Privacy: only ids and layout numbers are ever stored (column ids, widths, visibility, pinning, sort direction,
 * density). Never a row value, a filter value, the quick-filter text, a prompt or a link code, and the key is built
 * from ids only.
 */

export const GRID_STATE_VERSION = 1;
export type GridDensity = 'comfortable' | 'compact';
export type GridPin = 'left' | 'right' | null;
export type GridSort = 'asc' | 'desc' | null;

/** The layout of one column, as `GridApi.getColumnState()` reports it (only these fields are kept). */
export interface StoredColumnState {
  readonly colId: string;
  readonly hide: boolean;
  readonly width?: number;
  readonly pinned: GridPin;
  readonly sort: GridSort;
  readonly sortIndex: number | null;
}

export interface StoredGridState {
  readonly v: typeof GRID_STATE_VERSION;
  readonly density: GridDensity;
  /** Signature of the columns the layout was saved for; the layout is ignored when the columns changed. */
  readonly sig?: string;
  /** Columns in screen order. */
  readonly cols?: readonly StoredColumnState[];
}

const KEY_PREFIX = `datatug.grid.v${GRID_STATE_VERSION}`;
const MAX_PART = 80;
const MAX_COLUMNS = 500;

/**
 * The storage key of a grid context: `datatug.grid.v1:<project>:<source or saved query or result id>:<kind>`. Each
 * part is an id (percent-encoded, so no part can contain the separator); undefined when the project or the context
 * is not known (nothing is then remembered).
 */
export function gridStateKey(parts: {
  readonly project: string | undefined | null;
  readonly context: string | undefined | null;
  readonly kind: 'query' | 'source' | 'result';
}): string | undefined {
  const part = (v: string | undefined | null) =>
    v ? encodeURIComponent(v).slice(0, MAX_PART) : '';
  const project = part(parts.project);
  const context = part(parts.context);
  return project && context
    ? `${KEY_PREFIX}:${project}:${context}:${parts.kind}`
    : undefined;
}

/** A short fingerprint (FNV-1a, 32 bit) of the column ids, names and types: it changes when the columns do. */
export function columnSignature(
  columns: readonly {
    readonly colId: string;
    readonly name?: string;
    readonly type?: string;
  }[],
): string {
  let h = 0x811c9dc5;
  const text = columns
    .map((c) => `${c.colId}\u0001${c.name ?? ''}\u0001${c.type ?? ''}`)
    .join('\u0002');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseColumn(raw: unknown): StoredColumnState | undefined {
  if (!isRecord(raw)) return undefined;
  const colId = raw['colId'];
  if (typeof colId !== 'string' || !colId || colId.length > 100)
    return undefined;
  const width = raw['width'];
  const pinned = raw['pinned'];
  const sort = raw['sort'];
  const sortIndex = raw['sortIndex'];
  return {
    colId,
    hide: raw['hide'] === true,
    ...(typeof width === 'number' &&
    Number.isFinite(width) &&
    width >= 20 &&
    width <= 3000
      ? { width: Math.round(width) }
      : {}),
    pinned: pinned === 'left' || pinned === 'right' ? pinned : null,
    sort: sort === 'asc' || sort === 'desc' ? sort : null,
    sortIndex:
      typeof sortIndex === 'number' &&
      Number.isInteger(sortIndex) &&
      sortIndex >= 0 &&
      sortIndex < MAX_COLUMNS
        ? sortIndex
        : null,
  };
}

/**
 * The remembered state from its stored text, checked field by field. The column layout is dropped (the density
 * stays) when the text is not ours, when the signature is not that of the current columns, or when its columns are
 * not exactly the current ones: a stale layout must never hide or reorder columns of another result.
 */
export function parseGridState(
  raw: string | null | undefined,
  currentSignature: string,
  currentColumnIds: readonly string[],
): StoredGridState | undefined {
  if (!raw || raw.length > 200_000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value['v'] !== GRID_STATE_VERSION) return undefined;
  const density: GridDensity =
    value['density'] === 'compact' ? 'compact' : 'comfortable';
  const cols = Array.isArray(value['cols'])
    ? (value['cols'] as unknown[])
        .slice(0, MAX_COLUMNS)
        .map(parseColumn)
        .filter((c): c is StoredColumnState => !!c)
    : [];
  const fresh =
    value['sig'] === currentSignature &&
    cols.length === currentColumnIds.length &&
    new Set(cols.map((c) => c.colId)).size === cols.length &&
    cols.every((c) => currentColumnIds.includes(c.colId));
  return {
    v: GRID_STATE_VERSION,
    density,
    ...(fresh ? { sig: currentSignature, cols } : {}),
  };
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Reads the remembered state; undefined when there is none, the storage is unavailable or the text is not valid. */
export function readGridState(
  key: string | undefined,
  currentSignature: string,
  currentColumnIds: readonly string[],
): StoredGridState | undefined {
  if (!key) return undefined;
  try {
    return parseGridState(
      storage()?.getItem(key),
      currentSignature,
      currentColumnIds,
    );
  } catch {
    return undefined;
  }
}

/** Remembers the state; false when the storage refused (private window, quota, blocked). */
export function writeGridState(
  key: string | undefined,
  state: StoredGridState,
): boolean {
  if (!key) return false;
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** One field of a tab-separated text: quoted (quotes doubled) when it holds a tab, a line break or a quote. */
export function tsvField(value: string | null | undefined): string {
  const text = value ?? '';
  return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Tab-separated text with a header line, the format a spreadsheet pastes into cells. */
export function toTsv(
  header: readonly string[],
  rows: readonly (readonly (string | null | undefined)[])[],
): string {
  return [header, ...rows].map((r) => r.map(tsvField).join('\t')).join('\n');
}

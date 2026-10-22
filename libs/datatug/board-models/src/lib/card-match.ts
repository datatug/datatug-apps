// Public API entry — see ../public_api.ts.
//
// Cell → card matching (spec/features/project-cards REQ: input-matching).

import { CardMatchRule, ProjectCardBrief } from './card';

/** What is known about a selected grid cell's column. */
export interface CardCellIdentity {
  /** Physical table, `table` or `schema.table`; absent for computed query columns. */
  table?: string;
  column: string;
  /** Meaning-graph identity, from semantic mapping or the FK's referenced column. */
  entity?: { entity: string; field: string };
}

/** Match precision, best first. */
export enum CardMatchRank {
  EntityField = 1,
  TableColumn = 2,
  Pattern = 3,
  Column = 4,
  ColumnPattern = 5,
}

export interface CardMatch {
  card: ProjectCardBrief;
  /** The card parameter the cell value binds to. */
  parameterId: string;
  rank: CardMatchRank;
}

const MAX_PATTERN = 128;
/**
 * Case-insensitive `*` / `?` wildcard match without a regular expression: the classic two-pointer walk that
 * remembers only the last `*`, so a stored pattern cannot cause exponential backtracking. Cost is at most
 * pattern x text steps, and both are bounded by {@link MAX_PATTERN} / the caller's names.
 */
function wildcardMatch(pattern: string, text: string): boolean {
  if (pattern.length > MAX_PATTERN || text.length > 4 * MAX_PATTERN) return false;
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let star = -1;
  let resume = 0;
  while (ti < t.length) {
    if (pi < p.length && p[pi] === '*') {
      star = pi++;
      resume = ti;
    } else if (pi < p.length && (p[pi] === '?' || p[pi] === t[ti])) {
      pi++;
      ti++;
    } else if (star >= 0) {
      pi = star + 1;
      ti = ++resume;
    } else return false;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

const isPattern = (s: string) => s.includes('*') || s.includes('?');
const str = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PATTERN;

/** Splits `[dbo].[Orders]`, `"public"."orders"`, `` `a`.`b` `` or `dbo.Orders` into parts. */
function tableParts(name: string): string[] {
  return name.split('.').map((p) => p.replace(/^[[\]"`]+|[[\]"`]+$/g, ''));
}

/** Compares the last two name parts; ignores schema when either side has none. */
function tableMatches(rule: string, table: string): boolean {
  const r = tableParts(rule);
  const t = tableParts(table);
  if (!wildcardMatch(r[r.length - 1], t[t.length - 1])) return false;
  if (r.length < 2 || t.length < 2) return true;
  return wildcardMatch(r[r.length - 2], t[t.length - 2]);
}

/** Rank of one rule against a cell, or undefined when it does not match or is malformed. */
export function matchRuleRank(
  rule: CardMatchRule,
  cell: CardCellIdentity,
): CardMatchRank | undefined {
  if (!rule || typeof rule !== 'object') return undefined;
  const r = rule as Record<string, unknown>;
  // Exactly one shape: {entity, field}, {table, column} or {column}; keys of two shapes mixed never match.
  const keys = Object.keys(r).filter((k) => r[k] !== undefined);
  const shape = (...allowed: string[]) =>
    keys.length === allowed.length && allowed.every((k) => keys.includes(k));
  if (!shape('entity', 'field') && !shape('table', 'column') && !shape('column'))
    return undefined;
  if (r['entity'] !== undefined || r['field'] !== undefined) {
    if (!str(r['entity']) || !str(r['field']))
      return undefined;
    const e = cell.entity;
    return e &&
      e.entity.toLowerCase() === r['entity'].toLowerCase() &&
      e.field.toLowerCase() === r['field'].toLowerCase()
      ? CardMatchRank.EntityField
      : undefined;
  }
  const column = r['column'];
  const table = r['table'];
  if (!str(column) || !wildcardMatch(column, cell.column)) return undefined;
  if (table === undefined)
    return isPattern(column) ? CardMatchRank.ColumnPattern : CardMatchRank.Column;
  if (!str(table) || !cell.table || !tableMatches(table, cell.table)) return undefined;
  return isPattern(table) || isPattern(column)
    ? CardMatchRank.Pattern
    : CardMatchRank.TableColumn;
}

/**
 * Cards whose required parameters match the cell, best rank first, ties by
 * title then id. One entry per card: its best-matching parameter.
 */
export function matchCards(
  cards: readonly ProjectCardBrief[],
  cell: CardCellIdentity,
): CardMatch[] {
  const matches: CardMatch[] = [];
  for (const card of cards) {
    let best: CardMatch | undefined;
    const params = Array.isArray(card?.parameters) ? card.parameters : [];
    for (const p of params) {
      if (!p?.isRequired || !Array.isArray(p.match)) continue;
      for (const rule of p.match) {
        const rank = matchRuleRank(rule, cell);
        if (rank !== undefined && (!best || rank < best.rank))
          best = { card, parameterId: p.id, rank };
      }
    }
    if (best) matches.push(best);
  }
  return matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.card.title ?? '').localeCompare(b.card.title ?? '') ||
      a.card.id.localeCompare(b.card.id),
  );
}

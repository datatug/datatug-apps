import {
  Board,
  BoardCard,
  BoardCardRef,
  BoardParameterDef,
  BoardWidget,
  CardCellIdentity,
  CardMatchRule,
  CARD_ID_PATTERN,
  CardParameterDef,
  ProjectCard,
  ProjectCardBrief,
  validateProjectCard,
} from '@datatug/board-models';

/** Pure helpers of the cards pages: templates, ids, labels, "save as card", cell identity. */

/** The id a card title suggests: lower-case words joined by `-`. */
export function slugifyCardId(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return slug || 'card';
}

/** `base`, else `base-2`, `base-3`… the first id not in `existing`. */
export function uniqueCardId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The card a new card page starts from: one tab, one text widget; passes validation. */
export function newCardTemplate(): ProjectCard {
  return {
    id: 'new-card',
    title: 'New card',
    display: 'panel',
    parameters: [],
    widget: {
      name: 'tabs',
      data: {
        tabs: [
          {
            id: 'details',
            title: 'Details',
            widgets: [
              {
                name: 'text',
                data: { markdown: 'Describe what this card shows.' },
              },
            ],
          },
        ],
      },
    },
  };
}

export type MatchRuleKind = 'entity' | 'table' | 'column';

export const MATCH_KIND_LABELS: Record<MatchRuleKind, string> = {
  entity: 'Entity field',
  table: 'Table and column',
  column: 'Column only',
};

/** Which shape a rule has (a rule with an `entity` is an entity.field rule). */
export function matchRuleKind(rule: CardMatchRule): MatchRuleKind {
  const r = rule as Record<string, unknown>;
  if (r['entity'] !== undefined || r['field'] !== undefined) return 'entity';
  return r['table'] !== undefined ? 'table' : 'column';
}

/** A rule as people read it: `Customer.CustomerID`, `Orders.CustomerID` or `CustomerID`. */
export function matchRuleText(rule: CardMatchRule): string {
  const r = rule as Record<string, string | undefined>;
  switch (matchRuleKind(rule)) {
    case 'entity':
      return `${r['entity'] ?? ''}.${r['field'] ?? ''}`;
    case 'table':
      return `${r['table'] ?? ''}.${r['column'] ?? ''}`;
    default:
      return r['column'] ?? '';
  }
}

/** One row of a rule for a given kind, keeping what the old kind already typed. */
export function matchRuleOfKind(
  kind: MatchRuleKind,
  previous?: CardMatchRule,
): CardMatchRule {
  const p = (previous ?? {}) as Record<string, string | undefined>;
  switch (kind) {
    case 'entity':
      return { entity: p['entity'] ?? '', field: p['field'] ?? p['column'] ?? '' };
    case 'table':
      return { table: p['table'] ?? '', column: p['column'] ?? p['field'] ?? '' };
    default:
      return { column: p['column'] ?? p['field'] ?? '' };
  }
}

/** Chips for a card's list row: `customerId ← Customer.CustomerID` (+N more rules). */
export function parameterChips(
  card: Pick<ProjectCardBrief, 'parameters'>,
): string[] {
  return (card.parameters ?? []).map((p) => {
    const rules = (p.match ?? []).map(matchRuleText).filter(Boolean);
    if (!rules.length) return p.id;
    return `${p.id} ← ${rules[0]}${rules.length > 1 ? ` +${rules.length - 1}` : ''}`;
  });
}

export function displayLabel(display: ProjectCardBrief['display']): string {
  return display === 'tooltip' ? 'Tooltip' : 'Panel';
}

/** Parameter definitions with blank match rows dropped; nothing else changes. */
export function cleanParameters(
  parameters: readonly CardParameterDef[] | undefined,
): CardParameterDef[] | undefined {
  if (!parameters?.length) return undefined;
  return parameters.map((p) => {
    const match = (p.match ?? []).filter((rule) =>
      Object.values(rule).every((v) => typeof v === 'string' && v.trim() !== ''),
    );
    const { match: _ignored, ...rest } = p;
    void _ignored;
    return match.length ? { ...rest, match } : { ...rest };
  });
}

/** A card ready to save: blank rows removed, empty optionals dropped. */
export function finishCard(card: ProjectCard): ProjectCard {
  const { parameters, description, ...rest } = card;
  const cleaned = cleanParameters(parameters);
  return {
    ...rest,
    ...(description?.trim() ? { description: description.trim() } : {}),
    ...(cleaned ? { parameters: cleaned } : {}),
  };
}

/** Tries {@link validateProjectCard}; returns the message instead of throwing. */
export function cardValidationError(card: unknown): string | undefined {
  try {
    validateProjectCard(card);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'The card is not valid.';
  }
}

/** The card with only its first tab, for the compact tooltip view. */
export function firstTabCard(card: ProjectCard): ProjectCard {
  const widget = card.widget as BoardWidget | undefined;
  const data = widget?.data as { tabs?: unknown[] } | undefined;
  if (widget?.name !== 'tabs' || !data?.tabs || data.tabs.length < 2)
    return card;
  return {
    ...card,
    widget: { ...widget, data: { ...data, tabs: [data.tabs[0]] } },
  };
}

/** Every board parameter id a widget graph binds (saved-query bindings and chart sources). */
export function boundBoardParameterIds(widget: BoardWidget | undefined): string[] {
  const ids = new Set<string>();
  const bindings = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      const id = (b as { boardParameterId?: unknown } | undefined)
        ?.boardParameterId;
      if (typeof id === 'string' && id) ids.add(id);
    }
  };
  const visit = (value: BoardWidget | undefined, depth: number): void => {
    if (!value || depth > 8) return;
    const data = value.data as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!data) return;
    if (value.name === 'SQL') bindings(data['sql']?.parameters);
    else if (value.name === 'fields') bindings(data['source']?.parameters);
    else if (value.name === 'chart' && Array.isArray(data['sources']))
      for (const s of data['sources']) bindings(s?.parameters);
    else if (value.name === 'tabs' && Array.isArray(data['tabs']))
      for (const tab of data['tabs']) {
        visit(tab?.widget, depth + 1);
        if (Array.isArray(tab?.widgets))
          for (const w of tab.widgets) visit(w, depth + 1);
      }
  };
  visit(widget, 0);
  return [...ids];
}

/**
 * "Save as project card" for an inline dashboard card (spec REQ:
 * dashboard-reference): a card whose parameters are copies of the board
 * parameters its widgets bind (same ids), and the `ref` the cell becomes,
 * binding each of them to the same board parameter. The id is the slugified
 * title, `-2`, `-3`… on collision.
 */
export function cardFromBoardCard(
  boardCard: BoardCard,
  board: Pick<Board, 'parameters'>,
  existingCardIds: Iterable<string>,
): { card: ProjectCard; ref: BoardCardRef } {
  if (!boardCard.widget) throw new Error('Only an inline card can be saved as a project card.');
  const bound = boundBoardParameterIds(boardCard.widget);
  const defs = bound.flatMap((id) => {
    const def = (board.parameters ?? []).find((p) => p.id === id);
    return def ? [JSON.parse(JSON.stringify(def)) as BoardParameterDef] : [];
  });
  const id = uniqueCardId(
    slugifyCardId(boardCard.title || boardCard.id).slice(0, 120),
    existingCardIds,
  );
  const card: ProjectCard = {
    id,
    title: boardCard.title || boardCard.id,
    display: 'panel',
    ...(defs.length ? { parameters: defs } : {}),
    widget: JSON.parse(JSON.stringify(boardCard.widget)) as BoardWidget,
  };
  validateProjectCard(card);
  if (!CARD_ID_PATTERN.test(id)) throw new Error('Invalid card id.');
  return {
    card,
    ref: {
      cardId: id,
      ...(defs.length
        ? {
            parameters: defs.map((d) => ({ id: d.id, boardParameterId: d.id })),
          }
        : {}),
    },
  };
}

/** A foreign key as the table metadata describes it; `refColumns` when the agent supplies them. */
export interface CellForeignKey {
  columns: readonly string[];
  refTable: { name: string; schema?: string };
  refColumns?: readonly string[];
}

/**
 * The identity of a selected cell: its physical table and column, plus the
 * meaning-graph `entity.field` when known (the semantic column mapping
 * first, else the foreign key's referenced table and column; without
 * `refColumns` the foreign key column's own name stands in).
 */
export function buildCellIdentity(parts: {
  schema?: string;
  table?: string;
  column: string;
  semantic?: { entity: string; field: string };
  foreignKeys?: readonly CellForeignKey[];
}): CardCellIdentity {
  const column = parts.column;
  const lower = column.toLowerCase();
  let entity = parts.semantic;
  if (!entity) {
    for (const fk of parts.foreignKeys ?? []) {
      const index = fk.columns.findIndex((c) => c.toLowerCase() === lower);
      if (index < 0) continue;
      entity = {
        entity: fk.refTable.name,
        field: fk.refColumns?.[index] ?? fk.columns[index],
      };
      break;
    }
  }
  return {
    column,
    ...(parts.table
      ? { table: parts.schema ? `${parts.schema}.${parts.table}` : parts.table }
      : {}),
    ...(entity ? { entity } : {}),
  };
}

/** A saved query as the widget pickers need it. */
export interface QueryPick {
  id: string;
  title?: string;
  parameters?: { id: string; type?: string; isRequired?: boolean }[];
}

/** Every query of a (nested) query folder, in tree order, capped. */
export function flattenQueryFolder(
  folder:
    | {
        items?: readonly { id: string; title?: string; parameters?: readonly { id: string; type?: string; isRequired?: boolean }[] }[];
        folders?: readonly unknown[];
      }
    | null
    | undefined,
  limit = 2000,
): QueryPick[] {
  const out: QueryPick[] = [];
  const walk = (node: typeof folder, depth: number): void => {
    if (!node || depth > 8) return;
    for (const item of node.items ?? []) {
      if (out.length >= limit) return;
      out.push({
        id: item.id,
        ...(item.title ? { title: item.title } : {}),
        ...(item.parameters
          ? { parameters: item.parameters.map((p) => ({ id: p.id, type: p.type, isRequired: p.isRequired })) }
          : {}),
      });
    }
    for (const child of node.folders ?? []) walk(child as typeof folder, depth + 1);
  };
  walk(folder, 0);
  return out;
}

/** A typed preview value from the text a person entered; blank means "not supplied". */
export function coercePreviewValue(type: string, text: string): unknown {
  if (type === 'record' || type === 'recordset') {
    if (text.trim() === '') return undefined;
    const parsed: unknown = JSON.parse(text);
    return parsed;
  }
  if (text === '') return undefined;
  if (['integer', 'number', 'float', 'money'].includes(type)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  if (type === 'boolean' || type === 'bit') return text.toLowerCase() === 'true';
  return text;
}

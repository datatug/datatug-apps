/**
 * "Related" links between a project's cards, entities and saved queries.
 *
 * A card names the entities it shows (each parameter's `meta.entity` and its
 * `match` rules) and the saved queries its widgets read (`queryId` anywhere in
 * the widget tree). The entity page reverses the same facts: the cards that
 * match the entity and the saved queries whose parameters mean one of its
 * fields. Everything here is pure so both pages share one definition.
 */

/** The parts of a card parameter the relations read. */
interface RelatedParameter {
  readonly meta?: { readonly entity?: string } | null;
  readonly match?: readonly { readonly entity?: string }[] | null;
}

/** The parts of a card (or card brief) the relations read. */
export interface RelatedCardShape {
  readonly id?: string;
  readonly title?: string;
  readonly parameters?: readonly RelatedParameter[] | null;
  readonly widget?: unknown;
}

const MAX_WALK_DEPTH = 32;

/** The entities a card shows, in first-mention order, without duplicates. */
export function cardEntityNames(card: RelatedCardShape): string[] {
  const names: string[] = [];
  const add = (name: string | undefined): void => {
    const trimmed = name?.trim();
    if (trimmed && !names.includes(trimmed)) names.push(trimmed);
  };
  for (const parameter of card.parameters ?? []) {
    add(parameter.meta?.entity);
    for (const rule of parameter.match ?? []) add(rule.entity);
  }
  return names;
}

/** The saved queries a card's widgets read, in first-mention order. */
export function cardQueryIds(card: RelatedCardShape): string[] {
  const ids: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > MAX_WALK_DEPTH) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'queryId' && typeof value === 'string') {
        const id = value.trim();
        if (id && !ids.includes(id)) ids.push(id);
      } else {
        walk(value, depth + 1);
      }
    }
  };
  walk(card.widget, 0);
  return ids;
}

/** Whether a card shows the entity (case-insensitive, as entity ids are). */
export function cardShowsEntity(
  card: RelatedCardShape,
  entity: string,
): boolean {
  const wanted = entity.trim().toLowerCase();
  return (
    !!wanted && cardEntityNames(card).some((n) => n.toLowerCase() === wanted)
  );
}

/** A saved query as a folder listing returns it. */
export interface RelatedQueryShape {
  readonly id: string;
  readonly title?: string;
  readonly parameters?: readonly RelatedParameter[] | null;
}

/** A folder listing: items plus nested folders. */
export interface RelatedQueryFolder {
  readonly items?: readonly RelatedQueryShape[] | null;
  readonly folders?: readonly unknown[] | null;
}

/** Saved queries with a parameter that means a field of the entity. */
export function queriesForEntity(
  folder: RelatedQueryFolder | null | undefined,
  entity: string,
  limit = 50,
): RelatedQueryShape[] {
  const wanted = entity.trim().toLowerCase();
  const out: RelatedQueryShape[] = [];
  if (!wanted) return out;
  const walk = (node: RelatedQueryFolder | null | undefined, depth: number) => {
    if (!node || depth > 8) return;
    for (const item of node.items ?? []) {
      if (out.length >= limit) return;
      if (
        (item.parameters ?? []).some(
          (p) => p.meta?.entity?.trim().toLowerCase() === wanted,
        )
      )
        out.push(item);
    }
    for (const child of node.folders ?? [])
      walk(child as RelatedQueryFolder, depth + 1);
  };
  walk(folder, 0);
  return out;
}

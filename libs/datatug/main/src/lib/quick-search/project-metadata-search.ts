/**
 * Instant Quick Search over the project metadata the app already reads to show the project (queries, boards,
 * entities, databases, sources, tables, columns and tags). Pure: no Angular, no I/O, nothing leaves the browser.
 *
 * The hosted Typesense index (`quick-search-api.service.ts`) stays an optional, consented speed-up: it uploads a
 * metadata snapshot to a third-party provider, which is why it asks for consent. Searching in memory uploads nothing
 * and only shows what this viewer could already open, so it needs no consent.
 */
import { friendlyError, isGithubRateLimit } from '@datatug/friendly-error';
import { IProjectRef } from '../core/project-context';
import { projectPageHref, withQuery } from '../nav/project-page-href';
import { SearchDocument, searchItemHref } from './quick-search-model';
import { fold } from '../components/query-list-item/highlight-parts';

export {
  fold,
  highlightParts,
  type HighlightPart,
} from '../components/query-list-item/highlight-parts';

export const metadataKinds = [
  'query',
  'board',
  'check',
  'entity',
  'database',
  'source',
  'table',
  'column',
  'tag',
] as const;
export type MetadataKind = (typeof metadataKinds)[number];

export const metadataGroupTitles: Record<MetadataKind, string> = {
  query: 'Queries',
  board: 'Boards',
  check: 'Checks',
  entity: 'Entities',
  database: 'Databases',
  source: 'Sources',
  table: 'Tables',
  column: 'Columns',
  tag: 'Tags',
};
export const metadataKindNames: Record<MetadataKind, string> = {
  query: 'Query',
  board: 'Board',
  check: 'Check',
  entity: 'Entity',
  database: 'Database',
  source: 'Source',
  table: 'Table',
  column: 'Column',
  tag: 'Tag',
};
export const metadataKindIcons: Record<MetadataKind, string> = {
  query: 'code-slash-outline',
  board: 'bar-chart-outline',
  check: 'checkmark-circle-outline',
  entity: 'cube-outline',
  database: 'server-outline',
  source: 'layers-outline',
  table: 'grid-outline',
  column: 'list-outline',
  tag: 'pricetag-outline',
};

export interface MetadataItem {
  readonly kind: MetadataKind;
  readonly id: string;
  /** What the item is called on its own page. */
  readonly title: string;
  /** Where it lives (folder, table, database), shown as secondary text. */
  readonly context?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  /** A view rather than a base table; same group, its own icon. */
  readonly icon?: string;
  /** Closed app route; never a provider-supplied URL. */
  readonly href?: string;
  /** Queries only: the stored `request.queryType` (SQL, TugQL, HTTP…), shown as the query type badge. */
  readonly queryType?: string;
  /** Queries only: the store-assigned creation instant, shown like every other query row. */
  readonly createdAt?: string;
}

export type MatchField = 'title' | 'id' | 'tag' | 'description';
export interface MetadataMatch {
  readonly item: MetadataItem;
  readonly field: MatchField;
  /** The text that matched, for the secondary line when it is not the title. */
  readonly matched: string;
  readonly rank: number;
}

const fieldRank: Record<MatchField, number> = {
  title: 0,
  id: 2,
  tag: 3,
  description: 5,
};

/**
 * Case-insensitive substring match over the title, the last segment of the ID, tags and description. Where an item
 * lives (its context) is not matched: every column of a matching table would match too. Best match first.
 */
export function matchMetadata(
  items: readonly MetadataItem[],
  query: string,
): MetadataMatch[] {
  const q = fold(query.trim());
  if (!q) return [];
  const matches: MetadataMatch[] = [];
  for (const item of items) {
    const candidates: [MatchField, string][] = [
      ['title', item.title],
      ['id', item.id.split('/').pop() || item.id],
      ...item.tags.map((tag): [MatchField, string] => ['tag', tag]),
      ['description', item.description || ''],
    ];
    for (const [field, text] of candidates) {
      const at = text ? fold(text).indexOf(q) : -1;
      if (at < 0) continue;
      // A title that starts with the query outranks one that merely contains it.
      const rank = fieldRank[field] + (field === 'title' && at > 0 ? 1 : 0);
      matches.push({ item, field, matched: text, rank });
      break;
    }
  }
  return matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.title.length - b.item.title.length ||
      a.item.title.localeCompare(b.item.title),
  );
}

export interface MetadataGroup {
  readonly kind: MetadataKind;
  readonly title: string;
  readonly icon: string;
  readonly total: number;
  readonly matches: readonly MetadataMatch[];
}

/** Groups in a fixed order (Queries first); `limit` caps each group, `total` keeps the full count. */
export function groupMatches(
  matches: readonly MetadataMatch[],
  limit = Number.POSITIVE_INFINITY,
): MetadataGroup[] {
  return metadataKinds
    .map((kind) => {
      const all = matches.filter((m) => m.item.kind === kind);
      return {
        kind,
        title: metadataGroupTitles[kind],
        icon: metadataKindIcons[kind],
        total: all.length,
        matches: all.slice(0, limit),
      };
    })
    .filter((group) => group.total > 0);
}

/** The secondary line: where the item lives, plus why it matched when that was not its title. */
export function matchSecondary(match: MetadataMatch): string {
  const { item, field, matched } = match;
  const why =
    field === 'tag'
      ? `Tag: ${matched}`
      : field === 'id'
        ? `ID: ${item.id}`
        : field === 'description'
          ? matched
          : '';
  return [metadataKindNames[item.kind], item.context, why]
    .filter(Boolean)
    .join(' · ');
}

/** Secondary lines for one group; two items that read the same also show their IDs, so they can be told apart. */
export function secondaryLines(matches: readonly MetadataMatch[]): string[] {
  const lines = matches.map(matchSecondary);
  const seen = new Map<string, number>();
  for (const [i, m] of matches.entries()) {
    const key = fold(m.item.title) + '|' + lines[i];
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return matches.map((m, i) =>
    (seen.get(fold(m.item.title) + '|' + lines[i]) || 0) > 1 && m.field !== 'id'
      ? `${lines[i]} · ID: ${m.item.id}`
      : lines[i],
  );
}

/** Hosted-index results in the same shape, merged in when a consented index is ready. */
export function fromSearchDocument(
  ref: IProjectRef,
  doc: SearchDocument,
): MetadataItem | undefined {
  const kind: MetadataKind | undefined = (
    {
      query: 'query',
      dashboard: 'board',
      check: 'check',
      entity: 'entity',
      environment: 'source',
      table: 'table',
      view: 'table',
      column: 'column',
      tag: 'tag',
    } as Partial<Record<SearchDocument['kind'], MetadataKind>>
  )[doc.kind];
  if (!kind) return undefined;
  return {
    kind,
    id: doc.id,
    title: doc.name,
    context:
      doc.kind === 'column'
        ? [doc.parentName, doc.sourceName].filter(Boolean).join(' · ')
        : doc.kind === 'table' || doc.kind === 'view'
          ? [doc.sourceName, doc.reference.schema].filter(Boolean).join(' · ')
          : doc.parentName || doc.sourceName,
    tags: doc.tags,
    ...(doc.kind === 'view' ? { icon: 'eye-outline' } : {}),
    href: searchItemHref(ref, doc),
  };
}

export function tagHref(ref: IProjectRef, name: string): string {
  const params = new URLSearchParams({ name });
  return withQuery(projectPageHref(ref, ['tags']), params.toString());
}

/**
 * Honest words for a failed metadata read or hosted search. The raw error is never shown: no URL, token, body,
 * stack or `undefined`. A GitHub rate limit or an expired sign-in is never worded as missing project access.
 */
export function quickSearchErrorMessage(
  error: unknown,
  fallback = 'Some project metadata could not be read. Try again.',
  viewer: { readonly signedIn?: boolean } = {},
): string {
  const code = hostedErrorCode(error);
  switch (code) {
    case 'consent_required':
      return 'The hosted search index for this project is not enabled.';
    case 'quick_search_reindex_required':
      return 'The hosted search index is out of date and needs a refresh in Index settings.';
    case 'quick_search_rate_limited':
      return 'Too many searches in a short time. Wait a minute, then search again.';
    case 'search_unavailable':
    case 'provider_unavailable':
      return 'Search is temporarily unavailable. Try again in a few minutes.';
    case 'project_denied':
      return 'Your account cannot search this project. Sign in with an account that has access.';
  }
  // Decided from the status, address and error code (the shared detector), never from display words.
  if (isGithubRateLimit(error))
    return 'GitHub is limiting anonymous reads of this project right now. Wait a few minutes, or sign in, then search again.';
  const status =
    error && typeof error === 'object'
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 429)
    return 'Too many requests. Wait a minute, then search again.';
  const friendly = friendlyError(error, 'this project');
  switch (friendly.kind) {
    case 'rate-limit':
      return 'Too many requests. Wait a minute, then search again.';
    case 'unauthenticated':
      return viewer.signedIn
        ? 'Your sign-in has expired. Sign in again, then search.'
        : 'Sign in to search this project.';
    case 'forbidden':
      return 'You do not have access to this project.';
    case 'not-found':
      return 'This project could not be found. It may have been moved or renamed.';
    case 'offline':
      return 'Could not connect. Check your connection, then try again.';
    case 'timeout':
      return 'Reading the project took too long. Try again.';
    default:
      return fallback;
  }
}

/** The `{error:{code}}` of a hosted Quick Search response, when there is one. */
function hostedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const body = (error as { error?: unknown }).error;
  if (!body || typeof body !== 'object') return undefined;
  const inner = (body as { error?: unknown }).error;
  const code =
    inner && typeof inner === 'object'
      ? (inner as { code?: unknown }).code
      : (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Whether the auth state is a signed-in person (not signed out, still signing in, or an anonymous session). */
export function isSignedInViewer(auth: {
  readonly status?: string;
  readonly user?: {
    readonly uid?: string;
    readonly isAnonymous?: boolean;
  } | null;
}): boolean {
  return (
    auth.status === 'authenticated' &&
    !!auth.user?.uid &&
    auth.user.isAnonymous !== true
  );
}

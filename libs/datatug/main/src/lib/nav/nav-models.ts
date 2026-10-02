import { IStoreRef, parseStoreRef } from '@sneat/core';
import { IProjectRef } from '../core/project-context';
import { ITableFull } from '../models/definition/apis/database';
import { IEnvironmentSummary } from '../models/definition/environments';
import { IProjectSummary, IProjEnv } from '../models/definition/project';
import { IDatatugStoreBrief, IProjectBrief } from '../models/interfaces';
import {
  asciiLowerCase,
  formatGithubProjectId,
  GITHUB_DEFAULT_BRANCH_REF,
  GITHUB_OWNER_PATTERN,
  GITHUB_REPO_PATTERN,
  GITHUB_STORE_ID,
  IGithubProjectId,
  splitGithubProjectId,
} from './github-project-address';

/**
 * Matches a bare `host:port` store id, e.g. `"localhost:8989"`. Deliberately
 * does NOT match an `http-`/`https-` prefixed id (`"http-localhost:8989"`)
 * even though `-` is not excluded by the character class below — that form
 * must fall through to `parseStoreRef()` so its `-` gets turned into `://`
 * (see the `startsWith` guard in `parseDatatugStoreRef` below).
 */
const HOST_PORT_STORE_ID = /^[^\s:@/]+:\d+$/;

/**
 * Matches a legacy full-URL store id/key, e.g. `"http://localhost:8989"` —
 * a form some historic `IDatatugBriefForUser.stores` records still hold
 * (`libs/datatug/main/src/lib/models/interfaces.ts`), predating PR #109's
 * switch of the default local-agent entry to the canonical dash-prefixed
 * key `LOCALHOST_AGENT_STORE_ID` (`"http-localhost:8989"`). A user record
 * keyed this way is already recognised elsewhere as "a localhost store
 * exists" (`isLocalhostAgentStoreId()`, same file), but until S165 this
 * function itself rejected the key outright — `MyStoresComponent.goStore()`
 * → `parseDatatugStoreRef(brief.id)` threw
 * `unsupported format of store id:http://localhost:8989` (founder,
 * 2026-09-11 follow-up 5).
 *
 * Accepts one optional trailing slash — `"http://host:port"` and
 * `"http://host:port/"` name the same agent, so the slash carries no
 * information and is stripped on normalisation. Anything past that (a path,
 * query, or fragment) is deliberately NOT matched: the id names an agent's
 * origin, never a sub-resource, so `"http://host:port/some/path"` falls
 * through to `parseStoreRef()` and throws `unsupported format of store id`
 * like any other malformed id, rather than silently discarding the path.
 */
const HTTP_URL_STORE_ID = /^(https?):\/\/([^/\s]+)\/?$/;

/**
 * Wraps `@sneat/core`'s `parseStoreRef()`. That function only recognises
 * `'firestore'` | `'github'` | `'github.com'` | an `'http-'`/`'https-'`
 * prefixed id, and throws `unsupported format of store id` for anything
 * else — including the bare `host:port` form (`"localhost:8989"`) that
 * `getStoreUrl()` (`@sneat/api`) and every local-agent "connect" flow in
 * this app use as the canonical store id. Recognise that form here, before
 * delegating, so every store-id parse site in datatug-apps accepts it
 * (`unsupported format of store id:localhost:8989` was thrown live
 * navigating to a store/project on a local agent — see
 * `spec/research/2026-09-09-web-ui-audit.md`).
 *
 * The bare-`host:port` short-circuit below must NOT fire for an
 * `http-`/`https-` prefixed id: `HOST_PORT_STORE_ID` matches
 * `"http-localhost:8989"` too (`-` is not excluded by the id's character
 * class), so without the `startsWith` guard this function used to return
 * `{ type: 'agent', url: 'http-localhost:8989' }` — the raw id, verbatim,
 * never converted to a real URL. `parseStoreRef()` is the only place that
 * turns the `-` into `://`, and it only runs for ids WITHOUT a port
 * (`"http-example.com"`), so `"http-localhost:8989"` (the exact form
 * `datatug serve` prints — datatug-cli PR #198) never got a working `.url`.
 * That silently broke every consumer that reads `ref.url` expecting a
 * fetchable URL (e.g. the store page title — see
 * `datatug-store-page.component.ts`'s `storeIdToDisplayLabel` use).
 *
 * Task 13 (S108): this bare/`http-`/`https-` `host:port` id is the ONE
 * store-id/agent-URL convention this app supports. The read-only worktree
 * `.worktrees/datatug-apps-layered-acl-query` registers a second, competing
 * convention (`pwa/repo/:repo/agent/:agentId`); it is deliberately not
 * ported here — see `datatug-app-routes.ts`'s own comment and
 * `spec/research/2026-09-09-layered-acl-reconciliation.md` (datatug/datatug).
 *
 * S165: a legacy full-URL id (`"http://localhost:8989"`, see
 * `HTTP_URL_STORE_ID` above) is ALSO accepted as input — normalised to the
 * canonical dash-prefixed id before delegating, so the returned ref (and
 * every downstream consumer of it) behaves exactly as for the canonical
 * id. This is input tolerance only: the convention above is unchanged, and
 * this function never itself emits a URL-form id.
 */
export function parseDatatugStoreRef(storeId?: string): IStoreRef {
  if (
    storeId &&
    !storeId.startsWith('http-') &&
    !storeId.startsWith('https-') &&
    HOST_PORT_STORE_ID.test(storeId)
  ) {
    return { type: 'agent', url: storeId };
  }
  if (storeId) {
    const urlMatch = HTTP_URL_STORE_ID.exec(storeId);
    if (urlMatch) {
      const [, protocol, hostPort] = urlMatch;
      // Normalise to the canonical dash-prefixed id and fall through to
      // the same `parseStoreRef()` delegation as `"http-localhost:8989"`
      // below — `.url` comes back as the real `http(s)://…` URL (minus any
      // trailing slash) via that function's `-` → `://` conversion, so
      // route segment (`getStoreId()`), display label, and agent detection
      // all behave identically to the canonical id.
      storeId = `${protocol}-${hostPort}`;
    }
  }
  return parseStoreRef(storeId);
}

/**
 * Turns a store id into a human-readable label for UI display. An
 * `'agent'` store id — bare `host:port`, or `http-`/`https-` prefixed —
 * displays as the actual URL the browser will call
 * (`"http://localhost:8989"`) rather than the raw id
 * (`"http-localhost:8989"`); every other store type (`firestore`, `github`,
 * `gitlab`) has no more informative form, so it keeps showing its id.
 * Never throws: falls back to the raw id for anything
 * `parseDatatugStoreRef` cannot parse, so a display site never has to
 * guard this call with try/catch.
 */
export function storeIdToDisplayLabel(storeId?: string | null): string {
  if (!storeId) {
    return '';
  }
  try {
    const ref = parseDatatugStoreRef(storeId);
    return ref.type === 'agent' && ref.url ? ref.url : storeId;
  } catch {
    return storeId;
  }
}

/**
 * True when a store id addresses a DataTug CLI agent (`datatug serve`) —
 * bare `host:port`, or `http-`/`https-` prefixed — in any of the forms
 * `parseDatatugStoreRef` accepts. Never throws: an unparseable id is simply
 * not an agent, so callers can branch on it before deciding whether to fail.
 */
export function isAgentStoreId(storeId?: string | null): boolean {
  if (!storeId) {
    return false;
  }
  try {
    return parseDatatugStoreRef(storeId).type === 'agent';
  } catch {
    return false;
  }
}

export interface IDatatugStoreContext {
  readonly ref: IStoreRef;
  readonly brief?: IDatatugStoreBrief;
}

export interface IProjectContext {
  readonly ref: IProjectRef;
  readonly store?: IDatatugStoreContext;
  readonly brief?: IProjectBrief;
  readonly summary?: IProjectSummary;
}

export function newProjectBriefFromSummary(
  summary: IProjectSummary,
  brief?: IProjectBrief,
): IProjectBrief {
  return {
    ...brief,
    access: summary.access,
    title: summary.title,
    // titleOverride: summary.t
  };
}

export function populateProjectBriefFromSummaryIfMissing(
  p?: IProjectContext,
): IProjectContext | undefined {
  if (p?.summary && !p.brief) {
    p = { ...p, brief: newProjectBriefFromSummary(p.summary) };
  }
  return p;
}

export function newProjectContextFromRef(ref: IProjectRef): IProjectContext {
  return { ref, store: { ref: parseDatatugStoreRef(ref.storeId) } };
}

export interface IEnvContext {
  readonly id: string;
  readonly brief?: IProjEnv;
  readonly summary?: IEnvironmentSummary;
}

export interface IEnvDbContext {
  readonly id: string;
}

export interface IEnvDbTableContext {
  schema: string;
  name: string;
  meta?: ITableFull;
}

export interface IDatatugNavContext {
  readonly projectId?: string;
  readonly envId?: string;
  readonly dbId?: string;
}

export interface IAgentContext {
  protocol: 'http' | 'https';
  host: string;
  port: number;
}

export const getStoreId = (repo: string): string => {
  return (repo || '').replace(/(https?):\/\//, '$1-');
};

// ---------------------------------------------------------------------------
// Project addresses (design `demo-as-github-project.md` 3.1, 3.3, 3.4, 3.4a)
//
// Two shapes of a project path exist, and these two functions are the one place that knows them:
//   - GitHub projects: `/project/github.com/<owner>/<repo>[/tree/<ref>[/<dir>…]][/-/<page>…]` (canonical);
//   - every store, GitHub included for as long as it is accepted: `/store/<storeId>/project/<projectId>[/<page>…]`.
// Both are paths (a `Location.pathname`), never a path with a query string or a fragment.
// ---------------------------------------------------------------------------

const PROJECT_FILE_NAME = 'datatug-project.json';

/** Why an address is not accepted. The app words each one for the visitor (design 3.4a). */
export type ProjectUrlErrorReason =
  /** Not a project address at all (another route). Not an error to show. */
  | 'not-a-project-address'
  /** The owner or the repo is not a name GitHub allows (this also covers `%2F`, unicode look-alikes). */
  | 'invalid-owner-or-repo'
  /** A segment that cannot be part of a project locator: `.`/`..`, an encoded `/` or `%`, a control character, `?`, `#`, an empty segment, a `-` where a page was expected. */
  | 'invalid-path-segment'
  /** `@` in a directory or a ref: it separates the parts of the project id. */
  | 'at-sign-not-supported'
  /** A directory segment named `-`: the first `-` ends the project locator. */
  | 'dash-directory-not-supported'
  /** `blob/…` of anything but the project file: a link to a file. */
  | 'file-link'
  /** `…/tree` with no ref. */
  | 'missing-ref';

export interface IProjectUrlError {
  readonly ok: false;
  readonly reason: ProjectUrlErrorReason;
}

export interface IProjectUrlParts {
  readonly ok: true;
  readonly storeId: string;
  readonly projectId: string;
  /** What follows the project locator, exactly as typed: `''`, or a path beginning with `/` (`/chat`). */
  readonly rest: string;
  /** `short` = `/project/github.com/…`; `legacy` = `/store/<storeId>/project/<projectId>`. */
  readonly shape: 'short' | 'legacy';
  /** The one address of this project and page (design 3.4a), `rest` kept. */
  readonly canonicalPath: string;
  /** False when the typed path is another spelling of `canonicalPath` (case, `.git`, a trailing slash, `tree/HEAD`, a `blob/` link, the legacy GitHub shape). */
  readonly isCanonical: boolean;
  /**
   * The ref typed in a short GitHub address when it is not `HEAD`: a branch, a tag or a SHA. When it names the
   * repo's default branch the caller must (with one GitHub API call) rewrite it to `HEAD`; it cannot be known here.
   */
  readonly namedRef?: string;
}

function isGithubStoreId(storeId: string): boolean {
  return storeId === GITHUB_STORE_ID || storeId === 'github';
}

/** What a project locator segment may not contain once decoded: it would re-split or re-route the path. */
const UNSAFE_SEGMENT_CHARS = '/\\%?#';

function isSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') {
    return false;
  }
  for (let i = 0; i < segment.length; i++) {
    const code = segment.charCodeAt(i);
    if (
      code < 0x20 ||
      code === 0x7f ||
      UNSAFE_SEGMENT_CHARS.includes(segment[i])
    ) {
      return false;
    }
  }
  return true;
}

/** A project locator segment, decoded once; `undefined` when it cannot be one. */
function decodeLocatorSegment(raw: string): string | undefined {
  try {
    const decoded = decodeURIComponent(raw);
    return isSafeSegment(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

const encodeSegments = (segments: readonly string[]): string =>
  segments.map((s) => encodeURIComponent(s)).join('/');

/** Whether a GitHub id can be written as `/project/github.com/<owner>/<repo>[/tree/<ref>[/<dir>…]]`. */
function isRepresentableAsShortGithubPath(p: IGithubProjectId): boolean {
  const pathPart = (segment: string) =>
    isSafeSegment(segment) && !segment.includes('@');
  return (
    GITHUB_OWNER_PATTERN.test(p.org ?? '') &&
    GITHUB_REPO_PATTERN.test(p.repo ?? '') &&
    !p.repo.endsWith('.git') &&
    (p.folder === '' ||
      p.folder.split('/').every((s) => s !== '-' && pathPart(s))) &&
    (p.ref === undefined || pathPart(p.ref))
  );
}

/** The canonical short path of a GitHub project id; `undefined` when the id cannot be written in that shape. */
function shortGithubPath(projectId: string, rest: string): string | undefined {
  const parts = splitGithubProjectId(projectId);
  if (!isRepresentableAsShortGithubPath(parts)) {
    return undefined;
  }
  const base = `/project/${GITHUB_STORE_ID}/${parts.org}/${parts.repo}`;
  if (parts.ref === undefined && parts.folder === '') {
    return base + rest;
  }
  const ref = encodeURIComponent(parts.ref ?? GITHUB_DEFAULT_BRANCH_REF);
  const dir = parts.folder ? `/${encodeSegments(parts.folder.split('/'))}` : '';
  return `${base}/tree/${ref}${dir}${rest ? '/-' + rest : ''}`;
}

function normalisePage(page?: string): string {
  const trimmed = (page ?? '').replace(/^\/+/, '');
  return trimmed ? '/' + trimmed : '';
}

/**
 * The one path of a project, and of one of its pages (`page` is `'chat'`, `'queries/x'`, with or without a
 * leading `/`). A GitHub project gets its short address (`/project/github.com/<owner>/<repo>…`); every other
 * store `/store/<storeId>/project/<projectId>`. A GitHub id that cannot be written in the short shape (an `@`-less
 * or odd id, a directory segment named `-`) keeps the `/store/…` shape, which still opens it.
 */
export function projectUrl(ref: IProjectRef, page?: string): string {
  const rest = normalisePage(page);
  if (isGithubStoreId(ref.storeId)) {
    const short = shortGithubPath(ref.projectId, rest);
    if (short !== undefined) {
      return short;
    }
  }
  return `/store/${getStoreId(ref.storeId)}/project/${ref.projectId}${rest}`;
}

/**
 * Reads a project path (a pathname: no query, no fragment) in either shape into the `{storeId, projectId}` pair
 * every page already reads from the route, plus what follows (`rest`), the one canonical spelling, and, for an
 * address that cannot be a project, why (`ok: false`). Pure: it makes no request, so whether a named ref is the
 * default branch is left to the caller (`namedRef`).
 */
export function parseProjectUrl(
  path: string,
): IProjectUrlParts | IProjectUrlError {
  const notOurs: IProjectUrlError = {
    ok: false,
    reason: 'not-a-project-address',
  };
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return notOurs;
  }
  const segments = path.slice(1).split('/');
  if (segments[0] === 'project') {
    return segments[1] === GITHUB_STORE_ID
      ? parseShortGithubPath(path, segments)
      : notOurs;
  }
  if (
    segments[0] === 'store' &&
    segments[2] === 'project' &&
    segments[1] &&
    segments[3]
  ) {
    return parseLegacyPath(path, segments);
  }
  return notOurs;
}

function parseLegacyPath(
  path: string,
  segments: string[],
): IProjectUrlParts | IProjectUrlError {
  const storeId = decodeLocatorSegment(segments[1]);
  const projectId = decodeLocatorSegment(segments[3]);
  if (storeId === undefined || projectId === undefined) {
    return { ok: false, reason: 'invalid-path-segment' };
  }
  const restSegments = segments.slice(4);
  if (restSegments[restSegments.length - 1] === '') {
    restSegments.pop();
  }
  const rest = restSegments.length > 0 ? '/' + restSegments.join('/') : '';
  if (!isGithubStoreId(storeId)) {
    return {
      ok: true,
      storeId,
      projectId,
      rest,
      shape: 'legacy',
      canonicalPath: path,
      isCanonical: true,
    };
  }
  const parts = projectId.split('@');
  if (parts.length < 2 || parts.length > 4) {
    return {
      ok: false,
      reason:
        parts.length < 2 ? 'not-a-project-address' : 'at-sign-not-supported',
    };
  }
  const id = splitGithubProjectId(projectId);
  if (
    !GITHUB_OWNER_PATTERN.test(id.org ?? '') ||
    !GITHUB_REPO_PATTERN.test(id.repo ?? '')
  ) {
    return { ok: false, reason: 'invalid-owner-or-repo' };
  }
  const canonicalId = formatGithubProjectId(id);
  const shortPath = shortGithubPath(canonicalId, rest);
  // An id the short shape cannot express (a directory segment named `-`) keeps its old address.
  const canonicalPath = shortPath ?? path;
  return {
    ok: true,
    storeId: GITHUB_STORE_ID,
    projectId: canonicalId,
    rest,
    shape: 'legacy',
    canonicalPath,
    isCanonical: canonicalPath === path,
    ...(id.ref ? { namedRef: id.ref } : {}),
  };
}

function parseShortGithubPath(
  path: string,
  segments: string[],
): IProjectUrlParts | IProjectUrlError {
  const raw = segments.slice(2);
  const trailingSlash = raw.length > 0 && raw[raw.length - 1] === '';
  if (trailingSlash) {
    raw.pop();
  }
  if (raw.length < 2) {
    return { ok: false, reason: 'not-a-project-address' };
  }
  const owner = decodeLocatorSegment(raw[0]);
  let repo = decodeLocatorSegment(raw[1]);
  if (
    repo !== undefined &&
    repo.length >= 4 &&
    asciiLowerCase(repo).endsWith('.git')
  ) {
    repo = repo.slice(0, -4);
  }
  if (
    owner === undefined ||
    repo === undefined ||
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPO_PATTERN.test(repo)
  ) {
    return { ok: false, reason: 'invalid-owner-or-repo' };
  }
  const after = raw.slice(2);
  let ref: string | undefined;
  const dirs: string[] = [];
  let restSegments: string[] = after;

  if (after[0] === 'tree' || after[0] === 'blob') {
    const isBlob = after[0] === 'blob';
    const refSegment =
      after[1] === undefined ? undefined : decodeLocatorSegment(after[1]);
    if (after[1] === undefined) {
      return { ok: false, reason: isBlob ? 'file-link' : 'missing-ref' };
    }
    if (refSegment === undefined) {
      return { ok: false, reason: 'invalid-path-segment' };
    }
    if (refSegment.includes('@')) {
      return { ok: false, reason: 'at-sign-not-supported' };
    }
    ref = refSegment;
    let tail = after.slice(2);
    restSegments = [];
    if (isBlob) {
      // A pasted link to the project file itself: `blob/<ref>/<dir>/datatug-project.json`.
      if (tail[tail.length - 1] !== PROJECT_FILE_NAME) {
        return { ok: false, reason: 'file-link' };
      }
      tail = tail.slice(0, -1);
    } else {
      const dash = tail.indexOf('-');
      if (dash !== -1) {
        restSegments = tail.slice(dash + 1);
        tail = tail.slice(0, dash);
      }
    }
    for (const segment of tail) {
      const dir = decodeLocatorSegment(segment);
      if (dir === undefined) {
        return { ok: false, reason: 'invalid-path-segment' };
      }
      if (dir === '-') {
        return { ok: false, reason: 'dash-directory-not-supported' };
      }
      if (dir.includes('@')) {
        return { ok: false, reason: 'at-sign-not-supported' };
      }
      dirs.push(dir);
    }
  } else if (after[0] === '-') {
    return { ok: false, reason: 'invalid-path-segment' };
  }

  const namedRef =
    ref !== undefined && ref !== GITHUB_DEFAULT_BRANCH_REF ? ref : undefined;
  const folder = dirs.join('/');
  const owned: IGithubProjectId = {
    repo: asciiLowerCase(repo),
    org: asciiLowerCase(owner),
    folder,
    ...(namedRef ? { ref: namedRef } : {}),
  };
  const projectId = formatGithubProjectId(owned);
  const rest = restSegments.length > 0 ? '/' + restSegments.join('/') : '';
  const canonicalPath = shortGithubPath(projectId, rest) as string;
  return {
    ok: true,
    storeId: GITHUB_STORE_ID,
    projectId,
    rest,
    shape: 'short',
    canonicalPath,
    isCanonical: canonicalPath === path,
    ...(namedRef ? { namedRef } : {}),
  };
}

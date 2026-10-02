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
  isSafePathSegment,
  isValidGithubFolder,
  isValidGithubRef,
  readGithubProjectId,
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
// Two shapes of a project path exist, and these functions are the one place that knows them:
//   - GitHub projects: `/project/github.com/<owner>/<repo>[/tree/<ref>[/<dir>…]][/-/<page>…]` (canonical);
//   - every store, GitHub included for as long as it is accepted: `/store/<storeId>/project/<projectId>[/<page>…]`.
// Both are paths (a `Location.pathname`), never a path with a query string or a fragment.
//
// Contract: for every `{storeId, projectId}` and page that `projectUrl` accepts, `parseProjectUrl` reads the
// returned path back as that same project (the canonical id) and page; everything else is refused, never turned
// into the address of another project.
// ---------------------------------------------------------------------------

const PROJECT_FILE_NAME = 'datatug-project.json';

/** Why an address is not accepted. The app words each one for the visitor (design 3.4a). */
export type ProjectUrlErrorReason =
  /** Not a project address at all (another route). Not an error to show. */
  | 'not-a-project-address'
  /** The owner or the repo is not a name GitHub allows (this also covers `%2F`, `.git.git`, unicode look-alikes). */
  | 'invalid-owner-or-repo'
  /** A segment that cannot be part of a project locator or a page: `.`/`..`, an encoded `/` or `%`, a control character, leading or trailing whitespace, `?`, `#`, an empty segment, a `-` where a page was expected. */
  | 'invalid-path-segment'
  /** `@` in a directory or a ref: it separates the parts of the project id. */
  | 'at-sign-not-supported'
  /** A directory segment named `-`: the first `-` ends the project locator. */
  | 'dash-directory-not-supported'
  /** `blob/…` of anything but the project file: a link to a file. */
  | 'file-link'
  /** `…/tree` with no ref. */
  | 'missing-ref'
  /** A spelling of the GitHub store id other than `github.com` or `github` (`GitHub.com`): never a different store. */
  | 'unsupported-store-id'
  /** `projectUrl` only: the id or the page has no exact address. */
  | 'not-representable';

export interface IProjectUrlError {
  readonly ok: false;
  readonly reason: ProjectUrlErrorReason;
}

/** What `projectUrl` throws. */
export class ProjectUrlError extends Error {
  constructor(public readonly reason: ProjectUrlErrorReason) {
    super(`no exact project address (${reason})`);
    this.name = 'ProjectUrlError';
  }
}

/** The parts of a GitHub project: owner and repo lower case; `folder` as in the id (`''` = repo root); `ref` only when it is not the default branch. */
export interface IGithubProjectParts {
  readonly owner: string;
  readonly repo: string;
  readonly folder: string;
  readonly ref?: string;
}

export interface IProjectUrlParts {
  readonly ok: true;
  readonly storeId: string;
  readonly projectId: string;
  /** What follows the project locator: `''`, or a path beginning with `/` (`/chat`), every segment checked (not empty, not `.` or `..`). Left as typed (still percent-encoded). */
  readonly rest: string;
  /** `short` = `/project/github.com/…`; `legacy` = `/store/<storeId>/project/<projectId>`. */
  readonly shape: 'short' | 'legacy';
  /** The one address of this project and page (design 3.4a), `rest` kept. */
  readonly canonicalPath: string;
  /** False when the typed path is another spelling of `canonicalPath` (case, `.git`, a trailing slash, `tree/HEAD`, a `blob/` link, the legacy GitHub shape). Always true for a non-GitHub store (one shape, left as typed). */
  readonly isCanonical: boolean;
  /**
   * For a GitHub project: its parts, so that no caller splits the id again. `ref` is the typed branch, tag or
   * commit when it is not `HEAD`; when it names the repo's default branch the caller must (with one GitHub API
   * call) rewrite it to `HEAD`: it cannot be known here.
   */
  readonly github?: IGithubProjectParts;
}

function isGithubStoreId(storeId: string): boolean {
  return storeId === GITHUB_STORE_ID || storeId === 'github';
}

function decodeSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** A project locator segment, decoded once; `undefined` when it cannot be one. */
function decodeLocatorSegment(raw: string): string | undefined {
  const decoded = decodeSegment(raw);
  return isSafePathSegment(decoded) ? decoded : undefined;
}

/**
 * A page segment, as typed: it must decode, hold no control character, and (decoded, split at `/` and `\`) no
 * empty, `.` or `..` piece. A `%2F` is how a host turns a name into a path, so it is judged as the path it becomes.
 */
function isSafeRestSegment(raw: string): boolean {
  const decoded = decodeSegment(raw);
  if (decoded === undefined || decoded === '') {
    return false;
  }
  for (let i = 0; i < decoded.length; i++) {
    const code = decoded.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return decoded
    .split(/[\\/]/)
    .every((p) => p !== '' && p !== '.' && p !== '..');
}

/** `''`, or `/seg/seg` for checked raw segments; `undefined` when a segment is not acceptable. */
function restOf(segments: readonly string[]): string | undefined {
  if (!segments.every(isSafeRestSegment)) {
    return undefined;
  }
  return segments.length > 0 ? '/' + segments.join('/') : '';
}

const encodeSegments = (segments: readonly string[]): string =>
  segments.map((s) => encodeURIComponent(s)).join('/');

/** The canonical short path of a valid (strictly read) GitHub project and a checked `rest`. */
function shortGithubPath(project: IGithubProjectId, rest: string): string {
  const base = `/project/${GITHUB_STORE_ID}/${project.org}/${project.repo}`;
  // A page that starts with `tree`, `blob` or `-` would read as part of the locator: spell the tree form out.
  const ambiguous = /^\/(?:tree|blob|-)(?:\/|$)/.test(rest);
  if (project.ref === undefined && project.folder === '' && !ambiguous) {
    return base + rest;
  }
  const ref = encodeURIComponent(project.ref ?? GITHUB_DEFAULT_BRANCH_REF);
  const dir = project.folder
    ? `/${encodeSegments(project.folder.split('/'))}`
    : '';
  return `${base}/tree/${ref}${dir}${rest ? '/-' + rest : ''}`;
}

function githubParts(project: IGithubProjectId): IGithubProjectParts {
  return {
    owner: project.org,
    repo: project.repo,
    folder: project.folder,
    ...(project.ref !== undefined ? { ref: project.ref } : {}),
  };
}

/**
 * The path of a project, and of one of its pages (`page` is `'chat'`, `'queries/x'`, with or without ONE leading
 * `/`), or the reason there is none. A GitHub project gets its canonical short address
 * (`/project/github.com/<owner>/<repo>…`); every other store `/store/<storeId>/project/<projectId>`.
 *
 * The address is returned only when `parseProjectUrl` reads it back as the same project and page: an id with
 * more than four parts, a folder or ref holding a `/`, a `-` folder segment, a page with an empty or `..` segment,
 * a case variant of the store id (`GitHub.com`) have no exact address and are refused. A GitHub id comes back in
 * its canonical spelling (`r@o@datatug` is `r@o`).
 */
export function tryProjectUrl(
  ref: IProjectRef,
  page?: string,
): string | IProjectUrlError {
  const refused = (reason: ProjectUrlErrorReason): IProjectUrlError => ({
    ok: false,
    reason,
  });
  const typedPage =
    typeof page === 'string' && page.startsWith('/')
      ? page.slice(1)
      : (page ?? '');
  const rest = typedPage ? restOf(typedPage.split('/')) : '';
  if (rest === undefined) {
    return refused('invalid-path-segment');
  }
  const storeId = ref?.storeId;
  const projectId = ref?.projectId;
  if (typeof storeId !== 'string' || typeof projectId !== 'string') {
    return refused('not-representable');
  }
  let candidate: string;
  let expectedStoreId: string;
  let expectedProjectId: string;
  if (isGithubStoreId(storeId)) {
    const reading = readGithubProjectId(projectId);
    if (!reading.ok) {
      return refused('not-representable');
    }
    candidate = shortGithubPath(reading.id, rest);
    expectedStoreId = GITHUB_STORE_ID;
    expectedProjectId = formatGithubProjectId(reading.id);
  } else {
    expectedStoreId = getStoreId(storeId);
    expectedProjectId = projectId;
    candidate = `/store/${expectedStoreId}/project/${projectId}${rest}`;
  }
  const back = parseProjectUrl(candidate);
  if (!back.ok) {
    return refused(back.reason);
  }
  if (
    back.storeId !== expectedStoreId ||
    back.projectId !== expectedProjectId ||
    back.rest !== rest ||
    back.canonicalPath !== candidate
  ) {
    return refused('not-representable');
  }
  return candidate;
}

/** {@link tryProjectUrl}, throwing a {@link ProjectUrlError} when there is no exact address. */
export function projectUrl(ref: IProjectRef, page?: string): string {
  const result = tryProjectUrl(ref, page);
  if (typeof result !== 'string') {
    throw new ProjectUrlError(result.reason);
  }
  return result;
}

/**
 * Reads a project path (a pathname: no query, no fragment) in either shape into the `{storeId, projectId}` pair
 * every page already reads from the route, plus what follows (`rest`), the one canonical spelling, and, for an
 * address that cannot be a project, why (`ok: false`). Pure: it makes no request, so whether a named ref is the
 * default branch is left to the caller (`github.ref`).
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

/** Drops ONE trailing empty segment (a trailing slash); any further empty segment is then refused as a page segment. */
function withoutTrailingSlash(segments: string[]): string[] {
  return segments.length > 0 && segments[segments.length - 1] === ''
    ? segments.slice(0, -1)
    : segments;
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
  const rest = restOf(withoutTrailingSlash(segments.slice(4)));
  if (rest === undefined) {
    return { ok: false, reason: 'invalid-path-segment' };
  }
  const lowerStoreId = asciiLowerCase(storeId);
  if (!isGithubStoreId(lowerStoreId)) {
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
  // `GitHub.com` is neither this store nor another one: refused, so no spelling can pass for GitHub.
  if (!isGithubStoreId(storeId)) {
    return { ok: false, reason: 'unsupported-store-id' };
  }
  const reading = readGithubProjectId(projectId);
  if (!reading.ok) {
    const partCount = projectId.split('@').length;
    return {
      ok: false,
      reason:
        reading.reason === 'owner-or-repo'
          ? 'invalid-owner-or-repo'
          : reading.reason === 'parts'
            ? partCount < 2
              ? 'not-a-project-address'
              : 'at-sign-not-supported'
            : 'invalid-path-segment',
    };
  }
  const canonicalPath = shortGithubPath(reading.id, rest);
  return {
    ok: true,
    storeId: GITHUB_STORE_ID,
    projectId: formatGithubProjectId(reading.id),
    rest,
    shape: 'legacy',
    canonicalPath,
    isCanonical: canonicalPath === path,
    github: githubParts(reading.id),
  };
}

function parseShortGithubPath(
  path: string,
  segments: string[],
): IProjectUrlParts | IProjectUrlError {
  const raw = withoutTrailingSlash(segments.slice(2));
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
  // A repo name never ends in `.git` (so `r.git.git` is refused here), and both names are ASCII.
  if (
    owner === undefined ||
    repo === undefined ||
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPO_PATTERN.test(repo) ||
    asciiLowerCase(repo).endsWith('.git')
  ) {
    return { ok: false, reason: 'invalid-owner-or-repo' };
  }
  const after = raw.slice(2);
  let ref: string | undefined;
  const dirs: string[] = [];
  let restSegments: string[] = after;

  if (after[0] === 'tree' || after[0] === 'blob') {
    const isBlob = after[0] === 'blob';
    if (after[1] === undefined) {
      return { ok: false, reason: isBlob ? 'file-link' : 'missing-ref' };
    }
    const refSegment = decodeLocatorSegment(after[1]);
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

  const rest = restOf(restSegments);
  if (rest === undefined) {
    return { ok: false, reason: 'invalid-path-segment' };
  }
  const folder = dirs.join('/');
  const named =
    ref !== undefined && ref !== GITHUB_DEFAULT_BRANCH_REF ? ref : undefined;
  if (
    !isValidGithubFolder(folder) ||
    (named !== undefined && !isValidGithubRef(named))
  ) {
    return { ok: false, reason: 'invalid-path-segment' };
  }
  const project: IGithubProjectId = {
    repo: asciiLowerCase(repo),
    org: asciiLowerCase(owner),
    folder,
    ...(named !== undefined ? { ref: named } : {}),
  };
  const canonicalPath = shortGithubPath(project, rest);
  return {
    ok: true,
    storeId: GITHUB_STORE_ID,
    projectId: formatGithubProjectId(project),
    rest,
    shape: 'short',
    canonicalPath,
    isCanonical: canonicalPath === path,
    github: githubParts(project),
  };
}

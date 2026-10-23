// Project addresses (design `demo-as-github-project.md` 3.1, 3.3, 3.4, 3.4a). Pure: no Angular, no I/O.
//
// This file and github-project-address.ts live in their own library so that the app's eager start-up code can use
// them (the app may not import the lazy-loaded datatug-main library statically); `nav-models.ts` of datatug-main
// re-exports them under their old names.

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
  isValidGithubRefName,
  readGithubProjectId,
} from './github-project-address';

/** What a project address names: a store and a project id, as every page reads them. */
export interface IProjectRef {
  readonly storeId: string;
  readonly projectId: string;
  readonly spaceID?: string;
}

export const getStoreId = (repo: string): string => {
  return (repo || '').replace(/(https?):\/\//, '$1-');
};

/**
 * The shared demo project, in `datatug/datatug-demo-project/demo-project-1` on the default branch. The same project as
 * the one trusted project of `isTrustedProjectAddress` (design 3.6).
 */
export const DEMO_PROJECT_REF: IProjectRef = {
  storeId: GITHUB_STORE_ID,
  projectId: formatGithubProjectId({
    org: 'datatug',
    repo: 'datatug-demo-project',
    folder: 'demo-project-1',
  }),
};

// ---------------------------------------------------------------------------
// Project addresses (design `demo-as-github-project.md` 3.1, 3.3, 3.4, 3.4a)
//
// Two shapes of a project path exist, and these functions are the one place that knows them:
//   - GitHub projects: `/project/github.com/<owner>/<repo>[/<dir>…][/-/<page>…][?ref=<ref>]` (canonical; the legacy
//     `…/<repo>/tree/<ref>[/<dir>…][/-/<page>…]` is read and redirects to it);
//   - every store, GitHub included for as long as it is accepted: `/store/<storeId>/project/<projectId>[/<page>…]`.
// The `/store/…` shape is a path only; a GitHub address may carry `?ref=` (read by `parseProjectUrl`, the only query
// parameter it reads). Neither takes a fragment.
//
// Contract: for every `{storeId, projectId}` and page that `projectUrl` accepts, `parseProjectUrl` reads the
// returned path back as that same project (the canonical id) and page; everything else is refused, never turned
// into the address of another project.
// ---------------------------------------------------------------------------

const PROJECT_FILE_NAME = 'datatug-project.json';

function sharedQueryPage(rest: string): boolean {
  return (
    rest === '' ||
    rest === '/overview' ||
    rest === '/quick-search' ||
    rest === '/tags' ||
    /^\/search-schema\/[A-Za-z0-9_-]+$/.test(rest) ||
    rest === '/queries' ||
    rest === '/shipping' ||
    /^\/sources\/[A-Za-z0-9_-]{1,128}$/.test(rest) ||
    /^\/meanings(?:\/(?:new-entity|entity|new-field|field))?$/.test(rest) ||
    rest === '/boards' ||
    rest === '/boards/new' ||
    /^\/board\/[A-Za-z0-9_-]+$/.test(rest) ||
    rest === '/cards' ||
    rest === '/cards/new' ||
    /^\/card\/[A-Za-z0-9_-]{1,128}$/.test(rest) ||
    rest === '/checks' ||
    rest === '/detective' ||
    rest === '/incidents' ||
    rest === '/incidents/new' ||
    /^\/incidents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(rest) ||
    /^\/(?:checks|detective)\/[A-Za-z0-9_-]+$/.test(rest) ||
    /^\/detective\/scenario\/[A-Za-z0-9_-]+$/.test(rest) ||
    /^\/query\/[A-Za-z0-9_-]+(?:%2F[A-Za-z0-9_-]+)*$/.test(rest) ||
    rest === '/sessions' ||
    /^\/sessions\/[A-Za-z0-9_-]{1,128}(?:\/(?:overview|queries|invoice-overview|invoice-explorer|composer)|\/query\/[A-Za-z0-9_-]+(?:%2F[A-Za-z0-9_-]+)*)?$/.test(
      rest,
    )
  );
}

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
  readonly spaceID?: string;
  /** What follows the project locator: `''`, or a path beginning with `/` (`/chat`), every segment checked (not empty, not `.` or `..`). Left as typed (still percent-encoded). */
  readonly rest: string;
  /** `short` = `/project/github.com/…`; `legacy` = `/store/<storeId>/project/<projectId>`. */
  readonly shape: 'short' | 'legacy' | 'space';
  /** The one address of this project and page (design 3.4a), `rest` kept. */
  readonly canonicalPath: string;
  /** False when the typed path is another spelling of `canonicalPath` (case, `.git`, a trailing slash, `?ref=HEAD`, `%2F` in the ref, a legacy `tree/<ref>` or `blob/` link, the legacy `/store/…` shape). Always true for a non-GitHub store (one shape, left as typed). */
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

/**
 * A page of a project, as plain text: `'chat'`, `'queries/x'` (split at each `/`), or its segments
 * (`['query', id]`), each ONE segment even when it holds a `/`.
 */
export type ProjectPage = string | readonly string[];

/** The plain-text segments of a page (none for no page), or `undefined` when `page` is not a page. */
function pageSegmentsOf(
  page: ProjectPage | undefined,
): readonly string[] | undefined {
  if (page === undefined || page === null) {
    return [];
  }
  if (typeof page !== 'string') {
    return Array.isArray(page) && page.every((s) => typeof s === 'string')
      ? page
      : undefined;
  }
  const typed = page.startsWith('/') ? page.slice(1) : page;
  return typed ? typed.split('/') : [];
}

/**
 * The first segment of every page of a project (the project routes' own first segments, `start-chat` included).
 * At the root of a repository, on an address with no `/-/`, a first segment that is one of these (any letter case)
 * is a page of the root project, as it has always been (`…/<repo>/chat`); every other first segment is a folder.
 * A folder whose first segment is one of these is therefore written with a closing `/-` (`…/<repo>/chat/-`).
 * The datatug-main route table is checked against this list by a spec, so a new page cannot be missed.
 */
export const GITHUB_PROJECT_PAGE_NAMES: ReadonlySet<string> = new Set([
  'board',
  'boards',
  'browser-db',
  'card',
  'cards',
  'chat',
  'checks',
  'composer',
  'dbmodel',
  'dbmodels',
  'demo-db-sandbox',
  'detective',
  'diff',
  'entities',
  'entity',
  'env',
  'environments',
  'incidents',
  'invoice-explorer',
  'invoice-overview',
  'meanings',
  'new-entity',
  'overview',
  'project',
  'public-data',
  'queries',
  'query',
  'quick-search',
  'resources',
  'search-schema',
  'server',
  'servers',
  'sessions',
  'shipping',
  'sources',
  'start-chat',
  'tags',
  'variables',
  'widgets',
]);

/** Whether a (raw or decoded, ASCII) segment names a project page. */
function isPageName(segment: string | undefined): boolean {
  return (
    segment !== undefined && GITHUB_PROJECT_PAGE_NAMES.has(asciiLowerCase(segment))
  );
}

/** The first segments the legacy `…/<repo>/tree/<ref>/…` and `…/<repo>/blob/<ref>/…` shapes are read from. */
function isLegacyLocatorWord(segment: string | undefined): boolean {
  return (
    segment !== undefined &&
    (asciiLowerCase(segment) === 'tree' || asciiLowerCase(segment) === 'blob')
  );
}

/**
 * The query of a ref, as an address writes it: `?ref=<ref>`, percent-encoded but with a `/` written plainly
 * (`?ref=feature/x`), which a query allows; `''` for the default branch. Both spellings of a `/` read back the same.
 */
export function githubRefQuery(ref: string | undefined): string {
  return ref === undefined
    ? ''
    : '?ref=' + encodeURIComponent(ref).replace(/%2F/gi, '/');
}

/**
 * The canonical address of a valid (strictly read) GitHub project and a checked `rest` (founder 2026-10-23):
 *   `/project/github.com/<owner>/<repo>[/<folder…>][/-/<page…>][?ref=<ref>]`
 * - the default branch has no ref; any other branch, tag or commit is the query `ref` ({@link githubRefQuery});
 * - `/-/` ends the folder when a page follows it. At the root, a page whose first segment is a page name
 *   ({@link GITHUB_PROJECT_PAGE_NAMES}) and that holds no `-` segment needs no `/-` (`…/<repo>/chat`), as it always
 *   has: so a folder whose first segment is a page name is closed with `/-` even with no page (`…/<repo>/chat/-`),
 *   or `…/<repo>/chat` would be the root project's chat;
 * - a folder whose first segment is `tree` or `blob` would read as the legacy shape, so it keeps the legacy long form
 *   `…/<repo>/tree/<ref or HEAD>/<folder…>` (no `?ref`); a ref holding a `/` cannot be written there (undefined).
 */
function shortGithubPath(
  project: IGithubProjectId,
  rest: string,
): string | undefined {
  const dirs = project.folder ? project.folder.split('/') : [];
  const locator = `/project/${GITHUB_STORE_ID}/${project.org}/${project.repo}`;
  if (isLegacyLocatorWord(dirs[0])) {
    const ref = project.ref ?? GITHUB_DEFAULT_BRANCH_REF;
    if (ref.includes('/')) {
      return undefined;
    }
    return `${locator}/tree/${encodeURIComponent(ref)}/${encodeSegments(dirs)}${rest ? '/-' + rest : ''}`;
  }
  const query = githubRefQuery(project.ref);
  if (dirs.length === 0) {
    if (rest === '') {
      return locator + query;
    }
    const pages = rest.slice(1).split('/');
    return (
      (isPageName(pages[0]) && !pages.includes('-')
        ? locator + rest
        : `${locator}/-${rest}`) + query
    );
  }
  const dir = `/${encodeSegments(dirs)}`;
  if (rest) {
    return `${locator}${dir}/-${rest}${query}`;
  }
  return (isPageName(dirs[0]) ? `${locator}${dir}/-` : locator + dir) + query;
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
 * `/`; plain text, each segment is percent-encoded: pass `'query/a b'`, never `'query/a%20b'`; or the segments as an
 * array, `['query', 'customers/invoices']`, where an element is ONE segment whatever it holds, so a `/` in it is
 * written `%2F`: how a folder-qualified query id is addressed), or the reason there is none. A GitHub project gets its canonical short address
 * (`/project/github.com/<owner>/<repo>…`); every other store `/store/<storeId>/project/<projectId>`.
 *
 * The address is returned only when `parseProjectUrl` reads it back as the same project and page: an id with
 * more than four parts, a folder or ref holding a `/`, a `-` folder segment, a page with an empty or `..` segment,
 * a case variant of the store id (`GitHub.com`) have no exact address and are refused. A GitHub id comes back in
 * its canonical spelling (`r@o@datatug` is `r@o`).
 */
export function tryProjectUrl(
  ref: IProjectRef,
  page?: ProjectPage,
): string | IProjectUrlError {
  const refused = (reason: ProjectUrlErrorReason): IProjectUrlError => ({
    ok: false,
    reason,
  });
  const pageSegments = pageSegmentsOf(page);
  // `page` is plain text: every segment is percent-encoded here (a space, `%`, `?`, `#` or non-ASCII letter in a
  // page is written, never left to be read as something else), and the result must read back as this very page.
  const rest =
    pageSegments === undefined
      ? undefined
      : pageSegments.length > 0
        ? restOf(pageSegments.map((s) => encodeURIComponent(s)))
        : '';
  if (rest === undefined) {
    return refused('invalid-path-segment');
  }
  if (ref?.spaceID !== undefined) {
    if (
      ref.storeId !== 'firestore' ||
      !sharedIdentifier(ref.spaceID) ||
      !sharedIdentifier(ref.projectId) ||
      !sharedQueryPage(rest)
    ) {
      return refused('not-representable');
    }
    return `/space/${ref.spaceID}/store/firestore/project/${ref.projectId}${rest}`;
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
    const written = shortGithubPath(reading.id, rest);
    if (written === undefined) {
      return refused('not-representable');
    }
    candidate = written;
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
export function projectUrl(ref: IProjectRef, page?: ProjectPage): string {
  const result = tryProjectUrl(ref, page);
  if (typeof result !== 'string') {
    throw new ProjectUrlError(result.reason);
  }
  return result;
}

/**
 * Reads a project address (a pathname, with or without its query; a fragment is ignored) in either shape into the `{storeId, projectId}` pair
 * every page already reads from the route, plus what follows (`rest`), the one canonical spelling, and, for an
 * address that cannot be a project, why (`ok: false`). Pure: it makes no request, so whether a named ref is the
 * default branch is left to the caller (`github.ref`).
 */
export function parseProjectUrl(
  url: string,
): IProjectUrlParts | IProjectUrlError {
  const notOurs: IProjectUrlError = {
    ok: false,
    reason: 'not-a-project-address',
  };
  if (typeof url !== 'string' || !url.startsWith('/')) {
    return notOurs;
  }
  const bare = url.split('#')[0];
  const queryAt = bare.indexOf('?');
  const path = queryAt < 0 ? bare : bare.slice(0, queryAt);
  const query = queryAt < 0 ? '' : bare.slice(queryAt + 1);
  const segments = path.slice(1).split('/');
  if (segments[0] === 'space') {
    const spaceID = decodeLocatorSegment(segments[1]);
    const projectId = decodeLocatorSegment(segments[5]);
    const rest = restOf(withoutTrailingSlash(segments.slice(6)));
    if (
      segments[2] !== 'store' ||
      segments[3] !== 'firestore' ||
      segments[4] !== 'project' ||
      !sharedIdentifier(spaceID) ||
      !sharedIdentifier(projectId) ||
      rest === undefined ||
      !sharedQueryPage(rest)
    ) {
      return { ok: false, reason: 'invalid-path-segment' };
    }
    const canonicalPath = `/space/${spaceID}/store/firestore/project/${projectId}${rest}`;
    return {
      ok: true,
      storeId: 'firestore',
      spaceID,
      projectId,
      rest,
      shape: 'space',
      canonicalPath,
      isCanonical: path === canonicalPath,
    };
  }
  if (segments[0] === 'project') {
    if (segments[1] !== GITHUB_STORE_ID) {
      return notOurs;
    }
    // The ref of a GitHub project is its query parameter `ref` (founder 2026-10-23); every other parameter is the
    // page's own and is not read here.
    const refs = query ? new URLSearchParams(query).getAll('ref') : [];
    if (refs.length > 1) {
      return { ok: false, reason: 'invalid-path-segment' };
    }
    return parseShortGithubPath(path, segments, refs[0]);
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
  if (canonicalPath === undefined) {
    return { ok: false, reason: 'not-representable' };
  }
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
  queryRef: string | undefined,
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
  // A repo name never ends in `.git` (so `r.git.git` is refused here), and both names are ASCII (never `@`).
  if (
    owner === undefined ||
    repo === undefined ||
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPO_PATTERN.test(repo) ||
    asciiLowerCase(repo).endsWith('.git')
  ) {
    return { ok: false, reason: 'invalid-owner-or-repo' };
  }
  // The query's `ref`, decoded (`feature/x` and `feature%2Fx` alike). It is a value of the address, never read as a
  // part of a project id: the id is written from the parsed parts (`formatGithubProjectId`).
  if (queryRef !== undefined) {
    if (queryRef === '') {
      return { ok: false, reason: 'missing-ref' };
    }
    if (queryRef.includes('@')) {
      return { ok: false, reason: 'at-sign-not-supported' };
    }
    if (!isValidGithubRefName(queryRef)) {
      return { ok: false, reason: 'invalid-path-segment' };
    }
  }
  const after = raw.slice(2);
  let ref: string | undefined = queryRef;
  let dirSegments: string[] = [];
  let restSegments: string[] = [];

  if (isLegacyLocatorWord(after[0])) {
    // The legacy shapes: `tree/<ref>[/<dir>…][/-/<page>…]` and a pasted link to the project file,
    // `blob/<ref>/<dir>/datatug-project.json`. Both are read, and redirect to the canonical address.
    const isBlob = asciiLowerCase(after[0]) === 'blob';
    if (after[1] === undefined) {
      return { ok: false, reason: isBlob ? 'file-link' : 'missing-ref' };
    }
    if (queryRef !== undefined) {
      // Two refs, one in the path and one in the query: no one address.
      return { ok: false, reason: 'invalid-path-segment' };
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
    if (isBlob) {
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
    dirSegments = tail;
  } else {
    // `[/<folder…>][/-/<page…>]`: the first `-` ends the folder. With no `-`, a first segment that names a page is
    // a page of the root project (`…/<repo>/chat`, as it has always been); anything else is the folder.
    const dash = after.indexOf('-');
    if (dash !== -1) {
      dirSegments = after.slice(0, dash);
      restSegments = after.slice(dash + 1);
    } else if (isPageName(after[0])) {
      restSegments = after;
    } else {
      dirSegments = after;
    }
  }

  const dirs: string[] = [];
  for (const segment of dirSegments) {
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

  const rest = restOf(restSegments);
  if (rest === undefined) {
    return { ok: false, reason: 'invalid-path-segment' };
  }
  const folder = dirs.join('/');
  const named =
    ref !== undefined && ref !== GITHUB_DEFAULT_BRANCH_REF ? ref : undefined;
  if (
    !isValidGithubFolder(folder) ||
    (named !== undefined && !isValidGithubRefName(named))
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
  if (canonicalPath === undefined) {
    return { ok: false, reason: 'not-representable' };
  }
  // The typed address, its ref spelled as the canonical one spells it (`%2F` and `/` are one ref); the other query
  // parameters are the page's and do not make an address another spelling.
  const typed = path + githubRefQuery(queryRef);
  return {
    ok: true,
    storeId: GITHUB_STORE_ID,
    projectId: formatGithubProjectId(project),
    rest,
    shape: 'short',
    canonicalPath,
    isCanonical: canonicalPath === typed,
    github: githubParts(project),
  };
}

// Same bounded identifiers as DataTug backend's shared-project contract.
const sharedIdentifier = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);

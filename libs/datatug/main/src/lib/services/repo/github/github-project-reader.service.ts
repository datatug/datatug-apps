import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, defer, forkJoin, from, of, throwError } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { IParameterDef } from '../../../models/definition/parameter';
import { IRecordsetDef } from '../../../models/definition/recordset';
import {
  GITHUB_DEFAULT_BRANCH_REF,
  GithubProjectIdError,
  IGithubProjectId,
  readGithubProjectId,
  splitGithubProjectId,
} from '../../../nav/github-project-address';
import {
  GITHUB_API_HOST,
  GITHUB_MIRROR_HOST,
  GITHUB_RAW_HOST,
  GithubFetch,
  githubGet,
} from './github-http';
import {
  GITHUB_RESOLVE_TTL_MS,
  GithubSetTimer,
  IGithubFileStore,
  createLazyGithubFileStore,
  guardGithubFileStore,
  setGithubTimer,
} from './github-file-store-api';
import {
  GITHUB_RATE_LIMIT_MESSAGE,
  GithubFileTooLargeError,
  GithubProjectNotFoundError,
  GithubReadBudget,
  GithubReadError,
  GITHUB_RESOLVE_TIMEOUT_MS,
  MAX_PROJECT_FILE_BYTES,
  MAX_TREE_BYTES,
} from './github-read-limits';

export {
  GITHUB_RATE_LIMIT_MESSAGE,
  GithubFileTooLargeError,
  GithubProjectNotFoundError,
  GithubReadBudget,
  GithubReadError,
};
export { GithubReadLimitError } from './github-read-limits';

/**
 * `projectId` format every GitHub-store caller already relies on:
 * `"repo@org"`, `"repo@org@folder"` or `"repo@org@folder@ref"` — `folder` is
 * the repo-relative directory the project's `datatug-project.json` lives in,
 * defaulting to `"datatug"` for the historical convention (an empty folder,
 * `"repo@org@"`, is the repo root), and `ref` is a branch, tag or commit SHA
 * other than the default branch (absent = the default branch). See
 * `nav/github-project-address.ts` and design `demo-as-github-project.md`
 * 3.3. This is the ONE place this split happens — `datatug-store.service.github.ts`'s
 * `buildGithubProjectSummaryUrl` and `entity.service.ts`'s old
 * `getEntityFromGithub` each used to do their own two-part `split('@')`.
 */
export type { IGithubProjectId };

/**
 * Splits a project id (lenient, never throws). Owner and repo are
 * lower-cased (one project, one id); folder and ref keep their case. Reading
 * a project from GitHub goes through the strict reading instead
 * (`readGithubProjectId`), see {@link buildGithubRawUrl}.
 */
export function parseGithubProjectId(projectId: string): IGithubProjectId {
  return splitGithubProjectId(projectId);
}

function readableId(projectId: string): IGithubProjectId {
  const reading = readGithubProjectId(projectId);
  if (!reading.ok) {
    throw new GithubProjectIdError(
      reading.reason,
      `not a valid GitHub project id (${reading.reason}): ${projectId}`,
    );
  }
  return reading.id;
}

/**
 * The repo-relative path of a file of the project, every segment URL-encoded. An empty folder is the repo root (no
 * doubled slash). No file segment may be `.` or `..`: throws a {@link GithubProjectIdError} instead.
 */
function projectFilePath(folder: string, relativePath: string): string {
  const fileSegments = (relativePath ?? '').split('/').filter(Boolean);
  if (fileSegments.some((s) => s === '.' || s === '..')) {
    throw new GithubProjectIdError(
      'path',
      `not a valid project file path: ${relativePath}`,
    );
  }
  return [...(folder ? folder.split('/') : []), ...fileSegments]
    .map((s) => encodeURIComponent(s))
    .join('/');
}

/**
 * Raw-content URL for one file at `relativePath` (repo-relative to the
 * project's folder). An empty folder is the repo root (no doubled slash).
 * The revision is `revision` when given (the commit the reader pinned), else
 * the explicit ref of a four-part id (a branch, tag or commit), else `HEAD`:
 * the default branch, whatever it is called.
 *
 * Every folder and file segment is URL-encoded and none may be `.` or `..`;
 * an id that is not valid (see `readGithubProjectId`) or such a path throws
 * a {@link GithubProjectIdError} instead of building a URL.
 */
export function buildGithubRawUrl(
  projectId: string,
  relativePath: string,
  revision?: string,
): string {
  const { repo, org, folder, ref } = readableId(projectId);
  const path = projectFilePath(folder, relativePath);
  const rev = encodeURIComponent(revision ?? ref ?? GITHUB_DEFAULT_BRANCH_REF);
  return `https://raw.githubusercontent.com/${org}/${repo}/${rev}/${path}`;
}

/**
 * Throws a {@link GithubProjectIdError} unless the id is a valid GitHub
 * project id. Any ref is readable: files and listing both come from the one
 * commit the reader resolves for the id (design 4.5).
 */
export function assertReadableGithubProjectId(projectId: string): IGithubProjectId {
  return readableId(projectId);
}

/** One entry of a directory listing, as {@link GithubProjectReaderService.listDirectory} reports it. */
export interface IGithubDirEntry {
  readonly name: string;
  /** Repo-relative path (project-folder-prefixed), e.g. `"demo-project-1/entities/Album"`. */
  readonly path: string;
  readonly type: 'file' | 'dir';
}

interface IGithubGitTreeEntry {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
}

interface IGithubGitTreeResponse {
  readonly tree?: IGithubGitTreeEntry[];
  readonly truncated?: boolean;
}



/** Wire shape one query item's own `.query.json` (or legacy `.sql.json`) file decodes
 * to — deliberately the SAME flat shape `queries.service.ts`'s own (un-exported)
 * `IWireQueryItem` declares (structurally compatible, so `toQueryDef()`/`toQueryFolder()`
 * there accept values built from this file's types with no adapter of their own needed
 * here): datatug-cli's `GET /queries/all_queries`/`get_query` responses, and this
 * GitHub reader, both ultimately describe the same on-disk `datatug.QueryDef` JSON. */
export interface IGithubWireQueryItem {
  id: string;
  title?: string;
  type: string;
  text?: string;
  draft?: boolean;
  parameters?: IParameterDef[];
  dbModel?: string;
  recordsets?: IRecordsetDef[];
  federation?: {
    readonly ovdbBaseUrl: string;
    readonly tables: readonly { readonly name: string; readonly schema?: string; readonly fields: readonly string[] }[];
  };
}

export interface IGithubWireQueryFolder {
  id: string;
  title?: string;
  folders?: IGithubWireQueryFolder[];
  items?: IGithubWireQueryItem[];
}

export interface IGithubTableEntry {
  schema: string;
  name: string;
  dbType: string;
}

export interface IGithubCatalogTables {
  tables: IGithubTableEntry[];
  views: IGithubTableEntry[];
}

export interface IGithubEnvDbServer {
  id: string;
  driver: string;
  host: string;
  catalogs?: string[];
}

export interface IGithubEnvironmentSummary {
  id: string;
  title: string;
  dbServers?: IGithubEnvDbServer[];
}

interface IGithubEnvDbServerFile {
  driver: string;
  host?: string;
  catalogs?: string[];
}

interface IGithubEnvFile {
  id?: string;
  title?: string;
  dbServers?: IGithubEnvDbServerFile[];
}

interface IGithubCatalogFile {
  driver?: string;
  dbModel?: string;
}

interface IGithubBoardFile {
  title?: string;
  folder?: string;
  tags?: string[];
  rows?: unknown[];
  parameters?: unknown[];
  requiredParams?: string[][];
}

interface IGithubEntityFile {
  id?: string;
  extends?: { def: string };
  fields?: unknown[];
  [key: string]: unknown;
}

/** The `fetch` every read of a GitHub project goes through. Injected so a test answers without a network. */
export const GITHUB_FETCH = new InjectionToken<GithubFetch>('GITHUB_FETCH', {
  providedIn: 'root',
  factory: () => (url, init) => globalThis.fetch(url, init),
});

/** The clock the reader's 5-minute memory of a resolved commit uses (ms since the epoch). */
export const GITHUB_CLOCK = new InjectionToken<() => number>('GITHUB_CLOCK', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/**
 * The persistent cache: a database of its own, opened on first use from a chunk of its own (see
 * `github-file-store.ts`). Provide `NO_GITHUB_FILE_STORE` to read with no cache.
 */
export const GITHUB_FILE_STORE = new InjectionToken<IGithubFileStore>(
  'GITHUB_FILE_STORE',
  {
    providedIn: 'root',
    factory: () =>
      createLazyGithubFileStore(() =>
        import('./github-file-store').then((m) =>
          m.openGithubFileStore(globalThis.indexedDB, () => Date.now()),
        ),
      ),
  },
);

/**
 * The timer the reader gives its persistent cache to answer by (see `guardGithubFileStore`). Injected so a test fires
 * it by hand instead of waiting.
 */
export const GITHUB_TIMER = new InjectionToken<GithubSetTimer>('GITHUB_TIMER', {
  providedIn: 'root',
  factory: () => setGithubTimer,
});

/**
 * Which commit a read of a project came to use (design 4.5, the degrade table):
 * - `given`: a full commit SHA in the id; no call was made. Never taken for a trusted project.
 * - `resolved`: GitHub answered which commit the ref (or the default branch) is now, or answered within the last
 *   5 minutes.
 * - `remembered`: the resolve call was refused or failed; an earlier answer is used. It may not be the latest.
 * - `unresolved`: refused or failed, nothing remembered. Reads are of `HEAD` (or the ref) as it is, kept in memory
 *   for this visit only.
 * - `missing`: the repository or the ref does not exist.
 * - `moved`: GitHub answered with a redirect (a renamed or moved repository). Refused.
 */
export type GithubCommitState =
  | 'given'
  | 'resolved'
  | 'remembered'
  | 'unresolved'
  | 'missing'
  | 'moved';

export interface IGithubCommitResolution {
  readonly state: GithubCommitState;
  /** The commit every file and the listing of the project are read at; absent for `unresolved`, `missing`, `moved`. */
  readonly sha?: string;
}

/** What the "sources" line of a run says about where the project came from (design 4.5, 4.6). */
export interface IGithubReadInfo {
  readonly org: string;
  readonly repo: string;
  readonly state: GithubCommitState;
  /** The commit read, when there is one. */
  readonly commit?: string;
  /** Some file was served by the jsDelivr mirror, not by GitHub's file host. */
  readonly fromMirror: boolean;
  /** The commit may not be the latest: remembered, or not resolved at all. */
  readonly mayBeStale: boolean;
}

export interface IGithubReadOptions {
  /** Counts the files one run reads and refuses the one past the limit (design 3.6: 40 per run). */
  readonly budget?: GithubReadBudget;
}

/** A 40-character commit SHA. */
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** The listing of a commit is kept in the file cache under this name; no file path can be it (`#` is encoded). */
const TREE_CACHE_PATH = '#tree';

/** The file that makes a folder a project. A project that is not there yet is not remembered as absent. */
const PROJECT_FILE_NAME = 'datatug-project.json';

function isProjectFile(path: string): boolean {
  return path === PROJECT_FILE_NAME || path.endsWith(`/${PROJECT_FILE_NAME}`);
}

/** What a read answers when the commit it was reading at was found not to exist and has been replaced: read again. */
const STALE = Symbol('stale commit');

/** A commit, and whether it is what an earlier answer said rather than what GitHub said in this visit. */
interface IGithubResolvedCommit extends IGithubCommitResolution {
  /**
   * The commit is a remembered answer (of the last 5 minutes, or of an earlier visit when GitHub would not answer),
   * so it may be one that no longer exists.
   */
  readonly remembered: boolean;
}

function isTreeEntry(entry: unknown): entry is IGithubGitTreeEntry {
  const { path, type } = (entry ?? {}) as Partial<IGithubGitTreeEntry>;
  return (
    typeof path === 'string' &&
    (type === 'blob' || type === 'tree' || type === 'commit')
  );
}

/** A listing out of the cache, or `undefined` when what was kept is not a listing (then it is read again). */
function readCachedTree(text: string): IGithubGitTreeEntry[] | undefined {
  try {
    const tree: unknown = JSON.parse(text);
    return Array.isArray(tree) && tree.every(isTreeEntry) ? tree : undefined;
  } catch {
    return undefined;
  }
}

/** Everything read for one `owner/repo@ref` during this page load: one commit, one listing, the files. */
interface IGithubSession {
  readonly org: string;
  readonly repo: string;
  readonly ref?: string;
  /** Asks again which commit the id names; `fresh` ignores what is remembered. */
  readonly resolve: (fresh: boolean) => Promise<IGithubResolvedCommit>;
  /** The commit every read of the session is at; replaced once, when a remembered commit proves not to exist. */
  commit: Promise<IGithubResolvedCommit>;
  mirrorUsed: boolean;
  tree?: Promise<IGithubGitTreeEntry[]>;
  readonly files: Map<string, Promise<string | undefined>>;
  readonly json: Map<string, Promise<unknown>>;
}

/**
 * Read-only project-file reader for the GitHub store (`STORE_ID_GITHUB_COM`
 * / `STORE_TYPE_GITHUB`) — every project page's data source when a project
 * lives at `store/github.com/project/<repo>@<org>@<folder>`, since there is
 * no CLI agent to ask. `DatatugStoreGithubService` (this directory's own
 * `IDatatugStoreService` implementation) and each per-domain service that
 * already switches on store type (`EnvironmentService`, `EntityService`,
 * `QueriesService`, `DatatugBoardService`, `DbServerService`) inject this
 * directly for their GitHub branch, rather than duplicating URL-building or
 * directory-walking logic — this is the ONE place both live (founder
 * ruling 2026-09-11: "Not a single page is loading from side menu without
 * error").
 *
 * How a project is read (design `demo-as-github-project.md` 4.5):
 *  1. ONE call resolves the commit: `api.github.com/repos/<o>/<r>/commits/<ref or HEAD>`. A full SHA in the id
 *     skips it (never for a trusted project: a trusted run reads what GitHub says the default branch is now).
 *     The answer is remembered for 5 minutes, across page loads.
 *  2. The listing (`git/trees/<sha>?recursive=1`, ONE call per repo; every "list a directory" is a filter over it,
 *     never the contents API, which costs a rate-limited call per folder — unauthenticated `api.github.com` access
 *     is capped at 60 requests/hour per IP, {@link GITHUB_RATE_LIMIT_MESSAGE}) and every file
 *     (`raw.githubusercontent.com/<o>/<r>/<sha>/<path>`) come from that one commit, so a push in the middle of a
 *     visit cannot mix two versions.
 *  3. What was read is kept in a database of its own, keyed by commit: a commit's files never change, so a browser
 *     never fetches one twice. Bounded (20 MB, 20 repos, two commits per repo).
 *  4. A refused, failed or timed-out read from the file host is tried again from jsDelivr, same commit.
 *  5. When the resolve call fails, the reads degrade, never stop: see {@link GithubCommitState}.
 * Also: no credentials, no redirect followed (a renamed or moved repository is "No DataTug project here"), a
 * 256 KB cap per project file checked on the bytes received, at most 40 distinct files per run
 * ({@link GithubReadBudget}).
 *
 * Everything is also cached in memory per `(org/repo@ref)` for the lifetime of this singleton
 * (`providedIn: 'root'`), so navigating between project pages never re-reads the same directory or file twice in
 * one session.
 */
@Injectable({ providedIn: 'root' })
export class GithubProjectReaderService {
  private readonly fetchFn = inject(GITHUB_FETCH);
  private readonly now = inject(GITHUB_CLOCK);
  // A cache that does not answer is no cache (see `guardGithubFileStore`): no read waits for it for long.
  private readonly store = guardGithubFileStore(
    inject(GITHUB_FILE_STORE),
    inject(GITHUB_TIMER),
  );

  private readonly sessions = new Map<string, IGithubSession>();
  /** The commit each remembered commit that proved not to exist was replaced by (one replacement per commit). */
  private readonly replacements = new WeakMap<
    IGithubResolvedCommit,
    Promise<IGithubResolvedCommit>
  >();

  /**
   * Forgets what this browser knows of a repository, so the next read asks GitHub again which commit it is at: the
   * visit's commit, files and listing, and the answer remembered for 5 minutes (at every ref). Called when a project
   * was just committed to the repository, which would otherwise stay "missing" until the memory expires. Files and
   * listings kept by commit are not touched: a commit's content never changes.
   */
  public async forget(org: string, repo: string): Promise<void> {
    const repoKey = `${org}/${repo}`.toLowerCase();
    for (const key of [...this.sessions.keys()]) {
      if (key.startsWith(`${repoKey}@`)) {
        this.sessions.delete(key);
      }
    }
    await this.store.forgetResolved(repoKey);
  }

  // ---------------------------------------------------------------------
  // The commit: one per repo and ref, resolved once
  // ---------------------------------------------------------------------

  private session(id: IGithubProjectId): IGithubSession {
    const key = `${id.org}/${id.repo}@${id.ref ?? GITHUB_DEFAULT_BRANCH_REF}`;
    let session = this.sessions.get(key);
    if (!session) {
      const resolve = (fresh: boolean) => this.resolveCommit(id, fresh);
      session = {
        org: id.org,
        repo: id.repo,
        ref: id.ref,
        resolve,
        commit: resolve(false),
        mirrorUsed: false,
        files: new Map(),
        json: new Map(),
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  private async resolveCommit(
    id: IGithubProjectId,
    fresh: boolean,
  ): Promise<IGithubResolvedCommit> {
    const { org, repo, ref } = id;
    if (ref && COMMIT_SHA.test(ref)) {
      // A commit in the id is read as it is, with no call. No trusted project can have one: the trust decision
      // (`isTrustedGithubProject`, nav/github-project-address.ts) refuses every ref but `HEAD`, so a trusted run
      // never takes a commit from its address and always reads what GitHub says the default branch is now.
      return { state: 'given', sha: ref.toLowerCase(), remembered: false };
    }
    const memoKey = `${org}/${repo}@${ref ?? GITHUB_DEFAULT_BRANCH_REF}`;
    const memo = fresh ? undefined : await this.store.getResolved(memoKey);
    const now = this.now();
    if (memo) {
      const age = now - memo.at;
      if (age >= 0 && age < GITHUB_RESOLVE_TTL_MS) {
        return { state: 'resolved', sha: memo.sha, remembered: true };
      }
    }
    const out = await githubGet(
      this.fetchFn,
      `https://${GITHUB_API_HOST}/repos/${org}/${repo}/commits/${encodeURIComponent(ref ?? GITHUB_DEFAULT_BRANCH_REF)}`,
      {
        maxBytes: 1024,
        accept: 'application/vnd.github.sha',
        detectMoved: true,
        timeoutMs: GITHUB_RESOLVE_TIMEOUT_MS,
      },
    );
    if (out.kind === 'ok') {
      const sha = out.text.trim().toLowerCase();
      if (COMMIT_SHA.test(sha)) {
        await this.store.putResolved(memoKey, { sha, at: now });
        return { state: 'resolved', sha, remembered: false };
      }
    } else if (out.kind === 'moved') {
      return { state: 'moved', remembered: false };
    } else if (out.kind === 'missing') {
      return { state: 'missing', remembered: false };
    }
    return memo
      ? { state: 'remembered', sha: memo.sha, remembered: true }
      : { state: 'unresolved', remembered: false };
  }

  /**
   * GitHub does not know the commit a read was at, which was only remembered: the repository was rewritten, or the
   * project was created after the answer was kept. The memory is dropped and the commit is resolved again, once
   * (what is resolved again is never remembered, so there is no second time); every read of the session then goes on
   * at the new commit, those that were waiting for GitHub's answer about the old one included (they read again).
   * What was already read from the cache stays: it is the old commit's own, whole. Called once per stale commit: a
   * read that finds the commit already replaced does not call it (see `replacements`).
   */
  private replaceRememberedCommit(
    session: IGithubSession,
    stale: IGithubResolvedCommit,
  ): Promise<IGithubResolvedCommit> {
    const next = this.store
      .forgetResolved(`${session.org}/${session.repo}`)
      .then(() => session.resolve(true));
    this.replacements.set(stale, next);
    session.commit = next;
    return next;
  }

  /**
   * Where a project is read from: the commit and how it was found, and whether the mirror had to be used. The
   * commit is resolved when this emits, so the answer is complete once the project has been read.
   */
  public readInfo(projectId: string): Observable<IGithubReadInfo> {
    return defer(() => {
      const session = this.session(readableId(projectId));
      return from(
        session.commit.then(
          (c): IGithubReadInfo => ({
            org: session.org,
            repo: session.repo,
            state: c.state,
            commit: c.sha,
            fromMirror: session.mirrorUsed,
            mayBeStale: c.state === 'remembered' || c.state === 'unresolved',
          }),
        ),
      );
    });
  }

  // ---------------------------------------------------------------------
  // Low-level: tree (directory listing) + raw file content
  // ---------------------------------------------------------------------

  private getTree(projectId: string): Observable<IGithubGitTreeEntry[]> {
    return defer(() => {
      const session = this.session(readableId(projectId));
      if (!session.tree) {
        const tree = this.loadTree(session);
        session.tree = tree;
        tree.catch(() => {
          if (session.tree === tree) {
            session.tree = undefined;
          }
        });
      }
      return from(session.tree);
    });
  }

  private async loadTree(
    session: IGithubSession,
  ): Promise<IGithubGitTreeEntry[]> {
    for (;;) {
      const tree = await this.loadTreeAt(session, await session.commit);
      if (tree !== STALE) {
        return tree;
      }
    }
  }

  private async loadTreeAt(
    session: IGithubSession,
    commit: IGithubResolvedCommit,
  ): Promise<IGithubGitTreeEntry[] | typeof STALE> {
    if (commit.state === 'missing' || commit.state === 'moved') {
      return [];
    }
    const commitKey = commit.sha
      ? `${session.org}/${session.repo}@${commit.sha}`
      : undefined;
    if (commitKey) {
      const hit = await this.store.getFile(commitKey, TREE_CACHE_PATH);
      const kept = hit?.text ? readCachedTree(hit.text) : undefined;
      if (kept) {
        return kept;
      }
    }
    const revision = commit.sha ?? session.ref ?? GITHUB_DEFAULT_BRANCH_REF;
    const out = await githubGet(
      this.fetchFn,
      `https://${GITHUB_API_HOST}/repos/${session.org}/${session.repo}/git/trees/${encodeURIComponent(revision)}?recursive=1`,
      { maxBytes: MAX_TREE_BYTES, detectMoved: true },
    );
    switch (out.kind) {
      case 'ok': {
        const response = JSON.parse(out.text) as IGithubGitTreeResponse;
        const tree = (response.tree || []).map(({ path, type }) => ({
          path,
          type,
        }));
        if (commitKey) {
          await this.store.putFile(commitKey, TREE_CACHE_PATH, {
            text: JSON.stringify(tree),
            bytes: out.bytes,
          });
        }
        return tree;
      }
      case 'missing':
        if (this.replacements.has(commit)) {
          return STALE; // another read found the commit gone while this one was asking
        }
        if (commit.remembered) {
          await this.replaceRememberedCommit(session, commit);
          return STALE;
        }
        return [];
      case 'moved':
        return [];
      case 'refused':
        throw new Error(GITHUB_RATE_LIMIT_MESSAGE);
      case 'too-large':
        throw new GithubFileTooLargeError(
          'the project listing',
          MAX_TREE_BYTES,
        );
      default:
        throw new GithubReadError('the project listing', [GITHUB_API_HOST]);
    }
  }

  /**
   * Lists the immediate children of `relativePath` (repo-relative to the
   * project's own folder, `""` for the project root) — folders AND files,
   * like the GitHub contents API, but computed from the one cached
   * recursive tree (see this class's own doc comment) rather than a fresh
   * `api.github.com` call every time. A path that doesn't exist in the repo
   * (e.g. this project has no `widgets/` folder at all) resolves to an
   * empty list, never an error — the caller's page renders its own empty
   * state (founder ruling item 2). A project at the repo root (`folder` is
   * empty) lists from the root of the repo.
   */
  public listDirectory(
    projectId: string,
    relativePath: string,
  ): Observable<IGithubDirEntry[]> {
    const { folder } = parseGithubProjectId(projectId);
    const base = [folder, relativePath].filter(Boolean).join('/');
    const prefix = base ? `${base}/` : '';
    return this.getTree(projectId).pipe(
      map((tree) => {
        const children = new Map<string, 'file' | 'dir'>();
        for (const entry of tree) {
          if (!entry.path.startsWith(prefix) || entry.type === 'commit') {
            continue;
          }
          const rest = entry.path.slice(prefix.length);
          if (!rest) {
            continue;
          }
          const slashIndex = rest.indexOf('/');
          if (slashIndex === -1) {
            children.set(rest, entry.type === 'tree' ? 'dir' : 'file');
          } else {
            const childName = rest.slice(0, slashIndex);
            if (!children.has(childName)) {
              children.set(childName, 'dir');
            }
          }
        }
        return [...children.entries()]
          .map(([name, type]) => ({
            name,
            path: base ? `${base}/${name}` : name,
            type,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }),
    );
  }

  /** One file's text at the session's commit, from memory, the cache, the file host or the mirror. */
  private readText(
    session: IGithubSession,
    path: string,
  ): Promise<string | undefined> {
    let read = session.files.get(path);
    if (!read) {
      read = this.loadText(session, path);
      session.files.set(path, read);
      const memo = read;
      read.catch(() => {
        if (session.files.get(path) === memo) {
          session.files.delete(path);
        }
      });
    }
    return read;
  }

  private async loadText(
    session: IGithubSession,
    path: string,
  ): Promise<string | undefined> {
    for (;;) {
      const text = await this.loadTextAt(session, await session.commit, path);
      if (text !== STALE) {
        return text;
      }
    }
  }

  private async loadTextAt(
    session: IGithubSession,
    commit: IGithubResolvedCommit,
    path: string,
  ): Promise<string | undefined | typeof STALE> {
    if (commit.state === 'missing' || commit.state === 'moved') {
      return undefined;
    }
    const { org, repo } = session;
    const commitKey = commit.sha ? `${org}/${repo}@${commit.sha}` : undefined;
    if (commitKey) {
      const hit = await this.store.getFile(commitKey, path);
      if (hit) {
        return hit.text ?? undefined;
      }
    }
    // Pinned: the commit. Not resolved: the ref as it is now (`HEAD` is the default branch, whatever it is called).
    const revision = commit.sha ?? session.ref ?? GITHUB_DEFAULT_BRANCH_REF;
    const raw = await githubGet(
      this.fetchFn,
      `https://${GITHUB_RAW_HOST}/${org}/${repo}/${encodeURIComponent(revision)}/${path}`,
      { maxBytes: MAX_PROJECT_FILE_BYTES },
    );
    const hosts = [GITHUB_RAW_HOST];
    let out = raw;
    if (raw.kind === 'refused' || raw.kind === 'down') {
      // A limit, a block, an outage: the same bytes from different infrastructure. Without a commit, jsDelivr's
      // unversioned address is the default branch (up to 12 hours old).
      hosts.push(GITHUB_MIRROR_HOST);
      const version = commit.sha ?? session.ref;
      out = await githubGet(
        this.fetchFn,
        `https://${GITHUB_MIRROR_HOST}/gh/${org}/${repo}${version ? `@${encodeURIComponent(version)}` : ''}/${path}`,
        { maxBytes: MAX_PROJECT_FILE_BYTES },
      );
      session.mirrorUsed ||= out.kind === 'ok';
    }
    switch (out.kind) {
      case 'ok':
        if (commitKey) {
          await this.store.putFile(commitKey, path, {
            text: out.text,
            bytes: out.bytes,
          });
        }
        return out.text;
      case 'missing':
        if (out !== raw) {
          // The file host would not answer and the mirror says no: the mirror lags behind GitHub (a commit pushed a
          // moment ago is not there yet), so that is no word on the file. Only GitHub's own file host can say it is
          // absent.
          throw new GithubReadError(decodeURIComponent(path), hosts);
        }
        if (this.replacements.has(commit)) {
          return STALE; // another read found the commit gone while this one was asking
        }
        if (commit.remembered) {
          // Every file of a commit that does not exist is "missing", the project file included: ask once more which
          // commit it is, instead of taking a remembered answer for the truth (a file that really is absent costs
          // this one question per visit, and is then remembered as absent).
          await this.replaceRememberedCommit(session, commit);
          return STALE;
        }
        // Absent at a commit stays absent: remembered too, so a warm load asks for nothing. Not the project file: it
        // is the one file that a visitor is about to create, and the answer that it is not there is for this visit.
        if (commitKey && !isProjectFile(path)) {
          await this.store.putFile(commitKey, path, { text: null, bytes: 0 });
        }
        return undefined;
      case 'moved':
        return undefined;
      case 'too-large':
        throw new GithubFileTooLargeError(
          decodeURIComponent(path),
          MAX_PROJECT_FILE_BYTES,
        );
      default:
        throw new GithubReadError(decodeURIComponent(path), hosts);
    }
  }

  /** The session and repo-relative path of one file read; throws for an invalid id or path, or a run past its limit. */
  private prepare(
    projectId: string,
    relativePath: string,
    options: IGithubReadOptions | undefined,
  ): { session: IGithubSession; path: string } {
    const id = readableId(projectId);
    const path = projectFilePath(id.folder, relativePath);
    options?.budget?.take(path);
    return { session: this.session(id), path };
  }

  /**
   * `GET`s and JSON-decodes one file at `relativePath` (project-folder-relative)
   * from the project's commit. A missing file resolves to `undefined`
   * (never an error) — most callers here treat that as "this project doesn't
   * have one", not a failure. An empty file (or one of white space only) is
   * `null`, which is what `HttpClient` made of it: callers keep their defaults.
   *
   * Lazy: nothing is read, and nothing counts against the run's budget, until
   * something subscribes, and every subscription reads again what failed (so
   * `retry()` works). A file already read in this visit is not read twice.
   */
  public getRawJson<T>(
    projectId: string,
    relativePath: string,
    options?: IGithubReadOptions,
  ): Observable<T | null | undefined> {
    return defer(() => {
      const { session, path } = this.prepare(projectId, relativePath, options);
      let parsed = session.json.get(path) as
        | Promise<T | null | undefined>
        | undefined;
      if (!parsed) {
        parsed = this.readText(session, path).then((text) => {
          if (text === undefined) {
            return undefined;
          }
          if (text.trim() === '') {
            return null;
          }
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new Error(`${decodeURIComponent(path)} is not valid JSON`);
          }
        });
        session.json.set(path, parsed);
        const memo = parsed;
        parsed.catch(() => {
          if (session.json.get(path) === memo) {
            session.json.delete(path);
          }
        });
      }
      return from(parsed);
    });
  }

  /** Same as {@link getRawJson}, but for a plain-text body (a query's `.sql`/`.dtql`/`.http` sidecar). */
  public getRawText(
    projectId: string,
    relativePath: string,
    options?: IGithubReadOptions,
  ): Observable<string | undefined> {
    return defer(() => {
      const { session, path } = this.prepare(projectId, relativePath, options);
      return from(this.readText(session, path));
    });
  }

  // ---------------------------------------------------------------------
  // Environments
  // ---------------------------------------------------------------------

  /** `environments/<id>/` directory names — the project's real environment
   * list (deliberately NOT `datatug-project.json`'s own `environments`
   * array, which demo-project-1 confirms can be stale/incomplete: it lists
   * only `local`/`dev`/`prod`, missing the `QA`/`UAT` folders that do
   * exist). Titles are the folder name — no `.env.json` file in this
   * project carries its own `title`. */
  public listEnvironmentIds(projectId: string): Observable<string[]> {
    return this.listDirectory(projectId, 'environments').pipe(
      map((entries) =>
        entries.filter((e) => e.type === 'dir').map((e) => e.name),
      ),
    );
  }

  public getEnvironmentSummary(
    projectId: string,
    envId: string,
  ): Observable<IGithubEnvironmentSummary> {
    return this.getRawJson<IGithubEnvFile>(
      projectId,
      `environments/${envId}/${envId}.env.json`,
    ).pipe(
      map((file) => ({
        id: envId,
        title: file?.title || envId,
        dbServers: file?.dbServers?.map((s, i) => ({
          id: [s.driver, ...(s.catalogs || [])].join(':') || `server-${i}`,
          driver: s.driver,
          host: s.host || '',
          catalogs: s.catalogs,
        })),
      })),
    );
  }

  // ---------------------------------------------------------------------
  // Catalog tables (environment -> catalog -> tables/views)
  // ---------------------------------------------------------------------

  /**
   * `ICatalogTables`-shaped: the table/view identity list for one
   * environment's catalog, read from `dbmodels/<dbModel>/<schema>/{tables,
   * views}/<name>/` folder names — no column/key detail (this project's own
   * `main.<Table>.columns.json` files carry that, deliberately not fetched
   * here to keep this listing to a handful of requests; `EnvDbTablePageComponent`,
   * a table's row-level view, needs an agent anyway — see this task's PR body).
   */
  public getCatalogTables(
    projectId: string,
    envId: string,
    catalogId: string,
  ): Observable<IGithubCatalogTables> {
    return this.getRawJson<IGithubCatalogFile>(
      projectId,
      `environments/${envId}/catalogs/${catalogId}/${catalogId}.db.json`,
    ).pipe(
      switchMap((catalogFile) => {
        const dbModel = catalogFile?.dbModel;
        if (!dbModel) {
          return of<IGithubCatalogTables>({ tables: [], views: [] });
        }
        return this.catalogTablesForModel(projectId, dbModel);
      }),
    );
  }

  private catalogTablesForModel(
    projectId: string,
    dbModel: string,
  ): Observable<IGithubCatalogTables> {
    return this.listDirectory(projectId, `dbmodels/${dbModel}`).pipe(
      switchMap((entries) => {
        const schemas = entries
          .filter((e) => e.type === 'dir')
          .map((e) => e.name);
        if (!schemas.length) {
          return of<IGithubCatalogTables>({ tables: [], views: [] });
        }
        return forkJoin(
          schemas.map((schema) =>
            forkJoin({
              tables: this.listDirectory(
                projectId,
                `dbmodels/${dbModel}/${schema}/tables`,
              ),
              views: this.listDirectory(
                projectId,
                `dbmodels/${dbModel}/${schema}/views`,
              ),
            }).pipe(
              map(({ tables, views }) => ({
                tables: tables
                  .filter((e) => e.type === 'dir')
                  .map((e) => ({ schema, name: e.name, dbType: 'BASE TABLE' })),
                views: views
                  .filter((e) => e.type === 'dir')
                  .map((e) => ({ schema, name: e.name, dbType: 'VIEW' })),
              })),
            ),
          ),
        ).pipe(
          map((perSchema) => ({
            tables: perSchema
              .flatMap((r) => r.tables)
              .sort((a, b) => a.name.localeCompare(b.name)),
            views: perSchema
              .flatMap((r) => r.views)
              .sort((a, b) => a.name.localeCompare(b.name)),
          })),
        );
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------

  /** `entities/<id>/` directory names — the full entity list (deliberately not
   * `entities/entities-summary.json`, which only annotates a *subset* of entities
   * with a `note`, per demo-project-1: 2 of this project's 8 real entity folders). */
  public listEntityIds(projectId: string): Observable<string[]> {
    return this.listDirectory(projectId, 'entities').pipe(
      map((entries) =>
        entries.filter((e) => e.type === 'dir').map((e) => e.name),
      ),
    );
  }

  /** One entity's full definition — `entities/<id>/<id>.entity.json`
   * (mirrors `entity.service.ts`'s pre-existing `getEntityFromGithub`, now
   * routed through this shared reader instead of its own ad hoc URL/split
   * that silently ignored a project id's `@folder` segment). */
  public getEntity(
    projectId: string,
    entityId: string,
  ): Observable<IGithubEntityFile> {
    return this.getRawJson<IGithubEntityFile>(
      projectId,
      `entities/${entityId}/${entityId}.entity.json`,
    ).pipe(map((data) => data || { id: entityId, fields: [] }));
  }

  // ---------------------------------------------------------------------
  // Boards
  // ---------------------------------------------------------------------

  public getBoard(
    projectId: string,
    boardId: string,
  ): Observable<IGithubBoardFile & { id: string }> {
    return this.getRawJson<IGithubBoardFile>(
      projectId,
      `boards/${boardId}/board.json`,
    ).pipe(map((file) => ({ id: boardId, title: boardId, ...file })));
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  /** File-name suffixes this reader recognizes as a query DEFINITION file
   * (as opposed to a sidecar body file like `.sql`/`.dtql`/`.http`, or a
   * body file that happens to share a definition's own stem, e.g. the
   * legacy `<id>.sql` next to `<id>.sql.json`). Deliberately wider than
   * datatug-cli's own `all_queries`/`get_query` (which only recognize
   * `.query.json` — `pkg/api/query_id.go`'s `QueryFileSuffix`): this
   * project's `albums`/`artists`/`tracks` folders only have the legacy
   * `<id>.sql.json` shape, and the founder's own ruling names all six
   * query folders (including those three) as pages that must load. */
  private static isQueryDefFile(name: string): boolean {
    return name.endsWith('.query.json') || name.endsWith('.sql.json');
  }

  /** Derives a definition file's own bare id from its name —
   * `<id>.query.json` -> `<id>`; `<id>.sql.json` -> `<id>` — see this
   * file's own tests for the exact filenames this was reverse-engineered
   * from (demo-project-1's real `queries/` tree). */
  private static defFileBareId(name: string): string {
    if (name.endsWith('.query.json')) {
      return name.slice(0, -'.query.json'.length);
    }
    return name.slice(0, -'.sql.json'.length);
  }

  /** The sidecar BODY file for one definition file — `<id>.query.json` ->
   * `<id>.query.<ext>` (ext from `type`: sql/dtql/http); `<id>.sql.json` ->
   * `<id>.sql` (the def filename itself, minus only the trailing `.json` —
   * the legacy convention already spells the body's own extension into its
   * "sql" segment). */
  private static bodyFileNameFor(defFileName: string, type: string): string {
    if (defFileName.endsWith('.sql.json')) {
      return defFileName.slice(0, -'.json'.length);
    }
    const stem = defFileName.slice(0, -'.json'.length);
    const ext = type === 'HTTP' ? 'http' : type === 'DTQL' ? 'dtql' : 'sql';
    return `${stem}.${ext}`;
  }

  /** The full, recursively-nested query folder tree under `queries/` — one
   * `IGithubWireQueryFolder` per subfolder (a query directly under `queries/`,
   * with no subfolder, lands under the root `"~"` folder's own `items`).
   * Every item's `text` (the query body) is deliberately left unset here —
   * matching datatug-cli's own `all_queries` (queries.service.ts's own doc
   * comment: "text is absent from all_queries' own response") — so this one
   * call stays cheap (one raw fetch per DEFINITION file only, no body
   * fetches) and the query PAGE ({@link getQuery}) remains the only place a
   * body is ever read. */
  public getQueriesFolder(
    projectId: string,
  ): Observable<IGithubWireQueryFolder> {
    return this.listDirectory(projectId, 'queries').pipe(
      switchMap((entries) => {
        const subfolders = entries
          .filter((e) => e.type === 'dir')
          .map((e) => e.name);
        const rootItemFiles = entries
          .filter(
            (e) => e.type === 'file' && GithubProjectReaderService.isQueryDefFile(e.name),
          )
          .map((e) => e.name);

        const rootItems$ = this.loadQueryItems(projectId, '', rootItemFiles);
        const folders$: Observable<IGithubWireQueryFolder[]> = subfolders.length
          ? forkJoin(
              subfolders.map((folderName) =>
                this.listDirectory(projectId, `queries/${folderName}`).pipe(
                  switchMap((folderEntries) => {
                    const itemFiles = folderEntries
                      .filter(
                        (e) =>
                          e.type === 'file' &&
                          GithubProjectReaderService.isQueryDefFile(e.name),
                      )
                      .map((e) => e.name);
                    return this.loadQueryItems(projectId, folderName, itemFiles).pipe(
                      map(
                        (items): IGithubWireQueryFolder => ({
                          id: folderName,
                          items: items.length ? items : undefined,
                        }),
                      ),
                    );
                  }),
                ),
              ),
            )
          : of([]);

        return forkJoin([rootItems$, folders$]).pipe(
          map(([rootItems, folders]) => ({
            id: '~',
            folders: folders.length
              ? folders.sort((a, b) => a.id.localeCompare(b.id))
              : undefined,
            items: rootItems.length ? rootItems : undefined,
          })),
        );
      }),
    );
  }

  private loadQueryItems(
    projectId: string,
    folderName: string,
    defFileNames: string[],
  ): Observable<IGithubWireQueryItem[]> {
    if (!defFileNames.length) {
      return of([]);
    }
    return forkJoin(
      defFileNames.map((fileName) => {
        const relPath = folderName
          ? `queries/${folderName}/${fileName}`
          : `queries/${fileName}`;
        return this.getRawJson<IGithubWireQueryItem>(projectId, relPath).pipe(
          map((def): IGithubWireQueryItem => {
            const bareId = GithubProjectReaderService.defFileBareId(fileName);
            return {
              id: def?.id || bareId,
              title: def?.title,
              type: def?.type || 'SQL',
              parameters: def?.parameters,
              recordsets: def?.recordsets,
              dbModel: def?.dbModel,
              draft: def?.draft,
            };
          }),
        );
      }),
    ).pipe(map((items) => items.sort((a, b) => a.id.localeCompare(b.id))));
  }

  /**
   * One query's full definition, body included — `id` may be bare
   * (`"customer-invoices"`) or folder-qualified (`"customers/customer-invoices"`,
   * the same convention `ResolveQueryID`/datatug-cli#219 use). Resolved against
   * the cached tree (no extra `api.github.com` call), then the definition +
   * sidecar body files are fetched from `raw.githubusercontent.com`.
   */
  public getQuery(
    projectId: string,
    id: string,
  ): Observable<IGithubWireQueryItem> {
    return this.getTree(projectId).pipe(
      switchMap((tree) => {
        const { folder } = parseGithubProjectId(projectId);
        const queriesPrefix = folder ? `${folder}/queries/` : 'queries/';
        const wantsFolder = id.includes('/');
        const wantFolderName = wantsFolder ? id.slice(0, id.lastIndexOf('/')) : '';
        const wantBareId = wantsFolder ? id.slice(id.lastIndexOf('/') + 1) : id;

        const match = tree.find((e) => {
          if (e.type !== 'blob' || !e.path.startsWith(queriesPrefix)) {
            return false;
          }
          const relFromQueries = e.path.slice(queriesPrefix.length);
          const slashIdx = relFromQueries.indexOf('/');
          const folderName = slashIdx === -1 ? '' : relFromQueries.slice(0, slashIdx);
          const fileName = slashIdx === -1 ? relFromQueries : relFromQueries.slice(slashIdx + 1);
          if (!GithubProjectReaderService.isQueryDefFile(fileName)) {
            return false;
          }
          const bareId = GithubProjectReaderService.defFileBareId(fileName);
          return wantsFolder
            ? folderName === wantFolderName && bareId === wantBareId
            : bareId === wantBareId;
        });

        if (!match) {
          return throwError(
            () => new Error(`Query not found in GitHub project: ${id}`),
          );
        }

        const relFromQueries = match.path.slice(queriesPrefix.length);
        const slashIdx = relFromQueries.indexOf('/');
        const folderName = slashIdx === -1 ? '' : relFromQueries.slice(0, slashIdx);
        const fileName = slashIdx === -1 ? relFromQueries : relFromQueries.slice(slashIdx + 1);
        const defRelPath = folderName
          ? `queries/${folderName}/${fileName}`
          : `queries/${fileName}`;

        return this.getRawJson<IGithubWireQueryItem>(projectId, defRelPath).pipe(
          switchMap((def) => {
            const bareId = GithubProjectReaderService.defFileBareId(fileName);
            const type = def?.type || 'SQL';
            const bodyFileName = GithubProjectReaderService.bodyFileNameFor(
              fileName,
              type,
            );
            const bodyRelPath = folderName
              ? `queries/${folderName}/${bodyFileName}`
              : `queries/${bodyFileName}`;
            return this.getRawText(projectId, bodyRelPath).pipe(
              map(
                (text): IGithubWireQueryItem => ({
                  id: def?.id || bareId,
                  title: def?.title,
                  type,
                  text,
                  parameters: def?.parameters,
                  recordsets: def?.recordsets,
                  federation: def?.federation,
                  dbModel: def?.dbModel,
                  draft: def?.draft,
                }),
              ),
            );
          }),
        );
      }),
    );
  }
}

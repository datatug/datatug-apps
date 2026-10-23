import { githubGet } from '../../services/repo/github/github-http';
import { githubIdentity, readGithubUserToken, usableGithubToken } from '../../services/repo/github/github-user-token';

/** Immutable project subtree copied by the server after rechecking source access. */
export interface GithubProjectCopySource {
  readonly kind: 'github-project';
  readonly repositoryID: number;
  readonly owner: string;
  readonly name: string;
  readonly folder: string;
  readonly branch: string;
  readonly commit: string;
  readonly tree: string;
}

export function readGithubProjectCopySource(value: unknown): GithubProjectCopySource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<GithubProjectCopySource>;
  if (source.kind !== 'github-project' || !Number.isSafeInteger(source.repositoryID) || (source.repositoryID ?? 0) <= 0 ||
    ![source.owner, source.name].every((part) => typeof part === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(part)) ||
    typeof source.folder !== 'string' || !source.folder || source.folder.length > 256 ||
    source.folder.split('/').some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/.test(part)) ||
    typeof source.branch !== 'string' || !source.branch || source.branch.length > 255 || Array.from(source.branch).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    ![source.commit, source.tree].every((sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha))) return undefined;
  return { kind: 'github-project', repositoryID: source.repositoryID as number, owner: source.owner as string, name: source.name as string, folder: source.folder, branch: source.branch, commit: source.commit as string, tree: source.tree as string };
}

const COPY_SOURCE_FAILED = 'The source project revision could not be verified. Please try again.';
const DEMO_REPOSITORY_API = 'https://api.github.com/repos/datatug/datatug-demo-project';
/** How long a pinned copy source is reused: the same as the reader's memory of a resolved commit. */
export const COPY_SOURCE_TTL_MS = 5 * 60 * 1000;
const MAX_ANSWER_BYTES = 1024 * 1024;

/** What resolving the copy source uses. Injected by tests; the app passes nothing. */
export interface ICopySourceDeps {
  readonly fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  /** The signed-in user's GitHub token, when there is one (default: the one this tab keeps). */
  readonly token?: () => string | undefined;
  readonly now?: () => number;
}

interface IDemoRepository { readonly id: number; readonly owner?: { login?: string }; readonly name: string; readonly default_branch: string }

/**
 * What was resolved, for ONE identity (anonymous, or the fingerprint of the token it was asked with): an answer is
 * served only to the identity that asked for it, and only in this page's memory.
 */
let memory: {
  readonly identity: string;
  /** The repository's id and default branch: asked once per page (they do not change within a visit). */
  repository?: Promise<IDemoRepository>;
  /** The last pinned source, reused for {@link COPY_SOURCE_TTL_MS}. */
  pinned?: { readonly at: number; readonly source: GithubProjectCopySource };
  /** The resolution on its way: every caller shares it. */
  pinning?: Promise<GithubProjectCopySource>;
} | undefined;

/** Forgets what was resolved. For tests. */
export function resetDemoProjectCopySourceMemory(): void {
  memory = undefined;
}

/**
 * Pin the selected demo project at journey time, including the folder tree, not the repository root.
 *
 * `api.github.com` calls: 3 the first time in a page (the repository, its branch's commit, the root listing); 0 for
 * {@link COPY_SOURCE_TTL_MS} after that, and 2 afterwards (the repository is not asked again). Concurrent callers share
 * one resolution. Every call carries the signed-in user's GitHub token when there is one; a refused token (401) is
 * dropped and the call made again anonymously (`githubGet`). No redirect is followed, so the token goes nowhere else.
 */
export async function resolveDemoProjectCopySource(deps: ICopySourceDeps = {}): Promise<GithubProjectCopySource> {
  const now = deps.now ?? Date.now;
  const token = usableGithubToken((deps.token ?? readGithubUserToken)());
  const identity = githubIdentity(token);
  if (memory?.identity !== identity) memory = { identity };
  const mine = memory;
  const pinned = mine.pinned;
  if (pinned && now() - pinned.at >= 0 && now() - pinned.at < COPY_SOURCE_TTL_MS) return pinned.source;
  if (!mine.pinning) {
    const started = pinSource(mine, deps, token);
    mine.pinning = started;
    started.then(
      (source) => { mine.pinned = { at: now(), source }; },
      () => undefined,
    ).finally(() => { if (mine.pinning === started) mine.pinning = undefined; });
  }
  return mine.pinning;
}

async function pinSource(
  mine: NonNullable<typeof memory>,
  deps: ICopySourceDeps,
  token: string | undefined,
): Promise<GithubProjectCopySource> {
  const fetchFn = deps.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  const get = async (path: string) => {
    const out = await githubGet(fetchFn, `${DEMO_REPOSITORY_API}${path}`, {
      maxBytes: MAX_ANSWER_BYTES,
      accept: 'application/vnd.github+json',
      timeoutMs: 15000,
      token,
    });
    if (out.kind !== 'ok') throw new Error(COPY_SOURCE_FAILED);
    try {
      return JSON.parse(out.text);
    } catch {
      throw new Error(COPY_SOURCE_FAILED);
    }
  };
  if (!mine.repository) {
    const asked = get('') as Promise<IDemoRepository>;
    mine.repository = asked;
    asked.catch(() => { if (mine.repository === asked) mine.repository = undefined; });
  }
  const repo = await mine.repository;
  if (typeof repo?.default_branch !== 'string' || !repo.default_branch) throw new Error(COPY_SOURCE_FAILED);
  const revision = await get(`/commits/${encodeURIComponent(repo.default_branch)}`);
  const rootTree = revision?.commit?.tree?.sha;
  if (typeof rootTree !== 'string' || !/^[0-9a-f]{40}$/i.test(rootTree)) throw new Error(COPY_SOURCE_FAILED);
  const root = await get(`/git/trees/${rootTree}`);
  const folder = root?.tree?.find?.((entry: {path: string; type: string}) => entry.path === 'demo-project-1' && entry.type === 'tree');
  const source = readGithubProjectCopySource({ kind: 'github-project', repositoryID: repo?.id, owner: repo?.owner?.login, name: repo?.name, folder: 'demo-project-1', branch: repo?.default_branch, commit: revision?.sha, tree: folder?.sha });
  if (!source) throw new Error(COPY_SOURCE_FAILED);
  return source;
}

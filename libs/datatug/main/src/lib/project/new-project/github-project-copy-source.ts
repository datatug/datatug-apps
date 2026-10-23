import { readGithubUserToken } from '../../services/repo/github/github-user-token';

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

/** What resolving the copy source uses. Injected by tests; the app passes nothing. */
export interface ICopySourceDeps {
  readonly fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  /** The signed-in user's GitHub token, when there is one (default: the one this tab keeps). */
  readonly token?: () => string | undefined;
  readonly now?: () => number;
}

interface IDemoRepository { readonly id: number; readonly owner?: { login?: string }; readonly name: string; readonly default_branch: string }

/** The repository's id and default branch: asked once per page (they do not change within a visit). */
let repository: Promise<IDemoRepository> | undefined;
/** The last pinned source, reused for {@link COPY_SOURCE_TTL_MS}, and the one on its way (every caller shares it). */
let pinned: { readonly at: number; readonly source: GithubProjectCopySource } | undefined;
let pinning: Promise<GithubProjectCopySource> | undefined;

/** Forgets what was resolved. For tests. */
export function resetDemoProjectCopySourceMemory(): void {
  repository = undefined;
  pinned = undefined;
  pinning = undefined;
}

/**
 * Pin the selected demo project at journey time, including the folder tree, not the repository root.
 *
 * `api.github.com` calls: 3 the first time in a page (the repository, its branch's commit, the root listing); 0 for
 * {@link COPY_SOURCE_TTL_MS} after that, and 2 afterwards (the repository is not asked again). Concurrent callers share
 * one resolution. Every call carries the signed-in user's GitHub token when there is one, and falls back to an
 * anonymous call when GitHub refuses the token (401).
 */
export async function resolveDemoProjectCopySource(deps: ICopySourceDeps = {}): Promise<GithubProjectCopySource> {
  const now = deps.now ?? Date.now;
  if (pinned && now() - pinned.at >= 0 && now() - pinned.at < COPY_SOURCE_TTL_MS) return pinned.source;
  if (!pinning) {
    const started = pinSource(deps);
    pinning = started;
    started.then(
      (source) => { pinned = { at: now(), source }; },
      () => undefined,
    ).finally(() => { if (pinning === started) pinning = undefined; });
  }
  return pinning;
}

async function pinSource(deps: ICopySourceDeps): Promise<GithubProjectCopySource> {
  const fetchFn = deps.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  const token = (deps.token ?? readGithubUserToken)();
  const get = async (path: string) => {
    const ask = (withToken: boolean) => fetchFn(`${DEMO_REPOSITORY_API}${path}`, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json', ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    let response = await ask(true);
    if (response.status === 401 && token) response = await ask(false);
    if (!response.ok) throw new Error(COPY_SOURCE_FAILED);
    return response.json();
  };
  if (!repository) {
    const asked = get('') as Promise<IDemoRepository>;
    repository = asked;
    asked.catch(() => { if (repository === asked) repository = undefined; });
  }
  const repo = await repository;
  const revision = await get(`/commits/${encodeURIComponent(repo.default_branch)}`);
  const root = await get(`/git/trees/${encodeURIComponent(revision.commit.tree.sha)}`);
  const folder = root.tree?.find((entry: {path: string; type: string}) => entry.path === 'demo-project-1' && entry.type === 'tree');
  const source = readGithubProjectCopySource({ kind: 'github-project', repositoryID: repo.id, owner: repo.owner?.login, name: repo.name, folder: 'demo-project-1', branch: repo.default_branch, commit: revision.sha, tree: folder?.sha });
  if (!source) throw new Error(COPY_SOURCE_FAILED);
  return source;
}

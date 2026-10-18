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

/** Pin the selected demo project at journey time, including the folder tree, not the repository root. */
export async function resolveDemoProjectCopySource(): Promise<GithubProjectCopySource> {
  const get = async (path: string) => {
    const response = await fetch(`https://api.github.com/repos/datatug/datatug-demo-project${path}`, { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('The source project revision could not be verified. Please try again.');
    return response.json();
  };
  const repo = await get('');
  const revision = await get(`/commits/${encodeURIComponent(repo.default_branch)}`);
  const root = await get(`/git/trees/${encodeURIComponent(revision.commit.tree.sha)}`);
  const folder = root.tree?.find((entry: {path: string; type: string}) => entry.path === 'demo-project-1' && entry.type === 'tree');
  const source = readGithubProjectCopySource({ kind: 'github-project', repositoryID: repo.id, owner: repo.owner?.login, name: repo.name, folder: 'demo-project-1', branch: repo.default_branch, commit: revision.sha, tree: folder?.sha });
  if (!source) throw new Error('The source project revision could not be verified. Please try again.');
  return source;
}

import { HttpHeaders } from '@angular/common/http';

/** GitHub's public API, the only host the app calls for repository work. */
export const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Headers every authenticated GitHub API call needs. `X-GitHub-Api-Version`
 * pins the REST version so a GitHub default change cannot alter behaviour.
 */
export function githubApiHeaders(token: string): HttpHeaders {
  return new HttpHeaders({
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });
}

/** One repository, as the app needs it (a trimmed GitHub response). */
export interface IGithubRepo {
  /** `owner/name` — the form the project ref and the commit URLs use. */
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string;
}

/** The subset of GitHub's repository payload the app reads. */
export interface IGithubRepoWire {
  readonly full_name?: string;
  readonly name?: string;
  readonly owner?: { login?: string };
  readonly private?: boolean;
  readonly default_branch?: string;
}

/** Maps a GitHub repository payload to {@link IGithubRepo}, or undefined when incomplete. */
export function toGithubRepo(
  wire: IGithubRepoWire,
): IGithubRepo | undefined {
  const fullName =
    wire.full_name ||
    (wire.owner?.login && wire.name
      ? `${wire.owner.login}/${wire.name}`
      : undefined);
  if (!fullName) {
    return undefined;
  }
  return {
    fullName,
    private: !!wire.private,
    defaultBranch: wire.default_branch || 'main',
  };
}

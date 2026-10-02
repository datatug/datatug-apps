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

/**
 * A repository payload that cannot be used, and what is missing from it. The message is shown to the user (the new
 * project form), so it says what GitHub did not return rather than guessing: in particular there is no default
 * branch to assume, since a project committed to the wrong branch would not be the one the reader reads (`HEAD`).
 */
export class GithubRepoError extends Error {
  constructor(
    public readonly missing: 'full-name' | 'default-branch',
    message: string,
  ) {
    super(message);
    this.name = 'GithubRepoError';
  }
}

/**
 * Maps a GitHub repository payload to {@link IGithubRepo}, or undefined when incomplete: no full name, or no
 * default branch (never assumed to be `main`, see {@link GithubRepoError}).
 */
export function toGithubRepo(
  wire: IGithubRepoWire,
): IGithubRepo | undefined {
  const fullName =
    wire.full_name ||
    (wire.owner?.login && wire.name
      ? `${wire.owner.login}/${wire.name}`
      : undefined);
  if (!fullName || !wire.default_branch) {
    return undefined;
  }
  return {
    fullName,
    private: !!wire.private,
    defaultBranch: wire.default_branch,
  };
}

/**
 * The same, for a repository the caller needs in full: throws a {@link GithubRepoError} naming what GitHub did not
 * return. `name` is what the caller calls the repository (`owner/repo`, or the name given for a new one);
 * `created` says the repository has just been made, so the message does not let the user make it twice.
 */
export function requireGithubRepo(
  wire: IGithubRepoWire,
  name: string,
  created = false,
): IGithubRepo {
  const repo = toGithubRepo(wire);
  if (repo) {
    return repo;
  }
  const hasName = !!wire.full_name || (!!wire.owner?.login && !!wire.name);
  const lead = created ? `GitHub created ${name}, but` : 'GitHub';
  if (hasName) {
    throw new GithubRepoError(
      'default-branch',
      `${lead} did not return the default branch of ${name}, so DataTug cannot tell which branch to commit to.`,
    );
  }
  throw new GithubRepoError(
    'full-name',
    created
      ? `${lead} did not return its full name`
      : `GitHub did not return the repository ${name}`,
  );
}

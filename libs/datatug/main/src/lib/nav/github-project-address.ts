// Pure functions for the id and the trust of a project read from GitHub. No Angular, no I/O, no imports:
// design `demo-as-github-project.md` 3.3 (the id), 3.4a (one canonical spelling) and 3.6 (the trust decision).
//
// The two reader functions `parseGithubProjectId` and `buildGithubRawUrl` stay defined in
// `services/repo/github/github-project-reader.service.ts` (their one owner); they delegate here so that the
// reader service is not pulled into every file that only needs to read an address.

/** The store id of GitHub-stored projects (`parseStoreRef` recognises it). */
export const GITHUB_STORE_ID = 'github.com';

/** The folder a two-part id (`repo@org`) has always meant. */
export const DEFAULT_GITHUB_PROJECT_FOLDER = 'datatug';

/** The default branch, whatever it is called. The only spelling of it that an id or an address uses. */
export const GITHUB_DEFAULT_BRANCH_REF = 'HEAD';

/**
 * A GitHub project id: `repo@org`, `repo@org@folder` or `repo@org@folder@ref`.
 * `folder` is the repo-relative directory holding `datatug-project.json` (`''` is the repo root);
 * `ref` is present only for a branch, tag or commit that is not the default branch.
 */
export interface IGithubProjectId {
  readonly repo: string;
  readonly org: string;
  readonly folder: string;
  readonly ref?: string;
}

/**
 * Lower-cases A-Z only. `toLowerCase()` is not safe for a trust decision: the Kelvin sign U+212A lower-cases to
 * the ASCII `k` (`chinooK-demo` would then equal `chinook-demo`).
 */
export function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 32),
  );
}

function lowerIfString(value: string): string {
  // The reader has always been tolerant of a malformed id (`org` is undefined for `"abc"`): keep that.
  return typeof value === 'string' ? asciiLowerCase(value) : value;
}

/**
 * Splits a project id. Owner and repo are lower-cased (GitHub treats them case-insensitively, and one project
 * must have one id); folder and ref are not (they are case-sensitive on GitHub). A missing third part means the
 * folder `datatug`; an empty one means the repo root; a ref of `HEAD` means no ref (the default branch).
 * Never throws.
 */
export function splitGithubProjectId(projectId: string): IGithubProjectId {
  const [repo, org, folder = DEFAULT_GITHUB_PROJECT_FOLDER, ref] =
    projectId.split('@');
  const parts = { repo: lowerIfString(repo), org: lowerIfString(org), folder };
  return ref && ref !== GITHUB_DEFAULT_BRANCH_REF ? { ...parts, ref } : parts;
}

/** The one id of a project: the inverse of {@link splitGithubProjectId}, in its shortest spelling. */
export function formatGithubProjectId(project: IGithubProjectId): string {
  const repo = asciiLowerCase(project.repo);
  const org = asciiLowerCase(project.org);
  const ref =
    project.ref && project.ref !== GITHUB_DEFAULT_BRANCH_REF
      ? project.ref
      : undefined;
  if (ref) {
    return `${repo}@${org}@${project.folder}@${ref}`;
  }
  if (project.folder === DEFAULT_GITHUB_PROJECT_FOLDER) {
    return `${repo}@${org}`;
  }
  return `${repo}@${org}@${project.folder}`;
}

/** What GitHub allows as an owner (a user or an organisation): ASCII letters, digits, hyphens. */
export const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** What GitHub allows as a repository name: ASCII letters, digits, `.`, `_`, `-`; never `.` or `..`. */
export const GITHUB_REPO_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

// ---------------------------------------------------------------------------
// Trust (design 3.6)
// ---------------------------------------------------------------------------

/** What the trust decision looks at: the parsed address, nothing else. */
export interface IGithubProjectAddress {
  readonly owner: string;
  readonly repo: string;
  /** Absent (or `HEAD`) for the default branch. */
  readonly ref?: string;
}

/**
 * The projects that may run with no click. Compiled in. Exactly one entry at first: the demo repository, on its
 * default branch. Owner and repo are lower case.
 */
const TRUSTED_GITHUB_PROJECTS: readonly {
  readonly owner: string;
  readonly repo: string;
}[] = [{ owner: 'datatug', repo: 'chinook-demo' }];

/**
 * Whether a project may run with no click and read the app's own outside data hosts (design 3.6).
 *
 * Decided on the parsed `{owner, repo, ref}` and nowhere else: owner and repo lower-cased (ASCII only), each
 * compared for exact equality with the list, never a prefix, never the address string; `ref` must be absent or
 * exactly `HEAD`. Any other ref (a branch, a tag, a commit SHA) is not trusted, because GitHub serves a fork's
 * commits under the parent repository's address. Pass the parse of the address (`.git` and a trailing slash
 * already removed), not the string: a repo of `chinook-demo.git` or `chinook-demo/` is not the trusted one here.
 */
export function isTrustedGithubProject(
  address: IGithubProjectAddress,
): boolean {
  const { owner, repo, ref } = address ?? {};
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    return false;
  }
  if (ref !== undefined && ref !== GITHUB_DEFAULT_BRANCH_REF) {
    return false;
  }
  const lowerOwner = asciiLowerCase(owner);
  const lowerRepo = asciiLowerCase(repo);
  return TRUSTED_GITHUB_PROJECTS.some(
    (trusted) => trusted.owner === lowerOwner && trusted.repo === lowerRepo,
  );
}

/** {@link isTrustedGithubProject} for a project id (`repo@org[@folder[@ref]]`). */
export function isTrustedGithubProjectId(projectId: string): boolean {
  if (typeof projectId !== 'string' || projectId.split('@').length > 4) {
    return false;
  }
  const { org, repo, ref } = splitGithubProjectId(projectId);
  return isTrustedGithubProject({ owner: org, repo, ref });
}

// Pure functions for the id and the trust of a project read from GitHub. No Angular, no I/O, no imports:
// design `demo-as-github-project.md` 3.3 (the id), 3.4a (one canonical spelling) and 3.6 (the trust decision).
//
// The two reader functions `parseGithubProjectId` and `buildGithubRawUrl` stay defined in
// `services/repo/github/github-project-reader.service.ts` (their one owner); they delegate here so that the
// reader service is not pulled into every file that only needs to read an address.
//
// Two readings of an id exist. `splitGithubProjectId` is lenient and never throws (the reader has always been
// tolerant of a malformed id). `readGithubProjectId` is strict: it is the only reading that a URL is built from
// and that a trust decision is made on.

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

const UNSAFE_SEGMENT_CHARS = '/\\%?#';

/**
 * One path segment of a repository path or a ref, as a person would type it (decoded): not empty, not `.` or `..`,
 * no `/ \ % ? #`, no control character, no leading or trailing whitespace. A space inside is fine.
 */
export function isSafePathSegment(segment: unknown): segment is string {
  if (
    typeof segment !== 'string' ||
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    segment !== segment.trim()
  ) {
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

/** A project folder: `''` (the repo root) or `/`-separated safe segments, none of them `-` (it ends a locator) or containing `@`. */
export function isValidGithubFolder(folder: unknown): folder is string {
  return (
    folder === '' ||
    (typeof folder === 'string' &&
      folder
        .split('/')
        .every((s) => s !== '-' && !s.includes('@') && isSafePathSegment(s)))
  );
}

export type NewProjectFolderReading =
  | { readonly ok: true; readonly folder: string }
  | { readonly ok: false; readonly reason: 'leading-slash' | 'invalid' };

/**
 * The folder field of the new-project form, as the reader will accept it. A blank field means the default folder
 * (`datatug`); a folder starting with `/` is refused (it would read as an absolute path); trailing slashes are
 * dropped; what is left must be {@link isValidGithubFolder} and not empty, so `..`, `.`, a backslash, an empty
 * segment (`a//b`), a `-` segment, `@`, `%`, `?` and `#` are all refused: a project can only be created in a
 * folder that the reader (and so its address) can open.
 */
export function readNewProjectFolder(typed: unknown): NewProjectFolderReading {
  const trimmed = typeof typed === 'string' ? typed.trim() : '';
  if (trimmed === '') {
    return { ok: true, folder: DEFAULT_GITHUB_PROJECT_FOLDER };
  }
  if (trimmed.startsWith('/')) {
    return { ok: false, reason: 'leading-slash' };
  }
  const folder = trimmed.replace(/\/+$/, '');
  return folder !== '' && isValidGithubFolder(folder)
    ? { ok: true, folder }
    : { ok: false, reason: 'invalid' };
}

/** A branch, tag or commit as one path segment (a `/` is not supported: use the commit). */
export function isValidGithubRef(ref: unknown): ref is string {
  return isSafePathSegment(ref) && !ref.includes('@');
}

export type GithubProjectIdProblem =
  | 'parts'
  | 'owner-or-repo'
  | 'folder'
  | 'ref';

export type GithubProjectIdReading =
  | { readonly ok: true; readonly id: IGithubProjectId }
  | { readonly ok: false; readonly reason: GithubProjectIdProblem };

/**
 * The strict reading of a project id: two to four `@`-separated parts, a real owner and repo name (ASCII, no `.git`
 * ending), a folder of safe segments (design 3.3: `''` is the root, a missing third part is `datatug`), and a safe
 * one-segment ref (empty or `HEAD` mean the default branch and read as no ref). Owner and repo come back lower
 * case. Never throws; anything that is not a valid id is a reason.
 */
export function readGithubProjectId(
  projectId: unknown,
): GithubProjectIdReading {
  if (typeof projectId !== 'string') {
    return { ok: false, reason: 'parts' };
  }
  const parts = projectId.split('@');
  if (parts.length < 2 || parts.length > 4) {
    return { ok: false, reason: 'parts' };
  }
  const [repo, org, folder = DEFAULT_GITHUB_PROJECT_FOLDER, ref] = parts;
  if (
    !GITHUB_OWNER_PATTERN.test(org) ||
    !GITHUB_REPO_PATTERN.test(repo) ||
    asciiLowerCase(repo).endsWith('.git')
  ) {
    return { ok: false, reason: 'owner-or-repo' };
  }
  if (!isValidGithubFolder(folder)) {
    return { ok: false, reason: 'folder' };
  }
  const named = ref && ref !== GITHUB_DEFAULT_BRANCH_REF ? ref : undefined;
  if (named !== undefined && !isValidGithubRef(named)) {
    return { ok: false, reason: 'ref' };
  }
  return {
    ok: true,
    id: {
      repo: asciiLowerCase(repo),
      org: asciiLowerCase(org),
      folder,
      ...(named !== undefined ? { ref: named } : {}),
    },
  };
}

/** Thrown when an id cannot be used to read a project from GitHub. */
export class GithubProjectIdError extends Error {
  constructor(
    public readonly reason: GithubProjectIdProblem | 'path',
    message: string,
  ) {
    super(message);
    this.name = 'GithubProjectIdError';
  }
}

// ---------------------------------------------------------------------------
// Trust (design 3.6)
// ---------------------------------------------------------------------------

/**
 * The projects that may run with no click. Compiled in. Exactly one entry at first: the demo repository, at the
 * repository root, on its default branch. Owner and repo are lower case. `folder` is `''` for every entry in the
 * shared demo (the only trusted folder is demo-project-1).
 */
const TRUSTED_GITHUB_PROJECTS: readonly {
  readonly owner: string;
  readonly repo: string;
  readonly folder: string;
}[] = [{ owner: 'datatug', repo: 'datatug-demo-project', folder: 'demo-project-1' }];

function isTrustedGithubProject(address: {
  readonly owner: string;
  readonly repo: string;
  readonly folder: string;
  readonly ref?: string;
}): boolean {
  const { owner, repo, folder, ref } = address;
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    return false;
  }
  if (ref !== undefined && ref !== GITHUB_DEFAULT_BRANCH_REF) {
    return false;
  }
  const lowerOwner = asciiLowerCase(owner);
  const lowerRepo = asciiLowerCase(repo);
  return TRUSTED_GITHUB_PROJECTS.some(
    (t) =>
      t.owner === lowerOwner && t.repo === lowerRepo && t.folder === folder,
  );
}

/** What the trust decision is asked about: a store and a project id, as every page reads them. */
export interface IProjectAddressLike {
  readonly storeId: string;
  readonly projectId: string;
}

/**
 * Whether a project may run with no click and read the app's own outside data hosts (design 3.6). The ONE trust
 * function: it cannot be asked without the store. Pass `parseProjectUrl`'s result or a `{storeId, projectId}`.
 *
 * Trusted means all of:
 * - the store is exactly `github.com` (a case variant, `github`, an agent or Firestore id never is);
 * - the id reads strictly (`readGithubProjectId`): a real owner and repo, a folder of safe segments, a safe ref;
 * - owner and repo, lower-cased (ASCII only), equal exactly an entry of the compiled-in list: never a prefix,
 *   never the address string;
 * - the folder is empty: in the FIRST release the demo project is at the root of its repo, so a trusted project
 *   has no folder (this also closes every `..`, `\`, `?` or `#` trick in a folder);
 * - the ref is absent or exactly `HEAD`. Any other ref (a branch, a tag, a commit SHA) is not trusted, because
 *   GitHub serves a fork's commits under the parent repository's address.
 *
 * Only own properties of the argument are read. Anything that is not such an address is not trusted.
 */
export function isTrustedProjectAddress(
  address: IProjectAddressLike | { readonly ok: false },
): boolean {
  if (typeof address !== 'object' || address === null) {
    return false;
  }
  const own = (name: string): unknown =>
    Object.prototype.hasOwnProperty.call(address, name)
      ? (address as unknown as Record<string, unknown>)[name]
      : undefined;
  if (own('storeId') !== GITHUB_STORE_ID) {
    return false;
  }
  const reading = readGithubProjectId(own('projectId'));
  if (!reading.ok) {
    return false;
  }
  const { org, repo, folder, ref } = reading.id;
  return isTrustedGithubProject({ owner: org, repo, folder, ref });
}

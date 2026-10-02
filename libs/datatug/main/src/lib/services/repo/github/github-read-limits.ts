// Limits and errors of reading a project from GitHub (design `demo-as-github-project.md` 3.6 and 4.5).
// Pure: no Angular, no I/O.

import {
  MAX_DATA_FILE_BYTES,
  MAX_FILES_PER_RUN,
  MAX_PROJECT_FILE_BYTES,
} from '../../../project-files/project-file-limits';

export { MAX_DATA_FILE_BYTES, MAX_FILES_PER_RUN, MAX_PROJECT_FILE_BYTES };

/**
 * The listing of a repository (`git/trees/<commit>?recursive=1`). GitHub itself stops a recursive listing at
 * 100,000 entries or 7 MB; the cap sits just above that so an honest repository always reads, and a response
 * that is not a listing is refused while it is still being received.
 */
export const MAX_TREE_BYTES = 8 * 1024 * 1024;

/** How long one request may take, the body included, before the next host is tried. */
export const GITHUB_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Shown to the user (via `ErrorLoggerService`) instead of GitHub's own opaque `403` body: for this
 * unauthenticated, read-only client a `403` from the API means "rate limited".
 */
export const GITHUB_RATE_LIMIT_MESSAGE =
  'GitHub API rate limit reached for this browser — please wait a few minutes and try again (unauthenticated requests to api.github.com are capped at 60/hour).';

/** Every host failed to answer a read (a failed step names the hosts, design 4.5). */
export class GithubReadError extends Error {
  constructor(
    public readonly path: string,
    public readonly hosts: readonly string[],
  ) {
    super(
      `Could not read ${path} from GitHub: ${hosts.join(' and ')} did not answer. Please try again in a few minutes.`,
    );
    this.name = 'GithubReadError';
  }
}

/** A project file larger than the cap (checked on the bytes received, not on a header). */
export class GithubFileTooLargeError extends Error {
  constructor(
    public readonly path: string,
    public readonly limitBytes: number,
  ) {
    super(
      `${path} is larger than ${Math.round(limitBytes / 1024)} KB, so DataTug does not read it.`,
    );
    this.name = 'GithubFileTooLargeError';
  }
}

/** A run asked for more files than one run may read. */
export class GithubReadLimitError extends Error {
  constructor(
    public readonly path: string,
    public readonly limit: number,
  ) {
    super(
      `A run may read at most ${limit} files from a project; ${path} is one too many.`,
    );
    this.name = 'GithubReadLimitError';
  }
}

/**
 * The project is not there: the repository or ref does not exist, has no project file, or GitHub answered with a
 * redirect (a renamed or moved repository), which is refused. Shown as "No DataTug project here".
 */
export class GithubProjectNotFoundError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly reason: 'missing' | 'moved',
  ) {
    super(`No DataTug project here (${reason}): ${projectId}`);
    this.name = 'GithubProjectNotFoundError';
  }
}

/**
 * Counts the distinct files one run reads (a run is whatever the caller says it is: one investigation). The
 * count includes files served from the cache, so a cached run is held to the same limit as a cold one. A file read
 * twice counts once.
 */
export class GithubReadBudget {
  private readonly files = new Set<string>();

  constructor(public readonly maxFiles: number = MAX_FILES_PER_RUN) {}

  /** Records a read of `path`; throws {@link GithubReadLimitError} when it would exceed the limit. */
  take(path: string): void {
    if (this.files.has(path)) {
      return;
    }
    if (this.files.size >= this.maxFiles) {
      throw new GithubReadLimitError(path, this.maxFiles);
    }
    this.files.add(path);
  }

  get used(): number {
    return this.files.size;
  }
}

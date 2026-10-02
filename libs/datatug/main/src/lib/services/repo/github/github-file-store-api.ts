// What the GitHub reader needs from its persistent cache (design `demo-as-github-project.md` 4.5 step 3, 3.6
// "The file cache", 6.6). The cache is a database of its own (`datatug-github-files`), never a new version of an
// existing one, so rolling the app back cannot break an older build; storage that is blocked or full means no cache,
// never a failed read. This file is the small, always-loaded half: the contract and the lazy loader. The IndexedDB
// code, its limits and the eviction plan (`github-file-store.ts`) are a separate chunk, loaded on first use.

/** A file as the cache keeps it: its text, or `null` for "this commit has no such file" (also immutable). */
export interface IGithubStoredFile {
  readonly text: string | null;
  /** Bytes received for it (what the 20 MB limit counts). */
  readonly bytes: number;
}

/** The answer of the resolve call, remembered (design 4.5 step 1 and the degrade table). */
export interface IGithubResolvedCommit {
  readonly sha: string;
  /** When it was resolved, in ms since the epoch. */
  readonly at: number;
}

export interface IGithubFileStore {
  /** A file of a commit; `undefined` when it is not cached. `commitKey` is `<owner>/<repo>@<sha>`. */
  getFile(
    commitKey: string,
    path: string,
  ): Promise<IGithubStoredFile | undefined>;
  /** Keeps a file under its commit, evicting what the limits require. A file that cannot fit is not kept. */
  putFile(
    commitKey: string,
    path: string,
    file: IGithubStoredFile,
  ): Promise<void>;
  /** The commit remembered for `<owner>/<repo>@<ref>` (`HEAD` for the default branch). */
  getResolved(key: string): Promise<IGithubResolvedCommit | undefined>;
  putResolved(key: string, commit: IGithubResolvedCommit): Promise<void>;
  /**
   * Drops the remembered answer of one ref only (`key` as for `getResolved`): GitHub has answered that the ref no
   * longer exists (or the repository moved), so the earlier answer is of no use. The other refs of the repository
   * keep theirs.
   */
  dropResolved(key: string): Promise<void>;
  /**
   * Drops every remembered answer of one repository, whatever the ref (`repoKey` is `<owner>/<repo>`, lower case): the
   * repository has changed under it (a project was created in it). Files and listings are keyed by commit and never
   * change, so they stay.
   */
  forgetResolved(repoKey: string): Promise<void>;
}

/** No cache: every read goes to the network. Blocked storage, or a test that wants no cache. */
export const NO_GITHUB_FILE_STORE: IGithubFileStore = {
  getFile: () => Promise.resolve(undefined),
  putFile: () => Promise.resolve(),
  getResolved: () => Promise.resolve(undefined),
  putResolved: () => Promise.resolve(),
  dropResolved: () => Promise.resolve(),
  forgetResolved: () => Promise.resolve(),
};

/** How long the answer of the resolve call is trusted without asking again (design 4.5 step 1). */
export const GITHUB_RESOLVE_TTL_MS = 5 * 60 * 1000;

/**
 * A store that opens its IndexedDB implementation on first use, so the code that talks to IndexedDB is a chunk of
 * its own that no page without a GitHub project ever loads. A failure to load or open means no cache.
 */
export function createLazyGithubFileStore(
  load: () => Promise<IGithubFileStore>,
): IGithubFileStore {
  let store: Promise<IGithubFileStore> | undefined;
  const get = (): Promise<IGithubFileStore> =>
    (store ??= load().catch(() => NO_GITHUB_FILE_STORE));
  return {
    getFile: (commitKey, path) => get().then((s) => s.getFile(commitKey, path)),
    putFile: (commitKey, path, file) =>
      get().then((s) => s.putFile(commitKey, path, file)),
    getResolved: (key) => get().then((s) => s.getResolved(key)),
    putResolved: (key, commit) => get().then((s) => s.putResolved(key, commit)),
    dropResolved: (key) => get().then((s) => s.dropResolved(key)),
    forgetResolved: (repoKey) => get().then((s) => s.forgetResolved(repoKey)),
  };
}

/**
 * How long a read waits for one call to the cache. Past it the read goes on from the network, as it would with an
 * empty cache; whether the cache is given up on is decided by {@link guardGithubFileStore}.
 */
export const GITHUB_STORE_TIMEOUT_MS = 1500;

/**
 * How long the cache has to answer its first call at all before it is given up on for the visit. The first call
 * carries the loading of the cache's own chunk and the opening of the database, which on a slow device takes longer
 * than a read can be held up for ({@link GITHUB_STORE_TIMEOUT_MS}): reads do not wait for it, but an answer that
 * arrives within this limit switches the cache back on for the calls that come after.
 */
export const GITHUB_STORE_OPEN_TIMEOUT_MS = 5000;

/** Starts a timer; returns what cancels it. Injected (see `GITHUB_TIMER`) so a test fires it by hand. */
export type GithubSetTimer = (fire: () => void, ms: number) => () => void;

export const setGithubTimer: GithubSetTimer = (fire, ms) => {
  const timer = setTimeout(fire, ms);
  return () => clearTimeout(timer);
};

/**
 * The cache as the reader uses it: a call that fails, or does not answer within `timeoutMs`, answers as an empty cache
 * would (nothing found, nothing kept); a late answer is never applied to a call that has already completed.
 *
 * What a call that does not answer in time means depends on what is known of the cache:
 * - Not heard from yet (the first call, which loads the cache and opens its database): the calls that follow answer
 *   empty at once instead of each waiting in turn; the cache is on again as soon as any call is answered, and is
 *   given up on for the rest of the visit when none has been within `openTimeoutMs` of the first call.
 * - Known to work: a database that now hangs (blocked by another tab, a browser that never answers) turns the cache
 *   off for the rest of the visit, so it costs one wait, not one per file. Only a call that began once the cache was
 *   known to work can say so: the wait of a call that began before (while the cache was still opening) ends with an
 *   empty answer for that call and changes nothing.
 * A call made `through` the guard (the deletion of a remembered answer, which must reach the database whenever it
 * can) is attempted even when the cache is off or paused, with the same wait.
 */
export function guardGithubFileStore(
  store: IGithubFileStore,
  setTimer: GithubSetTimer = setGithubTimer,
  timeoutMs: number = GITHUB_STORE_TIMEOUT_MS,
  openTimeoutMs: number = GITHUB_STORE_OPEN_TIMEOUT_MS,
): IGithubFileStore {
  type State = 'unproven' | 'proven' | 'paused' | 'off';
  let state: State = 'unproven';
  let openLimit: (() => void) | undefined;
  let openLimitStarted = false;

  /** The database answered something: it works. Too late to matter once it has been given up on. */
  const answered = (): void => {
    openLimit?.();
    openLimit = undefined;
    if (state === 'unproven' || state === 'paused') {
      state = 'proven';
    }
  };

  const guarded = <T>(
    call: () => Promise<T>,
    empty: T,
    through = false,
  ): Promise<T> => {
    if ((state === 'off' || state === 'paused') && !through) {
      return Promise.resolve(empty);
    }
    // Whether the cache was known to work when this call began: the wait of a call that began before says nothing about
    // a cache proven since (a state never goes back to unproven, so for the opening it needs no such check).
    const beganProven = state === 'proven';
    return new Promise<T>((resolve) => {
      const cancel = setTimer(() => {
        if (state === 'unproven') {
          state = 'paused';
        } else if (state === 'proven' && beganProven) {
          state = 'off';
        }
        resolve(empty);
      }, timeoutMs);
      if (state === 'unproven' && !openLimitStarted) {
        openLimitStarted = true;
        // Cancelled by the first answer, so it fires only when the cache never answered.
        openLimit = setTimer(() => {
          openLimit = undefined;
          state = 'off';
        }, openTimeoutMs);
      }
      let answer: Promise<T>;
      try {
        answer = call();
      } catch (err) {
        answer = Promise.reject(err);
      }
      answer.then(
        (value) => {
          cancel();
          resolve(value);
          answered();
        },
        () => {
          cancel();
          resolve(empty);
          answered();
        },
      );
    });
  };
  return {
    getFile: (commitKey, path) =>
      guarded(() => store.getFile(commitKey, path), undefined),
    putFile: (commitKey, path, file) =>
      guarded(() => store.putFile(commitKey, path, file), undefined),
    getResolved: (key) => guarded(() => store.getResolved(key), undefined),
    putResolved: (key, commit) =>
      guarded(() => store.putResolved(key, commit), undefined),
    dropResolved: (key) =>
      guarded(() => store.dropResolved(key), undefined, true),
    forgetResolved: (repoKey) =>
      guarded(() => store.forgetResolved(repoKey), undefined, true),
  };
}

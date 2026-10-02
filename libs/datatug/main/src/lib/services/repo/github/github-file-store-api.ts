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
}

/** No cache: every read goes to the network. Blocked storage, or a test that wants no cache. */
export const NO_GITHUB_FILE_STORE: IGithubFileStore = {
  getFile: () => Promise.resolve(undefined),
  putFile: () => Promise.resolve(),
  getResolved: () => Promise.resolve(undefined),
  putResolved: () => Promise.resolve(),
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
  };
}

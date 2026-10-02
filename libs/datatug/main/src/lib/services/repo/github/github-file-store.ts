// The persistent file cache of the GitHub reader, over IndexedDB (design `demo-as-github-project.md` 4.5 step 3,
// 3.6 "The file cache", 6.6). Loaded on first use (`createLazyGithubFileStore`), never in the always-loaded code.
//
// Rollback-safe by construction (6.6 rule 1): a database of its own, version 1, that no other part of the app
// opens. An older build of the app has never heard of it, so it cannot be broken by it, and this build never
// touches `datatug-chat-sessions` or any other database. For its own future (6.6 rule 3) the database is opened
// at whatever version it is found at, when every store this build needs is present, so a rollback of a later
// change to this very database does not lose the cache either.
//
// Keys. A file: `<owner>/<repo>@<sha>/<encoded path>` (the path as it is in the URL, so a `#` can never appear in
// one); the listing of a commit: `<owner>/<repo>@<sha>/#tree`. A commit's files never change, so they are written
// once and never updated. Bounded as `GITHUB_FILE_STORE_LIMITS`.

import {
  type IGithubFileStore,
  type IGithubResolvedCommit,
  type IGithubStoredFile,
  NO_GITHUB_FILE_STORE,
} from './github-file-store-api';

/** The bounds of the cache (design 3.6): 20 MB and 20 repos in all, two commits per repo, least recently used out first. */
export interface IGithubFileStoreLimits {
  readonly maxBytes: number;
  readonly maxRepos: number;
  readonly maxCommitsPerRepo: number;
  /** The remembered resolve answers kept (a few bytes each). */
  readonly maxResolved: number;
}

export const GITHUB_FILE_STORE_LIMITS: IGithubFileStoreLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxRepos: 20,
  maxCommitsPerRepo: 2,
  maxResolved: 50,
};

/** One cached commit, as the eviction plan sees it. */
export interface IGithubCachedCommit {
  /** `<owner>/<repo>@<sha>` */
  readonly key: string;
  /** `<owner>/<repo>` */
  readonly repo: string;
  readonly bytes: number;
  /** Last use, ms since the epoch. */
  readonly used: number;
}

/**
 * Which cached commits to drop before a file of `bytes` is added to `current`, and whether it fits at all. Pure.
 * In order: more than `maxCommitsPerRepo` commits of the current repo (least recently used first), more than
 * `maxRepos` repos (the repo used longest ago, all its commits), then more than `maxBytes` bytes (the commit used
 * longest ago). The current commit is never dropped; when it alone cannot fit, nothing is dropped and the file is not
 * kept.
 */
export function planGithubFileEviction(
  commits: readonly IGithubCachedCommit[],
  current: { readonly key: string; readonly repo: string },
  bytes: number,
  limits: IGithubFileStoreLimits,
): { readonly fits: boolean; readonly evict: readonly string[] } {
  const own = commits.find((c) => c.key === current.key);
  const others = commits.filter((c) => c.key !== current.key);
  if ((own?.bytes ?? 0) + bytes > limits.maxBytes) {
    return { fits: false, evict: [] };
  }
  const evict = new Set<string>();
  const alive = () => others.filter((c) => !evict.has(c.key));
  const byUsed = (a: IGithubCachedCommit, b: IGithubCachedCommit) =>
    a.used - b.used;

  const sameRepo = alive()
    .filter((c) => c.repo === current.repo)
    .sort(byUsed);
  while (sameRepo.length + 1 > limits.maxCommitsPerRepo && sameRepo.length) {
    evict.add((sameRepo.shift() as IGithubCachedCommit).key);
  }

  for (;;) {
    const repos = new Map<string, number>();
    for (const c of alive()) {
      repos.set(c.repo, Math.max(repos.get(c.repo) ?? 0, c.used));
    }
    repos.delete(current.repo);
    if (repos.size + 1 <= limits.maxRepos || repos.size === 0) {
      break;
    }
    const [oldest] = [...repos.entries()].sort((a, b) => a[1] - b[1])[0];
    for (const c of alive().filter((c) => c.repo === oldest)) {
      evict.add(c.key);
    }
  }

  const total = () =>
    alive().reduce((sum, c) => sum + c.bytes, 0) + (own?.bytes ?? 0) + bytes;
  while (total() > limits.maxBytes) {
    const [oldest] = alive().sort(byUsed);
    evict.add(oldest.key);
  }
  return { fits: true, evict: [...evict] };
}

export const GITHUB_FILE_STORE_DB = 'datatug-github-files';
export const GITHUB_FILE_STORE_VERSION = 1;
const FILES = 'files';
const COMMITS = 'commits';
const RESOLVED = 'resolved';
const STORES = [FILES, COMMITS, RESOLVED];

interface IFileRow {
  readonly key: string;
  readonly text: string | null;
  readonly bytes: number;
}
interface ICommitRow extends IGithubCachedCommit {
  readonly sha: string;
}
interface IResolvedRow extends IGithubResolvedCommit {
  readonly key: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function open(factory: IDBFactory, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req =
      version === undefined
        ? factory.open(GITHUB_FILE_STORE_DB)
        : factory.open(GITHUB_FILE_STORE_DB, version);
    // Whether this open has been answered (opened or given up on). `blocked` gives it up, but the browser goes on
    // with the open and may complete it later, once the other tab lets go: that connection is nobody's, and an open
    // connection that nobody holds would stand in the way of a later upgrade of this database.
    let answered = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'key' });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Never hold up a later build's upgrade of this database, whoever ends up with the connection.
      db.onversionchange = () => db.close();
      if (answered) {
        db.close();
        return;
      }
      answered = true;
      resolve(db);
    };
    req.onerror = () => {
      answered = true;
      reject(req.error);
    };
    req.onblocked = () => {
      answered = true;
      reject(new Error('blocked'));
    };
  });
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  let db: IDBDatabase;
  try {
    db = await open(factory, GITHUB_FILE_STORE_VERSION);
  } catch (err) {
    if ((err as DOMException | undefined)?.name !== 'VersionError') {
      throw err;
    }
    // A later build raised the version and this one was rolled back to: use it as it is.
    db = await open(factory);
  }
  if (!STORES.every((name) => db.objectStoreNames.contains(name))) {
    db.close();
    throw new Error('the file cache has not the stores this build needs');
  }
  return db;
}

/** The key range of every entry of one commit: `<commit>/` up to, not including, `<commit>0` (`0` follows `/`). */
function commitRange(commitKey: string): IDBKeyRange {
  return IDBKeyRange.bound(`${commitKey}/`, `${commitKey}0`, false, true);
}

/**
 * The cache over `factory` (`indexedDB`). `now` is injected so a test controls "last used". Anything IndexedDB
 * refuses (blocked, private mode, full, a newer unknown schema) disables the cache for the rest of the visit: the
 * reads go to the network, nothing fails.
 */
export function openGithubFileStore(
  factory: IDBFactory | undefined,
  now: () => number,
  limits: IGithubFileStoreLimits = GITHUB_FILE_STORE_LIMITS,
): IGithubFileStore {
  if (!factory) {
    return NO_GITHUB_FILE_STORE;
  }
  let database: Promise<IDBDatabase | undefined> | undefined;
  const db = (): Promise<IDBDatabase | undefined> =>
    (database ??= openDatabase(factory).catch(() => undefined));
  const touched = new Set<string>();

  /** Runs `body` on the database, or resolves `fallback` when the cache is off or `body` fails. */
  const run = async <T>(
    fallback: T,
    body: (database: IDBDatabase) => Promise<T>,
  ): Promise<T> => {
    const opened = await db();
    if (!opened) {
      return fallback;
    }
    try {
      return await body(opened);
    } catch {
      return fallback;
    }
  };

  return {
    getFile: (commitKey, path) =>
      run<IGithubStoredFile | undefined>(undefined, async (database) => {
        const tx = database.transaction(FILES, 'readonly');
        const row = (await request(
          tx.objectStore(FILES).get(`${commitKey}/${path}`),
        )) as IFileRow | undefined;
        if (!row) {
          return undefined;
        }
        if (!touched.has(commitKey)) {
          touched.add(commitKey);
          // Recently used: once per visit and commit is enough for "least recently used".
          const touch = database.transaction(COMMITS, 'readwrite');
          const store = touch.objectStore(COMMITS);
          const commit = (await request(store.get(commitKey))) as
            | ICommitRow
            | undefined;
          if (commit) {
            store.put({ ...commit, used: now() });
          }
          await done(touch);
        }
        return { text: row.text, bytes: row.bytes };
      }),

    putFile: (commitKey, path, file) =>
      run<void>(undefined, async (database) => {
        const tx = database.transaction([FILES, COMMITS], 'readwrite');
        const files = tx.objectStore(FILES);
        const commits = tx.objectStore(COMMITS);
        const key = `${commitKey}/${path}`;
        if ((await request(files.count(key))) > 0) {
          return; // Immutable: already kept.
        }
        const rows = (await request(commits.getAll())) as ICommitRow[];
        const at = commitKey.lastIndexOf('@');
        const repo = commitKey.slice(0, at);
        const plan = planGithubFileEviction(
          rows,
          { key: commitKey, repo },
          file.bytes,
          limits,
        );
        if (!plan.fits) {
          return;
        }
        for (const gone of plan.evict) {
          files.delete(commitRange(gone));
          commits.delete(gone);
        }
        const own = rows.find((r) => r.key === commitKey);
        commits.put({
          key: commitKey,
          repo,
          sha: commitKey.slice(at + 1),
          bytes: (own?.bytes ?? 0) + file.bytes,
          used: now(),
        } satisfies ICommitRow);
        files.put({
          key,
          text: file.text,
          bytes: file.bytes,
        } satisfies IFileRow);
        await done(tx);
      }),

    getResolved: (key) =>
      run<IGithubResolvedCommit | undefined>(undefined, async (database) => {
        const row = (await request(
          database
            .transaction(RESOLVED, 'readonly')
            .objectStore(RESOLVED)
            .get(key),
        )) as IResolvedRow | undefined;
        return row ? { sha: row.sha, at: row.at } : undefined;
      }),

    forgetResolved: (repoKey) =>
      run<void>(undefined, async (database) => {
        const tx = database.transaction(RESOLVED, 'readwrite');
        // `<repo>@` up to, not including, `<repo>A` (`A` follows `@`): every ref of that repository, no other.
        tx.objectStore(RESOLVED).delete(
          IDBKeyRange.bound(`${repoKey}@`, `${repoKey}A`, false, true),
        );
        await done(tx);
      }),

    putResolved: (key, commit) =>
      run<void>(undefined, async (database) => {
        const tx = database.transaction(RESOLVED, 'readwrite');
        const store = tx.objectStore(RESOLVED);
        store.put({
          key,
          sha: commit.sha,
          at: commit.at,
        } satisfies IResolvedRow);
        const rows = (await request(store.getAll())) as IResolvedRow[];
        rows.sort((a, b) => b.at - a.at);
        for (const old of rows.slice(limits.maxResolved)) {
          store.delete(old.key);
        }
        await done(tx);
      }),
  };
}

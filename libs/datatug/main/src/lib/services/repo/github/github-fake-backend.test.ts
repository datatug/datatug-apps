// A fake of the three hosts a GitHub project is read from, for the specs of the reader: it answers the resolve call,
// the listing, raw file reads and the jsDelivr mirror from repositories built in memory, logs every request, and can
// be told to refuse, fail or redirect any host. Not a spec itself (the name keeps it out of the library build).

import type { GithubSetTimer } from './github-file-store-api';
import {
  GITHUB_API_HOST,
  GITHUB_MIRROR_HOST,
  GITHUB_RAW_HOST,
  type GithubFetch,
} from './github-http';

/** A status, `'network'` (the fetch throws), `'redirect'` (a 301, or the fetch throws when redirects are an error). */
export type FakeFailure = number | 'network' | 'redirect';
type Rule = FakeFailure | ((url: URL) => FakeFailure | undefined) | undefined;

interface IFakeCommit {
  readonly files: Readonly<Record<string, string>>;
}

export interface IFakeRepo {
  /** Every commit by SHA. */
  readonly commits: Map<string, IFakeCommit>;
  /** The commit the default branch points at. */
  head: string;
  /** Branches and tags other than `HEAD`, by name. The default branch follows `head`. */
  readonly refs: Record<string, string>;
  /** The name of the default branch (`main` unless the repository was added with another). */
  readonly defaultBranch: string;
}

export function fakeSha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

export class FakeGithub {
  readonly requests: { url: string; host: string; init: RequestInit }[] = [];
  /** Per host: a failure to answer with instead of the real answer. */
  fail: { api: Rule; raw: Rule; mirror: Rule } = {
    api: undefined,
    raw: undefined,
    mirror: undefined,
  };
  private readonly repos = new Map<string, IFakeRepo>();

  /** Adds a repository (`owner/repo`, lower case) whose default branch is `sha`, with these files. */
  addRepo(
    fullName: string,
    sha: string,
    files: Record<string, string>,
    defaultBranch = 'main',
  ): IFakeRepo {
    const repo: IFakeRepo = {
      commits: new Map([[sha, { files }]]),
      head: sha,
      refs: { [defaultBranch]: sha },
      defaultBranch,
    };
    this.repos.set(fullName, repo);
    return repo;
  }

  /** A push: a new commit on the default branch. */
  push(fullName: string, sha: string, files: Record<string, string>): void {
    const repo = this.repos.get(fullName) as IFakeRepo;
    repo.commits.set(sha, { files });
    repo.head = sha;
    repo.refs[repo.defaultBranch] = sha;
  }

  /** A forced push: the default branch moves to a new commit and every earlier commit is gone. */
  rewrite(fullName: string, sha: string, files: Record<string, string>): void {
    const repo = this.repos.get(fullName) as IFakeRepo;
    repo.commits.clear();
    this.push(fullName, sha, files);
  }

  count(host?: string): number {
    return this.requests.filter((r) => host === undefined || r.host === host)
      .length;
  }

  countByHost(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.requests) {
      out[r.host] = (out[r.host] ?? 0) + 1;
    }
    return out;
  }

  urls(host?: string): string[] {
    return this.requests
      .filter((r) => host === undefined || r.host === host)
      .map((r) => r.url);
  }

  reset(): void {
    this.requests.length = 0;
  }

  readonly fetch: GithubFetch = async (url, init) => {
    const u = new URL(url);
    this.requests.push({ url, host: u.host, init });
    const rule =
      u.host === GITHUB_API_HOST
        ? this.fail.api
        : u.host === GITHUB_RAW_HOST
          ? this.fail.raw
          : this.fail.mirror;
    const failure = typeof rule === 'function' ? rule(u) : rule;
    if (failure === 'network') {
      throw new TypeError('Failed to fetch');
    }
    if (failure === 'redirect') {
      if (init.redirect === 'error') {
        throw new TypeError('Failed to fetch (redirect)');
      }
      return new Response(null, {
        status: 301,
        headers: { location: 'https://example.invalid/' },
      });
    }
    if (typeof failure === 'number') {
      return new Response('failure', { status: failure });
    }
    return this.answer(u);
  };

  private repoOf(owner: string, name: string): IFakeRepo | undefined {
    return this.repos.get(`${owner}/${name}`.toLowerCase());
  }

  /** The commit a revision names: `HEAD`, a SHA, or a branch or tag by name. */
  private commitOf(
    repo: IFakeRepo,
    revision: string,
  ): { sha: string; commit: IFakeCommit } | undefined {
    const sha =
      revision === 'HEAD'
        ? repo.head
        : /^[0-9a-f]{40}$/.test(revision)
          ? revision
          : repo.refs[revision];
    const commit = sha ? repo.commits.get(sha) : undefined;
    return sha && commit ? { sha, commit } : undefined;
  }

  private static filesOf(
    commit: IFakeCommit,
    path: string,
  ): string | undefined {
    return commit.files[decodeURIComponent(path)];
  }

  private static treeOf(commit: IFakeCommit): { path: string; type: string }[] {
    const dirs = new Set<string>();
    for (const path of Object.keys(commit.files)) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return [
      ...[...dirs].map((path) => ({ path, type: 'tree' })),
      ...Object.keys(commit.files).map((path) => ({ path, type: 'blob' })),
    ].sort((a, b) => a.path.localeCompare(b.path));
  }

  private answer(u: URL): Response {
    const notFound = () => new Response('not found', { status: 404 });
    if (u.host === GITHUB_API_HOST) {
      const commits = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/.exec(
        u.pathname,
      );
      if (commits) {
        const repo = this.repoOf(commits[1], commits[2]);
        const found =
          repo && this.commitOf(repo, decodeURIComponent(commits[3]));
        return found ? new Response(found.sha) : notFound();
      }
      const trees = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/]+)$/.exec(
        u.pathname,
      );
      if (trees) {
        const repo = this.repoOf(trees[1], trees[2]);
        const found = repo && this.commitOf(repo, decodeURIComponent(trees[3]));
        return found
          ? new Response(
              JSON.stringify({
                sha: found.sha,
                tree: FakeGithub.treeOf(found.commit),
                truncated: false,
              }),
            )
          : notFound();
      }
      return notFound();
    }
    if (u.host === GITHUB_RAW_HOST) {
      const raw = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u.pathname);
      const repo = raw && this.repoOf(raw[1], raw[2]);
      const found =
        repo &&
        this.commitOf(repo, decodeURIComponent((raw as RegExpExecArray)[3]));
      const text =
        found && FakeGithub.filesOf(found.commit, (raw as RegExpExecArray)[4]);
      return text === undefined || text === null
        ? notFound()
        : new Response(text);
    }
    if (u.host === GITHUB_MIRROR_HOST) {
      const gh = /^\/gh\/([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/.exec(
        u.pathname,
      );
      const repo = gh && this.repoOf(gh[1], gh[2]);
      const found =
        repo &&
        this.commitOf(
          repo,
          decodeURIComponent((gh as RegExpExecArray)[3] ?? 'HEAD'),
        );
      const text =
        found && FakeGithub.filesOf(found.commit, (gh as RegExpExecArray)[4]);
      return text === undefined || text === null
        ? notFound()
        : new Response(text);
    }
    return notFound();
  }
}

/**
 * Timers a test fires by hand: what the reader's guard around the cache sets is recorded, never run, until
 * `fireAll()`. `set` is the `GithubSetTimer` the reader is given.
 */
export class ManualTimers {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { fire: () => void; ms: number }
  >();
  /** The delay of every timer ever set, in order. */
  readonly delays: number[] = [];

  readonly set: GithubSetTimer = (fire, ms) => {
    const id = this.nextId++;
    this.delays.push(ms);
    this.pending.set(id, { fire, ms });
    return () => {
      this.pending.delete(id);
    };
  };

  /** Timers set and neither fired nor cancelled. */
  get count(): number {
    return this.pending.size;
  }

  fireAll(): void {
    const fires = [...this.pending.values()];
    this.pending.clear();
    for (const { fire } of fires) {
      fire();
    }
  }

  /** Fires, and forgets, only the waiting timers that were set for `ms`. */
  fireWith(ms: number): void {
    for (const [id, timer] of [...this.pending]) {
      if (timer.ms === ms) {
        this.pending.delete(id);
        timer.fire();
      }
    }
  }

  /** Resolves once at least `n` timers are waiting (the code under test has reached its first await). */
  async waitFor(n = 1): Promise<void> {
    for (let i = 0; i < 1000 && this.pending.size < n; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}

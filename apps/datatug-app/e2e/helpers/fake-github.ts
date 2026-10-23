import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * A checkout-backed fake of the three hosts a GitHub project is read from (`api.github.com`,
 * `raw.githubusercontent.com`, `cdn.jsdelivr.net`). It answers from the git OBJECTS of real repositories at exact
 * commits (e2e/github-pins.json, checked out by scripts/fetch-github-pins.mjs), in GitHub's own response shapes and
 * with GitHub's caching headers (`cache-control: max-age=300`, an `etag`, CORS), so the reader, its cache and the
 * pages run unmodified on real data with no network and no share of the anonymous 60 API requests an hour.
 *
 * Every lane gets it for free: the e2e guard (demodb-guard.ts) installs it on every browser context as the fallback
 * route for the three hosts. A spec calls `installFakeGithub` only to serve a repository of its OWN (a scratch clone with
 * an extra commit); requests it cannot answer fall through to the guard.
 *
 * Strict by design: a repository that is not pinned, a branch name no pin maps, or an endpoint this fake does not
 * implement is answered 404 with `x-datatug-github-fake: unpinned` and FAILS the test (the guard collects it). A file
 * missing at a pinned commit is an ordinary 404, as on GitHub.
 *
 * It is the e2e twin of `GithubFake` in the reader's unit specs (`github-fake-backend.test.ts`).
 */
export interface IFakeGithubRepo {
  /** `owner/repo`, as in the address, any letter case. */
  readonly fullName: string;
  /** A git checkout of the repository (a shallow one is enough). */
  readonly dir: string;
  /** The commit to serve; default the checkout's `HEAD`. */
  readonly sha?: string;
  /** Branch names answered with that commit. Default `HEAD` and `main` for a spec's own repository. */
  readonly refs?: readonly string[];
}

export interface IFakeGithub {
  /** The URL of every request the page made to one of the three hosts, in order. */
  readonly requests: string[];
}

export const GITHUB_HOSTS: readonly string[] = ['api.github.com', 'raw.githubusercontent.com', 'cdn.jsdelivr.net'];
export const GITHUB_HOST = /^(api\.github\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)$/;

export interface GithubAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
  /** Set when the request is outside the pins (unknown repository, unmapped branch, unimplemented endpoint). */
  readonly unpinned?: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-expose-headers': 'ETag, Link, Location, X-GitHub-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining',
};

interface Entry {
  readonly mode: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly sha: string;
  readonly size?: number;
}

/** One commit of one checkout: its tree index and blob reader, loaded once per worker. */
class Commit {
  readonly tree: string;
  readonly entries = new Map<string, Entry>();
  readonly treePaths = new Map<string, string>();
  private readonly blobs = new Map<string, Buffer>();

  readonly dir: string;
  readonly sha: string;

  constructor(dir: string, sha: string) {
    this.dir = dir;
    this.sha = sha;
    this.tree = this.git('rev-parse', `${sha}^{tree}`).toString('utf8').trim();
    this.treePaths.set(this.tree, '');
    for (const line of this.git('ls-tree', '-r', '-t', '-l', '-z', sha).toString('utf8').split('\0')) {
      const m = /^(\d+) (blob|tree|commit) ([0-9a-f]{40}) +(-|\d+)\t(.+)$/s.exec(line);
      if (!m) continue;
      const entry: Entry = { mode: m[1], type: m[2] as Entry['type'], sha: m[3], ...(m[4] === '-' ? {} : { size: Number(m[4]) }) };
      this.entries.set(m[5], entry);
      if (entry.type === 'tree') this.treePaths.set(entry.sha, m[5]);
    }
  }

  private git(...args: string[]): Buffer {
    return execFileSync('git', ['-C', this.dir, ...args], { maxBuffer: 256 * 1024 * 1024 });
  }

  blob(path: string): Buffer | undefined {
    const entry = this.entries.get(path);
    if (!entry || entry.type !== 'blob') return undefined;
    let body = this.blobs.get(entry.sha);
    if (!body) {
      body = this.git('cat-file', 'blob', entry.sha);
      this.blobs.set(entry.sha, body);
    }
    return body;
  }

  /** The direct children of a directory ('' = root), as `[name, path, entry]`. */
  children(dir: string): [string, string, Entry][] {
    const prefix = dir ? `${dir}/` : '';
    const out: [string, string, Entry][] = [];
    for (const [path, entry] of this.entries) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && path !== dir) out.push([path.slice(prefix.length), path, entry]);
    }
    return out;
  }
}

const commits = new Map<string, Commit>();
function commitOf(dir: string, sha: string): Commit {
  const key = `${dir}\0${sha}`;
  let commit = commits.get(key);
  if (!commit) {
    commit = new Commit(dir, sha);
    commits.set(key, commit);
  }
  return commit;
}

const headOf = (dir: string): string => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

interface Served {
  readonly fullName: string;
  readonly owner: string;
  readonly name: string;
  readonly commit: Commit;
  readonly refs: readonly string[];
}

const isBinary = (body: Buffer): boolean => body.subarray(0, 8000).includes(0);
const etagOf = (body: Buffer | string): string => `W/"${createHash('sha1').update(body).digest('hex')}"`;
const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * Answers requests to the three hosts from a set of checkouts. Pure (no Playwright): unit tested in
 * fake-github.unit.ts and shared by `installFakeGithub` and the guard's fallback route.
 */
export class GithubCheckouts {
  private readonly served: Served[];

  constructor(repos: readonly IFakeGithubRepo[]) {
    this.served = repos.map((repo) => {
      const [owner, name] = repo.fullName.split('/');
      return { fullName: repo.fullName, owner, name, commit: commitOf(repo.dir, repo.sha ?? headOf(repo.dir)), refs: repo.refs ?? ['HEAD', 'main'] };
    });
  }

  private repo(owner: string, name: string): Served[] {
    const full = `${owner}/${name}`.toLowerCase();
    return this.served.filter((s) => s.fullName.toLowerCase() === full);
  }

  /** The commit a ref (full SHA, or a mapped branch name) names in a repository, or why it is not served. */
  private resolve(owner: string, name: string, ref: string): Served | string {
    const of = this.repo(owner, name);
    if (of.length === 0) return `repository ${owner}/${name} is not pinned`;
    const hit = /^[0-9a-f]{40}$/i.test(ref)
      ? of.find((s) => s.commit.sha === ref.toLowerCase())
      : of.find((s) => s.refs.includes(ref) || s.refs.includes(ref.replace(/^refs\/heads\//, '')));
    return hit ?? `${owner}/${name}@${ref} is not pinned (pinned: ${of.map((s) => `${s.commit.sha.slice(0, 8)}${s.refs.length ? ` as ${s.refs.join('/')}` : ''}`).join(', ')})`;
  }

  /** Whether this set serves a repository at all (a spec's own fake lets the guard answer the others). */
  serves(url: URL): boolean {
    const parts = url.pathname.split('/').filter(Boolean);
    const [owner, name] =
      url.hostname === 'api.github.com' ? [parts[1], parts[2]] : url.hostname === 'cdn.jsdelivr.net' ? [parts[1], parts[2]?.split('@')[0]] : [parts[0], parts[1]];
    return !!owner && !!name && this.repo(owner, name).length > 0;
  }

  answer(method: string, url: URL, requestHeaders: Record<string, string> = {}): GithubAnswer {
    const unpinned = (why: string): GithubAnswer => ({
      status: 404,
      headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'x-datatug-github-fake': 'unpinned' },
      body: Buffer.from(`e2e GitHub fake: ${why}. See apps/datatug-app/e2e/github-pins.json.`),
      unpinned: `${method} ${url.href}: ${why}`,
    });
    const notFound = (json: boolean): GithubAnswer => ({
      status: 404,
      headers: { ...CORS, 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' },
      body: Buffer.from(json ? JSON.stringify({ message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' }) : '404: Not Found'),
    });
    const ok = (body: Buffer | string, contentType: string, etag?: string): GithubAnswer => {
      const bytes = typeof body === 'string' ? Buffer.from(body) : body;
      const tag = etag ?? etagOf(bytes);
      const headers = { ...CORS, 'content-type': contentType, 'cache-control': 'max-age=300', etag: tag };
      if (requestHeaders['if-none-match'] === tag) return { status: 304, headers, body: Buffer.alloc(0) };
      return { status: 200, headers, body: method === 'HEAD' ? Buffer.alloc(0) : bytes };
    };
    const file = (served: Served, path: string): GithubAnswer => {
      const body = served.commit.blob(path);
      if (!body) return notFound(false);
      const entry = served.commit.entries.get(path);
      return ok(body, isBinary(body) ? 'application/octet-stream' : 'text/plain; charset=utf-8', `"${entry?.sha}"`);
    };
    if (method !== 'GET' && method !== 'HEAD') return unpinned(`${method} is not a read`);

    if (url.hostname === 'raw.githubusercontent.com') {
      const m = /^\/([^/]+)\/([^/]+)\/((?:refs\/heads\/)?[^/]+)\/(.+)$/.exec(url.pathname);
      if (!m) return unpinned('not a raw file address');
      const served = this.resolve(m[1], m[2], decode(m[3]));
      return typeof served === 'string' ? unpinned(served) : file(served, decode(m[4]));
    }
    if (url.hostname === 'cdn.jsdelivr.net') {
      const m = /^\/gh\/([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/.exec(url.pathname);
      if (!m) return unpinned('not a jsDelivr GitHub address');
      const served = this.resolve(m[1], m[2], m[3] ? decode(m[3]) : 'HEAD');
      return typeof served === 'string' ? unpinned(served) : file(served, decode(m[4]));
    }
    if (url.hostname !== 'api.github.com') return unpinned('not a GitHub host');

    const json = (value: unknown): GithubAnswer => ok(JSON.stringify(value), 'application/json; charset=utf-8');
    const api = /^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (!api) return unpinned('endpoint not implemented by the fake');
    const [, owner, name, rest = ''] = api;
    const of = this.repo(owner, name);
    if (of.length === 0) return unpinned(`repository ${owner}/${name} is not pinned`);
    const repoUrl = `https://api.github.com/repos/${of[0].owner}/${of[0].name}`;
    if (rest === '') {
      return json({
        id: parseInt(createHash('sha1').update(of[0].fullName.toLowerCase()).digest('hex').slice(0, 8), 16),
        name: of[0].name,
        full_name: of[0].fullName,
        owner: { login: of[0].owner, type: 'Organization' },
        private: false,
        html_url: `https://github.com/${of[0].fullName}`,
        url: repoUrl,
        default_branch: 'main',
      });
    }
    const commitRoute = /^commits\/(.+)$/.exec(rest);
    if (commitRoute) {
      const served = this.resolve(owner, name, decode(commitRoute[1]));
      if (typeof served === 'string') return unpinned(served);
      const { sha, tree } = served.commit;
      if ((requestHeaders['accept'] ?? '').includes('application/vnd.github.sha')) return ok(sha, 'application/vnd.github.sha; charset=utf-8', `"${sha}"`);
      return json({ sha, url: `${repoUrl}/commits/${sha}`, html_url: `https://github.com/${of[0].fullName}/commit/${sha}`, commit: { tree: { sha: tree, url: `${repoUrl}/git/trees/${tree}` } } });
    }
    const treeRoute = /^git\/trees\/([^/]+)$/.exec(rest);
    if (treeRoute) {
      const ref = decode(treeRoute[1]);
      // A commit SHA or mapped branch, or the SHA of a tree object of a pinned commit.
      let served = this.resolve(owner, name, ref);
      let dir = '';
      if (typeof served === 'string') {
        const holder = of.find((s) => s.commit.treePaths.has(ref.toLowerCase()));
        if (!holder) return unpinned(served);
        served = holder;
        dir = holder.commit.treePaths.get(ref.toLowerCase()) ?? '';
      }
      const { commit } = served;
      const recursive = url.searchParams.has('recursive') && url.searchParams.get('recursive') !== '0' && url.searchParams.get('recursive') !== 'false';
      const prefix = dir ? `${dir}/` : '';
      const items = recursive
        ? [...commit.entries].filter(([path]) => path.startsWith(prefix)).map(([path, e]) => [path.slice(prefix.length), e] as const)
        : commit.children(dir).map(([child, , e]) => [child, e] as const);
      const treeSha = dir ? commit.entries.get(dir)?.sha : commit.tree;
      return json({
        sha: treeSha,
        url: `${repoUrl}/git/trees/${treeSha}`,
        tree: items.map(([path, e]) => ({
          path,
          mode: e.mode,
          type: e.type,
          sha: e.sha,
          ...(e.size === undefined ? {} : { size: e.size }),
          url: `${repoUrl}/git/${e.type === 'tree' ? 'trees' : 'blobs'}/${e.sha}`,
        })),
        truncated: false,
      });
    }
    const contents = /^contents(?:\/(.*))?$/.exec(rest);
    if (contents) {
      const served = this.resolve(owner, name, url.searchParams.get('ref') ?? 'HEAD');
      if (typeof served === 'string') return unpinned(served);
      const path = decode(contents[1] ?? '').replace(/\/$/, '');
      const describe = (p: string, e: Entry) => ({
        name: p.split('/').at(-1),
        path: p,
        sha: e.sha,
        size: e.size ?? 0,
        type: e.type === 'tree' ? 'dir' : e.type === 'commit' ? 'submodule' : 'file',
        url: `${repoUrl}/contents/${p}?ref=${served.commit.sha}`,
        download_url: e.type === 'blob' ? `https://raw.githubusercontent.com/${of[0].fullName}/${served.commit.sha}/${p}` : null,
      });
      const entry = path ? served.commit.entries.get(path) : undefined;
      if (path && !entry) return notFound(true);
      if (!entry || entry.type === 'tree') return json(served.commit.children(path).map(([, p, e]) => describe(p, e)));
      const body = served.commit.blob(path) ?? Buffer.alloc(0);
      return json({ ...describe(path, entry), encoding: 'base64', content: body.toString('base64') });
    }
    return unpinned(`endpoint /repos/:owner/:repo/${rest.split('/')[0]} not implemented by the fake`);
  }
}

/** Answers one routed request from a set of checkouts (OPTIONS preflight included). */
export async function fulfillFromCheckouts(route: Route, checkouts: GithubCheckouts): Promise<GithubAnswer | undefined> {
  const request = route.request();
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS });
    return undefined;
  }
  const answer = checkouts.answer(request.method(), new URL(request.url()), request.headers());
  await route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
  return answer;
}

/**
 * Serves a spec's own repositories (a scratch clone with extra commits) on a page or a whole browser context, ahead of
 * the guard's pinned checkouts. A request for any other repository falls through to the guard.
 */
export async function installFakeGithub(
  target: Page | BrowserContext,
  repos: readonly IFakeGithubRepo[],
): Promise<IFakeGithub> {
  const checkouts = new GithubCheckouts(repos);
  const requests: string[] = [];
  await target.route(
    (url) => GITHUB_HOST.test(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'OPTIONS') requests.push(url.href);
      if (!checkouts.serves(url)) {
        await route.fallback();
        return;
      }
      await fulfillFromCheckouts(route, checkouts);
    },
  );
  return { requests };
}

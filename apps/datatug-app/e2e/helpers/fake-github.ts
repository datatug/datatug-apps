import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * A fake of the three hosts a GitHub project is read from (`api.github.com`, `raw.githubusercontent.com`,
 * `cdn.jsdelivr.net`), for the e2e specs that would otherwise spend the visitor-less anonymous quota of 60 API
 * requests an hour per address (and need a network): it answers the way the reader asks (the commit of a revision,
 * the recursive listing of a commit, the file of a commit) from a local checkout of the repository, at the checkout's
 * own `HEAD`. Every request is recorded. Nothing leaves the machine.
 *
 * It is the e2e twin of `GithubFake` in the reader's unit specs (`github-fake-backend.test.ts`).
 */
export interface IFakeGithubRepo {
  /** `owner/repo`, as in the address, any letter case. */
  readonly fullName: string;
  /** A checkout of the repository: its tracked files are the repository's files. */
  readonly dir: string;
}

export interface IFakeGithub {
  /** The URL of every request the page made to one of the three hosts, in order. */
  readonly requests: string[];
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const HOSTS = [
  'api.github.com',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
];

interface ILoadedRepo {
  readonly dir: string;
  readonly sha: string;
  readonly files: readonly string[];
}

function loadRepo(dir: string): ILoadedRepo {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return {
    dir,
    sha: git('rev-parse', 'HEAD').trim(),
    files: git('ls-files').split('\n').filter(Boolean),
  };
}

/** Installs the fake on a page or a whole browser context, before the page goes anywhere. */
export async function installFakeGithub(
  target: Page | BrowserContext,
  repos: readonly IFakeGithubRepo[],
): Promise<IFakeGithub> {
  const loaded = new Map(
    repos.map((r) => [r.fullName.toLowerCase(), loadRepo(r.dir)] as const),
  );
  const requests: string[] = [];

  const text = (route: Route, body: string, contentType = 'text/plain') =>
    route.fulfill({
      status: 200,
      contentType: `${contentType}; charset=utf-8`,
      headers: CORS,
      body,
    });
  const notFound = (route: Route) =>
    route.fulfill({ status: 404, headers: CORS, body: 'not found' });
  const fileOf = (repo: ILoadedRepo, path: string): string | undefined =>
    repo.files.includes(path)
      ? readFileSync(join(repo.dir, path), 'utf8')
      : undefined;

  await target.route(
    (url) => HOSTS.includes(url.hostname),
    async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const url = new URL(request.url());
      requests.push(request.url());
      if (url.hostname === 'api.github.com') {
        const commit = /^\/repos\/([^/]+)\/([^/]+)\/commits\/([^/]+)$/.exec(
          url.pathname,
        );
        if (commit) {
          const repo = loaded.get(`${commit[1]}/${commit[2]}`.toLowerCase());
          await (repo ? text(route, repo.sha) : notFound(route));
          return;
        }
        const tree = /^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/]+)$/.exec(
          url.pathname,
        );
        if (tree) {
          const repo = loaded.get(`${tree[1]}/${tree[2]}`.toLowerCase());
          if (!repo) {
            await notFound(route);
            return;
          }
          const dirs = new Set<string>();
          for (const path of repo.files) {
            const parts = path.split('/');
            for (let i = 1; i < parts.length; i++) {
              dirs.add(parts.slice(0, i).join('/'));
            }
          }
          await text(
            route,
            JSON.stringify({
              sha: repo.sha,
              truncated: false,
              tree: [
                ...[...dirs].map((path) => ({ path, type: 'tree' })),
                ...repo.files.map((path) => ({ path, type: 'blob' })),
              ],
            }),
            'application/json',
          );
          return;
        }
      } else if (url.hostname === 'raw.githubusercontent.com') {
        const raw = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
        const repo = raw && loaded.get(`${raw[1]}/${raw[2]}`.toLowerCase());
        const body =
          repo && raw ? fileOf(repo, decodeURIComponent(raw[4])) : undefined;
        await (body === undefined ? notFound(route) : text(route, body));
        return;
      } else {
        const mirror = /^\/gh\/([^/@]+)\/([^/@]+)(?:@([^/]+))?\/(.+)$/.exec(
          url.pathname,
        );
        const repo =
          mirror && loaded.get(`${mirror[1]}/${mirror[2]}`.toLowerCase());
        const body =
          repo && mirror
            ? fileOf(repo, decodeURIComponent(mirror[4]))
            : undefined;
        await (body === undefined ? notFound(route) : text(route, body));
        return;
      }
      await notFound(route);
    },
  );
  return { requests };
}

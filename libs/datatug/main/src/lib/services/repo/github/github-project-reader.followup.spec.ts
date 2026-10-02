import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGithub, ManualTimers, fakeSha } from './github-fake-backend.test';
import {
  GITHUB_RESOLVE_TTL_MS,
  GITHUB_STORE_OPEN_TIMEOUT_MS,
  GITHUB_STORE_TIMEOUT_MS,
  type IGithubFileStore,
  type IGithubResolvedCommit,
  type IGithubStoredFile,
} from './github-file-store-api';
import { openGithubFileStore } from './github-file-store';
import { DatatugStoreGithubService } from '../datatug-store.service.github';
import {
  GITHUB_CLOCK,
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
  GITHUB_TIMER,
  GithubProjectReaderService,
  GithubReadError,
} from './github-project-reader.service';
import {
  GITHUB_RATE_LIMIT_MESSAGE,
  GITHUB_RESOLVE_TIMEOUT_MS,
} from './github-read-limits';

// The follow-up of the second review of the GitHub reader (datatug-apps#180, review of #181): what a 404 at a
// remembered commit proves, and what one visit may serve (design `demo-as-github-project.md` 4.5, steps 2 and 5).

const REPO = 'datatug/projects';
const ID_B = 'projects@datatug@b';
const DEMO_REPO = 'datatug/datatug-demo-projects';
const DEMO_ID = 'datatug-demo-projects@datatug@demo-project-1';
const SHA_1 = fakeSha(0x111);
const SHA_2 = fakeSha(0x222);
const ENV = 'environments/local/local.env.json';
const REPO_ENV = `demo-project-1/${ENV}`;

const first = <T>(o: Parameters<typeof firstValueFrom<T>>[0]) =>
  firstValueFrom(o);

/** One browser: its clock, its IndexedDB, its timers and the fake GitHub; `load()` is a page load. */
class Browser {
  time = 10_000_000;
  readonly idb = new IDBFactory();
  readonly timers = new ManualTimers();
  readonly store: IGithubFileStore = openGithubFileStore(
    this.idb,
    () => this.time,
  );

  constructor(readonly gh: FakeGithub) {}

  load(
    store: IGithubFileStore = this.store,
    fetch = this.gh.fetch,
  ): GithubProjectReaderService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GITHUB_FETCH, useValue: fetch },
        { provide: GITHUB_CLOCK, useValue: () => this.time },
        { provide: GITHUB_FILE_STORE, useValue: store },
        { provide: GITHUB_TIMER, useValue: this.timers.set },
      ],
    });
    return TestBed.inject(GithubProjectReaderService);
  }
}

/** A cache in memory that records what was asked of it. */
class MemoryStore implements IGithubFileStore {
  readonly files = new Map<string, IGithubStoredFile>();
  readonly resolved = new Map<string, IGithubResolvedCommit>();
  readonly calls: string[] = [];

  getFile(commitKey: string, path: string) {
    this.calls.push(`getFile ${commitKey}/${path}`);
    return Promise.resolve(this.files.get(`${commitKey}/${path}`));
  }
  putFile(commitKey: string, path: string, file: IGithubStoredFile) {
    this.calls.push(`putFile ${commitKey}/${path}`);
    this.files.set(`${commitKey}/${path}`, file);
    return Promise.resolve();
  }
  getResolved(key: string) {
    this.calls.push(`getResolved ${key}`);
    return Promise.resolve(this.resolved.get(key));
  }
  putResolved(key: string, commit: IGithubResolvedCommit) {
    this.calls.push(`putResolved ${key}`);
    this.resolved.set(key, commit);
    return Promise.resolve();
  }
  dropResolved(key: string) {
    this.calls.push(`dropResolved ${key}`);
    this.resolved.delete(key);
    return Promise.resolve();
  }
  forgetResolved(repoKey: string) {
    this.calls.push(`forgetResolved ${repoKey}`);
    for (const key of [...this.resolved.keys()]) {
      if (key.startsWith(`${repoKey}@`)) {
        this.resolved.delete(key);
      }
    }
    return Promise.resolve();
  }
}

function demoFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'demo-project-1/datatug-project.json': '{"id":"datatug-demo-project"}',
    [REPO_ENV]: '{"v":1}',
    'demo-project-1/entities/Album/Album.entity.json': '{}',
    ...extra,
  };
}

const apiUrl = (path: string, repo = DEMO_REPO) =>
  `https://api.github.com/repos/${repo}/${path}`;
const rawUrl = (sha: string, path: string, repo = DEMO_REPO) =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
const mirrorUrl = (sha: string | undefined, path: string, repo = DEMO_REPO) =>
  `https://cdn.jsdelivr.net/gh/${repo}${sha ? `@${sha}` : ''}/${path}`;

/** A request that never answers, until the caller gives up on it (as `fetch` does). */
const hangUntilAborted = (init: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new TypeError('aborted')),
    );
  });

/** A fetch that holds the requests `holds` says to, until `release()`; `reached` settles when the first is held. */
function gated(
  gh: FakeGithub,
  holds: (url: string) => boolean,
): {
  fetch: typeof gh.fetch;
  reached: Promise<void>;
  release: () => void;
} {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => (release = resolve));
  let reach: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return {
    fetch: async (url, init) => {
      if (holds(url)) {
        reach();
        await open;
      }
      return gh.fetch(url, init);
    },
    reached,
    release,
  };
}

describe('GithubProjectReaderService: the follow-up of the second review', () => {
  let gh: FakeGithub;
  let browser: Browser;

  beforeEach(() => {
    gh = new FakeGithub();
    gh.addRepo(DEMO_REPO, SHA_1, demoFiles());
    browser = new Browser(gh);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A first visit: the project file, the listing and a file, all kept under SHA_1, and the answer remembered. */
  const firstVisit = async (): Promise<void> => {
    const reader = browser.load();
    await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
    await first(reader.listDirectory(DEMO_ID, 'entities'));
    await first(reader.getRawJson(DEMO_ID, ENV));
  };

  /** The project moves on: a push that changes what every kind of read would say. */
  const push = (): void =>
    gh.push(
      DEMO_REPO,
      SHA_2,
      demoFiles({
        'demo-project-1/datatug-project.json': '{"id":"new"}',
        [REPO_ENV]: '{"v":2}',
        'demo-project-1/entities/Track/Track.entity.json': '{}',
      }),
    );

  describe('A1: an absent file at a remembered commit is an absent file', () => {
    it.each([
      ['after the project file and the listing', false],
      ['before anything else', true],
    ])(
      'a memory under 5 minutes old, a push, one probe of an absent file %s: the whole visit stays at the one commit',
      async (_name, probeFirst) => {
        await firstVisit();
        push();
        browser.time += 60_000;
        gh.reset();

        const reader = browser.load();
        const probe = () =>
          first(reader.getRawText(DEMO_ID, 'widgets/none.json'));
        if (probeFirst) {
          expect(await probe()).toBeUndefined();
        }
        const project = await first(
          reader.getRawJson(DEMO_ID, 'datatug-project.json'),
        );
        const entities = (
          await first(reader.listDirectory(DEMO_ID, 'entities'))
        ).map((e) => e.name);
        if (!probeFirst) {
          expect(await probe()).toBeUndefined();
        }
        const env = await first(reader.getRawJson(DEMO_ID, ENV));
        const album = await first(
          reader.getRawJson(DEMO_ID, 'entities/Album/Album.entity.json'),
        );
        const other = await first(
          reader.getRawText(DEMO_ID, 'boards/b/board.json'),
        );

        // Every read of the visit is of SHA_1: the project file, the listing, the files, and what readInfo says.
        expect(project).toEqual({ id: 'datatug-demo-project' });
        expect(entities).toEqual(['Album']);
        expect(env).toEqual({ v: 1 });
        expect(album).toEqual({});
        expect(other).toBeUndefined();
        expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
          state: 'resolved',
          commit: SHA_1,
          mayBeStale: false,
        });
        // Nothing asked of the API (no commit to look up, no listing), and the probes went to the one commit.
        expect(gh.urls('api.github.com')).toEqual([]);
        for (const url of gh.urls('raw.githubusercontent.com')) {
          expect(url).toContain(`/${SHA_1}/`);
        }
        expect(
          await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
        ).toMatchObject({ sha: SHA_1 });
      },
    );

    it('a push in the middle of a visit that began from a memory changes nothing of it, an absent file probed included; the next visit sees the new commit', async () => {
      await firstVisit();
      browser.time += 60_000;
      gh.reset();
      const reader = browser.load();
      await first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      push();
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(await first(reader.getRawJson(DEMO_ID, ENV))).toEqual({ v: 1 });
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        commit: SHA_1,
      });
      expect(gh.urls('api.github.com')).toEqual([]);
      for (const url of gh.urls('raw.githubusercontent.com')) {
        expect(url).toContain(`/${SHA_1}/`);
      }

      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      const next = browser.load();
      expect(await first(next.getRawJson(DEMO_ID, ENV))).toEqual({ v: 2 });
    });

    it('API refusing, a remembered commit, a cached listing, an absent-file probe: the memory is kept, and the next page load still renders from the cache', async () => {
      await firstVisit();
      const remembered = await browser.store.getResolved(`${DEMO_REPO}@HEAD`);
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.fail.api = 403;
      gh.reset();

      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'remembered',
        commit: SHA_1,
        mayBeStale: true,
      });
      expect(await browser.store.getResolved(`${DEMO_REPO}@HEAD`)).toEqual(
        remembered,
      );
      // Asked of GitHub: the one question (refused) and the file host for the probe.
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD'),
        rawUrl(SHA_1, 'demo-project-1/widgets/none.json'),
      ]);

      // The next page load, the API still refusing: still the remembered commit, still the cache.
      gh.reset();
      const next = browser.load();
      expect(
        (await first(next.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(await first(next.getRawJson(DEMO_ID, ENV))).toEqual({ v: 1 });
      expect(await first(next.readInfo(DEMO_ID))).toMatchObject({
        state: 'remembered',
        commit: SHA_1,
      });
      expect(gh.urls()).toEqual([apiUrl('commits/HEAD')]);
    });

    it('a repo with five absent optional files costs no API call on a warm visit within 5 minutes, even when the absent files are new', async () => {
      const cold = browser.load();
      await first(cold.getRawJson(DEMO_ID, 'datatug-project.json'));
      await first(cold.listDirectory(DEMO_ID, ''));
      expect(gh.count('api.github.com')).toBe(2); // cold: the commit and the listing

      browser.time += 60_000;
      gh.reset();
      const warm = browser.load();
      await first(warm.getRawJson(DEMO_ID, 'datatug-project.json'));
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        expect(
          await first(warm.getRawJson(DEMO_ID, `widgets/${name}.json`)),
        ).toBeUndefined();
      }
      expect(gh.count('api.github.com')).toBe(0);
      expect(gh.count('raw.githubusercontent.com')).toBe(5);

      // And the next warm visit asks for nothing at all, the absent files being remembered.
      gh.reset();
      const again = browser.load();
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        await first(again.getRawJson(DEMO_ID, `widgets/${name}.json`));
      }
      expect(gh.count()).toBe(0);
    });

    describe('what is doubted, and when', () => {
      beforeEach(() => {
        gh.addRepo(REPO, SHA_1, {
          'a/datatug-project.json': '{}',
          'b/x.json': '{"x":1}',
        });
      });
      const remember = (): Promise<void> =>
        browser.store.putResolved(`${REPO}@HEAD`, {
          sha: SHA_1,
          at: browser.time,
        });

      it('the project file is 404 and nothing has been read at the commit: asked once more, the commit stands, no second question', async () => {
        await remember();
        const reader = browser.load();
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(gh.urls()).toEqual([
          rawUrl(SHA_1, 'b/datatug-project.json', REPO),
          apiUrl('commits/HEAD', REPO),
        ]);
        expect(await first(reader.readInfo(ID_B))).toMatchObject({
          state: 'resolved',
          commit: SHA_1,
        });
      });

      it.each([
        [
          'a file read from the network',
          async (reader: GithubProjectReaderService) =>
            expect(await first(reader.getRawJson(ID_B, 'x.json'))).toEqual({
              x: 1,
            }),
          [rawUrl(SHA_1, 'b/x.json', REPO)],
        ],
        [
          'the listing read from the network',
          async (reader: GithubProjectReaderService) =>
            expect(
              (await first(reader.listDirectory(ID_B, ''))).map((e) => e.name),
            ).toEqual(['x.json']),
          [apiUrl(`git/trees/${SHA_1}?recursive=1`, REPO)],
        ],
      ])(
        'the project file is 404 after %s at the commit: asked once more all the same, the commit stands',
        async (_name, readBefore, urlsBefore) => {
          await remember();
          const reader = browser.load();
          await readBefore(reader);
          expect(
            await first(reader.getRawJson(ID_B, 'datatug-project.json')),
          ).toBeUndefined();
          expect(gh.urls()).toEqual([
            ...urlsBefore,
            rawUrl(SHA_1, 'b/datatug-project.json', REPO),
            apiUrl('commits/HEAD', REPO),
          ]);
          expect(await first(reader.readInfo(ID_B))).toMatchObject({
            state: 'resolved',
            commit: SHA_1,
            mayBeStale: false,
          });
        },
      );

      it('the project file is 404 after a file and the listing came from the cache: asked once more all the same', async () => {
        const warm = browser.load();
        await first(warm.getRawJson(ID_B, 'x.json'));
        await first(warm.listDirectory(ID_B, ''));
        gh.reset();
        const reader = browser.load();
        expect(await first(reader.getRawJson(ID_B, 'x.json'))).toEqual({
          x: 1,
        });
        expect((await first(reader.listDirectory(ID_B, ''))).length).toBe(1);
        expect(gh.urls()).toEqual([]);
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(gh.urls()).toEqual([
          rawUrl(SHA_1, 'b/datatug-project.json', REPO),
          apiUrl('commits/HEAD', REPO),
        ]);
      });

      it('a file that is cached as absent does not make the project file any less doubted', async () => {
        await browser.store.putFile(`${REPO}@${SHA_1}`, 'b/nothing.json', {
          text: null,
          bytes: 0,
        });
        await remember();
        const reader = browser.load();
        expect(
          await first(reader.getRawJson(ID_B, 'nothing.json')),
        ).toBeUndefined();
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(gh.urls()).toEqual([
          rawUrl(SHA_1, 'b/datatug-project.json', REPO),
          apiUrl('commits/HEAD', REPO),
        ]);
      });

      it('asked once per commit in a visit: the project file of another folder of the repository, 404 too, is not asked about again', async () => {
        await remember();
        const reader = browser.load();
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(
          await first(
            reader.getRawJson('projects@datatug@c', 'datatug-project.json'),
          ),
        ).toBeUndefined();
        expect(gh.urls('api.github.com')).toEqual([
          apiUrl('commits/HEAD', REPO),
        ]);
      });

      it('a project pushed from elsewhere into a repository already viewed opens on the first try, for one API call (a regression against the reader before the commits)', async () => {
        const viewed = 'projects@datatug@a';
        await first(browser.load().getRawJson(viewed, 'datatug-project.json'));
        await first(browser.load().listDirectory(viewed, ''));
        gh.push(REPO, SHA_2, {
          'a/datatug-project.json': '{}',
          'b/x.json': '{"x":1}',
          'b/datatug-project.json': '{"id":"new"}',
        });
        browser.time += 30_000;
        gh.reset();

        const reader = browser.load();
        // The page of the project that was viewed (all from the cache), then the new one.
        expect(
          await first(reader.getRawJson(viewed, 'datatug-project.json')),
        ).toEqual({});
        expect((await first(reader.listDirectory(viewed, ''))).length).toBe(1);
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toEqual({ id: 'new' });

        expect(gh.urls('api.github.com')).toEqual([
          apiUrl('commits/HEAD', REPO),
        ]);
        expect(await first(reader.readInfo(ID_B))).toMatchObject({
          state: 'resolved',
          commit: SHA_2,
        });
      });

      it('a commit GitHub answered for in this visit is not doubted', async () => {
        const reader = browser.load();
        expect(
          await first(reader.getRawJson(ID_B, 'datatug-project.json')),
        ).toBeUndefined();
        expect(gh.urls()).toEqual([
          apiUrl('commits/HEAD', REPO),
          rawUrl(SHA_1, 'b/datatug-project.json', REPO),
        ]);
      });
    });
  });

  describe('a remembered commit that is gone', () => {
    beforeEach(async () => {
      // An earlier visit remembered SHA_1 and kept its environment file; the repository was then force-pushed.
      await first(browser.load().getRawJson(DEMO_ID, ENV));
      gh.rewrite(
        DEMO_REPO,
        SHA_2,
        demoFiles({
          'demo-project-1/datatug-project.json': '{"id":"new"}',
          [REPO_ENV]: '{"v":2}',
          'demo-project-1/entities/Track/Track.entity.json': '{}',
        }),
      );
      gh.reset();
    });

    it('a listing answered 422 for it: recovers with one re-resolve, and the listing is the new commit’s', async () => {
      gh.fail.api = (url) =>
        url.pathname.endsWith(`/git/trees/${SHA_1}`) ? 422 : undefined;
      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album', 'Track']);
      expect(gh.urls('api.github.com')).toEqual([
        apiUrl(`git/trees/${SHA_1}?recursive=1`),
        apiUrl('commits/HEAD'),
        apiUrl(`git/trees/${SHA_2}?recursive=1`),
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
      });
    });

    it('the visit moves whole: nothing read at the old commit is served afterwards, and readInfo says the commit in use', async () => {
      const reader = browser.load();
      // Read at the old commit, out of the cache, before anything doubts it.
      expect(await first(reader.getRawJson(DEMO_ID, ENV))).toEqual({ v: 1 });
      expect(await first(reader.getRawText(DEMO_ID, ENV))).toBe('{"v":1}');
      // The listing is refused as unknown: the commit is asked again, and it moved.
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album', 'Track']);

      expect(await first(reader.getRawJson(DEMO_ID, ENV))).toEqual({ v: 2 });
      expect(await first(reader.getRawText(DEMO_ID, ENV))).toBe('{"v":2}');
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toEqual({ id: 'new' });
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
      });
      expect(
        gh.urls('api.github.com').filter((u) => u.includes('/commits/')),
      ).toEqual([apiUrl('commits/HEAD')]);
    });

    it('the re-resolve is refused: the remembered commit is kept for the visit, the project file is absent, the listing fails with the rate-limit error (not an empty list), and nothing is persisted', async () => {
      gh.fail.api = (url) =>
        url.pathname.includes('/commits/') ? 403 : undefined;
      const remembered = await browser.store.getResolved(`${DEMO_REPO}@HEAD`);
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toBeUndefined();
      await expect(
        first(reader.listDirectory(DEMO_ID, 'entities')),
      ).rejects.toThrow(GITHUB_RATE_LIMIT_MESSAGE);

      // Every read goes to the one remembered commit, never to `HEAD`.
      expect(gh.urls()).toEqual([
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
        apiUrl('commits/HEAD'),
        apiUrl(`git/trees/${SHA_1}?recursive=1`),
        apiUrl('commits/HEAD'), // an answer that was not given is not remembered: asked again
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_1,
      });
      expect(await browser.store.getResolved(`${DEMO_REPO}@HEAD`)).toEqual(
        remembered,
      );
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_1}`,
          'demo-project-1/datatug-project.json',
        ),
      ).toBeUndefined();
    });

    it.each([
      ['refused', 403, GITHUB_RATE_LIMIT_MESSAGE],
      ['failing', 500, 'the project listing'],
    ])(
      'the re-resolve is %s: the listing read fails, and when GitHub answers again in the same visit the next read recovers at the new commit',
      async (_name, status, message) => {
        gh.fail.api = (url) =>
          url.pathname.includes('/commits/') ? status : undefined;
        const reader = browser.load();
        const failure = await first(
          reader.listDirectory(DEMO_ID, 'entities'),
        ).then(
          () => undefined,
          (e: Error) => e,
        );
        expect(failure?.message).toContain(message);
        if (status === 500) {
          expect(failure).toBeInstanceOf(GithubReadError);
        }
        expect(gh.urls().some((u) => u.includes('/trees/HEAD'))).toBe(false);

        gh.fail.api = undefined; // GitHub answers again, in the same visit
        expect(
          (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
            (e) => e.name,
          ),
        ).toEqual(['Album', 'Track']);
        expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
          state: 'resolved',
          commit: SHA_2,
        });
        expect(await first(reader.getRawJson(DEMO_ID, ENV))).toEqual({ v: 2 });
      },
    );

    it('the re-resolve times out: the listing read fails with the read error, and no fallback to HEAD', async () => {
      vi.useFakeTimers();
      const hangingCommits: typeof gh.fetch = (url, init) =>
        url.includes('/commits/')
          ? hangUntilAborted(init)
          : gh.fetch(url, init);
      const store = new MemoryStore();
      store.resolved.set(`${DEMO_REPO}@HEAD`, { sha: SHA_1, at: browser.time });
      const reader = browser.load(store, hangingCommits);

      const listing = first(reader.listDirectory(DEMO_ID, 'entities')).then(
        () => undefined,
        (e: Error) => e,
      );
      await vi.advanceTimersByTimeAsync(GITHUB_RESOLVE_TIMEOUT_MS);
      expect(await listing).toBeInstanceOf(GithubReadError);
      expect(gh.urls().some((u) => u.includes('/trees/HEAD'))).toBe(false);
      expect(store.resolved.get(`${DEMO_REPO}@HEAD`)).toEqual({
        sha: SHA_1,
        at: browser.time,
      });
    });

    it('a re-resolved commit is not marked as remembered: asking about it again is never repeated', async () => {
      // SHA_2 does not have the project file of `b` either: 404 there is an absent file, not a reason to ask again.
      gh.addRepo(REPO, SHA_1, { 'b/x.json': '{"x":1}' });
      gh.rewrite(REPO, SHA_2, { 'b/x.json': '{"x":2}' });
      await browser.store.putResolved(`${REPO}@HEAD`, {
        sha: SHA_1,
        at: browser.time,
      });
      gh.reset();
      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(ID_B, ''))).map((e) => e.name),
      ).toEqual(['x.json']);
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.getRawJson(ID_B, 'x.json'))).toEqual({ x: 2 });
      expect(
        gh.urls('api.github.com').filter((u) => u.includes('/commits/')),
      ).toEqual([apiUrl('commits/HEAD', REPO)]);
    });

    it('the re-resolve times out: the same', async () => {
      vi.useFakeTimers();
      const hangingCommits: typeof gh.fetch = (url, init) =>
        url.includes('/commits/')
          ? hangUntilAborted(init)
          : gh.fetch(url, init);
      const store = new MemoryStore();
      store.resolved.set(`${DEMO_REPO}@HEAD`, { sha: SHA_1, at: browser.time });
      const reader = browser.load(store, hangingCommits);

      const read = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await vi.advanceTimersByTimeAsync(GITHUB_RESOLVE_TIMEOUT_MS);
      expect(await read).toBeUndefined();
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        commit: SHA_1,
      });
      expect(store.resolved.get(`${DEMO_REPO}@HEAD`)).toEqual({
        sha: SHA_1,
        at: browser.time,
      });
      expect(store.calls.filter((c) => c.startsWith('dropResolved'))).toEqual(
        [],
      );
    });
  });

  describe('the visit moves while a read is on its way', () => {
    it('a read still on its way from the old commit when the visit moves is read again at the new one', async () => {
      // SHA_1 is not gone: its listing is refused as unknown (422), so it is doubted, while a file is fetched from it.
      push();
      gh.fail.api = (url) =>
        url.pathname.endsWith(`/git/trees/${SHA_1}`) ? 422 : undefined;
      const gate = gated(gh, (url) => url.includes(`/${SHA_1}/${REPO_ENV}`));
      const store = new MemoryStore();
      store.resolved.set(`${DEMO_REPO}@HEAD`, { sha: SHA_1, at: browser.time });
      const reader = browser.load(store, gate.fetch);

      const env = first(reader.getRawJson(DEMO_ID, ENV));
      await gate.reached;
      const listing = await first(reader.listDirectory(DEMO_ID, 'entities'));
      gate.release();

      expect(listing.map((e) => e.name)).toEqual(['Album', 'Track']);
      expect(await env).toEqual({ v: 2 });
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
      });
    });
  });

  describe('a move of the visit while other reads are on their way', () => {
    // `b` has no project file at SHA_1; a push (SHA_2) adds it, and an entity.
    beforeEach(async () => {
      gh.addRepo(REPO, SHA_1, {
        'a/datatug-project.json': '{}',
        'b/x.json': '{"x":1}',
      });
      gh.push(REPO, SHA_2, {
        'a/datatug-project.json': '{}',
        'b/x.json': '{"x":2}',
        'b/datatug-project.json': '{"id":"b2"}',
        'b/entities/E/E.entity.json': '{}',
      });
      await browser.store.putResolved(`${REPO}@HEAD`, {
        sha: SHA_1,
        at: browser.time,
      });
    });
    const names = async (
      reader: GithubProjectReaderService,
    ): Promise<string[]> =>
      (await first(reader.listDirectory(ID_B, ''))).map((e) => e.name);

    /** Lets whatever can complete without GitHub's answer complete (the cache and the file host answer at once). */
    const settleReads = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 60));

    it('the project file is 404, GitHub is asked which commit, and no other read is delivered at the old commit while the question is on its way: all of it is of the new one (M1)', async () => {
      const gate = gated(gh, (url) => url.includes('/commits/'));
      const reader = browser.load(browser.store, gate.fetch);
      const delivered: string[] = [];
      const note =
        (name: string) =>
        <T>(value: T): T => {
          delivered.push(name);
          return value;
        };
      const project = first(
        reader.getRawJson(ID_B, 'datatug-project.json'),
      ).then(note('project'));
      const listing = names(reader).then(note('listing'));
      const file = first(reader.getRawJson(ID_B, 'x.json')).then(note('file'));
      await gate.reached; // the question about the commit is on its way
      await settleReads();
      // The listing and the file have been read at SHA_1; neither is handed to the page, which is about to be told
      // that the commit is another.
      expect(delivered).toEqual([]);
      const info = first(reader.readInfo(ID_B)).then(note('info'));
      await settleReads();
      expect(delivered).toEqual([]); // the sources line does not name a commit that is about to be replaced

      gate.release();
      expect(await project).toEqual({ id: 'b2' });
      expect(await listing).toEqual([
        'datatug-project.json',
        'entities',
        'x.json',
      ]);
      expect(await file).toEqual({ x: 2 });
      expect(await info).toMatchObject({ state: 'resolved', commit: SHA_2 });
      expect(await names(reader)).toEqual([
        'datatug-project.json',
        'entities',
        'x.json',
      ]);
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
      });
    });

    it('the same when the question was asked because a listing is 404: a file read from the cache and the project file complete meanwhile, and none is of the old commit', async () => {
      // SHA_1 is gone (forced push): its listing is 404, and so is the project file at it, but a file is cached.
      gh.rewrite(REPO, SHA_2, {
        'a/datatug-project.json': '{}',
        'b/x.json': '{"x":2}',
        'b/datatug-project.json': '{"id":"b2"}',
        'b/entities/E/E.entity.json': '{}',
      });
      await browser.store.putFile(`${REPO}@${SHA_1}`, 'b/x.json', {
        text: '{"x":1}',
        bytes: 7,
      });
      gh.reset();
      const gate = gated(gh, (url) => url.includes('/commits/'));
      const reader = browser.load(browser.store, gate.fetch);
      const delivered: string[] = [];
      const note =
        (name: string) =>
        <T>(value: T): T => {
          delivered.push(name);
          return value;
        };
      const listing = names(reader).then(note('listing'));
      const project = first(
        reader.getRawJson(ID_B, 'datatug-project.json'),
      ).then(note('project'));
      const file = first(reader.getRawJson(ID_B, 'x.json')).then(note('file'));
      await gate.reached;
      await settleReads();
      expect(delivered).toEqual([]);

      gate.release();
      expect(await listing).toEqual([
        'datatug-project.json',
        'entities',
        'x.json',
      ]);
      expect(await project).toEqual({ id: 'b2' });
      expect(await file).toEqual({ x: 2 });
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        commit: SHA_2,
      });
    });

    it('a question that GitHub does not answer holds the reads back for no longer than the time it is given, then they are delivered at the remembered commit', async () => {
      vi.useFakeTimers();
      const hangingCommits: typeof gh.fetch = (url, init) =>
        url.includes('/commits/')
          ? hangUntilAborted(init)
          : gh.fetch(url, init);
      const store = new MemoryStore();
      store.resolved.set(`${REPO}@HEAD`, { sha: SHA_1, at: browser.time });
      const reader = browser.load(store, hangingCommits);
      const delivered: string[] = [];
      const note =
        (name: string) =>
        <T>(value: T): T => {
          delivered.push(name);
          return value;
        };
      const project = first(
        reader.getRawJson(ID_B, 'datatug-project.json'),
      ).then(note('project'));
      const listing = names(reader).then(note('listing'));
      const file = first(reader.getRawJson(ID_B, 'x.json')).then(note('file'));
      await vi.advanceTimersByTimeAsync(10); // the question is on its way
      const info = first(reader.readInfo(ID_B)).then(note('info'));
      await vi.advanceTimersByTimeAsync(GITHUB_RESOLVE_TIMEOUT_MS - 11);
      expect(delivered).toEqual([]); // still waiting: the time is not up

      await vi.advanceTimersByTimeAsync(1);
      expect(await project).toBeUndefined();
      expect(await listing).toEqual(['x.json']);
      expect(await file).toEqual({ x: 1 });
      expect(await info).toMatchObject({ commit: SHA_1 });
    });

    it('a listing still on its way from the old commit when the visit moves is read again at the new one', async () => {
      const gate = gated(gh, (url) => url.includes(`/git/trees/${SHA_1}`));
      const reader = browser.load(browser.store, gate.fetch);
      const listing = names(reader);
      await gate.reached;
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toEqual({ id: 'b2' });

      gate.release();
      expect(await listing).toEqual([
        'datatug-project.json',
        'entities',
        'x.json',
      ]);
    });

    it('a file served by the mirror at the old commit is not what the sources line says of the new one', async () => {
      gh.fail.raw = 429;
      gh.fail.api = (url) =>
        url.pathname.endsWith(`/git/trees/${SHA_1}`) ? 422 : undefined;
      const reader = browser.load();
      expect(await first(reader.getRawJson(ID_B, 'x.json'))).toEqual({ x: 1 });
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        commit: SHA_1,
        fromMirror: true,
      });

      expect(await names(reader)).toEqual([
        'datatug-project.json',
        'entities',
        'x.json',
      ]);
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        commit: SHA_2,
        fromMirror: false,
      });
    });

    it('a file from the mirror whose answer comes after the visit moved is not what the sources line says of the new commit', async () => {
      gh.fail.raw = (url) =>
        url.pathname.includes(SHA_1) && url.pathname.endsWith('x.json')
          ? 429
          : undefined;
      const gate = gated(gh, (url) => url.includes('cdn.jsdelivr.net'));
      const reader = browser.load(browser.store, gate.fetch);
      const file = first(reader.getRawJson(ID_B, 'x.json'));
      await gate.reached; // the mirror is asked for the file at SHA_1
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toEqual({ id: 'b2' }); // the visit moves to SHA_2
      gate.release(); // the mirror answers for SHA_1, late

      expect(await file).toEqual({ x: 2 });
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        commit: SHA_2,
        fromMirror: false,
      });
    });

    it('a read at the old commit that fails after the visit moved is read again at the new one, not failed with the old one’s error', async () => {
      gh.fail.raw = (url) =>
        url.pathname.includes(SHA_1) && url.pathname.includes('E.entity')
          ? 500
          : undefined;
      gh.fail.mirror = 500;
      const gate = gated(
        gh,
        (url) =>
          url.includes('raw.githubusercontent.com') && url.includes('E.entity'),
      );
      const reader = browser.load(browser.store, gate.fetch);
      const entity = first(reader.getRawJson(ID_B, 'entities/E/E.entity.json'));
      await gate.reached;
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toEqual({ id: 'b2' });
      gate.release(); // the read at SHA_1 fails, now that the visit is at SHA_2

      expect(await entity).toEqual({});
      expect(gh.urls('raw.githubusercontent.com')).toContain(
        rawUrl(SHA_2, 'b/entities/E/E.entity.json', REPO),
      );
    });

    it('a read that fails at the commit the visit stays at is a failure, once', async () => {
      gh.fail.raw = (url) =>
        url.pathname.endsWith('x.json') ? 500 : undefined;
      gh.fail.mirror = 500;
      const reader = browser.load();
      await expect(
        first(reader.getRawJson(ID_B, 'x.json')),
      ).rejects.toBeInstanceOf(GithubReadError);
      expect(gh.urls('raw.githubusercontent.com')).toEqual([
        rawUrl(SHA_1, 'b/x.json', REPO),
      ]);
    });

    it('a listing 404 at a commit GitHub answered for in this visit is not doubted', async () => {
      await browser.store.dropResolved(`${REPO}@HEAD`);
      gh.fail.api = (url) =>
        url.pathname.includes('/git/trees/') ? 404 : undefined;
      const reader = browser.load();
      expect(await names(reader)).toEqual([]);
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD', REPO),
        apiUrl(`git/trees/${SHA_2}?recursive=1`, REPO),
      ]);
    });

    it('asked again and GitHub answers, though it did not at first: the sources line no longer says "may not be the latest"', async () => {
      browser.time += GITHUB_RESOLVE_TTL_MS + 1; // the memory has expired
      let asked = 0;
      gh.fail.api = (url) =>
        url.pathname.includes('/commits/') && asked++ === 0 ? 403 : undefined;
      const reader = browser.load();
      // The project file is 404 at the commit that was remembered (SHA_1): the commit is asked again, and it is now
      // SHA_2, which has the project file.
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toEqual({ id: 'b2' });
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
        mayBeStale: false,
      });
    });

    it('asked again and GitHub names the same commit, answering this time: the commit is no longer "remembered"', async () => {
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.rewrite(REPO, SHA_1, {
        'a/datatug-project.json': '{}',
        'b/x.json': '{"x":1}',
      });
      let asked = 0;
      gh.fail.api = (url) =>
        url.pathname.includes('/commits/') && asked++ === 0 ? 403 : undefined;
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(ID_B, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        state: 'resolved',
        commit: SHA_1,
        mayBeStale: false,
      });
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD', REPO),
        rawUrl(SHA_1, 'b/datatug-project.json', REPO),
        apiUrl('commits/HEAD', REPO),
      ]);
    });
  });

  describe('the memory is dropped only for the ref concerned, and only once GitHub has answered', () => {
    const FEATURE_ID = `${DEMO_ID}@feature`;

    it('the ref no longer exists: its memory is dropped, the memory of the default branch is not', async () => {
      const repo = gh.addRepo(DEMO_REPO, SHA_1, demoFiles());
      repo.refs['feature'] = SHA_1;
      await first(browser.load().getRawJson(DEMO_ID, ENV));
      await first(browser.load().getRawJson(FEATURE_ID, ENV));
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toBeDefined();
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@feature`),
      ).toBeDefined();

      // The branch is deleted and the repository rewritten.
      gh.rewrite(DEMO_REPO, SHA_2, demoFiles({ [REPO_ENV]: '{"v":2}' }));
      delete repo.refs['feature'];
      gh.reset();

      const reader = browser.load();
      expect(
        await first(reader.getRawJson(FEATURE_ID, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(FEATURE_ID))).toMatchObject({
        state: 'missing',
      });
      expect(gh.urls()).toEqual([
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
        apiUrl('commits/feature'),
      ]);
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@feature`),
      ).toBeUndefined();
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toMatchObject({
        sha: SHA_1,
      });
    });

    it('an expired memory of a ref that no longer exists is dropped when GitHub says so', async () => {
      const id = `${DEMO_ID}@gone-branch`;
      await browser.store.putResolved(`${DEMO_REPO}@gone-branch`, {
        sha: SHA_1,
        at: browser.time - GITHUB_RESOLVE_TTL_MS - 1,
      });
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(id, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(id))).toMatchObject({
        state: 'missing',
      });
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@gone-branch`),
      ).toBeUndefined();
    });

    it('the memory of the ref is not touched before GitHub has answered, and is replaced by the answer', async () => {
      gh.rewrite(DEMO_REPO, SHA_2, demoFiles({ [REPO_ENV]: '{"v":2}' }));
      const gate = gated(gh, (url) => url.includes('/commits/'));
      const store = new MemoryStore();
      store.resolved.set(`${DEMO_REPO}@HEAD`, { sha: SHA_1, at: browser.time });
      const reader = browser.load(store, gate.fetch);

      const read = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await gate.reached;
      // The question is on its way: the memory of the earlier answer is still there.
      expect(store.resolved.get(`${DEMO_REPO}@HEAD`)).toEqual({
        sha: SHA_1,
        at: browser.time,
      });
      gate.release();
      expect(await read).toEqual({ id: 'datatug-demo-project' });
      expect(store.resolved.get(`${DEMO_REPO}@HEAD`)).toMatchObject({
        sha: SHA_2,
      });
      expect(store.calls.filter((c) => c.startsWith('forgetResolved'))).toEqual(
        [],
      );
    });
  });

  describe('forget and a resolve in flight', () => {
    it('a resolve that started before forget does not write its commit back afterwards', async () => {
      const gate = gated(gh, (url) => url.includes('/commits/'));
      const reader = browser.load(browser.store, gate.fetch);
      const read = first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      await gate.reached;

      await reader.forget('datatug', 'datatug-demo-projects');
      gate.release();
      expect(await read).toBe('{"id":"datatug-demo-project"}');

      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toBeUndefined();
      // The next read asks again.
      gh.reset();
      await first(
        reader.getRawText(DEMO_ID, 'environments/local/local.env.json'),
      );
      expect(gh.urls('api.github.com')).toEqual([apiUrl('commits/HEAD')]);
    });

    it('a resolve that starts after forget is remembered as usual', async () => {
      const reader = browser.load();
      await reader.forget('datatug', 'datatug-demo-projects');
      await first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toMatchObject({
        sha: SHA_1,
      });
    });

    it('with the cache given up on, forget still attempts the persisted delete', async () => {
      const calls: string[] = [];
      const hanging: IGithubFileStore = {
        getFile: () => new Promise(() => undefined),
        putFile: () => new Promise(() => undefined),
        getResolved: () => new Promise(() => undefined),
        putResolved: () => new Promise(() => undefined),
        dropResolved: () => new Promise(() => undefined),
        forgetResolved: (repoKey) => {
          calls.push(repoKey);
          return new Promise(() => undefined);
        },
      };
      const reader = browser.load(hanging);
      const read = first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      await browser.timers.waitFor();
      browser.timers.fireAll(); // the cache is given up on
      await read;
      expect(calls).toEqual([]);

      const forgotten = reader.forget('datatug', 'datatug-demo-projects');
      await browser.timers.waitFor();
      expect(calls).toEqual(['datatug/datatug-demo-projects']);
      browser.timers.fireAll(); // it does not answer: forget does not wait for it for ever
      await expect(forgotten).resolves.toBeUndefined();
    });
  });

  describe('a cache that opens slowly (the chunk, the database)', () => {
    /** The real cache, answering nothing until `open()` (a slow device loading and opening it). */
    const slow = (): { store: IGithubFileStore; open: () => void } => {
      let open: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => (open = resolve));
      const real = browser.store;
      return {
        open,
        store: {
          getFile: (k, p) => opened.then(() => real.getFile(k, p)),
          putFile: (k, p, f) => opened.then(() => real.putFile(k, p, f)),
          getResolved: (k) => opened.then(() => real.getResolved(k)),
          putResolved: (k, c) => opened.then(() => real.putResolved(k, c)),
          dropResolved: (k) => opened.then(() => real.dropResolved(k)),
          forgetResolved: (k) => opened.then(() => real.forgetResolved(k)),
        },
      };
    };

    it('the first read does not wait for it past the usual wait, and what is read after it opens is kept', async () => {
      const { store, open } = slow();
      const reader = browser.load(store);
      const project = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await browser.timers.waitFor(2);
      browser.timers.fireWith(GITHUB_STORE_TIMEOUT_MS);
      expect(await project).toEqual({ id: 'datatug-demo-project' });
      // The opening is still given until its own, longer limit.
      expect(browser.timers.count).toBe(1);
      expect(browser.timers.delays).toContain(GITHUB_STORE_OPEN_TIMEOUT_MS);

      open();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await first(reader.getRawJson(DEMO_ID, ENV))).toEqual({ v: 1 });
      expect(
        await browser.store.getFile(`${DEMO_REPO}@${SHA_1}`, REPO_ENV),
      ).toEqual({ text: '{"v":1}', bytes: 7 });
    });

    it('a cache that has not opened by its own limit is given up on for the visit', async () => {
      const { store, open } = slow();
      const reader = browser.load(store);
      const project = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await browser.timers.waitFor(2);
      browser.timers.fireAll();
      await project;
      open();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await first(reader.getRawJson(DEMO_ID, ENV));
      expect(
        await browser.store.getFile(`${DEMO_REPO}@${SHA_1}`, REPO_ENV),
      ).toBeUndefined();
    });
  });

  describe('raw refused and the mirror says 404', () => {
    it('at a commit: the optional file is absent for this visit, and nothing is kept', async () => {
      gh.fail.raw = 429;
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD'),
        rawUrl(SHA_1, 'demo-project-1/widgets/none.json'),
        mirrorUrl(SHA_1, 'demo-project-1/widgets/none.json'),
      ]);
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_1}`,
          'demo-project-1/widgets/none.json',
        ),
      ).toBeUndefined();
      // Not asked again in this visit.
      gh.reset();
      await first(reader.getRawJson(DEMO_ID, 'widgets/none.json'));
      expect(gh.count()).toBe(0);
    });

    it('with no commit, an optional file that the file host says is not there is absent, and nothing is kept', async () => {
      gh.fail.api = 403;
      const reader = browser.load();
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@HEAD`,
          'demo-project-1/widgets/none.json',
        ),
      ).toBeUndefined();
      expect(gh.urls('cdn.jsdelivr.net')).toEqual([]);
    });

    it('at a commit given in the id: the same', async () => {
      gh.fail.raw = 'network';
      const reader = browser.load();
      expect(
        await first(
          reader.getRawText(`${DEMO_ID}@${SHA_1}`, 'widgets/none.json'),
        ),
      ).toBeUndefined();
    });

    it('the project file is not taken for absent that way: the mirror may lag behind a project just created', async () => {
      gh.fail.raw = 429;
      const reader = browser.load();
      const error = await first(
        reader.getRawText(
          `${DEMO_ID}@${SHA_1}`,
          'nothing/datatug-project.json',
        ),
      ).catch((e) => e);
      // (the file is named like the project file of a folder, and is not there)
      expect(error).toBeInstanceOf(GithubReadError);
    });

    it('with no commit (unversioned reads of HEAD): still an error naming both hosts', async () => {
      gh.fail.api = 403;
      gh.fail.raw = 429;
      const reader = browser.load();
      const error = await first(
        reader.getRawText(DEMO_ID, 'widgets/none.json'),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(GithubReadError);
      expect(gh.urls('cdn.jsdelivr.net')).toEqual([
        mirrorUrl(undefined, 'demo-project-1/widgets/none.json'),
      ]);
    });
  });

  describe('the project summary of the store service follows the commit of the reader', () => {
    const SUMMARY_FILE = 'demo-project-1/datatug-project.json';
    const titled = (title: string, extra: Record<string, string> = {}) =>
      demoFiles({ [SUMMARY_FILE]: `{"title":"${title}"}`, ...extra });

    it('a summary read at a commit that was only remembered is not kept once the visit has moved to another one', async () => {
      gh.addRepo(DEMO_REPO, SHA_1, titled('one'));
      const warm = browser.load();
      await first(warm.getRawJson(DEMO_ID, 'datatug-project.json'));
      gh.rewrite(DEMO_REPO, SHA_2, titled('two'));
      browser.time += 60_000;
      gh.reset();

      const reader = browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      // From the cache, at the remembered commit: the project as it was.
      expect(await first(summaries.getProjectSummary(DEMO_ID))).toMatchObject({
        title: 'one',
      });
      // The listing says the commit is gone; GitHub names the other one, and the visit moves to it.
      expect(
        (await first(reader.listDirectory(DEMO_ID, ''))).map((e) => e.name),
      ).toEqual(['datatug-project.json', 'entities', 'environments']);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        commit: SHA_2,
      });

      expect(await first(summaries.getProjectSummary(DEMO_ID))).toMatchObject({
        title: 'two',
      });
      // And is kept again from there on: one read, whoever asks.
      gh.reset();
      await first(summaries.getProjectSummary(DEMO_ID));
      expect(gh.count()).toBe(0);
    });

    it('the epoch of the visit changes when the visit moves, and when the repository is forgotten, and not otherwise', async () => {
      gh.addRepo(DEMO_REPO, SHA_1, titled('one'));
      await first(browser.load().getRawJson(DEMO_ID, 'datatug-project.json'));
      gh.rewrite(DEMO_REPO, SHA_2, titled('two'));
      browser.time += 60_000;
      const reader = browser.load();
      const before = reader.visitEpoch(DEMO_ID);
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      expect(reader.visitEpoch(DEMO_ID)).toBe(before); // a read at the remembered commit is not a move
      await first(reader.listDirectory(DEMO_ID, ''));
      const moved = reader.visitEpoch(DEMO_ID);
      expect(moved).not.toBe(before);
      expect(reader.visitEpoch(DEMO_ID)).toBe(moved);
      await reader.forget('datatug', 'datatug-demo-projects');
      expect(reader.visitEpoch(DEMO_ID)).not.toBe(moved);
      expect(() => reader.visitEpoch('not-a-project-id')).toThrow();

      // Forgotten with no move before it: the visit starts afresh, which is a change all the same.
      const other = browser.load();
      await first(other.getRawJson(DEMO_ID, 'datatug-project.json'));
      const unmoved = other.visitEpoch(DEMO_ID);
      await other.forget('datatug', 'datatug-demo-projects');
      expect(other.visitEpoch(DEMO_ID)).not.toBe(unmoved);
    });
  });

  describe('API calls of a visit (design 4.5: one call for the commit, one for the listing)', () => {
    const apiCalls = (): number => gh.count('api.github.com');
    /** What the project pages read: the project file, the listing and an environment file. */
    const pages = async (reader: GithubProjectReaderService): Promise<void> => {
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await first(reader.listDirectory(DEMO_ID, ''));
      await first(reader.getRawJson(DEMO_ID, ENV));
    };
    it('cold: 2; warm within 5 minutes: 0; warm after 5 minutes, nothing changed: 1', async () => {
      await pages(browser.load());
      expect(apiCalls()).toBe(2);

      browser.time += 60_000;
      gh.reset();
      await pages(browser.load());
      expect(apiCalls()).toBe(0);
      expect(gh.count()).toBe(0);

      browser.time += GITHUB_RESOLVE_TTL_MS;
      gh.reset();
      await pages(browser.load());
      expect(gh.urls()).toEqual([apiUrl('commits/HEAD')]);
    });

    it('the project changed: 2 (the commit and the listing of the new one), and only the files that are read again', async () => {
      await pages(browser.load());
      push();
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.reset();
      await pages(browser.load());
      expect(gh.urls('api.github.com')).toEqual([
        apiUrl('commits/HEAD'),
        apiUrl(`git/trees/${SHA_2}?recursive=1`),
      ]);
    });

    it('five new absent optional files on a warm visit: 0 API calls', async () => {
      await pages(browser.load());
      browser.time += 60_000;
      gh.reset();
      const warm = browser.load();
      await pages(warm);
      for (const name of ['a', 'b', 'c', 'd', 'e']) {
        await first(warm.getRawJson(DEMO_ID, `widgets/${name}.json`));
      }
      expect(apiCalls()).toBe(0);
    });

    it('a repository with no project file: 1 call per page load, however warm', async () => {
      const bare = 'datatug-demo-projects@datatug@nothing-here';
      const counts: number[] = [];
      for (const step of [0, 30_000, 30_000, GITHUB_RESOLVE_TTL_MS]) {
        browser.time += step;
        gh.reset();
        const reader = browser.load();
        await first(reader.getRawJson(bare, 'datatug-project.json'));
        await first(reader.getRawJson(bare, 'datatug-project.json'));
        counts.push(apiCalls());
      }
      expect(counts).toEqual([1, 1, 1, 1]);
    });

    it('a commit that is gone: 3 (the listing, the commit asked again, the listing of the new one)', async () => {
      await first(browser.load().getRawJson(DEMO_ID, ENV)); // the commit remembered, no listing kept
      gh.rewrite(DEMO_REPO, SHA_2, demoFiles());
      browser.time += 60_000;
      gh.reset();
      await first(browser.load().listDirectory(DEMO_ID, ''));
      expect(gh.urls('api.github.com')).toEqual([
        apiUrl(`git/trees/${SHA_1}?recursive=1`),
        apiUrl('commits/HEAD'),
        apiUrl(`git/trees/${SHA_2}?recursive=1`),
      ]);
    });
  });
});

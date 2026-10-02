import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, retry } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeGithub, ManualTimers, fakeSha } from './github-fake-backend.test';
import {
  GITHUB_STORE_TIMEOUT_MS,
  NO_GITHUB_FILE_STORE,
  type IGithubFileStore,
} from './github-file-store-api';
import { openGithubFileStore } from './github-file-store';
import {
  GITHUB_CLOCK,
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
  GITHUB_TIMER,
  GithubProjectNotFoundError,
  GithubProjectReaderService,
  GithubReadBudget,
  GithubReadError,
  GithubReadLimitError,
} from './github-project-reader.service';
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  GITHUB_RESOLVE_TIMEOUT_MS,
} from './github-read-limits';
import { DatatugStoreGithubService } from '../datatug-store.service.github';

const REPO = 'datatug/projects';
const ID_A = 'projects@datatug@a';
const ID_B = 'projects@datatug@b';
const DEMO_REPO = 'datatug/datatug-demo-projects';
const DEMO_ID = 'datatug-demo-projects@datatug@demo-project-1';
const SHA_1 = fakeSha(0x111);
const SHA_2 = fakeSha(0x222);

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

function demoFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'demo-project-1/datatug-project.json': '{"id":"datatug-demo-project"}',
    'demo-project-1/environments/local/local.env.json': '{}',
    'demo-project-1/entities/Album/Album.entity.json': '{}',
    ...extra,
  };
}

/** A request that never answers, until the caller gives up on it (as `fetch` does). */
const hangUntilAborted = (init: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new TypeError('aborted')),
    );
  });

const apiUrl = (path: string, repo = DEMO_REPO) =>
  `https://api.github.com/repos/${repo}/${path}`;
const rawUrl = (sha: string, path: string, repo = DEMO_REPO) =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;

describe('GithubProjectReaderService: the review of round 1', () => {
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

  describe('S1: a project created in a repository this browser has already read', () => {
    beforeEach(() => {
      gh.addRepo(REPO, SHA_1, { 'a/datatug-project.json': '{"title":"A"}' });
    });

    it('project A open, then project B created in the same repository: after forget, B opens', async () => {
      const reader = browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      expect(await first(summaries.getProjectSummary(ID_A))).toMatchObject({
        title: 'A',
      });

      // The new project is committed: a new commit on the default branch.
      gh.push(REPO, SHA_2, {
        'a/datatug-project.json': '{"title":"A"}',
        'b/datatug-project.json': '{"title":"B"}',
      });
      await reader.forget('datatug', 'projects');
      summaries.forget('datatug', 'projects');

      expect(await first(summaries.getProjectSummary(ID_B))).toMatchObject({
        title: 'B',
      });
      expect(await first(reader.readInfo(ID_B))).toMatchObject({
        state: 'resolved',
        commit: SHA_2,
      });
      // The memory of the answer is the new commit too, for the next page load.
      expect(await browser.store.getResolved(`${REPO}@HEAD`)).toEqual({
        sha: SHA_2,
        at: browser.time,
      });
    });

    it('the address opened before the project exists, then the project created: after forget, it opens', async () => {
      const reader = browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      const error = await first(summaries.getProjectSummary(ID_B)).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(GithubProjectNotFoundError);
      // The absence of the project file is for this visit only, never kept under the commit.
      expect(
        await browser.store.getFile(
          `${REPO}@${SHA_1}`,
          'b/datatug-project.json',
        ),
      ).toBeUndefined();

      gh.push(REPO, SHA_2, {
        'a/datatug-project.json': '{"title":"A"}',
        'b/datatug-project.json': '{"title":"B"}',
      });
      await reader.forget('datatug', 'projects');
      summaries.forget('datatug', 'projects');

      expect(await first(summaries.getProjectSummary(ID_B))).toMatchObject({
        title: 'B',
      });
    });

    it('forget drops the repository at every ref (any case), and keeps what belongs to other repositories', async () => {
      const reader = browser.load();
      await browser.store.putResolved(`${REPO}@HEAD`, { sha: SHA_1, at: 1 });
      await browser.store.putResolved(`${REPO}@feature`, { sha: SHA_1, at: 1 });
      await browser.store.putResolved(`${DEMO_REPO}@HEAD`, {
        sha: SHA_1,
        at: 1,
      });
      // A repository whose name merely begins with this one's is another repository.
      await browser.store.putResolved(`${REPO}-x@HEAD`, { sha: SHA_1, at: 1 });
      await first(reader.getRawJson(ID_A, 'datatug-project.json'));
      await first(reader.getRawJson(`${ID_A}@feature`, 'datatug-project.json'));
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      gh.reset();

      await reader.forget('Datatug', 'Projects');
      // The session of another repository is untouched: nothing is asked for it again.
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      expect(gh.count()).toBe(0);

      expect(await browser.store.getResolved(`${REPO}@HEAD`)).toBeUndefined();
      expect(
        await browser.store.getResolved(`${REPO}@feature`),
      ).toBeUndefined();
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toBeDefined();
      expect(await browser.store.getResolved(`${REPO}-x@HEAD`)).toBeDefined();
      // Both sessions are gone: the next read asks for the commit again.
      await first(reader.getRawJson(ID_A, 'datatug-project.json'));
      await first(reader.getRawJson(`${ID_A}@feature`, 'datatug-project.json'));
      expect(gh.urls('api.github.com')).toEqual([
        apiUrl('commits/HEAD', REPO),
        apiUrl('commits/feature', REPO),
      ]);
    });

    it('forget still completes when the cache does not answer', async () => {
      const reader = browser.load({
        ...NO_GITHUB_FILE_STORE,
        forgetResolved: () => Promise.reject(new Error('blocked')),
      });
      await expect(
        reader.forget('datatug', 'projects'),
      ).resolves.toBeUndefined();
    });

    it('the summary service forgets only the projects of that repository', () => {
      browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      const a = summaries.getProjectSummary(ID_A);
      const other = summaries.getProjectSummary('other@datatug@a');
      expect(summaries.getProjectSummary(ID_A)).toBe(a);

      summaries.forget('Datatug', 'Projects');

      expect(summaries.getProjectSummary('other@datatug@a')).toBe(other);
      expect(summaries.getProjectSummary(ID_A)).not.toBe(a);
    });
  });

  describe('S2: a transient failure of the project file does not stick', () => {
    it('both hosts fail once and recover: the second getProjectSummary succeeds', async () => {
      browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      gh.fail.raw = 500;
      gh.fail.mirror = 500;
      const error = await first(summaries.getProjectSummary(DEMO_ID)).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(GithubReadError);

      gh.fail.raw = undefined;
      gh.fail.mirror = undefined;
      expect(await first(summaries.getProjectSummary(DEMO_ID))).toEqual({
        id: DEMO_ID,
      });
    });
  });

  describe('S3: the cache that never answers cannot hang a read', () => {
    const hanging = (): IGithubFileStore => ({
      getFile: () => new Promise(() => undefined),
      putFile: () => new Promise(() => undefined),
      getResolved: () => new Promise(() => undefined),
      putResolved: () => new Promise(() => undefined),
      dropResolved: () => new Promise(() => undefined),
      forgetResolved: () => new Promise(() => undefined),
    });

    it('a store that never settles: the read completes from the network, and the cache is off for the rest of the visit', async () => {
      const reader = browser.load(hanging());
      const read = first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      await browser.timers.waitFor();
      browser.timers.fireAll();

      expect(await read).toBe('{"id":"datatug-demo-project"}');
      expect(browser.timers.delays[0]).toBe(GITHUB_STORE_TIMEOUT_MS);
      expect(GITHUB_STORE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD'),
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
      ]);

      // Nothing waits for it again.
      const timersSet = browser.timers.delays.length;
      expect(
        await first(reader.listDirectory(DEMO_ID, 'entities')),
      ).toHaveLength(1);
      await first(
        reader.getRawText(DEMO_ID, 'environments/local/local.env.json'),
      );
      expect(browser.timers.delays).toHaveLength(timersSet);
    });

    it('an IDBFactory.open that never settles: the read completes from the network', async () => {
      const never = {
        open: () => ({}) as unknown as IDBOpenDBRequest,
      } as unknown as IDBFactory;
      const reader = browser.load(
        openGithubFileStore(never, () => browser.time),
      );
      const read = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));
      await browser.timers.waitFor();
      browser.timers.fireAll();
      expect(await read).toEqual({ id: 'datatug-demo-project' });
    });

    it('a cache that answers in time is used, and its timer is cancelled', async () => {
      await first(browser.load().getRawText(DEMO_ID, 'datatug-project.json'));
      gh.reset();
      const reader = browser.load();
      await first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      expect(gh.count()).toBe(0);
      expect(browser.timers.count).toBe(0);
    });
  });

  describe('M1, M5: raw refused and the mirror says 404 is "the hosts did not answer", never "absent"', () => {
    it.each([
      ['refuses (429)', 429],
      ['is down (503)', 503],
      ['is unreachable', 'network' as const],
    ])(
      'the file host %s and the mirror has not the file: a failed read naming both hosts, nothing kept; asking again works',
      async (_name, failure) => {
        gh.fail.raw = failure;
        gh.fail.mirror = 404;
        const reader = browser.load();
        const error = await first(
          reader.getRawJson(DEMO_ID, 'datatug-project.json'),
        ).catch((e) => e);

        expect(error).toBeInstanceOf(GithubReadError);
        expect((error as GithubReadError).hosts).toEqual([
          'raw.githubusercontent.com',
          'cdn.jsdelivr.net',
        ]);
        expect(
          await browser.store.getFile(
            `${DEMO_REPO}@${SHA_1}`,
            'demo-project-1/datatug-project.json',
          ),
        ).toBeUndefined();

        gh.fail.raw = undefined;
        gh.fail.mirror = undefined;
        expect(
          await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
        ).toEqual({ id: 'datatug-demo-project' });
      },
    );

    it('the file host itself answers 404: absent, and remembered as absent, except for the project file', async () => {
      const reader = browser.load();
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_1}`,
          'demo-project-1/widgets/none.json',
        ),
      ).toEqual({ text: null, bytes: 0 });

      gh.addRepo(REPO, SHA_1, {});
      expect(
        await first(reader.getRawJson(ID_A, 'datatug-project.json')),
      ).toBeUndefined();
      expect(
        await browser.store.getFile(
          `${REPO}@${SHA_1}`,
          'a/datatug-project.json',
        ),
      ).toBeUndefined();
    });

    it('the project file of a project at the repository root is not remembered as absent either', async () => {
      gh.addRepo(REPO, SHA_1, {});
      const reader = browser.load();
      expect(
        await first(
          reader.getRawJson('projects@datatug@', 'datatug-project.json'),
        ),
      ).toBeUndefined();
      expect(
        await browser.store.getFile(`${REPO}@${SHA_1}`, 'datatug-project.json'),
      ).toBeUndefined();
    });
  });

  describe('M7: a remembered commit that no longer exists', () => {
    beforeEach(async () => {
      // An earlier visit remembered SHA_1 (and kept only a file of it, not the listing); then the repository was
      // force-pushed and SHA_1 is gone.
      await first(
        browser.load().getRawText(DEMO_ID, 'environments/local/local.env.json'),
      );
      gh.rewrite(
        DEMO_REPO,
        SHA_2,
        demoFiles({
          'demo-project-1/datatug-project.json': '{"id":"new"}',
          'demo-project-1/entities/Track/Track.entity.json': '{}',
        }),
      );
      gh.reset();
    });

    it('the listing of it is refused as unknown: the memory is dropped, the commit is resolved again once, and the listing is of the new commit', async () => {
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
      expect(await browser.store.getResolved(`${DEMO_REPO}@HEAD`)).toEqual({
        sha: SHA_2,
        at: browser.time,
      });
    });

    it('the project file is 404 at it: the same, and nothing is kept as absent under the gone commit', async () => {
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toEqual({ id: 'new' });

      expect(gh.urls()).toEqual([
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
        apiUrl('commits/HEAD'),
        rawUrl(SHA_2, 'demo-project-1/datatug-project.json'),
      ]);
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_1}`,
          'demo-project-1/datatug-project.json',
        ),
      ).toBeUndefined();
    });

    it('reads that were waiting for the answer about the gone commit are redone at the new one', async () => {
      const reader = browser.load();
      const [entities, track, project, listing] = await Promise.all([
        first(reader.getRawJson(DEMO_ID, 'entities/Track/Track.entity.json')),
        first(reader.getRawText(DEMO_ID, 'entities/Track/Track.entity.json')),
        first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
        first(reader.listDirectory(DEMO_ID, 'entities')),
      ]);
      expect(entities).toEqual({});
      expect(track).toBe('{}');
      expect(project).toEqual({ id: 'new' });
      expect(listing.map((e) => e.name)).toEqual(['Album', 'Track']);
      // One commit was resolved again, once.
      expect(
        gh.urls('api.github.com').filter((u) => u.includes('/commits/')),
      ).toEqual([apiUrl('commits/HEAD')]);
    });

    it('the resolve call is refused when asking again: the remembered commit is kept for the visit, and the 404 is absent', async () => {
      gh.fail.api = (url) =>
        url.pathname.includes('/commits/') ? 403 : undefined;
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_1,
      });
      expect(gh.urls('raw.githubusercontent.com')).toEqual([
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
      ]);
    });

    it('the commit is alive and the project file really is not there: asks once more, says missing, and does not ask again', async () => {
      const bare = new FakeGithub();
      bare.addRepo(REPO, SHA_1, { 'a/datatug-project.json': '{}' });
      const other = new Browser(bare);
      await first(other.load().listDirectory(ID_A, ''));
      bare.reset();

      const reader = other.load();
      const id = 'projects@datatug@b';
      expect(
        await first(reader.getRawJson(id, 'datatug-project.json')),
      ).toBeUndefined();
      expect(
        await first(reader.getRawJson(id, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.readInfo(id))).toMatchObject({
        state: 'resolved',
        commit: SHA_1,
      });
      expect(bare.urls()).toEqual([
        rawUrl(SHA_1, 'b/datatug-project.json', REPO),
        apiUrl('commits/HEAD', REPO),
      ]);
      // The project file is the one answer that is not kept: it is about to be created.
      expect(
        await other.store.getFile(`${REPO}@${SHA_1}`, 'b/datatug-project.json'),
      ).toBeUndefined();
    });

    it('the commit is alive and another file is not there: absent, with no question, and remembered as absent', async () => {
      const bare = new FakeGithub();
      bare.addRepo(REPO, SHA_1, { 'a/datatug-project.json': '{}' });
      const other = new Browser(bare);
      await first(other.load().listDirectory(ID_A, ''));
      bare.reset();

      const reader = other.load();
      expect(
        await first(reader.getRawJson('projects@datatug@b', 'widgets/x.json')),
      ).toBeUndefined();
      expect(bare.urls()).toEqual([rawUrl(SHA_1, 'b/widgets/x.json', REPO)]);
      expect(
        await other.store.getFile(`${REPO}@${SHA_1}`, 'b/widgets/x.json'),
      ).toEqual({ text: null, bytes: 0 });
    });

    it('a commit that GitHub answered for just now is not doubted: a missing project file is missing, with no second question', async () => {
      const bare = new FakeGithub();
      bare.addRepo(REPO, SHA_1, { 'a/datatug-project.json': '{}' });
      const other = new Browser(bare);
      await first(other.load().listDirectory(ID_A, ''));
      other.time += 10 * 60_000; // the memory has expired: the answer of this visit is fresh
      bare.reset();

      expect(
        await first(other.load().getRawJson(ID_B, 'datatug-project.json')),
      ).toBeUndefined();
      expect(bare.urls()).toEqual([
        apiUrl('commits/HEAD', REPO),
        rawUrl(SHA_1, 'b/datatug-project.json', REPO),
      ]);
    });
  });

  describe('M8: a cached listing that is not a listing is not used', () => {
    it.each([
      ['not JSON', '{oops'],
      ['an object', '{"tree":[]}'],
      ['entries with no path', '[{"type":"tree"}]'],
      ['entries of an unknown type', '[{"path":"a","type":"symlink"}]'],
      ['entries that are not objects', '[null, 3]'],
      ['an empty text', ''],
    ])('%s: the listing is read from the network', async (_name, bad) => {
      await browser.store.putResolved(`${DEMO_REPO}@HEAD`, {
        sha: SHA_1,
        at: browser.time,
      });
      await browser.store.putFile(`${DEMO_REPO}@${SHA_1}`, '#tree', {
        text: bad,
        bytes: bad.length,
      });
      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(gh.urls()).toEqual([apiUrl(`git/trees/${SHA_1}?recursive=1`)]);
    });

    it('a well-formed cached listing is used', async () => {
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      gh.reset();
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      expect(gh.count()).toBe(0);
    });
  });

  describe('M9: an empty project file is null, as HttpClient read it', () => {
    it.each([
      ['empty', ''],
      ['spaces', '   '],
      ['a line break', '\n\t \r\n'],
    ])('a .json file that is %s', async (_name, body) => {
      gh.push(
        DEMO_REPO,
        SHA_2,
        demoFiles({
          'demo-project-1/environments/local/local.env.json': body,
          'demo-project-1/entities/Album/Album.entity.json': body,
          'demo-project-1/boards/b/board.json': body,
        }),
      );
      const reader = browser.load();
      expect(
        await first(
          reader.getRawJson(DEMO_ID, 'environments/local/local.env.json'),
        ),
      ).toBeNull();
      // Callers keep their defaults.
      expect(
        await first(reader.getEnvironmentSummary(DEMO_ID, 'local')),
      ).toEqual({ id: 'local', title: 'local', dbServers: undefined });
      expect(await first(reader.getEntity(DEMO_ID, 'Album'))).toEqual({
        id: 'Album',
        fields: [],
      });
      expect(await first(reader.getBoard(DEMO_ID, 'b'))).toEqual({
        id: 'b',
        title: 'b',
      });
      // Warm: the same from the cache.
      expect(
        await first(
          browser
            .load()
            .getRawJson(DEMO_ID, 'environments/local/local.env.json'),
        ),
      ).toBeNull();
    });

    it('text that is not JSON is still an error', async () => {
      gh.push(
        DEMO_REPO,
        SHA_2,
        demoFiles({ 'demo-project-1/bad.json': '{not json' }),
      );
      const error = await first(
        browser.load().getRawJson(DEMO_ID, 'bad.json'),
      ).catch((e) => e);
      expect((error as Error).message).toBe(
        'demo-project-1/bad.json is not valid JSON',
      );
    });
  });

  describe('M10: the reader is lazy, so a retry reads again', () => {
    it('nothing is requested until something subscribes', async () => {
      const reader = browser.load();
      reader.getRawJson(DEMO_ID, 'datatug-project.json');
      reader.getRawText(DEMO_ID, 'datatug-project.json');
      reader.listDirectory(DEMO_ID, 'entities');
      reader.readInfo(DEMO_ID);
      reader.getQuery(DEMO_ID, 'q');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(gh.count()).toBe(0);
    });

    it('an invalid id is an error on subscription, not a throw when the observable is made', async () => {
      const reader = browser.load();
      const read = reader.getRawJson('not-an-id', 'datatug-project.json');
      await expect(first(read)).rejects.toThrow(
        /not a valid GitHub project id/,
      );
      const info = reader.readInfo('not-an-id');
      await expect(first(info)).rejects.toThrow(
        /not a valid GitHub project id/,
      );
      const listing = reader.listDirectory('not-an-id', '');
      await expect(first(listing)).rejects.toThrow(
        /not a valid GitHub project id/,
      );
      const text = reader.getRawText('not-an-id', 'x');
      await expect(first(text)).rejects.toThrow(
        /not a valid GitHub project id/,
      );
    });

    it('retry() re-reads a file after both hosts failed', async () => {
      let failing = true;
      gh.fail.raw = () => (failing ? 500 : undefined);
      gh.fail.mirror = () => (failing ? 500 : undefined);
      const reader = browser.load();
      const read = reader.getRawJson(DEMO_ID, 'datatug-project.json').pipe(
        retry({
          count: 1,
          delay: () => {
            failing = false;
            return of(0);
          },
        }),
      );
      expect(await first(read)).toEqual({ id: 'datatug-demo-project' });
    });

    it('retry() re-reads the listing after the API failed', async () => {
      let failing = true;
      gh.fail.api = (url) =>
        failing && url.pathname.includes('/git/trees/') ? 500 : undefined;
      const reader = browser.load();
      const read = reader.listDirectory(DEMO_ID, 'entities').pipe(
        retry({
          count: 1,
          delay: () => {
            failing = false;
            return of(0);
          },
        }),
      );
      expect((await first(read)).map((e) => e.name)).toEqual(['Album']);
    });

    it('subscribing again to the same observable re-reads only what failed', async () => {
      let failing = true;
      gh.fail.raw = () => (failing ? 500 : undefined);
      gh.fail.mirror = () => (failing ? 500 : undefined);
      const reader = browser.load();
      const read = reader.getRawText(DEMO_ID, 'datatug-project.json');
      await expect(first(read)).rejects.toBeInstanceOf(GithubReadError);
      failing = false;
      expect(await first(read)).toBe('{"id":"datatug-demo-project"}');
      gh.reset();
      expect(await first(read)).toBe('{"id":"datatug-demo-project"}');
      expect(gh.count()).toBe(0);
    });

    it('the budget counts distinct files, not subscriptions', async () => {
      const reader = browser.load();
      const budget = new GithubReadBudget(2);
      const a = reader.getRawJson(DEMO_ID, 'datatug-project.json', { budget });
      expect(budget.used).toBe(0); // nothing taken until subscribed
      await first(a);
      await first(a);
      await first(a);
      expect(budget.used).toBe(1);
      await first(
        reader.getRawText(DEMO_ID, 'environments/local/local.env.json', {
          budget,
        }),
      );
      await first(a);
      expect(budget.used).toBe(2);
      const error = await first(
        reader.getRawText(DEMO_ID, 'entities/Album/Album.entity.json', {
          budget,
        }),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(GithubReadLimitError);
    });
  });

  describe('the resolve call and the listing when GitHub does not give a commit', () => {
    it('an answer that is not a commit is no answer: the reads go on at HEAD', async () => {
      const notACommit: typeof gh.fetch = (url, init) =>
        url.includes('/commits/')
          ? Promise.resolve(new Response('<html>a captive portal</html>'))
          : gh.fetch(url, init);
      const reader = browser.load(browser.store, notACommit);
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'unresolved',
      });
      // Nothing was remembered of it.
      expect(
        await browser.store.getResolved(`${DEMO_REPO}@HEAD`),
      ).toBeUndefined();
    });

    it('the resolve call refused and nothing remembered: the listing is read at HEAD, kept for this visit only', async () => {
      gh.fail.api = (url) =>
        url.pathname.includes('/commits/') ? 403 : undefined;
      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(gh.urls()).toEqual([
        apiUrl('commits/HEAD'),
        apiUrl('git/trees/HEAD?recursive=1'),
      ]);
    });

    it('a commit given in the id that does not exist has an empty listing, with no second question', async () => {
      const id = `${DEMO_ID}@${fakeSha(0x999)}`;
      const reader = browser.load();
      expect(await first(reader.listDirectory(id, ''))).toEqual([]);
      expect(gh.urls()).toEqual([
        apiUrl(`git/trees/${fakeSha(0x999)}?recursive=1`),
      ]);
    });

    it('a listing that GitHub answers with a redirect is an empty one (the repository moved)', async () => {
      gh.fail.api = (url) =>
        url.pathname.includes('/git/trees/') ? 'redirect' : undefined;
      const reader = browser.load();
      expect(await first(reader.listDirectory(DEMO_ID, ''))).toEqual([]);
    });
  });

  describe('M11: a resolve call that hangs is given up early, and the read degrades', () => {
    it('after GITHUB_RESOLVE_TIMEOUT_MS the read goes on at HEAD, as when the call is refused', async () => {
      expect(GITHUB_RESOLVE_TIMEOUT_MS).toBeLessThan(GITHUB_REQUEST_TIMEOUT_MS);
      vi.useFakeTimers();
      const hangingApi: typeof gh.fetch = (url, init) =>
        url.startsWith('https://api.github.com/')
          ? hangUntilAborted(init)
          : gh.fetch(url, init);
      const reader = browser.load(NO_GITHUB_FILE_STORE, hangingApi);
      const read = first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));

      await vi.advanceTimersByTimeAsync(GITHUB_RESOLVE_TIMEOUT_MS);
      expect(await read).toEqual({ id: 'datatug-demo-project' });
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'unresolved',
        mayBeStale: true,
      });
      expect(gh.urls()).toEqual([
        rawUrl('HEAD', 'demo-project-1/datatug-project.json'),
      ]);
    });

    it('the listing keeps the long limit (nothing else can answer for it)', async () => {
      vi.useFakeTimers();
      let signalOfListing: AbortSignal | undefined;
      const slowListing: typeof gh.fetch = (url, init) => {
        if (url.includes('/git/trees/')) {
          signalOfListing = init.signal ?? undefined;
          return hangUntilAborted(init);
        }
        return gh.fetch(url, init);
      };
      const reader = browser.load(NO_GITHUB_FILE_STORE, slowListing);
      const read = first(reader.listDirectory(DEMO_ID, '')).catch((e) => e);
      await vi.advanceTimersByTimeAsync(GITHUB_RESOLVE_TIMEOUT_MS + 1);
      expect(signalOfListing?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(GITHUB_REQUEST_TIMEOUT_MS);
      expect(signalOfListing?.aborted).toBe(true);
      expect(await read).toBeInstanceOf(GithubReadError);
    });
  });
});

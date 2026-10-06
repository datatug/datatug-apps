import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { FakeGithub, fakeSha } from './github-fake-backend.test';
import {
  GITHUB_RESOLVE_TTL_MS,
  type IGithubFileStore,
} from './github-file-store-api';
import { openGithubFileStore } from './github-file-store';
import {
  GITHUB_CLOCK,
  GITHUB_FETCH,
  GITHUB_FILE_STORE,
  GithubFileTooLargeError,
  GithubProjectNotFoundError,
  GithubProjectReaderService,
  GithubReadBudget,
  GithubReadError,
  GithubReadLimitError,
} from './github-project-reader.service';
import { MAX_PROJECT_FILE_BYTES } from './github-read-limits';
import {
  GITHUB_STORE_ID,
  isTrustedProjectAddress,
} from '../../../nav/github-project-address';
import { DatatugStoreGithubService } from '../datatug-store.service.github';

const DEMO_REPO = 'datatug/datatug-demo-project';
const DEMO_ID = 'datatug-demo-project@datatug@demo-project-1';
const CHINOOK_REPO = 'datatug/chinook-demo';
const CHINOOK_ID = 'chinook-demo@datatug@';
const SHA_1 = fakeSha(0x111);
const SHA_2 = fakeSha(0x222);

const first = <T>(o: Parameters<typeof firstValueFrom<T>>[0]) =>
  firstValueFrom(o);

/** One browser: its clock, its IndexedDB and the fake GitHub; `load()` is a page load (a new reader over them). */
class Browser {
  time = 10_000_000;
  readonly idb = new IDBFactory();
  readonly store: IGithubFileStore = openGithubFileStore(
    this.idb,
    () => this.time,
  );

  constructor(readonly gh: FakeGithub) {}

  load(store: IGithubFileStore = this.store): GithubProjectReaderService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: GITHUB_FETCH, useValue: this.gh.fetch },
        { provide: GITHUB_CLOCK, useValue: () => this.time },
        { provide: GITHUB_FILE_STORE, useValue: store },
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
    'demo-project-1/queries/albums/q.query.json': '{"type":"SQL"}',
    'demo-project-1/queries/albums/q.query.sql': 'select 1',
    ...extra,
  };
}

/**
 * What the project pages read on a cold visit: the listing and a handful of files, some of them absent (unless
 * `absent` is false: with the file host down, a file the mirror has not is not known to be absent, see M5).
 */
async function readLikeThePages(
  reader: GithubProjectReaderService,
  id = DEMO_ID,
  absent = true,
): Promise<void> {
  await first(reader.getRawJson(id, 'datatug-project.json'));
  await first(reader.listEnvironmentIds(id));
  await first(reader.getRawJson(id, 'environments/local/local.env.json'));
  await first(reader.listEntityIds(id));
  await first(reader.getEntity(id, 'Album'));
  await first(reader.getQueriesFolder(id));
  await first(reader.getQuery(id, 'q'));
  if (absent) {
    await first(reader.getRawJson(id, 'widgets/none.json')); // absent
    await first(reader.getBoard(id, 'board1')); // absent
  }
}

describe('GithubProjectReaderService: the commit, the cache, the failover (design 4.5)', () => {
  let gh: FakeGithub;
  let browser: Browser;

  beforeEach(() => {
    gh = new FakeGithub();
    gh.addRepo(DEMO_REPO, SHA_1, demoFiles());
    browser = new Browser(gh);
  });

  const rawUrl = (sha: string, path: string, repo = DEMO_REPO) =>
    `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
  const mirrorUrl = (sha: string | undefined, path: string, repo = DEMO_REPO) =>
    `https://cdn.jsdelivr.net/gh/${repo}${sha ? `@${sha}` : ''}/${path}`;

  describe('the degrade table, row by row', () => {
    it('row 1: the resolve call answers and the file host answers: raw at the commit, kept under the commit', async () => {
      const reader = browser.load();
      await first(reader.getRawText(DEMO_ID, 'datatug-project.json'));

      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toEqual({
        org: 'datatug',
        repo: 'datatug-demo-project',
        state: 'resolved',
        commit: SHA_1,
        fromMirror: false,
        mayBeStale: false,
      });
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_1}`,
          'demo-project-1/datatug-project.json',
        ),
      ).toEqual({ text: '{"id":"datatug-demo-project"}', bytes: 29 });
    });

    it.each([
      ['a 429', 429],
      ['a 503', 503],
      ['a 403', 403],
      ['a network error', 'network' as const],
    ])(
      'row 2: the file host fails with %s: jsDelivr at the same commit, kept under the commit',
      async (_name, failure) => {
        gh.fail.raw = failure;
        const reader = browser.load();
        expect(
          await first(reader.getRawText(DEMO_ID, 'datatug-project.json')),
        ).toBe('{"id":"datatug-demo-project"}');

        expect(gh.urls()).toEqual([
          `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
          rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
          mirrorUrl(SHA_1, 'demo-project-1/datatug-project.json'),
        ]);
        const info = await first(reader.readInfo(DEMO_ID));
        expect(info).toMatchObject({
          state: 'resolved',
          commit: SHA_1,
          fromMirror: true,
          mayBeStale: false,
        });
        expect(
          await browser.store.getFile(
            `${DEMO_REPO}@${SHA_1}`,
            'demo-project-1/datatug-project.json',
          ),
        ).toBeDefined();
      },
    );

    it('row 2: a file the file host answers 404 for is absent, not a reason to ask the mirror', async () => {
      const reader = browser.load();
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      expect(gh.count('cdn.jsdelivr.net')).toBe(0);
    });

    it.each([
      ['refused (403)', 403],
      ['refused (429)', 429],
      ['down (500)', 500],
      ['unreachable', 'network' as const],
    ])(
      'row 3: the resolve call is %s and an earlier commit is remembered: reads that commit, "may not be the latest", kept',
      async (_name, failure) => {
        // An earlier visit resolved SHA_1 ...
        await first(browser.load().getRawText(DEMO_ID, 'datatug-project.json'));
        // ... the project moved on, the memory of the answer has expired, and the resolve call is now refused.
        gh.push(
          DEMO_REPO,
          SHA_2,
          demoFiles({ 'demo-project-1/datatug-project.json': '{"id":"new"}' }),
        );
        browser.time += GITHUB_RESOLVE_TTL_MS + 1;
        gh.fail.api = (url) =>
          url.pathname.endsWith('/commits/HEAD') ? failure : undefined;
        gh.reset();

        const reader = browser.load();
        expect(
          await first(
            reader.getRawJson(DEMO_ID, 'environments/local/local.env.json'),
          ),
        ).toEqual({});
        expect(gh.urls().slice(1)).toEqual([
          rawUrl(SHA_1, 'demo-project-1/environments/local/local.env.json'),
        ]);
        expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
          state: 'remembered',
          commit: SHA_1,
          mayBeStale: true,
        });
        expect(
          await browser.store.getFile(
            `${DEMO_REPO}@${SHA_1}`,
            'demo-project-1/environments/local/local.env.json',
          ),
        ).toBeDefined();
      },
    );

    it('row 3: and the file host fails too: jsDelivr at the remembered commit', async () => {
      await first(browser.load().getRawText(DEMO_ID, 'datatug-project.json'));
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.fail.api = 403;
      gh.fail.raw = 500;
      gh.reset();

      const reader = browser.load();
      await first(
        reader.getRawText(DEMO_ID, 'entities/Album/Album.entity.json'),
      );
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl(SHA_1, 'demo-project-1/entities/Album/Album.entity.json'),
        mirrorUrl(SHA_1, 'demo-project-1/entities/Album/Album.entity.json'),
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'remembered',
        fromMirror: true,
      });
    });

    it('row 4: refused, nothing remembered, the file host answers: raw at HEAD, kept in memory for this visit only', async () => {
      gh.fail.api = 403;
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toEqual({
        id: 'datatug-demo-project',
      });
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));

      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl('HEAD', 'demo-project-1/datatug-project.json'),
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'unresolved',
        commit: undefined,
        fromMirror: false,
        mayBeStale: true,
      });
      // Nothing in the persistent cache: no commit to key it by. A new visit, with the API still refusing, asks the
      // file host again (it would not if anything had been kept).
      gh.reset();
      await first(browser.load().getRawJson(DEMO_ID, 'datatug-project.json'));
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl('HEAD', 'demo-project-1/datatug-project.json'),
      ]);
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@HEAD`,
          'demo-project-1/datatug-project.json',
        ),
      ).toBeUndefined();
      expect(await browser.store.getResolved(`${DEMO_REPO}@HEAD`)).toBeUndefined();
    });

    it('row 5: refused, nothing remembered, the file host fails: jsDelivr with no version, the default branch, not kept', async () => {
      gh.fail.api = 429;
      gh.fail.raw = 'network';
      const reader = browser.load();
      expect(
        await first(reader.getRawText(DEMO_ID, 'datatug-project.json')),
      ).toBe('{"id":"datatug-demo-project"}');

      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl('HEAD', 'demo-project-1/datatug-project.json'),
        mirrorUrl(undefined, 'demo-project-1/datatug-project.json'),
      ]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'unresolved',
        fromMirror: true,
        mayBeStale: true,
      });
      // A new visit, the API still refusing and the file host still failing: asked again, nothing was kept.
      gh.reset();
      await first(browser.load().getRawText(DEMO_ID, 'datatug-project.json'));
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl('HEAD', 'demo-project-1/datatug-project.json'),
        mirrorUrl(undefined, 'demo-project-1/datatug-project.json'),
      ]);
      expect(await browser.store.getResolved(`${DEMO_REPO}@HEAD`)).toBeUndefined();
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@HEAD`,
          'demo-project-1/datatug-project.json',
        ),
      ).toBeUndefined();
    });

    it('row 6: all three fail: a failed step naming the hosts, and a later try asks again', async () => {
      gh.fail.api = 'network';
      gh.fail.raw = 'network';
      gh.fail.mirror = 500;
      const reader = browser.load();
      const error = await first(
        reader.getRawText(DEMO_ID, 'datatug-project.json'),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(GithubReadError);
      expect((error as GithubReadError).hosts).toEqual([
        'raw.githubusercontent.com',
        'cdn.jsdelivr.net',
      ]);
      expect((error as Error).message).toMatch(
        /raw\.githubusercontent\.com and cdn\.jsdelivr\.net did not answer/,
      );

      gh.fail.raw = undefined;
      expect(
        await first(reader.getRawText(DEMO_ID, 'datatug-project.json')),
      ).toContain('datatug-demo-project');
    });

    it('a refused resolve call does not stop the listing or the files: the listing of the remembered commit is cached', async () => {
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.fail.api = 403;
      gh.reset();

      const reader = browser.load();
      expect(
        (await first(reader.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album']);
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
      ]);
    });
  });

  describe('one commit for the listing and every file', () => {
    it('a push in the middle of a visit changes nothing of it; the next visit sees the new commit', async () => {
      const reader = browser.load();
      const before = await first(
        reader.getRawText(DEMO_ID, 'datatug-project.json'),
      );
      gh.push(
        DEMO_REPO,
        SHA_2,
        demoFiles({
          'demo-project-1/datatug-project.json': '{"id":"new"}',
          'demo-project-1/entities/Track/Track.entity.json': '{}',
        }),
      );
      // An optional file that is not there is probed in the middle of the visit: it is absent, and nothing moves.
      expect(
        await first(reader.getRawText(DEMO_ID, 'widgets/none.json')),
      ).toBeUndefined();
      const entities = (
        await first(reader.listDirectory(DEMO_ID, 'entities'))
      ).map((e) => e.name);
      const album = await first(
        reader.getRawText(DEMO_ID, 'entities/Album/Album.entity.json'),
      );

      expect(entities).toEqual(['Album']); // the listing of SHA_1, not of the push
      expect(before).toBe('{"id":"datatug-demo-project"}');
      expect(album).toBe('{}');
      for (const url of gh.urls('raw.githubusercontent.com')) {
        expect(url).toContain(`/${SHA_1}/`);
      }
      expect(gh.urls('api.github.com')).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        `https://api.github.com/repos/${DEMO_REPO}/git/trees/${SHA_1}?recursive=1`,
      ]);

      // A new visit, after the memory of the answer has expired.
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      const next = browser.load();
      expect(
        await first(next.getRawText(DEMO_ID, 'datatug-project.json')),
      ).toBe('{"id":"new"}');
      expect(
        (await first(next.listDirectory(DEMO_ID, 'entities'))).map(
          (e) => e.name,
        ),
      ).toEqual(['Album', 'Track']);
    });

    it('the project summary comes from the same commit as the rest (one read, one cache)', async () => {
      const reader = browser.load();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      const summary = await first(summaries.getProjectSummary(DEMO_ID));
      await first(reader.getRawJson(DEMO_ID, 'datatug-project.json'));

      expect(summary).toEqual({ id: DEMO_ID });
      expect(gh.urls('raw.githubusercontent.com')).toEqual([
        rawUrl(SHA_1, 'demo-project-1/datatug-project.json'),
      ]);
    });
  });

  describe('the resolve call, remembered for 5 minutes', () => {
    it('is not made again within 5 minutes, across visits; is made again after', async () => {
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      expect(gh.count('api.github.com')).toBe(2);

      browser.time += GITHUB_RESOLVE_TTL_MS - 1;
      gh.reset();
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      expect(gh.count()).toBe(0);

      browser.time += 2;
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      // The commit has not changed: only the question is asked; the listing is the cached one.
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
      ]);
    });

    it('is not trusted when the clock went backwards', async () => {
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      browser.time -= 60_000;
      gh.reset();
      await first(browser.load().listDirectory(DEMO_ID, 'entities'));
      expect(gh.urls('api.github.com')).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
      ]);
    });
  });

  describe('the commit of an address (design 3.6, point 3)', () => {
    beforeEach(() => {
      gh.push(DEMO_REPO, SHA_2, demoFiles({ 'demo-project-1/datatug-project.json': '{"id":"demo-old"}' }));
      gh.push(DEMO_REPO, fakeSha(0x333), demoFiles({ 'demo-project-1/datatug-project.json': '{"id":"demo-new"}' }));
    });

    it('a trusted project reads the commit GitHub resolves for the default branch now', async () => {
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toEqual({ id: 'demo-new' });
      expect(gh.urls()).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        rawUrl(fakeSha(0x333), 'demo-project-1/datatug-project.json'),
      ]);
    });

    it('the same repository at a commit of the address is not a trusted project: that commit is read, no resolve call', async () => {
      // What guarantees it: no address with a ref other than HEAD is trusted (`isTrustedGithubProject`), so a commit in
      // an id is only ever read for a project that is not trusted.
      expect(
        isTrustedProjectAddress({
          storeId: GITHUB_STORE_ID,
          projectId: `${DEMO_ID}@${SHA_2}`,
        }),
      ).toBe(false);
      expect(
        isTrustedProjectAddress({
          storeId: GITHUB_STORE_ID,
          projectId: DEMO_ID,
        }),
      ).toBe(true);
      const reader = browser.load();
      expect(
        await first(
          reader.getRawJson(`${DEMO_ID}@${SHA_2}`, 'datatug-project.json'),
        ),
      ).toEqual({
        id: 'demo-old',
      });
      expect(gh.urls()).toEqual([
        rawUrl(SHA_2, 'demo-project-1/datatug-project.json'),
      ]);
      expect(
        await first(reader.readInfo(`${DEMO_ID}@${SHA_2}`)),
      ).toMatchObject({ state: 'given', commit: SHA_2 });
    });

    it('a 40-character commit in an id is read in lower case', async () => {
      const upper = SHA_2.replace(/[a-f]/g, (c) => c.toUpperCase());
      const reader = browser.load();
      await first(
        reader.getRawJson(`${DEMO_ID}@${upper}`, 'datatug-project.json'),
      );
      expect(gh.urls()).toEqual([
        rawUrl(SHA_2, 'demo-project-1/datatug-project.json'),
      ]);
    });

    it('a trusted project asks GitHub again once the remembered answer is older than 5 minutes', async () => {
      await first(
        browser.load().getRawJson(DEMO_ID, 'datatug-project.json'),
      );
      browser.time += GITHUB_RESOLVE_TTL_MS + 1;
      gh.reset();
      await first(
        browser.load().getRawJson(DEMO_ID, 'datatug-project.json'),
      );
      expect(gh.urls()[0]).toBe(
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
      );
    });
  });

  describe('requests: what is sent and what is refused (design 3.6)', () => {
    it('every request omits credentials, sends no referrer, and only the resolve and listing calls may see a redirect', async () => {
      const reader = browser.load();
      gh.fail.raw = 500; // so the mirror is used too
      await readLikeThePages(reader, DEMO_ID, false);

      expect(gh.requests.length).toBeGreaterThan(5);
      const hosts = new Set(gh.requests.map((r) => r.host));
      expect([...hosts].sort()).toEqual([
        'api.github.com',
        'cdn.jsdelivr.net',
        'raw.githubusercontent.com',
      ]);
      for (const { url, init, host } of gh.requests) {
        expect(url.startsWith('https://')).toBe(true);
        expect(new URL(url).username).toBe('');
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('omit');
        expect(init.referrerPolicy).toBe('no-referrer');
        // A redirect is never followed: an error on the file hosts, handed back (to be refused) by the API.
        expect(init.redirect).toBe(
          host === 'api.github.com' ? 'manual' : 'error',
        );
        // No custom request header but `Accept` (raw.githubusercontent.com answers a preflight with 403).
        expect(
          Object.keys((init.headers as Record<string, string>) ?? {}),
        ).toEqual(url.includes('/commits/') ? ['Accept'] : []);
      }
    });

    it('a renamed or moved repository (the API answers a redirect) is "No DataTug project here", and nothing is read from a file host', async () => {
      gh.fail.api = 'redirect';
      const reader = browser.load();
      expect(
        await first(reader.getRawJson(DEMO_ID, 'datatug-project.json')),
      ).toBeUndefined();
      expect(await first(reader.listDirectory(DEMO_ID, ''))).toEqual([]);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'moved',
        commit: undefined,
      });
      expect(gh.count('raw.githubusercontent.com')).toBe(0);
      expect(gh.count('cdn.jsdelivr.net')).toBe(0);

      const summaries = TestBed.inject(DatatugStoreGithubService);
      const error = await first(summaries.getProjectSummary(DEMO_ID)).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(GithubProjectNotFoundError);
      expect((error as GithubProjectNotFoundError).reason).toBe('moved');
    });

    it('a repository or ref that does not exist is "No DataTug project here" too', async () => {
      const reader = browser.load();
      expect(
        await first(reader.getRawJson('nope@datatug@', 'datatug-project.json')),
      ).toBeUndefined();
      const summaries = TestBed.inject(DatatugStoreGithubService);
      const error = await first(
        summaries.getProjectSummary('nope@datatug@'),
      ).catch((e) => e);
      expect((error as GithubProjectNotFoundError).reason).toBe('missing');
      expect(gh.count('raw.githubusercontent.com')).toBe(0);
    });

    it('a redirect from a file host is a failure of that host (the mirror is tried), never followed', async () => {
      gh.fail.raw = 'redirect';
      const reader = browser.load();
      await first(reader.getRawText(DEMO_ID, 'datatug-project.json'));
      expect(gh.urls('cdn.jsdelivr.net')).toEqual([
        mirrorUrl(SHA_1, 'demo-project-1/datatug-project.json'),
      ]);
    });
  });

  describe('limits (design 3.6)', () => {
    it('a project file of exactly 256 KB is read; one byte more is refused, without asking the mirror', async () => {
      gh.push(
        DEMO_REPO,
        SHA_2,
        demoFiles({
          'demo-project-1/exact.txt': 'a'.repeat(MAX_PROJECT_FILE_BYTES),
          'demo-project-1/over.txt': 'a'.repeat(MAX_PROJECT_FILE_BYTES + 1),
        }),
      );
      const reader = browser.load();
      expect(
        (await first(reader.getRawText(DEMO_ID, 'exact.txt')))?.length,
      ).toBe(MAX_PROJECT_FILE_BYTES);
      const error = await first(reader.getRawText(DEMO_ID, 'over.txt')).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(GithubFileTooLargeError);
      expect((error as Error).message).toBe(
        'demo-project-1/over.txt is larger than 256 KB, so DataTug does not read it.',
      );
      expect(gh.count('cdn.jsdelivr.net')).toBe(0);
      // Not kept.
      expect(
        await browser.store.getFile(
          `${DEMO_REPO}@${SHA_2}`,
          'demo-project-1/over.txt',
        ),
      ).toBeUndefined();
    });

    it('at most 40 distinct files per run; a file read again counts once; the cache does not exempt a run', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 45; i++) {
        files[`demo-project-1/f${i}.json`] = '{}';
      }
      gh.push(DEMO_REPO, SHA_2, files);
      const reader = browser.load();
      const budget = new GithubReadBudget();
      for (let i = 0; i < 40; i++) {
        await first(reader.getRawJson(DEMO_ID, `f${i}.json`, { budget }));
      }
      await first(reader.getRawJson(DEMO_ID, 'f0.json', { budget })); // again: still 40
      expect(budget.used).toBe(40);
      const error = await first(
        reader.getRawJson(DEMO_ID, 'f40.json', { budget }),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(GithubReadLimitError);
      // A run on a warm cache is held to it too.
      const warm = new GithubReadBudget(2);
      await first(reader.getRawJson(DEMO_ID, 'f1.json', { budget: warm }));
      await first(reader.getRawText(DEMO_ID, 'f2.json', { budget: warm }));
      const third = await first(
        reader.getRawText(DEMO_ID, 'f3.json', { budget: warm }),
      ).catch((e) => e);
      expect(third).toBeInstanceOf(GithubReadLimitError);
      expect(gh.urls('raw.githubusercontent.com')).not.toContain(
        rawUrl(SHA_2, 'demo-project-1/f40.json'),
      );
    });
  });

  describe('the cache and the request budget (design 4.3, 4.5; 60 anonymous API calls per hour per address)', () => {
    it('the demo project of the home page: a cold visit and a warm one', async () => {
      const cold = browser.load();
      await readLikeThePages(cold);
      const coldRequests = gh.countByHost();
      // One call to resolve the commit, one for the listing: 2 of the 60 per hour (today: 1, for the listing).
      expect(coldRequests['api.github.com']).toBe(2);
      expect(coldRequests['cdn.jsdelivr.net']).toBeUndefined();
      expect(gh.urls('api.github.com')).toEqual([
        `https://api.github.com/repos/${DEMO_REPO}/commits/HEAD`,
        `https://api.github.com/repos/${DEMO_REPO}/git/trees/${SHA_1}?recursive=1`,
      ]);
      // Each file once: the same count as before, plus the resolve call.
      const files = gh.urls('raw.githubusercontent.com');
      expect(new Set(files).size).toBe(files.length);

      // The same browser, a new visit within 5 minutes: nothing is asked of anyone (absent files included).
      gh.reset();
      browser.time += 60_000;
      await readLikeThePages(browser.load());
      expect(gh.count()).toBe(0);

      // Later, the project has not changed: one call, the question; no file, no listing.
      browser.time += GITHUB_RESOLVE_TTL_MS;
      await readLikeThePages(browser.load());
      expect(gh.countByHost()).toEqual({ 'api.github.com': 1 });

      // The project has changed: the question, the listing, the files that are read.
      gh.push(
        DEMO_REPO,
        SHA_2,
        demoFiles({ 'demo-project-1/datatug-project.json': '{"id":"v2"}' }),
      );
      gh.reset();
      browser.time += GITHUB_RESOLVE_TTL_MS;
      await readLikeThePages(browser.load());
      expect(gh.countByHost()).toEqual({
        'api.github.com': 2,
        'raw.githubusercontent.com': files.length,
      });
    });

    it('the demo repository at the root, the files a cold run needs (4.3): within the budget of 4.3, then none', async () => {
      const files: Record<string, string> = {
        'datatug-project.json': '{}',
        'ai/prepared-questions.json': '{}',
        'queries/sales/chinook-sales-per-capita.query.json': '{}',
        'queries/sales/chinook-sales-per-capita.query.dtql': 'x',
        'environments/web/web.env.json': '{}',
        'environments/web/catalogs/chinook/chinook.db.json': '{}',
        'environments/web/catalogs/geo/geo.db.json': '{}',
        'entities/Country/Country.entity.json': '{}',
        'data/geo/country_aliases.json': '[]',
        'data/geo/population_wb.json': '[]',
      };
      for (const t of [
        'Album',
        'Artist',
        'Customer',
        'Employee',
        'Genre',
        'Invoice',
        'InvoiceLine',
        'MediaType',
        'Playlist',
        'PlaylistTrack',
        'Track',
      ]) {
        files[`dbmodels/chinook/main/tables/${t}/main.${t}.columns.json`] =
          '{}';
      }
      gh.addRepo(CHINOOK_REPO, SHA_1, files);
      const reader = browser.load();
      const budget = new GithubReadBudget();
      for (const path of Object.keys(files)) {
        await first(reader.getRawText(CHINOOK_ID, path, { budget }));
      }
      await first(reader.listDirectory(CHINOOK_ID, 'environments'));

      const cold = gh.countByHost();
      // Design 4.3: at most 2 calls to api.github.com (the resolve, and at most one listing) and at most 26 to the
      // file host, none to anything else.
      expect(cold['api.github.com']).toBe(2);
      expect(cold['raw.githubusercontent.com']).toBe(21);
      expect(Object.keys(cold).sort()).toEqual([
        'api.github.com',
        'raw.githubusercontent.com',
      ]);

      gh.reset();
      const warm = browser.load();
      for (const path of Object.keys(files)) {
        await first(warm.getRawText(CHINOOK_ID, path));
      }
      await first(warm.listDirectory(CHINOOK_ID, 'environments'));
      expect(gh.count()).toBe(0);
    });
  });

  describe('storage that is blocked or full is no cache, not a failure', () => {
    it('reads with no cache when the store does nothing', async () => {
      const reader = browser.load({
        getFile: () => Promise.reject(new Error('blocked')),
        putFile: () => Promise.reject(new Error('blocked')),
        getResolved: () => Promise.reject(new Error('blocked')),
        putResolved: () => Promise.reject(new Error('blocked')),
        dropResolved: () => Promise.reject(new Error('blocked')),
        forgetResolved: () => Promise.reject(new Error('blocked')),
      });
      await readLikeThePages(reader);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
        commit: SHA_1,
      });
    });

    it('reads with no cache when IndexedDB refuses to open', async () => {
      const refusing = {
        open: () => {
          throw new Error('SecurityError');
        },
      } as unknown as IDBFactory;
      const reader = browser.load(
        openGithubFileStore(refusing, () => browser.time),
      );
      await readLikeThePages(reader);
      expect(await first(reader.readInfo(DEMO_ID))).toMatchObject({
        state: 'resolved',
      });
    });

    it('reads with no cache when there is no IndexedDB at all', async () => {
      const reader = browser.load(
        openGithubFileStore(undefined, () => browser.time),
      );
      await readLikeThePages(reader);
      expect(gh.count()).toBeGreaterThan(0);
    });
  });
});

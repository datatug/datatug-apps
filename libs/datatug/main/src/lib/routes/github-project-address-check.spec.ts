import { TestBed } from '@angular/core/testing';
import { from, NEVER, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatatugStoreGithubService } from '../services/repo/datatug-store.service.github';
import {
  GITHUB_FETCH,
  GithubProjectNotFoundError,
} from '../services/repo/github/github-project-reader.service';
import {
  GithubAddressCheck,
  GITHUB_PROBE_TIMEOUT_MS,
  GITHUB_PROBE_TIMER,
  GithubAddressNotices,
  GithubDefaultBranchLookup,
  readShortGithubAddress,
} from './github-project-address-check';

// Design `demo-as-github-project.md` 3.3 (the id), 3.4a (one canonical address per project, and what is not
// supported) and the default-branch lookup, as the short project route uses them.

const segs = (path: string): string[] =>
  path
    .split('/')
    .filter((s) => s !== '')
    .map((s) => decodeURIComponent(s));

describe('readShortGithubAddress: the table of design 3.3', () => {
  it.each([
    // [path, projectId, locator segments]
    ['/project/github.com/datatug/chinook-demo', 'chinook-demo@datatug@', 4],
    [
      '/project/github.com/datatug/chinook-demo/chat',
      'chinook-demo@datatug@',
      4,
    ],
    [
      '/project/github.com/datatug/chinook-demo/queries/a',
      'chinook-demo@datatug@',
      4,
    ],
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1',
      'r@o@demo-project-1',
      7,
    ],
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/chat',
      'r@o@demo-project-1',
      8,
    ],
    ['/project/github.com/o/r/tree/HEAD/a/b/-/queries/x/y', 'r@o@a/b', 9],
    ['/project/github.com/o/r/tree/v1.0.0', 'r@o@@v1.0.0', 6],
    ['/project/github.com/o/r/tree/v1.0.0/-/chat', 'r@o@@v1.0.0', 7],
    ['/project/github.com/o/r/tree/HEAD/datatug', 'r@o', 7],
    ['/project/github.com/o/r/tree/HEAD/datatug/-/chat', 'r@o', 8],
    ['/project/github.com/o/r/tree/feat/dir', 'r@o@dir@feat', 7],
    ['/project/github.com/Datatug/Chinook-Demo', 'chinook-demo@datatug@', 4],
    ['/project/github.com/o/r.git', 'r@o@', 4],
    ['/project/github.com/o/r/tree/HEAD', 'r@o@', 6],
    [
      '/project/github.com/o/r/blob/main/dir/datatug-project.json',
      'r@o@dir@main',
      8,
    ],
    // a repository called like a page
    ['/project/github.com/o/chat', 'chat@o@', 4],
    ['/project/github.com/o/tree', 'tree@o@', 4],
    ['/project/github.com/chat/chat/chat', 'chat@chat@', 4],
  ])(
    '%s is the project %s, with %i locator segments',
    (path, projectId, locatorLength) => {
      const result = readShortGithubAddress(segs(path));
      expect(result).toMatchObject({ kind: 'project', locatorLength });
      if (result.kind === 'project') {
        expect(result.parts.storeId).toBe('github.com');
        expect(result.parts.projectId).toBe(projectId);
      }
    },
  );

  it('is not about any other address', () => {
    for (const path of [
      '/',
      '/store/github.com/project/r@o@',
      '/projects/github.com/o/r',
      '/project/gitlab.com/o/r',
      '/project',
      '/Project',
    ]) {
      expect(readShortGithubAddress(segs(path)), path).toEqual({
        kind: 'not-short-github',
      });
    }
  });

  it.each([
    // [path, why]: the unsupported inputs of design 3.4a, and the addresses that are no project at all
    ['/project/github.com/o/r/blob/main/dir/file.txt', 'file-link'],
    ['/project/github.com/o/r/blob/main', 'file-link'],
    ['/project/github.com/o/r/blob', 'file-link'],
    ['/project/github.com/o/r/tree', 'missing-ref'],
    ['/project/github.com/o/r/tree/main/a@b', 'at-sign-not-supported'],
    ['/project/github.com/o/r/tree/ma@in', 'at-sign-not-supported'],
    [
      '/project/github.com/o/r/blob/main/a/-/datatug-project.json',
      'dash-directory-not-supported',
    ],
    ['/project/github.com/o/r/-', 'invalid-path-segment'],
    ['/project/github.com/o/r/tree/HEAD/a/../b', 'invalid-path-segment'],
    ['/project/github.com/o/r/chat/..', 'invalid-path-segment'],
    ['/project/github.com', 'not-a-project-address'],
    ['/project/github.com/o', 'not-a-project-address'],
    ['/project/github.com/o_x/r', 'invalid-owner-or-repo'],
    ['/project/github.com/o/r.git.git', 'invalid-owner-or-repo'],
    ['/project/github.com/o/chinoo\u212A-demo', 'invalid-owner-or-repo'],
    ['/project/github.com/o/chinoo%E2%84%AA-demo', 'invalid-owner-or-repo'],
  ])('%s is refused (%s)', (path, reason) => {
    expect(readShortGithubAddress(segs(path))).toEqual({
      kind: 'refused',
      reason,
    });
  });

  it('refuses a directory segment named "-": the first "-" ends the locator, so the rest reads as a page', () => {
    // `…/tree/HEAD/a/-/b` is the page `b` of the project in `a`; a folder named `-` cannot be written.
    expect(
      readShortGithubAddress(segs('/project/github.com/o/r/tree/HEAD/a/-/b')),
    ).toMatchObject({
      kind: 'project',
      locatorLength: 8,
    });
  });

  // B1 of the review of G-A1b: the fixed segments of a short address (`project`, `github.com`, `tree`, the first
  // page) match in any letter case, as the hand-off route's matcher and index.html's script do, and the address is
  // another spelling of the canonical one (so it redirects), never an address that matches no route.
  describe('the fixed segments in any letter case are another spelling of the canonical address', () => {
    it.each([
      [
        '/Project/GitHub.com/datatug/chinook-demo/Chat',
        '/project/github.com/datatug/chinook-demo/chat',
        4,
      ],
      [
        '/PROJECT/GITHUB.COM/datatug/chinook-demo/chat',
        '/project/github.com/datatug/chinook-demo/chat',
        4,
      ],
      [
        '/project/github.com/datatug/chinook-demo/Chat',
        '/project/github.com/datatug/chinook-demo/chat',
        4,
      ],
      [
        '/project/github.com/datatug/chinook-demo/Tree/HEAD/-/chat',
        '/project/github.com/datatug/chinook-demo/chat',
        7,
      ],
      [
        '/project/github.com/o/r/TREE/v1.0.0/-/CHAT',
        '/project/github.com/o/r/tree/v1.0.0/-/chat',
        7,
      ],
      [
        '/project/github.com/o/r/Tree/HEAD/Dir/-/Queries/Sub',
        '/project/github.com/o/r/tree/HEAD/Dir/-/queries/Sub',
        8,
      ],
      ['/Project/github.com/o/r/Queries', '/project/github.com/o/r/queries', 4],
      ['/project/GitHub.com/o/r', '/project/github.com/o/r', 4],
    ])('%s -> %s', (typed, canonical, locatorLength) => {
      const result = readShortGithubAddress(segs(typed));
      expect(result).toMatchObject({ kind: 'project', locatorLength });
      if (result.kind === 'project') {
        expect(result.parts.isCanonical).toBe(false);
        expect(result.parts.canonicalPath).toBe(canonical);
      }
    });

    it('only the first page segment is lower-cased: what follows it is left as typed', () => {
      const result = readShortGithubAddress(
        segs('/project/github.com/o/r/queries/ABC/Def'),
      );
      expect(result).toMatchObject({ kind: 'project' });
      if (result.kind === 'project') {
        expect(result.parts.isCanonical).toBe(true);
        expect(result.parts.rest).toBe('/queries/ABC/Def');
      }
    });

    it('a lower-case address is canonical, as before', () => {
      const result = readShortGithubAddress(
        segs('/project/github.com/datatug/chinook-demo/chat'),
      );
      expect(result).toMatchObject({
        kind: 'project',
        parts: { isCanonical: true },
      });
    });

    it('a repository called like a fixed segment is still a repository: `Tree` and `Chat` in the repo place are names', () => {
      const result = readShortGithubAddress(
        segs('/project/github.com/o/Tree/Chat'),
      );
      expect(result).toMatchObject({ kind: 'project', locatorLength: 4 });
      if (result.kind === 'project') {
        expect(result.parts.projectId).toBe('tree@o@');
        expect(result.parts.canonicalPath).toBe(
          '/project/github.com/o/tree/chat',
        );
      }
    });
  });

  it('reads an encoded slash in a page as part of one segment', () => {
    const result = readShortGithubAddress([
      'project',
      'github.com',
      'o',
      'r',
      'query',
      'a/b',
    ]);
    expect(result).toMatchObject({ kind: 'project', locatorLength: 4 });
  });
});

describe('GithubDefaultBranchLookup', () => {
  const answer = (init: () => Response | Promise<Response>) => {
    const fetchFn = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => init());
    TestBed.configureTestingModule({
      providers: [{ provide: GITHUB_FETCH, useValue: fetchFn }],
    });
    return { fetchFn, lookup: TestBed.inject(GithubDefaultBranchLookup) };
  };
  const json = (body: unknown, status = 200) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    });

  it('reads default_branch from the repository, with no credentials and no redirect followed', async () => {
    const { fetchFn, lookup } = answer(() =>
      json({ id: 1, default_branch: 'trunk' }),
    );
    expect(await lookup.lookup('o', 'r')).toEqual({
      kind: 'found',
      branch: 'trunk',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit' });
  });

  it('asks once per repository, whatever the answer', async () => {
    const { fetchFn, lookup } = answer(() => json({ default_branch: 'main' }));
    await Promise.all([lookup.lookup('o', 'r'), lookup.lookup('o', 'r')]);
    await lookup.lookup('o', 'r');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await lookup.lookup('o', 'other');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a missing repository', () => json('nf', 404), 'absent'],
    ['a gone repository', () => json('gone', 410), 'absent'],
    [
      'a moved repository (a redirect)',
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://x/' },
        }),
      'absent',
    ],
    ['a rate limit (403)', () => json('limit', 403), 'refused'],
    ['a rate limit (429)', () => json('limit', 429), 'refused'],
    ['a server error', () => json('boom', 500), 'refused'],
    ['an answer that is not JSON', () => json('<html>'), 'refused'],
    ['an answer with no default_branch', () => json({ id: 1 }), 'refused'],
    [
      'an answer with a default_branch that is not text',
      () => json({ default_branch: 7 }),
      'refused',
    ],
    ['an empty default_branch', () => json({ default_branch: '' }), 'refused'],
    [
      'a network failure',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'refused',
    ],
  ])('%s is %s', async (_name, init, kind) => {
    const { lookup } = answer(init);
    expect((await lookup.lookup('o', 'r')).kind).toBe(kind);
  });

  it('refuses an answer larger than the cap, checked on the bytes received', async () => {
    const { lookup } = answer(() =>
      json({ default_branch: 'main', pad: 'x'.repeat(300 * 1024) }),
    );
    expect((await lookup.lookup('o', 'r')).kind).toBe('refused');
  });
});

describe('GithubAddressCheck.decide', () => {
  let branch: ReturnType<typeof vi.fn>;
  let notice: ReturnType<typeof vi.fn>;
  let summary: ReturnType<typeof vi.fn>;

  /** The probe's timer, stood in for: `fireTimeout()` is the moment the time is up. */
  let timerCalls: number[];
  let fireTimeout: () => void;

  const check = (
    lookupResult: unknown = { kind: 'found', branch: 'main' },
    summaryResult: () => unknown = () => of({ id: 'x' }),
  ) => {
    timerCalls = [];
    const timeUp = new Promise<void>((resolve) => (fireTimeout = resolve));
    branch = vi.fn(async () => lookupResult);
    notice = vi.fn();
    summary = vi.fn(summaryResult);
    TestBed.configureTestingModule({
      providers: [
        { provide: GithubDefaultBranchLookup, useValue: { lookup: branch } },
        {
          provide: GithubAddressNotices,
          useValue: { defaultBranchUnknown: notice },
        },
        {
          provide: DatatugStoreGithubService,
          useValue: { getProjectSummary: summary },
        },
        {
          provide: GITHUB_PROBE_TIMER,
          useValue: (ms: number) => {
            timerCalls.push(ms);
            return timeUp;
          },
        },
      ],
    });
    return TestBed.inject(GithubAddressCheck);
  };

  beforeEach(() => TestBed.resetTestingModule());

  describe('canonicalisation: every spelling of an address redirects to the one canonical address', () => {
    it.each([
      // [typed, canonical]
      [
        '/project/github.com/Datatug/Chinook-Demo',
        '/project/github.com/datatug/chinook-demo',
      ],
      [
        '/project/github.com/DATATUG/CHINOOK-DEMO/chat',
        '/project/github.com/datatug/chinook-demo/chat',
      ],
      ['/project/github.com/o/r.git', '/project/github.com/o/r'],
      ['/project/github.com/o/R.GIT/chat', '/project/github.com/o/r/chat'],
      ['/project/github.com/o/r/tree/HEAD', '/project/github.com/o/r'],
      [
        '/project/github.com/o/r/tree/HEAD/-/chat',
        '/project/github.com/o/r/chat',
      ],
      [
        '/project/github.com/o/r/tree/HEAD/-/queries/a',
        '/project/github.com/o/r/queries/a',
      ],
      [
        '/project/github.com/o/r/blob/v1/dir/datatug-project.json',
        '/project/github.com/o/r/tree/v1/dir',
      ],
      [
        '/project/github.com/o/r/blob/HEAD/dir/datatug-project.json',
        '/project/github.com/o/r/tree/HEAD/dir',
      ],
      [
        '/project/github.com/O/r/blob/HEAD/datatug-project.json',
        '/project/github.com/o/r',
      ],
      [
        '/project/github.com/o/r/tree/HEAD/datatug/-/chat',
        '/project/github.com/o/r/tree/HEAD/datatug/-/chat',
      ],
    ])('%s', async (typed, canonical) => {
      const decision = await check().decide(segs(typed));
      if (typed === canonical) {
        expect(decision).toEqual({ kind: 'open' });
      } else {
        expect(decision).toEqual({ kind: 'redirect', path: canonical });
      }
      // nothing is asked of GitHub before the address is canonical
      expect(branch).not.toHaveBeenCalled();
      if (typed !== canonical) {
        expect(summary).not.toHaveBeenCalled();
      }
    });

    it('the redirect target is itself canonical: it opens, it does not redirect again', async () => {
      for (const typed of [
        '/project/github.com/Datatug/Chinook-Demo/chat',
        '/project/github.com/o/r.git',
        '/project/github.com/o/r/tree/HEAD/-/chat',
        '/project/github.com/o/r/blob/v1/dir/datatug-project.json',
      ]) {
        TestBed.resetTestingModule();
        const first = await check().decide(segs(typed));
        expect(first.kind).toBe('redirect');
        if (first.kind === 'redirect') {
          TestBed.resetTestingModule();
          expect(
            (await check().decide(segs(first.path))).kind,
            first.path,
          ).toBe('open');
        }
      }
    });
  });

  describe('a branch, tag or commit: the default branch is always spelled HEAD', () => {
    it.each([
      ['main', '/project/github.com/o/r/tree/main', '/project/github.com/o/r'],
      [
        'main',
        '/project/github.com/o/r/tree/main/-/chat',
        '/project/github.com/o/r/chat',
      ],
      [
        'main',
        '/project/github.com/o/r/tree/main/demo-project-1',
        '/project/github.com/o/r/tree/HEAD/demo-project-1',
      ],
      [
        'main',
        '/project/github.com/o/r/tree/main/a/b/-/queries/x',
        '/project/github.com/o/r/tree/HEAD/a/b/-/queries/x',
      ],
      [
        'trunk',
        '/project/github.com/o/r/tree/trunk/datatug',
        '/project/github.com/o/r/tree/HEAD/datatug',
      ],
    ])(
      '%s is the default branch: %s redirects to %s',
      async (name, typed, canonical) => {
        const decision = await check({ kind: 'found', branch: name }).decide(
          segs(typed),
        );
        expect(decision).toEqual({ kind: 'redirect', path: canonical });
        expect(branch).toHaveBeenCalledWith('o', 'r');
        expect(notice).not.toHaveBeenCalled();
      },
    );

    it.each([
      '/project/github.com/o/r/tree/v1.0.0',
      '/project/github.com/o/r/tree/v1.0.0/-/chat',
      '/project/github.com/o/r/tree/develop/dir',
      '/project/github.com/o/r/tree/0123456789abcdef0123456789abcdef01234567',
    ])(
      '%s is another version of the project: its own id, nothing to replace',
      async (typed) => {
        expect(
          await check({ kind: 'found', branch: 'main' }).decide(segs(typed)),
        ).toEqual({ kind: 'open' });
        expect(summary).toHaveBeenCalledTimes(1);
        expect(notice).not.toHaveBeenCalled();
      },
    );

    it('a ref is compared with the name as GitHub spells it, letter case included', async () => {
      expect(
        await check({ kind: 'found', branch: 'Main' }).decide(
          segs('/project/github.com/o/r/tree/main'),
        ),
      ).toEqual({ kind: 'open' });
    });

    it('the lookup is made only when the address names a ref', async () => {
      const c = check();
      for (const typed of [
        '/project/github.com/o/r',
        '/project/github.com/o/r/chat',
        '/project/github.com/o/r/tree/HEAD/dir',
        '/project/github.com/o/r/tree/HEAD/dir/-/chat',
      ]) {
        await c.decide(segs(typed));
      }
      expect(branch).not.toHaveBeenCalled();
    });

    it('when the lookup is refused, the address is left as typed, the visit is told, and the project still opens', async () => {
      const decision = await check({ kind: 'refused' }).decide(
        segs('/project/github.com/o/r/tree/main/dir'),
      );
      expect(decision).toEqual({ kind: 'open' });
      expect(notice).toHaveBeenCalledTimes(1);
      expect(notice).toHaveBeenCalledWith('o', 'r', 'main');
      expect(summary).toHaveBeenCalledWith('r@o@dir@main');
    });

    it('the toast of a refused lookup is shown once per repository and ref for the life of the page, not on every navigation (review minor 1)', async () => {
      const c = check({ kind: 'refused' });
      for (const typed of [
        '/project/github.com/o/r/tree/main/dir/-/chat',
        '/project/github.com/o/r/tree/main/dir/-/queries',
        '/project/github.com/o/r/tree/main/other',
      ]) {
        expect(await c.decide(segs(typed))).toEqual({ kind: 'open' });
      }
      expect(notice).toHaveBeenCalledTimes(1);
      expect(notice).toHaveBeenCalledWith('o', 'r', 'main');
      await c.decide(segs('/project/github.com/o/r/tree/develop'));
      await c.decide(segs('/project/github.com/o/other/tree/main'));
      expect(notice.mock.calls).toEqual([
        ['o', 'r', 'main'],
        ['o', 'r', 'develop'],
        ['o', 'other', 'main'],
      ]);
    });

    it('when the repository is not there, there is nothing to warn about: the missing project is what is shown', async () => {
      const decision = await check({ kind: 'absent' }, () =>
        throwError(
          () => new GithubProjectNotFoundError('r@o@@main', 'missing'),
        ),
      ).decide(segs('/project/github.com/o/r/tree/main'));
      expect(decision.kind).toBe('problem');
      expect(notice).not.toHaveBeenCalled();
    });
  });

  describe('what is not supported, and what the visitor is told instead of a broken page', () => {
    it.each([
      [
        'a link to a file',
        '/project/github.com/o/r/blob/main/dir/file.txt',
        'file-link',
      ],
      [
        '"@" in a directory',
        '/project/github.com/o/r/tree/HEAD/a@b',
        'at-sign-not-supported',
      ],
      [
        '"@" in a ref',
        '/project/github.com/o/r/tree/a@b',
        'at-sign-not-supported',
      ],
      [
        'a directory named "-"',
        '/project/github.com/o/r/blob/main/a/-/datatug-project.json',
        'dash-directory-not-supported',
      ],
      ['a tree with no ref', '/project/github.com/o/r/tree', 'missing-ref'],
      [
        'a name GitHub does not allow',
        '/project/github.com/o/r!',
        'invalid-owner-or-repo',
      ],
      [
        'a ".." segment',
        '/project/github.com/o/r/tree/HEAD/a/../b',
        'invalid-path-segment',
      ],
      ['no repository', '/project/github.com/o', 'not-a-project-address'],
    ])(
      '%s: the page says so, and nothing is asked of GitHub',
      async (_name, typed, reason) => {
        const decision = await check().decide(segs(typed));
        expect(decision).toEqual({
          kind: 'problem',
          problem: { kind: 'unsupported', reason },
        });
        expect(branch).not.toHaveBeenCalled();
        expect(summary).not.toHaveBeenCalled();
      },
    );
  });

  describe('a repository with no project file at the address', () => {
    it.each([
      [
        'the root',
        '/project/github.com/o/r',
        { owner: 'o', repo: 'r', folder: '' },
      ],
      [
        'a folder',
        '/project/github.com/o/r/tree/HEAD/dir/sub',
        { owner: 'o', repo: 'r', folder: 'dir/sub' },
      ],
      [
        'a tag',
        '/project/github.com/o/r/tree/v1',
        { owner: 'o', repo: 'r', folder: '', ref: 'v1' },
      ],
      [
        'a first part that is a branch of the name feature/x: read as the ref `feature` and the folder `x`',
        '/project/github.com/o/r/tree/feature/x',
        { owner: 'o', repo: 'r', folder: 'x', ref: 'feature' },
      ],
    ])('%s: "No DataTug project here"', async (_name, typed, where) => {
      const decision = await check({ kind: 'found', branch: 'main' }, () =>
        throwError(() => new GithubProjectNotFoundError('x', 'missing')),
      ).decide(segs(typed));
      expect(decision).toEqual({
        kind: 'problem',
        problem: { kind: 'not-found', moved: false, ...where },
      });
    });

    it('a renamed or moved repository (GitHub answers with a redirect) is said to have moved', async () => {
      const decision = await check(undefined, () =>
        throwError(() => new GithubProjectNotFoundError('x', 'moved')),
      ).decide(segs('/project/github.com/o/r'));
      expect(decision).toMatchObject({
        kind: 'problem',
        problem: { kind: 'not-found', moved: true },
      });
    });

    it('is asked again on the next navigation, so a project created in the meantime opens', async () => {
      let exists = false;
      const c = check(undefined, () =>
        exists
          ? of({ id: 'x' })
          : throwError(() => new GithubProjectNotFoundError('x', 'missing')),
      );
      expect((await c.decide(segs('/project/github.com/o/r'))).kind).toBe(
        'problem',
      );
      exists = true;
      expect((await c.decide(segs('/project/github.com/o/r'))).kind).toBe(
        'open',
      );
    });
  });

  describe('a project that is there', () => {
    it('opens, and is not asked about again on later navigations inside it', async () => {
      const c = check();
      for (const typed of [
        '/project/github.com/o/r',
        '/project/github.com/o/r/chat',
        '/project/github.com/o/r/queries',
      ]) {
        expect(await c.decide(segs(typed))).toEqual({ kind: 'open' });
      }
      expect(summary).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledWith('r@o@');
    });

    it('is asked about once per project id', async () => {
      const c = check();
      await c.decide(segs('/project/github.com/o/r'));
      await c.decide(segs('/project/github.com/o/r/tree/HEAD/dir'));
      await c.decide(segs('/project/github.com/o/r/tree/v1'));
      expect(summary.mock.calls.map((call) => call[0])).toEqual([
        'r@o@',
        'r@o@dir',
        'r@o@@v1',
      ]);
    });

    it.each([
      ['a rate limit', new Error('rate limited')],
      ['a network error', new TypeError('Failed to fetch')],
    ])(
      'opens when the read fails for another reason than "not found" (%s): the pages show their own error',
      async (_name, err) => {
        const c = check(undefined, () => throwError(() => err));
        expect(await c.decide(segs('/project/github.com/o/r'))).toEqual({
          kind: 'open',
        });
        // an inconclusive read is not repeated on every navigation either
        await c.decide(segs('/project/github.com/o/r/chat'));
        expect(summary).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('GitHub that does not answer must not leave a blank page (review minor 2)', () => {
    it('the time allowed is a short, named one', () => {
      expect(GITHUB_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
      expect(GITHUB_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(4000);
    });

    it('a probe that is still waiting when the time is up lets the project open, and is not repeated on the next navigation', async () => {
      const c = check(undefined, () => NEVER);
      const deciding = c.decide(segs('/project/github.com/o/r'));
      fireTimeout();
      expect(await deciding).toEqual({ kind: 'open' });
      expect(timerCalls).toEqual([GITHUB_PROBE_TIMEOUT_MS]);
      expect(await c.decide(segs('/project/github.com/o/r/chat'))).toEqual({
        kind: 'open',
      });
      expect(summary).toHaveBeenCalledTimes(1);
    });

    it('an answer that comes in time wins: "not found" is still shown', async () => {
      const c = check(undefined, () =>
        throwError(() => new GithubProjectNotFoundError('x', 'missing')),
      );
      expect((await c.decide(segs('/project/github.com/o/r'))).kind).toBe(
        'problem',
      );
    });

    it('an answer that comes after the time is up changes nothing', async () => {
      let answer: (value: unknown) => void = () => undefined;
      const late = new Promise((resolve) => (answer = resolve));
      const c = check(undefined, () => from(late));
      const deciding = c.decide(segs('/project/github.com/o/r'));
      fireTimeout();
      expect((await deciding).kind).toBe('open');
      answer({ id: 'x' });
      await Promise.resolve();
    });
  });

  it('is not about an address outside /project/github.com', async () => {
    expect(
      await check().decide(segs('/store/github.com/project/r@o@')),
    ).toEqual({ kind: 'open' });
    expect(summary).not.toHaveBeenCalled();
  });
});

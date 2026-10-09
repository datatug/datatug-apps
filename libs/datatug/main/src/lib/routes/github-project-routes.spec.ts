import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  NavigationError,
  provideRouter,
  Router,
  Routes,
  UrlSegment,
} from '@angular/router';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { filter, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatatugStoreGithubService } from '../services/repo/datatug-store.service.github';
import { GithubProjectNotFoundError } from '../services/repo/github/github-project-reader.service';
import {
  GithubAddressCheck,
  GithubAddressNotices,
  GithubAddressProblemState,
  GithubDefaultBranchLookup,
} from './github-project-address-check';
import { GithubAddressProblemPageComponent } from './github-address-problem-page.component';
import { DatatugProjectRoutingModule } from './datatug-routing-proj';
import { datatugRoutes } from './datatug-routing.module';
import {
  githubAddressCanMatch,
  githubAddressMatcher,
  githubProjectMatcher,
  githubProjectRoutes,
  urlHasOutletGroup,
} from './github-project-routes';

// The short project route (design `demo-as-github-project.md` 3.4): a matcher route with the project pages as
// children that supplies `storeId` and `projectId`, the redirects of 3.4a, and the problem page.

@Component({ selector: 'sneat-stub-problem', template: '' })
class ProblemStub {}
@Component({ selector: 'sneat-stub-page', template: '' })
class PageStub {}
@Component({ selector: 'sneat-stub-legacy', template: '' })
class LegacyStub {}
@Component({ selector: 'sneat-stub-other', template: '' })
class OtherStub {}

const segments = (path: string): UrlSegment[] =>
  path
    .split('/')
    .filter(Boolean)
    .map((p) => new UrlSegment(decodeURIComponent(p), {}));

describe('githubProjectMatcher', () => {
  const run = (path: string) =>
    githubProjectMatcher(segments(path), {} as never, {} as never);

  it.each([
    // [path, consumed, storeId, projectId]
    [
      '/project/github.com/datatug/chinook-demo',
      4,
      'github.com',
      'chinook-demo@datatug@',
    ],
    [
      '/project/github.com/datatug/chinook-demo/chat',
      4,
      'github.com',
      'chinook-demo@datatug@',
    ],
    [
      '/project/github.com/Datatug/Chinook-Demo/queries',
      4,
      'github.com',
      'chinook-demo@datatug@',
    ],
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/chat',
      8,
      'github.com',
      'r@o@demo-project-1',
    ],
    ['/project/github.com/o/r/tree/HEAD/datatug', 7, 'github.com', 'r@o'],
    [
      '/project/github.com/o/r/tree/v1.0.0/-/queries',
      7,
      'github.com',
      'r@o@@v1.0.0',
    ],
  ])(
    '%s consumes %i segments and supplies the canonical ids',
    (path, consumed, storeId, projectId) => {
      const result = run(path);
      expect(result?.consumed).toHaveLength(consumed);
      expect(result?.posParams?.['storeId'].path).toBe(storeId);
      expect(result?.posParams?.['projectId'].path).toBe(projectId);
    },
  );

  it.each([
    '/store/github.com/project/r@o@/chat',
    '/project/github.com/o',
    '/project/github.com/o/r/blob/main/x.txt',
    '/project/github.com/o/r/tree',
    '/project/gitlab.com/o/r',
    '/',
  ])('does not match %s', (path) => {
    expect(run(path)).toBeNull();
  });
});

describe('githubAddressMatcher', () => {
  const run = (path: string) =>
    githubAddressMatcher(segments(path), {} as never, {} as never);

  it('consumes the whole of every /project/github.com address, a project or not', () => {
    for (const path of [
      '/project/github.com',
      '/project/github.com/o',
      '/project/github.com/o/r/chat',
      '/project/github.com/o/r/tree',
    ]) {
      expect(run(path)?.consumed, path).toHaveLength(segments(path).length);
    }
  });

  it('matches nothing else', () => {
    for (const path of [
      '/',
      '/store/github.com/project/r@o@',
      '/project/gitlab.com/o/r',
      '/projects/github.com/o',
    ]) {
      expect(run(path), path).toBeNull();
    }
  });
});

describe('the routes as registered', () => {
  it('are two matcher routes, ahead of the store routes in the datatug-main route table', () => {
    expect(githubProjectRoutes).toHaveLength(2);
    expect(githubProjectRoutes.map((r) => r.matcher)).toEqual([
      githubAddressMatcher,
      githubProjectMatcher,
    ]);
    const at = datatugRoutes.indexOf(githubProjectRoutes[0]);
    expect(at).toBeGreaterThan(-1);
    expect(datatugRoutes.slice(at, at + 2)).toEqual(githubProjectRoutes);
    expect(at).toBeLessThan(
      datatugRoutes.findIndex((r) => r.path === 'store/:storeId'),
    );
  });

  it('the project route is lazy, has the project pages as children, and has no component of its own', () => {
    const route = githubProjectRoutes[1];
    expect(route.loadChildren).toBeTypeOf('function');
    expect(route.component).toBeUndefined();
    expect(route.loadComponent).toBeUndefined();
    expect(route.path).toBeUndefined();
  });

  it('load the problem page and the project pages lazily, and nothing else', async () => {
    const [problem, project] = githubProjectRoutes;
    expect(await (problem.loadComponent as () => Promise<unknown>)()).toBe(
      GithubAddressProblemPageComponent,
    );
    expect(await (project.loadChildren as () => Promise<unknown>)()).toBe(
      DatatugProjectRoutingModule,
    );
  });

  it('the old form is untouched: its route is still there, with no redirect', () => {
    const old = datatugRoutes.find((r) => r.path === 'store/:storeId');
    expect(old).toBeDefined();
    expect(old?.redirectTo).toBeUndefined();
  });

  it('guards the shared metadata route and exposes only root and overview children', () => {
    const shared = datatugRoutes.find(
      (r) => r.path === 'space/:spaceId/store/:storeId/project/:projectId',
    );
    expect(shared?.canMatch).toHaveLength(1);
    expect(shared?.children?.map((r) => r.path)).toEqual(['', 'overview']);
    expect(
      shared?.children?.every((r) => typeof r.loadComponent === 'function'),
    ).toBe(true);
    expect(shared?.loadChildren).toBeUndefined();
    expect(shared?.redirectTo).toBeUndefined();
  });

  it('retains the ordered route table with the shared metadata route before private stores', () => {
    expect(
      datatugRoutes
        .filter((r) => !githubProjectRoutes.includes(r))
        .map((r) => r.path),
    ).toEqual([
      'new-project',
      'github/callback',
      '',
      'home',
      'incidents',
      'incidents/new',
      'incidents/:storeId/:incidentId/record',
      'incidents/:storeId/:incidentId',
      'my',
      'explore/:spaceId',
      'explore-vault',
      'signed-out',
      'space/:spaceId/store/:storeId/project/:projectId',
      'store/:storeId',
      'agent',
    ]);
  });
});

describe('navigating to a short address', () => {
  let summary: ReturnType<typeof vi.fn>;
  let branch: ReturnType<typeof vi.fn>;
  let notice: ReturnType<typeof vi.fn>;

  /** The real matchers and guard; the lazy parts replaced by stubs that report what the router gave them. */
  async function visit(
    url: string,
    options: {
      profile?: keyof typeof PRODUCT_PROFILES;
      lookup?: unknown;
      summaryResult?: () => unknown;
    } = {},
  ) {
    branch = vi.fn(
      async () => options.lookup ?? { kind: 'found', branch: 'main' },
    );
    notice = vi.fn();
    summary = vi.fn(options.summaryResult ?? (() => of({ id: 'x' })));
    const routes: Routes = [
      {
        ...githubProjectRoutes[0],
        loadComponent: () => ProblemStub,
      },
      {
        ...githubProjectRoutes[1],
        loadChildren: () =>
          [
            { path: 'chat', component: PageStub },
            { path: 'queries', component: PageStub },
            { path: '', component: PageStub },
          ] as Routes,
      },
      { path: 'store/:storeId/project/:projectId/chat', component: LegacyStub },
      { path: 'store/:storeId/project/:projectId', component: LegacyStub },
      { path: '**', component: OtherStub },
    ];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PRODUCT_PROFILE,
          useValue: PRODUCT_PROFILES[options.profile ?? 'datatug'],
        },
        { provide: GithubDefaultBranchLookup, useValue: { lookup: branch } },
        {
          provide: GithubAddressNotices,
          useValue: { defaultBranchUnknown: notice },
        },
        {
          provide: DatatugStoreGithubService,
          useValue: { getProjectSummary: summary },
        },
        provideRouter(routes),
      ],
    });
    const router = TestBed.inject(Router);
    const ok = await router.navigateByUrl(url);
    let leaf: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (leaf.firstChild) leaf = leaf.firstChild;
    return {
      ok,
      url: router.url,
      component: leaf.component,
      storeId: leaf.paramMap.get('storeId'),
      projectId: leaf.paramMap.get('projectId'),
      problem: TestBed.inject(GithubAddressProblemState).problem(),
    };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it.each([
    ['/project/github.com/datatug/chinook-demo', 'chinook-demo@datatug@'],
    ['/project/github.com/datatug/chinook-demo/chat', 'chinook-demo@datatug@'],
    [
      '/project/github.com/datatug/chinook-demo/queries',
      'chinook-demo@datatug@',
    ],
    [
      '/project/github.com/o/r/tree/HEAD/demo-project-1/-/chat',
      'r@o@demo-project-1',
    ],
    ['/project/github.com/o/r/tree/HEAD/datatug', 'r@o'],
    ['/project/github.com/o/r/tree/v1.0.0/-/queries', 'r@o@@v1.0.0'],
  ])(
    '%s opens the project pages as children, with storeId and projectId %s',
    async (url, projectId) => {
      const result = await visit(url);
      expect(result.ok).toBe(true);
      expect(result.url).toBe(url);
      expect(result.component).toBe(PageStub);
      expect(result.storeId).toBe('github.com');
      expect(result.projectId).toBe(projectId);
    },
  );

  it('cold-opens a private Cloud address without anonymous manifest or branch reads', async () => {
    const result = await visit('/project/github.com/o/r/tree/HEAD/folder/-/queries?projectApi=cloud&branch=work', {
      summaryResult: () => throwError(() => new Error('private repository')),
    });
    expect(result.component).toBe(PageStub);
    expect(result.projectId).toBe('r@o@folder');
    expect(summary).not.toHaveBeenCalled();
    expect(branch).not.toHaveBeenCalled();
  });
  it.each(['projectApi=other&branch=work', 'projectApi=cloud', 'projectApi=cloud&projectApi=local&branch=work'])('refuses malformed Cloud transport %s without anonymous fallback', async (query) => {
    const result = await visit(`/project/github.com/o/r/queries?${query}`);
    expect(result.component).toBe(ProblemStub);
    expect(summary).not.toHaveBeenCalled();
    expect(branch).not.toHaveBeenCalled();
  });

  it('the old form opens as before, with no redirect and no question asked of GitHub', async () => {
    const result = await visit(
      '/store/github.com/project/chinook-demo@datatug@/chat',
    );
    expect(result.url).toBe(
      '/store/github.com/project/chinook-demo@datatug@/chat',
    );
    expect(result.component).toBe(LegacyStub);
    expect(summary).not.toHaveBeenCalled();
    expect(branch).not.toHaveBeenCalled();
  });

  describe('every spelling redirects to the canonical address, keeping the page, the query and the fragment', () => {
    it.each([
      [
        '/project/github.com/Datatug/Chinook-Demo',
        '/project/github.com/datatug/chinook-demo',
      ],
      [
        '/project/github.com/Datatug/Chinook-Demo/chat?lang=ru&x=1#top',
        '/project/github.com/datatug/chinook-demo/chat?lang=ru&x=1#top',
      ],
      [
        '/project/github.com/o/r.git/queries?order-tags-by=count',
        '/project/github.com/o/r/queries?order-tags-by=count',
      ],
      [
        '/project/github.com/o/r/tree/HEAD/-/chat?x=1',
        '/project/github.com/o/r/chat?x=1',
      ],
      ['/project/github.com/o/r/tree/HEAD', '/project/github.com/o/r'],
      [
        '/project/github.com/o/r/blob/v1/dir/datatug-project.json',
        '/project/github.com/o/r/tree/v1/dir',
      ],
      [
        '/project/github.com/o/r/tree/main/dir/-/chat?a=1&a=2#f',
        '/project/github.com/o/r/tree/HEAD/dir/-/chat?a=1&a=2#f',
      ],
    ])('%s -> %s', async (typed, canonical) => {
      const result = await visit(typed);
      expect(result.url).toBe(canonical);
      expect(result.component).toBe(PageStub);
    });
  });

  describe('letter case: the fixed segments match in any case and redirect to the lower-case address (review B1)', () => {
    it.each([
      [
        '/Project/GitHub.com/datatug/chinook-demo/Chat',
        '/project/github.com/datatug/chinook-demo/chat',
      ],
      [
        '/PROJECT/github.com/datatug/chinook-demo/chat?lang=ru',
        '/project/github.com/datatug/chinook-demo/chat?lang=ru',
      ],
      [
        '/project/github.com/datatug/chinook-demo/Chat?x=1#top',
        '/project/github.com/datatug/chinook-demo/chat?x=1#top',
      ],
      [
        '/project/github.com/datatug/chinook-demo/Tree/HEAD/-/chat',
        '/project/github.com/datatug/chinook-demo/chat',
      ],
      [
        '/project/github.com/datatug/chinook-demo/Tree/HEAD/-/Chat?a=1&a=2',
        '/project/github.com/datatug/chinook-demo/chat?a=1&a=2',
      ],
      [
        '/project/github.com/datatug/chinook-demo/Queries',
        '/project/github.com/datatug/chinook-demo/queries',
      ],
    ])('%s -> %s, through one redirect, never to a route that matches nothing', async (typed, canonical) => {
      const result = await visit(typed);
      expect(result.ok).toBe(true);
      expect(result.url).toBe(canonical);
      expect(result.component).toBe(PageStub);
      expect(result.projectId).toBe('chinook-demo@datatug@');
    });
  });

  describe('a folder with parentheses stays that folder through a redirect (review minor 3)', () => {
    it('a letter-case redirect', async () => {
      const result = await visit(
        '/project/github.com/Acme/demo/tree/HEAD/a%28b%29/-/queries',
      );
      expect(result.url).toBe(
        '/project/github.com/acme/demo/tree/HEAD/a%28b%29/-/queries',
      );
      expect(result.component).toBe(PageStub);
      expect(result.projectId).toBe('demo@acme@a(b)');
    });

    it('a default-branch redirect, query and fragment kept', async () => {
      const result = await visit(
        '/project/github.com/o/r/tree/main/a%28b%29/-/queries?x=1#f',
      );
      expect(result.url).toBe(
        '/project/github.com/o/r/tree/HEAD/a%28b%29/-/queries?x=1#f',
      );
      expect(result.component).toBe(PageStub);
      expect(result.projectId).toBe('r@o@a(b)');
    });

    it('an unmatched closing parenthesis, and a folder that is only parentheses', async () => {
      for (const folder of ['a%29b', '%28%29']) {
        const result = await visit(
          `/project/github.com/O/r/tree/HEAD/${folder}/-/queries`,
        );
        expect(result.projectId, folder).toBe(
          `r@o@${decodeURIComponent(folder)}`,
        );
        TestBed.resetTestingModule();
      }
    });
  });

  it.each([
    ['/project/github.com/o/r/', '/project/github.com/o/r'],
    ['/project/github.com/o/r/chat/', '/project/github.com/o/r/chat'],
  ])('a trailing slash (%s) is dropped by the router: the canonical address %s opens, with no second navigation', async (typed, canonical) => {
    const result = await visit(typed);
    expect(result.url).toBe(canonical);
    expect(result.component).toBe(PageStub);
    expect(result.projectId).toBe('r@o@');
  });

  describe('what is not supported shows a page that says so, at the address as typed', () => {
    it.each([
      ['/project/github.com/o/r/blob/main/dir/file.txt', 'file-link'],
      ['/project/github.com/o/r/tree/HEAD/a@b', 'at-sign-not-supported'],
      [
        '/project/github.com/o/r/blob/main/a/-/datatug-project.json',
        'dash-directory-not-supported',
      ],
      ['/project/github.com/o', 'not-a-project-address'],
    ])('%s (%s)', async (url, reason) => {
      const result = await visit(url);
      expect(result.url).toBe(url);
      expect(result.component).toBe(ProblemStub);
      expect(result.problem).toEqual({ kind: 'unsupported', reason });
      expect(summary).not.toHaveBeenCalled();
    });

    it('no project file: "No DataTug project here"', async () => {
      const result = await visit('/project/github.com/o/r/tree/feature/x', {
        summaryResult: () =>
          throwError(() => new GithubProjectNotFoundError('x', 'missing')),
      });
      expect(result.component).toBe(ProblemStub);
      expect(result.url).toBe('/project/github.com/o/r/tree/feature/x');
      expect(result.problem).toEqual({
        kind: 'not-found',
        owner: 'o',
        repo: 'r',
        ref: 'feature',
        folder: 'x',
        moved: false,
      });
    });
  });

  it('a refused default-branch lookup leaves the address as typed, tells the visit, and opens the project', async () => {
    const result = await visit('/project/github.com/o/r/tree/main/dir/-/chat', {
      lookup: { kind: 'refused' },
    });
    expect(result.url).toBe('/project/github.com/o/r/tree/main/dir/-/chat');
    expect(result.component).toBe(PageStub);
    expect(result.projectId).toBe('r@o@dir@main');
    expect(notice).toHaveBeenCalledWith('o', 'r', 'main');
  });

  // review r2, B1: whatever the inline script of the app concluded about an address, the question must not survive
  // in an address the short route matches. The route is the safety net: one redirect to the same address without
  // `msg` and `q`, everything else kept.
  describe('a question never stays in a short address (review r2, B1)', () => {
    const FRAGMENT_AND_X = 'x=1&y=2#frag';
    it.each([
      // [typed, what the address becomes]
      [
        '/project/github.com/acme/demo/queries?msg=Q&' + FRAGMENT_AND_X,
        '/project/github.com/acme/demo/queries?x=1&y=2#frag',
      ],
      ['/project/github.com/acme/demo/queries?q=Q', '/project/github.com/acme/demo/queries'],
      ['/project/github.com/acme/demo/queries?msg=Q&q=R', '/project/github.com/acme/demo/queries'],
      ['/project/github.com/acme/demo/queries?msg=', '/project/github.com/acme/demo/queries'],
      ['/project/github.com/acme/demo/queries?msg=A&msg=B&x=1', '/project/github.com/acme/demo/queries?x=1'],
      ['/project/github.com/acme/demo?msg=Q', '/project/github.com/acme/demo'],
      ['/project/github.com/acme/demo/chat?msg=Q&lang=ru', '/project/github.com/acme/demo/chat?lang=ru'],
      ['/project/github.com/acme/demo/tree/HEAD/dir/-/chat?msg=Q', '/project/github.com/acme/demo/tree/HEAD/dir/-/chat'],
      // other spellings of the same path, which the router's parser reads as the address
      ['//project/github.com/acme/demo/queries?msg=Q', '/project/github.com/acme/demo/queries'],
      ['///project/github.com/acme/demo/queries?msg=Q&x=1', '/project/github.com/acme/demo/queries?x=1'],
      ['/(project/github.com/acme/demo/queries)?msg=Q', '/project/github.com/acme/demo/queries'],
      ['//project/github.com/acme/demo/chat?msg=Q', '/project/github.com/acme/demo/chat'],
      ['/(project/github.com/acme/demo/chat)?msg=Q', '/project/github.com/acme/demo/chat'],
      // not the canonical spelling, a redirect of its own: the question goes in the first step
      ['/Project/GitHub.com/Acme/Demo/Queries?msg=Q#f', '/project/github.com/acme/demo/queries#f'],
      ['/project/github.com/acme/demo/tree/main/dir/-/queries?msg=Q', '/project/github.com/acme/demo/tree/HEAD/dir/-/queries'],
      // an address that says there is a problem
      ['/project/github.com/acme/demo/blob/main/x.txt?msg=Q', '/project/github.com/acme/demo/blob/main/x.txt'],
      ['/project/github.com/acme?msg=Q&x=1', '/project/github.com/acme?x=1'],
      // a name that only looks like the parameter is not it
      ['/project/github.com/acme/demo/queries?MSG=Q&msgx=1&xq=2', '/project/github.com/acme/demo/queries?MSG=Q&msgx=1&xq=2'],
    ])('%s -> %s', async (typed, becomes) => {
      const result = await visit(typed);
      expect(result.ok).toBe(true);
      expect(result.url).toBe(becomes);
      expect(result.url).not.toMatch(/[?&](msg|q)(=|&|#|$)/);
    });

    it('asks GitHub nothing before the question is out of the address', async () => {
      const result = await visit(
        '//project/github.com/acme/demo/tree/main/dir/-/queries?msg=Q',
      );
      expect(result.url).toBe(
        '/project/github.com/acme/demo/tree/HEAD/dir/-/queries',
      );
      // once, for the address that is left: the default branch, and the project file
      expect(branch).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledTimes(1);
    });

    it('also for a navigation inside the app, which never puts the question in the address bar or the history', async () => {
      const first = await visit('/project/github.com/acme/demo/chat');
      expect(first.url).toBe('/project/github.com/acme/demo/chat');
      const router = TestBed.inject(Router);
      const urls: string[] = [];
      router.events.subscribe(() => urls.push(router.url));
      await router.navigateByUrl('/project/github.com/acme/demo/queries?msg=Q#f');
      expect(router.url).toBe('/project/github.com/acme/demo/queries#f');
      // and nothing the router did in between had the question: the URL it had was always the one from before
      expect(urls.filter((u) => /msg|Q/.test(u))).toEqual([]);
      await router.navigate(['/project', 'github.com', 'acme', 'demo', 'queries'], {
        queryParams: { q: 'Q', x: '1' },
      });
      expect(router.url).toBe('/project/github.com/acme/demo/queries?x=1');
    });

    it('the Incidentius profile, which has no short route, is as before: this route does not touch its query', async () => {
      const result = await visit('/project/github.com/acme/demo/queries?msg=Q', {
        profile: 'incidentius',
      });
      expect(result.component).toBe(OtherStub);
      expect(result.url).toBe('/project/github.com/acme/demo/queries?msg=Q');
    });
  });

  // review r2, minor 3: the router reads `(b)` in `a(b)` as an outlet group and drops it, and what follows, so the
  // address would open folder `a`, silently. It is not an address of a project; say so.
  describe('an address with an outlet group shows the unsupported-address page (review r2, minor 3)', () => {
    /** The page's first navigation, as the browser's address bar has it (the router reads it from Location). */
    async function openAt(typed: string, profile: 'datatug' | 'incidentius' = 'datatug') {
      summary = vi.fn(() => of({ id: 'x' }));
      branch = vi.fn(async () => ({ kind: 'found', branch: 'main' }));
      TestBed.configureTestingModule({
        providers: [
          { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES[profile] },
          { provide: GithubDefaultBranchLookup, useValue: { lookup: branch } },
          { provide: GithubAddressNotices, useValue: { defaultBranchUnknown: vi.fn() } },
          { provide: DatatugStoreGithubService, useValue: { getProjectSummary: summary } },
          provideLocationMocks(),
          provideRouter([
            ...githubProjectRoutes.map((r, i) =>
              i === 0
                ? { ...r, loadComponent: () => ProblemStub }
                : { ...r, loadChildren: () => [{ path: 'queries', component: PageStub }, { path: '', component: PageStub }] as Routes },
            ),
            { path: '**', component: OtherStub },
          ]),
        ],
      });
      (TestBed.inject(Location) as unknown as SpyLocation).setInitialPath(typed);
      const router = TestBed.inject(Router);
      router.initialNavigation();
      await firstValueFrom(
        router.events.pipe(
          filter((e) => e instanceof NavigationEnd || e instanceof NavigationError),
        ),
      );
      let leaf: ActivatedRouteSnapshot = router.routerState.snapshot.root;
      while (leaf.firstChild) leaf = leaf.firstChild;
      return {
        url: router.url,
        component: leaf.component,
        projectId: leaf.paramMap.get('projectId'),
        problem: TestBed.inject(GithubAddressProblemState).problem(),
        location: TestBed.inject(Location).path(),
      };
    }

    it.each([
      '/project/github.com/Acme/demo/tree/HEAD/a(b)/-/queries',
      '/project/github.com/acme/demo/tree/HEAD/a(b)',
      '/project/github.com/acme/demo/tree/HEAD/a(b)/-/chat',
      '/project/github.com/acme/demo/queries(b)',
      '/project/github.com/acme/demo(b)',
    ])('%s, opened as the browser has it', async (typed) => {
      const result = await openAt(typed);
      expect(result.component).toBe(ProblemStub);
      expect(result.problem?.kind).toBe('unsupported');
      expect(summary).not.toHaveBeenCalled();
      expect(branch).not.toHaveBeenCalled();
    });

    it('with a question in the query, the address the router ends with has none (the parser drops the query with the rest)', async () => {
      const result = await openAt(
        '/project/github.com/Acme/demo/tree/HEAD/a(b)/-/queries?msg=Q&x=1',
      );
      expect(result.url).not.toMatch(/msg|Q/);
      expect(result.location).not.toMatch(/msg|Q/);
      expect(result.component).toBe(ProblemStub);
    });

    it.each([
      '/(project/github.com/acme/demo/queries)',
      '//project/github.com/acme/demo/queries',
      '/project/github.com/acme/demo/queries',
      '/project/github.com/acme/demo/tree/HEAD/a%28b%29/-/queries',
    ])('%s has none: a path written as one group at the root is the path, and an encoded parenthesis is a character', async (typed) => {
      const result = await openAt(typed);
      expect(result.component).toBe(PageStub);
    });

    it('a folder with encoded parentheses is still that folder', async () => {
      const result = await visit(
        '/project/github.com/acme/demo/tree/HEAD/a%28b%29/-/queries',
      );
      expect(result.component).toBe(PageStub);
      expect(result.projectId).toBe('demo@acme@a(b)');
    });

    describe('the address as typed counts only when it is the address of this navigation', () => {
      const router = () => TestBed.inject(Router);
      const stand = (current: string, typed: string) => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        const r = router();
        vi.spyOn(r, 'getCurrentNavigation').mockReturnValue({
          extractedUrl: r.parseUrl(typed),
        } as never);
        return urlHasOutletGroup(r, { path: () => current });
      };
      beforeEach(() => TestBed.resetTestingModule());

      it('the browser shows a group the router dropped', () => {
        expect(stand('/project/github.com/o/r/tree/HEAD/a(b)/-/queries', '/project/github.com/o/r/tree/HEAD/a(b)/-/queries')).toBe(true);
      });
      it('the browser shows another address (an in-app navigation is on its way): its URL has no group', () => {
        expect(stand('/project/github.com/o/r/tree/HEAD/a(b)/-/queries', '/project/github.com/o/r/queries')).toBe(false);
      });
      it('a named group is in the URL tree, whatever the browser shows (the router cannot match it, and fails, as before)', () => {
        for (const typed of [
          '/project/github.com/o/r/chat(menu:x)',
          '/project/github.com/o/r(menu:x)',
        ]) {
          expect(stand('/', typed), typed).toBe(true);
        }
      });
      it('the address in the browser has none', () => {
        expect(stand('/project/github.com/o/r/queries', '/project/github.com/o/r/queries')).toBe(false);
      });
      it('a navigation that is not under way has none', () => {
        TestBed.configureTestingModule({ providers: [provideRouter([])] });
        expect(urlHasOutletGroup(router(), { path: () => '/a(b)' })).toBe(false);
      });
    });

    it('the Incidentius profile does not have it either', async () => {
      const result = await openAt(
        '/project/github.com/acme/demo/tree/HEAD/a(b)/-/queries',
        'incidentius',
      );
      expect(result.component).toBe(OtherStub);
    });
  });

  // review r2, minor 4: matrix parameters are another spelling of an address; the canonical one has none.
  describe('matrix parameters on a short address are dropped by the canonical redirect (review r2, minor 4)', () => {
    it.each([
      [
        '/project;a=1/github.com/acme/demo/queries',
        '/project/github.com/acme/demo/queries',
      ],
      [
        '/project/github.com;b=2/acme/demo/queries?x=1#f',
        '/project/github.com/acme/demo/queries?x=1#f',
      ],
      [
        '/project/github.com/acme/demo;msg=Q/queries',
        '/project/github.com/acme/demo/queries',
      ],
      [
        '/project/github.com/acme/demo/queries;msg=Q',
        '/project/github.com/acme/demo/queries',
      ],
      [
        '/project/github.com/acme/demo/tree;a=1/HEAD/dir/-/queries;b=2',
        '/project/github.com/acme/demo/tree/HEAD/dir/-/queries',
      ],
      ['/project/github.com/acme/demo;x=1', '/project/github.com/acme/demo'],
    ])('%s -> %s', async (typed, canonical) => {
      const result = await visit(typed);
      expect(result.url).toBe(canonical);
      expect(result.component).toBe(PageStub);
      expect(result.projectId).toBe('demo@acme@' + (typed.includes('/dir/') ? 'dir' : ''));
    });

    it('an address that is not a project keeps showing why, matrix parameters or not', async () => {
      const result = await visit('/project/github.com;a=1/acme');
      expect(result.component).toBe(ProblemStub);
      expect(result.problem?.kind).toBe('unsupported');
    });
  });

  describe('the Incidentius profile does not have the short route', () => {
    it.each([
      '/project/github.com/datatug/chinook-demo',
      '/project/github.com/datatug/chinook-demo/chat',
      '/project/github.com/Datatug/Chinook-Demo',
      '/project/github.com/o/r/blob/main/x.txt',
    ])(
      '%s is as before the route existed: it matches none of these routes',
      async (url) => {
        const result = await visit(url, { profile: 'incidentius' });
        expect(result.component).toBe(OtherStub);
        expect(result.url).toBe(url);
        expect(summary).not.toHaveBeenCalled();
        expect(branch).not.toHaveBeenCalled();
      },
    );

    it('a redirect asked for outside a navigation still keeps nothing but the path', async () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
          {
            provide: GithubAddressCheck,
            useValue: {
              decide: async () => ({
                kind: 'redirect',
                path: '/project/github.com/o/r',
              }),
            },
          },
        ],
      });
      const result = await TestBed.runInInjectionContext(() =>
        githubAddressCanMatch({} as never, segments('/project/github.com/O/r')),
      );
      expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
        '/project/github.com/o/r',
      );
    });

    it('the guard itself says no', async () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.incidentius },
        ],
      });
      const result = await TestBed.runInInjectionContext(() =>
        githubAddressCanMatch({} as never, segments('/project/github.com/o/r')),
      );
      expect(result).toBe(false);
    });
  });
});

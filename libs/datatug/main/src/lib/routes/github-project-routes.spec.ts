import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  Routes,
  UrlSegment,
} from '@angular/router';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { of, throwError } from 'rxjs';
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

  it('every other route of the table is as it was', () => {
    expect(
      datatugRoutes
        .filter((r) => !githubProjectRoutes.includes(r))
        .map((r) => r.path),
    ).toEqual([
      '',
      'incidents',
      'incidents/new',
      'incidents/:storeId/:incidentId/record',
      'incidents/:storeId/:incidentId',
      'my',
      'explore/:spaceId',
      'explore-vault',
      'signed-out',
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
        '/project/github.com/Datatug/Chinook-Demo/chat?msg=x&lang=ru#top',
        '/project/github.com/datatug/chinook-demo/chat?msg=x&lang=ru#top',
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

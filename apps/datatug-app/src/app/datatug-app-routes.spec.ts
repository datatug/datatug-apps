import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  PRODUCT_PROFILE,
  PRODUCT_PROFILES,
  ProductProfile,
  resolveProductProfile,
} from '@datatug/product-profiles';
import {
  datatugProfileOnly,
  handoffOrRoot,
  routes,
} from './datatug-app-routes';
import {
  DEMO_HANDOFF_KEY,
  DEMO_HANDOFF_STASH,
  resetHandoffAskedForTests,
} from './demo-handoff-asked';
import { handoffUrlMatcher } from './demo-handoff-path';

// Task 13 (S108) — see this file's own header comment in datatug-app-routes.ts.
// The read-only worktree `.worktrees/datatug-apps-layered-acl-query` (5ebb264)
// registers `pwa/repo/:repo/agent/:agentId` and `agent/:agentId` as a second,
// competing store-id/agent-URL convention; this guards against either ever
// being silently reintroduced.
describe('DataTug app routes', () => {
  it('does not register the layered-ACL branch competing agent-URL routes', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).not.toContain('agent/:agentId');
    expect(paths).not.toContain('pwa/repo/:repo/agent/:agentId');
  });

  // G-0: a hand-off from the sites must never fail to match (Sentry's crash-report dialog, the question lost).
  it('has the hand-off route: a matcher (case-insensitive, matrix parameters ignored), lazy, no flag, DataTug profile or the root', () => {
    const matching = routes.filter((r) => r.matcher);
    expect(matching.length).toBe(1);
    const route = matching[0];
    expect(route.matcher).toBe(handoffUrlMatcher);
    expect(route.path).toBeUndefined();
    expect(route.loadComponent).toBeTypeOf('function');
    expect(route.canMatch).toEqual([handoffOrRoot]);
    expect(route.canActivate).toBeUndefined();
    expect(route.children).toBeUndefined();
  });

  it('leaves the rest of the route table as it was: the hand-off route is only added', () => {
    expect(routes.map((r) => r.path)).toEqual([
      undefined, // the hand-off route, which has a matcher instead of a path
      'store/:storeId/project/:projectId/chat',
      'chat',
      'hello-world',
      'debug',
      '',
      '',
    ]);
  });

  describe('which product profile has the hand-off page', () => {
    const allowed = (profile: ProductProfile): boolean => {
      TestBed.configureTestingModule({
        providers: [{ provide: PRODUCT_PROFILE, useValue: profile }],
      });
      return TestBed.runInInjectionContext(() => datatugProfileOnly());
    };

    it('DataTug has it', () => {
      expect(allowed(PRODUCT_PROFILES.datatug)).toBe(true);
    });

    it('Incidentius (app.incidentius.com, the same bundle) does not: the hand-off page is not its to show', () => {
      expect(allowed(PRODUCT_PROFILES.incidentius)).toBe(false);
    });

    /** Navigates the real routes (the hand-off page stood in for) under the profile of `hostname`. */
    async function visit(hostname: string, url: string) {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: PRODUCT_PROFILE,
            useValue: resolveProductProfile({ hostname }),
          },
          provideRouter([
            ...routes
              .filter((r) => r.matcher)
              .map((r) => ({ ...r, loadComponent: () => HandoffStub })),
            { path: '', pathMatch: 'full', component: HomeStub },
            // What the datatug-main routes make of a short project address that the hand-off route does not take.
            { path: 'project/**', component: ProjectStub },
            // The app shell's side menu: a named outlet with an empty path, which the router adds an empty group for.
            { path: '', outlet: 'menu', component: OtherStub },
            { path: '**', component: OtherStub },
          ]),
        ],
      });
      const router = TestBed.inject(Router);
      const ok = await router.navigateByUrl(url);
      return {
        ok,
        component: router.routerState.snapshot.root.firstChild?.component,
        url: router.url,
      };
    }

    it.each([
      ['datatug.app', '/demo', true],
      ['datatug.app', '/Demo;x=1', true],
      ['an-unknown-host.example', '/demo', true], // an unrecognized host is the DataTug profile
    ])('at %s, %s lands on the hand-off page', async (hostname, url) => {
      expect((await visit(hostname, url)).component).toBe(HandoffStub);
    });

    it.each([
      '/demo',
      '/Demo',
      '/DEMO',
      '/demo;x=1',
      '/project/github.com/datatug/chinook-demo/chat',
      '/Project/GitHub.com/o/r/tree/abc/-/Chat',
    ])(
      'at app.incidentius.com, %s goes to the root: no failed navigation, no error',
      async (url) => {
        const result = await visit('app.incidentius.com', url);
        expect(result.ok).toBe(true);
        expect(result.component).toBe(HomeStub);
        expect(result.url).toBe('/');
      },
    );

    it('at app.incidentius.com, an address that is not a hand-off address is not redirected', async () => {
      const result = await visit('app.incidentius.com', '/demo/other');
      expect(result.component).toBe(OtherStub);
      expect(result.url).toBe('/demo/other');
    });

    // The short project route and the holding page share the project chat address. Which one an address gets is
    // decided from the query that index.html took out of the address bar (the router never sees it), and the
    // demo flag is not consulted: until the chat can run a question, the holding page is the only way not to lose it.
    describe('the project chat address: the holding page only when it arrived with a question', () => {
      const stash = (search: string) => {
        (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH] = search;
      };
      beforeEach(() => {
        resetHandoffAskedForTests();
        delete (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH];
        window.sessionStorage.clear();
      });
      afterEach(() => {
        delete (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH];
        window.sessionStorage.clear();
        resetHandoffAskedForTests();
      });

      it.each([
        '/project/github.com/datatug/chinook-demo/chat',
        '/project/github.com/Datatug/Chinook-Demo/chat',
        '/project/github.com/datatug/chinook-demo/tree/HEAD/-/chat',
        '/project/github.com/someone/else/chat',
        '/project/github.com/datatug/chinook-demo/tree/abc123/-/chat',
      ])('%s: a question gets the holding page, no question gets the project', async (url) => {
        for (const [search, expected] of [
          ['?msg=Hello', HandoffStub],
          ['?q=Hello&lang=ru', HandoffStub],
          ['?lang=ru', ProjectStub],
          ['?msg=', ProjectStub],
          ['?utm_source=x', ProjectStub],
        ] as const) {
          TestBed.resetTestingModule();
          resetHandoffAskedForTests();
          stash(search);
          expect((await visit('datatug.app', url)).component, search).toBe(expected);
        }
        TestBed.resetTestingModule();
        resetHandoffAskedForTests();
        delete (window as unknown as Record<string, unknown>)[DEMO_HANDOFF_STASH];
        expect((await visit('datatug.app', url)).component, 'no query').toBe(ProjectStub);
      });

      it('a reload of a question that was asked shows the holding page again; a fresh visit shows the project', async () => {
        const url = '/project/github.com/datatug/chinook-demo/chat';
        window.sessionStorage.setItem(DEMO_HANDOFF_KEY, url + '?msg=Hello');
        expect((await visit('datatug.app', url)).component).toBe(HandoffStub);
      });

      it('every other address under a project is the project, question or not', async () => {
        stash('?msg=Hello');
        for (const url of [
          '/project/github.com/datatug/chinook-demo',
          '/project/github.com/datatug/chinook-demo/queries',
          '/project/github.com/datatug/chinook-demo/tree/HEAD/dir/-/chat',
          '/project/github.com/datatug/chinook-demo/chat/more',
        ]) {
          TestBed.resetTestingModule();
          expect((await visit('datatug.app', url)).component, url).toBe(ProjectStub);
        }
      });

      it('/demo is the holding page with or without a question', async () => {
        for (const search of ['?q=Hello', '?lang=ru', '']) {
          TestBed.resetTestingModule();
          stash(search);
          expect((await visit('datatug.app', '/demo')).component, search).toBe(HandoffStub);
        }
      });

      it('at app.incidentius.com every project chat address still goes to the root, with or without a question', async () => {
        for (const search of ['?msg=Hello', '?lang=ru']) {
          TestBed.resetTestingModule();
          stash(search);
          const result = await visit('app.incidentius.com', '/project/github.com/datatug/chinook-demo/chat');
          expect(result.component, search).toBe(HomeStub);
          expect(result.url).toBe('/');
        }
      });
    });

    it.each(['/demo(menu:x)', '/demo/(menu:x)', '/Demo(menu:x/y)'])(
      "an address with an outlet group (%s) is handled by neither profile's hand-off route",
      async (url) => {
        for (const hostname of ['datatug.app', 'app.incidentius.com']) {
          TestBed.resetTestingModule();
          const result = await visit(hostname, url).catch(() => undefined);
          expect(result?.component, hostname).not.toBe(HandoffStub);
          expect(result?.component, hostname).not.toBe(HomeStub);
        }
      },
    );
  });
});

@Component({ selector: 'sneat-stub-handoff', template: '' })
class HandoffStub {}
@Component({ selector: 'sneat-stub-home', template: '' })
class HomeStub {}
@Component({ selector: 'sneat-stub-project', template: '' })
class ProjectStub {}
@Component({ selector: 'sneat-stub-other', template: '' })
class OtherStub {}

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  PRODUCT_PROFILE,
  PRODUCT_PROFILES,
  ProductProfile,
  resolveProductProfile,
} from '@datatug/product-profiles';
import { datatugProfileOnly, routes } from './datatug-app-routes';
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
  it('has one hand-off route: a matcher (case-insensitive, matrix parameters ignored), lazy, no flag, DataTug profile only', () => {
    const matching = routes.filter((r) => r.matcher);
    expect(matching.length).toBe(1);
    const route = matching[0];
    expect(route.matcher).toBe(handoffUrlMatcher);
    expect(route.path).toBeUndefined();
    expect(route.loadComponent).toBeTypeOf('function');
    expect(route.canMatch).toEqual([datatugProfileOnly]);
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

    it('Incidentius (app.incidentius.com, the same bundle) does not: /demo matches nothing there, as on main', () => {
      expect(allowed(PRODUCT_PROFILES.incidentius)).toBe(false);
    });

    it.each([
      ['datatug.app', 'demo', true],
      ['app.incidentius.com', 'demo', false],
      ['app.incidentius.com', 'Demo;x=1', false],
      ['an-unknown-host.example', 'demo', true], // an unrecognized host is the DataTug profile
    ])(
      'the real router at host %s with /%s lands on the hand-off page: %s',
      async (hostname, url, handled) => {
        const profile = resolveProductProfile({ hostname });
        TestBed.configureTestingModule({
          providers: [
            { provide: PRODUCT_PROFILE, useValue: profile },
            provideRouter([
              // The real hand-off route, with a stand-in for the lazily loaded page.
              ...routes
                .filter((r) => r.matcher)
                .map((r) => ({ ...r, loadComponent: () => HandoffStub })),
              { path: '**', component: OtherStub },
            ]),
          ],
        });
        const router = TestBed.inject(Router);
        await router.navigateByUrl('/' + url);
        expect(
          router.routerState.snapshot.root.firstChild?.component ===
            HandoffStub,
        ).toBe(handled);
      },
    );
  });
});

@Component({ selector: 'sneat-stub-handoff', template: '' })
class HandoffStub {}
@Component({ selector: 'sneat-stub-other', template: '' })
class OtherStub {}

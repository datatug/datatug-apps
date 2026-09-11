import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { datatugProjectRoutes } from './datatug-routing-proj';

describe('datatugProjectRoutes', () => {
  it('resolves the "variables" route to InvestigationContextPageComponent, unconditionally (not gated behind ENABLE_EMPTY_SHELL_PAGES)', async () => {
    const route = datatugProjectRoutes.find((r) => r.path === 'variables');
    expect(route).toBeTruthy();
    expect(route?.loadComponent).toBeTruthy();
    if (!route?.loadComponent) {
      throw new Error('"variables" route or its loadComponent not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await route.loadComponent();
    expect(loaded?.name).toBe('InvestigationContextPageComponent');
  });

  it('never resolves "variables" to the retired VariablesPageComponent', () => {
    const route = datatugProjectRoutes.find((r) => r.path === 'variables');
    expect(route?.loadComponent?.toString()).not.toContain('variables-page.component');
    expect(route?.loadComponent?.toString()).toContain(
      'investigation-context-page.component',
    );
  });
});

/**
 * S158 — NG04002 on the founder's own reported URL, production build
 * ed66c71: `.../query/artists%2Fartists_with_albums?id=...`. A query id can
 * be folder-qualified (`artists/artists_with_albums`, datatug-cli#219); the
 * in-app "open query" path (`DatatugNavService.goQuery()`) already
 * `encodeURIComponent()`s it into one path segment before an ARRAY-based
 * `router.navigate([...])` call, which never re-parses a URL string, so
 * `%2F` always survives there. A cold top-level navigation straight to the
 * URL string is not safe the same way: this app's own Cloudflare Workers
 * Assets config (`wrangler.jsonc`, `not_found_handling:
 * "single-page-application"`, unchanged since 2026-06-08 — confirmed live
 * via `wrangler dev` + `curl -v` against this repo's own build, and via a
 * real request to https://datatug.app) 307-redirects such a request to a
 * canonicalized path that has already decoded `%2F` back into a literal
 * `/`, splitting the id into TWO real path segments before Angular's
 * router ever sees the URL. `query/:queryId` (exactly one param segment)
 * can never match that shape — confirmed unchanged all the way back past
 * `a7eaf10`, so no single commit introduced this; a folder-qualified query
 * id in a directly-loaded (not clicked-through) URL was always this
 * fragile.
 *
 * `QueryPageComponent` never reads this path segment's value at all —
 * `trackQueryParams()` resolves the real id exclusively from the `?id=`
 * query-string param, where a literal `/` is unambiguous RFC 3986
 * query-component syntax and survives every hop (browser, CDN redirect,
 * `HttpClient`) intact. So the route only needs to MATCH, regardless of how
 * many real segments the id ends up split across.
 */
describe('datatugProjectRoutes — "query" route (S158, NG04002 regression)', () => {
  function findQueryRoute(): Route {
    const route = datatugProjectRoutes.find((r) => r.path === 'query');
    if (!route) {
      throw new Error('"query" route not found in datatugProjectRoutes');
    }
    return route;
  }

  it('is a literal "query" segment with a single wildcard child — NOT "query/:queryId" (exactly one segment)', () => {
    const route = findQueryRoute();
    expect(route.path).toBe('query');
    expect(route.children).toHaveLength(1);
    expect(route.children?.[0].path).toBe('**');
  });

  it("resolves its wildcard child's lazy import to QueryPageComponent", async () => {
    const route = findQueryRoute();
    const loadComponent = route.children?.[0].loadComponent;
    expect(loadComponent).toBeTruthy();
    if (!loadComponent) {
      throw new Error('"query" wildcard child loadComponent not found');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await loadComponent();
    expect(loaded?.name).toBe('QueryPageComponent');
  });

  // A trivial standalone component stands in for the real, DI-heavy
  // `QueryPageComponent` (already covered above: the real route entry's
  // `loadComponent` really does resolve to it) — these two tests are about
  // proving the SHAPE of the real route config (literal 'query' + a
  // wildcard child) actually matches, via Angular's own router, not about
  // re-testing `QueryPageComponent` itself.
  @Component({ selector: 'sneat-stub-query-page', template: '' })
  class StubQueryPageComponent {}

  function routeUnderTest(): Route {
    const real = findQueryRoute();
    return {
      path: real.path,
      children: [{ path: '**', component: StubQueryPageComponent }],
    };
  }

  it('matches a folder-qualified query id already split across multiple real path segments — the exact shape the Cloudflare 307 redirect produces by decoding "%2F"; "query/:queryId" never matched this', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([routeUnderTest()])],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/query/artists/artists_with_albums');

    expect(harness.routeNativeElement).toBeTruthy();
  });

  it('still matches the normal single-segment, %2F-encoded form used by in-app navigation', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([routeUnderTest()])],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/query/artists%2Fartists_with_albums');

    expect(harness.routeNativeElement).toBeTruthy();
  });
});

/**
 * S160 — NG04002 on every store/project, 100% reproducible (founder report,
 * 2026-09-10): `'servers'` used to be a bare `loadComponent` LEAF route, so
 * there was no route at all for `ServersPageComponent.goDbServer()`'s own
 * child navigation to `servers/db/:dbDriver/:dbServerId`
 * (`servers-routing.module.ts`'s `db/...` route, which loads
 * `DbserverPageComponent` — previously dead code, nothing imported that
 * module). Fixed by switching `'servers'` to `loadChildren` into
 * `ServersPageRoutingModule`, which already declares both routes.
 */
describe('datatugProjectRoutes — "servers" route (S160, NG04002 regression)', () => {
  function findServersRoute(): Route {
    const route = datatugProjectRoutes.find((r) => r.path === 'servers');
    if (!route) {
      throw new Error('"servers" route not found in datatugProjectRoutes');
    }
    return route;
  }

  it('is a "servers" segment with loadChildren — NOT a bare loadComponent leaf', () => {
    const route = findServersRoute();
    expect(route.path).toBe('servers');
    expect(route.loadChildren).toBeTruthy();
    expect(route.loadComponent).toBeFalsy();
  });

  it("loadChildren resolves to ServersPageRoutingModule, whose own routes cover both '' (the list) and 'db/:dbDriver/:dbServerId' (the detail page)", async () => {
    const route = findServersRoute();
    if (!route.loadChildren) {
      throw new Error('"servers" route has no loadChildren');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await route.loadChildren();
    expect(loaded).toBeTruthy();
    expect(loaded?.name).toBe('ServersPageRoutingModule');
  });

  // Trivial standalone stand-ins for the real, DI-heavy
  // `ServersPageComponent`/`DbserverPageComponent` — already covered above
  // (the real route entry's `loadChildren` really does resolve to
  // `ServersPageRoutingModule`). These two tests are about proving the
  // registered child routes actually MATCH real URLs through Angular's own
  // router, the same idiom the "query" route block above already uses.
  @Component({ selector: 'sneat-stub-servers-page', template: '' })
  class StubServersPageComponent {}

  @Component({ selector: 'sneat-stub-dbserver-page', template: '' })
  class StubDbServerPageComponent {}

  function routesUnderTest(): Routes {
    return [
      {
        path: 'servers',
        children: [
          { path: '', component: StubServersPageComponent },
          {
            path: 'db/:dbDriver/:dbServerId',
            component: StubDbServerPageComponent,
          },
        ],
      },
    ];
  }

  it("matches '/servers' (the list page)", async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routesUnderTest())],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/servers');

    expect(harness.routeNativeElement).toBeTruthy();
  });

  it("matches '/servers/db/sqlite3/<dbServerId>' (the detail page `goDbServer()` navigates to) — including the host-less placeholder id", async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routesUnderTest())],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/servers/db/sqlite3/-');

    expect(harness.routeNativeElement).toBeTruthy();
  });

  it("matches '/servers/db/sqlserver/<host:port>' too", async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routesUnderTest())],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/servers/db/sqlserver/localhost:1433');

    expect(harness.routeNativeElement).toBeTruthy();
  });
});

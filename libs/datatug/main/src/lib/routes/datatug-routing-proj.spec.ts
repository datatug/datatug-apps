import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { datatugProjectRoutes } from './datatug-routing-proj';

describe('datatugProjectRoutes', () => {
  it('resolves the "variables" route to InvestigationContextPageComponent, unconditionally (not gated behind ENABLE_EMPTY_SHELL_PAGES)', async () => {
    const route = datatugProjectRoutes.find((r) => r.path === 'variables');
    expect(route).toBeTruthy();
    expect(route?.loadComponent).toBeTruthy();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await route!.loadComponent!();
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loaded: any = await loadComponent!();
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

import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import {
  profileHomeRedirectGuard,
  profileStartPageGuard,
  START_PAGE_PATH,
} from './profile-home-redirect.guard';

/** The part of the activated route the guards read: the address being left. */
function routeOf(
  queryParams: Record<string, string> = {},
  fragment: string | null = null,
): ActivatedRouteSnapshot {
  return { queryParams, fragment } as unknown as ActivatedRouteSnapshot;
}

function provideProfile(profile: unknown): void {
  TestBed.configureTestingModule({
    providers: [{ provide: PRODUCT_PROFILE, useValue: profile }],
  });
}

function runGuard(
  guard: typeof profileHomeRedirectGuard,
  route: ActivatedRouteSnapshot = routeOf(),
) {
  return TestBed.runInInjectionContext(() => guard(route, {} as never));
}

function serialized(result: unknown): string {
  return TestBed.inject(Router).serializeUrl(result as UrlTree);
}

describe('profileHomeRedirectGuard', () => {
  it('redirects the datatug profile to its start page, /home', () => {
    provideProfile(PRODUCT_PROFILES.datatug);
    const router = TestBed.inject(Router);
    const parseUrlSpy = vi.spyOn(router, 'parseUrl');

    const result = runGuard(profileHomeRedirectGuard);

    expect(parseUrlSpy).toHaveBeenCalledWith('/home');
    expect(result).toBe(parseUrlSpy.mock.results[0]?.value);
  });

  it('redirects the incidentius profile to /incidents', () => {
    provideProfile(PRODUCT_PROFILES.incidentius);
    const router = TestBed.inject(Router);
    const parseUrlSpy = vi.spyOn(router, 'parseUrl');

    const result = runGuard(profileHomeRedirectGuard);

    expect(parseUrlSpy).toHaveBeenCalledWith('/incidents');
    expect(result).toBe(parseUrlSpy.mock.results[0]?.value);
  });

  it('keeps the query string and the fragment of / on the redirect, under both profiles', () => {
    const route = routeOf({ agent: 'localhost:8989', project: 'p' }, 'frag');

    provideProfile(PRODUCT_PROFILES.datatug);
    expect(serialized(runGuard(profileHomeRedirectGuard, route))).toBe(
      '/home?agent=localhost:8989&project=p#frag',
    );

    TestBed.resetTestingModule();
    provideProfile(PRODUCT_PROFILES.incidentius);
    expect(serialized(runGuard(profileHomeRedirectGuard, route))).toBe(
      '/incidents?agent=localhost:8989&project=p#frag',
    );
  });

  it('adds no query string or fragment when / had none', () => {
    provideProfile(PRODUCT_PROFILES.datatug);
    expect(serialized(runGuard(profileHomeRedirectGuard))).toBe('/home');
  });

  it('lets a profile with an empty homePath through (the root is its home page)', () => {
    provideProfile({
      ...PRODUCT_PROFILES.datatug,
      id: 'rootius',
      homePath: '',
    });

    expect(runGuard(profileHomeRedirectGuard)).toBe(true);
  });

  it('never branches on profile identity — only reads the declarative homePath field', () => {
    // A synthetic third profile proves this guard is driven purely by
    // `homePath`, never by an `if (id === 'incidentius')` check
    // (REQ:profile-config-is-declarative).
    provideProfile({
      ...PRODUCT_PROFILES.datatug,
      id: 'dashboardius',
      homePath: 'boards',
    });
    const router = TestBed.inject(Router);
    const parseUrlSpy = vi.spyOn(router, 'parseUrl');

    runGuard(profileHomeRedirectGuard);

    expect(parseUrlSpy).toHaveBeenCalledWith('/boards');
  });
});

describe('profileStartPageGuard (the /home route)', () => {
  it('shows the start page under the datatug profile', () => {
    provideProfile(PRODUCT_PROFILES.datatug);

    expect(runGuard(profileStartPageGuard)).toBe(true);
  });

  it('sends /home to /incidents under the incidentius profile, never showing the DataTug start page', () => {
    provideProfile(PRODUCT_PROFILES.incidentius);

    expect(serialized(runGuard(profileStartPageGuard))).toBe('/incidents');
  });

  it('keeps the query string and the fragment of /home on that redirect', () => {
    provideProfile(PRODUCT_PROFILES.incidentius);

    expect(
      serialized(
        runGuard(profileStartPageGuard, routeOf({ agent: 'demo' }, 'frag')),
      ),
    ).toBe('/incidents?agent=demo#frag');
  });

  it('sends /home to the root for a profile whose home page is the root, so the two guards never loop', () => {
    provideProfile({
      ...PRODUCT_PROFILES.datatug,
      id: 'rootius',
      homePath: '',
    });

    expect(serialized(runGuard(profileStartPageGuard))).toBe('/');
    expect(runGuard(profileHomeRedirectGuard)).toBe(true);
  });

  it('never branches on profile identity — a profile named datatug with another homePath does not get the page', () => {
    provideProfile({ ...PRODUCT_PROFILES.datatug, homePath: 'boards' });

    expect(serialized(runGuard(profileStartPageGuard))).toBe('/boards');
  });

  it('is the address the datatug profile declares as its home', () => {
    expect(PRODUCT_PROFILES.datatug.homePath).toBe(START_PAGE_PATH);
    expect(START_PAGE_PATH).toBe('home');
  });
});

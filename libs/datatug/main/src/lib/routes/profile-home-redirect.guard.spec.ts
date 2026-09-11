import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { profileHomeRedirectGuard } from './profile-home-redirect.guard';

describe('profileHomeRedirectGuard', () => {
  it('lets the datatug profile through (empty homePath, no redirect)', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      profileHomeRedirectGuard({} as never, { url: '/' } as never),
    );

    expect(result).toBe(true);
  });

  it('redirects the incidentius profile to /incidents', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.incidentius },
      ],
    });
    const router = TestBed.inject(Router);
    const parseUrlSpy = vi.spyOn(router, 'parseUrl');

    const result = TestBed.runInInjectionContext(() =>
      profileHomeRedirectGuard({} as never, { url: '/' } as never),
    );

    expect(parseUrlSpy).toHaveBeenCalledWith('/incidents');
    expect(result).toBe(parseUrlSpy.mock.results[0]?.value);
  });

  it('never branches on profile identity — only reads the declarative homePath field', () => {
    // A synthetic third profile proves this guard is driven purely by
    // `homePath`, never by an `if (id === 'incidentius')` check
    // (REQ:profile-config-is-declarative).
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PRODUCT_PROFILE,
          useValue: {
            ...PRODUCT_PROFILES.datatug,
            id: 'dashboardius',
            homePath: 'boards',
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    const parseUrlSpy = vi.spyOn(router, 'parseUrl');

    TestBed.runInInjectionContext(() =>
      profileHomeRedirectGuard({} as never, { url: '/' } as never),
    );

    expect(parseUrlSpy).toHaveBeenCalledWith('/boards');
  });
});

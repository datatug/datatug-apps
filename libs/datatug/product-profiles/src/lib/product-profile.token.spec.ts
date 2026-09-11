import { TestBed } from '@angular/core/testing';
import { PRODUCT_PROFILE, PRODUCT_PROFILE_OVERRIDE } from './product-profile.token';
import { PRODUCT_PROFILES } from './product-profile';

describe('PRODUCT_PROFILE token', () => {
  it('resolves to a valid profile with no explicit provider (default factory)', () => {
    // No provider configured at all — this is the "no explicit wiring needed"
    // contract every consumer (menu, app shell, routing guard) relies on. The
    // test environment's hostname does not match any registered profile, so
    // this also exercises the "falls back to datatug" path end to end.
    const profile = TestBed.inject(PRODUCT_PROFILE);
    expect(Object.values(PRODUCT_PROFILES)).toContain(profile);
  });

  it('honors PRODUCT_PROFILE_OVERRIDE when provided', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PRODUCT_PROFILE_OVERRIDE, useValue: 'incidentius' },
      ],
    });

    const profile = TestBed.inject(PRODUCT_PROFILE);
    expect(profile).toBe(PRODUCT_PROFILES.incidentius);
  });

  it('can be substituted directly with useValue, so a test can render any profile without a hostname', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.incidentius },
      ],
    });

    expect(TestBed.inject(PRODUCT_PROFILE)).toBe(PRODUCT_PROFILES.incidentius);
  });

  it('resolves the same instance on repeated injection within one test (resolved once)', () => {
    const first = TestBed.inject(PRODUCT_PROFILE);
    const second = TestBed.inject(PRODUCT_PROFILE);
    expect(first).toBe(second);
  });
});

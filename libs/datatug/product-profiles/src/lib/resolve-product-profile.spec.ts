import {
  isLocalDevelopmentHostname,
  resolveProductProfile,
  resolveProductProfileId,
} from './resolve-product-profile';
import { PRODUCT_PROFILES } from './product-profile';

describe('resolveProductProfileId', () => {
  describe('precedence', () => {
    it('an explicit override wins over a matching hostname', () => {
      expect(
        resolveProductProfileId({
          hostname: 'datatug.app',
          override: 'incidentius',
        }),
      ).toBe('incidentius');
    });

    it('an explicit override wins over the query parameter', () => {
      expect(
        resolveProductProfileId({
          hostname: 'localhost',
          queryProfile: 'incidentius',
          override: 'datatug',
        }),
      ).toBe('datatug');
    });

    it('a hostname match wins over the datatug default', () => {
      expect(
        resolveProductProfileId({ hostname: 'datatug.app' }),
      ).toBe('datatug');
    });
  });

  describe('hostname matching', () => {
    it('selects datatug for datatug.app', () => {
      expect(
        resolveProductProfileId({ hostname: 'datatug.app' }),
      ).toBe('datatug');
    });

    it('falls back to datatug for an unrecognized hostname (never fails to boot)', () => {
      expect(
        resolveProductProfileId({ hostname: 'example.com' }),
      ).toBe('datatug');
    });

    it('incidentius has no claimed hostname yet, so it is never hostname-selected', () => {
      // Hub REQ:brand-and-domain-honesty: no Incidentius domain is registered.
      expect(PRODUCT_PROFILES.incidentius.hostnames).toEqual([]);
      expect(
        resolveProductProfileId({ hostname: 'incidentius.com' }),
      ).toBe('datatug');
    });
  });

  describe('?profile= query parameter', () => {
    it('is honored on a local development hostname (localhost)', () => {
      expect(
        resolveProductProfileId({
          hostname: 'localhost',
          queryProfile: 'incidentius',
        }),
      ).toBe('incidentius');
    });

    it('is honored on a local development hostname (127.0.0.1)', () => {
      expect(
        resolveProductProfileId({
          hostname: '127.0.0.1',
          queryProfile: 'incidentius',
        }),
      ).toBe('incidentius');
    });

    it('is honored on an ngrok tunnel hostname', () => {
      expect(
        resolveProductProfileId({
          hostname: 'abc123.ngrok.io',
          queryProfile: 'incidentius',
        }),
      ).toBe('incidentius');
    });

    it('is inert (ignored) outside local development', () => {
      expect(
        resolveProductProfileId({
          hostname: 'datatug.app',
          queryProfile: 'incidentius',
        }),
      ).toBe('datatug');
    });

    it('an unrecognized profile id in the query string is ignored', () => {
      expect(
        resolveProductProfileId({
          hostname: 'localhost',
          queryProfile: 'dashboardius',
        }),
      ).toBe('datatug');
    });

    it('a null/absent query parameter falls through to hostname/default', () => {
      expect(
        resolveProductProfileId({ hostname: 'localhost', queryProfile: null }),
      ).toBe('datatug');
    });
  });

  describe('fallback', () => {
    it('defaults to datatug with no hostname, override or query at all', () => {
      expect(resolveProductProfileId({ hostname: '' })).toBe('datatug');
    });

    it('an unrecognized override value is ignored, falling through', () => {
      expect(
        resolveProductProfileId({
          hostname: 'datatug.app',
          override: 'not-a-real-profile' as never,
        }),
      ).toBe('datatug');
    });
  });
});

describe('resolveProductProfile', () => {
  it('returns the full declarative profile record, not just the id', () => {
    const profile = resolveProductProfile({
      hostname: 'localhost',
      queryProfile: 'incidentius',
    });
    expect(profile).toBe(PRODUCT_PROFILES.incidentius);
    expect(profile.brandName).toBe('Incidentius');
    expect(profile.planned).toBe(true);
    expect(profile.entryPointLabel).toBe("Houston, we've got a problem");
  });
});

describe('isLocalDevelopmentHostname', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['', true],
    ['my-machine.local', true],
    ['abc123.ngrok.io', true],
    ['datatug.app', false],
    ['example.com', false],
  ])('%s -> %s', (hostname, expected) => {
    expect(isLocalDevelopmentHostname(hostname)).toBe(expected);
  });
});

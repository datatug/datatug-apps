import { PRODUCT_PROFILES } from '@datatug/product-profiles';
import { datatugRoutes } from './datatug-routing.module';
import {
  profileHomeRedirectGuard,
  profileStartPageGuard,
} from './profile-home-redirect.guard';
import {
  routingParamIncidentId,
  routingParamStoreId,
} from '../core/datatug-routing-params';

describe('datatugRoutes', () => {
  it('redirects signed-out to the home page', () => {
    expect(datatugRoutes).toContainEqual({
      path: 'signed-out',
      pathMatch: 'full',
      redirectTo: '/',
    });
  });

  it('keeps Incidentius pages in one incident route family', () => {
    const paths = datatugRoutes.map((route) => route.path);
    expect(paths).toContain('incidents');
    expect(paths).toContain('incidents/new');
    expect(paths).toContain(
      'incidents/:' + routingParamStoreId + '/:' + routingParamIncidentId,
    );
    expect(paths).toContain(
      'incidents/:' +
        routingParamStoreId +
        '/:' +
        routingParamIncidentId +
        '/record',
    );
    expect(paths.filter((path) => path?.startsWith('incidents'))).toHaveLength(
      4,
    );
  });

  describe('the start page', () => {
    const route = (path: string) =>
      datatugRoutes.find((candidate) => candidate.path === path);

    it('has an address of its own, /home, behind the guard that keeps other profiles off it', () => {
      const home = route('home');
      expect(home?.canActivate).toEqual([profileStartPageGuard]);
      expect(home?.loadComponent).toBeTypeOf('function');
    });

    it('is also the root route, behind the guard that sends / to the profile home', () => {
      const root = route('');
      expect(root?.canActivate).toEqual([profileHomeRedirectGuard]);
      expect(root?.loadComponent).toBeTypeOf('function');
    });

    it('loads the same component at / and at /home', async () => {
      const [root, home] = await Promise.all([
        route('')?.loadComponent?.(),
        route('home')?.loadComponent?.(),
      ]);
      expect(home).toBeDefined();
      expect(home).toBe(root);
    });

    it('is where the datatug profile sends /, and every non-empty homePath is a route of this table', () => {
      expect(PRODUCT_PROFILES.datatug.homePath).toBe('home');
      const paths = datatugRoutes.map((candidate) => candidate.path);
      for (const profile of Object.values(PRODUCT_PROFILES)) {
        if (profile.homePath) {
          expect(paths, profile.id).toContain(profile.homePath);
        }
      }
    });
  });
});

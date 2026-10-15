import { PRODUCT_PROFILES } from '@datatug/product-profiles';
import { DefaultUrlSerializer, Route, UrlSegment } from '@angular/router';
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
  it('admits Space overview, queries, Checks, Detective and session routes', () => {
    const route = datatugRoutes.find(
      (candidate) =>
        candidate.path === 'space/:spaceId/store/:storeId/project/:projectId',
    );
    expect(route?.children?.map((child) => child.path)).toEqual([
      '',
      'overview',
      'sessions',
      'queries',
      'checks',
      'detective',
      'query',
    ]);
    const guard = route?.canMatch?.[0] as (
      route: Route | undefined,
      segments: UrlSegment[],
    ) => boolean;
    const matches = (parts: string[]) =>
      guard(
        route,
        parts.map((part) => new UrlSegment(part, {})),
      );
    const base = ['space', 'S1', 'store', 'firestore', 'project', 'P1'];
    expect(matches(base)).toBe(true);
    expect(matches([...base, 'queries'])).toBe(true);
    expect(matches([...base, 'checks'])).toBe(true);
    expect(matches([...base, 'checks', 'invoice-check'])).toBe(true);
    expect(matches([...base, 'detective'])).toBe(true);
    expect(matches([...base, 'detective', 'invoice-case'])).toBe(true);
    expect(matches([...base, 'detective', 'scenario', 'invoice-review'])).toBe(
      true,
    );
    expect(matches([...base, 'detective', 'scenario', 'bad.id'])).toBe(false);
    expect(matches([...base, 'query', 'genre-mix'])).toBe(true);
    expect(matches([...base, 'sessions'])).toBe(true);
    expect(matches([...base, 'sessions', 's1', 'composer'])).toBe(true);
    expect(matches([...base, 'sessions', 's1', 'checks', 'invoice-check'])).toBe(true);
    expect(matches([...base, 'sessions', 's1', 'detective', 'invoice-case'])).toBe(true);
    expect(matches([...base, 'sessions', 's1', 'query', 'genre-mix'])).toBe(true);
    const encoded = new DefaultUrlSerializer().parse(
      '/space/S1/store/firestore/project/P1/query/folder%2Fgenre-mix',
    );
    const encodedSegments = encoded.root.children['primary'].segments;
    expect(encodedSegments[7].path).toBe('folder/genre-mix');
    expect(guard(route, encodedSegments)).toBe(true);
    expect(matches([...base, 'query', 'folder', 'genre-mix'])).toBe(false);
    expect(matches([...base, 'query', '..'])).toBe(false);
    expect(matches([...base, 'chat'])).toBe(false);
    expect(matches([...base, 'sessions', 's1', 'env', 'local'])).toBe(false);
    expect(matches([...base, 'env', 'local'])).toBe(false);
  });
  it('places metadata recovery routes before content-guarded project routes', () => {
    expect(datatugRoutes.slice(0, 2).map(route => route.path)).toEqual(['native-check-status/:recoveryId', 'store/:storeId/native-check-status/:recoveryId']);
    for (const route of datatugRoutes.slice(0, 2)) { expect(route.canActivate).toBeUndefined(); expect(route.canMatch).toBeUndefined(); }
  });
  it('resolves a cold scenario URL before the Case detail route', async () => {
    const project = datatugRoutes.find(
      (candidate) =>
        candidate.path === 'space/:spaceId/store/:storeId/project/:projectId',
    );
    const detective = project?.children?.find(
      (candidate) => candidate.path === 'detective',
    );
    expect(detective?.children?.map((child) => child.path)).toEqual([
      'scenario/:scenarioId',
      '',
      ':caseId',
    ]);
    const detail = detective?.children?.[0];
    const component = await detail?.loadComponent?.();
    expect((component as { name?: string })?.name).toBe(
      'ScenarioDetailPageComponent',
    );
  });
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

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { PRODUCT_PROFILES } from '@datatug/product-profiles';
import {
  DefaultUrlSerializer,
  provideRouter,
  Route,
  UrlSegment,
} from '@angular/router';
import { datatugRoutes } from './datatug-routing.module';
import { hostedCloudLogsAccessGuard } from '../pages/my/cloud-logs/hosted-cloud-logs-access.service';
import {
  profileHomeRedirectGuard,
  profileStartPageGuard,
} from './profile-home-redirect.guard';
import {
  routingParamIncidentId,
  routingParamStoreId,
} from '../core/datatug-routing-params';

describe('datatugRoutes', () => {
  it('uses one composed auth-then-access guard for hosted Cloud Logging', async () => {
    const route = datatugRoutes.find(
      (candidate) => candidate.path === 'my/cloud-logs',
    );
    expect(route?.canMatch).toBeUndefined();
    expect(route?.canActivate).toEqual([hostedCloudLogsAccessGuard]);
    const component = await route?.loadComponent?.();
    expect((component as { name?: string })?.name).toBe(
      'CloudLogsPageComponent',
    );
  });

  it('keeps auth recovery unguarded and returns to the Cloud Logs gate', async () => {
    const route = datatugRoutes.find(
      (candidate) => candidate.path === 'my/cloud-logs/recovery',
    );
    expect(route?.canActivate).toBeUndefined();
    expect(route?.canMatch).toBeUndefined();
    const component = await route?.loadComponent?.();
    expect((component as { name?: string })?.name).toBe(
      'CloudLogsAuthRecoveryPageComponent',
    );
  });

  it('admits Space overview, Meanings, queries, Checks, Detective and session routes', () => {
    const route = datatugRoutes.find(
      (candidate) =>
        candidate.path === 'space/:spaceId/store/:storeId/project/:projectId',
    );
    expect(route?.children?.map((child) => child.path)).toEqual([
      'quick-search',
      'tag-discovery',
      'search-schema/:dbModelId',
      'meanings',
      'meanings/new-entity',
      'meanings/entity',
      'meanings/new-field',
      'meanings/field',
      '',
      'overview',
      'tags',
      'tag',
      'tag/:tag',
      'environments',
      'sources/:sourceId',
      'shipping',
      'boards/new',
      'board/:board',
      'board',
      'cards/new',
      'card/:cardId',
      'card',
      'cards',
      'boards',
      'sessions',
      'incidents',
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
    for (const path of ['', 'new-entity', 'entity', 'new-field', 'field']) {
      expect(matches([...base, 'meanings', ...(path ? [path] : [])])).toBe(
        true,
      );
    }
    expect(matches([...base, 'meanings', 'unknown'])).toBe(false);
    expect(matches([...base, 'meanings', 'field', 'extra'])).toBe(false);
    expect(matches([...base, 'queries'])).toBe(true);
    expect(matches([...base, 'quick-search'])).toBe(true);
    expect(matches([...base, 'tags'])).toBe(true);
    expect(matches([...base, 'search-schema', 'chinook'])).toBe(true);
    expect(matches([...base, 'search-schema', 'bad.id'])).toBe(false);
    expect(matches([...base, 'search-schema', 'chinook', 'extra'])).toBe(false);
    expect(matches([...base, 'incidents'])).toBe(true);
    expect(matches([...base, 'incidents', 'new'])).toBe(true);
    expect(
      matches([...base, 'incidents', 'detective-incidents-9c561d36', 'INC-1']),
    ).toBe(true);
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
    expect(
      matches([...base, 'sessions', 's1', 'checks', 'invoice-check']),
    ).toBe(true);
    expect(
      matches([...base, 'sessions', 's1', 'detective', 'invoice-case']),
    ).toBe(true);
    expect(matches([...base, 'sessions', 's1', 'query', 'genre-mix'])).toBe(
      true,
    );
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
    expect(datatugRoutes.slice(0, 2).map((route) => route.path)).toEqual([
      'native-check-status/:recoveryId',
      'store/:storeId/native-check-status/:recoveryId',
    ]);
    for (const route of datatugRoutes.slice(0, 2)) {
      expect(route.canActivate).toBeUndefined();
      expect(route.canMatch).toBeUndefined();
    }
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
      'scenarios/:scenarioId',
      'scenario/:scenarioId',
      '',
      ':caseId',
    ]);
    const publicDetail = detective?.children?.[0];
    const publicComponent = await publicDetail?.loadComponent?.();
    expect((publicComponent as { name?: string })?.name).toBe(
      'PublicScenariosPageComponent',
    );
    const detail = detective?.children?.[1];
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

describe('shared project Environments deep links', () => {
  @Component({ template: 'Environment route reached' })
  class EnvironmentRouteProbe {}

  const base =
    '/space/3p39p/store/firestore/project/detective-demo-3226069691b6b181451c6a1c';
  const projectRoute = () => {
    const route = datatugRoutes.find(
      (candidate) =>
        candidate.path === 'space/:spaceId/store/:storeId/project/:projectId',
    );
    if (!route) throw new Error('Shared project route missing');
    return route;
  };

  it('registers the existing Environments page as a leaf in the shared project', async () => {
    const environment = projectRoute().children?.find(
      (child) => child.path === 'environments',
    );
    expect(environment).toBeDefined();
    expect(environment?.children).toBeUndefined();
    expect(environment?.loadChildren).toBeUndefined();
    const component = await environment?.loadComponent?.();
    expect((component as { name?: string })?.name).toBe(
      'EnvironmentsPageComponent',
    );
  });

  beforeEach(() => {
    const route = projectRoute();
    // Keep the production parent matcher and actual child route shape. Only
    // replace the DI-heavy leaf view; its real lazy loader is checked above.
    const children = route.children
      ?.filter((child) => child.path === 'environments')
      .map((child) => ({
        ...child,
        loadComponent: undefined,
        component: EnvironmentRouteProbe,
      }));
    TestBed.configureTestingModule({
      providers: [provideRouter([{ ...route, children }])],
    });
  });

  it('navigates the reported cold deep link through the production matcher', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(base + '/environments', EnvironmentRouteProbe);
    expect(harness.routeNativeElement?.textContent).toBe(
      'Environment route reached',
    );
  });

  it.each([
    base + '/environments/unknown',
    base + '/environments/new',
    base + '/environments;unexpected=value',
    base.replace('3p39p', 'bad.space') + '/environments',
    base.replace('firestore', 'github.com') + '/environments',
    base.replace('detective-demo-3226069691b6b181451c6a1c', 'bad.project') +
      '/environments',
    base.replace('3p39p', '3p39p;unexpected=value') + '/environments',
    base + '/unknown',
  ])('rejects unsupported or malformed deep link %s', async (url) => {
    const harness = await RouterTestingHarness.create();
    await expect(harness.navigateByUrl(url)).rejects.toThrow(
      /Cannot match any routes/,
    );
    expect(harness.routeNativeElement).toBeNull();
  });
});

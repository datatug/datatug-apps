import { ShippingComponentApiService } from '../shipping/shipping-component-api.service';
import { TestBed } from '@angular/core/testing';
import { Router, RouterLink, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { PRODUCT_PROFILE, PRODUCT_PROFILES } from '@datatug/product-profiles';
import { ProjectMenuComponent } from '../components/project/project-menu/project-menu.component';
import { DatatugUserService } from '../services/base/datatug-user-service';
import { BehaviorSubject, of } from 'rxjs';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { datatugRoutes } from './datatug-routing.module';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { ShippingApiService } from '../shipping/shipping-api.service';
import { ShippingWorkspaceComponent } from '../shipping/shipping-workspace.component';
import { HostedBoardWorkspaceComponent } from '../board/ui/pages/board/hosted-board-workspace.component';
import { BoardPageComponent } from '../board/ui/pages/board/board-page.component';
import { BoardsPageComponent } from '../board/ui/pages/boards/boards-page.component';
import { ProjectAssetsReadService } from '../services/project/project-assets-read.service';
import { ProjectAssetsApiService } from '../services/project/project-assets-api.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import { ParameterLookupService } from '../components/parameters/parameter-lookup.service';
import { QueryParamsService } from '../core/services/QueryParamsService';
import { TutorialBoardRuntime } from '../board/core/tutorial-board-runtime';
import { projectPageHref } from '../nav/project-page-href';

const ref = { storeId: 'firestore', spaceID: 'S1', projectId: 'same' };
const base = '/space/S1/store/firestore/project/same';
describe('actual native Space router workspaces', () => {
  const shipping = { revision: vi.fn(), action: vi.fn() };
  const hostedAssets = { board: vi.fn(), boards: vi.fn() };
  const legacyAssets = { board: vi.fn(), boards: vi.fn() };
  beforeEach(() => {
    sessionStorage.clear();
    shipping.action.mockReset();
    shipping.revision.mockReset().mockReturnValue(
      of({
        generation: 'g1',
        revision: 1,
        sha256: 'a'.repeat(64),
        configuration: 17,
        artifacts: [],
      }),
    );
    hostedAssets.board.mockReset().mockReturnValue(
      of({
        board: { id: 'operations', title: 'Operations', rows: [] },
        revision: 'rev1',
      }),
    );
    hostedAssets.boards.mockReset().mockReturnValue(of([]));
    legacyAssets.board.mockReset();
    legacyAssets.boards.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    );
    const project = new BehaviorSubject({ ref });
    TestBed.configureTestingModule({
      imports: [ProjectMenuComponent],
      providers: [
        {
          provide: ShippingComponentApiService,
          useValue: {
            current: () =>
              of({
                available: {
                  componentId: 'shipping-investigation',
                  version: 1,
                  digest: 'a'.repeat(64),
                  sourceCommit: 'cb841345e88d01229857b2bdb51cc07f4ef4bec7',
                },
                exists: false,
              }),
          },
        },
        // The actual production Space parent/children are used, not a parallel
        // fixture route list, guard invocation, or replacement page template.
        provideRouter(
          datatugRoutes.filter((r) => r.path?.startsWith('space/')),
        ),
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({
              status: 'authenticated',
              user: { uid: 'sarah' },
            }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: project,
            currentEnv: of(undefined),
            currentStoreId: of('firestore'),
            currentFolder: of('overview'),
            setCurrentEnvironment: vi.fn(),
          },
        },
        { provide: DatatugNavService, useValue: {} },
        { provide: DatatugUserService, useValue: { datatugUserState: of({}) } },
        { provide: PRODUCT_PROFILE, useValue: PRODUCT_PROFILES.datatug },
        { provide: AgentContextService, useValue: {} },
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: () => vi.fn() },
        },
        {
          provide: DetectiveClientService,
          useValue: {
            state: () =>
              of({
                environments: ['training'],
                capabilities: { canRead: true, canWrite: true },
              }),
          },
        },
        { provide: ShippingApiService, useValue: shipping },
        { provide: ProjectAssetsReadService, useValue: legacyAssets },
        {
          provide: ProjectAssetsApiService,
          useValue: hostedAssets,
        },
        {
          provide: ProjectQueryApiService,
          useValue: { folder: () => of({ id: '~', items: [] }) },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: {
        providers: [
          QueryParamsService,
          TutorialBoardRuntime,
          { provide: ParameterLookupService, useValue: {} },
        ],
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('cold-opens the actual shipping page at the scoped overview destination', async () => {
    const h = await RouterTestingHarness.create();
    const destination = projectPageHref(ref, 'shipping');
    expect(destination).toBe(`${base}/shipping`);
    await h.navigateByUrl(destination, ShippingWorkspaceComponent);
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain(
        'Routing configuration 17',
      ),
    );
    expect(h.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe(
      `${base}/overview`,
    );
    expect(shipping.revision).toHaveBeenCalledWith(ref);
    expect(shipping.action).not.toHaveBeenCalled();
  });
  it('opens the actual installed Board from shipping setup and cold URL without executing a query', async () => {
    TestBed.overrideProvider(ShippingComponentApiService, {
      useValue: {
        current: () =>
          of({
            available: {
              componentId: 'shipping-investigation',
              version: 1,
              digest: 'a'.repeat(64),
              sourceCommit: 'cb841345e88d01229857b2bdb51cc07f4ef4bec7',
            },
            exists: true,
            installation: {
              boardIds: ['shipping'],
              checkIds: ['shipping-request-received'],
            },
          }),
      },
    });
    TestBed.overrideProvider(DetectiveClientService, {
      useValue: {
        state: () =>
          of({
            environments: ['demo'],
            capabilities: { canRead: true, canWrite: true },
          }),
      },
    });
    hostedAssets.board.mockReturnValue(
      of({
        board: { id: 'shipping', title: 'Shipping investigation', rows: [] },
        revision: 'shipping-rev',
      }),
    );
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(`${base}/shipping`, ShippingWorkspaceComponent);
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain(
        'Open shipping board',
      ),
    );
    expect(
      h.routeNativeElement?.querySelector(
        'sneat-datatug-shipping-query-access',
      ),
    ).toBeTruthy();
    expect(
      h.routeNativeElement?.querySelector('sneat-shipping-component-installer'),
    ).toBeTruthy();
    const router = TestBed.inject(Router);
    const destination = h.routeDebugElement
      ?.queryAll(By.directive(RouterLink))
      .map((item) => item.injector.get(RouterLink).urlTree)
      .find(
        (tree) =>
          tree &&
          router.serializeUrl(tree) ===
            `${base}/board/shipping?environment=demo`,
      );
    if (!destination)
      throw new Error('Missing actual installed Board destination');
    await h.navigateByUrl(router.serializeUrl(destination), BoardPageComponent);
    await vi.waitFor(() =>
      expect(hostedAssets.board).toHaveBeenCalledWith(ref, 'demo', 'shipping'),
    );
    expect(
      h.routeNativeElement?.querySelector(
        'sneat-datatug-hosted-board-workspace',
      ),
    ).toBeTruthy();
    await h.navigateByUrl(`${base}/boards`, BoardsPageComponent);
    await h.navigateByUrl(
      `${base}/board/shipping?environment=demo`,
      BoardPageComponent,
    );
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain(
        'Shipping investigation',
      ),
    );
    expect(legacyAssets.board).not.toHaveBeenCalled();
    expect(shipping.action).not.toHaveBeenCalled();
  });
  it('cold-opens the real native Boards list and its existing canonical hosted list', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(projectPageHref(ref, 'boards'), BoardsPageComponent);
    expect(
      h.routeNativeElement?.querySelector('sneat-datatug-hosted-board-list'),
    ).toBeTruthy();
    expect(
      h.routeNativeElement?.querySelector(
        'ion-select[aria-label="Board environment"]',
      ),
    ).toBeTruthy();
    expect(legacyAssets.boards).not.toHaveBeenCalled();
  });
  it.each([
    'boards/new',
    'board/operations',
    'boards/new?environment=training',
    'board/operations?environment=training',
  ])(
    'cold-opens %s in the real canonical Board page and hosted editor',
    async (path) => {
      const h = await RouterTestingHarness.create();
      await h.navigateByUrl(`${base}/${path}`, BoardPageComponent);
      expect(
        h.routeNativeElement?.querySelector(
          'sneat-datatug-hosted-board-workspace',
        ),
      ).toBeTruthy();
      expect(
        h.routeNativeElement?.querySelector(
          'ion-select[aria-label="Board environment"]',
        ),
      ).toBeTruthy();
      expect(
        h.routeNativeElement?.querySelector('[data-board-page-heading]'),
      ).toBeNull();
      expect(h.routeNativeElement?.textContent).not.toContain(
        'Board details are unavailable for this shared Space project.',
      );
      expect(legacyAssets.board).not.toHaveBeenCalled();
      if (path === 'boards/new')
        expect(h.routeNativeElement?.textContent).toContain('New board');
    },
  );
  it('cold-loads the actual scoped Board identity and explicit environment into the canonical hosted renderer', async () => {
    const h = await RouterTestingHarness.create();
    const page = await h.navigateByUrl(
      `${base}/board/operations?environment=training`,
      BoardPageComponent,
    );
    expect(page.boardId()).toBe('operations');
    const workspace = h.routeDebugElement?.query(
      By.directive(HostedBoardWorkspaceComponent),
    )?.componentInstance as HostedBoardWorkspaceComponent | undefined;
    if (!workspace) throw new Error('Missing actual hosted Board workspace.');
    await vi.waitFor(() => expect(workspace.draft()?.title).toBe('Operations'));
    expect(hostedAssets.board).toHaveBeenCalledWith(
      ref,
      'training',
      'operations',
    );
    await h.fixture.whenStable();
    expect(
      h.routeNativeElement?.querySelector('sneat-datatug-board'),
    ).toBeTruthy();
    expect(legacyAssets.board).not.toHaveBeenCalled();
  });
  it('refreshes the current native catalog when Ionic re-enters the cached Boards page', async () => {
    const h = await RouterTestingHarness.create();
    const page = await h.navigateByUrl(
      `${base}/boards?environment=training`,
      BoardsPageComponent,
    );
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain('No boards yet.'),
    );
    const reads = hostedAssets.boards.mock.calls.length;
    hostedAssets.boards.mockReturnValue(
      of([{ id: 'durably-created', title: 'Created while away' }]),
    );
    page.ionViewWillEnter();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    await vi.waitFor(() =>
      expect(h.routeNativeElement?.textContent).toContain('Created while away'),
    );
    expect(hostedAssets.boards.mock.calls.length).toBeGreaterThan(reads);
    expect(hostedAssets.boards).toHaveBeenLastCalledWith(ref, 'training');
    expect(h.routeNativeElement?.textContent).not.toContain('No boards yet.');
    expect(legacyAssets.boards).not.toHaveBeenCalled();
  });
  it('resolves the actual rendered native menu Boards destination to its existing real page', async () => {
    const h = await RouterTestingHarness.create();
    const menu = TestBed.createComponent(ProjectMenuComponent);
    menu.componentRef.setInput('metadataOnly', true);
    menu.detectChanges();
    await menu.whenStable();
    const router = TestBed.inject(Router);
    const destination = menu.debugElement
      .queryAll(By.directive(RouterLink))
      .map((item) => item.injector.get(RouterLink).urlTree)
      .find((tree) => tree && router.serializeUrl(tree) === `${base}/boards`);
    if (!destination)
      throw new Error('Native menu has no scoped Boards destination.');
    await h.navigateByUrl(
      router.serializeUrl(destination),
      BoardsPageComponent,
    );
    expect(
      h.routeNativeElement?.querySelector('sneat-datatug-hosted-board-list'),
    ).toBeTruthy();
    menu.destroy();
  });
  it('redirects only the exact native board alias to the real Boards list', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(`${base}/board`, BoardsPageComponent);
    expect(TestBed.inject(Router).url).toBe(`${base}/boards`);
  });
  it.each([
    '/space/S1/store/github.com/project/same/boards',
    '/space/S1/store/firestore/project/same/boards/other',
    '/space/S1/store/firestore/project/same/boards/new/extra',
    '/space/S1/store/firestore/project/same/board/operations/extra',
    '/space/S1/store/firestore/project/same/board/folder%2Foperations',
    '/space/S1/store/firestore/project/same/shipping/extra',
    '/space/S1/store/firestore/project/same/shipping;x=1',
    '/space/%2F/store/firestore/project/same/shipping',
    '/space/S1/store/firestore/project/same/sessions/s1/shipping',
    '/space/S1/store/firestore/project/same/sessions/s1/boards',
    '/space/S1/store/firestore/project/same/sessions/s1/boards/new',
    '/space/S1/store/firestore/project/same/sessions/s1/board/operations',
  ])(
    'rejects unsupported or malformed native address %s through actual Router matching',
    async (url) => {
      const h = await RouterTestingHarness.create();
      await expect(h.navigateByUrl(url)).rejects.toThrow(
        /NG04002|Cannot match/,
      );
      expect(shipping.revision).not.toHaveBeenCalled();
      expect(shipping.action).not.toHaveBeenCalled();
      expect(legacyAssets.board).not.toHaveBeenCalled();
    },
  );
});

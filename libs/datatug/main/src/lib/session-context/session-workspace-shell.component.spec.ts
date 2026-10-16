import { Component, input } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AuthPanelComponent } from '@sneat/auth-ui';
import { BehaviorSubject, Subject } from 'rxjs';
import { SessionContextApiService } from './session-context-api.service';
import { ContextCapabilities, ContextSession, contextScopeKey } from './session-context-contract';
import { LegacyContextImportService } from './legacy-context-import.service';
import { SessionWorkspaceShellComponent } from './session-workspace-shell.component';
import { SESSION_DEVICE_DRAFTS, SessionWorkspaceService } from './session-workspace.service';

@Component({ selector: 'sneat-auth-panel', template: '', standalone: true })
class AuthPanelStubComponent {
  readonly returnTo = input<string | undefined>();
  readonly initialMode = input<'sign-in' | 'sign-up'>();
  readonly showIntro = input(true);
}

describe('SessionWorkspaceShellComponent auth lifecycle', () => {
  let fixture: ComponentFixture<SessionWorkspaceShellComponent>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let routeQuery: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;
  let api: { capabilities: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> };
  const environment = { environmentId: 'uat', identityDomain: 'workspace' };
  const caps: ContextCapabilities = {
    schemaVersion: 1,
    actorId: 'actor-1',
    databaseId: 'ops',
    projectId: 'shop',
    environments: [environment],
    actions: ['createSession'],
  };
  const projectUrl = '/project/http-localhost:8989/shop/tree/HEAD/demo/-/sessions';

  beforeEach(async () => {
    authState = new BehaviorSubject({ status: 'notAuthenticated' });
    api = {
      capabilities: vi.fn()
        .mockRejectedValueOnce(SneatApiNotAuthenticatedError)
        .mockResolvedValue(caps),
      list: vi.fn(async () => ({ items: [], hasMore: false })),
      command: vi.fn(),
    };
    const params = routeParams = new BehaviorSubject(convertToParamMap({ storeId: 'github.com', projectId: 'shop' }));
    const query = routeQuery = new BehaviorSubject(convertToParamMap({}));
    const route = {
      paramMap: params.asObservable(),
      queryParamMap: query.asObservable(),
      snapshot: { paramMap: params.value, queryParamMap: query.value },
    };
    const routerEvents = new Subject<unknown>();
    const router = {
      url: projectUrl,
      events: routerEvents.asObservable(),
      routerState: { snapshot: { root: { paramMap: convertToParamMap({}), firstChild: null } } },
      createUrlTree: vi.fn(() => ({})),
      parseUrl: vi.fn(() => ({ queryParams: {} })),
      navigateByUrl: vi.fn(async () => true),
      serializeUrl: vi.fn(() => projectUrl),
    };

    await TestBed.configureTestingModule({
      imports: [SessionWorkspaceShellComponent],
      providers: [
        SessionWorkspaceService,
        { provide: SessionContextApiService, useValue: { ...api, read: vi.fn(), operation: vi.fn(), run: vi.fn() } },
        { provide: SESSION_DEVICE_DRAFTS, useValue: { read: vi.fn(), write: vi.fn(), readPending: vi.fn(), writePending: vi.fn(), removePending: vi.fn() } },
        { provide: LegacyContextImportService, useValue: {} },
        { provide: SneatAuthStateService, useValue: { authState: authState.asObservable() } },
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
      ],
    }).overrideComponent(SessionWorkspaceShellComponent, {
      remove: { imports: [AuthPanelComponent] },
      add: { imports: [AuthPanelStubComponent] },
    }).compileComponents();
    fixture = TestBed.createComponent(SessionWorkspaceShellComponent);
    fixture.detectChanges();
  });

  it('refreshes capabilities after sign-in while the Sessions URL stays unchanged', async () => {
    const workspace = TestBed.inject(SessionWorkspaceService);
    await fixture.whenStable();
    expect(api.capabilities).toHaveBeenCalledTimes(1);
    expect(workspace.authRequired()).toBe(true);
    expect(workspace.capabilities()).toBeUndefined();
    expect(fixture.componentInstance.signInReturnTo()).toBe(projectUrl);
    fixture.componentInstance.chooserOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const authPanel = fixture.debugElement.query(By.directive(AuthPanelStubComponent))
      .componentInstance as AuthPanelStubComponent;
    expect(authPanel.initialMode()).toBe('sign-in');
    expect(authPanel.returnTo()).toBe(projectUrl);

    authState.next({ status: 'authenticated', user: { uid: 'actor-1' } });
    await vi.waitFor(() => expect(workspace.capabilities()).toEqual(caps));
    await fixture.whenStable();

    expect(api.capabilities).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(workspace.authRequired()).toBe(false);
    expect(workspace.capabilities()).toEqual(caps);
    expect(workspace.sessions()).toEqual([]);
  });

  it('offers fresh CLI link instructions and read-only retry for local agent 401', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    api.capabilities.mockRejectedValueOnce({ status: 401 });
    routeParams.next(convertToParamMap({ storeId: 'http-localhost:8989', projectId: 'shop' }));
    await vi.waitFor(() => expect(workspace.agentReconnectRequired()).toBe(true));
    fixture.componentInstance.chooserOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(workspace.agentReconnectRequired()).toBe(true);
    expect(workspace.authRequired()).toBe(false);
    expect(fixture.debugElement.query(By.directive(AuthPanelStubComponent))).toBeNull();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open a fresh DataTug link from your CLI'));
    expect(document.body.textContent).toContain('Retry loading sessions');
    const retry = [...document.body.querySelectorAll('ion-button')].find(button => button.textContent?.includes('Retry loading sessions'));
    if (!retry) throw new Error('Missing agent admission retry');
    retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(workspace.capabilities()).toEqual(caps));
    expect(api.capabilities).toHaveBeenLastCalledWith({ storeId: 'http-localhost:8989', projectId: 'shop' });
    expect(api.command).not.toHaveBeenCalled();
  });

  it.each([
    ['createSession is unsupported', { ...caps, actions: [] }],
    ['no environment is admitted', { ...caps, environments: [] }],
  ])('does not offer session creation when %s', async (_reason, capabilities) => {
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.capabilities.set(capabilities);
    component.chooserOpen.set(true);
    fixture.detectChanges();

    const newSessionButtons = [...fixture.nativeElement.querySelectorAll('ion-button')]
      .filter((button: HTMLElement) => button.textContent?.trim() === 'New session') as Array<HTMLIonButtonElement>;
    expect(newSessionButtons.length).toBeGreaterThan(0);
    expect(newSessionButtons.every((button) => button.disabled)).toBe(true);

    component.beginCreate();
    expect(component.createOpen()).toBe(false);
    component.titleDraft.set('Must not be created');
    component.scopeDraft.set(contextScopeKey(environment));
    await component.saveCreate();
    expect(component.createOpen()).toBe(false);
    expect(api.command).not.toHaveBeenCalled();
  });

  it('allows creation when the capability and an admitted environment are available', async () => {
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.capabilities.set(caps);

    expect(component.canCreateSession()).toBe(true);
    component.chooserOpen.set(false);
    await component.beginCreate();
    expect(component.createOpen()).toBe(true);
  });

  it('explains the Sessions root and offers a first action before opening the chooser', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.authRequired.set(false);
    workspace.capabilities.set(caps);
    fixture.detectChanges();

    expect(component.chooserOpen()).toBe(false);
    const start = fixture.nativeElement.querySelector('.session-start') as HTMLElement;
    expect(start.querySelector('h1')?.outerHTML).toContain('Sessions');
    expect(start.querySelector('p')?.outerHTML).toContain('Start a session to keep queries and context together');
    const openButton = fixture.nativeElement.querySelector('.session-primary-actions > ion-button') as HTMLElement;
    expect(openButton.outerHTML).toContain('Open a session');
    openButton.click();
    expect(component.chooserOpen()).toBe(true);
  });

  it('does not promise session creation when the project only admits browsing', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    workspace.authRequired.set(false);
    workspace.capabilities.set({ ...caps, actions: [] });
    workspace.sessions.set([{
      schemaVersion: 1, id: 'saved-1', databaseId: 'ops', projectId: 'shop', owner: 'actor-1',
      title: 'Saved session', state: 'stopped', version: 1, defaultBagId: 'bag-1', contextSetId: 'set-1',
      bagIds: ['bag-1'], createdAt: '', updatedAt: '',
    }]);
    fixture.detectChanges();

    const start = fixture.nativeElement.querySelector('.session-start') as HTMLElement;
    expect(start.querySelector('p')?.outerHTML).toContain('Open a saved session');
    expect(start.querySelector('p')?.outerHTML).not.toContain('start a new session');
    const newSession = [...fixture.nativeElement.querySelectorAll('ion-button')]
      .find((button: HTMLElement) => button.outerHTML.includes('New session')) as HTMLIonButtonElement;
    expect(newSession.disabled).toBe(true);
  });

  it('only offers loading more sessions when another page exists', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    workspace.authRequired.set(false);
    workspace.capabilities.set({ ...caps, actions: [] });
    fixture.detectChanges();
    const start = fixture.nativeElement.querySelector('.session-start p') as HTMLElement;
    expect(start.outerHTML).toContain('check availability and connection requirements');
    expect(start.outerHTML).not.toContain('load more');

    workspace.hasMore.set(true);
    fixture.detectChanges();
    expect(start.outerHTML).toContain('load more');
  });

  it('dismisses the real chooser before presenting create and waits for create didDismiss before navigation', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.capabilities.set(caps);
    component.chooserOpen.set(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(component.chooserPresented()).toBe(true));
    const chooserDismissed = component.chooserModal()?.onDidDismiss();
    const opening = component.beginCreate();
    expect(component.createOpen()).toBe(false);
    await chooserDismissed;
    await opening;
    expect(component.chooserOpen()).toBe(false);
    await vi.waitFor(() => expect(component.createPresented()).toBe(true));
    component.titleDraft.set('New session');
    const focus = vi.spyOn(workspace, 'focus').mockResolvedValue();
    vi.spyOn(workspace, 'create').mockResolvedValue('new-session');
    const router = TestBed.inject(Router);
    router.parseUrl = vi.fn(() => ({ queryParams: {} }) as ReturnType<Router['parseUrl']>);
    const navigate = vi.fn(async () => true);
    router.navigateByUrl = navigate;
    let actuallyDismissed = false;
    const dismissed = component.createModal()?.onDidDismiss().then(() => { actuallyDismissed = true; });
    focus.mockImplementation(async () => { expect(actuallyDismissed).toBe(true); });
    const saving = component.saveCreate();
    expect(focus).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await dismissed;
    await saving;
    expect(component.createPresented()).toBe(false);
    expect(component.chooserPresented()).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed create open and preserves normal cancellation cleanup', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.capabilities.set(caps);
    component.chooserOpen.set(false);
    await component.beginCreate();
    await vi.waitFor(() => expect(component.createPresented()).toBe(true));
    component.titleDraft.set('Failed session');
    vi.spyOn(workspace, 'create').mockImplementation(async () => { workspace.error.set('Save failed'); return undefined; });
    const focus = vi.spyOn(workspace, 'focus');
    await component.saveCreate();
    expect(component.createOpen()).toBe(true);
    expect(component.createPresented()).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    const dismissed = component.createModal()?.onDidDismiss();
    component.createOpen.set(false);
    await dismissed;
    expect(component.createPresented()).toBe(false);
    expect(component.renameTarget()).toBeUndefined();
    expect(component.addBagOpen()).toBe(false);
  });

  it('keeps Context in the primary action group and secondary actions independently operable', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    const component = fixture.componentInstance;
    workspace.capabilities.set({ ...caps, nativeDetective: true });
    vi.spyOn(workspace, 'session').mockReturnValue({ schemaVersion: 1, id: 'session-1', databaseId: 'ops', projectId: 'shop', owner: 'actor-1', title: 'Saved session', state: 'stopped', version: 1, defaultBagId: 'bag-1', contextSetId: 'set-1', bagIds: ['bag-1'], createdAt: '', updatedAt: '' });
    vi.spyOn(workspace, 'appliedCount').mockReturnValue(3);
    fixture.detectChanges();
    await fixture.whenStable();
    const primary = fixture.nativeElement.querySelector('.session-primary-actions');
    const secondary = fixture.nativeElement.querySelector('.session-secondary-actions');
    expect(primary.textContent).toContain('All sessions');
    expect(primary.textContent).toContain('Context · 3 applied');
    expect(primary.textContent).not.toContain('Run history');
    await vi.waitFor(() => expect(secondary.textContent).toContain('Checks'));
    expect(secondary.textContent).toContain('Cases');
    expect(secondary.textContent).toContain('Run history');
    expect(secondary.textContent).toContain('Resume');
    primary.querySelector('.session-context-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(component.drawerOpen()).toBe(true);
  });

  it('keeps Context Bag controls locked until the mapped field picker is dismissed', () => {
    const component = fixture.componentInstance;
    expect(component.canDismissContextBag()).toBe(true);
    component.onMappedFieldPickerOpen();
    expect(component.canDismissContextBag()).toBe(false);
    component.onMappedFieldPickerDismiss();
    expect(component.canDismissContextBag()).toBe(true);
  });

  it('keeps loaded sessions available after a later workspace error', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    const session: ContextSession = {
      schemaVersion: 1, id: 'session-1', databaseId: 'ops', projectId: 'shop', owner: 'actor-1',
      title: 'Saved session', state: 'stopped', version: 1, defaultBagId: 'bag-1', contextSetId: 'set-1',
      bagIds: ['bag-1'], createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
    };
    workspace.capabilities.set(caps);
    workspace.sessions.set([session]);
    workspace.loading.set(true);
    workspace.error.set('The next page could not be loaded.');
    workspace.authRequired.set(false);

    expect(fixture.componentInstance.visibleSessions()).toEqual([session]);
    expect(fixture.componentInstance.showInitialLoading()).toBe(false);
    expect(fixture.componentInstance.showInitialLoadError()).toBe(false);
  });

  it('preserves project route qualifiers when closing the last session tab', async () => {
    await fixture.whenStable();
    routeParams.next(convertToParamMap({ storeId: 'http-localhost:8989', projectId: 'shop' }));
    routeQuery.next(convertToParamMap({ projectApi: 'local', branch: 'release' }));
    const route = TestBed.inject(ActivatedRoute) as unknown as { snapshot: { queryParams: Record<string, string> } };
    route.snapshot.queryParams = { projectApi: 'local', branch: 'release', environment: 'prod' };
    const router = TestBed.inject(Router) as unknown as { parseUrl: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
    router.parseUrl.mockReturnValue({ queryParams: {} });
    const workspace = TestBed.inject(SessionWorkspaceService);
    vi.spyOn(workspace, 'closeTab').mockResolvedValue('');

    await fixture.componentInstance.closeSession('last-tab');

    expect(router.parseUrl).toHaveBeenCalledWith(expect.stringContaining('/sessions'));
    expect(router.navigateByUrl.mock.calls.at(-1)?.[0].queryParams).toEqual({
      projectApi: 'local', branch: 'release', environment: 'prod',
    });
  });

  it('cancels an in-flight all-pages search when the query changes', async () => {
    await fixture.whenStable();
    const workspace = TestBed.inject(SessionWorkspaceService);
    await workspace.openProject({ storeId: 'http-localhost:8989', projectId: 'other' });
    workspace.hasMore.set(true);
    workspace.nextCursor.set('next');
    let resolvePage!: (page: { items: readonly ContextSession[]; hasMore: boolean }) => void;
    api.list.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }));
    const search = workspace.searchAllSessions();
    await vi.waitFor(() => expect(resolvePage).toBeTypeOf('function'));

    fixture.componentInstance.onSessionSearchChange('different term');
    resolvePage({ items: [{ schemaVersion: 1, id: 'late', owner: 'actor-1', databaseId: 'ops', projectId: 'shop', title: 'late', state: 'active', version: 1, defaultBagId: 'bag-1', contextSetId: 'set-1', bagIds: ['bag-1'], createdAt: '', updatedAt: '' }], hasMore: false });
    await search;

    expect(fixture.componentInstance.sessionSearch()).toBe('different term');
    expect(workspace.sessions().some((session) => session.id === 'late')).toBe(false);
  });
});

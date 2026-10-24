import { TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { WatchPageComponent } from './watch-page.component';
import { WatchClientService } from './watch-client.service';
import { ProjectService } from '../services/project/project.service';
import { ProjectEnvironmentStateService } from '../services/project/project-environment-state.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import type { WatchDefinition, WatchIdentity } from './watch.models';

const identity: WatchIdentity = {
  id: 'alice',
  hosted: true,
  spaceID: 's',
  namespace: 's',
  project: 'p',
  environment: 'dev',
  sharedEditor: true,
  tier: 'free',
  channels: { in_app: true, email: true, sms: false, telegram: false },
  limits: { emailPerDay: 50, smsPerDay: 10 },
};
const definition: WatchDefinition = {
  ...identity,
  id: 'w',
  version: 1,
  title: 'Private source health',
  owner: 'alice',
  visibility: 'personal',
  checkId: 'check',
  checkVersion: '1',
  schedule: { intervalSeconds: 60 },
  trigger: 'becomes_false',
  initialObservation: 'baseline',
  mode: 'continuous',
  lifecycle: 'enabled',
  enabled: true,
  notificationPolicy: { recovery: true },
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
};

describe('Hosted Watch account and environment lifecycle', () => {
  let auth: BehaviorSubject<{ status: string; user?: { uid: string } }>;
  let project: BehaviorSubject<{
    ref: { storeId: string; spaceID: string; projectId: string };
  }>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let client: ReturnType<typeof makeClient>;
  const read = vi.fn(),
    summary = vi.fn();
  function makeClient() {
    const current = signal<WatchIdentity | undefined>(undefined);
    const connectionOwner = signal<object | undefined>(undefined);
    return {
      identity: current,
      connectionOwner,
      ownsConnection: vi.fn((owner: object) => connectionOwner() === owner),
      disconnect: vi.fn(() => {
        connectionOwner.set(undefined);
        current.set(undefined);
      }),
      disconnectOwned: vi.fn((owner: object) => {
        if (connectionOwner() === owner) {
          connectionOwner.set(undefined);
          current.set(undefined);
        }
      }),
      refreshIdentity: vi.fn(async () => current()),
      connectHosted: vi.fn(
        async (
          ref: { spaceID: string; projectId: string },
          environment: string,
          principal: string,
          owner: object,
        ) => {
          connectionOwner.set(owner);
          current.set({
            ...identity,
            id: principal,
            namespace: ref.spaceID,
            spaceID: ref.spaceID,
            project: ref.projectId,
            environment,
          });
        },
      ),
      definitions: vi.fn(async () => ({ definitions: [definition] })),
      definition: vi.fn(async () => ({ definition })),
      status: vi.fn(async () => ({
        coordinator: 'online',
        runners: [],
        observations: [],
      })),
      inbox: vi.fn(async () => ({ notifications: [] })),
      runs: vi.fn(async () => ({ runs: [] })),
      deliveries: vi.fn(async () => ({ deliveries: [] })),
      subscription: vi.fn(async () => ({
        subscription: { watchId: 'w', channels: ['email'] },
      })),
      setupNotice: signal(''),
      seed: undefined,
      seedMatches: vi.fn(() => false),
      save: vi.fn(async (d: WatchDefinition) => ({
        definition: { ...d, id: 'returned-watch', version: 1 },
      })),
      subscribe: vi.fn(async () => ({ ok: true })),
      lifecycle: vi.fn(async (d: WatchDefinition) => ({
        definition: { ...d, enabled: true, lifecycle: 'enabled' },
      })),
    };
  }
  beforeEach(() => {
    auth = new BehaviorSubject<{ status: string; user?: { uid: string } }>({
      status: 'authenticated',
      user: { uid: 'alice' },
    });
    project = new BehaviorSubject({
      ref: { storeId: 'firestore', spaceID: 's', projectId: 'p' },
    });
    query = new BehaviorSubject(convertToParamMap({ env: 'dev' }));
    client = makeClient();
    read.mockReset().mockReturnValue(
      of({
        environments: [
          { id: 'dev', title: 'Development' },
          { id: 'prod', title: 'Production' },
        ],
      }),
    );
    summary.mockReset();
  });
  async function mount(path = 'watch/:watchId', waitReady = true) {
    const params = convertToParamMap(
      path === 'watch/:watchId' ? { watchId: 'w' } : {},
    );
    TestBed.configureTestingModule({
      imports: [WatchPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            routeConfig: { path },
            snapshot: { paramMap: params, queryParamMap: query.value },
            paramMap: new BehaviorSubject(params),
            queryParamMap: query,
          },
        },
        { provide: WatchClientService, useValue: client },
        { provide: ProjectService, useValue: { watchProjectSummary: summary } },
        { provide: ProjectEnvironmentStateService, useValue: { read } },
        {
          provide: DetectiveClientService,
          useValue: {
            state: () =>
              of({
                checks: [
                  {
                    id: 'check',
                    title: 'Source health',
                    version: 1,
                    inputs: [],
                    steps: [],
                  },
                ],
              }),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project, currentEnv: of(undefined) },
        },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: AgentContextService, useValue: {} },
      ],
    }).overrideComponent(WatchPageComponent, {
      set: {
        imports: [DatePipe, RouterLink],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
      },
    });
    const fixture = TestBed.createComponent(WatchPageComponent);
    fixture.detectChanges();
    if (waitReady)
      await vi.waitFor(() =>
        expect(
          (
            fixture.componentInstance as unknown as {
              manifestLoading: () => boolean;
            }
          ).manifestLoading(),
        ).toBe(false),
      );
    await fixture.whenStable();
    return fixture;
  }
  it('cold-loads hosted details without a manifest and keeps environment in links', async () => {
    const fixture = await mount();
    await vi.waitFor(() => expect(client.definition).toHaveBeenCalledWith('w'));
    await fixture.whenStable();
    expect(summary).not.toHaveBeenCalled();
    expect(client.connectHosted).toHaveBeenCalledWith(
      project.value.ref,
      'dev',
      'alice',
      expect.any(Object),
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Private source health',
    );
    expect(
      fixture.nativeElement
        .querySelector('a[href*="checks/check"]')
        .getAttribute('href'),
    ).toBe('/space/s/store/firestore/project/p/checks/check?env=dev');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Coordinator user credential',
    );
  });
  it('shows sign-in on a cold signed-out link and preserves its destination', async () => {
    auth.next({ status: 'notAuthenticated' });
    const fixture = await mount();
    expect(client.connectHosted).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Use your DataTug account',
    );
    expect(
      fixture.nativeElement.querySelector('ion-button[routerlink="/login"]'),
    ).toBeTruthy();
  });
  it('requires an explicit environment when multiple environments exist', async () => {
    query.next(convertToParamMap({}));
    const fixture = await mount('watch');
    expect(client.connectHosted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Choose an environment',
    );
  });
  it('rejects a URL environment absent from the verified inventory', async () => {
    query.next(convertToParamMap({ env: 'foreign' }));
    const fixture = await mount();
    expect(client.connectHosted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'not available in the current project',
    );
  });
  it.each(['leave', 'destroy'])(
    'cancels an initial hosted connection before identity resolves on %s',
    async (action) => {
      let resolve!: () => void;
      const response = new Promise<void>((done) => (resolve = done));
      client.connectHosted.mockImplementationOnce(
        async (ref, environment, principal, owner) => {
          client.connectionOwner.set(owner);
          await response;
          if (client.connectionOwner() === owner)
            client.identity.set({
              ...identity,
              id: principal,
              namespace: ref.spaceID,
              spaceID: ref.spaceID,
              project: ref.projectId,
              environment,
            });
        },
      );
      const fixture = await mount('watch/:watchId', false);
      await vi.waitFor(() => expect(client.connectHosted).toHaveBeenCalled());
      fixture.changeDetectorRef.detach();
      if (action === 'leave') fixture.componentInstance.ionViewWillLeave();
      else fixture.destroy();
      resolve();
      await response;
      await vi.waitFor(() => expect(client.identity()).toBeUndefined());
      expect(client.connectionOwner()).toBeUndefined();
      expect(client.definitions).not.toHaveBeenCalled();
    },
  );
  it('does not let an old cached page cancel a newer page connection', async () => {
    const old = await mount();
    const fresh = TestBed.createComponent(WatchPageComponent);
    fresh.detectChanges();
    await vi.waitFor(() =>
      expect(client.connectHosted).toHaveBeenCalledTimes(2),
    );
    await fresh.whenStable();
    const current = client.identity(),
      owner = client.connectionOwner();
    old.changeDetectorRef.detach();
    old.componentInstance.ionViewWillLeave();
    expect(client.identity()).toBe(current);
    expect(client.connectionOwner()).toBe(owner);
    expect(
      (
        fresh.componentInstance as unknown as {
          identity: () => WatchIdentity | undefined;
        }
      ).identity(),
    ).toBe(current);
  });
  it('clears a disconnected identity refusal and leaves reconnection usable', async () => {
    const fixture = await mount();
    client.refreshIdentity.mockImplementationOnce(async () => {
      client.disconnect();
      throw new Error('Watch identity refused');
    });
    const component = fixture.componentInstance as unknown as {
      refresh: () => Promise<void>;
      busy: () => boolean;
      current: () => WatchDefinition | undefined;
      error: () => string;
    };
    // Browser coverage verifies the Ionic conditional render on an actual sign-out.
    fixture.changeDetectorRef.detach();
    await component.refresh();
    expect(component.current()).toBeUndefined();
    expect(component.busy()).toBe(false);
    expect(component.error()).toContain('Watch identity refused');
  });
  it('clears private state synchronously on sign-out and ignores a late result', async () => {
    const fixture = await mount();
    await vi.waitFor(() => expect(client.definition).toHaveBeenCalled());
    let finish!: (value: { definition: WatchDefinition }) => void;
    client.definition.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const component = fixture.componentInstance as unknown as {
      refresh: () => Promise<void>;
      current: () => WatchDefinition | undefined;
    };
    const pending = component.refresh();
    await vi.waitFor(() => expect(client.definition).toHaveBeenCalledTimes(2));
    // Stencil's slot removal is not implemented by Happy DOM; the browser journey verifies this render transition.
    fixture.changeDetectorRef.detach();
    auth.next({ status: 'notAuthenticated' });
    expect(component.current()).toBeUndefined();
    expect(client.identity()).toBeUndefined();
    finish({ definition });
    await pending;
    expect(component.current()).toBeUndefined();
  });
  it.each(['account', 'Space', 'environment'])(
    'fences a pending create before subscription after changing %s',
    async (change) => {
      query.next(convertToParamMap({ env: 'dev', checkId: 'check' }));
      const fixture = await mount('watch/new');
      await vi.waitFor(() => expect(client.definitions).toHaveBeenCalled());
      await fixture.whenStable();
      let finish!: (value: { definition: WatchDefinition }) => void;
      client.save.mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      );
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);
      const component = fixture.componentInstance as unknown as {
        save: () => Promise<void>;
      };
      const pending = component.save();
      await vi.waitFor(() => expect(client.save).toHaveBeenCalled());
      if (change === 'account')
        auth.next({ status: 'authenticated', user: { uid: 'bob' } });
      if (change === 'Space')
        project.next({ ref: { ...project.value.ref, spaceID: 'other' } });
      if (change === 'environment')
        query.next(convertToParamMap({ env: 'prod' }));
      finish({ definition });
      await pending;
      expect(client.subscribe).not.toHaveBeenCalled();
      expect(client.lifecycle).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it('retains the paused-subscribe-enable ordering and navigates with returned ID and environment', async () => {
    query.next(convertToParamMap({ env: 'dev', checkId: 'check' }));
    const fixture = await mount('watch/new');
    await vi.waitFor(() => expect(client.definitions).toHaveBeenCalled());
    await fixture.whenStable();
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    await (
      fixture.componentInstance as unknown as { save: () => Promise<void> }
    ).save();
    expect(client.save.mock.calls[0][0].lifecycle).toBe('paused');
    expect(client.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      client.lifecycle.mock.invocationCallOrder[0],
    );
    expect(navigate).toHaveBeenCalledWith(
      '/space/s/store/firestore/project/p/watch/returned-watch?env=dev',
      { replaceUrl: true },
    );
  });
});

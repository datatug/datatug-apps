import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { WatchPageComponent } from './watch-page.component';
import { WatchClientService } from './watch-client.service';
import { ProjectService } from '../services/project/project.service';
import { DetectiveClientService } from '../detective/detective-client.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import type { WatchDefinition, WatchIdentity } from './watch.models';

const user: WatchIdentity = {
  id: 'alice',
  namespace: 'northwind',
  project: 'p',
  environment: 'demo',
  sharedEditor: true,
  tier: 'free',
  channels: { in_app: true, email: true, sms: false, telegram: true },
  limits: { emailPerDay: 50, smsPerDay: 10, telegramPerDay: 100 },
};
const watch: WatchDefinition = {
  id: 'watch-one',
  version: 1,
  title: 'Carrier assignment',
  namespace: 'northwind',
  project: 'p',
  environment: 'demo',
  owner: 'alice',
  visibility: 'personal',
  checkId: 'shipping-carrier-assignment',
  checkVersion: '1',
  inputs: { order_id: { type: 'integer', value: '11045' } },
  schedule: { intervalSeconds: 60 },
  trigger: 'becomes_true',
  initialObservation: 'baseline',
  mode: 'one_shot',
  lifecycle: 'enabled',
  enabled: true,
  notificationPolicy: { recovery: true },
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
};
const check = {
  id: watch.checkId,
  title: 'Carrier assignment',
  version: 1,
  inputs: [
    {
      name: 'order_id',
      type: 'integer',
      cardinality: 'scalar',
      required: true,
    },
  ],
  steps: [],
};

describe('Project Watch flow', () => {
  const client = {
    identity: signal<WatchIdentity | undefined>(user),
    matches: vi.fn(() => true),
    disconnect: vi.fn(),
    definitions: vi.fn(),
    definition: vi.fn(),
    status: vi.fn(),
    inbox: vi.fn(),
    runs: vi.fn(),
    deliveries: vi.fn(),
    subscription: vi.fn(),
    subscribe: vi.fn(),
    save: vi.fn(),
    lifecycle: vi.fn(),
    delete: vi.fn(),
    telegramStatus: vi.fn(),
    telegramConnect: vi.fn(),
    telegramDisconnect: vi.fn(),
    seed: undefined,
    setupNotice: signal(''),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    client.identity.set(user);
    client.definitions.mockResolvedValue({ definitions: [watch] });
    client.definition.mockResolvedValue({ definition: watch });
    client.status.mockResolvedValue({
      coordinator: 'online',
      runners: [],
      observations: [
        {
          watchId: watch.id,
          value: 'unknown',
          availability: 'waiting',
          nextEvaluation: '2026-10-23T00:00:00Z',
        },
      ],
    });
    client.inbox.mockResolvedValue({ notifications: [] });
    client.runs.mockResolvedValue({ runs: [] });
    client.deliveries.mockResolvedValue({ deliveries: [] });
    client.subscription.mockResolvedValue({
      subscription: { watchId: watch.id, channels: ['in_app'] },
    });
    client.telegramStatus.mockResolvedValue({
      connected: false,
      botUsername: 'ShippingWatchBot',
    });
    client.save.mockResolvedValue({
      definition: { ...watch, lifecycle: 'paused', enabled: false },
    });
    client.lifecycle.mockResolvedValue({ definition: watch });
    client.setupNotice = signal('');
    client.subscribe.mockResolvedValue({ ok: true });
  });
  async function mount(path = 'watch/:watchId') {
    const params = convertToParamMap(
        path === 'watch/:watchId' ? { watchId: watch.id } : {},
      ),
      query = convertToParamMap({ checkId: watch.checkId });
    await TestBed.configureTestingModule({
      imports: [WatchPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            routeConfig: { path },
            snapshot: { paramMap: params, queryParamMap: query },
            paramMap: new BehaviorSubject(params),
          },
        },
        { provide: WatchClientService, useValue: client },
        {
          provide: ProjectService,
          useValue: {
            watchProjectSummary: () =>
              of({
                id: 'p',
                coordination: {
                  endpoint: 'http://127.0.0.1:8988',
                  namespace: 'northwind',
                },
              }),
          },
        },
        {
          provide: DetectiveClientService,
          useValue: { state: () => of({ checks: [check] }) },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({
              ref: { storeId: 'firestore', spaceID: 's', projectId: 'p' },
            }),
            currentEnv: of({ id: 'demo' }),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: new BehaviorSubject({ user: { uid: 'firebase-user' } }),
          },
        },
        { provide: AgentContextService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WatchPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(client.definitions).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(
        (
          fixture.componentInstance as unknown as { busy: () => boolean }
        ).busy(),
      ).toBe(false),
    );
    await fixture.whenStable();
    return fixture;
  }
  it('cold loads the URL Watch ID, keeps unknown distinct, and locks SMS for a free account', async () => {
    const f = await mount();
    expect(client.definition).toHaveBeenCalledWith(watch.id);
    expect(f.nativeElement.textContent).toContain('Last observation: Unknown');
    expect(f.nativeElement.textContent).toContain('Email · free');
    const sms = f.nativeElement.querySelectorAll('ion-checkbox')[2];
    expect(sms.disabled).toBe(true);
    expect(f.nativeElement.textContent).toContain('Connect Telegram');
    expect(
      f.nativeElement.querySelector('a[href*="/checks/"]').getAttribute('href'),
    ).toBe(
      '/space/s/store/firestore/project/p/checks/shipping-carrier-assignment',
    );
  });
  it('uses the configured bot username and rejects a foreign or credential-bearing connection link', async () => {
    const fixture = await mount();
    const instance = fixture.componentInstance as unknown as {
      connectTelegram: () => Promise<void>;
      telegramLink: () => string;
      error: () => string;
    };
    expect(fixture.nativeElement.textContent).toContain('@ShippingWatchBot');
    client.telegramConnect.mockResolvedValue({
      url: 'https://t.me/ShippingWatchBot?start=watch-abc_123',
    });
    await instance.connectTelegram();
    expect(instance.telegramLink()).toBe(
      'https://t.me/ShippingWatchBot?start=watch-abc_123',
    );
    client.telegramConnect.mockResolvedValue({
      url: 'https://t.me/OtherWatchBot?start=watch-abc_123',
    });
    await instance.connectTelegram();
    expect(instance.error()).toContain('invalid Telegram bot');
    client.telegramConnect.mockResolvedValue({
      url: 'https://secret@t.me/ShippingWatchBot?start=watch-abc_123',
    });
    await instance.connectTelegram();
    expect(instance.error()).toContain('invalid Telegram bot');
  });

  it('creates from the existing Check and replaces the form route with the returned ID', async () => {
    const f = await mount('watch/new'),
      router = TestBed.inject(Router),
      navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const instance = f.componentInstance as unknown as {
      input: (name: string, part: 'value', value: string) => void;
      save: () => Promise<void>;
    };
    instance.input('order_id', 'value', '11045');
    await instance.save();
    expect(client.save.mock.calls[0][0].inputs.order_id).toEqual({
      type: 'integer',
      value: '11045',
    });
    expect(client.save.mock.calls[0][0].owner).toBe('alice');
    expect(client.save.mock.calls[0][0].lifecycle).toBe('paused');
    expect(client.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      client.lifecycle.mock.invocationCallOrder[0],
    );
    expect(navigate).toHaveBeenCalledWith(
      '/space/s/store/firestore/project/p/watch/watch-one',
      { replaceUrl: true },
    );
  });
  it('keeps a response-loss retry on the same ID, payload and operation', async () => {
    const f = await mount('watch/new');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    client.save.mockRejectedValueOnce(new Error('connection lost'));
    const instance = f.componentInstance as unknown as {
      input: (name: string, part: 'value', value: string) => void;
      save: () => Promise<void>;
    };
    instance.input('order_id', 'value', '11045');
    await instance.save();
    await instance.save();
    expect(client.save.mock.calls[1]).toEqual(client.save.mock.calls[0]);
  });
  it('uses own subscription only and does not choose a recipient address', async () => {
    const f = await mount();
    const instance = f.componentInstance as unknown as {
      subscription: (unsubscribe: boolean) => Promise<void>;
    };
    await instance.subscription(true);
    expect(client.subscribe).toHaveBeenCalledWith({
      watchId: watch.id,
      channels: ['in_app'],
      unsubscribed: true,
    });
  });
  it('opens a shared Watch before this user has subscribed', async () => {
    client.identity.set({ ...user, sharedEditor: false });
    client.definition.mockResolvedValue({
      definition: { ...watch, owner: 'bob', visibility: 'shared' },
    });
    client.subscription.mockResolvedValue({
      subscription: { watchId: watch.id, channels: [], unsubscribed: true },
    });
    const f = await mount();
    expect(f.nativeElement.textContent).toContain('Carrier assignment');
    expect(f.nativeElement.textContent).toContain('Subscribe');
    expect(
      (f.componentInstance as unknown as { canEdit: () => boolean }).canEdit(),
    ).toBe(false);
  });

  it('keeps the created Watch paused when notification setup fails', async () => {
    const f = await mount('watch/new');
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    client.subscribe.mockRejectedValueOnce(
      new Error('email provider unavailable'),
    );
    const instance = f.componentInstance as unknown as {
      input: (name: string, part: 'value', value: string) => void;
      save: () => Promise<void>;
    };
    instance.input('order_id', 'value', '11045');
    await instance.save();
    expect(client.lifecycle).not.toHaveBeenCalled();
    expect(client.setupNotice()).toContain('not confirmed');
    expect(navigate).toHaveBeenCalledWith(
      '/space/s/store/firestore/project/p/watch/watch-one',
      { replaceUrl: true },
    );
  });

  it.each(['disconnect', 'switch identity', 'destroy'])(
    'does not enable or navigate after %s while subscription is pending',
    async (action) => {
      const fixture = await mount('watch/new');
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigateByUrl')
        .mockResolvedValue(true);
      let finish: (value: { ok: boolean }) => void = () => undefined;
      client.subscribe.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const instance = fixture.componentInstance as unknown as {
        input: (name: string, part: 'value', value: string) => void;
        save: () => Promise<void>;
        disconnect: () => void;
        current: () => WatchDefinition | undefined;
        busy: () => boolean;
      };
      instance.input('order_id', 'value', '11045');
      const pending = instance.save();
      await vi.waitFor(() => expect(client.subscribe).toHaveBeenCalled());
      if (action === 'destroy') fixture.destroy();
      else if (action === 'disconnect') {
        client.identity.set(undefined);
        instance.disconnect();
        expect(instance.busy()).toBe(false);
      } else client.identity.set({ ...user, id: 'bob' });
      finish({ ok: true });
      await pending;
      expect(client.lifecycle).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(instance.current()).toBeUndefined();
    },
  );

  it('lets an existing shared owner save without promoting a personal Watch', async () => {
    client.identity.set({ ...user, sharedEditor: false });
    client.definition.mockResolvedValue({
      definition: { ...watch, visibility: 'shared' },
    });
    const fixture = await mount();
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true);
    const instance = fixture.componentInstance as unknown as {
      edit: () => Promise<void>;
      save: () => Promise<void>;
    };
    await instance.edit();
    await instance.save();
    expect(client.save).toHaveBeenCalled();
    expect(client.save.mock.calls[0][0].visibility).toBe('shared');
    expect(navigate).toHaveBeenCalled();
  });

  it.each([403, 404])(
    'clears private details and actions after access is withdrawn (%s)',
    async (status) => {
      const fixture = await mount();
      client.definition.mockRejectedValueOnce(
        new HttpErrorResponse({ status }),
      );
      await (
        fixture.componentInstance as unknown as { refresh: () => Promise<void> }
      ).refresh();
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain(
        'Carrier assignment',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'Save preferences',
      );
      expect(fixture.nativeElement.textContent).toContain(
        'No accessible Watch',
      );
    },
  );

  it('renders a private blocked Telegram connection without changing selected channels or Watch status', async () => {
    client.telegramStatus.mockResolvedValue({
      connected: false,
      botUsername: 'ShippingWatchBot',
      reconnectRequired: true,
      connectionError: 'TELEGRAM_RECIPIENT_UNAVAILABLE',
    });
    client.subscription.mockResolvedValue({
      subscription: {
        watchId: watch.id,
        channels: ['in_app', 'email', 'telegram'],
      },
    });
    client.deliveries.mockResolvedValue({
      deliveries: [
        {
          id: 'blocked',
          watchId: watch.id,
          channel: 'telegram',
          state: 'failed',
          failureCode: 'TELEGRAM_RECIPIENT_UNAVAILABLE',
          attempts: 1,
        },
        {
          id: 'email',
          watchId: watch.id,
          channel: 'email',
          state: 'delivered',
          attempts: 1,
        },
      ],
    });
    const fixture = await mount();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Telegram: Needs reconnection');
    expect(text).toContain('Reconnect Telegram');
    expect(text).toContain('Not delivered');
    expect(text).not.toContain('Retry delivery');
    expect(text).toContain('Email · Delivered');
    expect(text).toContain('This Watch stays active');
    const checkbox = [
      ...fixture.nativeElement.querySelectorAll('ion-checkbox'),
    ].find((element: Element) => element.textContent?.includes('Telegram'));
    expect(checkbox.checked).toBe(true);
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  it('shows a temporary Telegram retry and next attempt without asking for reconnection', async () => {
    client.deliveries.mockResolvedValue({
      deliveries: [
        {
          id: 'retry',
          watchId: watch.id,
          channel: 'telegram',
          state: 'retry',
          failureCode: 'TELEGRAM_RATE_LIMITED',
          attempts: 1,
          retryAt: '2030-01-02T10:00:00Z',
        },
      ],
    });
    const fixture = await mount();
    expect(fixture.nativeElement.textContent).toContain('Telegram · Retrying');
    expect(fixture.nativeElement.textContent).toContain('Next attempt:');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Needs reconnection',
    );
  });

  it('ignores a delayed detail response after switching Watch IDs for the same user', async () => {
    const f = await mount();
    const instance = f.componentInstance as unknown as {
      refresh: () => Promise<void>;
      current: () => WatchDefinition | undefined;
    };
    let resolveOld!: (value: { definition: WatchDefinition }) => void;
    const delayed = new Promise<{ definition: WatchDefinition }>(
      (resolve) => (resolveOld = resolve),
    );
    const next = { ...watch, id: 'watch-two', title: 'Second Watch' };
    client.definition.mockImplementation((id: string) =>
      id === watch.id ? delayed : Promise.resolve({ definition: next }),
    );
    const pending = instance.refresh();
    await vi.waitFor(() =>
      expect(
        client.definition.mock.calls.filter((c) => c[0] === watch.id),
      ).toHaveLength(2),
    );
    (
      TestBed.inject(ActivatedRoute).paramMap as BehaviorSubject<
        ReturnType<typeof convertToParamMap>
      >
    ).next(convertToParamMap({ watchId: next.id }));
    await vi.waitFor(() => expect(instance.current()?.id).toBe(next.id));
    resolveOld({ definition: watch });
    await pending;
    expect(instance.current()?.id).toBe(next.id);
  });
});

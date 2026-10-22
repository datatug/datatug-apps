import { mountShippingController } from './shipping-controller.spec-helper';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SneatApiAuthTokenBridge } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  AgentContextService,
  DatatugApiBaseUrl,
} from '@sneat/datatug-semantic';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ShippingInstallationController } from './shipping-installation.controller';
import {
  SHIPPING_COMPONENT,
  SHIPPING_COMPONENT_COMMIT,
  SHIPPING_COMPONENT_QUERIES,
  ShippingComponentApiService,
  ShippingComponentInstallation,
  ShippingComponentIntent,
} from './shipping-component-api.service';

const available = {
  componentId: SHIPPING_COMPONENT,
  version: 1 as const,
  digest: 'a'.repeat(64),
  sourceCommit: SHIPPING_COMPONENT_COMMIT,
} as const;
const installed = (
  operationId = 'original',
  actorId = 'sarah',
): ShippingComponentInstallation => ({
  ...available,
  operationId,
  actorId,
  installedAt: '2026-10-21T06:12:35.123456789Z',
  queryIds: [...SHIPPING_COMPONENT_QUERIES],
  checkIds: ['shipping-request-received'],
  entityIds: ['Order', 'ShippingRequest'],
  boardIds: ['shipping'],
});
const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'training' };

describe('Shipping component actual authenticated HTTP and scoped lifecycle', () => {
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: 'sarah' },
  });
  const project = new BehaviorSubject({ ref });
  const environment = new BehaviorSubject<{ id: string } | undefined>(
    undefined,
  );
  let http: HttpTestingController;
  let bridge: SneatApiAuthTokenBridge;
  beforeEach(() => {
    sessionStorage.clear();
    auth.next({ status: 'authenticated', user: { uid: 'sarah' } });
    project.next({ ref });
    environment.next(undefined);
    TestBed.configureTestingModule({
      imports: [],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DatatugApiBaseUrl, useValue: 'https://datatug.test/v0/' },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project, currentEnv: environment },
        },
        { provide: AgentContextService, useValue: {} },
      ],
    });
    bridge = TestBed.inject(SneatApiAuthTokenBridge);
    bridge.setExplicitToken('token-A');
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    try {
      http.verify({ ignoreCancelled: true });
    } finally {
      TestBed.resetTestingModule();
    }
  });
  const settle = async (f: { whenStable: () => Promise<unknown> }) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.whenStable();
  };
  const mount = async () => {
    const f = await mountShippingController(ShippingInstallationController);
    f.detectChanges();
    await settle(f);
    return f;
  };
  const read = () =>
    http.expectOne(
      (r) => r.method === 'GET' && r.url.endsWith('/shipping/component'),
    );
  const write = () =>
    http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/shipping/component'),
    );
  const loadAbsent = async () => {
    const f = await mount();
    read().flush({ available, exists: false });
    await settle(f);
    return f;
  };
  const entries = () =>
    Object.keys(sessionStorage).filter((k) =>
      k.startsWith('datatug.shipping.component.install.v1:'),
    );
  it('distinguishes asynchronous loading from authoritative absence without another detectChanges', async () => {
    const f = await mount();
    expect(f.componentInstance.loading()).toBe(true);
    expect(f.componentInstance.state()?.exists).not.toBe(false);
    const r = read();
    expect(r.request.headers.get('Authorization')).toBe('Bearer token-A');
    expect(
      Object.fromEntries(
        r.request.params.keys().map((k) => [k, r.request.params.get(k)]),
      ),
    ).toEqual({
      storage: 'firestore',
      spaceID: 'space',
      project: 'training',
      sourceId: 'shipping-working-copy',
      environment: 'demo',
    });
    r.flush({ available, exists: false });
    await settle(f);
    expect(f.componentInstance.state()?.exists).toBe(false);
    expect(f.componentInstance.state()?.installation).toBeUndefined();
  });
  it('sends exact explicit install, blocks double submit, then GET confirms status and cold canonical links', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    f.componentInstance.install();
    const r = write();
    const intent = r.request.body as ShippingComponentIntent;
    expect(r.request.params.keys()).toEqual([]);
    expect(r.request.headers.get('Authorization')).toBe('Bearer token-A');
    expect(intent).toEqual({
      spaceID: 'space',
      projectId: 'training',
      sourceId: 'shipping-working-copy',
      environment: 'demo',
      operationId: expect.any(String),
      componentId: SHIPPING_COMPONENT,
      version: 1,
      componentDigest: available.digest,
    });
    expect(entries()).toHaveLength(1);
    r.flush(installed(intent.operationId));
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeUndefined();
    expect(f.componentInstance.pending()?.phase).toBe('acknowledged');
    read().flush({
      available,
      exists: true,
      installation: installed(intent.operationId),
    });
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeDefined();
    expect(entries()).toHaveLength(0);
    const links = [
      ['board', 'shipping'],
      ['query', 'shipping/request-receipt'],
      ['checks', 'shipping-request-received'],
    ].map((parts) =>
      TestBed.inject(Router).serializeUrl(f.componentInstance.href(parts)),
    );
    expect(links).toEqual([
      '/space/space/store/firestore/project/training/board/shipping?environment=demo',
      '/space/space/store/firestore/project/training/query/shipping%2Frequest-receipt?env=demo',
      '/space/space/store/firestore/project/training/checks/shipping-request-received',
    ]);
    f.destroy();
    const cold = await mount();
    read().flush({
      available,
      exists: true,
      installation: installed(intent.operationId),
    });
    await settle(cold);
    expect(cold.componentInstance.state()?.installation).toBeDefined();
    http.expectNone((r) => r.method === 'POST');
  });
  it.each([0, 401, 503])(
    'retains frozen operation after POST %s and remount; retry is explicit with same body',
    async (status) => {
      const f = await loadAbsent();
      f.componentInstance.install();
      const r = write();
      const original = structuredClone(r.request.body);
      r.flush(
        {},
        { status, statusText: status === 0 ? 'Network Error' : 'Failed' },
      );
      await settle(f);
      http.expectNone((r) => r.method === 'POST');
      expect(entries()).toHaveLength(1);
      f.destroy();
      const resumed = await mount();
      read().flush({ available, exists: false });
      await settle(resumed);
      expect(resumed.componentInstance.pending()?.intent).toBeDefined();
      resumed.componentInstance.send();
      const retry = write();
      expect(retry.request.body).toEqual(original);
      retry.flush(installed(original.operationId));
      await settle(resumed);
      read().flush({
        available,
        exists: true,
        installation: installed(original.operationId),
      });
      await settle(resumed);
      expect(entries()).toHaveLength(0);
    },
  );
  it('does not treat an old acknowledgement as current access when GET fails', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const r = write();
    r.flush(installed(r.request.body.operationId));
    await settle(f);
    read().flush({}, { status: 403, statusText: 'Denied' });
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeUndefined();
    expect(f.componentInstance.state()?.installation).toBeUndefined();
    expect(entries()).toHaveLength(1);
    expect(f.componentInstance.pending()?.phase).toBe('acknowledged');
    f.componentInstance.refresh();
    const current = read();
    const held = f.componentInstance.pending();
    if (!held) throw new Error('Original acknowledged intent lost');
    current.flush({
      available,
      exists: true,
      installation: installed(held.intent.operationId),
    });
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeDefined();
    http.expectNone((r) => r.method === 'POST');
  });
  it('recovers delivered lost success through current GET without another mutation', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const r = write();
    const intent = r.request.body;
    r.flush({}, { status: 0, statusText: 'Network Error' });
    await settle(f);
    f.destroy();
    const resumed = await mount();
    read().flush({
      available,
      exists: true,
      installation: installed(intent.operationId),
    });
    await settle(resumed);
    expect(resumed.componentInstance.pending()).toBeUndefined();
    expect(entries()).toHaveLength(0);
    http.expectNone((r) => r.method === 'POST');
  });
  it('keeps the original frozen digest after available component metadata changes', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const r = write();
    const original = structuredClone(r.request.body);
    r.flush({}, { status: 0, statusText: 'Network Error' });
    await settle(f);
    f.destroy();
    const resumed = await mount();
    read().flush({
      available: { ...available, digest: 'b'.repeat(64) },
      exists: false,
    });
    await settle(resumed);
    resumed.componentInstance.send();
    expect(write().request.body).toEqual(original);
  });
  it('409 requires review and never replaces the operation or overwrites content', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const r = write();
    r.flush({}, { status: 409, statusText: 'Conflict' });
    await settle(f);
    expect(f.componentInstance.pending()?.phase).toBe('conflict');
    expect(f.componentInstance.currentAuthorized()).toBe(false);
    expect(f.componentInstance.currentAuthorized()).toBe(false);
    f.componentInstance.refresh();
    read().flush({
      available,
      exists: true,
      installation: installed('other-operation'),
    });
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeDefined();
    expect(entries()).toHaveLength(1);
    http.expectNone((r) => r.method === 'POST');
  });
  it.each(['actor', 'project', 'destroy'] as const)(
    'cancels pending token wait on %s, preserving original journal without cross-scope replay',
    async (change) => {
      const f = await loadAbsent();
      bridge.beginAuthentication();
      f.componentInstance.install();
      http.expectNone((r) => r.method === 'POST');
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else if (change === 'project')
        project.next({ ref: { ...ref, projectId: 'other' } });
      else f.destroy();
      bridge.setExplicitToken('token-B');
      http.expectNone((r) => r.method === 'POST');
      await settle(f);
      if (change !== 'destroy') {
        read().flush({ available, exists: false });
        await settle(f);
        expect(f.componentInstance.pending()).toBeUndefined();
      }
      expect(entries()).toHaveLength(1);
    },
  );
  it.each(['actor', 'project', 'destroy'] as const)(
    'cancels in-flight POST and stale GET on %s',
    async (change) => {
      const f = await loadAbsent();
      f.componentInstance.install();
      const mutation = write();
      if (change === 'actor')
        auth.next({ status: 'authenticated', user: { uid: 'maya' } });
      else if (change === 'project')
        project.next({ ref: { ...ref, projectId: 'other' } });
      else f.destroy();
      expect(mutation.cancelled).toBe(true);
      await settle(f);
      if (change !== 'destroy') {
        const current = read();
        f.destroy();
        expect(current.cancelled).toBe(true);
      }
      expect(entries()).toHaveLength(1);
    },
  );
  it('cancels the initial token wait synchronously on environment change', async () => {
    bridge.beginAuthentication();
    const f = await mount();
    environment.next({ id: 'production' });
    bridge.setExplicitToken('token-B');
    http.expectNone((r) => r.method === 'GET');
    await settle(f);
    const current = read();
    expect(current.request.params.get('environment')).toBe('demo');
    current.flush({ available, exists: false });
    await settle(f);
  });
  it('cancels a mutation token wait on environment change and requires explicit same-intent retry', async () => {
    const f = await loadAbsent();
    bridge.beginAuthentication();
    f.componentInstance.install();
    const original = JSON.parse(
      sessionStorage.getItem(entries()[0]) || '{}',
    ).intent;
    environment.next({ id: 'production' });
    bridge.setExplicitToken('token-B');
    http.expectNone((r) => r.method === 'POST');
    await settle(f);
    read().flush({ available, exists: false });
    await settle(f);
    http.expectNone((r) => r.method === 'POST');
    f.componentInstance.send();
    expect(write().request.body).toEqual(original);
  });
  it('cancels an in-flight mutation and late current read synchronously on environment changes', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const mutation = write();
    const original = structuredClone(mutation.request.body);
    environment.next({ id: 'production' });
    expect(mutation.cancelled).toBe(true);
    await settle(f);
    const late = read();
    environment.next({ id: 'staging' });
    expect(late.cancelled).toBe(true);
    expect(f.componentInstance.state()).toBeUndefined();
    expect(() =>
      late.flush({
        available,
        exists: true,
        installation: installed(original.operationId),
      }),
    ).toThrow();
    await settle(f);
    read().flush({ available, exists: false });
    await settle(f);
    expect(f.componentInstance.state()?.installation).toBeUndefined();
    expect(f.componentInstance.pending()?.intent).toEqual(original);
    http.expectNone((r) => r.method === 'POST');
  });
  it('preserves a conflict across remount and supersedes it only after deliberate fresh absence review', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    const first = write();
    const original = structuredClone(first.request.body);
    first.flush({}, { status: 409, statusText: 'Conflict' });
    await settle(f);
    f.componentInstance.reviewConflict();
    http.expectNone((r) => r.method === 'POST');
    expect(f.componentInstance.pending()?.intent).toEqual(original);
    f.destroy();
    const resumed = await mount();
    read().flush({
      available: { ...available, digest: 'b'.repeat(64) },
      exists: false,
    });
    await settle(resumed);
    expect(resumed.componentInstance.pending()?.intent).toEqual(original);
    http.expectNone((r) => r.method === 'POST');
    resumed.componentInstance.reviewConflict();
    const replacement = write();
    expect(replacement.request.body.operationId).not.toBe(original.operationId);
    expect(replacement.request.body.componentDigest).toBe('b'.repeat(64));
    expect(
      JSON.parse(sessionStorage.getItem(entries()[0]) || '{}').intent,
    ).toEqual(replacement.request.body);
    const accepted = {
      ...installed(replacement.request.body.operationId),
      digest: 'b'.repeat(64),
    };
    replacement.flush(accepted);
    await settle(resumed);
    expect(resumed.componentInstance.state()?.installation).toBeUndefined();
    read().flush({
      available: { ...available, digest: 'b'.repeat(64) },
      exists: true,
      installation: accepted,
    });
    await settle(resumed);
    expect(resumed.componentInstance.state()?.installation).toBeDefined();
    expect(entries()).toHaveLength(0);
  });
  it('blocks replacement install when the persisted journal is malformed', async () => {
    const f = await loadAbsent();
    f.componentInstance.install();
    write().flush({}, { status: 0, statusText: 'Network Error' });
    await settle(f);
    const key = entries()[0];
    sessionStorage.setItem(key, '{');
    f.destroy();
    const resumed = await mount();
    read().flush({ available, exists: false });
    await settle(resumed);
    expect(resumed.componentInstance.journalInvalid()).toBe(true);
    resumed.componentInstance.install();
    http.expectNone((r) => r.method === 'POST');
  });
  it.each([401, 403, 503])(
    'GET %s is not authoritative absence or an install grant',
    async (status) => {
      const f = await mount();
      read().flush({}, { status, statusText: 'Unavailable' });
      await settle(f);
      if (status === 401) {
        read().flush({}, { status: 401, statusText: 'Unauthorized' });
        await settle(f);
      }
      expect(f.componentInstance.state()?.exists).not.toBe(false);
      expect(f.componentInstance.currentAuthorized()).toBe(false);
      f.componentInstance.install();
      http.expectNone((r) => r.method === 'POST');
    },
  );
  it('validates exact installation identity and rejects blueprint/duplicate/unbounded asset lists', async () => {
    const api = TestBed.inject(ShippingComponentApiService);
    for (const invalid of [
      undefined,
      { ...installed(), digest: 'bad' },
      { ...installed(), sourceCommit: 'wrong' },
      { ...installed(), version: 2 },
      { ...installed(), queryIds: Array(8).fill('shipping/events') },
      {
        ...installed(),
        checkIds: ['shipping-request-received', 'carrier-assignment'],
      },
      { ...installed(), actorId: 123 },
      { ...installed(), operationId: 123 },
      { ...installed(), installedAt: 'yesterday' },
    ]) {
      const result = firstValueFrom(api.current(ref));
      const rejected = expect(result).rejects.toThrow();
      read().flush({ available, exists: true, installation: invalid });
      await rejected;
    }
    const result = firstValueFrom(api.current(ref));
    const rejected = expect(result).rejects.toThrow();
    read().flush({ available, exists: false, installation: installed() });
    await rejected;
  });
  it('rejects forged ACK while retaining the operation and refuses actor/definition fields in POST', async () => {
    const api = TestBed.inject(ShippingComponentApiService);
    const intent: ShippingComponentIntent = {
      spaceID: 'space',
      projectId: 'training',
      sourceId: 'shipping-working-copy',
      environment: 'demo',
      operationId: 'op',
      componentId: SHIPPING_COMPONENT,
      version: 1,
      componentDigest: available.digest,
    };
    const result = firstValueFrom(api.install(ref, intent, 'sarah'));
    const rejected = expect(result).rejects.toThrow();
    write().flush(installed('op', 'maya'));
    await rejected;
    await expect(
      firstValueFrom(
        api.install(
          ref,
          { ...intent, definitions: [] } as ShippingComponentIntent,
          'sarah',
        ),
      ),
    ).rejects.toThrow();
    http.expectNone((r) => r.method === 'POST');
  });
});

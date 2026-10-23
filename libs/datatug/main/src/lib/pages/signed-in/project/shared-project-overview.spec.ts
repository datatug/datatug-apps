import { HttpParams, HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NavController } from '@ionic/angular';
import {
  PrivateTokenStoreService,
  SneatAuthStateService,
} from '@sneat/auth-core';
import { DatatugApiService } from '../../../services/base/datatug-api.service';
import { Firestore } from 'firebase/firestore';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { datatugRoutes } from '../../../routes/datatug-routing.module';
import { ProjectPageComponent } from './project-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugStoreServiceFactory } from '../../../services/repo/datatug-store-service-factory.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { EntityService } from '../../../services/unsorted/entity.service';
import { EnvironmentState } from '../../../models/definition/environment-state';
import { SchemaService } from '../../../services/unsorted/schema.service';
import { provideMockErrorLogger } from '../../../testing/error-logger.spec-helper';

const { docMock, reads } = vi.hoisted(() => ({
  docMock: vi.fn((...args: unknown[]) => ({ path: args[1] })),
  reads: new Map<string, Subject<unknown>>(),
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: (...args: unknown[]) => docMock(...args),
}));
vi.mock('../../../services/repo/firestore-observables', async (original) => ({
  ...(await original<
    typeof import('../../../services/repo/firestore-observables')
  >()),
  docData: (ref: { path: string }) => {
    const s = new Subject<unknown>();
    reads.set(ref.path, s);
    return s;
  },
}));

function requiredRead(path: string): Subject<unknown> {
  const read = reads.get(path);
  if (!read) throw new Error(`Missing metadata fixture: ${path}`);
  return read;
}

describe('real cold shared overview route and metadata read', () => {
  let auth: BehaviorSubject<{ status: string; user: { uid: string } | null }>;
  const http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
  const storeFactory = { getDatatugStoreService: vi.fn() };
  beforeEach(() => {
    docMock.mockClear();
    reads.clear();
    Object.values(http).forEach((v) => v.mockClear());
    Object.values(api).forEach((v) => v.mockClear());
    storeFactory.getDatatugStoreService.mockClear();
    api.get.mockImplementation((endpoint: string, params: HttpParams) => {
      expect(endpoint).toBe('datatug/environments/state');
      return of({
        contract: 'environment-state/1',
        scope: {
          storeId: 'firestore',
          projectId: params.get('project'),
          spaceID: params.get('spaceID'),
          authorityId: 'shared',
        },
        scopeBinding: 'a'.repeat(64),
        revision: 'r1',
        environments: [],
        savedOrder: [],
        order: [],
        needsRepair: false,
        capabilities: {
          canReadOrder: true,
          canWriteOrder: false,
          canCreateEnvironment: false,
        },
      });
    });
    // Ionic loads SVG icons through fetch. Supply only those static assets; every other network request fails this offline fixture.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const address =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!address.endsWith('.svg'))
          throw new Error(
            'Unexpected network request in shared metadata fixture',
          );
        return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          headers: { 'content-type': 'image/svg+xml' },
        });
      }),
    );
    auth = new BehaviorSubject<{
      status: string;
      user: { uid: string } | null;
    }>({ status: 'authenticated', user: { uid: 'alice' } });
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          datatugRoutes.filter((r) => r.path?.startsWith('space/')),
        ),
        { provide: HttpClient, useValue: http },
        { provide: DatatugApiService, useValue: api },
        { provide: PrivateTokenStoreService, useValue: {} },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: Firestore, useValue: {} },
        { provide: DatatugStoreServiceFactory, useValue: storeFactory },
        provideMockErrorLogger(),
        {
          provide: NavController,
          useValue: { navigateForward: vi.fn(), navigateRoot: vi.fn() },
        },
        { provide: DatatugNavService, useValue: {} },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: {} },
        { provide: EntityService, useValue: {} },
        { provide: SchemaService, useValue: {} },
      ],
    });
  });
  const url = (spaceID: string) =>
    `/space/${spaceID}/store/firestore/project/same/overview`;
  const path = (spaceID: string) =>
    `spaces/${spaceID}/ext/datatug/projects/same`;
  const metadata = (title: string) => ({
    title,
    access: 'protected',
    created: { at: '2026-10-06T00:00:00Z' },
  });
  const settle = async (h: RouterTestingHarness) => {
    await h.fixture.whenStable();
  };
  const title = (h: RouterTestingHarness) =>
    h.routeNativeElement
      ?.querySelector('h1.project-title')
      ?.textContent?.trim();
  it('cold-loads actual metadata, clears A on B navigation, and ignores late A without unsupported calls', async () => {
    const firstEnvironments = new Subject<EnvironmentState>();
    const secondEnvironments = new Subject<EnvironmentState>();
    api.get
      .mockReturnValueOnce(firstEnvironments)
      .mockReturnValueOnce(secondEnvironments);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url('S1'), ProjectPageComponent);
    const first = requiredRead(path('S1'));
    first.next(metadata('First title'));
    await settle(h);
    expect(title(h)).toBe('First title');
    expect(h.routeNativeElement?.textContent).toContain('Space: S1');
    expect(
      h.routeNativeElement?.querySelector(
        'a[href="/space/S1/store/firestore/project/same/shipping"], ion-item[href="/space/S1/store/firestore/project/same/shipping"]',
      ),
    ).toBeNull();
    expect(
      h.routeNativeElement?.querySelector('sneat-datatug-folder'),
    ).toBeNull();
    expect(h.routeNativeElement?.querySelector('ion-select')).toBeNull();
    const firstState: EnvironmentState = {
      contract: 'environment-state/1',
      scope: {
        storeId: 'firestore',
        projectId: 'same',
        spaceID: 'S1',
        authorityId: 'shared',
      },
      scopeBinding: 'a'.repeat(64),
      revision: 'a',
      environments: [{ id: 'a-only', title: 'A environment' }],
      savedOrder: ['a-only'],
      order: ['a-only'],
      needsRepair: false,
      capabilities: {
        canReadOrder: true,
        canWriteOrder: false,
        canCreateEnvironment: false,
      },
    };
    firstEnvironments.next(firstState);
    await settle(h);
    const currentEnvironments = () =>
      (
        h.routeDebugElement?.componentInstance as {
          project: () => { summary?: { environments?: { id: string }[] } };
        }
      ).project().summary?.environments;
    expect(currentEnvironments()?.map((item) => item.id)).toEqual(['a-only']);
    await h.navigateByUrl(url('S2'), ProjectPageComponent);
    expect(title(h)).not.toBe('First title');
    requiredRead(path('S2')).next(metadata('Second title'));
    await settle(h);
    expect(currentEnvironments()).toBeUndefined();
    first.next(metadata('Late first title'));
    firstEnvironments.next({ ...firstState, revision: 'late-a' });
    await settle(h);
    expect(currentEnvironments()).toBeUndefined();
    secondEnvironments.next({
      ...firstState,
      scope: { ...firstState.scope, spaceID: 'S2' },
      revision: 'b',
      environments: [],
      savedOrder: [],
      order: [],
    });
    await settle(h);
    expect(currentEnvironments()).toEqual([]);
    expect(title(h)).toBe('Second title');
    expect(h.routeNativeElement?.textContent).toContain('Space: S2');
    expect(docMock.mock.calls.map((c) => c[1])).toEqual([
      path('S1'),
      path('S2'),
    ]);
    Object.values(http).forEach((v) => expect(v).not.toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(
      api.get.mock.calls.map((call) => (call[1] as HttpParams).get('spaceID')),
    ).toEqual(['S1', 'S2']);
    expect(storeFactory.getDatatugStoreService).not.toHaveBeenCalled();
  });
  it('permission error and sign-out clear rendered metadata; next identity rereads', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url('S1'), ProjectPageComponent);
    requiredRead(path('S1')).next(metadata('Visible title'));
    await settle(h);
    expect(title(h)).toBe('Visible title');
    requiredRead(path('S1')).error({ code: 'permission-denied' });
    await settle(h);
    expect(title(h)).toBe('same');
    expect(h.routeNativeElement?.textContent).toContain(
      'Check your sign-in and Space access',
    );
    auth.next({ status: 'notAuthenticated', user: null });
    await settle(h);
    expect(title(h)).toBe('same');
    auth.next({ status: 'authenticated', user: { uid: 'bob' } });
    requiredRead(path('S1')).next(metadata('Bob title'));
    await settle(h);
    expect(title(h)).toBe('Bob title');
  });
  it('keeps authorized metadata visible through a pending and failed environment read', async () => {
    const environments = new Subject<EnvironmentState>();
    api.get.mockReturnValueOnce(environments);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url('S1'), ProjectPageComponent);
    requiredRead(path('S1')).next(metadata('Independent title'));
    await settle(h);
    expect(title(h)).toBe('Independent title');
    environments.error({ status: 403 });
    await settle(h);
    expect(title(h)).toBe('Independent title');
    auth.next({ status: 'notAuthenticated', user: null });
    await settle(h);
    expect(title(h)).toBe('same');
  });
  it.each(['chat', 'env/local', 'boards/other'])(
    'cold unsupported %s refuses before storage',
    async (operation) => {
      const h = await RouterTestingHarness.create();
      await expect(
        h.navigateByUrl(`/space/S1/store/firestore/project/same/${operation}`),
      ).rejects.toThrow();
      expect(docMock).not.toHaveBeenCalled();
      Object.values(http).forEach((v) => expect(v).not.toHaveBeenCalled());
      Object.values(api).forEach((v) => expect(v).not.toHaveBeenCalled());
    },
  );
  it.each([
    '/space/%2F/store/firestore/project/same',
    '/space/S1/store/github.com/project/same',
    '/space/S1/store/firestore/project/%2F',
    '/space/S1;x=1/store/firestore/project/same',
  ])('malformed cold URL %s never reads storage', async (address) => {
    const h = await RouterTestingHarness.create();
    await expect(h.navigateByUrl(address)).rejects.toThrow();
    expect(docMock).not.toHaveBeenCalled();
  });
});

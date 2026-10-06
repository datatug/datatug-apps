import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NavController } from '@ionic/angular';
import {
  PrivateTokenStoreService,
  SneatAuthStateService,
} from '@sneat/auth-core';
import { SneatApiService } from '@sneat/api';
import { ErrorLogger } from '@sneat/core';
import { Firestore } from 'firebase/firestore';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { datatugRoutes } from '../../../routes/datatug-routing.module';
import { ProjectPageComponent } from './project-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugStoreServiceFactory } from '../../../services/repo/datatug-store-service-factory.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { EntityService } from '../../../services/unsorted/entity.service';
import { SchemaService } from '../../../services/unsorted/schema.service';

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
  const api = { post: vi.fn(), put: vi.fn() };
  const storeFactory = { getDatatugStoreService: vi.fn() };
  beforeEach(() => {
    docMock.mockClear();
    reads.clear();
    Object.values(http).forEach((v) => v.mockClear());
    Object.values(api).forEach((v) => v.mockClear());
    storeFactory.getDatatugStoreService.mockClear();
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
        { provide: SneatApiService, useValue: api },
        { provide: PrivateTokenStoreService, useValue: {} },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: Firestore, useValue: {} },
        { provide: DatatugStoreServiceFactory, useValue: storeFactory },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
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
    (
      h.routeNativeElement?.querySelector(
        'ion-input',
      ) as HTMLInputElement | null
    )?.value;
  it('cold-loads actual metadata, clears A on B navigation, and ignores late A without unsupported calls', async () => {
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl(url('S1'), ProjectPageComponent);
    const first = requiredRead(path('S1'));
    first.next(metadata('First title'));
    await settle(h);
    expect(title(h)).toBe('First title');
    expect(h.routeNativeElement?.textContent).toContain('Space: S1');
    expect(
      h.routeNativeElement?.querySelector('sneat-datatug-folder'),
    ).toBeNull();
    expect(h.routeNativeElement?.querySelector('ion-select')).toBeNull();
    await h.navigateByUrl(url('S2'), ProjectPageComponent);
    expect(title(h)).not.toBe('First title');
    requiredRead(path('S2')).next(metadata('Second title'));
    await settle(h);
    first.next(metadata('Late first title'));
    await settle(h);
    expect(title(h)).toBe('Second title');
    expect(h.routeNativeElement?.textContent).toContain('Space: S2');
    expect(docMock.mock.calls.map((c) => c[1])).toEqual([
      path('S1'),
      path('S2'),
    ]);
    Object.values(http).forEach((v) => expect(v).not.toHaveBeenCalled());
    Object.values(api).forEach((v) => expect(v).not.toHaveBeenCalled());
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
    expect(title(h)).toBe('Project unavailable');
    expect(h.routeNativeElement?.textContent).toContain(
      'Check your sign-in and Space access',
    );
    auth.next({ status: 'notAuthenticated', user: null });
    await settle(h);
    expect(title(h)).toBe('Project unavailable');
    auth.next({ status: 'authenticated', user: { uid: 'bob' } });
    requiredRead(path('S1')).next(metadata('Bob title'));
    await settle(h);
    expect(title(h)).toBe('Bob title');
  });
  it.each(['query/q', 'queries', 'chat', 'env/local', 'boards'])(
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

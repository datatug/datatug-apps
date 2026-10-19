import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { EnvConfigToken } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudLogsApiService } from './cloud-logs-api.service';
import {
  HostedCloudLogsAccessService,
  hostedCloudLogsAccessGuard,
} from './hosted-cloud-logs-access.service';

describe('HostedCloudLogsAccessService', () => {
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;
  const api = { list: vi.fn() };

  beforeEach(() => {
    authState = new BehaviorSubject({ status: 'authenticating' });
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });
  });

  it('waits for authenticated state before probing and discards connection metadata', () => {
    api.list.mockReturnValue(
      of({
        grants: [{ id: 'private-grant', email: 'private@example.test' }],
        connections: [{ id: 'private-connection' }],
      }),
    );
    const service = TestBed.inject(HostedCloudLogsAccessService);
    expect(service.state().status).toBe('checking');
    expect(api.list).not.toHaveBeenCalled();

    authState.next({
      status: 'authenticated',
      user: { uid: 'authorized-user' },
    });

    expect(api.list).toHaveBeenCalledOnce();
    expect(service.state()).toEqual({ status: 'allowed' });
    expect(JSON.stringify(service.state())).not.toContain('private-');
    expect(JSON.stringify(service.state())).not.toContain(
      'private@example.test',
    );
    expect(JSON.stringify(service.state())).not.toContain('authorized-user');
  });

  it.each([403, 404])(
    'denies the UI when the server returns HTTP %i',
    (status) => {
      api.list.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status })),
      );
      const service = TestBed.inject(HostedCloudLogsAccessService);
      authState.next({ status: 'authenticated', user: { uid: 'not-allowed' } });
      expect(service.state().status).toBe('denied');
    },
  );

  it('exposes transient failures and retries for the same authenticated session', () => {
    api.list
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 503 })),
      )
      .mockReturnValueOnce(of({ grants: [], connections: [] }));
    const service = TestBed.inject(HostedCloudLogsAccessService);
    authState.next({ status: 'authenticated', user: { uid: 'pilot-user' } });
    expect(service.state().status).toBe('error');

    service.retry();

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(service.state().status).toBe('allowed');
  });

  it('invalidates an old user probe before a new user can become allowed', () => {
    const oldUserProbe = new Subject<unknown>();
    const newUserProbe = new Subject<unknown>();
    api.list
      .mockReturnValueOnce(oldUserProbe)
      .mockReturnValueOnce(newUserProbe);
    const service = TestBed.inject(HostedCloudLogsAccessService);

    authState.next({ status: 'authenticated', user: { uid: 'first-user' } });
    expect(service.state().status).toBe('checking');
    authState.next({ status: 'authenticating', user: { uid: 'second-user' } });
    expect(service.state().status).toBe('checking');
    authState.next({ status: 'authenticated', user: { uid: 'second-user' } });
    expect(api.list).toHaveBeenCalledTimes(2);

    oldUserProbe.next({ grants: [], connections: [] });
    expect(service.state().status).toBe('checking');
    newUserProbe.next({ grants: [], connections: [] });
    expect(service.state().status).toBe('allowed');
  });

  it('clears the gate on sign-out and does not probe while signed out', () => {
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    const service = TestBed.inject(HostedCloudLogsAccessService);
    authState.next({ status: 'authenticated', user: { uid: 'pilot-user' } });
    expect(service.state().status).toBe('allowed');

    authState.next({ status: 'notAuthenticated' });

    expect(service.state().status).toBe('signed-out');
    expect(api.list).toHaveBeenCalledOnce();
  });

  it('keeps the service closed in builds where the feature is disabled', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EnvConfigToken,
          useValue: { hostedCloudLogsEnabled: false },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const service = TestBed.inject(HostedCloudLogsAccessService);

    expect(service.state().status).toBe('disabled');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('sends denied direct visits to My without carrying callback query data', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: HostedCloudLogsAccessService,
          useValue: { state$: of({ status: 'denied' }) },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() =>
      (hostedCloudLogsAccessGuard as CanActivateFn)(
        {} as never,
        { url: '/my/cloud-logs?receipt=opaque' } as RouterStateSnapshot,
      ),
    );

    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
      '/my?cloudLogsAccess=denied',
    );
  });

  it('allows the route only after the access probe is allowed, preserving its return query', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: HostedCloudLogsAccessService,
          useValue: { state$: of({ status: 'allowed' }) },
        },
      ],
    });

    const result = await TestBed.runInInjectionContext(() =>
      (hostedCloudLogsAccessGuard as CanActivateFn)(
        {} as never,
        {
          url: '/my/cloud-logs?googleLogs=complete&receipt=opaque',
        } as RouterStateSnapshot,
      ),
    );

    expect(result).toBe(true);
  });
});

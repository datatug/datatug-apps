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
import { BehaviorSubject, NEVER, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudLogsApiService } from './cloud-logs-api.service';
import {
  HostedCloudLogsAccessService,
  hostedCloudLogsAccessGuard,
} from './hosted-cloud-logs-access.service';

describe('HostedCloudLogsAccessService', () => {
  type TestAuthState = {
    status: 'authenticating' | 'authenticated' | 'notAuthenticated';
    loadingPhase?: 'checking-session' | 'getting-token' | 'ready' | 'failed';
    user?: { uid: string };
  };
  let authState: BehaviorSubject<TestAuthState>;
  const api = { list: vi.fn() };

  beforeEach(() => {
    authState = new BehaviorSubject<TestAuthState>({
      status: 'authenticating',
      loadingPhase: 'checking-session',
    });
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
    authState.next({
      status: 'authenticated',
      user: { uid: 'not-allowed' },
    });
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
    authState.next({
      status: 'authenticated',
      user: { uid: 'pilot-user' },
    });
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
    authState.next({
      status: 'authenticated',
      user: { uid: 'pilot-user' },
    });
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

  async function runGuard(url: string) {
    return TestBed.runInInjectionContext(() =>
      (hostedCloudLogsAccessGuard as CanActivateFn)(
        {} as never,
        { url } as RouterStateSnapshot,
      ),
    );
  }

  it('preserves the requested destination when signed out', async () => {
    TestBed.resetTestingModule();
    authState = new BehaviorSubject<TestAuthState>({
      status: 'notAuthenticated',
    });
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const result = await runGuard('/my/cloud-logs?view=recent');

    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
      '/login#/my/cloud-logs?view=recent',
    );
    expect(api.list).not.toHaveBeenCalled();
  });

  it('keeps an OAuth callback unconsumed while denied, then allows an explicit recheck', async () => {
    TestBed.resetTestingModule();
    authState = new BehaviorSubject<TestAuthState>({
      status: 'authenticated',
      user: { uid: 'authorized-user' },
    });
    api.list
      .mockReset()
      .mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 403 })),
      )
      .mockReturnValueOnce(of({ grants: [], connections: [] }));
    const takeCallback = vi.fn(() => ({
      status: 'complete' as const,
      receipt: 'opaque-receipt',
    }));
    window.__datatugTakeGoogleLogsReturn = takeCallback;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const url = '/my/cloud-logs?googleLogs=complete&receipt=opaque-receipt';
    const denied = await runGuard(url);
    expect(TestBed.inject(Router).serializeUrl(denied as never)).toBe(
      '/my?cloudLogsAccess=denied',
    );
    expect(takeCallback).not.toHaveBeenCalled();

    const access = TestBed.inject(HostedCloudLogsAccessService);
    access.retry();
    expect(access.state().status).toBe('allowed');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(await runGuard(url)).toBe(true);
    expect(takeCallback).not.toHaveBeenCalled();
    delete window.__datatugTakeGoogleLogsReturn;
  });

  it('sends failed authentication to the recovery form without probing', async () => {
    TestBed.resetTestingModule();
    authState = new BehaviorSubject<TestAuthState>({
      status: 'authenticating',
      loadingPhase: 'failed',
    });
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const result = await runGuard('/my/cloud-logs?googleLogs=complete');

    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
      '/login#/my/cloud-logs?googleLogs=complete',
    );
    expect(api.list).not.toHaveBeenCalled();
  });

  it('redirects authenticated state without a UID to local recovery without probing', async () => {
    TestBed.resetTestingModule();
    authState = new BehaviorSubject<TestAuthState>({
      status: 'authenticated',
    });
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const result = await runGuard('/my/cloud-logs');

    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
      '/my/cloud-logs/recovery#/my/cloud-logs',
    );
    expect(api.list).not.toHaveBeenCalled();
  });

  it('resolves an auth stream that never leaves authenticating to the recovery route', async () => {
    TestBed.resetTestingModule();
    api.list.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        { provide: SneatAuthStateService, useValue: { authState: NEVER } },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });
    vi.useFakeTimers();
    try {
      const pending = runGuard('/my/cloud-logs');
      await vi.advanceTimersByTimeAsync(15_001);
      const result = await pending;

      expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
        '/my/cloud-logs/recovery#/my/cloud-logs',
      );
      expect(
        TestBed.inject(HostedCloudLogsAccessService).state().status,
      ).toBe('auth-error');
      expect(api.list).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for cold auth then probes once and preserves the OAuth completion query', async () => {
    TestBed.resetTestingModule();
    authState = new BehaviorSubject<TestAuthState>({
      status: 'authenticating',
      loadingPhase: 'checking-session',
    });
    api.list.mockReturnValue(of({ grants: [], connections: [] }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable() },
        },
        { provide: CloudLogsApiService, useValue: api },
      ],
    });

    const pending = runGuard(
      '/my/cloud-logs?googleLogs=complete&receipt=opaque',
    );
    await Promise.resolve();
    expect(api.list).not.toHaveBeenCalled();
    authState.next({
      status: 'authenticated',
      loadingPhase: 'ready',
      user: { uid: 'authorized-user' },
    });
    const result = await pending;

    expect(result).toBe(true);
    expect(api.list).toHaveBeenCalledOnce();
  });
});

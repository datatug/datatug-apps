import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter } from '@angular/router';
import {
  AuthStatuses,
  type ISneatAuthState,
  SneatAuthStateService,
  initialSneatAuthState,
} from '@sneat/auth-core';
import { EnvConfigToken } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';
import { CloudLogsApiService } from './cloud-logs-api.service';
import { CloudLogsAuthRecoveryPageComponent } from './cloud-logs-auth-recovery-page.component';
import {
  cloudLogsFinishKeyStorageKey,
  discardPendingCloudLogsOAuthReturn,
  preserveCloudLogsReturnForAuthRecovery,
  readCloudLogsFinishKeyBinding,
  takeCloudLogsOAuthReturn,
  type CloudLogsOAuthReturn,
} from './cloud-logs-auth-return';
import {
  HostedCloudLogsAccessService,
  hostedCloudLogsAccessGuard,
} from './hosted-cloud-logs-access.service';

@Component({
  selector: 'sneat-datatug-cloud-logs-target-stub',
  template: '<p>Cloud Logs target</p>',
})
class CloudLogsTargetStubComponent {}

function setOneUseCallback(callback: CloudLogsOAuthReturn): void {
  window.__datatugTakeGoogleLogsReturn = () => {
    delete window.__datatugTakeGoogleLogsReturn;
    return callback;
  };
}

describe('CloudLogsAuthRecoveryPageComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    delete window.__datatugTakeGoogleLogsReturn;
  });

  it('keeps a scrubbed OAuth return in tab storage and consumes it once across page reads', () => {
    const binding = { uid: 'test-user', finishKey: 'F'.repeat(43) };
    const callback = { status: 'complete' as const, receipt: 'R'.repeat(43) };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(binding),
    );
    setOneUseCallback(callback);

    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');
    expect(window.__datatugTakeGoogleLogsReturn).toBeUndefined();
    expect(window.location.href).not.toContain(callback.receipt);

    const result = takeCloudLogsOAuthReturn();
    expect(result).toEqual({ callback, binding });
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it('prefers a fresh callback and removes an older pending attempt for the same UID', () => {
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify({ uid: 'test-user', finishKey: 'A'.repeat(43) }),
    );
    setOneUseCallback({
      status: 'complete',
      receipt: 'B'.repeat(43),
    });
    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');

    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify({ uid: 'test-user', finishKey: 'C'.repeat(43) }),
    );
    setOneUseCallback({ status: 'complete', receipt: 'D'.repeat(43) });

    expect(takeCloudLogsOAuthReturn()).toEqual({
      callback: { status: 'complete', receipt: 'D'.repeat(43) },
      binding: { uid: 'test-user', finishKey: 'C'.repeat(43) },
    });
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it.each([
    {
      name: 'a newer key for the same UID',
      current: { uid: 'test-user', finishKey: 'C'.repeat(43) },
    },
    {
      name: 'a different UID',
      current: { uid: 'other-user', finishKey: 'C'.repeat(43) },
    },
  ])('rejects a saved callback superseded by $name', ({ current }) => {
    const original = { uid: 'test-user', finishKey: 'A'.repeat(43) };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(original),
    );
    setOneUseCallback({
      status: 'complete',
      receipt: 'B'.repeat(43),
    });
    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(current),
    );

    expect(takeCloudLogsOAuthReturn()).toEqual({
      callback: { status: 'failed' },
    });
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
    const storedBinding = sessionStorage.getItem(cloudLogsFinishKeyStorageKey);
    expect(storedBinding).not.toBeNull();
    expect(JSON.parse(storedBinding ?? 'null')).toEqual(current);
  });

  it('rejects expired returns without exposing the expired receipt', () => {
    const binding = { uid: 'test-user', finishKey: 'A'.repeat(43) };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(binding),
    );
    sessionStorage.setItem(
      'datatug:google-cloud-logs:pending-return',
      JSON.stringify({
        version: 1,
        callback: { status: 'complete', receipt: 'B'.repeat(43) },
        binding,
        expiresAt: Date.now() - 1,
      }),
    );

    expect(takeCloudLogsOAuthReturn()).toEqual({
      callback: { status: 'failed' },
      binding,
    });
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it('accepts the maximum-length Firebase UID and backend opaque IDs', () => {
    const binding = { uid: 'u'.repeat(128), finishKey: 'A'.repeat(43) };
    const callback = { status: 'complete' as const, receipt: 'B'.repeat(43) };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(binding),
    );
    sessionStorage.setItem(
      'datatug:google-cloud-logs:pending-return',
      JSON.stringify({
        version: 1,
        callback,
        binding,
        expiresAt: Date.now() + 1000,
      }),
    );

    expect(takeCloudLogsOAuthReturn()).toEqual({ callback, binding });
  });

  it('rejects overlarge current finish-key storage', () => {
    sessionStorage.setItem(cloudLogsFinishKeyStorageKey, 'x'.repeat(1025));

    expect(readCloudLogsFinishKeyBinding()).toBeUndefined();
  });

  it.each([
    ['non-finite expiry', '{"version":1,"expiresAt":1e999}'],
    [
      'far-future expiry',
      JSON.stringify({
        version: 1,
        callback: { status: 'failed' },
        binding: { uid: 'test-user', finishKey: 'A'.repeat(43) },
        expiresAt: Date.now() + 10 * 60 * 1000 + 60_000,
      }),
    ],
    ['malformed JSON', '{not-json'],
    ['overlarge raw value', 'x'.repeat(2049)],
    [
      'overlarge UID',
      JSON.stringify({
        version: 1,
        callback: { status: 'failed' },
        binding: { uid: 'u'.repeat(129), finishKey: 'A'.repeat(43) },
        expiresAt: Date.now() + 1000,
      }),
    ],
    [
      'invalid finish key length',
      JSON.stringify({
        version: 1,
        callback: { status: 'failed' },
        binding: { uid: 'test-user', finishKey: 'A'.repeat(44) },
        expiresAt: Date.now() + 1000,
      }),
    ],
    [
      'invalid receipt length',
      JSON.stringify({
        version: 1,
        callback: { status: 'complete', receipt: 'B'.repeat(44) },
        binding: { uid: 'test-user', finishKey: 'A'.repeat(43) },
        expiresAt: Date.now() + 1000,
      }),
    ],
  ])('rejects %s pending storage', (_name, raw) => {
    sessionStorage.setItem('datatug:google-cloud-logs:pending-return', raw);

    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it('does not release a one-use callback when session storage cannot remove it', () => {
    const binding = { uid: 'test-user', finishKey: 'A'.repeat(43) };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(binding),
    );
    setOneUseCallback({
      status: 'complete',
      receipt: 'B'.repeat(43),
    });
    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');
    const removeItem = vi
      .spyOn(sessionStorage, 'removeItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable');
      });

    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
    removeItem.mockRestore();
    expect(takeCloudLogsOAuthReturn()).toEqual({
      callback: { status: 'complete', receipt: 'B'.repeat(43) },
      binding,
    });
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it('discards a pending OAuth return when a new authorization starts', () => {
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify({ uid: 'test-user', finishKey: 'A'.repeat(43) }),
    );
    setOneUseCallback({
      status: 'complete',
      receipt: 'B'.repeat(43),
    });
    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');

    expect(discardPendingCloudLogsOAuthReturn()).toBe(true);
    expect(takeCloudLogsOAuthReturn()).toBeUndefined();
  });

  it('renders recovery actions when the real initial auth state never settles', async () => {
    const authState = new BehaviorSubject<ISneatAuthState>(
      initialSneatAuthState,
    );
    const signInWith = vi.fn().mockResolvedValue(undefined);
    const api = { list: vi.fn() };
    TestBed.configureTestingModule({
      imports: [CloudLogsAuthRecoveryPageComponent],
      providers: [
        { provide: EnvConfigToken, useValue: { hostedCloudLogsEnabled: true } },
        { provide: CloudLogsApiService, useValue: api },
        {
          provide: SneatAuthStateService,
          useValue: { authState: authState.asObservable(), signInWith },
        },
        provideRouter([
          {
            path: 'my/cloud-logs/recovery',
            component: CloudLogsAuthRecoveryPageComponent,
          },
          {
            path: 'my/cloud-logs',
            canActivate: [hostedCloudLogsAccessGuard],
            component: CloudLogsTargetStubComponent,
          },
        ]),
      ],
    });
    // The auth stream remains the pinned service's BehaviorSubject initial
    // value while the actual route guard reaches its 15-second deadline.
    const harness = await RouterTestingHarness.create();
    vi.useFakeTimers();
    try {
      const navigation = harness.navigateByUrl('/my/cloud-logs');
      await vi.advanceTimersByTimeAsync(15_001);
      await navigation;

      expect(TestBed.inject(HostedCloudLogsAccessService).state().status).toBe(
        'auth-error',
      );
      expect(harness.routeNativeElement?.textContent).toContain(
        'Sign-in is taking longer than expected',
      );
      expect(harness.routeNativeElement?.textContent).toContain(
        'Sign in with Google',
      );
      expect(harness.routeNativeElement?.textContent).toContain(
        'Reload sign-in check',
      );
      expect(harness.routeNativeElement?.textContent).not.toContain(
        'Signing you in',
      );
      expect(api.list).not.toHaveBeenCalled();

      const page = harness.routeDebugElement?.componentInstance as
        | CloudLogsAuthRecoveryPageComponent
        | undefined;
      expect(page).toBeDefined();
      await page?.signIn('google.com');
      expect(signInWith).toHaveBeenCalledOnce();
      expect(signInWith).toHaveBeenCalledWith('google.com');

      authState.next({
        status: AuthStatuses.authenticated,
        loadingPhase: 'ready',
        user: { uid: 'test-user' } as never,
      });
      harness.detectChanges();
      expect(page?.isSignedIn()).toBe(true);
      expect(harness.routeNativeElement?.textContent).toContain(
        'Continue to Cloud Logs',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// vi.restoreAllMocks() does not undo a spy on a happy-dom Storage, and this suite shares one environment across spec
// files: restore each spied Storage method explicitly, so that a mock never leaks into the next file.
afterEach(() => {
  for (const storage of [sessionStorage, localStorage])
    for (const method of [
      'getItem',
      'setItem',
      'removeItem',
      'clear',
      'key',
    ] as const) {
      const fn: unknown = storage[method];
      if (vi.isMockFunction(fn)) fn.mockRestore();
    }
});

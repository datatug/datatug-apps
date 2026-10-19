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
  preserveCloudLogsReturnForAuthRecovery,
  takeCloudLogsOAuthReturn,
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

describe('CloudLogsAuthRecoveryPageComponent', () => {
  it('keeps a scrubbed OAuth return in tab storage for a redirect sign-in and takes it once', () => {
    const binding = { uid: 'test-user', finishKey: 'finish-attempt' };
    const callback = { status: 'complete' as const, receipt: 'opaque-receipt' };
    sessionStorage.setItem(
      cloudLogsFinishKeyStorageKey,
      JSON.stringify(binding),
    );
    window.__datatugTakeGoogleLogsReturn = () => {
      delete window.__datatugTakeGoogleLogsReturn;
      return callback;
    };

    expect(preserveCloudLogsReturnForAuthRecovery()).toBe('saved');
    expect(window.__datatugTakeGoogleLogsReturn).toBeUndefined();
    expect(window.location.href).not.toContain(callback.receipt);

    const result = takeCloudLogsOAuthReturn();
    expect(result).toEqual({ callback, binding });
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

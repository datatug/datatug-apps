import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideSneatAuthenticatedProviders } from '@sneat/app-auth';
import { ErrorLogger, IEnvironmentConfig } from '@sneat/core';
import { provideErrorLogger } from '@sneat/logging';

// S167/S171: `apps/datatug-app/src/main.ts` bootstraps with BOTH
// `...provideErrorLogger({ feedback: false })` (this app's app-level default,
// via @sneat/logging 0.27.25's `ERROR_LOGGER_DEFAULTS` token) AND
// `provideSneatAuthenticatedProviders()` (`@sneat/app-auth`), which
// internally calls `@sneat/logging`'s plain `provideErrorLogger()` again to
// register the undecorated `ErrorLoggerService`. Before `ERROR_LOGGER_DEFAULTS`
// existed, this app instead shipped a hand-rolled provider wrapper
// (`no-report-dialog-error-logger.ts`, PR #128) that had to be the LAST
// provider in main.ts's array, because Angular's injector keeps only the
// LAST registration it sees for a non-multi token like `ErrorLogger` once
// `bootstrapApplication()` flattens the whole provider tree — an earlier
// override was silently discarded by a later plain `provideErrorLogger()`
// (datatug/datatug-apps#132). `ERROR_LOGGER_DEFAULTS` is a *separate* token
// that `provideErrorLogger()` never touches, so `feedback: false` now
// survives regardless of registration order — this spec proves exactly
// that, composing the two real provider calls main.ts makes, in their real
// relative order, rather than reproducing main.ts's ordering requirement
// (there no longer is one).
//
// This spec calls the REAL `provideSneatAuthenticatedProviders()` (not a
// stand-in) so the regression actually exercises the same internal
// `provideErrorLogger()` call main.ts is protected against. That function
// also unconditionally starts `FirebaseSneatApiAuthAdapter` (an
// `ENVIRONMENT_INITIALIZER`, not gated by platform) and, only on a browser
// platform, `SneatAuthenticatedLifecycle` (which needs a live `Router`,
// `TelegramAuthService`, `SneatAuthStateService` and `AnalyticsService`) —
// neither is relevant to the `ErrorLogger`/`ERROR_LOGGER_DEFAULTS` behaviour
// under test, so `PLATFORM_ID` is forced to a non-browser value here to skip
// the lifecycle's real-Firebase/Router machinery, and `firebase/app` +
// `firebase/auth` are mocked just enough (`initializeApp`, `getAuth`,
// `onIdTokenChanged`, …) for the unconditional Firebase-auth adapter to
// start without touching a real Firebase project. The test config also
// omits `sentry` so `provideSneatAuthenticatedProviders()` doesn't also
// register Sentry's own app initializer — orthogonal to this regression;
// `@sentry/angular` is still mocked below because `@sneat/logging`'s barrel
// evaluates `./lib/sentry-setup` (imports `init`/`createErrorHandler`/
// `TraceService`) at module load time regardless.

const captureException = vi.fn(() => 'mock-event-id');
const showReportDialog = vi.fn();

vi.mock('@sentry/angular', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  showReportDialog: (...args: unknown[]) => showReportDialog(...args),
  init: vi.fn(),
  createErrorHandler: vi.fn(() => ({ handleError: vi.fn() })),
  TraceService: class {},
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  initializeAuth: vi.fn(() => ({})),
  indexedDBLocalPersistence: {},
  connectAuthEmulator: vi.fn(),
  // Never invokes the observer — nothing in this spec needs a resolved
  // auth/token state, only that FirebaseSneatApiAuthAdapter.start() doesn't
  // throw while wiring itself up.
  onIdTokenChanged: vi.fn(() => () => undefined),
  getRedirectResult: vi.fn(() => Promise.resolve(null)),
}));

const testConfig: IEnvironmentConfig = {
  production: true,
  agents: {},
  firebaseConfig: {
    projectId: 'test-project',
    appId: 'test-app-id',
    apiKey: 'test-api-key',
    authDomain: 'test.sneat.app',
  },
};

describe('main.ts real ErrorLogger providers (ERROR_LOGGER_DEFAULTS regression)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    TestBed.resetTestingModule();
    captureException.mockClear();
    showReportDialog.mockClear();

    // ErrorLoggerService.logError() only talks to Sentry when
    // `hostname !== 'localhost'` — force a prod-like host so this spec
    // actually exercises the capture/dialog path it's protecting.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'datatug.app' },
    });

    TestBed.configureTestingModule({
      providers: [
        // Skip SneatAuthenticatedLifecycle's real-Firebase/Router startup —
        // orthogonal to the ErrorLogger behaviour under test (see file
        // header).
        { provide: PLATFORM_ID, useValue: 'server' },
        // Real order from apps/datatug-app/src/main.ts: app-auth's
        // providers first, this app's ERROR_LOGGER_DEFAULTS override last.
        provideSneatAuthenticatedProviders(testConfig),
        ...provideErrorLogger({ feedback: false }),
      ],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('logError() captures the error in Sentry but never opens the report dialog', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    errorLogger.logError(new Error('x'), 'Navigation context failed', {
      show: false,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).not.toHaveBeenCalled();
  });

  // `ErrorLoggerService.logError()` resolves `options.feedback ?? defaults?.feedback
  // ?? true` (@sneat/logging README, "App-level defaults") — unlike the old
  // hand-rolled wrapper this replaces (which force-overrode every call), an
  // explicit per-call value now always wins over this app's default. A call
  // site that genuinely wants Sentry's dialog can still ask for it.
  it('an explicit feedback:true from a call site still opens the dialog — the app default is only a fallback', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    errorLogger.logError(new Error('x'), 'message', {
      feedback: true,
      show: false,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).toHaveBeenCalledTimes(1);
  });
});

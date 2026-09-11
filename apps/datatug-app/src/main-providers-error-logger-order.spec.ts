import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { provideErrorLogger } from '@sneat/logging';

import { provideErrorLoggerWithoutReportDialog } from './no-report-dialog-error-logger';

// S167 regression: `apps/datatug-app/src/main.ts` bootstraps with BOTH
// `...provideErrorLoggerWithoutReportDialog()` (this app's PR #128 wrapper,
// forcing `feedback: false`) AND `provideSneatAuthenticatedProviders()`
// (`@sneat/app-auth`), which internally calls `@sneat/logging`'s plain
// `provideErrorLogger()` too. `no-report-dialog-error-logger.spec.ts` only
// ever configured the wrapper in isolation, so it never caught that when
// `provideSneatAuthenticatedProviders()` was listed AFTER the wrapper in
// main.ts's `providers` array (it originally was — the wrapper sat right
// after `provideHttpClient()`, `provideSneatAuthenticatedProviders()` much
// further down), Angular's injector kept only the LAST `ErrorLogger`
// registration it saw once `bootstrapApplication()` flattened the whole
// provider tree — the later plain `provideErrorLogger()` silently won,
// undoing the wrapper for every `logError()` call app-wide. On production
// (`datatug.app`, non-`localhost` hostname — the only place
// `ErrorLoggerService.logError()` actually talks to Sentry) this reopened
// the "Submit Crash Report" dialog for handled, logged errors, e.g. the
// 404 thrown by `DatatugNavContextService.setCurrentProject()` when
// resolving a nonexistent GitHub project id.
//
// This spec composes the exact two competing `ErrorLogger` provider
// factories involved — `@sneat/logging`'s real `provideErrorLogger()` (the
// one `provideSneatAuthenticatedProviders()` calls internally) and this
// app's `provideErrorLoggerWithoutReportDialog()` — in both orders, to (a)
// prove the shadowing mechanism and (b) guard main.ts's fix: the wrapper
// MUST be the last provider touching `ErrorLogger` in main.ts's array.
// Fully reproducing `provideSneatAuthenticatedProviders()` itself here
// would additionally require mocking Firebase Auth and the Router just to
// satisfy its eager `SneatAuthenticatedLifecycle` initializer — orthogonal
// to what this regression actually needs, so it composes the narrower,
// directly-responsible `provideErrorLogger()` call instead.

const captureException = vi.fn(() => 'mock-event-id');
const showReportDialog = vi.fn();

// Same reason as no-report-dialog-error-logger.spec.ts: @sneat/logging's
// barrel also evaluates ./lib/sentry-setup, which imports init/
// createErrorHandler/TraceService from @sentry/angular at module load time.
vi.mock('@sentry/angular', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  showReportDialog: (...args: unknown[]) => showReportDialog(...args),
  init: vi.fn(),
  createErrorHandler: vi.fn(() => ({ handleError: vi.fn() })),
  TraceService: class {},
}));

describe('main.ts ErrorLogger provider order (S167 regression)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    TestBed.resetTestingModule();
    captureException.mockClear();
    showReportDialog.mockClear();

    // ErrorLoggerService.logError() only talks to Sentry when
    // `hostname !== 'localhost'` — force a prod-like host so this spec
    // actually exercises the capture/dialog path it's protecting, same as
    // no-report-dialog-error-logger.spec.ts.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'datatug.app' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('main.ts order (wrapper last) — the override wins and the dialog never opens', () => {
    // Mirrors the fixed apps/datatug-app/src/main.ts: the plain
    // ErrorLogger (standing in for what provideSneatAuthenticatedProviders()
    // registers internally) comes first, this app's wrapper is spread last.
    TestBed.configureTestingModule({
      providers: [provideErrorLogger(), ...provideErrorLoggerWithoutReportDialog()],
    });

    const errorLogger = TestBed.inject(ErrorLogger);
    errorLogger.logError(new Error('x'), 'Navigation context failed', {
      show: false,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).not.toHaveBeenCalled();
  });

  it('reversed order (wrapper first) — reproduces the S167 bug: the plain provider wins and the dialog opens', () => {
    // The order main.ts used to have before this fix — proves *why* order
    // matters, not just that it does. If this test ever starts failing
    // (dialog stops opening here), Angular's provider-resolution semantics
    // changed and the comment/fix in main.ts needs re-verifying, not this
    // test relaxing.
    TestBed.configureTestingModule({
      providers: [...provideErrorLoggerWithoutReportDialog(), provideErrorLogger()],
    });

    const errorLogger = TestBed.inject(ErrorLogger);
    errorLogger.logError(new Error('x'), 'Navigation context failed', {
      show: false,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).toHaveBeenCalledTimes(1);
  });
});

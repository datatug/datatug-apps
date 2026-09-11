import { InjectionToken, Provider, Type } from '@angular/core';
import { ErrorLogger, IErrorLogger, ILogErrorOptions } from '@sneat/core';
import { provideErrorLogger } from '@sneat/logging';

// `@sneat/logging`'s `ErrorLoggerService.logError()` calls Sentry's
// `showReportDialog()` by default — `ILogErrorOptions.feedback` defaults to
// `true` whenever a caller doesn't pass it (see
// node_modules/@sneat/logging/esm2022/lib/error-logger.service.js,
// `if (options?.feedback === undefined || options.feedback) { showReportDialog(...) }`).
// That means the "Submit Crash Report" modal (name / email / "I clicked on
// X..." / Submit Crash Report / Close) opens over the page for every
// *handled, logged* error too — e.g. the GitHub store's "watch folder ~ not
// implemented" entry, or a 404 for a bad project id — not just genuine
// crashes. The founder never saw a crash there; for a caught-and-logged
// error the dialog is disruptive. Sentry error *capture* (`captureException`)
// must keep happening exactly as before — only the report-dialog popup for
// `logError()` calls is being suppressed here.
//
// `ErrorLoggerService` (the class `provideErrorLogger()` wires up) isn't
// part of `@sneat/logging`'s public API — its package.json "exports" map
// only allows the `.` barrel (provideSentryAppInitializer,
// SneatLoggingModule, provideErrorLogger, analytics helpers), not
// `./lib/error-logger.service`. So this app can't import/subclass the real
// service without deep-importing a private path, and it can't reimplement
// `logError()` locally either without duplicating its toast /
// HttpErrorResponse / argument-swap-guard logic across ~130 call sites.
//
// Instead this decorates the *provider* that `provideErrorLogger()` already
// returns. That call's return value is, at runtime, a plain
// `{ provide: ErrorLogger, useClass: ErrorLoggerService }` object — so the
// real class is read back off `useClass` (no import of the private module
// needed) and re-registered under an app-local token. The public
// `ErrorLogger` token is then re-provided as a thin factory that delegates
// every call to that same instance, always forcing `feedback: false` first.
//
// FOLLOW-UP for sneat-libs (the lead files this): `ILogErrorOptions.feedback`
// is a per-call option, so an app has no supported way to flip its
// *default* without this reflection trick or touching every `logError()`
// call site. `@sneat/logging` should expose a way to set the default
// globally, e.g. `provideErrorLogger({ feedback: false })`.

const InternalErrorLogger = new InjectionToken<IErrorLogger>(
  'InternalErrorLogger (wraps @sneat/logging ErrorLoggerService)',
);

function isClassProvider(
  provider: Provider,
): provider is Provider & { provide: unknown; useClass: Type<IErrorLogger> } {
  return (
    typeof provider === 'object' && provider !== null && 'useClass' in provider
  );
}

function withoutReportDialog(
  options: ILogErrorOptions | undefined,
): ILogErrorOptions {
  return { ...options, feedback: false };
}

/**
 * Drop-in replacement for `@sneat/logging`'s `provideErrorLogger()` that
 * keeps Sentry error capture unchanged but never opens the "Submit Crash
 * Report" dialog for a handled, logged error. Genuinely uncaught exceptions
 * still go through Sentry Angular's `ErrorHandler` (wired separately by
 * `provideSentryAppInitializer()`), which is untouched by this.
 *
 * CALLER CONTRACT: spread this LAST in the app's `providers` array (after
 * `provideSneatAuthenticatedProviders()` and any other provider that might
 * also call `@sneat/logging`'s `provideErrorLogger()`). Angular keeps only
 * the last registration it sees for a non-multi token like `ErrorLogger`
 * once `bootstrapApplication()` flattens the whole tree — an earlier plain
 * `provideErrorLogger()` further down the array silently wins otherwise,
 * undoing this override for every `logError()` call in the app. This isn't
 * hypothetical: `provideSneatAuthenticatedProviders()` (`@sneat/app-auth`)
 * does exactly that internally, and it shadowed this wrapper in production
 * until `apps/datatug-app/src/main.ts` moved this call to the end of its
 * providers array — see the comment there and
 * `main-providers-error-logger-order.spec.ts` for the regression test.
 */
export function provideErrorLoggerWithoutReportDialog(): Provider[] {
  const baseProvider = provideErrorLogger();
  if (!isClassProvider(baseProvider)) {
    // Defensive: if @sneat/logging ever stops returning a ClassProvider
    // here, fail loudly in dev rather than silently reopening the dialog.
    throw new Error(
      'provideErrorLogger() from @sneat/logging no longer returns a ClassProvider ' +
        '({ provide, useClass }) — update provideErrorLoggerWithoutReportDialog() ' +
        '(apps/datatug-app/src/no-report-dialog-error-logger.ts) to match its new shape.',
    );
  }

  return [
    { ...baseProvider, provide: InternalErrorLogger },
    {
      provide: ErrorLogger,
      useFactory: (inner: IErrorLogger): IErrorLogger => ({
        logError: (e, message, options) =>
          inner.logError(e, message, withoutReportDialog(options)),
        logErrorHandler: (message, options) =>
          inner.logErrorHandler(message, withoutReportDialog(options)),
      }),
      deps: [InternalErrorLogger],
    },
  ];
}

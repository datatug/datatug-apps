import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';

import { provideErrorLoggerWithoutReportDialog } from './no-report-dialog-error-logger';

const captureException = vi.fn(() => 'mock-event-id');
const showReportDialog = vi.fn();

// `@sneat/logging`'s barrel (`provideErrorLogger` comes from there) also
// evaluates `./lib/sentry-setup`, which imports `init`/`createErrorHandler`/
// `TraceService` from `@sentry/angular` at module load time — stub those
// too so the import doesn't blow up, even though this spec never exercises
// them.
vi.mock('@sentry/angular', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  showReportDialog: (...args: unknown[]) => showReportDialog(...args),
  init: vi.fn(),
  createErrorHandler: vi.fn(() => ({ handleError: vi.fn() })),
  TraceService: class {},
}));

describe('provideErrorLoggerWithoutReportDialog', () => {
  let originalLocation: Location;

  beforeEach(() => {
    TestBed.resetTestingModule();
    captureException.mockClear();
    showReportDialog.mockClear();

    // The real `@sneat/logging` `ErrorLoggerService.logError()` only talks to
    // Sentry when `window.location.hostname !== 'localhost'` — it treats
    // localhost as a dev/test host and skips capture entirely. happy-dom's
    // default test location is localhost, so swap it out here to exercise
    // the actual capture path this fix is protecting.
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'app.datatug.io' },
    });

    TestBed.configureTestingModule({
      providers: [...provideErrorLoggerWithoutReportDialog()],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('captures a logError() call in Sentry but never opens the report dialog', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    errorLogger.logError(new Error('x'));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).not.toHaveBeenCalled();
  });

  it('overrides an explicit feedback:true from the caller — logError() still never opens the dialog', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    errorLogger.logError(new Error('x'), 'message', {
      feedback: true,
      show: false,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).not.toHaveBeenCalled();
  });

  it('still skips Sentry capture entirely when the caller opts out via report:false', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    errorLogger.logError(new Error('x'), 'message', {
      report: false,
      show: false,
    });

    expect(captureException).not.toHaveBeenCalled();
    expect(showReportDialog).not.toHaveBeenCalled();
  });

  it('logErrorHandler() also forces feedback:false through to the same delegate', () => {
    const errorLogger = TestBed.inject(ErrorLogger);

    const handler = errorLogger.logErrorHandler('message', { show: false });
    handler(new Error('x'));

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(showReportDialog).not.toHaveBeenCalled();
  });
});

import { ErrorHandler } from '@angular/core';
import { createErrorHandler } from '@sentry/angular';
import { ChunkLoadErrorHandler } from '@sneat/logging';
import { isExpectedError } from '@sneat/datatug-main';

/**
 * The dialog text for a genuine crash. Name and email are optional: the form opens with neutral values the visitor
 * may keep or replace, and nothing about them is read from the account.
 */
export const CRASH_DIALOG_OPTIONS = {
  title: 'DataTug hit a problem it did not expect',
  subtitle:
    'The team has been told. You can add what you were doing, if you like.',
  subtitle2: '',
  labelName: 'Name (optional)',
  labelEmail: 'Email (optional)',
  labelComments: 'What were you doing? (optional)',
  labelSubmit: 'Send',
  labelClose: 'Close',
  successMessage: 'Thank you. Your report has been sent.',
  user: { name: 'Anonymous', email: 'anonymous@datatug.app' },
} as const;

/**
 * Sentry's handler opens the crash-report dialog for every uncaught error. Here only a genuinely unexpected crash
 * does: a routing miss is not reported at all, and an expected failure (an HTTP status, a limit, a timeout) is
 * recorded quietly, because the page already explains it.
 */
export class DatatugCrashHandler implements ErrorHandler {
  constructor(
    private readonly crash: ErrorHandler,
    private readonly quiet: ErrorHandler,
  ) {}

  handleError(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error ?? '');
    if (/NG04002|Cannot match any routes/i.test(text)) {
      console.warn('Navigation did not match any route.');
      return;
    }
    (isExpectedError(error) ? this.quiet : this.crash).handleError(error);
  }
}

export function datatugErrorHandler(): ErrorHandler {
  return new ChunkLoadErrorHandler(
    new DatatugCrashHandler(
      createErrorHandler({
        showDialog: true,
        dialogOptions: { ...CRASH_DIALOG_OPTIONS },
      }),
      createErrorHandler({ showDialog: false }),
    ),
  );
}

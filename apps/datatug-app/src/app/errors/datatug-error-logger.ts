import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular/alert-controller';
import { ToastController } from '@ionic/angular/toast-controller';
import { captureException, withScope } from '@sentry/angular';
import { ErrorLogger, IErrorLogger, ILogErrorOptions } from '@sneat/core';
import { ERROR_LOGGER_DEFAULTS } from '@sneat/logging';
import {
  errorReport,
  friendlyError,
  isPageLevelError,
  markReported,
  reportLevelOf,
  type FriendlyError,
} from '@datatug/friendly-error';

/**
 * The app's `ErrorLogger`. The toast says what failed and what to do in plain words (never an address, a status
 * line or `undefined`), with a "Details" button that opens the sanitised code and a copyable reference. An expected
 * failure (a status, a limit, a routing miss) is shown but not reported to Sentry as a crash, and Sentry's report
 * dialog is never opened from here (that is the crash handler's, for a genuine crash only).
 */
@Injectable()
export class DatatugErrorLogger implements IErrorLogger {
  private readonly toasts = inject(ToastController, { optional: true });
  private readonly alerts = inject(AlertController, { optional: true });
  private readonly defaults = inject(ERROR_LOGGER_DEFAULTS, { optional: true });

  readonly logErrorHandler =
    (message?: string, options?: ILogErrorOptions) => (e: unknown) =>
      this.logError(e, message, options);

  readonly logError = (
    e: unknown,
    message?: string,
    options?: ILogErrorOptions,
  ): void => {
    // An expected failure that needs no report (a 404, a limit, a missing sign-in) is a situation, not an error.
    (reportLevelOf(e) === 'none' ? console.warn : console.error)(
      `logError: ${message || 'Error'}:`,
      e,
    );
    if (typeof window === 'undefined' || e === true || e === false) return;
    const level = reportLevelOf(e);
    const report = options?.report ?? this.defaults?.report ?? level !== 'none';
    if (report && window.location.hostname !== 'localhost') {
      try {
        // The visitor-facing reference travels with the event, so what is read out can be looked up. An expected
        // failure (an outage, a timeout, a lost connection) is a warning: it tells the team about the service
        // without being a crash, and never opens the report dialog.
        const reference = markReported(e);
        withScope((scope) => {
          scope.setLevel(level === 'error' ? 'error' : 'warning');
          scope.setTag('reference', reference);
          scope.setTag('expected', String(level !== 'error'));
          if (message) captureException(message, { originalException: e });
          else captureException(e);
        });
      } catch (ex) {
        console.error('Sentry failed to capture an error', ex);
      }
    }
    const denied = /permission-denied|PERMISSION_DENIED/.test(
      `${(e as { code?: unknown })?.code ?? ''} ${(e as { message?: unknown })?.message ?? ''}`,
    );
    // A missing item, a limit or a missing sign-in is page-level: the page shows its own designed state with its one
    // action, so a toast on top would only say the same thing twice.
    const toast =
      options?.show ??
      (denied || isPageLevelError(e) ? false : (this.defaults?.show ?? true));
    if (toast) this.showError(e, options?.showDuration);
  };

  showError(e: unknown, duration?: number): void {
    const error = friendlyError(e, 'that');
    void this.toasts
      ?.create({
        header: error.title,
        message: error.hint,
        duration: duration || 9000,
        color: 'danger',
        position: 'top',
        keyboardClose: true,
        buttons: [
          { text: 'Details', handler: () => void this.showDetails(error) },
          { icon: 'close', side: 'end', role: 'cancel' },
        ],
      })
      .then((toast) => toast.present())
      .catch(() => undefined);
  }

  private async showDetails(error: FriendlyError): Promise<void> {
    const alert = await this.alerts?.create({
      header: 'Error details',
      subHeader: `Code ${error.code}`,
      message: error.reported
        ? `Reference ${error.reference}`
        : 'This one was not sent to the team.',
      buttons: [
        {
          text: 'Copy',
          handler: () => {
            void navigator.clipboard?.writeText(errorReport(error));
          },
        },
        { text: 'Close', role: 'cancel' },
      ],
    });
    await alert?.present();
  }
}

export const provideDatatugErrorLogger = () => ({
  provide: ErrorLogger,
  useClass: DatatugErrorLogger,
});

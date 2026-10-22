import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { captureException } from '@sentry/angular';
import { ErrorLogger, IErrorLogger, ILogErrorOptions } from '@sneat/core';
import { ERROR_LOGGER_DEFAULTS } from '@sneat/logging';
import {
  errorReport,
  friendlyError,
  isExpectedError,
  type FriendlyError,
} from '@sneat/datatug-main';

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
    console.error(`logError: ${message || 'Error'}:`, e);
    if (typeof window === 'undefined' || e === true || e === false) return;
    const expected = isExpectedError(e);
    const report = options?.report ?? this.defaults?.report ?? !expected;
    if (report && window.location.hostname !== 'localhost') {
      try {
        if (message) captureException(message, { originalException: e });
        else captureException(e);
      } catch (ex) {
        console.error('Sentry failed to capture an error', ex);
      }
    }
    const denied = /permission-denied|PERMISSION_DENIED/.test(
      `${(e as { code?: unknown })?.code ?? ''} ${(e as { message?: unknown })?.message ?? ''}`,
    );
    if (options?.show ?? (denied ? false : (this.defaults?.show ?? true)))
      this.showError(e, options?.showDuration);
  };

  showError(e: unknown, duration?: number): void {
    const error = friendlyError(e, 'this');
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
      message: `Code ${error.code}\nReference ${error.reference}`,
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

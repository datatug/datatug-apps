import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  cloudOfflineOutline,
  lockClosedOutline,
  refreshOutline,
  searchOutline,
} from 'ionicons/icons';
import { errorReport, friendlyError, FriendlyError } from './friendly-error';

export interface ErrorStateLink {
  readonly label: string;
  readonly href: string;
}

/**
 * One place that says what happened, what to do next, and offers Retry. It takes either a failure (`error`, turned
 * into words by {@link friendlyError}) or explicit `title`/`hint` text. It never prints a URL or the raw error.
 */
@Component({
  selector: 'sneat-datatug-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, RouterLink],
  template: `
    <section class="error-state" role="alert" [attr.data-error-kind]="kind()">
      <span class="error-state-icon" aria-hidden="true"
        ><ion-icon
          [name]="
            kind() === 'not-found' || kind() === 'routing'
              ? 'search-outline'
              : kind() === 'offline'
                ? 'cloud-offline-outline'
                : kind() === 'unauthenticated' || kind() === 'forbidden'
                  ? 'lock-closed-outline'
                  : 'alert-circle-outline'
          "
      /></span>
      <h2>{{ resolvedTitle() }}</h2>
      <p>{{ resolvedHint() }}</p>
      <div class="error-state-actions">
        @if (canRetry()) {
          <ion-button (click)="retry.emit()">
            <ion-icon slot="start" name="refresh-outline" />
            Retry
          </ion-button>
        }
        @for (link of links(); track link.href; let first = $first) {
          <ion-button
            [fill]="first && !canRetry() ? 'solid' : 'clear'"
            [routerLink]="link.href"
            >{{ link.label }}</ion-button
          >
        }
      </div>
      @if (friendly(); as f) {
        <details class="error-state-details">
          <summary>Details</summary>
          <p>
            Code {{ f.code }} · Reference {{ f.reference }}
            @if (f.detail) {
              <br />{{ f.detail }}
            }
          </p>
          <ion-button size="small" fill="clear" (click)="copyDetails(f)">{{
            copied() ? 'Copied' : 'Copy details'
          }}</ion-button>
        </details>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
      padding: 48px 16px;
      max-width: 480px;
      margin: 0 auto;
    }
    .error-state-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--ion-color-light-shade, rgba(127, 127, 127, 0.15));
      margin-bottom: 8px;
    }
    .error-state-icon ion-icon {
      font-size: 36px;
      color: var(--ion-color-medium-shade);
    }
    .error-state h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--ion-text-color);
    }
    .error-state p {
      margin: 0;
      color: var(--ion-color-medium-shade);
    }
    .error-state-details {
      font-size: 0.85rem;
      color: var(--ion-color-medium-shade);
    }
    .error-state-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-top: 8px;
    }
  `,
})
export class ErrorStateComponent {
  /** The failure; its text is never shown, only the friendly words chosen for its kind. */
  readonly error = input<unknown>();
  /** What was being loaded, in lower case ("this board"), used in the words made from `error`. */
  readonly what = input('this page');
  readonly title = input<string>();
  readonly hint = input<string>();
  readonly links = input<readonly ErrorStateLink[]>([]);
  /** Shows Retry. Defaults to what the failure kind allows. */
  readonly retryable = input<boolean>();
  readonly retry = output<void>();

  protected readonly friendly = computed<FriendlyError | undefined>(() =>
    this.error() === undefined ? undefined : friendlyError(this.error(), this.what()),
  );
  protected readonly kind = computed(() => this.friendly()?.kind ?? 'unknown');
  protected readonly resolvedTitle = computed(
    () => this.title() ?? this.friendly()?.title ?? 'Something went wrong',
  );
  protected readonly resolvedHint = computed(
    () =>
      this.hint() ??
      this.friendly()?.hint ??
      'Try again, or go back and open it from the list.',
  );
  protected readonly canRetry = computed(
    () => this.retryable() ?? this.friendly()?.retryable ?? false,
  );

  protected readonly copied = signal(false);

  protected async copyDetails(error: FriendlyError): Promise<void> {
    try {
      await navigator.clipboard.writeText(errorReport(error));
      this.copied.set(true);
    } catch {
      // No clipboard permission: the code and reference stay on screen to read out.
    }
  }

  constructor() {
    addIcons({
      alertCircleOutline,
      cloudOfflineOutline,
      lockClosedOutline,
      refreshOutline,
      searchOutline,
    });
  }
}

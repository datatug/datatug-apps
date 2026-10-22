import {
  afterNextRender,
  booleanAttribute,
  ElementRef,
  viewChild,
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
import {
  errorReport,
  friendlyError,
  type ErrorKind,
  type FriendlyError,
} from '@datatug/friendly-error';

export interface ErrorStateLink {
  readonly label: string;
  readonly href: string;
}

/**
 * One place that says what happened, what to do next, and offers one recovery action: Retry when trying again can
 * help, Sign in when only signing in can, or the links it is given. It takes either a failure (`error`, turned
 * into words by {@link friendlyError}) or explicit `title`/`hint` text. It never prints a URL or the raw error.
 */
@Component({
  selector: 'sneat-datatug-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, RouterLink],
  template: `
    <section
      class="error-state"
      [class.compact]="compact()"
      [attr.role]="compact() ? 'status' : null"
      [attr.aria-live]="compact() ? 'polite' : null"
      [attr.data-error-kind]="kind()"
    >
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
      <!-- A page-level failure is announced once, as an alert, and takes focus; a section inside a page is a polite status. -->
      <div class="error-state-words" [attr.role]="compact() ? null : 'alert'">
        <h2 #title tabindex="-1">{{ resolvedTitle() }}</h2>
        <p>{{ resolvedHint() }}</p>
      </div>
      <div class="error-state-actions">
        @if (canRetry()) {
          <ion-button (click)="retry.emit()">
            <ion-icon slot="start" name="refresh-outline" />
            Retry
          </ion-button>
        }
        @if (signInAction()) {
          <ion-button routerLink="/login">Sign in</ion-button>
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
            Code {{ f.code }}
            @if (f.reported) {
              · Reference {{ f.reference }}
            }
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
    .error-state.compact {
      padding: 12px 8px;
    }
    .error-state.compact .error-state-icon {
      display: none;
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
    .error-state h2:focus {
      outline: none;
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
  /** The look of the icon when the words are given explicitly (a 404 is `not-found`). */
  readonly kindHint = input<ErrorKind>();
  /** A smaller block for a failed section inside a page: no big icon, less padding. */
  readonly compact = input(false, { transform: booleanAttribute });
  readonly title = input<string>();
  readonly hint = input<string>();
  readonly links = input<readonly ErrorStateLink[]>([]);
  /** Shows Retry. Defaults to what the failure kind allows. */
  readonly retryable = input<boolean>();
  readonly retry = output<void>();

  protected readonly friendly = computed<FriendlyError | undefined>(() =>
    this.error() === undefined
      ? undefined
      : friendlyError(this.error(), this.what()),
  );
  protected readonly kind = computed(
    () => this.kindHint() ?? this.friendly()?.kind ?? 'unknown',
  );
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

  /** A failure that only signing in can fix offers Sign in, not a Retry that cannot help. */
  protected readonly signInAction = computed(
    () => this.kind() === 'unauthenticated' && this.links().length === 0,
  );
  private readonly titleElement = viewChild<ElementRef<HTMLElement>>('title');

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
    // A page-level state takes focus, so a screen reader reads it and a keyboard user starts from its action.
    afterNextRender(() => {
      if (!this.compact()) this.titleElement()?.nativeElement.focus();
    });
    addIcons({
      alertCircleOutline,
      cloudOfflineOutline,
      lockClosedOutline,
      refreshOutline,
      searchOutline,
    });
  }
}

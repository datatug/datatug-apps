import { SourceOperationHistoryComponent } from './source-operation-history.component';
import { NativeSemanticBrowserComponent } from './native-semantic-browser.component';
import { ShippingComponentInstallerComponent } from './shipping-component-installer.component';
import { ShippingQueryAccessComponent } from './shipping-query-access.component';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { filter, firstValueFrom, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { useDetectivePageContext } from '../detective/detective-page-context';
import {
  DetectiveClientService,
  detectiveErrorMessage,
} from '../detective/detective-client.service';
import { isSharedProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import {
  ShippingAction,
  ShippingApiService,
  ShippingIntent,
  ShippingRevision,
  SHIPPING_SOURCE,
  shippingPointer,
  validateShippingIntent,
} from './shipping-api.service';

@Component({
  selector: 'sneat-datatug-shipping-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SourceOperationHistoryComponent,
    ShippingQueryAccessComponent,
    NativeSemanticBrowserComponent,
    RouterLink,
    IonButton,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    ShippingComponentInstallerComponent,
  ],
  template: ` <ion-header
      ><ion-toolbar
        ><ion-title>Shipping training workspace</ion-title></ion-toolbar
      ></ion-header
    >
    <ion-content class="ion-padding">
      <a [routerLink]="overviewHref()">Back to project overview</a>
      <p>
        Prepare an isolated working copy, then explicitly choose query access
        below. Working-copy actions do not grant project membership or paid
        access.
      </p>
      @if (!native()) {
        <p role="status">
          Sign in and open a native hosted project with a Space to use these
          controls.
        </p>
      }
      @if (loading()) {
        <p role="status">Loading current shipping revision…</p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (revision(); as current) {
        <h2>Current working copy</h2>
        <p>
          Routing configuration {{ current.configuration }}. Correction alone
          does not create a carrier assignment; replay is a separate action.
        </p>
        <details>
          <summary>Revision and immutable log details</summary>
          <p>
            Generation {{ current.generation }} · revision
            {{ current.revision }}
          </p>
          <p>SHA-256 {{ current.sha256 }}</p>
          @for (artifact of current.artifacts; track artifact.id) {
            <p>{{ artifact.id }} · {{ artifact.sha256 }}</p>
          }
        </details>
      }
      @if (native()) {
        <sneat-datatug-shipping-query-access
          [environments]="environments()"
          [canWrite]="canWrite()"
        />
        <p>
          <a [routerLink]="sessionsHref()"
            >Open Sessions and explicitly select Shipping orders</a
          >
        </p>
      }
      @if (notice()) {
        <p role="status">{{ notice() }}</p>
      }
      @if (pending(); as intent) {
        <h2>Operation awaiting review</h2>
        <p>
          {{ intent.action }}
          @if (intent.orderId) {
            for order {{ intent.orderId }}
          }
        </p>
        @if (intent.expected) {
          <p>
            Expected generation {{ intent.expected.generation }}, revision
            {{ intent.expected.revision }}, SHA-256 {{ intent.expected.sha256 }}
          </p>
        }
        @if (conflict()) {
          <p>
            The server refused this operation because its revision or operation
            no longer matches. Review the current revision above before
            preparing another action.
          </p>
          <ion-button
            (click)="reviewConflict()"
            [disabled]="busy() || loading() || !revision()"
            >I reviewed this conflict; prepare a new action</ion-button
          >
        } @else {
          <p>
            A previous attempt may already have completed. Retry uses the same
            operation and expected revision.
          </p>
          <ion-button
            (click)="send()"
            [disabled]="busy() || loading() || !canWrite()"
            >Retry original operation</ion-button
          >
        }
      } @else if (canWrite() && !loading()) {
        @if (!revision()) {
          <p>
            No current revision could be confirmed. Initialize asks the server
            to create a copy only if none exists; it never replaces an existing
            copy.
          </p>
          <ion-button (click)="prepare('initialize')" [disabled]="busy()"
            >Initialize working copy</ion-button
          >
        } @else {
          <ion-button (click)="prepare('correct')" [disabled]="busy()"
            >Correct routing configuration</ion-button
          >
          <p>
            Replay explicitly processes the selected order using the current
            configuration.
          </p>
          <ion-button (click)="prepare('replay', 11045)" [disabled]="busy()"
            >Replay order 11045</ion-button
          >
          <ion-button (click)="prepare('replay', 11062)" [disabled]="busy()"
            >Replay order 11062</ion-button
          >
          <p>
            Reset starts a new generation. Existing evidence remains associated
            with its original generation.
          </p>
          <ion-button
            color="warning"
            (click)="confirmReset.set(true)"
            [disabled]="busy()"
            >Reset working copy…</ion-button
          >
          @if (confirmReset()) {
            <p>Start a new generation for this project?</p>
            <ion-button color="warning" (click)="prepare('reset')"
              >Confirm reset</ion-button
            ><ion-button fill="clear" (click)="confirmReset.set(false)"
              >Cancel</ion-button
            >
          }
        }
      }
      @if (busy()) {
        <p role="status">Waiting for the server…</p>
      }
      @if (native()) {
        <ion-button
          fill="clear"
          (click)="refresh()"
          [disabled]="busy() || loading()"
          >Refresh current revision</ion-button
        >
        <p>
          <a [routerLink]="incidentsHref()"
            >Open Incidents and select an environment</a
          >
        </p>
      }
      @if (native()) {
        <sneat-source-operation-history [environments]="environments()" />
        <sneat-shipping-component-installer />
        <sneat-native-semantic-browser
          [environments]="environments()"
          [canWrite]="canWrite()"
        />
      }
    </ion-content>`,
})
export class ShippingWorkspaceComponent {
  readonly page = useDetectivePageContext();
  private readonly api = inject(ShippingApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly detective = inject(DetectiveClientService);
  readonly native = computed(() => {
    const ref = this.page.ref();
    return (
      this.page.context()?.kind === 'cloud' &&
      !!this.page.context()?.principal &&
      !!ref &&
      isSharedProjectRef(ref) &&
      ref.branch === undefined &&
      ref.projectApi === undefined
    );
  });
  private readonly grantedFor = signal<string | undefined>(undefined);
  readonly canWrite = computed(
    () => this.native() && this.grantedFor() === this.page.identity(),
  );
  readonly environments = signal<readonly string[]>([]);
  readonly sessionsHref = computed(() =>
    projectPageHref(this.page.ref(), 'sessions'),
  );
  readonly revision = signal<ShippingRevision | undefined>(undefined);
  readonly pending = signal<ShippingIntent | undefined>(undefined);
  readonly conflict = signal(false);
  readonly confirmReset = signal(false);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  private readonly refreshVersion = signal(0);
  readonly overviewHref = computed(() =>
    projectPageHref(this.page.ref(), 'overview'),
  );
  readonly incidentsHref = computed(() =>
    projectPageHref(this.page.ref(), 'incidents'),
  );
  constructor() {
    effect((onCleanup) => {
      const identity = this.page.identity();
      untracked(() => {
        this.environments.set([]);
        this.pending.set(undefined);
        this.conflict.set(false);
        this.confirmReset.set(false);
        this.revision.set(undefined);
        this.grantedFor.set(undefined);
        this.error.set('');
        this.notice.set('');
        this.busy.set(false);
        this.restoreIntent(identity);
      });
      // Changing actor or project invalidates every held operation and response.
      onCleanup(() => {
        if (identity !== this.page.identity()) {
          this.pending.set(undefined);
          this.clearJournal();
        }
      });
    });
    effect((onCleanup) => {
      this.refreshVersion();
      const context = this.page.context();
      const ref = this.page.ref();
      let cancelled = false;
      this.revision.set(undefined);
      this.loading.set(false);
      if (
        !context ||
        context.kind !== 'cloud' ||
        !context.principal ||
        !ref ||
        !this.native()
      )
        return;
      this.loading.set(true);
      void firstValueFrom(this.detective.state(context))
        .then(async (state) => {
          if (cancelled) return;
          this.environments.set(state.environments ?? []);
          this.grantedFor.set(
            state.capabilities.canWrite ? this.page.identity() : undefined,
          );
          const current = await firstValueFrom(this.api.revision(ref));
          if (!cancelled) {
            this.revision.set(current);
            this.error.set('');
          }
        })
        .catch((error) => {
          if (!cancelled) this.fail(error);
        })
        .finally(() => {
          if (!cancelled) this.loading.set(false);
        });
      onCleanup(() => {
        cancelled = true;
      });
    });
  }
  refresh(): void {
    this.refreshVersion.update((n) => n + 1);
  }
  prepare(action: ShippingAction, orderId?: 11045 | 11062): void {
    const ref = this.page.ref();
    if (
      !ref?.spaceID ||
      !this.canWrite() ||
      this.busy() ||
      this.loading() ||
      this.pending()
    )
      return;
    const current = this.revision();
    if (
      (action !== 'initialize' && !current) ||
      (action === 'initialize' && current)
    )
      return;
    const intent: ShippingIntent = {
      spaceID: ref.spaceID,
      projectId: ref.projectId,
      sourceId: SHIPPING_SOURCE,
      operationId: crypto.randomUUID(),
      action,
      ...(current ? { expected: shippingPointer(current) } : {}),
      ...(orderId ? { orderId } : {}),
    };
    if (!this.writeJournal(intent, false)) return;
    this.pending.set(intent);
    this.confirmReset.set(false);
    this.notice.set('');
    void this.send();
  }
  async send(): Promise<void> {
    const intent = this.pending();
    const ref = this.page.ref();
    const context = this.page.context();
    const identity = this.page.identity();
    if (
      !intent ||
      !ref ||
      !context?.principal ||
      !this.canWrite() ||
      this.busy() ||
      this.conflict()
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api
          .action(ref, intent, context.principal)
          .pipe(
            takeUntil(
              this.page.scopeChanges$.pipe(
                filter((current) => current !== identity),
              ),
            ),
            takeUntilDestroyed(this.destroyRef),
          ),
      );
      if (this.destroyRef.destroyed || identity !== this.page.identity())
        return;
      this.clearJournal();
      this.pending.set(undefined);
      this.notice.set(
        `${intent.action === 'replay' ? 'Replay' : intent.action === 'correct' ? 'Configuration correction' : intent.action === 'reset' ? 'Reset' : 'Initialization'} accepted. Refreshing the authoritative current revision.`,
      );
      this.refresh();
    } catch (error) {
      if (this.destroyRef.destroyed || identity !== this.page.identity())
        return;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.conflict.set(true);
        this.writeJournal(intent, true);
        this.refresh();
      }
      this.fail(error);
    } finally {
      if (!this.destroyRef.destroyed && identity === this.page.identity())
        this.busy.set(false);
    }
  }
  reviewConflict(): void {
    if (!this.conflict() || this.busy() || this.loading() || !this.revision())
      return;
    this.clearJournal();
    this.pending.set(undefined);
    this.conflict.set(false);
    this.error.set('');
    this.notice.set(
      'Conflict reviewed. Choose an action to create a new operation against the current revision.',
    );
  }
  private readonly journalKey = 'datatug.shipping.intent.v1';
  private clearJournal(): void {
    try {
      sessionStorage.removeItem(this.journalKey);
    } catch {
      /* No protected content is retained elsewhere. */
    }
  }
  private writeJournal(intent: ShippingIntent, conflict: boolean): boolean {
    try {
      sessionStorage.setItem(
        this.journalKey,
        JSON.stringify({ scope: this.page.identity(), intent, conflict }),
      );
      return true;
    } catch {
      this.error.set(
        'Session storage is unavailable. Keep this page open to review the original operation.',
      );
      return false;
    }
  }
  private restoreIntent(identity: string | undefined): void {
    try {
      const raw = sessionStorage.getItem(this.journalKey);
      if (!raw) return;
      if (raw.length > 4096) throw new Error('Invalid operation journal.');
      const saved = JSON.parse(raw) as {
        scope?: string;
        intent: ShippingIntent;
        conflict?: boolean;
      };
      const ref = this.page.ref();
      const actor = this.page.context()?.principal;
      if (!identity || saved.scope !== identity || !ref || !actor) {
        this.clearJournal();
        return;
      }
      validateShippingIntent(ref, saved.intent, actor);
      this.pending.set(saved.intent);
      this.conflict.set(saved.conflict === true);
    } catch {
      this.clearJournal();
      this.error.set(
        'The stored operation could not be restored. Refresh the current revision before preparing an action.',
      );
    }
  }
  private fail(error: unknown): void {
    this.error.set(detectiveErrorMessage(error, true));
    if (error instanceof HttpErrorResponse && error.status === 401) {
      // Expired credentials do not prove that the original mutation was never
      // delivered. Keep its intent for explicit same-principal recovery.
      this.grantedFor.set(undefined);
      this.revision.set(undefined);
    } else if (error instanceof HttpErrorResponse && error.status === 403) {
      this.clearJournal();
      this.grantedFor.set(undefined);
      this.revision.set(undefined);
      this.pending.set(undefined);
      this.conflict.set(false);
    }
  }
}

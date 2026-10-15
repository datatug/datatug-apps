import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { contextOpaqueId } from './session-context-contract';
import { SessionContextApiService } from './session-context-api.service';
import {
  NATIVE_OPERATION_STORE,
  NativeOperationRecovery,
  nativeOperationDraftKey,
} from './session-detective-operation.service';
import {
  SessionDetectiveResponse,
  validDetectiveOperationScope,
} from './session-detective-contract';
import { projectPageHref } from '../nav/project-page-href';

/** This route deliberately sits outside project/session content admission.
 * Only the native status owner authenticates the current local agent caller;
 * hosted recovery also requires the active account to match the cached actor. */
@Component({
  selector: 'sneat-session-detective-recovery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonTitle,
    IonToolbar,
  ],
  template: `<ion-header
      ><ion-toolbar
        ><ion-title>Saved Check status</ion-title></ion-toolbar
      ></ion-header
    >
    <ion-content>
      @if (signInRequired()) {
        <ion-item
          ><ion-label
            >Sign in to the account that accepted this operation.</ion-label
          ><ion-button
            [routerLink]="'/login'"
            [queryParams]="{ returnTo: returnTo }"
            >Sign in / switch account</ion-button
          ></ion-item
        >
      }
      @if (busy()) {
        <ion-item
          ><ion-label
            >Checking the original operation owner…</ion-label
          ></ion-item
        >
      }
      @if (response(); as result) {
        <ion-item role="status"
          ><ion-label
            ><h2>{{ result.status.state }}</h2>
            <p>
              Saved run {{ result.status.runId }} · produced
              {{ result.status.produced }} · finalized {{ result.status.done }}
            </p>
            @if (result.status.fenceReason) {
              <p>Fenced: {{ result.status.fenceReason }}</p>
            }
            @if (result.status.evidenceState) {
              <p>Case evidence: {{ result.status.evidenceState }}</p>
            }
          </ion-label></ion-item
        >
      }
      @if (error()) {
        <ion-item color="warning" role="alert"
          ><ion-label class="ion-text-wrap">{{ error() }}</ion-label></ion-item
        >
      }
      <ion-button (click)="refresh()" [disabled]="busy() || !authorized()"
        >Refresh saved status</ion-button
      >
      <p>This screen never dispatches a Check or reads its private inputs.</p>
      @if (sessionHref()) {
        <ion-button fill="outline" [routerLink]="sessionHref()"
          >Return to session</ion-button
        >
      }
      <ion-button fill="outline" routerLink="/home">Home</ion-button>
    </ion-content>`,
})
export class SessionDetectiveRecoveryComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(NATIVE_OPERATION_STORE);
  private readonly api = inject(SessionContextApiService);
  private readonly auth = toSignal(inject(SneatAuthStateService).authState, {
    initialValue: undefined,
  });
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly recovery = signal<NativeOperationRecovery | undefined>(
    undefined,
  );
  private generation = 0;
  protected readonly returnTo = this.router.url;
  protected readonly response = signal<SessionDetectiveResponse | undefined>(
    undefined,
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly cloud = computed(() => {
    const draft = this.recovery();
    return (
      !!draft &&
      ['github', 'github.com', 'firestore'].includes(draft.project.storeId)
    );
  });
  protected readonly signInRequired = computed(
    () =>
      this.cloud() &&
      (this.auth()?.status === 'notAuthenticated' ||
        (this.auth()?.status === 'authenticated' &&
          this.auth()?.user?.uid !== this.recovery()?.actor)),
  );
  protected readonly authorized = computed(() => {
    const draft = this.recovery();
    return (
      !!draft &&
      (!this.cloud() ||
        (this.auth()?.status === 'authenticated' &&
          this.auth()?.user?.uid === draft.actor))
    );
  });
  protected readonly sessionHref = computed(() => {
    const draft = this.recovery();
    return this.response() && draft
      ? this.router.parseUrl(
          projectPageHref(draft.project, [
            'sessions',
            draft.sessionId,
            'checks',
            draft.checkId,
          ]),
        )
      : '';
  });
  constructor() {
    effect(() => {
      const id = this.params().get('recoveryId') || '';
      void this.load(id, this.params().get('storeId'));
    });
    effect(() => {
      if (this.authorized())
        untracked(() => {
          void this.refresh(false);
        });
      else {
        this.busy.set(false);
        this.response.set(undefined);
        if (
          this.recovery() &&
          this.cloud() &&
          this.auth()?.status === 'authenticated'
        )
          this.error.set(
            'This recovery record belongs to a different account.',
          );
      }
    });
  }
  private async load(id: string, storeId: string | null): Promise<void> {
    const generation = ++this.generation;
    this.busy.set(false);
    this.recovery.set(undefined);
    this.response.set(undefined);
    this.error.set('');
    if (!contextOpaqueId(id)) {
      this.error.set('This recovery address is invalid.');
      return;
    }
    try {
      const draft = await this.store.readRecovery(id);
      if (generation !== this.generation) return;
      if (
        !draft ||
        draft.recoveryId !== id ||
        !draft.actor ||
        !contextOpaqueId(draft.operationId) ||
        !validDetectiveOperationScope(draft.locator) ||
        draft.draftKey !==
          nativeOperationDraftKey(
            draft.project,
            draft.actor,
            draft.locator,
            draft.sessionId,
            draft.checkId,
            draft.caseId,
          ) ||
        !contextOpaqueId(draft.sessionId) ||
        !contextOpaqueId(draft.checkId) ||
        (storeId
          ? draft.project.storeId !== storeId
          : !['github', 'github.com', 'firestore'].includes(
              draft.project.storeId,
            ))
      )
        throw new Error();
      // Do not trust a serialized request/body or cached response on this screen.
      const {
        actor,
        project,
        locator,
        operationId,
        sessionId,
        checkId,
        caseId,
        recoveryId,
        draftKey,
      } = draft;
      this.recovery.set({
        actor,
        project,
        locator,
        operationId,
        sessionId,
        checkId,
        caseId,
        recoveryId,
        draftKey,
      });
    } catch {
      if (generation === this.generation)
        this.error.set(
          'No valid operation metadata is available on this device. Open the original session after reconnecting.',
        );
    }
  }
  protected async refresh(reconcile = true): Promise<void> {
    const draft = this.recovery();
    if (!draft || !this.authorized() || this.busy()) return;
    const generation = this.generation,
      actor = this.auth()?.user?.uid;
    this.busy.set(true);
    this.error.set('');
    const current = () =>
      generation === this.generation &&
      this.recovery() === draft &&
      (!this.cloud() ||
        (this.auth()?.user?.uid === actor && this.authorized()));
    try {
      const response = reconcile
        ? await this.api.reconcileNativeDetective(
            draft.project,
            draft.locator,
            draft.operationId,
          )
        : await this.api.nativeDetectiveOperation(
            draft.project,
            draft.locator,
            draft.operationId,
          );
      if (!current()) return;
      this.response.set(response);
      await this.store.writeRecovery({ ...draft, response });
      if (current() && (response.status.done || response.status.fenceReason)) {
        const { draftKey, ...metadata } = draft;
        await this.store.write(draftKey, { ...metadata, response });
      }
    } catch (error) {
      if (!current()) return;
      if (
        error instanceof HttpErrorResponse &&
        error.status === 403 &&
        this.cloud() &&
        actor === draft.actor
      ) {
        const { draftKey, ...metadata } = draft;
        await this.store.write(draftKey, metadata);
      }
      if (!current()) return;
      if (
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      )
        this.response.set(undefined);
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 403
          ? 'Access to this operation is denied. Its private inputs are hidden. No execution was started.'
          : 'Reconnect to the original agent or sign in again, then refresh saved status. No execution was started.',
      );
    } finally {
      if (current()) this.busy.set(false);
    }
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton } from '@ionic/angular';
import { defer, filter, firstValueFrom, takeUntil } from 'rxjs';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { detectiveErrorMessage } from '../detective/detective-client.service';
import {
  ShippingApiService,
  ShippingPublicationIntent,
  ShippingPublicationState,
  SHIPPING_SOURCE,
  validatePublicationIntent,
} from './shipping-api.service';

interface PendingPublication {
  key: string;
  intent: ShippingPublicationIntent;
  conflict: boolean;
}
/** Current metadata is the CAS authority; an old operation receipt is never a grant. */
@Component({
  selector: 'sneat-datatug-shipping-query-access',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton],
  template: `<section aria-label="Shipping query access">
    <h2>Query access</h2>
    <p>
      Explicitly publish this isolated source for queries in the selected
      environment. This does not change project membership or paid access.
    </p>
    <label
      >Environment
      <select
        aria-label="Query-access environment"
        [value]="environment()"
        (change)="chooseEnvironment($any($event.target).value)"
        [disabled]="busy() || !!pending()"
      >
        <option value="">Choose an admitted environment</option>
        @for (name of environments(); track name) {
          <option [value]="name" [selected]="name === environment()">
            {{ name }}
          </option>
        }
      </select>
    </label>
    @if (loading()) {
      <p role="status">Reading current query access…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (current(); as state) {
      <p role="status">
        {{
          state.exists
            ? state.publication.enabled
              ? 'Query access enabled'
              : 'Query access disabled'
            : 'Query access not published'
        }}
      </p>
      @if (state.exists) {
        <p>Publication revision {{ state.publication.revision }}</p>
      }
    }
    @if (pending(); as operation) {
      <p>
        A previous {{ operation.intent.enabled ? 'enable' : 'disable' }} attempt
        may have completed. The original operation and expected revision are
        retained.
      </p>
      @if (operation.conflict) {
        <p>
          Review the current query access before preparing another operation.
        </p>
        <ion-button
          (click)="reviewConflict()"
          [disabled]="busy() || loading() || !current()"
          >I reviewed the conflict</ion-button
        >
      } @else {
        <ion-button
          (click)="send()"
          [disabled]="
            busy() || loading() || !current() || !canWrite() || !authReady()
          "
          >Retry original query-access operation</ion-button
        >
      }
    } @else if (current() && canWrite() && authReady() && !loading()) {
      <ion-button
        (click)="prepare(true)"
        [disabled]="busy() || enabled() || atCapacity()"
        >Enable query access</ion-button
      >
      <ion-button
        fill="outline"
        (click)="prepare(false)"
        [disabled]="busy() || !enabled() || atCapacity()"
        >Disable query access</ion-button
      >
      @if (atCapacity()) {
        <p role="status">
          This publication reached its revision limit. No new operation can be
          prepared.
        </p>
      }
    }
    @if (environment()) {
      <ion-button
        fill="clear"
        (click)="refresh()"
        [disabled]="busy() || loading()"
        >Refresh current query access</ion-button
      >
    }
    @if (busy()) {
      <p role="status">Waiting for query-access acknowledgement…</p>
    }
    @if (notice()) {
      <p role="status">{{ notice() }}</p>
    }
  </section>`,
})
export class ShippingQueryAccessComponent {
  readonly environments = input<readonly string[]>([]);
  readonly canWrite = input(false);
  readonly page = useDetectivePageContext();
  private readonly api = inject(ShippingApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly environment = signal('');
  private readonly key = computed(() =>
    JSON.stringify([this.page.identity(), this.environment()]),
  );
  private readonly loaded = signal<
    { key: string; value: ShippingPublicationState } | undefined
  >(undefined);
  readonly current = computed(() =>
    this.loaded()?.key === this.key() &&
    this.environments().includes(this.environment())
      ? this.loaded()?.value
      : undefined,
  );
  private readonly held = signal<PendingPublication | undefined>(undefined);
  readonly pending = computed(() =>
    this.held()?.key === this.key() ? this.held() : undefined,
  );
  readonly enabled = computed(() => {
    const value = this.current();
    return !!value?.exists && value.publication.enabled;
  });
  readonly atCapacity = computed(() => {
    const value = this.current();
    return !!value?.exists && value.publication.revision >= 32;
  });
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly authReady = signal(true);
  private readonly refreshVersion = signal(0);
  private readonly journalKey = 'datatug.shipping.publication.intent.v1';
  constructor() {
    effect(() => {
      const identity = this.page.identity(),
        names = this.environments();
      untracked(() => {
        if (!identity) {
          this.held.set(undefined);
          this.loaded.set(undefined);
          this.busy.set(false);
          return;
        }
        const existing = this.held();
        if (
          existing &&
          existing.key !==
            JSON.stringify([identity, existing.intent.environment])
        )
          this.reset();
        if (!names.length) return;
        if (this.environment() && !names.includes(this.environment()))
          this.environment.set('');
        this.restore(identity, names);
      });
    });
    effect((cleanup) => {
      this.refreshVersion();
      const key = this.key(),
        identity = this.page.identity(),
        environment = this.environment(),
        ref = this.page.ref();
      this.loaded.set(undefined);
      this.error.set('');
      this.loading.set(false);
      let cancelled = false;
      const current = () =>
        !cancelled && key === this.key() && !this.destroyRef.destroyed;
      if (
        !identity ||
        !ref ||
        !environment ||
        !this.environments().includes(environment)
      )
        return;
      this.loading.set(true);
      const subscription = this.api
        .publication(ref, environment)
        .pipe(
          takeUntil(
            this.page.scopeChanges$.pipe(filter((value) => value !== identity)),
          ),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe({
          next: (value) => {
            if (current()) {
              this.loaded.set({ key, value });
              this.authReady.set(true);
            }
          },
          error: (error) => {
            if (current()) this.fail(error);
          },
          complete: () => {
            if (current()) this.loading.set(false);
          },
        });
      cleanup(() => {
        cancelled = true;
        subscription.unsubscribe();
      });
    });
  }
  chooseEnvironment(value: string): void {
    if (
      this.busy() ||
      this.pending() ||
      (value && !this.environments().includes(value))
    )
      return;
    this.environment.set(value);
    this.notice.set('');
  }
  refresh(): void {
    this.refreshVersion.update((value) => value + 1);
  }
  prepare(enabled: boolean): void {
    const state = this.current(),
      ref = this.page.ref();
    if (
      !state ||
      !ref?.spaceID ||
      !this.canWrite() ||
      !this.authReady() ||
      this.busy() ||
      this.loading() ||
      this.pending() ||
      this.atCapacity() ||
      this.enabled() === enabled
    )
      return;
    const intent: ShippingPublicationIntent = {
      spaceID: ref.spaceID,
      projectId: ref.projectId,
      sourceId: SHIPPING_SOURCE,
      environment: this.environment(),
      operationId: crypto.randomUUID(),
      expectedRevision: state.exists ? state.publication.revision : 0,
      enabled,
    };
    const operation = { key: this.key(), intent, conflict: false };
    if (!this.journal(operation)) return;
    this.held.set(operation);
    void this.send();
  }
  async send(): Promise<void> {
    const operation = this.pending(),
      ref = this.page.ref(),
      actor = this.page.context()?.principal,
      identity = this.page.identity(),
      key = this.key();
    if (
      !operation ||
      !ref ||
      !actor ||
      !identity ||
      !this.canWrite() ||
      !this.authReady() ||
      !this.current() ||
      this.loading() ||
      this.busy() ||
      operation.conflict
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        defer(() => {
          if (key !== this.key() || identity !== this.page.identity())
            throw new Error('Project context changed.');
          return this.api.publish(ref, operation.intent, actor);
        }).pipe(
          takeUntil(
            this.page.scopeChanges$.pipe(filter((value) => value !== identity)),
          ),
          takeUntilDestroyed(this.destroyRef),
        ),
      );
      if (key !== this.key() || this.destroyRef.destroyed) return;
      this.clear();
      this.held.set(undefined);
      this.notice.set(
        'Operation acknowledged. Reading current query access; the receipt is not the current grant.',
      );
      this.refresh();
    } catch (error) {
      if (key !== this.key() || this.destroyRef.destroyed) return;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        const conflict = { ...operation, conflict: true };
        this.held.set(conflict);
        this.journal(conflict);
        this.refresh();
      }
      this.fail(error);
    } finally {
      if (key === this.key() && !this.destroyRef.destroyed)
        this.busy.set(false);
    }
  }
  reviewConflict(): void {
    if (
      !this.pending()?.conflict ||
      !this.current() ||
      this.loading() ||
      this.busy()
    )
      return;
    this.clear();
    this.held.set(undefined);
    this.error.set('');
    this.notice.set(
      'Conflict reviewed. A new action will use the observed publication revision.',
    );
  }
  private fail(error: unknown): void {
    this.loading.set(false);
    this.error.set(detectiveErrorMessage(error, true));
    if (
      error instanceof HttpErrorResponse &&
      [401, 403].includes(error.status)
    ) {
      this.loaded.set(undefined);
      this.authReady.set(false);
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      this.clear();
      this.held.set(undefined);
    }
  }
  private reset(): void {
    this.held.set(undefined);
    this.loaded.set(undefined);
    this.environment.set('');
    this.busy.set(false);
    this.authReady.set(true);
    this.clear();
  }
  private clear(): void {
    try {
      sessionStorage.removeItem(this.journalKey);
    } catch {
      /* no alternative persistence */
    }
  }
  private journal(operation: PendingPublication): boolean {
    try {
      sessionStorage.setItem(
        this.journalKey,
        JSON.stringify({ identity: this.page.identity(), ...operation }),
      );
      return true;
    } catch {
      this.error.set(
        'Session storage is unavailable. No query-access operation was started.',
      );
      return false;
    }
  }
  private restore(identity: string, names: readonly string[]): void {
    try {
      const raw = sessionStorage.getItem(this.journalKey);
      if (!raw) return;
      if (raw.length > 4096) throw new Error('Invalid query-access journal.');
      const value = JSON.parse(raw) as PendingPublication & {
        identity: string;
      };
      if (value.identity !== identity) {
        this.clear();
        return;
      }
      const ref = this.page.ref();
      if (!ref) return;
      validatePublicationIntent(ref, value.intent);
      if (!names.includes(value.intent.environment)) {
        this.clear();
        return;
      }
      if (
        value.key !== JSON.stringify([identity, value.intent.environment]) ||
        typeof value.conflict !== 'boolean'
      )
        throw new Error('Invalid query-access journal.');
      this.environment.set(value.intent.environment);
      this.held.set(value);
    } catch {
      this.clear();
      this.error.set(
        'The saved query-access operation could not be restored. Refresh current access before preparing an action.',
      );
    }
  }
}

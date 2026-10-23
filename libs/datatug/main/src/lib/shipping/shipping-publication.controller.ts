import { SOURCE_UI_SCOPE } from '../source-workspace/source-workspace-contract';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Injectable,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
@Injectable()
export class ShippingPublicationController {
  private readonly sourceScope = inject(SOURCE_UI_SCOPE, { optional: true });
  readonly environments = signal<readonly string[]>([]);
  readonly canWrite = signal(false);
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
  readonly recoveryBlocked = signal(false);
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
      (value &&
        this.sourceScope?.environment &&
        value !== this.sourceScope.environment) ||
      (value && !this.environments().includes(value))
    )
      return;
    this.environment.set(value);
    this.notice.set('');
  }
  invalidateReadState() {
    this.loaded.set(undefined);
    this.authReady.set(false);
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
      this.recoveryBlocked() ||
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
    this.recoveryBlocked.set(false);
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
      if (
        this.sourceScope?.environment &&
        value.intent.environment !== this.sourceScope.environment
      ) {
        this.recoveryBlocked.set(true);
        this.notice.set(
          'An original query-access operation belongs to another environment. Return there to review its uncertain delivery.',
        );
        return;
      }
      if (!names.includes(value.intent.environment)) {
        this.clear();
        return;
      }
      if (
        value.key !== JSON.stringify([identity, value.intent.environment]) ||
        typeof value.conflict !== 'boolean'
      )
        throw new Error('Invalid query-access journal.');
      this.recoveryBlocked.set(false);
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

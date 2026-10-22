import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

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

@Injectable()
export class ShippingWorkspaceController {
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
  readonly readDenied = signal(false);
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
            this.readDenied.set(false);
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
  invalidateReadState() {
    this.revision.set(undefined);
    this.grantedFor.set(undefined);
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
    if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
      this.readDenied.set(true);
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

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
import { Router } from '@angular/router';

import {
  Subject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  takeUntil,
} from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { projectPageHref } from '../nav/project-page-href';
import { SHIPPING_SOURCE, shippingScope } from './shipping-api.service';
import {
  SHIPPING_COMPONENT,
  ShippingComponentApiService,
  ShippingComponentIntent,
  ShippingComponentState,
  componentIntent,
} from './shipping-component-api.service';

interface InstallationJournal {
  scope: string;
  actor: string;
  intent: ShippingComponentIntent;
  phase: 'uncertain' | 'acknowledged' | 'conflict';
}
@Injectable()
export class ShippingInstallationController {
  private readonly sourceScope = inject(SOURCE_UI_SCOPE, { optional: true });
  readonly page = useDetectivePageContext();
  private readonly api = inject(ShippingComponentApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cancel = new Subject<void>();
  private epoch = 0;
  readonly state = signal<ShippingComponentState | undefined>(undefined);
  readonly pending = signal<InstallationJournal | undefined>(undefined);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly journalInvalid = signal(false);
  private readonly authorizedFor = signal<string | undefined>(undefined);
  readonly currentAuthorized = computed(
    () =>
      (!this.sourceScope?.environment ||
        this.sourceScope.environment === 'demo') &&
      !!this.page.context()?.principal &&
      this.authorizedFor() === this.page.identity(),
  );
  href(parts: string[]) {
    const tree = this.router.parseUrl(projectPageHref(this.page.ref(), parts));
    if (parts[0] === 'board') tree.queryParams = { environment: 'demo' };
    if (parts[0] === 'query') tree.queryParams = { env: 'demo' };
    return tree;
  }
  constructor() {
    // The original stream cancels synchronously, before a waiting credential
    // can deliver the old demo mutation after navigation changes environment.
    inject(DatatugNavContextService)
      .currentEnv.pipe(
        map((environment) => environment?.id),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.reset());
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reset());
    effect(() => {
      this.page.identity();
      this.page.currentEnvironment();
      untracked(() => {
        this.reset();
        this.restore();
        void this.refresh();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.epoch++;
      this.cancel.next();
      this.cancel.complete();
    });
  }
  private reset() {
    this.epoch++;
    this.cancel.next();
    this.state.set(undefined);
    this.pending.set(undefined);
    this.authorizedFor.set(undefined);
    this.loading.set(false);
    this.busy.set(false);
    this.error.set('');
    this.journalInvalid.set(false);
  }
  private key() {
    return (
      'datatug.shipping.component.install.v1:' +
      encodeURIComponent(this.page.identity() || '')
    );
  }
  private persist(journal: InstallationJournal): boolean {
    try {
      sessionStorage.setItem(this.key(), JSON.stringify(journal));
      return true;
    } catch {
      this.error.set(
        'Session storage is unavailable. Installation cannot start without preserving its original operation.',
      );
      return false;
    }
  }
  private restore() {
    try {
      const raw = sessionStorage.getItem(this.key());
      if (!raw) return;
      if (raw.length > 4096) throw new Error();
      const held = JSON.parse(raw) as InstallationJournal;
      const ref = this.page.ref();
      const actor = this.page.context()?.principal;
      if (
        !ref ||
        !actor ||
        held.scope !== this.page.identity() ||
        held.actor !== actor ||
        !['uncertain', 'acknowledged', 'conflict'].includes(held.phase)
      )
        throw new Error();
      const intent = componentIntent(ref, held.intent);
      this.pending.set({ ...held, intent });
    } catch {
      this.journalInvalid.set(true);
      this.error.set(
        'The saved installation operation could not be verified. No installation was sent.',
      );
    }
  }
  invalidateReadState() {
    this.state.set(undefined);
    this.authorizedFor.set(undefined);
  }
  async refresh() {
    const ref = this.page.ref(),
      identity = this.page.identity(),
      actor = this.page.context()?.principal;
    if (!ref || !identity || !actor || this.busy()) return;
    try {
      shippingScope(ref);
    } catch {
      return;
    }
    const epoch = ++this.epoch;
    this.cancel.next();
    this.loading.set(true);
    this.state.set(undefined);
    this.authorizedFor.set(undefined);
    try {
      const current = await firstValueFrom(
        this.api
          .current(ref)
          .pipe(
            takeUntil(this.cancel),
            takeUntil(
              this.page.scopeChanges$.pipe(
                filter((value) => value !== identity),
              ),
            ),
            takeUntilDestroyed(this.destroyRef),
          ),
      );
      if (!this.alive(epoch, identity)) return;
      this.state.set(current);
      this.authorizedFor.set(identity);
      this.error.set('');
      const held = this.pending();
      if (
        held &&
        current.installation?.operationId === held.intent.operationId &&
        current.installation.actorId === actor &&
        current.installation.digest === held.intent.componentDigest
      ) {
        sessionStorage.removeItem(this.key());
        this.pending.set(undefined);
      }
    } catch (error) {
      if (this.alive(epoch, identity)) {
        this.state.set(undefined);
        this.authorizedFor.set(undefined);
        this.fail(error, false);
      }
    } finally {
      if (this.alive(epoch, identity)) this.loading.set(false);
    }
  }
  install() {
    const ref = this.page.ref(),
      actor = this.page.context()?.principal,
      scope = this.page.identity(),
      current = this.state();
    if (
      !ref ||
      !ref.spaceID ||
      !actor ||
      !scope ||
      !current ||
      current.exists ||
      !this.currentAuthorized() ||
      this.journalInvalid() ||
      this.pending() ||
      this.busy() ||
      this.loading()
    )
      return;
    const intent: ShippingComponentIntent = {
      spaceID: ref.spaceID,
      projectId: ref.projectId,
      sourceId: SHIPPING_SOURCE,
      environment: 'demo',
      operationId: crypto.randomUUID(),
      componentId: SHIPPING_COMPONENT,
      version: current.available.version,
      componentDigest: current.available.digest,
    };
    const journal: InstallationJournal = {
      scope,
      actor,
      intent: componentIntent(ref, intent),
      phase: 'uncertain',
    };
    if (!this.persist(journal)) return;
    this.pending.set(journal);
    void this.send();
  }
  reviewConflict() {
    const held = this.pending();
    if (
      held?.phase !== 'conflict' ||
      this.state()?.exists !== false ||
      !this.currentAuthorized() ||
      this.busy() ||
      this.loading()
    )
      return;
    // Only this deliberate review supersedes the failed intent. Persisting the
    // new frozen intent replaces the old journal atomically before delivery.
    this.pending.set(undefined);
    this.install();
    if (!this.pending()) this.pending.set(held);
  }
  async send() {
    const held = this.pending(),
      ref = this.page.ref(),
      identity = this.page.identity(),
      actor = this.page.context()?.principal;
    if (
      !held ||
      !ref ||
      !identity ||
      !actor ||
      held.scope !== identity ||
      held.actor !== actor ||
      held.phase !== 'uncertain' ||
      this.busy() ||
      this.loading() ||
      !this.currentAuthorized()
    )
      return;
    const epoch = this.epoch;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.api
          .install(ref, held.intent, actor)
          .pipe(
            takeUntil(this.cancel),
            takeUntil(
              this.page.scopeChanges$.pipe(
                filter((value) => value !== identity),
              ),
            ),
            takeUntilDestroyed(this.destroyRef),
          ),
      );
      if (!this.alive(epoch, identity)) return;
      const acknowledged = { ...held, phase: 'acknowledged' as const };
      this.persist(acknowledged);
      this.pending.set(acknowledged);
      this.busy.set(false);
      await this.refresh();
    } catch (error) {
      if (!this.alive(epoch, identity)) return;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.state.set(undefined);
        this.authorizedFor.set(undefined);
        const conflict = { ...held, phase: 'conflict' as const };
        this.persist(conflict);
        this.pending.set(conflict);
      }
      if (
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.state.set(undefined);
        this.authorizedFor.set(undefined);
      }
      this.fail(error, true);
    } finally {
      if (this.alive(epoch, identity)) this.busy.set(false);
    }
  }
  private alive(epoch: number, identity: string) {
    return (
      !this.destroyRef.destroyed &&
      epoch === this.epoch &&
      identity === this.page.identity()
    );
  }
  private fail(error: unknown, mutation: boolean) {
    if (error instanceof HttpErrorResponse && [401, 403].includes(error.status))
      this.error.set(
        'Current shipping access could not be verified. Sign in and check this project’s query access, then refresh.',
      );
    else if (error instanceof HttpErrorResponse && error.status === 409)
      this.error.set(
        'Installation conflicts with existing content. Refresh and review the current state.',
      );
    else
      this.error.set(
        mutation
          ? 'Installation could not be confirmed. The original operation is retained for an explicit retry.'
          : 'Current installation could not be confirmed. Refresh to try again.',
      );
  }
}

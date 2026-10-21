import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonSpinner } from '@ionic/angular';
import { Subject, filter, firstValueFrom, takeUntil } from 'rxjs';
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
@Component({
  selector: 'sneat-shipping-component-installer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonButton, IonSpinner],
  template: `<section aria-labelledby="shipping-component-title">
    <h2 id="shipping-component-title">Shipping investigation content</h2>
    <p>
      Prepare this content before the investigation. Adds eight saved queries,
      the Request received Check, Order and ShippingRequest entities, and the
      Shipping board in environment demo. Existing definitions are never
      overwritten.
    </p>
    @if (loading()) {
      <p role="status">
        <ion-spinner name="lines-small" /> Checking current installation…
      </p>
    }
    @if (journalInvalid()) {
      <p role="alert">
        The saved installation operation could not be verified. No new operation
        will be sent.
      </p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (state()?.installation; as installed) {
      <p role="status">Shipping content is installed.</p>
      <p>
        <a [routerLink]="href(['board', installed.boardIds[0]])"
          >Open shipping board</a
        >
        ·
        <a [routerLink]="href(['query', 'shipping/request-receipt'])"
          >Open Request received query</a
        >
        ·
        <a [routerLink]="href(['checks', installed.checkIds[0]])"
          >Open Request received Check</a
        >
      </p>
    }
    @if (pending(); as original) {
      @if (original.phase === 'conflict') {
        <p>
          The server refused this operation. Review the current installation and
          any existing definitions. No replacement operation will be sent
          automatically.
        </p>
      } @else if (original.phase === 'acknowledged') {
        <p role="status">
          The installation was acknowledged. Confirm its current state before
          opening content.
        </p>
      } @else {
        <p role="status">
          Installation has not been confirmed. A previous attempt may have
          completed. Retry keeps the original operation and component version.
        </p>
        <ion-button
          (click)="send()"
          [disabled]="busy() || loading() || !currentAuthorized()"
          >Retry original installation</ion-button
        >
      }
    } @else if (state()?.exists === false) {
      <p>No shipping component is installed.</p>
      <ion-button
        (click)="install()"
        [disabled]="busy() || loading() || !currentAuthorized() || journalInvalid()"
        >Install shipping content</ion-button
      >
    }
    @if (busy()) {
      <p role="status">
        <ion-spinner name="lines-small" /> Waiting for installation…
      </p>
    }
    <ion-button
      fill="clear"
      (click)="refresh()"
      [disabled]="busy() || loading()"
      >Refresh installation</ion-button
    >
  </section>`,
})
export class ShippingComponentInstallerComponent {
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
    this.page.scopeChanges$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reset());
    effect(() => {
      this.page.identity();
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

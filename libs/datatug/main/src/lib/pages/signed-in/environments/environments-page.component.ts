import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonReorder,
  IonReorderGroup,
  IonSkeletonText,
  IonSpinner,
  IonToolbar,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  arrowUpOutline,
  arrowDownOutline,
  warningOutline,
} from 'ionicons/icons';
import { combineLatest, firstValueFrom, of, timeout } from 'rxjs';
import {
  environmentTrimName,
  verifyEnvironmentReceipt,
} from '../../../models/definition/environment-receipt';
import {
  EnvironmentOperationRecoveryService,
  PendingEnvironmentOperation,
} from '../../../services/project/environment-operation-recovery.service';
import {
  catchError,
  distinctUntilChanged,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { equalProjectRef } from '../../../core/project-context';
import { environmentPresentation } from '../../../models/definition/environment-presentation';
import { IEnvironmentFull } from '../../../models/definition/environments';
import {
  EnvironmentState,
  EnvironmentOperationResult,
} from '../../../models/definition/environment-state';
import { IProjectContext } from '../../../nav/nav-models';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { ProjectAssetsReadService } from '../../../services/project/project-assets-read.service';
import { ProjectEnvironmentStateService } from '../../../services/project/project-environment-state.service';
import { SneatDatatugPageTitleComponent } from '../../../components/page-title/sneat-datatug-page-title.component';

@Component({
  selector: 'sneat-datatug-environments',
  templateUrl: './environments-page.component.html',
  styleUrl: './environments-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonChip,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonReorder,
    IonReorderGroup,
    IonSkeletonText,
    IonSpinner,
    IonToolbar,
    SneatDatatugPageTitleComponent,
  ],
})
export class EnvironmentsPageComponent {
  readonly datatugNavContextService = inject(DatatugNavContextService);
  private readonly nav = inject(DatatugNavService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly service = inject(ProjectEnvironmentStateService);
  private readonly recovery = inject(EnvironmentOperationRecoveryService);
  protected readonly recoveryReady = signal(false);
  private actor = '';
  private readonly auth = inject(SneatAuthStateService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly destroyRef = inject(DestroyRef);
  private projectContext?: IProjectContext;
  private generation = 0;
  protected readonly state = signal<EnvironmentState | undefined>(undefined);
  protected readonly environments = signal<
    readonly IEnvironmentFull[] | undefined
  >(undefined);
  protected readonly loadError = signal(false);
  protected readonly reason = signal('');
  protected readonly presentation = environmentPresentation;
  protected readonly warningIcon = warningOutline;
  protected readonly upIcon = arrowUpOutline;
  protected readonly downIcon = arrowDownOutline;
  protected readonly editing = signal(false);
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly draft = signal<readonly IEnvironmentFull[]>([]);
  protected name = '';
  private readonly nameInput = viewChild<IonInput>('nameInput');
  protected readonly rejected = signal(false);
  private pending?: PendingEnvironmentOperation;

  private current(
    operation: PendingEnvironmentOperation,
    generation: number,
  ): boolean {
    return (
      generation === this.generation &&
      operation.actor === this.actor &&
      equalProjectRef(operation.project, this.projectContext?.ref)
    );
  }
  private async restore(
    state: EnvironmentState,
    generation: number,
  ): Promise<void> {
    const project = this.projectContext;
    if (!project) return;
    // The authoritative binding already includes the verified transport actor.
    // Firebase sign-out must not hide an agent operation whose agent actor is unchanged.
    this.actor = state.scopeBinding;
    try {
      const operation = await this.recovery.read(this.actor, project.ref);
      if (generation !== this.generation) return;
      this.pending = operation;
      this.recoveryReady.set(true);
      if (!operation) return;
      if (
        operation.version !== 1 ||
        operation.actor !== this.actor ||
        !equalProjectRef(operation.project, project.ref) ||
        !operation.request.operationId.startsWith(
          `${operation.before.scopeBinding}.`,
        )
      )
        throw new Error('Recovery scope is invalid.');
      this.rejected.set(operation.definitiveRejection === true);
      if ('name' in operation.request) {
        this.name = operation.request.name;
        this.creating.set(true);
      } else {
        this.draft.set(
          operation.request.environmentOrder.map(
            (id) =>
              operation.before.environments.find((row) => row.id === id) || {
                id,
                title: id,
              },
          ),
        );
        this.editing.set(true);
      }
      if (
        state.scopeBinding !== operation.before.scopeBinding ||
        JSON.stringify(state.scope) !== JSON.stringify(operation.request.scope)
      ) {
        this.message.set(
          'A previous operation belongs to another authority or actor binding. Reconnect that original authority to reconcile it before starting a new change.',
        );
        return;
      }
      if (operation.definitiveRejection)
        this.message.set(
          'A rejected operation was recovered. Reload latest state before correcting your draft.',
        );
      else void this.reconcile();
    } catch {
      if (generation !== this.generation) return;
      this.recoveryReady.set(false);
      this.message.set(
        'Device recovery storage is unavailable or invalid. New changes are blocked until recovery storage can be read safely.',
      );
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.generation++;
    });
    combineLatest([
      this.datatugNavContextService.currentProject.pipe(
        distinctUntilChanged((left, right) =>
          equalProjectRef(left?.ref, right?.ref),
        ),
      ),
      this.auth.authState.pipe(
        map((auth) => `${auth.status}:${auth.user?.uid || ''}`),
        distinctUntilChanged(),
      ),
    ])
      .pipe(
        tap(([project, actor]) => {
          this.actor = actor;
          this.recoveryReady.set(false);
          this.generation++;
          this.projectContext = project;
          this.pending = undefined;
          this.rejected.set(false);
          this.state.set(undefined);
          this.environments.set(undefined);
          this.loadError.set(false);
          this.reason.set('');
          this.editing.set(false);
          this.creating.set(false);
          this.busy.set(false);
          this.message.set('');
        }),
        switchMap(([project]) =>
          project
            ? this.service
                .view(project.ref, () =>
                  this.assets.legacyEnvironments(project.ref),
                )
                .pipe(
                  catchError((error) => {
                    this.loadError.set(true);
                    this.errorLogger.logError(
                      error,
                      'Failed to load project environments',
                    );
                    return of(undefined);
                  }),
                )
            : of({ items: [] }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((view) => {
        if (!view) return;
        this.state.set('state' in view ? view.state : undefined);
        this.environments.set(view.items);
        this.reason.set(('reason' in view && view.reason) || '');
        if ('state' in view && view.state)
          void this.restore(view.state, this.generation);
      });
  }

  protected goEnvironment(environment: IEnvironmentFull): void {
    if (this.projectContext && !this.editing())
      this.nav.goEnvironment(this.projectContext, environment);
  }
  protected async add(): Promise<void> {
    if (
      !this.recoveryReady() ||
      this.pending ||
      !this.state()?.capabilities.canCreateEnvironment
    )
      return;
    this.creating.set(true);
    await Promise.resolve();
    await this.nameInput()?.setFocus();
  }
  protected manage(): void {
    if (
      !this.recoveryReady() ||
      this.pending ||
      !this.state()?.capabilities.canWriteOrder
    )
      return;
    this.draft.set([...(this.environments() || [])]);
    this.editing.set(true);
    this.message.set('');
  }
  protected move(index: number, delta: number): void {
    if (this.busy() || this.pending) return;
    const rows = [...this.draft()];
    const next = index + delta;
    if (next < 0 || next >= rows.length) return;
    [rows[index], rows[next]] = [rows[next], rows[index]];
    this.draft.set(rows);
  }
  protected reorder(
    event: CustomEvent<{
      from: number;
      to: number;
      complete: (value: boolean) => void;
    }>,
  ): void {
    const rows = [...this.draft()];
    const [row] = rows.splice(event.detail.from, 1);
    rows.splice(event.detail.to, 0, row);
    if (!this.busy() && !this.pending) this.draft.set(rows);
    event.detail.complete(false);
  }
  protected cancel(): void {
    if (this.busy()) return;
    this.editing.set(false);
    this.creating.set(false);
    this.message.set(
      this.pending
        ? 'The operation may still complete. Reconcile before starting another change.'
        : '',
    );
  }
  protected get unresolved(): boolean {
    return !!this.pending;
  }
  protected async submit(kind: 'create' | 'order'): Promise<void> {
    const state = this.state();
    if (
      !state ||
      !this.projectContext ||
      !this.recoveryReady() ||
      this.busy() ||
      this.pending
    )
      return;
    if (
      kind === 'create'
        ? !state.capabilities.canCreateEnvironment
        : !state.capabilities.canWriteOrder
    )
      return;
    const name = environmentTrimName(this.name);
    if (
      kind === 'create' &&
      (!name ||
        Array.from(name).length > 200 ||
        Array.from(name).some(
          (character) =>
            (character.codePointAt(0) ?? 0) < 32 ||
            character.codePointAt(0) === 127,
        ))
    ) {
      this.message.set(
        'Enter a name of 1–200 characters without control characters.',
      );
      return;
    }
    this.rejected.set(false);
    const generation = this.generation;
    const operation: PendingEnvironmentOperation = {
      version: 1,
      actor: this.actor,
      project: { ...this.projectContext.ref },
      before: state,
      attempts: 0,
      request:
        kind === 'create'
          ? { ...this.service.mutation(state), name }
          : {
              ...this.service.mutation(state),
              environmentOrder: this.draft().map((row) => row.id),
            },
    };
    this.busy.set(true);
    try {
      await this.recovery.reserve(operation);
      if (!this.current(operation, generation)) return;
      this.pending = operation;
      this.busy.set(false);
      await this.retry();
    } catch {
      if (generation !== this.generation) return;
      this.busy.set(false);
      this.recoveryReady.set(false);
      this.message.set(
        'The operation was not sent because durable recovery could not be reserved. Reload to recover any existing operation.',
      );
    }
  }
  private async admitted(
    operation: PendingEnvironmentOperation,
    write: boolean,
  ): Promise<EnvironmentState> {
    const state = await firstValueFrom(
      this.service
        .read(operation.project)
        .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)),
    );
    if (
      state.scopeBinding !== operation.before.scopeBinding ||
      JSON.stringify(state.scope) !== JSON.stringify(operation.request.scope) ||
      !state.capabilities.canReadOrder ||
      (write &&
        ('name' in operation.request
          ? !state.capabilities.canCreateEnvironment
          : !state.capabilities.canWriteOrder))
    )
      throw new Error('Current authority does not admit this operation.');
    return state;
  }
  protected async retry(): Promise<void> {
    let operation = this.pending;
    const generation = this.generation;
    if (!operation || this.busy() || this.rejected() || !this.recoveryReady())
      return;
    this.busy.set(true);
    this.message.set('Checking current access…');
    try {
      await this.admitted(operation, true);
      if (!this.current(operation, generation)) return;
      operation = await this.recovery.attempt(operation);
      if (!this.current(operation, generation)) return;
      this.pending = operation;
      this.message.set('Saving…');
      try {
        await firstValueFrom(
          ('name' in operation.request
            ? this.service.create(operation.project, operation.request)
            : this.service.save(operation.project, operation.request)
          ).pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)),
        );
      } catch (error) {
        const rejected = error as {
          status?: number;
          error?: { code?: string; error?: { code?: string } };
        };
        const code = rejected.error?.error?.code || rejected.error?.code;
        if (
          operation.attempts === 1 &&
          ([400, 401, 403].includes(rejected.status || 0) ||
            (rejected.status === 409 &&
              code === 'ENVIRONMENT_REVISION_CONFLICT'))
        ) {
          operation = { ...operation, definitiveRejection: true };
          await this.recovery.reserve(operation);
          if (!this.current(operation, generation)) return;
          this.pending = operation;
          this.rejected.set(true);
          this.busy.set(false);
          this.message.set(
            'Change was rejected. Your draft is retained. Reload latest state before trying again.',
          );
          return;
        }
      }
      if (!this.current(operation, generation)) return;
      this.busy.set(false);
      await this.reconcile();
    } catch {
      if (generation !== this.generation) return;
      this.busy.set(false);
      this.message.set(
        'Current access or durable recovery could not be verified. The original operation is retained; reconnect and reconcile before retrying.',
      );
    }
  }
  protected async reconcile(): Promise<void> {
    const operation = this.pending;
    const generation = this.generation;
    if (!operation || this.busy() || !this.recoveryReady()) return;
    this.busy.set(true);
    try {
      await this.admitted(operation, false);
      if (!this.current(operation, generation)) return;
      const receipt = await firstValueFrom(
        this.service
          .status(operation.project, operation.request)
          .pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)),
      );
      await verifyEnvironmentReceipt(
        operation.before,
        operation.request,
        receipt,
      );
      const state = await this.admitted(operation, false);
      if (!this.current(operation, generation)) return;
      await this.recovery.remove(operation);
      if (!this.current(operation, generation)) return;
      this.state.set(state);
      this.environments.set(state.environments);
      this.service.changed(operation.project);
      this.busy.set(false);
      this.confirm(
        'name' in operation.request ? 'create' : 'order',
        receipt,
        state,
      );
    } catch {
      if (generation !== this.generation) return;
      this.busy.set(false);
      this.message.set(
        'The original operation is still unresolved or its receipt could not be verified. Keep this draft and reconcile; retry sends the same operation only.',
      );
    }
  }
  protected async reloadLatest(): Promise<void> {
    const operation = this.pending;
    const generation = this.generation;
    if (!operation?.definitiveRejection || this.busy()) return;
    this.busy.set(true);
    try {
      const state = await this.admitted(operation, false);
      await this.recovery.remove(operation);
      if (!this.current(operation, generation)) return;
      this.state.set(state);
      this.environments.set(state.environments);
      this.pending = undefined;
      this.rejected.set(false);
      this.busy.set(false);
      this.message.set(
        'Latest state loaded. Review your draft before saving again.',
      );
    } catch {
      if (generation !== this.generation) return;
      this.busy.set(false);
      this.message.set(
        'Could not load latest state or clear recovery safely. Your draft is retained.',
      );
    }
  }

  private confirm(
    kind: 'create' | 'order',
    receipt: EnvironmentOperationResult,
    state: EnvironmentState,
  ): void {
    if (kind === 'create') {
      const created = state.environments.find(
        (row) => row.id === receipt.environmentId,
      );
      this.pending = undefined;
      if (!created) {
        this.message.set(
          'The environment was created and subsequently removed. No replacement was created.',
        );
        return;
      }
      this.creating.set(false);
      this.name = '';
      if (this.projectContext)
        this.nav.goEnvironment(this.projectContext, created, undefined, {
          replaceUrl: true,
        });
    } else {
      const matches =
        JSON.stringify(receipt.environmentOrder) ===
        JSON.stringify(state.order);
      this.pending = undefined;
      this.editing.set(false);
      this.message.set(
        matches ? 'Order saved.' : 'Order saved; a newer change is now shown.',
      );
    }
  }
}

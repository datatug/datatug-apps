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
import { combineLatest, forkJoin, of } from 'rxjs';
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
  CreateEnvironmentRequest,
  SaveEnvironmentOrderRequest,
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
  private pending?: {
    request: CreateEnvironmentRequest | SaveEnvironmentOrderRequest;
    kind: 'create' | 'order';
    generation: number;
  };

  constructor() {
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
        tap(([project]) => {
          this.generation++;
          this.projectContext = project;
          this.pending = undefined;
          this.rejected.set(false);
          this.state.set(undefined);
          this.environments.set(undefined);
          this.loadError.set(false);
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
      });
  }

  protected goEnvironment(environment: IEnvironmentFull): void {
    if (this.projectContext && !this.editing())
      this.nav.goEnvironment(this.projectContext, environment);
  }
  protected async add(): Promise<void> {
    this.creating.set(true);
    await Promise.resolve();
    await this.nameInput()?.setFocus();
  }
  protected manage(): void {
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
  protected submit(kind: 'create' | 'order'): void {
    const state = this.state();
    if (!state || !this.projectContext || this.busy() || this.pending) return;
    if (
      kind === 'create'
        ? !state.capabilities.canCreateEnvironment
        : !state.capabilities.canWriteOrder
    )
      return;
    const name = this.name.trim();
    if (
      kind === 'create' &&
      (!name ||
        Array.from(name).length > 200 ||
        Array.from(name).some(
          (character) =>
            character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
        ))
    ) {
      this.message.set(
        'Enter a name of 1–200 characters without control characters.',
      );
      return;
    }
    this.rejected.set(false);
    this.pending = {
      kind,
      generation: this.generation,
      request:
        kind === 'create'
          ? { ...this.service.mutation(state), name }
          : {
              ...this.service.mutation(state),
              environmentOrder: this.draft().map((row) => row.id),
            },
    };
    this.retry();
  }
  protected retry(): void {
    const pending = this.pending;
    const project = this.projectContext;
    if (!pending || !project || this.busy()) return;
    this.busy.set(true);
    this.message.set('Saving…');
    const request =
      pending.kind === 'create'
        ? this.service.create(
            project.ref,
            pending.request as CreateEnvironmentRequest,
          )
        : this.service.save(
            project.ref,
            pending.request as SaveEnvironmentOrderRequest,
          );
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        if (pending.generation !== this.generation) return;
        if (result.operationId !== pending.request.operationId) {
          this.busy.set(false);
          this.message.set(
            'The response could not be verified. Reconcile this operation.',
          );
          return;
        }
        this.busy.set(false);
        this.reconcile();
      },
      error: (error) => {
        if (pending.generation !== this.generation) return;
        this.busy.set(false);
        // These errors conclusively reject this request. A new operation still requires latest state.
        if (
          [400, 401, 403].includes(error?.status) ||
          (error?.status === 409 &&
            error?.error?.code === 'ENVIRONMENT_REVISION_CONFLICT')
        ) {
          this.rejected.set(true);
          this.message.set(
            'Change was rejected. Your draft is retained. Reload latest state before trying again.',
          );
        } else
          this.message.set(
            'The outcome is uncertain. Reconcile or retry the same operation.',
          );
        if (!this.rejected()) this.reconcile();
      },
    });
  }
  protected reconcile(): void {
    const pending = this.pending;
    const project = this.projectContext;
    if (!pending || !project || this.busy()) return;
    this.busy.set(true);
    forkJoin({
      state: this.service.read(project.ref),
      receipt: this.service.status(project.ref, pending.request),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ state, receipt }) => {
          if (
            pending.generation !== this.generation ||
            !equalProjectRef(project.ref, this.projectContext?.ref)
          )
            return;
          this.busy.set(false);
          this.state.set(state);
          this.environments.set(state.environments);
          if (
            receipt.operationId !== pending.request.operationId ||
            receipt.status !== 'committed'
          ) {
            this.message.set(
              'The operation is unresolved. Keep this draft and reconcile or retry the same operation.',
            );
            return;
          }
          this.confirm(pending.kind, receipt, state);
        },
        error: () => {
          if (pending.generation !== this.generation) return;
          this.busy.set(false);
          this.message.set(
            'Could not confirm the outcome. Keep this draft and reconcile or retry the same operation.',
          );
        },
      });
  }
  protected reloadLatest(): void {
    const project = this.projectContext;
    const generation = this.generation;
    if (!project || this.busy() || !this.rejected()) return;
    this.busy.set(true);
    this.service
      .read(project.ref)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (state) => {
          if (generation !== this.generation) return;
          this.busy.set(false);
          this.state.set(state);
          this.environments.set(state.environments);
          this.pending = undefined;
          this.rejected.set(false);
          this.message.set(
            'Latest state loaded. Review your draft before saving again.',
          );
        },
        error: () => {
          if (generation === this.generation) {
            this.busy.set(false);
            this.message.set(
              'Could not load latest state. Your draft is retained.',
            );
          }
        },
      });
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

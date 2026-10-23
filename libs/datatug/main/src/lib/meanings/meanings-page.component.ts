import { BusinessClockChipComponent } from '../source-workspace/business-clock-chip.component';
import { isCanonicalPublicDemo } from '../detective/public-scenario-catalog';
import { NewProjectService } from '../project/new-project/new-project.service';
import { resolveDemoProjectCopySource } from '../project/new-project/github-project-copy-source';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ViewWillEnter,
  ViewWillLeave,
} from '@ionic/angular';
import { projectRefToString } from '../core/project-context';
import { firstValueFrom } from 'rxjs';
import { projectPageHref } from '../nav/project-page-href';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectMeaningsService } from './project-meanings.service';
import { ProjectMeaningsCapacityError } from './project-meanings-contract';
import type {
  MeaningEntity,
  MeaningField,
  MeaningIdentity,
  MeaningResource,
  ProjectMeaningAction,
  ProjectMeaningsCatalog,
} from './project-meanings-contract';

@Component({
  selector: 'sneat-datatug-meanings-page',
  providers: [NewProjectService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meanings-page.component.html',
  styles: [
    `
      ion-card {
        max-width: 70rem;
        margin-inline: auto;
      }
      ion-card:first-child {
        margin-top: 1rem;
      }
      form {
        padding: 1rem;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .identity {
        overflow-wrap: anywhere;
      }
      ion-label p {
        white-space: normal;
      }
    `,
  ],
  imports: [
    BusinessClockChipComponent,
    ReactiveFormsModule,
    RouterLink,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSpinner,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
})
export class MeaningsPageComponent implements ViewWillEnter, ViewWillLeave {
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  readonly canCopyDemo = computed(() => isCanonicalPublicDemo(this.ref()));
  private readonly router = inject(Router);
  private readonly navContext = inject(DatatugNavContextService);
  private readonly service = inject(ProjectMeaningsService);
  private readonly project = toSignal(this.navContext.currentProject, {
    initialValue: undefined,
  });
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly routeData = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });
  readonly ref = computed(() => this.project()?.ref);
  readonly effectiveRef = computed(() => {
    const ref = this.ref(),
      catalog = this.catalog();
    return ref && catalog ? this.service.refForCatalog(ref, catalog) : ref;
  });
  readonly mode = computed(
    () =>
      (this.routeData()['meaningMode'] as
        | 'list'
        | 'entity'
        | 'field'
        | 'new-entity'
        | 'new-field') || 'list',
  );
  readonly catalog = signal<ProjectMeaningsCatalog | undefined>(undefined);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly pending = signal(false);
  readonly confirmDelete = signal(false);
  readonly submitted = signal(false);
  readonly filter = signal('');
  private readonly retryVersion = signal(0);
  private lifetime = 0;
  private entered = false;
  ionViewWillEnter(): void {
    if (this.entered) this.retry();
    this.entered = true;
  }
  ionViewWillLeave(): void {
    this.lifetime++;
    this.pending.set(false);
    this.confirmDelete.set(false);
  }
  readonly entity = computed(() =>
    this.catalog()?.entities.find(
      (entity) =>
        entity.documentId === this.params().get('document') &&
        entity.conceptId === this.params().get('concept'),
    ),
  );
  readonly field = computed(() =>
    this.entity()?.fields.find(
      (field) =>
        field.conceptId === this.params().get('field') &&
        field.documentId ===
          (this.params().get('fieldDocument') ?? this.entity()?.documentId),
    ),
  );
  readonly filteredEntities = computed(() => {
    const search = this.filter().trim().toLocaleLowerCase();
    return (this.catalog()?.entities ?? []).filter(
      (entity) =>
        !search ||
        [
          entity.name,
          entity.conceptId,
          ...entity.fields.map((field) => field.name),
        ].some((value) => value.toLocaleLowerCase().includes(search)),
    );
  });
  readonly creating = computed(
    () => this.mode() === 'new-entity' || this.mode() === 'new-field',
  );
  readonly canCreate = computed(
    () =>
      this.catalog()?.writable === true &&
      (this.mode() !== 'new-field' || this.entity()?.origin === 'project'),
  );
  readonly canDelete = computed(() => {
    const catalog = this.catalog(),
      entity = this.entity();
    if (
      !catalog?.writable ||
      !catalog.referencesComplete ||
      entity?.origin !== 'project'
    )
      return false;
    return this.mode() === 'field'
      ? !!this.field() && this.field()?.resources.length === 0
      : this.mode() === 'entity' &&
          entity.resources.length === 0 &&
          entity.fields.every((field) => field.resources.length === 0);
  });
  readonly resources = computed(() =>
    this.mode() === 'field'
      ? (this.field()?.resources ?? [])
      : (this.entity()?.resources ?? []),
  );
  readonly title = computed(() =>
    this.mode() === 'new-entity'
      ? 'New meaning entity'
      : this.mode() === 'new-field'
        ? 'New meaning field'
        : this.mode() === 'field'
          ? this.field()?.name || 'Meaning field'
          : this.mode() === 'entity'
            ? this.entity()?.name || 'Meaning entity'
            : 'Meanings',
  );
  readonly form = new FormGroup({
    conceptId: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.maxLength(80),
        Validators.pattern(/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/),
      ],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(512)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(4096)],
    }),
  });

  private readonly formPending = effect(() => {
    if (this.pending()) this.form.disable({ emitEvent: false });
    else this.form.enable({ emitEvent: false });
  });

  private readonly load = effect((onCleanup) => {
    const ref = this.ref();
    this.retryVersion();
    this.mode();
    this.params();
    this.lifetime++;
    this.catalog.set(undefined);
    this.error.set('');
    this.pending.set(false);
    this.loading.set(false);
    this.confirmDelete.set(false);
    this.submitted.set(false);
    this.form.reset();
    if (!ref) return;
    this.loading.set(true);
    const subscription = this.service.catalog(ref).subscribe({
      next: (catalog) => {
        this.catalog.set(catalog);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        this.error.set(
          failure instanceof ProjectMeaningsCapacityError
            ? failure.message
            : 'Meanings could not be loaded. Check the project connection and try again.',
        );
        this.loading.set(false);
      },
    });
    onCleanup(() => subscription.unsubscribe());
  });

  async copyDemoProject(): Promise<void> {
    if (!this.canCopyDemo() || this.pending()) return;
    const context = this.contextKey();
    this.pending.set(true);
    this.error.set('');
    try {
      const source = await resolveDemoProjectCopySource();
      if (context === this.contextKey())
        this.injector
          .get(NewProjectService)
          .navigateToNewProjectPage(
            'github',
            this.router.url,
            undefined,
            source,
          );
    } catch {
      if (context === this.contextKey())
        this.error.set(
          'The source project revision could not be verified. Please try again.',
        );
    } finally {
      if (context === this.contextKey()) this.pending.set(false);
    }
  }
  retry(): void {
    this.retryVersion.update((version) => version + 1);
  }
  link(href: string): UrlTree {
    return this.router.parseUrl(href);
  }
  href(
    mode = 'list',
    entity: MeaningIdentity | undefined = this.entity(),
    field?: MeaningField,
  ): string {
    const path = mode === 'list' ? 'meanings' : ['meanings', mode];
    const target = new URL(
      projectPageHref(this.effectiveRef(), path),
      'https://datatug.app',
    );
    if (entity && mode !== 'list' && mode !== 'new-entity') {
      target.searchParams.set('document', entity.documentId);
      target.searchParams.set('concept', entity.conceptId);
    }
    if (field) {
      target.searchParams.set('field', field.conceptId);
      if (field.documentId !== entity?.documentId)
        target.searchParams.set('fieldDocument', field.documentId);
    }
    return target.pathname + target.search;
  }
  backHref(): string {
    return this.mode() === 'list'
      ? projectPageHref(this.effectiveRef(), 'overview')
      : this.mode() === 'field' || this.mode() === 'new-field'
        ? this.href('entity')
        : this.href();
  }
  sourceLabel(entity: MeaningEntity): string {
    const source = this.field()?.source ?? entity.source;
    if (source)
      return `${source.kind === 'core' ? 'Core meaning' : source.kind === 'custom' ? 'Custom meaning' : 'Project repository'} · ${source.repository.replace('https://github.com/', '')} @ ${source.revision.length === 40 ? source.revision.slice(0, 7) : source.revision}`;
    return entity.origin === 'project'
      ? 'Project definition'
      : `Defined in ${entity.resources.find((resource) => resource.kind === 'query')?.title || 'saved query'}`;
  }
  sourceHref(): string | undefined {
    const source = this.field()?.source ?? this.entity()?.source;
    if (
      !source ||
      !source.path ||
      !/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(
        source.repository,
      ) ||
      !/^[a-f0-9]{40}$/.test(source.revision)
    )
      return undefined;
    return `${source.repository}/blob/${source.revision}/${source.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  resourceHref(resource: MeaningResource): string {
    const path =
      resource.kind === 'query'
        ? ['query', resource.id]
        : resource.kind === 'board'
          ? ['board', resource.id]
          : ['env', resource.environment || '', 'db', resource.id];
    const target = new URL(
      projectPageHref(this.effectiveRef(), path),
      'https://datatug.app',
    );
    if (resource.kind === 'query') target.searchParams.set('id', resource.id);
    if (resource.environment)
      target.searchParams.set('env', resource.environment);
    return target.pathname + target.search;
  }
  async save(): Promise<void> {
    if (this.pending() || !this.canCreate()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const value = this.form.getRawValue();
    if (!value.name.trim() || !value.description.trim()) {
      this.error.set('Enter a name and description.');
      return;
    }
    const entity = this.entity();
    const change: ProjectMeaningAction =
      this.mode() === 'new-field' && entity
        ? {
            action: 'add-field',
            entity: this.identity(entity),
            ...value,
            name: value.name.trim(),
            description: value.description.trim(),
          }
        : {
            action: 'add-entity',
            ...value,
            name: value.name.trim(),
            description: value.description.trim(),
          };
    await this.mutate(change, (catalog) => {
      const created =
        this.mode() === 'new-field'
          ? catalog.entities.find(
              (item) =>
                item.documentId === entity?.documentId &&
                item.conceptId === entity.conceptId,
            )
          : catalog.entities.find(
              (item) =>
                item.documentId === 'project' &&
                item.conceptId === value.conceptId,
            );
      if (!created)
        throw new Error('Created meaning is missing from the save receipt.');
      const field =
        this.mode() === 'new-field'
          ? created.fields.find((item) => item.conceptId === value.conceptId)
          : undefined;
      if (this.mode() === 'new-field' && !field)
        throw new Error('Created field is missing from the save receipt.');
      return this.href(field ? 'field' : 'entity', created, field);
    });
  }
  async deleteSelected(): Promise<void> {
    const entity = this.entity(),
      field = this.field();
    if (!this.canDelete() || !entity || this.pending() || !this.confirmDelete())
      return;
    const change: ProjectMeaningAction =
      this.mode() === 'field' && field
        ? {
            action: 'delete-field',
            entity: this.identity(entity),
            field: this.identity(field),
          }
        : { action: 'delete-entity', entity: this.identity(entity) };
    await this.mutate(change, () =>
      this.mode() === 'field' ? this.href('entity', entity) : this.href(),
    );
  }
  private identity(value: MeaningIdentity): MeaningIdentity {
    return { documentId: value.documentId, conceptId: value.conceptId };
  }
  private contextKey(): string {
    return JSON.stringify([
      projectRefToString(this.ref()),
      this.router.url,
      this.mode(),
      this.params().get('document'),
      this.params().get('concept'),
      this.params().get('field'),
      this.params().get('fieldDocument'),
    ]);
  }
  private async mutate(
    change: ProjectMeaningAction,
    destination: (catalog: ProjectMeaningsCatalog) => string,
  ): Promise<void> {
    const ref = this.effectiveRef(),
      catalog = this.catalog();
    if (!ref || !catalog || this.pending()) return;
    const lifetime = this.lifetime,
      context = this.contextKey();
    const active = () =>
      lifetime === this.lifetime && context === this.contextKey();
    this.pending.set(true);
    this.error.set('');
    try {
      const saved = await firstValueFrom(
        this.service.change(ref, {
          operationId: crypto.randomUUID(),
          ifMatch: catalog.revision,
          change,
        }),
      );
      if (!active()) return;
      const href = destination(saved);
      this.catalog.set(saved);
      await this.router.navigateByUrl(href, { replaceUrl: true });
    } catch {
      if (active())
        this.error.set(
          'The change could not be saved. Reload to check the latest definition and references before retrying.',
        );
    } finally {
      if (active()) this.pending.set(false);
    }
  }
}

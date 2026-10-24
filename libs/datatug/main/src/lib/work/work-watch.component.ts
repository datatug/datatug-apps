import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import type { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import { WorkApiService } from './work-api.service';
import { WorkFormComponent } from './work-form.component';
import {
  workError,
  workId,
  type WorkDetail,
  type WorkDraft,
  type WorkItem,
  type WorkScope,
  type WorkType,
} from './work.models';
import type {
  WorkWatchAction,
  WorkWatchEvent,
  WorkWatchPage,
} from './work-watch.models';
import type { SessionScope } from '../session-context/session-context-contract';

/** Hosted project membership and mapped Coordinator authority are both checked
 * by the server. No Coordinator token or evidence is sent in a mutation. */
@Component({
  selector: 'sneat-work-watch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    JsonPipe,
    RouterLink,
    WorkFormComponent,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCheckbox,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './work-watch.component.html',
  styles:
    ':host { display:block; } .evidence, ion-card-content { overflow-wrap:anywhere; }',
})
export class WorkWatchComponent {
  readonly project = input<IProjectRef>();
  readonly watchId = input('');
  readonly item = input<WorkItem>();
  readonly changed = output<WorkDetail>();
  private readonly api = inject(WorkApiService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly reviewHeading =
    viewChild<ElementRef<HTMLElement>>('handoffHeading');
  private readonly authService = inject(SneatAuthStateService);
  private readonly auth = toSignal(this.authService.authState);
  readonly actor = computed(() => this.auth()?.user?.uid ?? '');
  readonly scope = computed<WorkScope | undefined>(() => {
    const project = this.project();
    return project?.storeId === 'firestore' && project.spaceID
      ? { spaceID: project.spaceID, projectID: project.projectId }
      : undefined;
  });
  readonly data = signal<WorkWatchPage | undefined>(undefined);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly stale = signal(false);
  readonly selected = signal<WorkWatchEvent | undefined>(undefined);
  readonly draft = signal<WorkDraft | undefined>(undefined);
  readonly sharePersonal = signal(false);
  readonly target = signal('');
  readonly reviewMode = signal<'link' | 'sync'>('link');
  readonly candidates = signal<WorkItem[]>([]);
  readonly pending = signal<WorkWatchAction | undefined>(undefined);
  readonly preview = computed(() =>
    this.data()?.contexts?.find(
      (context) => context.eventId === this.selected()?.id,
    ),
  );
  readonly personal = computed(
    () =>
      (this.reviewMode() === 'sync' &&
        this.data()?.contexts?.some((context) => context.requiresSharing)) ||
      this.preview()?.requiresSharing ||
      this.data()?.watches.find(
        (watch) => watch.id === this.selected()?.watchId,
      )?.visibility === 'personal',
  );
  readonly handoffEnvironments = computed(() => {
    const scope = this.preview()?.scope;
    return scope
      ? (this.data()?.environments || []).filter(
          (environment) =>
            environment.environmentId === scope.environmentId &&
            environment.identityDomain === scope.identityDomain,
        )
      : [];
  });
  private controller = new AbortController();
  private generation = 0;
  constructor() {
    let principal = this.actor();
    this.authService.authState.pipe(takeUntilDestroyed()).subscribe((state) => {
      const next = state.user?.uid ?? '';
      if (next === principal) return;
      principal = next;
      this.generation++;
      this.controller.abort();
      this.data.set(undefined);
      this.selected.set(undefined);
      this.draft.set(undefined);
      this.pending.set(undefined);
      this.candidates.set([]);
      this.sharePersonal.set(false);
    });
    effect(() => {
      this.actor();
      this.scope();
      this.watchId();
      untracked(() => {
        this.generation++;
        this.controller.abort();
        this.controller = new AbortController();
        this.data.set(undefined);
        this.selected.set(undefined);
        this.draft.set(undefined);
        this.pending.set(undefined);
        this.candidates.set([]);
        this.sharePersonal.set(false);
        this.error.set('');
        this.notice.set('');
        this.stale.set(false);
        this.busy.set(false);
        void this.refresh();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.controller.abort();
    });
  }
  href(page: string | string[]): string {
    return projectPageHref(this.project(), page);
  }
  async refresh(): Promise<void> {
    const scope = this.scope(),
      actor = this.actor(),
      generation = this.generation;
    const binding = JSON.stringify([actor, scope, this.watchId()]);
    if (!scope || !actor) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.api.watchEvents(
        scope,
        this.watchId(),
        this.controller.signal,
      );
      if (
        generation === this.generation &&
        binding === JSON.stringify([this.actor(), this.scope(), this.watchId()])
      ) {
        this.data.set(data);
        this.stale.set(false);
      }
    } catch (error) {
      if (generation === this.generation) {
        if (
          [401, 403, 404].includes((error as { status?: number })?.status || 0)
        ) {
          this.data.set(undefined);
          this.selected.set(undefined);
          this.draft.set(undefined);
          this.pending.set(undefined);
        }
        this.stale.set(true);
        this.error.set(workError(error));
      }
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  choose(event: WorkWatchEvent, type?: WorkType): void {
    this.reviewMode.set('link');
    this.selected.set(event);
    this.sharePersonal.set(false);
    this.target.set('');
    this.candidates.set([]);
    this.pending.set(undefined);
    this.draft.set(
      type
        ? {
            type,
            title: event.title,
            priority: 'high',
            environment: event.environment,
            ...(type === 'incident' ? { severity: 'major' } : {}),
            description: `Watch ${event.watchId}: ${event.kind}, ${event.outcome}.\nEnvironment: ${event.environment}\nObserved: ${event.occurredAt}\nCheck: ${event.checkId}\nEvidence: ${event.checkRunRef || event.runId}`,
          }
        : undefined,
    );
    if (!type) void this.loadCandidates();
    this.focusReview();
  }
  private focusReview(): void {
    afterNextRender(
      () => {
        const heading = this.reviewHeading()?.nativeElement;
        heading?.focus();
        heading?.scrollIntoView?.({ block: 'start' });
      },
      { injector: this.injector },
    );
  }
  private async loadCandidates(): Promise<void> {
    const scope = this.scope(),
      generation = this.generation,
      event = this.selected();
    if (!scope) return;
    try {
      let cursor: string | undefined;
      const items: WorkItem[] = [];
      do {
        const page = await this.api.list(
          scope,
          { ...(cursor ? { cursor } : {}) },
          this.controller.signal,
        );
        if (generation !== this.generation || event !== this.selected()) return;
        items.push(
          ...page.items.filter((item) => item.lifecycle !== 'archived'),
        );
        cursor = page.hasMore ? page.nextCursor : undefined;
      } while (cursor && items.length <= 5000);
      this.candidates.set(items);
    } catch (error) {
      if (generation === this.generation) this.error.set(workError(error));
    }
  }
  async create(value: {
    draft: WorkDraft;
    contextScope: SessionScope;
  }): Promise<void> {
    const scope = this.scope(),
      event = this.selected();
    if (!scope || !event || (this.personal() && !this.sharePersonal())) return;
    // Context scope is selected by the trusted mapping, never by this payload.
    const admitted = this.preview()?.scope;
    if (
      !admitted ||
      value.contextScope.environmentId !== admitted.environmentId ||
      value.contextScope.identityDomain !== admitted.identityDomain
    ) {
      this.error.set('Use the Watch event environment for this work.');
      return;
    }
    await this.send({
      ...scope,
      operationId: workId(),
      action: 'create',
      watchId: event.watchId,
      eventId: event.id,
      sharePersonal: this.sharePersonal(),
      draft: value.draft,
    });
  }
  async link(): Promise<void> {
    const scope = this.scope(),
      event = this.selected(),
      item = this.candidates().find(
        (candidate) => candidate.id === this.target(),
      );
    if (!scope || !event || !item || (this.personal() && !this.sharePersonal()))
      return;
    await this.send({
      ...scope,
      operationId: workId(),
      action: this.reviewMode(),
      watchId: event.watchId,
      ...(this.reviewMode() === 'sync' ? {} : { eventId: event.id }),
      sharePersonal: this.sharePersonal(),
      itemId: item.id,
      expectedVersion: item.version,
    });
  }
  sync(): void {
    const scope = this.scope(),
      item = this.item(),
      event = this.data()?.events[0];
    if (!scope || !item || !event) return;
    this.selected.set(event);
    this.reviewMode.set('sync');
    this.draft.set(undefined);
    this.sharePersonal.set(false);
    this.target.set(item.id);
    this.candidates.set([item]);
    this.focusReview();
  }
  async send(action: WorkWatchAction): Promise<void> {
    if (this.busy()) return;
    const generation = this.generation;
    const binding = JSON.stringify([
      this.actor(),
      this.scope(),
      this.watchId(),
    ]);
    this.busy.set(true);
    this.error.set('');
    this.pending.set(action);
    try {
      const detail = await this.api.watchAction(action, this.controller.signal);
      if (
        generation !== this.generation ||
        binding !== JSON.stringify([this.actor(), this.scope(), this.watchId()])
      )
        return;
      this.pending.set(undefined);
      this.selected.set(undefined);
      this.draft.set(undefined);
      this.notice.set('Watch evidence saved. Work status is unchanged.');
      this.changed.emit(detail);
      if (action.action !== 'sync')
        await this.router.navigateByUrl(this.href(['work', detail.item.id]));
      else await this.refresh();
    } catch (error) {
      if (generation === this.generation) this.error.set(workError(error));
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  cancel(): void {
    this.selected.set(undefined);
    this.draft.set(undefined);
    this.pending.set(undefined);
  }
}

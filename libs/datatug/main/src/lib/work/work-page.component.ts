import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  viewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { SneatAuthStateService, SneatUserService } from '@sneat/auth-core';
import {
  collection,
  Firestore,
  getDocs,
  limit,
  query,
} from 'firebase/firestore';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonChip,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonModal,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSkeletonText,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { IProjectRef } from '../core/project-context';
import { projectPageHref, withQuery } from '../nav/project-page-href';
import { SneatDatatugPageTitleComponent } from '../components/page-title/sneat-datatug-page-title.component';
import {
  ContextCommand,
  ContextEntryRef,
  ContextSnapshot,
  SessionScope,
} from '../session-context/session-context-contract';
import { WorkApiService } from './work-api.service';
import { WorkContextComponent } from './work-context.component';
import { WorkFormComponent } from './work-form.component';
import {
  WorkAction,
  WorkDetail,
  WorkDraft,
  WorkEnvironment,
  WorkFilters,
  WorkItem,
  WorkMember,
  WorkPage,
  WorkScope,
  WorkTarget,
  WorkType,
  draftFromWork,
  workError,
  workNeedsMigration,
  workId,
  workOverdue,
  workTypeLabel,
} from './work.models';

@Component({
  selector: 'sneat-work-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-page.component.html',
  styleUrl: './work-page.component.scss',
  imports: [
    FormsModule,
    RouterLink,
    DatePipe,
    TitleCasePipe,
    WorkContextComponent,
    WorkFormComponent,
    SneatDatatugPageTitleComponent,
    IonBackButton,
    IonBadge,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCheckbox,
    IonChip,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
    IonMenuButton,
    IonModal,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonSkeletonText,
    IonTextarea,
    IonTitle,
    IonToolbar,
  ],
})
export class WorkPageComponent {
  private readonly api = inject(WorkApiService);
  private readonly route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private readonly firestore = inject(Firestore);
  private readonly authService = inject(SneatAuthStateService);
  private readonly auth = toSignal(this.authService.authState);
  private readonly user = toSignal(inject(SneatUserService).userState);
  private readonly params = toSignal(
    combineLatest(
      (this.route.pathFromRoot.length
        ? this.route.pathFromRoot
        : [this.route]
      ).map((route) => route.paramMap),
    ).pipe(
      map((maps) =>
        Object.assign(
          {},
          ...maps.map((p) =>
            Object.fromEntries(p.keys.map((k) => [k, p.get(k)])),
          ),
        ),
      ),
    ),
    { initialValue: {} as Record<string, string> },
  );
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly mine = this.route.snapshot.data['myWork'] === true;
  readonly creating = this.route.snapshot.data['newWork'] === true;
  readonly actor = computed(() => this.auth()?.user?.uid ?? '');
  readonly itemId = computed(() => this.params()['workItemId'] ?? '');
  readonly scope = computed<WorkScope | undefined>(() => {
    const p = this.params();
    return p['storeId'] === 'firestore' && p['spaceId'] && p['projectId']
      ? { spaceID: p['spaceId'], projectID: p['projectId'] }
      : undefined;
  });
  readonly project = computed<IProjectRef | undefined>(() => {
    const s = this.scope();
    return s
      ? { storeId: 'firestore', spaceID: s.spaceID, projectId: s.projectID }
      : undefined;
  });
  readonly rows = signal<WorkItem[]>([]);
  readonly page = signal<WorkPage | undefined>(undefined);
  readonly detail = signal<WorkDetail | undefined>(undefined);
  readonly parent = signal<WorkDetail | undefined>(undefined);
  readonly context = signal<ContextSnapshot | undefined>(undefined);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly historyLoading = signal(false);
  readonly historyCursor = signal<string | undefined>(undefined);
  readonly error = signal('');
  readonly notice = signal('');
  readonly partial = signal<string[]>([]);
  readonly covered = signal(0);
  readonly members = signal<WorkMember[]>([]);
  readonly filters = signal<WorkFilters>({});
  readonly myRole = signal('assignee');
  readonly filterOpen = signal(false);
  readonly editing = signal(false);
  readonly pending = signal<WorkAction | undefined>(undefined);
  readonly transitionOpen = signal(false);
  readonly targetStatus = signal('');
  readonly summary = signal('');
  readonly outcome = signal('resolved');
  readonly criteriaAccepted = signal(false);
  readonly comment = signal('');
  readonly linkOpen = signal(false);
  readonly targetKind = signal<WorkTarget['kind']>('work');
  readonly targetId = signal('');
  readonly targetFolder = signal('');
  readonly linkRelation = signal('related');
  readonly targetEnvironment = signal('');
  readonly selection = signal<ContextEntryRef[]>([]);
  readonly inheritance = signal('snapshot');
  readonly reviewedProposal = signal('');
  readonly proposalPreview = signal<{ label: string; value: string }[]>([]);
  readonly proposalReviewOpen = signal(false);
  readonly locked = computed(() => this.busy() || !!this.pending());
  readonly environments = computed<WorkEnvironment[]>(
    () => this.detail()?.environments ?? this.page()?.environments ?? [],
  );
  readonly artifactEnvironments = computed(() =>
    this.environments().filter(
      (env, index, all) =>
        all.findIndex((other) => other.environmentId === env.environmentId) ===
        index,
    ),
  );
  readonly formDraft = computed<WorkDraft | undefined>(() => {
    const item = this.detail()?.item;
    if (item) return draftFromWork(item);
    const type = this.queryParams().get('type');
    return {
      type: type === 'incident' || type === 'case' ? type : 'task',
      title: '',
      priority: 'normal',
      environment: this.parent()?.item.incident?.environment,
    };
  });
  readonly backHref = computed(() => {
    const parent = this.parent();
    return parent
      ? this.href(parent.item)
      : this.project()
        ? projectPageHref(this.project(), 'work')
        : '/my';
  });
  readonly activeFilters = computed(() =>
    Object.entries(this.filters()).filter(
      ([key, value]) => key !== 'cursor' && !!value,
    ),
  );
  readonly availableStatuses = computed(() => {
    const detail = this.detail();
    return detail?.capabilities.transitions || [];
  });
  readonly typeLabel = workTypeLabel;
  activityField(field: string): string {
    const labels: Record<string, string> = {
      ownerId: 'Accountable owner',
      assigneeIds: 'Assignees',
      primaryAssigneeId: 'Primary responsible person',
      dueAt: 'Due date',
      contextSessionId: 'Context Bag',
      parentId: 'Parent work',
      criteria: 'Closure criteria',
    };
    return (
      labels[field] ||
      field
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (letter) => letter.toUpperCase())
    );
  }
  activityFields(fields?: string[]): string {
    return (fields || []).map((field) => this.activityField(field)).join(', ');
  }
  readonly overdue = workOverdue;
  private controller = new AbortController();
  private epoch = 0;
  private entered = false;
  constructor() {
    let principal = this.actor();
    this.authService.authState.pipe(takeUntilDestroyed()).subscribe((state) => {
      const next = state.user?.uid ?? '';
      if (next !== principal) {
        principal = next;
        this.epoch++;
        this.controller.abort();
        this.detail.set(undefined);
        this.page.set(undefined);
        this.parent.set(undefined);
        this.context.set(undefined);
        this.rows.set([]);
        this.members.set([]);
        this.pending.set(undefined);
        this.proposalPreview.set([]);
        this.reviewedProposal.set('');
        this.resetDraftsAndOverlays();
      }
    });
    let routeIdentity = JSON.stringify(this.params());
    combineLatest(
      (this.route.pathFromRoot.length
        ? this.route.pathFromRoot
        : [this.route]
      ).map((route) => route.paramMap),
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const next = JSON.stringify(this.params());
        if (next === routeIdentity) return;
        routeIdentity = next;
        this.epoch++;
        this.controller.abort();
        this.detail.set(undefined);
        this.page.set(undefined);
        this.parent.set(undefined);
        this.context.set(undefined);
        this.rows.set([]);
        this.members.set([]);
        this.pending.set(undefined);
        this.proposalPreview.set([]);
        this.reviewedProposal.set('');
        this.resetDraftsAndOverlays();
      });
    inject(DestroyRef).onDestroy(() => {
      this.epoch++;
      this.controller.abort();
    });
    effect(() => {
      this.actor();
      this.scope();
      this.itemId();
      this.queryParams();
      if (this.mine) this.user();
      untracked(() => void this.load());
    });
  }
  ionViewWillEnter(): void {
    if (this.entered && !this.pending()) void this.load();
    this.entered = true;
  }
  private readonly errorAlert =
    viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly injector = inject(Injector);
  focusError(): void {
    if (this.error()) this.errorAlert()?.nativeElement.focus();
  }
  private reportError(error: unknown): void {
    this.notice.set('');
    if (workNeedsMigration(error)) this.pending.set(undefined);
    this.transitionOpen.set(false);
    this.linkOpen.set(false);
    this.proposalReviewOpen.set(false);
    if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
      this.detail.set(undefined);
      this.context.set(undefined);
      this.rows.set([]);
      this.members.set([]);
      this.page.set(undefined);
      this.parent.set(undefined);
      this.pending.set(undefined);
      this.resetDraftsAndOverlays();
    }
    this.error.set(workError(error));
    afterNextRender(() => this.focusError(), { injector: this.injector });
  }
  private resetDraftsAndOverlays(): void {
    this.proposalPreview.set([]);
    this.reviewedProposal.set('');
    this.transitionOpen.set(false);
    this.linkOpen.set(false);
    this.filterOpen.set(false);
    this.proposalReviewOpen.set(false);
    this.editing.set(false);
    this.summary.set('');
    this.comment.set('');
    this.targetId.set('');
    this.targetFolder.set('');
    this.targetEnvironment.set('');
    this.targetStatus.set('');
    this.outcome.set('resolved');
    this.criteriaAccepted.set(false);
    this.selection.set([]);
    this.targetKind.set('work');
    this.linkRelation.set('related');
    this.filters.set({});
    this.error.set('');
    this.notice.set('');
    this.partial.set([]);
    this.covered.set(0);
  }
  name(id?: string): string {
    return id
      ? this.members().find((m) => m.id === id)?.title || id
      : 'Unassigned';
  }
  href(item: WorkItem): string {
    return projectPageHref(
      {
        storeId: 'firestore',
        spaceID: item.spaceID,
        projectId: item.projectID,
      },
      ['work', item.id],
    );
  }
  createHref(type?: WorkType): string {
    const path = projectPageHref(this.project(), ['work', 'new']);
    return type ? `${path}?type=${type}` : path;
  }
  childHref(type: WorkType): string {
    const item = this.detail()?.item;
    return `${this.createHref(type)}&parent=${encodeURIComponent(item?.id ?? '')}`;
  }
  specialistHref(): string {
    const item = this.detail()?.item;
    if (item?.case?.legacyCaseId)
      return projectPageHref(this.project(), [
        'detective',
        item.case.legacyCaseId,
      ]);
    if (item?.incident?.legacyRef)
      return projectPageHref(this.project(), [
        'incidents',
        item.incident.legacyRef.storeId,
        item.incident.legacyRef.incidentId,
      ]);
    return '';
  }
  relationLabel(link: WorkDetail['links'][number]): string {
    if (link.target.kind === 'work' && link.target.id === this.itemId()) {
      if (link.relation === 'parent') return 'Child';
      if (link.relation === 'blocks') return 'Blocked by';
    }
    return this.activityField(link.relation);
  }
  relatedHref(link: WorkDetail['links'][number]): string {
    if (link.target.kind === 'work') {
      const id =
        link.sourceId === this.itemId() ? link.target.id : link.sourceId;
      return projectPageHref(this.project(), ['work', id]);
    }
    if (link.target.kind === 'query') {
      const id = [link.target.folder, link.target.id].filter(Boolean).join('/');
      return withQuery(
        projectPageHref(this.project(), ['query', id]),
        new URLSearchParams({
          id,
          ...(link.target.environment
            ? { environment: link.target.environment }
            : {}),
        }).toString(),
      );
    }
    const route = (
      { check: 'checks', query: 'query', dashboard: 'board' } as Record<
        string,
        string
      >
    )[link.target.kind];
    return route
      ? withQuery(
          projectPageHref(this.project(), [route, link.target.id]),
          new URLSearchParams(
            link.target.environment
              ? { environment: link.target.environment }
              : {},
          ).toString(),
        )
      : '';
  }
  setFilter(key: keyof WorkFilters, value: string): void {
    this.filters.update((f) => ({ ...f, [key]: value, cursor: undefined }));
    void this.load();
  }
  async load(more = false): Promise<void> {
    const epoch = ++this.epoch;
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.loading.set(true);
    this.historyCursor.set(undefined);
    this.historyLoading.set(false);
    this.busy.set(false);
    this.error.set('');
    this.context.set(undefined);
    this.detail.set(undefined);
    this.parent.set(undefined);
    this.proposalPreview.set([]);
    this.reviewedProposal.set('');
    this.proposalReviewOpen.set(false);
    this.pending.set(undefined);
    this.notice.set('');
    if (!more) {
      this.rows.set([]);
      this.page.set(undefined);
      this.members.set([]);
    }
    this.partial.set([]);
    const current = () => epoch === this.epoch && !signal.aborted;
    try {
      if (!this.actor()) return;
      if (this.mine) {
        await this.loadMine(signal, current);
        return;
      }
      const scope = this.scope();
      if (!scope) return;
      if (this.itemId()) {
        const detail = await this.api.read(scope, this.itemId(), signal);
        if (!current()) return;
        this.detail.set(detail);
        this.members.set(detail.members);
        try {
          const context =
            detail.context ??
            (await this.api.context(
              scope,
              detail.item.id,
              detail.item.contextSessionId,
              signal,
            ));
          if (current()) this.context.set(context);
        } catch (e) {
          if (current()) this.notice.set(`Context Bag: ${workError(e)}`);
        }
        return;
      }
      const page = await this.api.list(
        scope,
        {
          ...this.filters(),
          ...(more ? { cursor: this.page()?.nextCursor } : {}),
        },
        signal,
      );
      if (!current()) return;
      this.page.set(page);
      this.members.set(page.members);
      this.rows.update((rows) =>
        more ? [...rows, ...page.items] : page.items,
      );
      const parentId = this.queryParams().get('parent');
      if (this.creating && parentId) {
        const parent = await this.api.read(scope, parentId, signal);
        const context =
          parent.context ??
          (await this.api.context(
            scope,
            parent.item.id,
            parent.item.contextSessionId,
            signal,
          ));
        if (current()) this.parent.set({ ...parent, context });
      }
    } catch (e) {
      if (current()) {
        this.reportError(e);
        this.detail.set(undefined);
        this.context.set(undefined);
        this.rows.set([]);
      }
    } finally {
      if (current()) this.loading.set(false);
    }
  }
  private async loadMine(
    signal: AbortSignal,
    current: () => boolean,
  ): Promise<void> {
    const state = this.user();
    if (!state?.record) return;
    const spaces = Object.keys(state.record.spaces ?? {});
    const failures: string[] = [];
    const all: WorkItem[] = [];
    const people: WorkMember[] = [];
    let covered = 0;
    for (const spaceID of spaces) {
      if (signal.aborted) return;
      try {
        const projects = await getDocs(
          query(
            collection(
              this.firestore,
              'spaces',
              spaceID,
              'ext',
              'datatug',
              'projects',
            ),
            limit(101),
          ),
        );
        if (projects.docs.length > 100)
          failures.push(
            'A Space contains more than 100 projects. Open it directly to see additional work.',
          );
        for (const project of projects.docs.slice(0, 100)) {
          if (signal.aborted) return;
          try {
            let cursor: string | undefined;
            let pages = 0;
            do {
              const page = await this.api.list(
                { spaceID, projectID: project.id },
                { ...this.filters(), [this.myRole()]: this.actor(), cursor },
                signal,
              );
              all.push(...page.items);
              people.push(...page.members);
              cursor = page.nextCursor;
              pages++;
              if (pages >= 20 && page.hasMore) {
                failures.push(
                  'One project has more results. Open project Work to continue.',
                );
                break;
              }
            } while (cursor);
            covered++;
          } catch {
            for (let i = all.length - 1; i >= 0; i--) {
              if (all[i].spaceID === spaceID && all[i].projectID === project.id)
                all.splice(i, 1);
            }
            failures.push(
              'Work in one discovered project could not be loaded. Its data is not shown.',
            );
          }
        }
      } catch {
        failures.push('Projects in one of your Spaces could not be listed.');
      }
    }
    if (current()) {
      this.rows.set(all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      this.members.set([...new Map(people.map((m) => [m.id, m])).values()]);
      this.covered.set(covered);
      this.partial.set(failures);
    }
  }
  async earlierActivity(): Promise<void> {
    const detail = this.detail(),
      scope = this.scope(),
      epoch = this.epoch;
    if (!detail || !scope || this.historyLoading()) return;
    this.historyLoading.set(true);
    try {
      let cursor = this.historyCursor();
      if (cursor === undefined)
        cursor = (
          await this.api.activity(
            scope,
            detail.item.id,
            '',
            this.controller.signal,
          )
        ).nextCursor;
      if (!cursor || epoch !== this.epoch) return;
      const page = await this.api.activity(
        scope,
        detail.item.id,
        cursor,
        this.controller.signal,
      );
      if (epoch !== this.epoch || this.detail()?.item.id !== detail.item.id)
        return;
      this.historyCursor.set(page.nextCursor || '');
      this.detail.update(
        (current) =>
          current && {
            ...current,
            hasEarlierActivity: !!page.nextCursor,
            activity: [...page.items.reverse(), ...current.activity].filter(
              (event, index, all) =>
                all.findIndex((other) => other.id === event.id) === index,
            ),
          },
      );
    } catch (error) {
      if (epoch === this.epoch) this.error.set(workError(error));
    } finally {
      if (epoch === this.epoch) this.historyLoading.set(false);
    }
  }
  async save(event: {
    draft: WorkDraft;
    contextScope: SessionScope;
  }): Promise<void> {
    const scope = this.scope();
    if (!scope) return;
    const item = this.detail()?.item,
      parent = this.parent()?.item;
    await this.mutate({
      ...scope,
      operationId: workId(),
      action: item ? 'edit' : 'create',
      ...(item ? { itemId: item.id, expectedVersion: item.version } : {}),
      draft: event.draft,
      ...(!item ? { contextScope: event.contextScope } : {}),
      ...(parent
        ? {
            parentId: parent.id,
            parentVersion: parent.version,
            inheritance: this.inheritance(),
          }
        : {}),
    });
  }
  async mutate(action: WorkAction): Promise<void> {
    if (this.busy() || this.pending()) return;
    this.pending.set(structuredClone(action));
    await this.retry();
  }
  async retry(): Promise<void> {
    const action = this.pending();
    if (!action || this.busy()) return;
    const epoch = this.epoch;
    this.busy.set(true);
    this.error.set('');
    try {
      const detail = await this.api.action(action, this.controller.signal);
      if (epoch !== this.epoch) return;
      this.pending.set(undefined);
      this.detail.set(detail);
      this.members.set(detail.members);
      this.context.set(detail.context);
      this.editing.set(false);
      this.transitionOpen.set(false);
      this.linkOpen.set(false);
      this.proposalReviewOpen.set(false);
      this.proposalPreview.set([]);
      this.reviewedProposal.set('');
      this.comment.set('');
      this.notice.set('Saved.');
      if (action.action === 'create') {
        await this.router.navigateByUrl(this.href(detail.item), {
          replaceUrl: true,
        });
        return;
      }
      if (detail.executionSessionId) {
        await this.router.navigateByUrl(
          projectPageHref(this.project(), [
            'sessions',
            detail.executionSessionId,
            'overview',
          ]),
        );
        return;
      }
      if (!detail.context) {
        try {
          const context = await this.api.context(
            action,
            detail.item.id,
            detail.item.contextSessionId,
            this.controller.signal,
          );
          if (epoch === this.epoch) this.context.set(context);
        } catch (e) {
          if (epoch === this.epoch)
            this.notice.set(`Saved. Context Bag: ${workError(e)}`);
        }
      }
    } catch (e) {
      if (epoch === this.epoch) {
        this.reportError(e);
      }
    } finally {
      if (epoch === this.epoch) this.busy.set(false);
    }
  }
  private action(
    action: WorkAction['action'],
    fields: Partial<WorkAction> = {},
  ): Promise<void> {
    const item = this.detail()?.item;
    if (!item || this.locked()) return Promise.resolve();
    return this.mutate({
      spaceID: item.spaceID,
      projectID: item.projectID,
      operationId: workId(),
      action,
      itemId: item.id,
      expectedVersion: item.version,
      ...fields,
    });
  }
  dismissProposal(proposalId: string, cancel = false): Promise<void> {
    return this.action(cancel ? 'cancel-context' : 'reject-context', {
      proposalId,
    });
  }
  transition(): Promise<void> {
    return this.action('transition', {
      status: this.targetStatus(),
      summary: this.summary().trim(),
      outcome:
        this.detail()?.item.type === 'incident' &&
        ['resolved', 'watching', 'closed'].includes(this.targetStatus())
          ? this.outcome()
          : undefined,
      criteriaAccepted: this.criteriaAccepted(),
    });
  }
  postComment(): Promise<void> {
    return this.comment().trim()
      ? this.action('comment', { comment: this.comment().trim() })
      : Promise.resolve();
  }
  link(): Promise<void> {
    const scope = this.scope();
    return this.action('link', {
      relation:
        this.targetKind() === 'work' ? this.linkRelation() : 'reference',
      target: {
        kind: this.targetKind(),
        id: this.targetId().trim(),
        ...(this.targetKind() === 'query'
          ? { folder: this.targetFolder().trim() }
          : {}),
        ...(this.targetKind() !== 'work'
          ? {
              storeId: 'firestore',
              projectId: scope?.projectID,
              environment: this.targetEnvironment(),
            }
          : {}),
      },
    });
  }
  unlink(id: string): Promise<void> {
    return this.action('unlink', { linkId: id });
  }
  contextCommand(command: ContextCommand): Promise<void> {
    return this.action('context', {
      operationId: command.opId,
      contextCommand: command,
    });
  }
  async refreshContext(): Promise<void> {
    const item = this.detail()?.item,
      scope = this.scope(),
      context = this.context();
    if (!item?.parentId || !scope || !context) return;
    const epoch = this.epoch;
    try {
      const parent = await this.api.read(
        scope,
        item.parentId,
        this.controller.signal,
      );
      const source =
        parent.context ??
        (await this.api.context(
          scope,
          parent.item.id,
          parent.item.contextSessionId,
          this.controller.signal,
        ));
      if (epoch === this.epoch)
        await this.action('refresh-context', {
          sourceSessionVersion: source.session.version,
          targetSessionVersion: context.session.version,
        });
    } catch (e) {
      if (epoch === this.epoch) this.reportError(e);
    }
  }
  async reviewProposal(id: string): Promise<void> {
    const proposal = this.detail()?.proposals.find((p) => p.id === id),
      scope = this.scope();
    if (!proposal || !scope) return;
    const epoch = this.epoch;
    this.proposalPreview.set([]);
    this.reviewedProposal.set('');
    try {
      const source = await this.api.read(
        scope,
        proposal.sourceId,
        this.controller.signal,
      );
      const snapshot =
        source.context ??
        (await this.api.context(
          scope,
          source.item.id,
          source.item.contextSessionId,
          this.controller.signal,
        ));
      const preview = proposal.selection.map((ref) => {
        const revision = snapshot.revisions.find(
          (r) => r.id === ref.revisionId && r.entryId === ref.entryId,
        );
        if (!revision) throw new Error('Proposal context unavailable');
        return {
          label: revision.subject.conceptId + ' · ' + revision.subject.fieldId,
          value:
            revision.value.kind === 'scalar'
              ? String(revision.value.scalar?.value ?? 'null')
              : (revision.value.values
                  ?.map((v) => String(v.value))
                  .join(', ') ?? 'Composite context'),
        };
      });
      if (epoch === this.epoch) {
        this.proposalPreview.set(preview);
        this.reviewedProposal.set(id);
        this.proposalReviewOpen.set(true);
      }
    } catch (e) {
      if (epoch === this.epoch) this.reportError(e);
    }
  }

  executeSnapshot(): Promise<void> {
    return this.action('execution-snapshot', {
      selection: this.selection(),
      sourceSessionVersion: this.context()?.session.version,
    });
  }
  acceptProposal(id: string): Promise<void> {
    return id && id === this.reviewedProposal()
      ? this.action('accept-context', { proposalId: id })
      : Promise.resolve();
  }
  async propose(): Promise<void> {
    const item = this.detail()?.item,
      scope = this.scope(),
      context = this.context();
    if (!item?.parentId || !scope || !context) return;
    const epoch = this.epoch;
    try {
      const target = await this.api.read(
        scope,
        item.parentId,
        this.controller.signal,
      );
      const targetContext =
        target.context ??
        (await this.api.context(
          scope,
          target.item.id,
          target.item.contextSessionId,
          this.controller.signal,
        ));
      if (epoch !== this.epoch) return;
      await this.action('propose-context', {
        targetItemId: target.item.id,
        targetVersion: target.item.version,
        sourceSessionVersion: context.session.version,
        targetSessionVersion: targetContext.session.version,
        selection: this.selection(),
      });
    } catch (e) {
      if (epoch === this.epoch) this.reportError(e);
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { SneatAuthStateService } from '@sneat/auth-core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonIcon,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonMenuButton,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { filter, firstValueFrom, merge } from 'rxjs';
import {
  isSharedProjectRef,
  projectRefToString,
  type IProjectRef,
} from '../core/project-context';
import { parseProjectUrl } from '@datatug/project-address';
import { ProjectEnvironmentStateService } from '../services/project/project-environment-state.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  isHostedReadRefused,
  isSignedOut,
} from '../services/project/hosted-read-refused';
import { WatchRunnersComponent } from './watch-runners.component';
import { ProjectService } from '../services/project/project.service';
import { projectPageHref } from '../nav/project-page-href';
import { useDetectivePageContext } from '../detective/detective-page-context';
import { DetectiveClientService } from '../detective/detective-client.service';
import { parseInputValue } from '../detective/detective-forms';
import type { CheckDefinition, DetectiveInputValue } from '../detective/models';
import type { ProjectCoordination } from '../models/definition/project';
import {
  WatchClientService,
  coordinatorEndpoint,
  watchError,
} from './watch-client.service';
import type {
  WatchChannel,
  WatchDelivery,
  WatchDefinition,
  WatchNotification,
  WatchRun,
  WatchStatus,
} from './watch.models';

interface WatchForm {
  title: string;
  checkId: string;
  environment: string;
  visibility: 'personal' | 'shared';
  interval: number;
  trigger: WatchDefinition['trigger'];
  initial: WatchDefinition['initialObservation'];
  mode: WatchDefinition['mode'];
  recovery: boolean;
  cooldown: number;
  inputs: Record<string, { value: string; end: string }>;
  requirements: string;
}
const emptyForm = (): WatchForm => ({
  title: '',
  checkId: '',
  environment: '',
  visibility: 'personal',
  interval: 60,
  trigger: 'becomes_false',
  initial: 'baseline',
  mode: 'continuous',
  recovery: true,
  cooldown: 0,
  inputs: {},
  requirements: '',
});

@Component({
  selector: 'sneat-datatug-watch-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './watch-page.component.html',
  styleUrl: './watch-page.component.scss',
  imports: [
    DatePipe,
    RouterLink,
    IonBackButton,
    IonBadge,
    IonIcon,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCheckbox,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
    IonMenuButton,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
    WatchRunnersComponent,
  ],
})
export class WatchPageComponent {
  protected readonly client = inject(WatchClientService);
  protected readonly scope = useDetectivePageContext();
  private readonly project = inject(ProjectService);
  private readonly detective = inject(DetectiveClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly auth = inject(SneatAuthStateService);
  private readonly navigation = inject(DatatugNavContextService);
  private readonly authState = toSignal(this.auth.authState, {
    initialValue: undefined,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly hosted = computed(() => {
    const ref = this.scope.ref();
    return !!ref && isSharedProjectRef(ref);
  });
  protected readonly signedIn = computed(() => !!this.authState()?.user?.uid);
  protected readonly authenticating = computed(
    () => this.authState()?.status === 'authenticating',
  );
  protected readonly environments = signal<
    readonly { id: string; title: string }[]
  >([]);
  protected readonly environment = computed(
    () => this.queryParams()?.get('env') || '',
  );
  protected returnPath() {
    return this.router.url;
  }
  private alive = true;
  private readonly connectionOwner = {};
  protected readonly identity = computed(() =>
    this.client.ownsConnection(this.connectionOwner)
      ? this.client.identity()
      : undefined,
  );
  private generation = 0;
  private viewGeneration = 0;
  private projectIdentity = '';
  protected readonly isNew = this.route.routeConfig?.path === 'watch/new';
  protected readonly watchId = signal(
    this.route.snapshot.paramMap.get('watchId') || '',
  );
  protected readonly config = signal<ProjectCoordination | undefined>(
    undefined,
  );
  protected readonly manifestLoading = signal(true);
  protected readonly token = signal('');
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly touched = signal<string[]>([]);
  protected readonly definitions = signal<WatchDefinition[]>([]);
  protected readonly status = signal<WatchStatus | undefined>(undefined);
  protected readonly notifications = signal<WatchNotification[]>([]);
  protected readonly runs = signal<WatchRun[]>([]);
  protected readonly deliveries = signal<WatchDelivery[]>([]);
  protected readonly resetReview = signal(false);
  protected readonly sourceChanged = computed(() => {
    const observation = this.observation();
    return (
      observation?.availability === 'source_changed' ||
      (!!observation?.lastRunId &&
        this.runs().some(
          (run) =>
            run.id === observation.lastRunId &&
            run.failureCode === 'SOURCE_CHANGED',
        ))
    );
  });
  protected readonly checks = signal<CheckDefinition[]>([]);
  protected readonly current = signal<WatchDefinition | undefined>(undefined);
  protected readonly editing = signal(false);
  protected readonly form = signal<WatchForm>(emptyForm());
  protected readonly channels = signal<WatchChannel[]>(['in_app']);
  protected readonly subscribed = signal(false);
  protected readonly deleteReview = signal(false);
  protected readonly telegramConnected = signal(false);
  protected readonly telegramReconnectRequired = signal(false);
  protected readonly telegramConnectionError = signal('');
  protected readonly telegramLink = signal('');
  protected readonly telegramBotUsername = signal('');
  private saveOperation?: {
    digest: string;
    id: string;
    definition: WatchDefinition;
  };
  protected readonly selectedCheck = computed(() =>
    this.checks().find((c) => c.id === this.form().checkId),
  );
  protected readonly canEdit = computed(() => {
    const user = this.identity(),
      current = this.current();
    return (
      !!user &&
      !!current &&
      (current.owner === user.id ||
        (current.visibility === 'shared' && user.sharedEditor))
    );
  });
  protected readonly observation = computed(() =>
    this.status()?.observations?.find((o) => o.watchId === this.watchId()),
  );

  protected touch(field: string): void {
    this.touched.update((fields) =>
      fields.includes(field) ? fields : [...fields, field],
    );
  }
  protected fieldError(field: string): string {
    if (!this.submitted() && !this.touched().includes(field)) return '';
    const form = this.form();
    if (field === 'title' && !form.title.trim()) return 'Enter a title.';
    if (field === 'checkId' && !form.checkId) return 'Choose a saved Check.';
    if (
      field === 'interval' &&
      (!Number.isSafeInteger(form.interval) ||
        form.interval < (this.identity()?.limits.minIntervalSeconds || 10) ||
        form.interval > 86400)
    )
      return 'Choose a valid evaluation interval.';
    if (
      field === 'cooldown' &&
      (!Number.isSafeInteger(form.cooldown) || form.cooldown < 0)
    )
      return 'Enter a whole number of seconds, zero or greater.';
    if (field.startsWith('input:')) {
      const name = field.slice(6),
        definition = this.selectedCheck()?.inputs.find(
          (input) => input.name === name,
        ),
        value = form.inputs[name];
      if (!definition) return '';
      if (!value?.value.trim())
        return definition.required ? 'This input is required.' : '';
      try {
        parseInputValue(
          value.value,
          definition.type,
          definition.cardinality,
          value.end,
        );
      } catch (error) {
        return watchError(error);
      }
    }
    return '';
  }
  protected checkTitle(id: string): string {
    return (
      this.checks().find((check) => check.id === id)?.title ||
      'Open saved Check'
    );
  }
  protected frequency(seconds: number): string {
    if (seconds % 3600 === 0)
      return `${seconds / 3600} ${seconds === 3600 ? 'hour' : 'hours'}`;
    if (seconds % 60 === 0)
      return `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}`;
    return `${seconds} seconds`;
  }

  protected label(value: string | undefined): string {
    const labels: Record<string, string> = {
      becomes_true: 'When the Check passes',
      becomes_false: 'When the Check fails',
      changes: 'Whenever the result changes',
      one_shot: 'Once',
      continuous: 'Ongoing',
      baseline: 'Wait for a change',
      notify: 'Notify if already matching',
      enabled: 'Active',
      paused: 'Paused',
      completed: 'Completed',
      deleted: 'Deleted',
      personal: 'Personal',
      shared: 'Shared',
      true: 'Passing',
      false: 'Failing',
      never: 'Not evaluated yet',
      unknown: 'Unknown',
      failure: 'Failed',
      recovery: 'Recovered',
      change: 'Changed',
      available: 'Connected',
      online: 'Connected',
      pass: 'Passing',
      fail: 'Failing',
      no_runner: 'Waiting for an eligible runner',
      queued: 'Queued',
      leased: 'Evaluating',
      running: 'Evaluating',
      succeeded: 'Evaluated',
      failed: 'Failed',
      delivered: 'Delivered',
      pending: 'Pending',
      sending: 'Sending',
      in_app: 'In-app',
      email: 'Email',
      sms: 'SMS',
      telegram: 'Telegram',
      retry: 'Retrying',
      rate_limited: 'Waiting for delivery limit',
      TELEGRAM_RECIPIENT_UNAVAILABLE: 'Reconnect Telegram to receive updates',
      TELEGRAM_RATE_LIMITED: 'Telegram is temporarily limiting messages',
      PROVIDER_UNAVAILABLE: 'Delivery provider is temporarily unavailable',
      SOURCE_CHANGED: 'Source changed — review and reset the baseline',
      source_changed: 'Source changed — review and reset the baseline',
      source_unavailable:
        'Source unavailable — check project access and runner configuration',
      blocked: 'Blocked — review project access and source configuration',
      QUOTA_EXCEEDED: 'Delivery limit reached — waiting to retry',
      UNAVAILABLE: 'Temporarily unavailable',
    };
    return value
      ? labels[value] || value.replaceAll('_', ' ').toLowerCase()
      : 'Awaiting evaluation';
  }

  protected statusColor(value: string | undefined): string {
    return value === 'true' || value === 'enabled' || value === 'delivered'
      ? 'success'
      : value === 'false' || value === 'failed'
        ? 'danger'
        : 'medium';
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.alive = false;
      this.generation++;
      this.token.set('');
      this.client.disconnectOwned(this.connectionOwner);
    });
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const next = params.get('watchId') || '';
        if (next !== this.watchId()) {
          this.watchId.set(next);
          this.resetView();
          void this.refresh();
        }
      });
    merge(
      this.auth.authState,
      this.navigation.currentProject,
      this.navigation.currentEnv,
      this.route.queryParamMap,
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.loadContext(this.contextKey()));
  }
  private contextKey(): string {
    return JSON.stringify([
      this.scope.ref(),
      this.authState()?.user?.uid || '',
      this.authState()?.status || '',
      this.environment(),
    ]);
  }
  private async loadContext(identity: string) {
    if (!this.alive) return;
    const ref = this.scope.ref();
    if (identity === this.projectIdentity) return;
    if (this.projectIdentity && this.projectIdentity !== identity) {
      this.disconnect();
      this.token.set('');
      this.client.seed = undefined;
    }
    this.projectIdentity = identity;
    const generation = ++this.generation;
    this.manifestLoading.set(true);
    this.error.set('');
    this.message.set('');
    this.current.set(undefined);
    try {
      if (!ref) {
        this.client.disconnectOwned(this.connectionOwner);
        return;
      }
      if (isSharedProjectRef(ref)) {
        this.config.set(undefined);
        if (!this.signedIn() || this.authenticating()) {
          this.client.disconnectOwned(this.connectionOwner);
          this.environments.set([]);
          return;
        }
        const state = await firstValueFrom(
          this.injector.get(ProjectEnvironmentStateService).read(ref),
        );
        if (
          !this.alive ||
          generation !== this.generation ||
          identity !== this.contextKey()
        )
          return;
        this.environments.set(state.environments);
        let environment = this.environment();
        if (!environment && state.environments.length === 1) {
          environment = state.environments[0].id;
          await this.chooseEnvironment(environment);
          return;
        }
        if (!environment) {
          this.client.disconnectOwned(this.connectionOwner);
          return;
        }
        if (!state.environments.some((item) => item.id === environment))
          throw new Error(
            'This environment is not available in the current project. Choose another environment.',
          );
        const principal = this.authState()?.user?.uid || '';
        await this.client.connectHosted(
          ref,
          environment,
          principal,
          this.connectionOwner,
          this.watchId(),
        );
        if (
          !this.alive ||
          generation !== this.generation ||
          identity !== this.contextKey()
        )
          return;
        await this.refresh();
        return;
      }
      this.environments.set([]);
      this.client.claimSelfhostConnection(
        this.connectionOwner,
        this.selfhostConnectionScope(ref),
      );
      const summary = await firstValueFrom(
        this.project
          .watchProjectSummary(ref)
          .pipe(filter((summary) => !!summary)),
      );
      if (
        !this.alive ||
        generation !== this.generation ||
        this.contextKey() !== identity
      )
        return;
      const config = summary?.coordination;
      if (config) coordinatorEndpoint(config.endpoint);
      this.config.set(config);
      if (!config || !this.client.matches(config, ref.projectId))
        this.client.disconnectOwned(this.connectionOwner);
      else
        this.client.adoptConnection(
          this.connectionOwner,
          config,
          ref.projectId,
          this.selfhostConnectionScope(ref),
        );
      if (this.identity()) await this.refresh();
    } catch (e) {
      if (this.alive && generation === this.generation) {
        this.client.disconnectOwned(this.connectionOwner);
        this.error.set(
          this.hosted() && isSignedOut(e)
            ? 'Sign in to access Watch in this project.'
            : watchError(e),
        );
      }
    } finally {
      if (this.alive && generation === this.generation)
        this.manifestLoading.set(false);
    }
  }
  protected pageHref(page: string | string[]) {
    const href = projectPageHref(this.scope.ref(), page);
    if (!this.hosted() || !this.environment()) return href;
    const url = this.router.parseUrl(href);
    url.queryParams = { ...url.queryParams, env: this.environment() };
    return this.router.serializeUrl(url);
  }
  protected pageLink(page: string | string[]) {
    return this.router.parseUrl(this.pageHref(page));
  }
  protected async chooseEnvironment(environment: string) {
    if (!this.environments().some((item) => item.id === environment)) return;
    const url = this.router.parseUrl(this.router.url);
    url.queryParams = { ...url.queryParams, env: environment };
    // Clear private state synchronously, before route navigation or any new response.
    this.disconnect();
    await this.router.navigateByUrl(url, { replaceUrl: true });
  }
  protected async connect() {
    const config = this.config(),
      ref = this.scope.ref();
    if (!config || !ref || this.busy()) return;
    const token = this.token();
    const generation = this.generation;
    this.token.set('');
    this.busy.set(true);
    this.error.set('');
    try {
      await this.client.connect(
        config,
        ref.projectId,
        token,
        this.connectionOwner,
        this.selfhostConnectionScope(ref),
      );
      if (this.alive && generation === this.generation) await this.refresh();
    } catch (e) {
      if (this.alive && generation === this.generation)
        this.error.set(watchError(e));
    } finally {
      if (this.alive && generation === this.generation) this.busy.set(false);
    }
  }
  private resetView() {
    this.saveOperation = undefined;
    this.telegramConnected.set(false);
    this.telegramReconnectRequired.set(false);
    this.telegramConnectionError.set('');
    this.telegramBotUsername.set('');
    this.telegramLink.set('');
    this.submitted.set(false);
    this.touched.set([]);
    this.viewGeneration++;
    this.current.set(undefined);
    this.runs.set([]);
    this.deliveries.set([]);
    this.channels.set(['in_app']);
    this.subscribed.set(false);
    this.editing.set(false);
    this.form.set(emptyForm());
    this.checks.set([]);
    this.deleteReview.set(false);
    this.resetReview.set(false);
  }
  protected disconnect() {
    this.client.disconnectOwned(this.connectionOwner);
    this.definitions.set([]);
    this.current.set(undefined);
    this.notifications.set([]);
    this.status.set(undefined);
    this.runs.set([]);
    this.resetView();
    this.busy.set(false);
    this.message.set('Disconnected.');
  }
  protected retryConnection() {
    this.projectIdentity = '';
    void this.loadContext(this.contextKey());
  }
  ionViewWillLeave() {
    this.alive = false;
    this.generation++;
    const navigation = this.router.currentNavigation?.();
    const destination =
      navigation?.finalUrl ||
      navigation?.extractedUrl ||
      this.router.parseUrl(this.router.url);
    const preserveNotice = this.client.preserveSetupNotice(
      this.connectionOwner,
      this.router.serializeUrl(destination),
    );
    const destinationScope = this.watchHandoffScope();
    if (
      !destinationScope ||
      !this.client.handoffConnection(this.connectionOwner, destinationScope)
    )
      this.client.disconnectOwned(this.connectionOwner, preserveNotice);
    this.definitions.set([]);
    this.notifications.set([]);
    this.status.set(undefined);
    this.resetView();
    this.busy.set(false);
    this.token.set('');
  }
  ionViewWillEnter() {
    if (this.alive) return;
    this.alive = true;
    this.projectIdentity = '';
    void this.loadContext(this.contextKey());
  }
  private selfhostConnectionScope(
    ref: IProjectRef,
    environment = this.environment(),
  ): string {
    return JSON.stringify([
      projectRefToString(ref),
      this.authState()?.user?.uid || '',
      environment,
    ]);
  }
  /** Keep a verified credential only while moving within this exact project's Watch pages. */
  private watchHandoffScope(): string | undefined {
    const navigation = this.router.currentNavigation?.();
    const target =
      navigation?.finalUrl ||
      navigation?.extractedUrl ||
      this.router.parseUrl(this.router.url);
    const parsed = parseProjectUrl(this.router.serializeUrl(target));
    if (
      !parsed.ok ||
      parsed.spaceID ||
      !/^\/watch(?:\/[A-Za-z0-9_-]{1,128})?\/?$/.test(parsed.rest)
    )
      return undefined;
    const projectApi = target.queryParams['projectApi'];
    const branch = target.queryParams['branch'];
    const ref: IProjectRef = {
      storeId: parsed.storeId,
      projectId: parsed.projectId,
      ...(projectApi === 'local' || projectApi === 'cloud'
        ? { projectApi }
        : {}),
      ...(typeof branch === 'string' ? { branch } : {}),
    };
    return this.selfhostConnectionScope(
      ref,
      typeof target.queryParams['env'] === 'string'
        ? target.queryParams['env']
        : '',
    );
  }
  protected async refresh() {
    let user = this.identity();
    if (!user) return;
    const watchId = this.watchId(),
      generation = ++this.viewGeneration;
    const currentView = () =>
      this.alive &&
      this.watchId() === watchId &&
      this.viewGeneration === generation;
    const active = () => currentView() && this.identity() === user;
    this.busy.set(true);
    this.error.set('');
    try {
      if (user.hosted) {
        user = await this.client.refreshIdentity();
        if (!user || !active()) return;
      }
      const [definitions, status, inbox] = await Promise.all([
        this.client.definitions(),
        this.client.status(),
        this.client.inbox(),
      ]);
      if (!active()) return;
      this.definitions.set(definitions.definitions || []);
      this.status.set(status);
      this.notifications.set(inbox.notifications || []);
      if (watchId) {
        const [current, runs, subscription, deliveries] = await Promise.all([
          this.client.definition(watchId),
          this.client.runs(watchId),
          this.client.subscription(watchId),
          this.client.deliveries(watchId),
        ]);
        if (!active()) return;
        this.current.set(current.definition);
        this.runs.set(runs.runs || []);
        this.deliveries.set(deliveries.deliveries || []);
        this.subscribed.set(
          !!subscription.subscription &&
            !subscription.subscription.unsubscribed,
        );
        this.channels.set(
          subscription.subscription?.channels?.length
            ? subscription.subscription.channels
            : ['in_app'],
        );
      }
      const ref = this.scope.ref();
      if (watchId && ref && user.hosted)
        this.client.consumeSetupNotice(ref, user, watchId);
      this.telegramConnected.set(user.telegramConnected === true);
      if (user.channels.telegram) {
        const linked = await this.client.telegramStatus();
        if (active()) {
          this.telegramConnected.set(linked.connected);
          this.telegramReconnectRequired.set(linked.reconnectRequired === true);
          this.telegramConnectionError.set(linked.connectionError || '');
          this.telegramBotUsername.set(
            /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(linked.botUsername || '')
              ? linked.botUsername
              : '',
          );
        }
      }
      if (this.isNew || this.editing()) await this.loadChecks();
      else if (!this.checks().length) {
        // Watch remains usable if the independently served Check catalog is offline.
        try {
          await this.loadChecks();
        } catch {
          /* details retain a source link */
        }
      }
    } catch (e) {
      if (currentView() && (!this.identity() || active())) {
        this.error.set(watchError(e));
        this.status.set(undefined);
        this.current.set(undefined);
        this.runs.set([]);
        this.deliveries.set([]);
        this.channels.set(['in_app']);
        this.subscribed.set(false);
        this.notifications.set([]);
        this.definitions.set([]);
        this.editing.set(false);
        if (this.hosted() && isHostedReadRefused(e)) {
          this.client.disconnectOwned(this.connectionOwner);
          this.busy.set(false);
        }
      }
    } finally {
      if (currentView() && (!this.identity() || active())) this.busy.set(false);
    }
  }
  private async loadChecks() {
    const context = this.scope.context(),
      user = this.identity();
    if (!context || !user)
      throw new Error(
        'Open this project through its DataTug agent to choose a saved Check.',
      );
    const generation = this.viewGeneration;
    const state = await firstValueFrom(this.detective.state(context));
    if (
      !this.alive ||
      this.identity() !== user ||
      generation !== this.viewGeneration
    )
      return;
    this.checks.set(state.checks);
    const seed = this.client.seed;
    const selected =
      this.route.snapshot.queryParamMap.get('checkId') || this.form().checkId;
    if (this.isNew && !this.form().checkId) {
      const check = state.checks.find((c) => c.id === selected);
      this.form.update((f) => ({
        ...f,
        environment: user.environment,
        checkId: check?.id || '',
        title: check ? `${check.title} Watch` : '',
      }));
      const ref = this.scope.ref();
      if (
        seed &&
        ref &&
        this.client.seedMatches(
          ref,
          this.authState()?.user?.uid || '',
          user.environment,
        ) &&
        seed.check.id === selected
      ) {
        this.form.update((f) => ({
          ...f,
          inputs: this.inputText(seed.inputs),
        }));
      }
    }
  }
  protected setField<K extends keyof WatchForm>(key: K, value: WatchForm[K]) {
    this.form.update((f) => ({ ...f, [key]: value }));
    this.saveOperation = undefined;
  }
  protected setNumber(
    key: 'interval' | 'cooldown',
    value: string | number | null | undefined,
  ) {
    this.setField(key, Number(value));
  }
  protected chooseCheck(id: string) {
    this.form.update((f) => ({
      ...f,
      checkId: id,
      title: this.checks().find((c) => c.id === id)?.title || f.title,
      inputs: {},
    }));
    this.saveOperation = undefined;
  }
  protected input(name: string, part: 'value' | 'end', value: string) {
    this.form.update((f) => ({
      ...f,
      inputs: {
        ...f.inputs,
        [name]: {
          ...(f.inputs[name] || { value: '', end: '' }),
          [part]: value,
        },
      },
    }));
    this.saveOperation = undefined;
  }
  private inputText(inputs: Record<string, DetectiveInputValue> = {}) {
    const text = (value: DetectiveInputValue): string =>
      value.type === 'set'
        ? value.values.map((v) => String(v.value)).join(', ')
        : value.type === 'range'
          ? ''
          : String(value.value ?? '');
    return Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [
        key,
        value.type === 'range'
          ? { value: text(value.start), end: text(value.end) }
          : { value: text(value), end: '' },
      ]),
    );
  }
  protected async edit() {
    const d = this.current();
    if (!d || !this.canEdit()) return;
    this.form.set({
      title: d.title,
      checkId: d.checkId,
      environment: d.environment,
      visibility: d.visibility,
      interval: d.schedule.intervalSeconds,
      trigger: d.trigger,
      initial: d.initialObservation,
      mode: d.mode,
      recovery: d.notificationPolicy.recovery,
      cooldown: d.notificationPolicy.cooldownSeconds || 0,
      inputs: this.inputText(d.inputs),
      requirements: (d.requirements || []).join(', '),
    });
    this.editing.set(true);
    this.error.set('');
    try {
      await this.loadChecks();
    } catch (e) {
      this.error.set(watchError(e));
    }
  }
  protected async save() {
    const user = this.identity(),
      check = this.selectedCheck(),
      f = this.form(),
      ref = this.scope.ref();
    if (!user || !ref || this.busy()) return;
    const generation = this.viewGeneration,
      watchId = this.watchId(),
      channels = [...this.channels()];
    const active = () =>
      this.alive &&
      this.identity() === user &&
      this.viewGeneration === generation &&
      this.watchId() === watchId;
    this.error.set('');
    this.submitted.set(true);
    try {
      if (!this.current() && !this.channels().length)
        throw new Error(
          'Choose at least one notification channel before creating a Watch.',
        );
      if (!f.title.trim() || !check)
        throw new Error('Enter a title and choose a saved Check.');
      if (
        f.visibility === 'shared' &&
        !user.sharedEditor &&
        !(
          this.current()?.visibility === 'shared' &&
          this.current()?.owner === user.id
        )
      )
        throw new Error('Your coordinator role cannot publish a shared Watch.');
      if (f.environment !== user.environment)
        throw new Error(
          'Choose the environment authorised by this credential.',
        );
      if (
        !Number.isSafeInteger(f.interval) ||
        f.interval < (user.limits.minIntervalSeconds || 10) ||
        f.interval > 86400
      )
        throw new Error(
          `Frequency must be between ${user.limits.minIntervalSeconds || 10} seconds and 24 hours.`,
        );
      if (!Number.isSafeInteger(f.cooldown) || f.cooldown < 0)
        throw new Error('Cooldown must be a non-negative number of seconds.');
      const inputs: Record<string, DetectiveInputValue> = {};
      for (const input of check.inputs) {
        const text = f.inputs[input.name];
        if (!text?.value.trim()) {
          if (input.required) throw new Error(`${input.name} is required.`);
          continue;
        }
        inputs[input.name] = parseInputValue(
          text.value,
          input.type,
          input.cardinality,
          text.end,
        );
      }
      const old = this.current(),
        now = new Date().toISOString();
      const definition: WatchDefinition = {
        namespace: user.namespace,
        project: user.project,
        environment: f.environment,
        id: old?.id || `watch-${crypto.randomUUID()}`,
        version: old?.version || 0,
        title: f.title.trim(),
        owner: old?.owner || user.id,
        visibility: f.visibility,
        checkId: check.id,
        checkVersion: String(check.version),
        inputs,
        requirements: f.requirements
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        schedule: { intervalSeconds: f.interval },
        trigger: f.trigger,
        initialObservation: f.initial,
        mode: f.mode,
        lifecycle: old?.lifecycle || 'paused',
        enabled: old?.enabled ?? false,
        notificationPolicy: {
          cooldownSeconds: f.cooldown,
          recovery: f.recovery,
        },
        createdAt: old?.createdAt || now,
        updatedAt: now,
      };
      // Reuse the exact operation after an uncertain HTTP failure.
      const digest = JSON.stringify({
        ...definition,
        id: old?.id || '',
        createdAt: old?.createdAt || '',
        updatedAt: '',
      });
      const operation =
        this.saveOperation?.digest === digest
          ? this.saveOperation
          : { digest, id: crypto.randomUUID(), definition };
      this.saveOperation = operation;
      this.busy.set(true);
      let result = await this.client.save(operation.definition, operation.id);
      if (!active()) return;
      this.saveOperation = undefined;
      if (!old) {
        this.client.setupNotice.set('');
        try {
          await this.client.subscribe({
            watchId: result.definition.id,
            channels,
            unsubscribed: false,
          });
          if (!active()) return;
          result = await this.client.lifecycle(result.definition, 'enabled');
        } catch (setupError) {
          if (!active()) return;
          const notice = `Watch saved. Notification setup or enabling was not confirmed: ${watchError(setupError)} Review its current subscription and lifecycle before resuming.`;
          if (user.hosted)
            this.client.stageSetupNotice(
              ref,
              user,
              result.definition.id,
              this.pageHref(['watch', result.definition.id]),
              notice,
            );
          else this.client.setupNotice.set(notice);
        }
      }
      if (!active()) return;
      this.editing.set(false);
      await this.router.navigateByUrl(
        this.pageHref(['watch', result.definition.id]),
        { replaceUrl: true },
      );
      if (!active()) return;
      this.current.set(result.definition);
      this.watchId.set(result.definition.id);
      await this.refresh();
      if (active()) this.message.set('Watch saved.');
    } catch (e) {
      if (active()) this.error.set(watchError(e));
    } finally {
      if (active()) this.busy.set(false);
    }
  }
  protected async lifecycle(next: 'enabled' | 'paused') {
    const d = this.current();
    if (!d || !this.canEdit()) return;
    await this.mutate(async (active) => {
      const result = await this.client.lifecycle(d, next);
      if (!active()) return;
      this.current.set(result.definition);
      this.message.set(next === 'paused' ? 'Watch paused.' : 'Watch resumed.');
    });
  }
  protected async remove() {
    const d = this.current();
    if (!d || !this.canEdit() || !this.deleteReview()) return;
    await this.mutate(async (active) => {
      await this.client.delete(d);
      if (!active()) return;
      await this.router.navigateByUrl(this.pageHref('watch'), {
        replaceUrl: true,
      });
    });
  }
  protected toggleChannel(channel: WatchChannel, on: boolean) {
    this.channels.update((values) =>
      on
        ? [...new Set([...values, channel])]
        : values.filter((c) => c !== channel),
    );
  }
  protected async subscription(unsubscribe = false) {
    if (!this.current()) return;
    if (!unsubscribe && !this.channels().length) {
      this.error.set('Choose at least one notification channel.');
      return;
    }
    await this.mutate(async (active) => {
      await this.client.subscribe({
        watchId: this.watchId(),
        channels: this.channels(),
        unsubscribed: unsubscribe,
      });
      if (!active()) return;
      this.subscribed.set(!unsubscribe);
      this.message.set(
        unsubscribe
          ? 'You have unsubscribed. Other subscribers are unchanged.'
          : 'Your notification preferences were saved.',
      );
    });
  }
  protected async openNotification(item: WatchNotification) {
    await this.mutate(async (active) => {
      await this.client.read(item.id);
      if (!active()) return;
      await this.router.navigateByUrl(this.pageHref(['watch', item.watchId]));
    });
  }
  private async mutate(action: (active: () => boolean) => Promise<void>) {
    const user = this.identity();
    const id = this.watchId(),
      generation = this.viewGeneration;
    const active = () =>
      this.alive &&
      this.identity() === user &&
      this.watchId() === id &&
      this.viewGeneration === generation;
    if (!user || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action(active);
      if (this.alive && this.identity() === user) await this.refresh();
    } catch (e) {
      if (this.alive && this.identity() === user) this.error.set(watchError(e));
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
  protected async retryDelivery(id: string) {
    await this.mutate(async (active) => {
      await this.client.retry(id);
      if (!active()) return;
      this.message.set('The original notification was queued for retry.');
    });
  }
  protected async resetBaseline() {
    const current = this.current();
    if (!current || !this.canEdit() || !this.resetReview()) return;
    await this.mutate(async (active) => {
      const response = await this.client.reset(current);
      if (!active()) return;
      this.current.set(response.definition);
      this.resetReview.set(false);
      this.message.set(
        'Current source acknowledged. The next evaluation establishes a fresh baseline.',
      );
    });
  }
  protected deliveryState(delivery: WatchDelivery): string {
    return delivery.failureCode === 'TELEGRAM_RECIPIENT_UNAVAILABLE' &&
      ['failed', 'cancelled'].includes(delivery.state)
      ? 'Not delivered'
      : this.label(delivery.state);
  }
  protected async connectTelegram() {
    await this.mutate(async (active) => {
      const link = await this.client.telegramConnect();
      if (!active()) return;
      const url = new URL(link.url);
      if (
        url.origin !== 'https://t.me' ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.size !== 1 ||
        !/^\/[A-Za-z][A-Za-z0-9_]{4,31}$/.test(url.pathname) ||
        (!!this.telegramBotUsername() &&
          url.pathname !== '/' + this.telegramBotUsername()) ||
        !/^watch-[A-Za-z0-9_-]+$/.test(url.searchParams.get('start') || '')
      )
        throw new Error(
          'The coordinator returned an invalid Telegram bot connection link.',
        );
      this.telegramBotUsername.set(url.pathname.slice(1));
      this.telegramLink.set(url.href);
      this.message.set(
        'Open the configured Telegram bot and confirm the connection, then refresh the connection status.',
      );
    });
  }
  protected async disconnectTelegram() {
    await this.mutate(async (active) => {
      await this.client.telegramDisconnect();
      if (!active()) return;
      this.telegramConnected.set(false);
      this.telegramLink.set('');
      this.telegramBotUsername.set('');
      this.channels.update((c) => c.filter((x) => x !== 'telegram'));
      this.message.set('Telegram disconnected.');
    });
  }
  protected observed(id: string) {
    return this.status()?.observations?.find((o) => o.watchId === id);
  }
}

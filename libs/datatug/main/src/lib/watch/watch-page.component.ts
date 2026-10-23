import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { filter, firstValueFrom } from 'rxjs';
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
  private alive = true;
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
      !!observation?.lastRunId &&
      this.runs().some(
        (run) =>
          run.id === observation.lastRunId &&
          run.failureCode === 'SOURCE_CHANGED',
      )
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
    const user = this.client.identity(),
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
        form.interval <
          (this.client.identity()?.limits.minIntervalSeconds || 10) ||
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
      SOURCE_CHANGED: 'Source changed — review and reset the baseline',
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
    effect(() => {
      const ref = this.scope.ref();
      if (!ref) return;
      const identity = JSON.stringify(ref);
      void this.loadManifest(identity);
    });
  }
  private async loadManifest(identity: string) {
    const ref = this.scope.ref();
    if (!ref) return;
    if (this.projectIdentity && this.projectIdentity !== identity) {
      this.disconnect();
      this.token.set('');
    }
    this.projectIdentity = identity;
    const generation = ++this.generation;
    this.manifestLoading.set(true);
    this.error.set('');
    this.current.set(undefined);
    try {
      const summary = await firstValueFrom(
        this.project
          .watchProjectSummary(ref)
          .pipe(filter((summary) => !!summary)),
      );
      if (
        !this.alive ||
        generation !== this.generation ||
        JSON.stringify(this.scope.ref()) !== identity
      )
        return;
      const config = summary?.coordination;
      if (config) coordinatorEndpoint(config.endpoint);
      this.config.set(config);
      if (!config || !this.client.matches(config, ref.projectId))
        this.client.disconnect();
      if (this.client.identity()) await this.refresh();
    } catch (e) {
      if (this.alive && generation === this.generation)
        this.error.set(watchError(e));
    } finally {
      if (this.alive && generation === this.generation)
        this.manifestLoading.set(false);
    }
  }
  protected pageHref(page: string | string[]) {
    return projectPageHref(this.scope.ref(), page);
  }
  protected async connect() {
    const config = this.config(),
      ref = this.scope.ref();
    if (!config || !ref || this.busy()) return;
    const token = this.token();
    this.token.set('');
    this.busy.set(true);
    this.error.set('');
    try {
      await this.client.connect(config, ref.projectId, token);
      if (this.alive) await this.refresh();
    } catch (e) {
      if (this.alive) this.error.set(watchError(e));
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
  private resetView() {
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
    this.client.disconnect();
    this.definitions.set([]);
    this.current.set(undefined);
    this.notifications.set([]);
    this.status.set(undefined);
    this.runs.set([]);
    this.resetView();
    this.message.set('Disconnected.');
  }
  protected async refresh() {
    const user = this.client.identity();
    if (!user) return;
    const watchId = this.watchId(),
      generation = ++this.viewGeneration;
    const active = () =>
      this.alive &&
      this.client.identity() === user &&
      this.watchId() === watchId &&
      this.viewGeneration === generation;
    this.busy.set(true);
    this.error.set('');
    try {
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
      this.telegramConnected.set(user.telegramConnected === true);
      if (user.channels.telegram) {
        const linked = await this.client.telegramStatus();
        if (active()) {
          this.telegramConnected.set(linked.connected);
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
      if (active()) this.error.set(watchError(e));
      if (active()) this.status.set(undefined);
    } finally {
      if (active()) this.busy.set(false);
    }
  }
  private async loadChecks() {
    const context = this.scope.context(),
      user = this.client.identity();
    if (!context || !user)
      throw new Error(
        'Open this project through its DataTug agent to choose a saved Check.',
      );
    const state = await firstValueFrom(this.detective.state(context));
    if (!this.alive || this.client.identity() !== user) return;
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
      if (seed && seed.project === user.project && seed.check.id === selected) {
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
    const user = this.client.identity(),
      check = this.selectedCheck(),
      f = this.form(),
      ref = this.scope.ref();
    if (!user || !ref || this.busy()) return;
    this.error.set('');
    this.submitted.set(true);
    try {
      if (!this.current() && !this.channels().length)
        throw new Error(
          'Choose at least one notification channel before creating a Watch.',
        );
      if (!f.title.trim() || !check)
        throw new Error('Enter a title and choose a saved Check.');
      if (f.visibility === 'shared' && !user.sharedEditor)
        throw new Error(
          'Your coordinator role cannot create or edit shared Watches.',
        );
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
      if (!this.alive || this.client.identity() !== user) return;
      this.saveOperation = undefined;
      if (!old) {
        this.client.setupNotice.set('');
        try {
          await this.client.subscribe({
            watchId: result.definition.id,
            channels: this.channels(),
            unsubscribed: false,
          });
          result = await this.client.lifecycle(result.definition, 'enabled');
        } catch (setupError) {
          this.client.setupNotice.set(
            `Watch saved. Notification setup or enabling was not confirmed: ${watchError(setupError)} Review its current subscription and lifecycle before resuming.`,
          );
        }
      }
      this.editing.set(false);
      await this.router.navigateByUrl(
        this.pageHref(['watch', result.definition.id]),
        { replaceUrl: true },
      );
      this.current.set(result.definition);
      this.watchId.set(result.definition.id);
      await this.refresh();
      this.message.set('Watch saved.');
    } catch (e) {
      if (this.alive && this.client.identity() === user)
        this.error.set(watchError(e));
    } finally {
      if (this.alive) this.busy.set(false);
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
      this.subscribed.set(!unsubscribe);
      if (!active()) return;
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
    const user = this.client.identity();
    const id = this.watchId(),
      generation = this.viewGeneration;
    const active = () =>
      this.alive &&
      this.client.identity() === user &&
      this.watchId() === id &&
      this.viewGeneration === generation;
    if (!user || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action(active);
      if (this.alive && this.client.identity() === user) await this.refresh();
    } catch (e) {
      if (this.alive && this.client.identity() === user)
        this.error.set(watchError(e));
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

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCheckbox,
  IonInput,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/angular';
import { WatchClientService, watchError } from './watch-client.service';
import type {
  WatchIdentity,
  WatchRunnerEnrollment,
  WatchRunnerSource,
} from './watch.models';

/** Operator credentials remain in this component's memory until dismissed or the scope changes. */
@Component({
  selector: 'sneat-datatug-watch-runners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './watch-runners.component.html',
  styles: [
    ':host { display:block; } ion-card { margin:0 0 16px; } h2 { margin:0; font-size:1.15rem; } .credential { overflow-wrap:anywhere; } ion-checkbox::part(label) { white-space:normal; } .setup-config { white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.5; max-height:22rem; overflow:auto; } code { overflow-wrap:anywhere; } .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }',
  ],
  imports: [
    IonAccordion,
    IonAccordionGroup,
    DatePipe,
    IonBadge,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCheckbox,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonSpinner,
  ],
})
export class WatchRunnersComponent {
  readonly identity = input.required<WatchIdentity>();
  readonly connectionOwner = input.required<object>();
  private readonly scope = computed(() => this.scopeKey(this.identity()));
  private readonly authority = computed(() =>
    this.scopeKey(this.client.identity()),
  );
  private activeOwner?: object;
  private scopeKey(user?: WatchIdentity): string {
    return JSON.stringify(
      user && [
        user.id,
        user.namespace,
        user.spaceID,
        user.project,
        user.environment,
        user.canManageRunners,
      ],
    );
  }
  private readonly client = inject(WatchClientService);
  private readonly destroy = inject(DestroyRef);
  private generation = 0;
  protected readonly items = signal<WatchRunnerEnrollment[]>([]);
  protected readonly next = signal('');
  protected readonly sources = signal<WatchRunnerSource[]>([]);
  protected readonly sourceIDs = signal<string[]>([]);
  protected readonly capabilities = signal('');
  protected readonly botID = signal('');
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly token = signal('');
  protected readonly allowOpaqueSQL = signal(false);
  private configuredEnrollment?: WatchRunnerEnrollment;
  protected readonly setup = signal<
    ReturnType<WatchClientService['runnerSetup']> | undefined
  >(undefined);
  protected readonly review = signal<
    { item: WatchRunnerEnrollment; action: 'revoke' | 'rotate' } | undefined
  >(undefined);
  private operationID = '';

  constructor() {
    effect(() => {
      this.scope();
      this.authority();
      const owner = this.connectionOwner();
      untracked(() => {
        this.activeOwner = owner;
        this.generation++;
        this.token.set('');
        this.setup.set(undefined);
        this.configuredEnrollment = undefined;
        this.allowOpaqueSQL.set(false);
        this.items.set([]);
        this.next.set('');
        this.sources.set([]);
        this.sourceIDs.set([]);
        this.capabilities.set('');
        this.botID.set('');
        this.creating.set(false);
        this.review.set(undefined);
        this.operationID = '';
        void this.refresh();
      });
    });
    this.destroy.onDestroy(() => {
      this.generation++;
      this.token.set('');
      this.setup.set(undefined);
      this.configuredEnrollment = undefined;
    });
  }
  private current(user: WatchIdentity, generation: number) {
    return (
      !this.destroy.destroyed &&
      generation === this.generation &&
      this.activeOwner === this.connectionOwner() &&
      !!this.activeOwner &&
      this.client.ownsConnection(this.activeOwner) &&
      this.scopeKey(this.client.identity()) === this.scopeKey(user) &&
      this.scopeKey(this.identity()) === this.scopeKey(user) &&
      user.canManageRunners === true
    );
  }
  protected async refresh() {
    const user = this.identity(),
      generation = this.generation;
    if (!this.current(user, generation)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const [enrollments, sources] = await Promise.all([
        this.client.enrollments(),
        this.client.sources(),
      ]);
      if (!this.current(user, generation)) return;
      this.items.set(enrollments.enrollments);
      this.next.set(enrollments.next || '');
      this.sources.set(sources.sources);
    } catch (error) {
      if (this.current(user, generation)) {
        this.items.set([]);
        this.next.set('');
        this.error.set(watchError(error));
      }
    } finally {
      if (this.current(user, generation)) this.busy.set(false);
    }
  }
  protected sourceLabel(source: WatchRunnerSource) {
    return [
      source.kind,
      source.database,
      source.collection,
      source.sourceId,
      source.origin,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  protected expired(item: WatchRunnerEnrollment) {
    return !item.revoked && Date.parse(item.expiresAt) <= Date.now();
  }
  protected async loadMore() {
    const cursor = this.next(),
      user = this.identity(),
      generation = this.generation;
    if (!cursor || this.busy() || !this.current(user, generation)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const page = await this.client.enrollments(cursor);
      if (!this.current(user, generation)) return;
      this.items.update((items) => [
        ...items,
        ...page.enrollments.filter(
          (item) => !items.some((existing) => existing.id === item.id),
        ),
      ]);
      this.next.set(page.next || '');
    } catch (error) {
      if (this.current(user, generation)) this.error.set(watchError(error));
    } finally {
      if (this.current(user, generation)) this.busy.set(false);
    }
  }
  protected start() {
    this.creating.set(true);
    this.token.set('');
    this.setup.set(undefined);
    this.configuredEnrollment = undefined;
    this.allowOpaqueSQL.set(false);
    this.operationID = crypto.randomUUID();
    this.error.set('');
  }
  protected async create() {
    if (this.busy()) return;
    const user = this.identity(),
      generation = this.generation;
    if (!this.current(user, generation)) return;
    const sourceIDs = [...this.sourceIDs()],
      capabilities = this.capabilities()
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    if (
      !sourceIDs.length ||
      sourceIDs.some((id) => !this.sources().some((source) => source.id === id))
    ) {
      this.error.set('Choose at least one admitted source.');
      return;
    }
    if (
      capabilities.length > 32 ||
      capabilities.some((value) => value.length > 128)
    ) {
      this.error.set('Use at most 32 capabilities, each under 128 characters.');
      return;
    }
    if (this.botID() && !/^[1-9][0-9]{0,19}$/.test(this.botID())) {
      this.error.set(
        'Enter a numeric Telegram bot ID. Its secret stays on your runner.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.client.enroll({
        operationId: this.operationID,
        sourceIDs,
        capabilities,
        ...(this.botID() ? { telegramBotId: this.botID() } : {}),
      });
      if (!this.current(user, generation)) return;
      this.token.set(result.token || '');
      this.creating.set(false);
      this.message.set(
        result.token
          ? 'Enrollment created. Copy the credential now; it is shown only once.'
          : 'Enrollment exists. Rotate its credential if the original response was lost.',
      );
      this.items.update((items) => [
        result.enrollment,
        ...items.filter((item) => item.id !== result.enrollment.id),
      ]);
      await this.client.refreshIdentity();
      if (!this.current(user, generation)) return;
      this.showSetup(result.enrollment);
    } catch (error) {
      if (this.current(user, generation)) this.error.set(watchError(error));
    } finally {
      if (this.current(user, generation)) this.busy.set(false);
    }
  }
  protected async confirm() {
    const review = this.review();
    if (!review || this.busy()) return;
    const user = this.identity(),
      generation = this.generation;
    if (!this.current(user, generation)) return;
    if (review.action === 'rotate' && review.item.ownerId !== user.id) {
      this.error.set('Only the enrollment owner can rotate its credential.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.token.set('');
    try {
      if (review.action === 'rotate') {
        const result = await this.client.rotate(review.item);
        if (!this.current(user, generation)) return;
        this.token.set(result.token || '');
        this.showSetup(result.enrollment);
        this.message.set(
          'Old credential revoked. Copy the new credential now.',
        );
      } else {
        await this.client.revoke(review.item);
        if (!this.current(user, generation)) return;
        this.message.set(
          'Runner enrollment revoked. It cannot claim or renew work.',
        );
        this.setup.set(undefined);
        this.configuredEnrollment = undefined;
        this.allowOpaqueSQL.set(false);
      }
      this.review.set(undefined);
      await this.refresh();
    } catch (error) {
      if (this.current(user, generation)) this.error.set(watchError(error));
    } finally {
      if (this.current(user, generation)) this.busy.set(false);
    }
  }
  protected async copy() {
    const token = this.token(),
      user = this.identity(),
      generation = this.generation;
    try {
      await navigator.clipboard.writeText(token);
      if (this.current(user, generation))
        this.message.set(
          'Credential copied. Store it securely on your runner.',
        );
    } catch {
      if (this.current(user, generation))
        this.error.set(
          'Clipboard unavailable. Select and copy the credential.',
        );
    }
  }
  protected showSetup(item: WatchRunnerEnrollment) {
    if (!this.current(this.identity(), this.generation)) return;
    if (item.ownerId !== this.identity().id) {
      this.error.set('Only the enrollment owner can configure its runner.');
      return;
    }
    this.setup.set(undefined);
    this.configuredEnrollment = undefined;
    this.allowOpaqueSQL.set(false);
    try {
      const setup = this.client.runnerSetup(item, this.sources());
      this.configuredEnrollment = item;
      this.setup.set(setup);
    } catch (error) {
      this.error.set(watchError(error));
    }
  }
  protected setSQLPermission(allowed: boolean) {
    if (
      !this.current(this.identity(), this.generation) ||
      !this.configuredEnrollment
    )
      return;
    try {
      this.setup.set(
        this.client.runnerSetup(
          this.configuredEnrollment,
          this.sources(),
          allowed,
        ),
      );
      this.allowOpaqueSQL.set(allowed);
    } catch (error) {
      this.error.set(watchError(error));
    }
  }
  protected async copySetup() {
    const setup = this.setup(),
      user = this.identity(),
      generation = this.generation;
    if (!setup || !this.current(user, generation)) return;
    try {
      await navigator.clipboard.writeText(setup.config);
      if (this.current(user, generation))
        this.message.set(
          'Configuration copied. Replace the private paths and native SQLite catalog aliases. Keep approved OVDB origins unchanged.',
        );
    } catch {
      if (this.current(user, generation))
        this.error.set(
          'Clipboard unavailable. Select and copy the configuration.',
        );
    }
  }
}

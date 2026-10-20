import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { incidentEventSummary } from '../incidents/incident-event-summary';
import {
  IncidentArtifactRef,
  IncidentEvent,
  IncidentRef,
} from '../incidents/models';
import { projectPageHref } from '../nav/project-page-href';
import {
  DetectiveClientService,
  DetectiveRequestContext,
  detectiveErrorMessage,
  detectiveOperationId,
} from './detective-client.service';
import {
  HostedIncidentMessage,
  HostedIncidentView,
} from './hosted-linkage.models';
import { CheckDefinition } from './models';

type CloudContext = Extract<DetectiveRequestContext, { kind: 'cloud' }>;
type PendingMessage = {
  operationId: string;
  expectedSeq: number;
  message: HostedIncidentMessage;
};

/** A hosted transport adapter for the existing Incident event stream, not an AI chat. */
@Component({
  selector: 'sneat-datatug-hosted-incident-conversation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonItem,
    IonLabel,
    IonList,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  template: `
    <section aria-label="Incident conversation">
      <h2>Conversation</h2>
      <ion-button
        fill="clear"
        (click)="refresh()"
        [disabled]="loading() || sending()"
        >Refresh conversation</ion-button
      >
      @if (loading()) {
        <p role="status">Loading conversation…</p>
      }
      @if (readError()) {
        <p role="alert">{{ readError() }}</p>
      }
      <ion-list aria-label="Incident messages">
        @for (event of events(); track event.id) {
          <ion-item>
            <ion-label class="ion-text-wrap">
              <h3 style="white-space: pre-wrap">{{ summary(event) }}</h3>
              <p>
                {{ event.actor.id }} ·
                {{ event.actor.via || 'interface unavailable' }} ·
                {{ event.at }} · {{ event.assertion.kind }}
              </p>
              @for (ref of event.refs || []; track $index) {
                @if (evidenceHref(ref); as target) {
                  <p>
                    <a
                      [routerLink]="target"
                      [queryParams]="evidenceParams(ref)"
                      >{{ evidenceLabel(ref) }}</a
                    >
                  </p>
                } @else {
                  <p>{{ evidenceLabel(ref) }} · No supported evidence view</p>
                }
              }
            </ion-label>
          </ion-item>
        }
      </ion-list>
      @if (ready() && !events().length) {
        <p>No visible messages in the loaded history.</p>
      }
      @if (hasMore()) {
        <ion-button (click)="loadMore()" [disabled]="loading() || sending()"
          >Load more history</ion-button
        >
      }
      @if (!canWrite()) {
        <p role="status">
          You can read this conversation, but cannot post messages.
        </p>
      }
      @if (canWrite()) {
        <ion-item>
          <ion-label position="stacked">Message</ion-label>
          <ion-textarea
            aria-label="Incident message"
            [value]="body()"
            [disabled]="sending() || !!pending()"
            (ionInput)="body.set($event.detail.value || '')"
          />
        </ion-item>
        <ion-item>
          <ion-label>Message type</ion-label>
          <ion-select
            aria-label="Message type"
            [value]="assertion()"
            [disabled]="sending() || !!pending()"
            (ionChange)="setAssertion($event.detail.value)"
          >
            <ion-select-option value="claim">Claim</ion-select-option>
            <ion-select-option value="question">Question</ion-select-option>
            <ion-select-option value="hypothesis">Hypothesis</ion-select-option>
            <ion-select-option value="observation"
              >Observation</ion-select-option
            >
          </ion-select>
        </ion-item>
        @if (checks().length) {
          <ion-item>
            <ion-label>Reference a saved Check</ion-label>
            <ion-select
              aria-label="Reference a saved Check"
              [value]="checkID()"
              [disabled]="sending() || !!pending()"
              (ionChange)="checkID.set($event.detail.value || '')"
            >
              <ion-select-option value="">None</ion-select-option>
              @for (check of checks(); track check.id) {
                <ion-select-option [value]="check.id">{{
                  check.title
                }}</ion-select-option>
              }
            </ion-select>
          </ion-item>
          <p>
            A Check definition reference is not a passing run. Run attachments
            are not available here yet.
          </p>
        }
        @if (sendError()) {
          <p role="alert">{{ sendError() }}</p>
        }
        @if (conflict()) {
          <ion-button
            (click)="reviewConflict()"
            [disabled]="loading() || sending()"
            >Review latest conversation</ion-button
          >
        }
        @if (pending() && !conflict()) {
          <ion-button
            fill="clear"
            (click)="reviewPending()"
            [disabled]="loading() || sending()"
          >
            Review pending message
          </ion-button>
          @if (pendingReview()) {
            <div role="group" aria-label="Pending message recovery">
              <p role="alert">
                This attempt may already have been saved. A lost reply or
                changed access cannot prove whether it was delivered. Posting
                the text again may create a duplicate. Abandoning this local
                retry does not remove a saved message.
              </p>
              @if (hasMore()) {
                <p>
                  Load and review the remaining history before starting a new
                  draft.
                </p>
              }
              <ion-button
                fill="clear"
                (click)="keepPendingRetry()"
                [disabled]="loading() || sending()"
                >Keep original retry</ion-button
              >
              <ion-button
                (click)="abandonPending()"
                [disabled]="!ready() || hasMore() || loading() || sending()"
                >Abandon retry and edit draft</ion-button
              >
            </div>
          }
        }
        @if (recoveryNotice()) {
          <p role="status">{{ recoveryNotice() }}</p>
        }
        <ion-button
          (click)="send()"
          [disabled]="
            !ready() ||
            loading() ||
            sending() ||
            conflict() ||
            pendingReview() ||
            !body().trim()
          "
        >
          {{
            sending()
              ? 'Posting…'
              : pending()
                ? 'Retry message'
                : 'Post message'
          }}
        </ion-button>
        @if (posted()) {
          <p role="status">Message saved.</p>
        }
      }
    </section>
  `,
})
export class HostedIncidentConversationComponent {
  readonly context = input.required<CloudContext>();
  readonly environment = input.required<string>();
  readonly incidentRef = input.required<IncidentRef>();
  readonly canWrite = input(false);
  readonly checks = input<CheckDefinition[]>([]);
  readonly incidentUpdated = output<HostedIncidentView>();
  private readonly client = inject(DetectiveClientService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly events = signal<IncidentEvent[]>([]);
  protected readonly loading = signal(false);
  protected readonly sending = signal(false);
  protected readonly ready = signal(false);
  protected readonly readError = signal('');
  protected readonly sendError = signal('');
  protected readonly body = signal('');
  protected readonly assertion = signal<
    'claim' | 'question' | 'hypothesis' | 'observation'
  >('claim');
  protected readonly checkID = signal('');
  protected readonly pending = signal<PendingMessage | undefined>(undefined);
  protected readonly conflict = signal(false);
  protected readonly pendingReview = signal(false);
  protected readonly recoveryNotice = signal('');
  private readonly conflictHistoryLoaded = signal(false);
  protected readonly posted = signal(false);
  protected readonly hasMore = signal(false);
  private readonly afterSeq = signal(0);
  private readonly lastSeq = signal(0);
  private requestGeneration = 0;
  private readonly identity = computed(() =>
    JSON.stringify([this.context(), this.environment(), this.incidentRef()]),
  );
  private readonly reset = effect(() => {
    const identity = this.identity();
    this.events.set([]);
    this.ready.set(false);
    this.body.set('');
    this.pending.set(undefined);
    this.pendingReview.set(false);
    this.recoveryNotice.set('');
    this.sendError.set('');
    this.conflict.set(false);
    this.conflictHistoryLoaded.set(false);
    this.posted.set(false);
    this.checkID.set('');
    this.assertion.set('claim');
    this.lastSeq.set(0);
    this.sending.set(false);
    try {
      const raw = sessionStorage.getItem(this.storageKey(identity));
      const value: unknown = raw ? JSON.parse(raw) : undefined;
      if (this.isPending(value)) {
        this.pending.set(value);
        this.body.set(value.message.body);
        this.setAssertion(value.message.assertion || 'claim');
        this.checkID.set(
          value.message.refs?.find((ref) => ref.kind === 'check')?.artifact
            ?.id || '',
        );
      }
    } catch {
      /* Pending retries remain in memory when storage is unavailable. */
    }
    // Only the canonical identity resets a draft. Reads also inspect input
    // objects, whose equivalent replacements must not trigger another reset.
    untracked(() => void this.read(true));
  });

  protected summary = incidentEventSummary;
  protected setAssertion(value: string): void {
    if (
      value === 'claim' ||
      value === 'question' ||
      value === 'hypothesis' ||
      value === 'observation'
    )
      this.assertion.set(value);
  }
  private storageKey(identity = this.identity()): string {
    return `datatug:incident-message:${identity}`;
  }
  private isPending(value: unknown): value is PendingMessage {
    if (!value || typeof value !== 'object') return false;
    const p = value as PendingMessage;
    return (
      typeof p.operationId === 'string' &&
      p.operationId.startsWith('operation-') &&
      Number.isSafeInteger(p.expectedSeq) &&
      p.expectedSeq >= 1 &&
      typeof p.message?.body === 'string' &&
      new TextEncoder().encode(p.message.body).length <= 4000
    );
  }
  private current(identity: string, generation: number): boolean {
    return (
      !this.destroyRef.destroyed &&
      identity === this.identity() &&
      generation === this.requestGeneration
    );
  }
  protected refresh(): void {
    void this.read(true);
  }
  protected loadMore(): void {
    if (!this.loading() && this.hasMore()) void this.read(false);
  }
  private async read(reset: boolean): Promise<boolean> {
    const identity = this.identity();
    const generation = ++this.requestGeneration;
    const context = this.context();
    const environment = this.environment();
    const ref = this.incidentRef();
    this.loading.set(true);
    this.readError.set('');
    this.ready.set(false);
    if (reset) {
      this.events.set([]);
      this.afterSeq.set(0);
      this.hasMore.set(false);
    }
    try {
      // Re-admit the Incident and rights on every page, not just the original route load.
      const detail = await firstValueFrom(
        this.client.projectIncident(
          context,
          environment,
          `${ref.storeId}/${ref.incidentId}`,
        ),
      );
      if (!this.current(identity, generation)) return false;
      if (
        !Number.isSafeInteger(detail.incident.lastSeq) ||
        detail.incident.lastSeq < 1 ||
        detail.incident.ref.storeId !== ref.storeId ||
        detail.incident.ref.incidentId !== ref.incidentId
      )
        throw new Error(
          'Conversation returned an invalid Incident projection.',
        );
      const after = this.afterSeq();
      const page = await firstValueFrom(
        this.client.incidentEvents(
          context,
          environment,
          `${ref.storeId}/${ref.incidentId}`,
          after,
        ),
      );
      if (!this.current(identity, generation)) return false;
      if (
        !Number.isSafeInteger(page.nextAfterSeq) ||
        page.nextAfterSeq < after ||
        (page.hasMore && page.nextAfterSeq <= after)
      )
        throw new Error('Conversation history returned an invalid cursor.');
      const merged = new Map(this.events().map((event) => [event.id, event]));
      for (const event of page.events || []) {
        if (
          event.incident.storeId !== ref.storeId ||
          event.incident.incidentId !== ref.incidentId ||
          event.seq <= after ||
          event.seq > page.nextAfterSeq
        )
          throw new Error(
            'Conversation history returned an unexpected Incident event.',
          );
        if (event.type === 'note.added') merged.set(event.id, event);
      }
      this.events.set([...merged.values()].sort((a, b) => a.seq - b.seq));
      this.afterSeq.set(page.nextAfterSeq);
      this.hasMore.set(page.hasMore);
      if (detail.incident.lastSeq >= this.lastSeq())
        this.incidentUpdated.emit(detail.incident);
      this.lastSeq.set(
        Math.max(this.lastSeq(), detail.incident.lastSeq, page.nextAfterSeq),
      );
      this.ready.set(true);
      return true;
    } catch (error) {
      if (this.current(identity, generation)) {
        this.events.set([]);
        this.hasMore.set(false);
        this.readError.set(detectiveErrorMessage(error, true));
      }
      return false;
    } finally {
      if (this.current(identity, generation)) this.loading.set(false);
    }
  }
  protected async reviewPending(): Promise<void> {
    if (!this.pending() || this.conflict() || this.loading() || this.sending())
      return;
    this.pendingReview.set(true);
    await this.read(true);
  }
  protected keepPendingRetry(): void {
    if (!this.sending()) this.pendingReview.set(false);
  }
  protected abandonPending(): void {
    if (
      !this.pendingReview() ||
      !this.pending() ||
      this.conflict() ||
      !this.canWrite() ||
      !this.ready() ||
      this.hasMore() ||
      this.loading() ||
      this.sending()
    )
      return;
    // Only this explicit reviewed action retires the uncertain intent. It
    // cannot retract a message the server may already have committed.
    this.pending.set(undefined);
    this.pendingReview.set(false);
    this.checkID.set('');
    this.sendError.set('');
    this.recoveryNotice.set(
      'Original retry abandoned locally. Saved Check references were removed. Review the text before posting a new message; the original may already exist.',
    );
    try {
      sessionStorage.removeItem(this.storageKey());
    } catch {
      /* The edited draft remains usable in this component. */
    }
  }
  protected async reviewConflict(): Promise<void> {
    if (!this.conflictHistoryLoaded()) {
      if (!(await this.read(true))) return;
      this.conflictHistoryLoaded.set(true);
    }
    if (this.hasMore()) {
      this.sendError.set(
        'Load and review the remaining history before posting this draft.',
      );
      return;
    }
    if (!this.ready() || this.loading()) return;
    this.pending.set(undefined);
    this.conflict.set(false);
    this.conflictHistoryLoaded.set(false);
    this.sendError.set('');
    try {
      sessionStorage.removeItem(this.storageKey());
    } catch {
      /* The reviewed draft remains in memory. */
    }
  }
  protected async send(): Promise<void> {
    if (
      !this.canWrite() ||
      !this.ready() ||
      this.loading() ||
      this.sending() ||
      this.conflict() ||
      this.pendingReview() ||
      !this.body().trim()
    )
      return;
    if (new TextEncoder().encode(this.body()).length > 4000) {
      this.sendError.set('Keep the message within 4,000 bytes.');
      return;
    }
    const identity = this.identity();
    const context = this.context();
    const ref = this.incidentRef();
    const environment = this.environment();
    let pending = this.pending();
    if (!pending) {
      const selected = this.checks().find(
        (check) => check.id === this.checkID(),
      );
      if (this.checkID() && !selected) {
        this.sendError.set('Choose an available saved Check.');
        return;
      }
      const refs: IncidentArtifactRef[] = selected
        ? [
            {
              kind: 'check',
              artifact: {
                storeId: context.storage,
                projectId: context.project,
                environment,
                id: selected.id,
              },
            },
          ]
        : [];
      pending = {
        operationId: detectiveOperationId(),
        expectedSeq: this.lastSeq(),
        message: {
          body: this.body(),
          assertion: this.assertion(),
          ...(refs.length ? { refs } : {}),
        },
      };
      this.pending.set(pending);
      try {
        sessionStorage.setItem(
          this.storageKey(identity),
          JSON.stringify(pending),
        );
      } catch {
        /* Retry still works in this component. */
      }
    }
    this.sending.set(true);
    this.sendError.set('');
    this.posted.set(false);
    this.recoveryNotice.set('');
    try {
      const result = await firstValueFrom(
        this.client.incidentAction(
          context,
          {
            type: 'append-message',
            incidentRef: `${ref.storeId}/${ref.incidentId}`,
            environment,
            expectedSeq: pending.expectedSeq,
            message: pending.message,
          },
          pending.operationId,
        ),
      );
      if (this.destroyRef.destroyed || identity !== this.identity()) return;
      if (
        !result.event ||
        result.event.incident.storeId !== ref.storeId ||
        result.event.incident.incidentId !== ref.incidentId ||
        result.event.type !== 'note.added' ||
        !Number.isSafeInteger(result.event.seq) ||
        !Number.isSafeInteger(result.incident.lastSeq) ||
        result.incident.ref.storeId !== ref.storeId ||
        result.incident.ref.incidentId !== ref.incidentId ||
        result.incident.lastSeq < result.event.seq
      )
        throw new Error(
          'The server did not confirm the saved message. Retry to retrieve its receipt.',
        );
      this.pending.set(undefined);
      this.body.set('');
      this.checkID.set('');
      this.posted.set(true);
      try {
        sessionStorage.removeItem(this.storageKey(identity));
      } catch {
        /* Server receipt already confirmed. */
      }
      const confirmed = result.event;
      this.events.update((events) =>
        [
          ...new Map(
            [...events, confirmed].map((event) => [event.id, event]),
          ).values(),
        ].sort((a, b) => a.seq - b.seq),
      );
      if (result.incident.lastSeq >= this.lastSeq())
        this.incidentUpdated.emit(result.incident);
      this.lastSeq.set(Math.max(this.lastSeq(), result.incident.lastSeq));
    } catch (error) {
      if (this.destroyRef.destroyed || identity !== this.identity()) return;
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.conflict.set(true);
        this.pendingReview.set(false);
        this.conflictHistoryLoaded.set(false);
        this.sendError.set(
          'The conversation changed. Review the latest messages before posting this draft.',
        );
      } else {
        this.sendError.set(detectiveErrorMessage(error, true));
        if (
          error instanceof HttpErrorResponse &&
          [401, 403].includes(error.status)
        ) {
          this.events.set([]);
          this.ready.set(false);
        }
      }
    } finally {
      if (!this.destroyRef.destroyed && identity === this.identity())
        this.sending.set(false);
    }
  }
  private projectRef(): IProjectRef {
    const c = this.context();
    return { storeId: c.storage, spaceID: c.spaceID, projectId: c.project };
  }
  protected evidenceLabel(ref: IncidentArtifactRef): string {
    return ref.kind === 'check'
      ? `Check definition: ${ref.artifact?.id || 'unavailable'}`
      : ref.kind === 'query'
        ? `Saved query: ${ref.artifact?.id || 'unavailable'}`
        : ref.kind === 'execution'
          ? `Query execution: ${ref.execution?.executionId || 'unavailable'}`
          : `${ref.kind} reference`;
  }
  protected evidenceHref(ref: IncidentArtifactRef): string | undefined {
    const a = ref.artifact;
    const c = this.context();
    if (
      !a ||
      a.storeId !== c.storage ||
      a.projectId !== c.project ||
      a.environment !== this.environment()
    )
      return undefined;
    if (ref.kind === 'check')
      return projectPageHref(this.projectRef(), ['checks', a.id]);
    if (ref.kind === 'query')
      return projectPageHref(this.projectRef(), ['query', a.id]);
    return undefined;
  }
  protected evidenceParams(ref: IncidentArtifactRef): Record<string, string> {
    return {
      environment: this.environment(),
      ...(ref.kind === 'query' && ref.artifact
        ? { env: this.environment() }
        : {}),
    };
  }
}

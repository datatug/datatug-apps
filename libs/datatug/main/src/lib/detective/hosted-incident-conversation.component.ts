import { AppliedEvidenceSelectorComponent } from '../evidence/applied-evidence-selector.component';
import type { AppliedEvidenceChoice } from '../evidence/applied-evidence';
import type { HostedCriterionAction } from './hosted-linkage.models';
import type { IncidentResolutionCriterion } from '../incidents/models';
import {
  validateHostedCriterionSuccess,
  validateHostedCriterionView,
  validateHostedCriterionEvent,
} from './hosted-criterion-contract';
import { addIcons } from 'ionicons';
import {
  refreshOutline,
  optionsOutline,
  checkmarkOutline,
  closeOutline,
} from 'ionicons/icons';
import { useNativeRunLifetime } from '../evidence/native-run-lifetime';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RetainedEvidenceViewerComponent } from '../evidence/retained-evidence-viewer.component';
import {
  decodeEvidenceArtifactRef,
  type ArtifactRef,
} from '@sneat/datatug-semantic';
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
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonTextarea,
} from '@ionic/angular';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
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
import { HostedIncidentView } from './hosted-linkage.models';
import { CheckDefinition } from './models';

import {
  INCIDENT_CHARACTERS,
  admittedMessagePresentation,
  incidentCharacterLabel,
  isIncidentNotePresentation,
  isPendingIncidentOperation,
  type PendingIncidentOperation,
  type PendingCriterion,
} from './incident-message-presentation';
import type { IncidentCharacterID } from '../incidents/models';
import type { IncidentMessagePresentationCapability } from './hosted-linkage.models';

type CloudContext = Extract<DetectiveRequestContext, { kind: 'cloud' }>;

/** A hosted transport adapter for the existing Incident event stream, not an AI chat. */
@Component({
  selector: 'sneat-datatug-hosted-incident-conversation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .conversation-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .conversation-header h2 {
      margin: 0;
    }
    .criterion {
      margin-block: 1rem;
      border-top: 1px solid var(--ion-color-light-shade);
      padding-top: 0.5rem;
    }
    .criterion-details {
      overflow-wrap: anywhere;
    }
    @media (max-width: 480px) {
      .header-action-label {
        display: none;
      }
    }
    .character-choice {
      --min-height: 2.75rem;
    }
    .character-choice ion-select {
      padding-block: 0.25rem;
    }
  `,
  imports: [
    AppliedEvidenceSelectorComponent,
    IonIcon,
    IonInput,
    RetainedEvidenceViewerComponent,
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
      <header class="conversation-header">
        <h2>Conversation</h2>
        <div>
          <ion-button
            size="small"
            fill="clear"
            title="Refresh conversation"
            aria-label="Refresh conversation"
            (click)="refresh()"
            [disabled]="loading() || sending()"
            ><ion-icon name="refresh-outline" /><span
              class="header-action-label"
              >Refresh conversation</span
            ></ion-button
          >
          <ion-button
            size="small"
            fill="clear"
            title="Resolution criterion"
            aria-label="Resolution criterion"
            (click)="criterionOpen.set(!criterionOpen())"
            ><ion-icon name="options-outline" /><span
              class="header-action-label"
              >Resolution criterion</span
            ></ion-button
          >
        </div>
      </header>
      @if (criterionOpen() || criterion()) {
        <section class="criterion" aria-label="Resolution criterion">
          <h3>Resolution criterion</h3>
          @if (criterion(); as c) {
            <p>
              {{ c.finalized ? 'Finalized' : 'Draft saved' }} · criterion
              {{ c.version }} · {{ c.checkID }} · Check version
              {{ c.checkVersion }} · maximum age {{ c.maxAgeSeconds }} seconds
            </p>
            <details class="criterion-details">
              <summary>Selected scope and definition</summary>
              <p>
                {{ c.scope.project.storeId }}/{{ c.scope.project.projectId }} ·
                {{ c.scope.project.environment }} · {{ c.scope.sourceID }} ·
                {{ c.scope.generation }}
              </p>
              <p>
                Session {{ c.scope.sessionRef }} · Bag {{ c.scope.bagID }} ·
                {{ c.scope.appliedManifestRef }}
              </p>
              @for (item of affectedInputs(c); track item) {
                <p>{{ item }}</p>
              }
              <p>Definition digest {{ c.definitionDigest }}</p>
            </details>
            @if (c.finalized) {
              <ion-button
                fill="clear"
                [routerLink]="savedCheckHref(c)"
                [queryParams]="{ environment: environment() }"
                >Open saved Check</ion-button
              >
              <p>
                On the Check page, select this Incident and the same existing
                applied context, then use Run.
              </p>
            } @else if (canWrite()) {
              <ion-button
                size="small"
                [disabled]="mutationBlocked()"
                (click)="finalizeReview.set(true)"
                >Review finalization</ion-button
              >
              @if (finalizeReview()) {
                <p role="alert">
                  Finalize this exact draft before its first matching run. Its
                  criterion, definition and selected scope become immutable.
                </p>
                <ion-button
                  size="small"
                  [disabled]="mutationBlocked()"
                  (click)="finalizeCriterion()"
                  ><ion-icon name="checkmark-outline" slot="start" />Confirm
                  finalization</ion-button
                >
                <ion-button
                  size="small"
                  fill="clear"
                  [disabled]="sending()"
                  (click)="finalizeReview.set(false)"
                  >Cancel</ion-button
                >
              }
            }
          } @else {
            <p>
              No current criterion was returned. The server decides whether a
              new draft is allowed.
            </p>
          }
          @if (criterionOpen() && !criterion()?.finalized && canWrite()) {
            @if (!checks().length) {
              <p role="status">
                The saved Check catalogue is unavailable or empty.
              </p>
            }
            <ion-select
              label="Saved root Check"
              labelPlacement="start"
              aria-label="Criterion saved Check"
              [value]="criterionCheckID()"
              [disabled]="mutationBlocked()"
              (ionChange)="criterionCheckID.set($event.detail.value || '')"
            >
              <ion-select-option value="">Choose saved Check</ion-select-option>
              @for (check of checks(); track check.id) {
                <ion-select-option [value]="check.id"
                  >{{ check.title }} · catalogue version
                  {{ check.version }}</ion-select-option
                >
              }
            </ion-select>
            <ion-input
              label="Maximum age (seconds, 1–86400)"
              labelPlacement="start"
              aria-label="Criterion maximum age seconds"
              type="number"
              min="1"
              max="86400"
              [value]="criterionMaxAge()"
              [disabled]="mutationBlocked()"
              (ionInput)="
                criterionMaxAge.set(String($event.detail.value || ''))
              "
            />
            <sneat-datatug-applied-evidence-selector
              mode="inspect"
              [projectRef]="projectRef()"
              [actor]="context().principal || ''"
              [environment]="environment()"
              [incidentRef]="
                incidentRef().storeId + '/' + incidentRef().incidentId
              "
              [disabled]="mutationBlocked()"
              (selected)="criterionChoice.set($event)"
            />
            <ion-button
              size="small"
              [disabled]="
                mutationBlocked() || !criterionChoice() || !criterionCheckID()
              "
              (click)="saveCriterion()"
              >Save draft</ion-button
            >
            <ion-button
              size="small"
              fill="clear"
              [disabled]="sending()"
              (click)="criterionOpen.set(false); finalizeReview.set(false)"
              ><ion-icon name="close-outline" slot="start" />Cancel</ion-button
            >
          }
          @if (pending()?.action) {
            <p role="status">
              A criterion operation is retained. Review its history or retry the
              exact original intent.
            </p>
            <ion-button
              size="small"
              [disabled]="
                parentBusy() ||
                sending() ||
                loading() ||
                !ready() ||
                conflict() ||
                pendingReview()
              "
              (click)="retryCriterion()"
              >Retry criterion operation</ion-button
            >
          }
        </section>
      }
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
              @if (eventCriterion(event); as c) {
                <details class="criterion-details">
                  <summary>Criterion scope and definition</summary>
                  <p>
                    Session {{ c.scope.sessionRef }} · Bag {{ c.scope.bagID }} ·
                    {{ c.scope.appliedManifestRef }}
                  </p>
                  <p>{{ c.definitionDigest }}</p>
                </details>
              }
              @if (characterAttribution(event); as label) {
                <p>{{ label }} · fictional character</p>
              }
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
                } @else if (canOpenRetained(ref)) {
                  <ion-button fill="clear" (click)="openRetained(ref)"
                    >{{ evidenceLabel(ref) }} · Open actual retained
                    run</ion-button
                  >
                } @else {
                  <p>{{ evidenceLabel(ref) }} · No supported evidence view</p>
                }
              }
            </ion-label>
          </ion-item>
        }
      </ion-list>
      @if (retainedTarget(); as target) {
        <sneat-datatug-retained-evidence-viewer
          [projectRef]="projectRef()"
          [environment]="environment()"
          [target]="target"
        />
        <ion-button fill="clear" (click)="retainedTarget.set(undefined)"
          >Close retained evidence</ion-button
        >
      }
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
        @if (
          messagePresentation()?.status === 'available' ||
          pending()?.message?.presentation
        ) {
          <ion-item class="character-choice">
            <ion-select
              label="Speaker"
              labelPlacement="start"
              aria-label="Message speaker"
              interface="popover"
              [value]="character()"
              [disabled]="
                loading() ||
                !ready() ||
                sending() ||
                !!pending() ||
                invalidPending() ||
                messagePresentation()?.status !== 'available'
              "
              (ionChange)="setCharacter($event.detail.value)"
            >
              <ion-select-option value="">Me</ion-select-option>
              @for (id of characters; track id) {
                <ion-select-option [value]="id"
                  >{{ characterLabel(id) }} · fictional
                  character</ion-select-option
                >
              }
            </ion-select>
          </ion-item>
        } @else if (messagePresentation()?.status === 'unavailable') {
          <p role="status">
            Fictional speakers are unavailable. You can post as yourself.
          </p>
        }
        @if (invalidPending()) {
          <p role="alert">
            A saved message attempt cannot be safely retried. Review the
            conversation and explicitly abandon it before posting a new message.
          </p>
        }
        <ion-item>
          <ion-label position="stacked">Message</ion-label>
          <ion-textarea
            aria-label="Incident message"
            [value]="body()"
            [disabled]="sending() || !!pending() || invalidPending()"
            (ionInput)="body.set($event.detail.value || '')"
          />
        </ion-item>
        <ion-item>
          <ion-label>Message type</ion-label>
          <ion-select
            aria-label="Message type"
            [value]="assertion()"
            [disabled]="sending() || !!pending() || invalidPending()"
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
              [disabled]="sending() || !!pending() || invalidPending()"
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
        @if ((pending() || invalidPending()) && !conflict()) {
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
            parentBusy() ||
            !!pending()?.action ||
            !ready() ||
            loading() ||
            sending() ||
            conflict() ||
            pendingReview() ||
            invalidPending() ||
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
  protected readonly String = String;
  readonly parentBusy = input(false);
  readonly mutationBusy = output<boolean>();
  private readonly announceBusy = effect(() =>
    this.mutationBusy.emit(
      this.sending() || !!this.pending() || this.invalidPending(),
    ),
  );
  protected readonly criterion = signal<
    IncidentResolutionCriterion | undefined
  >(undefined);
  protected readonly criterionOpen = signal(false);
  protected readonly finalizeReview = signal(false);
  protected readonly criterionCheckID = signal('');
  protected readonly criterionMaxAge = signal('3600');
  protected readonly criterionChoice = signal<
    AppliedEvidenceChoice | undefined
  >(undefined);
  protected readonly mutationBlocked = computed(
    () =>
      this.parentBusy() ||
      !this.canWrite() ||
      !this.ready() ||
      this.loading() ||
      this.sending() ||
      !!this.pending() ||
      this.invalidPending(),
  );
  readonly context = input.required<CloudContext>();
  protected readonly retainedTarget = signal<ArtifactRef | undefined>(
    undefined,
  );
  protected canOpenRetained(ref: IncidentArtifactRef): boolean {
    try {
      const value = decodeEvidenceArtifactRef(ref);
      const c = this.context();
      return value.kind === 'execution'
        ? value.execution.storeId === c.storage &&
            value.execution.projectId === c.project
        : value.kind === 'check-run' &&
            value.checkRun.storeId === c.storage &&
            value.checkRun.projectId === c.project &&
            value.checkRun.environment === this.environment();
    } catch {
      return false;
    }
  }
  protected openRetained(ref: IncidentArtifactRef): void {
    if (this.canOpenRetained(ref))
      this.retainedTarget.set(decodeEvidenceArtifactRef(ref));
  }

  readonly environment = input.required<string>();
  readonly incidentRef = input.required<IncidentRef>();
  readonly canWrite = input(false);
  readonly checks = input<CheckDefinition[]>([]);
  readonly incidentUpdated = output<HostedIncidentView>();
  private readonly client = inject(DetectiveClientService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly nativeLifetime = useNativeRunLifetime();
  constructor() {
    addIcons({
      refreshOutline,
      optionsOutline,
      checkmarkOutline,
      closeOutline,
    });
    this.nativeLifetime.changes$.pipe(takeUntilDestroyed()).subscribe(() => {
      ++this.requestGeneration;
      this.criterion.set(undefined);
      this.criterionOpen.set(false);
      this.finalizeReview.set(false);
      this.criterionChoice.set(undefined);
      this.events.set([]);
      this.retainedTarget.set(undefined);
      this.ready.set(false);
      this.body.set('');
      this.pending.set(undefined);
      this.messagePresentation.set(undefined);
      this.character.set('');
      this.invalidPending.set(false);
      this.sending.set(false);
      this.loading.set(false);
    });
  }
  protected readonly events = signal<IncidentEvent[]>([]);
  protected readonly loading = signal(false);
  protected readonly sending = signal(false);
  protected readonly ready = signal(false);
  protected readonly readError = signal('');
  protected readonly sendError = signal('');
  readonly characters = INCIDENT_CHARACTERS;
  protected readonly characterLabel = incidentCharacterLabel;
  protected readonly character = signal<IncidentCharacterID | ''>('');
  protected readonly messagePresentation = signal<
    IncidentMessagePresentationCapability | undefined
  >(undefined);
  protected readonly invalidPending = signal(false);
  protected setCharacter(value: unknown): void {
    if (
      this.pending() ||
      this.invalidPending() ||
      this.sending() ||
      !this.ready() ||
      this.loading() ||
      this.messagePresentation()?.status !== 'available'
    )
      return;
    if (value === '' || INCIDENT_CHARACTERS.some((id) => id === value))
      this.character.set(value as IncidentCharacterID | '');
  }
  protected characterAttribution(event: IncidentEvent): string | undefined {
    if (
      event.type !== 'note.added' ||
      !event.payload ||
      typeof event.payload !== 'object' ||
      !('presentation' in event.payload) ||
      !isIncidentNotePresentation(event.payload.presentation)
    )
      return undefined;
    return incidentCharacterLabel(event.payload.presentation.characterId);
  }
  protected readonly body = signal('');
  protected readonly assertion = signal<
    'claim' | 'question' | 'hypothesis' | 'observation'
  >('claim');
  protected readonly checkID = signal('');
  protected readonly pending = signal<PendingIncidentOperation | undefined>(
    undefined,
  );
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
    this.criterion.set(undefined);
    this.criterionOpen.set(false);
    this.finalizeReview.set(false);
    this.criterionChoice.set(undefined);
    this.criterionCheckID.set('');
    this.events.set([]);
    this.retainedTarget.set(undefined);
    this.ready.set(false);
    this.body.set('');
    this.pending.set(undefined);
    this.messagePresentation.set(undefined);
    this.character.set('');
    this.invalidPending.set(false);
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
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(this.storageKey(identity));
    } catch {
      /* Browser storage is optional for a fresh draft. */
    }
    try {
      if (raw && raw.length > 32768)
        throw new Error('Retained operation exceeds its bound.');
      const value: unknown = raw ? JSON.parse(raw) : undefined;
      if (isPendingIncidentOperation(value)) {
        this.pending.set(value);
        if (value.message) {
          this.body.set(value.message.body);
          this.character.set(value.message.presentation?.characterId || '');
          this.setAssertion(value.message.assertion || 'claim');
          this.checkID.set(
            value.message.refs?.find((ref) => ref.kind === 'check')?.artifact
              ?.id || '',
          );
        } else this.criterionOpen.set(true);
      } else if (raw !== null) this.invalidPending.set(true);
    } catch {
      this.invalidPending.set(true);
      /* Unreadable or invalid storage is never silently rewritten into a new attempt. */
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
    this.messagePresentation.set(undefined);
    this.readError.set('');
    this.ready.set(false);
    if (reset) {
      this.retainedTarget.set(undefined);
      this.events.set([]);
      this.afterSeq.set(0);
      this.hasMore.set(false);
    }
    try {
      const lifetime = this.nativeLifetime.capture(
        this.projectRef(),
        context.principal,
      );
      // Re-admit the Incident and rights on every page, not just the original route load.
      const detail = await firstValueFrom(
        this.client
          .projectIncident(
            context,
            environment,
            `${ref.storeId}/${ref.incidentId}`,
          )
          .pipe(takeUntil(fromEvent(lifetime.signal, 'abort'))),
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
      validateHostedCriterionView(
        detail.incident,
        `${ref.storeId}/${ref.incidentId}`,
        context,
        environment,
      );
      const after = this.afterSeq();
      const page = await firstValueFrom(
        this.client
          .incidentEvents(
            context,
            environment,
            `${ref.storeId}/${ref.incidentId}`,
            after,
          )
          .pipe(takeUntil(fromEvent(lifetime.signal, 'abort'))),
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
        validateHostedCriterionEvent(
          event,
          `${ref.storeId}/${ref.incidentId}`,
          context,
          environment,
        );
        if (
          event.type === 'note.added' ||
          event.type === 'incident.criterion-set'
        )
          merged.set(event.id, event);
      }
      this.events.set([...merged.values()].sort((a, b) => a.seq - b.seq));
      this.afterSeq.set(page.nextAfterSeq);
      this.hasMore.set(page.hasMore);
      if (detail.incident.lastSeq >= this.lastSeq()) {
        this.criterion.set(detail.incident.resolutionCriterion);
        this.incidentUpdated.emit(detail.incident);
      }
      this.lastSeq.set(
        Math.max(this.lastSeq(), detail.incident.lastSeq, page.nextAfterSeq),
      );
      const capability = admittedMessagePresentation(page.messagePresentation);
      this.messagePresentation.set(capability || { status: 'unavailable' });
      if (!this.pending() && capability?.status !== 'available')
        this.character.set('');
      this.ready.set(true);
      return true;
    } catch (error) {
      if (this.current(identity, generation)) {
        this.criterion.set(undefined);
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
    if (
      (!this.pending() && !this.invalidPending()) ||
      this.conflict() ||
      this.loading() ||
      this.sending()
    )
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
      (!this.pending() && !this.invalidPending()) ||
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
    try {
      sessionStorage.removeItem(this.storageKey());
      if (sessionStorage.getItem(this.storageKey()) !== null)
        throw new Error('Retry storage could not be cleared.');
    } catch {
      this.sendError.set('Could not retire the retained retry.');
      return;
    }
    const wasCriterion = !!this.pending()?.action;
    this.pending.set(undefined);
    this.invalidPending.set(false);
    if (!wasCriterion) this.character.set('');
    this.pendingReview.set(false);
    if (!wasCriterion) this.checkID.set('');
    this.sendError.set('');
    this.recoveryNotice.set(
      wasCriterion
        ? 'Original criterion retry abandoned locally. The original operation may already exist on the server. Review the current criterion before saving a new operation.'
        : 'Original retry abandoned locally. Saved Check references were removed. Review the text before posting a new message; the original may already exist.',
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
    if (this.pending()?.action) {
      this.conflict.set(false);
      this.pendingReview.set(true);
      this.sendError.set(
        'Review the current criterion and history, then explicitly abandon the retained local attempt before creating another operation.',
      );
      return;
    }
    this.pending.set(undefined);
    this.character.set('');
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
      this.parentBusy() ||
      this.pending()?.action ||
      this.invalidPending() ||
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
    let lifetime: ReturnType<typeof this.nativeLifetime.capture>;
    try {
      lifetime = this.nativeLifetime.capture(
        this.projectRef(),
        context.principal,
      );
    } catch (error) {
      this.sendError.set(detectiveErrorMessage(error, true));
      return;
    }
    let pending = this.pending();
    if (!pending) {
      if (
        this.character() &&
        this.messagePresentation()?.status !== 'available'
      ) {
        this.sendError.set(
          'Choose Me or refresh current fictional speaker availability.',
        );
        return;
      }
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
          ...(this.character()
            ? {
                presentation: {
                  kind: 'demo-character' as const,
                  characterId: this.character() as IncidentCharacterID,
                },
              }
            : {}),
          ...(refs.length ? { refs } : {}),
        },
      };
      this.mutationBusy.emit(true);
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
    await this.dispatchPending(pending, identity, context, lifetime);
  }
  private async dispatchPending(
    pending: PendingIncidentOperation,
    identity: string,
    context: CloudContext,
    lifetime: ReturnType<typeof this.nativeLifetime.capture>,
  ): Promise<void> {
    const generation = this.requestGeneration;
    const ref = this.incidentRef(),
      environment = this.environment();
    this.sending.set(true);
    this.sendError.set('');
    this.posted.set(false);
    this.recoveryNotice.set('');
    try {
      const result = await firstValueFrom(
        this.client.incidentAction(
          context,
          pending.action || {
            type: 'append-message',
            incidentRef: `${ref.storeId}/${ref.incidentId}`,
            environment,
            expectedSeq: pending.expectedSeq,
            message: pending.message,
          },
          pending.operationId,
          lifetime.signal,
        ),
      );
      if (!this.current(identity, generation) || lifetime.signal.aborted)
        return;
      if (
        !result.event ||
        result.event.incident.storeId !== ref.storeId ||
        result.event.incident.incidentId !== ref.incidentId ||
        result.event.type !==
          (pending.action ? 'incident.criterion-set' : 'note.added') ||
        result.event.actor.kind !== 'human' ||
        result.event.actor.id !== context.principal ||
        result.event.actor.via !== 'web' ||
        !Number.isSafeInteger(result.event.seq) ||
        !Number.isSafeInteger(result.incident.lastSeq) ||
        result.incident.ref.storeId !== ref.storeId ||
        result.incident.ref.incidentId !== ref.incidentId ||
        result.incident.lastSeq < result.event.seq
      )
        throw new Error(
          'The server did not confirm the saved message. Retry to retrieve its receipt.',
        );
      if (pending.action) {
        if (result.receipt !== pending.operationId)
          throw new Error('The exact criterion receipt is unavailable.');
        validateHostedCriterionSuccess(result, pending.action, context);
      }
      this.pending.set(undefined);
      if (!pending.action) {
        this.body.set('');
        this.character.set('');
        this.checkID.set('');
        this.posted.set(true);
      } else {
        if (result.incident.lastSeq >= this.lastSeq())
          this.criterion.set(result.incident.resolutionCriterion);
        this.finalizeReview.set(false);
        this.criterionOpen.set(false);
      }
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
      if (!this.current(identity, generation) || lifetime.signal.aborted)
        return;
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
      if (this.current(identity, generation)) this.sending.set(false);
    }
  }
  protected eventCriterion(
    event: IncidentEvent,
  ): IncidentResolutionCriterion | undefined {
    return event.type === 'incident.criterion-set' && 'checkID' in event.payload
      ? event.payload
      : undefined;
  }
  protected affectedInputs(c: IncidentResolutionCriterion): string[] {
    return Object.entries(c.scope.affectedInputs).map(
      ([name, value]) => `${name}: ${value.type} · ${String(value.value)}`,
    );
  }
  protected savedCheckHref(c: IncidentResolutionCriterion): string {
    return projectPageHref(this.projectRef(), ['checks', c.checkID]);
  }
  protected async saveCriterion(): Promise<void> {
    if (this.mutationBlocked() || this.criterion()?.finalized) return;
    const check = this.checks().find((c) => c.id === this.criterionCheckID()),
      choice = this.criterionChoice(),
      age = Number(this.criterionMaxAge());
    if (
      !check ||
      !choice ||
      !Number.isSafeInteger(age) ||
      age < 1 ||
      age > 86400
    ) {
      this.sendError.set(
        'Choose an available saved Check, existing applied revision and a maximum age from 1 to 86400 seconds.',
      );
      return;
    }
    await this.prepareCriterion({
      type: 'criterion-draft',
      incidentRef: `${this.incidentRef().storeId}/${this.incidentRef().incidentId}`,
      environment: this.environment(),
      expectedSeq: this.lastSeq(),
      criterion: {
        version: (this.criterion()?.version || 0) + 1,
        checkID: check.id,
        maxAgeSeconds: age,
      },
      evidence: structuredClone(choice.evidence),
    });
  }
  protected async finalizeCriterion(): Promise<void> {
    const criterion = this.criterion();
    if (
      this.mutationBlocked() ||
      !this.finalizeReview() ||
      !criterion ||
      criterion.finalized
    )
      return;
    await this.prepareCriterion({
      type: 'criterion-finalize',
      incidentRef: `${this.incidentRef().storeId}/${this.incidentRef().incidentId}`,
      environment: this.environment(),
      expectedSeq: this.lastSeq(),
      criterionVersion: criterion.version,
    });
  }
  private async prepareCriterion(action: HostedCriterionAction): Promise<void> {
    const pending: PendingCriterion = {
      operationId: detectiveOperationId(),
      expectedSeq: action.expectedSeq,
      action: structuredClone(action),
    };
    if (!isPendingIncidentOperation(pending)) {
      this.sendError.set('The selected criterion intent is invalid.');
      return;
    }
    try {
      const key = this.storageKey(),
        prior = sessionStorage.getItem(key);
      if (prior !== null) {
        this.invalidPending.set(true);
        throw new Error(
          'An existing saved operation must be reviewed before saving a criterion.',
        );
      }
      const bytes = JSON.stringify(pending);
      this.mutationBusy.emit(true);
      this.pending.set(pending);
      sessionStorage.setItem(key, bytes);
      if (sessionStorage.getItem(key) !== bytes)
        throw new Error(
          'Browser storage did not retain the exact criterion intent.',
        );
      this.mutationBusy.emit(true);
      this.pending.set(pending);
    } catch (error) {
      this.sendError.set(
        error instanceof Error
          ? error.message
          : 'Durable criterion retry storage is unavailable.',
      );
      return;
    }
    await this.retryCriterion();
  }
  protected async retryCriterion(): Promise<void> {
    const pending = this.pending(),
      context = this.context();
    if (
      !pending?.action ||
      this.parentBusy() ||
      !this.canWrite() ||
      !this.ready() ||
      this.loading() ||
      this.sending() ||
      this.conflict() ||
      this.pendingReview() ||
      this.invalidPending()
    )
      return;
    if (
      pending.action.incidentRef !==
        `${this.incidentRef().storeId}/${this.incidentRef().incidentId}` ||
      pending.action.environment !== this.environment()
    ) {
      this.invalidPending.set(true);
      return;
    }
    try {
      if (sessionStorage.getItem(this.storageKey()) !== JSON.stringify(pending))
        throw new Error(
          'The saved criterion intent is unavailable or changed.',
        );
      const lifetime = this.nativeLifetime.capture(
        this.projectRef(),
        context.principal,
      );
      await this.dispatchPending(pending, this.identity(), context, lifetime);
    } catch (error) {
      this.sendError.set(detectiveErrorMessage(error, true));
    }
  }
  protected readonly projectRef = computed<IProjectRef>(() => {
    const c = this.context();
    return { storeId: c.storage, spaceID: c.spaceID, projectId: c.project };
  });
  protected evidenceLabel(ref: IncidentArtifactRef): string {
    return ref.kind === 'check-run'
      ? `Check run: ${ref.checkRun?.checkId || 'unavailable'} · version ${ref.checkRun?.checkVersion || 'unavailable'} · ${ref.checkRun?.runId || 'unavailable'}`
      : ref.kind === 'check'
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

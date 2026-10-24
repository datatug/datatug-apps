import { WorkApiService } from '../work/work-api.service';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonCheckbox,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonIcon,
} from '@ionic/angular';
import { refreshOutline, checkmarkOutline, timeOutline } from 'ionicons/icons';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { type ArtifactRef } from '@sneat/datatug-semantic';
import type { IProjectRef } from '../core/project-context';
import type {
  IncidentResolution,
  IncidentResolutionCriterion,
} from '../incidents/models';
import {
  resolutionInstant,
  sameResolutionValue,
} from '../incidents/resolution-proof';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import type { RetainedCheckView } from '../evidence/retained-open-contract';
import { useNativeRunLifetime } from '../evidence/native-run-lifetime';
import {
  DetectiveClientService,
  type DetectiveRequestContext,
} from './detective-client.service';
import type { CheckRun } from './models';
import type { HostedResolveAction } from './hosted-linkage.models';
import {
  INCIDENT_RECOVERY_ADAPTERS,
  type IncidentRecoveryCandidate,
} from './incident-recovery-adapter';

type Cloud = Extract<DetectiveRequestContext, { kind: 'cloud' }>;
type RunRef = Extract<ArtifactRef, { kind: 'check-run' }>['checkRun'];
/** Generic Incident proof selection. Source protocols and final atomic admission remain with owners. */
@Component({
  selector: 'sneat-incident-resolve-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonCheckbox,
    IonButton,
    IonSelect,
    IonSelectOption,
    IonTextarea,
    IonIcon,
  ],
  template: `@if (resolved(); as value) {
      <section aria-label="Confirmed Incident resolution">
        <h4>Resolved by human review</h4>
        <p>{{ value.humanNote }}</p>
        <p>
          Criterion {{ value.proof.criterionVersion }} · evaluated
          <time [attr.datetime]="value.proof.evaluatedAt">{{
            value.proof.evaluatedAt
          }}</time>
        </p>
        <div class="resolution-actions">
          <ion-button
            fill="clear"
            (click)="
              openEvidence.emit({
                kind: 'check-run',
                checkRun: value.proof.run,
              })
            "
            >Open retained Check run</ion-button
          >
          @for (ref of value.proof.recoveryRefs; track $index) {
            <ion-button fill="clear" (click)="openEvidence.emit(ref)"
              >Open recovery evidence</ion-button
            >
          }
        </div>
      </section>
    } @else if (criterion()?.finalized && incidentStatus() !== 'resolved') {
      <section aria-label="Human Incident resolution">
        <header>
          <h4>Resolution evidence</h4>
          <div class="resolution-actions">
            <ion-button
              fill="clear"
              [disabled]="busy() || disabled() || !canWrite()"
              (click)="loadRuns()"
              ><ion-icon [icon]="refreshIcon" aria-hidden="true" />Load retained
              runs</ion-button
            >
            <ion-button
              fill="clear"
              [disabled]="busy() || disabled() || !canWrite() || !adapter()"
              (click)="loadRecoveries()"
              ><ion-icon
                [icon]="activityIcon"
                aria-hidden="true"
              />Activity</ion-button
            >
          </div>
        </header>
        <p>
          Choose a retained Check run and a recovery receipt, then add a note
          and review. The server checks the final evidence and current access
          when you confirm.
        </p>
        @if (!adapter()) {
          <p role="status">Recovery evidence is unavailable for this source.</p>
        }
        @if (!canWrite()) {
          <p role="status">
            Current write access is required to resolve this Incident.
          </p>
        }
        @if (busy()) {
          <p role="status">Checking current evidence access…</p>
        }
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (notice()) {
          <p role="status">{{ notice() }}</p>
        }
        @if (runsLoaded()) {
          <ion-select
            label="Retained Check run"
            [value]="selectedRun()?.run.id || ''"
            [disabled]="busy() || disabled()"
            (ionChange)="chooseRun($event.detail.value)"
          >
            <ion-select-option value="">Choose run</ion-select-option>
            @for (run of runs(); track run.id) {
              <ion-select-option [value]="run.id"
                >{{ run.definition.title || run.checkId }} · {{ run.outcome }} ·
                {{ run.startedAt }} · #{{ run.id.slice(-8) }}</ion-select-option
              >
            }
          </ion-select>
          @if (!runs().length) {
            <p>No retained runs for this Check and version were returned.</p>
          }
          @if (nextCursor()) {
            <ion-button
              fill="clear"
              (click)="loadRuns(true)"
              [disabled]="busy() || disabled()"
              >Load older runs</ion-button
            >
          }
        }
        @if (recoveriesLoaded()) {
          <ion-select
            label="Recovery evidence"
            [value]="selectedRecovery()?.reference?.operationId || ''"
            [disabled]="busy() || disabled()"
            (ionChange)="chooseRecovery($event.detail.value)"
          >
            <ion-select-option value=""
              >Choose source operation</ion-select-option
            >
            @for (item of recoveries(); track item.reference.operationId) {
              <ion-select-option
                [value]="item.reference.operationId"
                [disabled]="!item.eligible"
                >{{ item.label }} · {{ item.acceptedAt }} · #{{
                  item.reference.operationId.slice(-8)
                }}</ion-select-option
              >
            }
          </ion-select>
          @if (!recoveries().length) {
            <p>No source operations were returned.</p>
          }
          <details>
            <summary>Activity eligibility</summary>
            @for (item of recoveries(); track item.reference.operationId) {
              <p>
                {{ item.label }} · {{ item.reference.operationId }}
                @if (item.reason) {
                  · {{ item.reason }}
                }
              </p>
            }
          </details>
        }
        @if (selectedRun(); as held) {
          <p>
            {{ held.run.definition.title || held.run.checkId }} · version
            {{ held.run.definition.version }} · {{ held.run.outcome }} ·
            <time [attr.datetime]="held.run.startedAt">{{
              held.run.startedAt
            }}</time>
          </p>
          <ion-button fill="clear" (click)="openRun()"
            >Open retained Check run</ion-button
          >
        }
        @if (selectedRecovery(); as held) {
          <p>
            {{ held.label }} ·
            <time [attr.datetime]="held.acceptedAt">{{ held.acceptedAt }}</time>
          </p>
          <ion-button fill="clear" (click)="openRecovery()"
            >Open source receipt</ion-button
          >
        }
        @if (selectedRun()) {
          <details>
            <summary>Selected proof details</summary>
            <p>
              Run {{ selectedRun()?.run?.id }} · criterion
              {{ criterion()?.version }}
            </p>
            <p>Definition SHA-256 {{ criterion()?.definitionDigest }}</p>
            @if (selectedRecovery(); as held) {
              <p>
                Source operation {{ held.reference.operationId }} · generation
                {{ held.reference.result.generation }} · revision
                {{ held.reference.result.revision }}
              </p>
              <p>Request SHA-256 {{ held.reference.requestSHA256 }}</p>
            }
          </details>
        }
        @if (selectionReason()) {
          <p role="status">{{ selectionReason() }}</p>
        }
        @if (noteError()) {
          <p role="alert">{{ noteError() }}</p>
        }
        <ion-textarea
          label="Human resolution note (required)"
          [attr.aria-invalid]="!!noteError()"
          labelPlacement="stacked"
          [value]="humanNote()"
          [disabled]="busy() || disabled() || !canWrite()"
          (ionInput)="setNote($event.detail.value || '')"
        />
        @if (workItemId()) {
          @if (manualError()) {
            <p role="alert">{{ manualError() }}</p>
          } @else if (!manualReady()) {
            <p role="status">Loading Work closure criteria…</p>
          } @else if (!workCanResolve()) {
            <p role="status">
              Resolve is available to the accountable owner when this Incident
              is recovering. Open Work to review its status and ownership.
            </p>
          } @else if (manualCriteria()) {
            <h4>Work closure criteria</h4>
            <p style="white-space: pre-wrap">{{ manualCriteria() }}</p>
            <ion-checkbox
              [checked]="manualAccepted()"
              (ionChange)="
                manualAccepted.set($event.detail.checked); reviewing.set(false)
              "
              [disabled]="busy() || disabled()"
              >I verified these closure criteria</ion-checkbox
            >
          }
        }
        <div class="resolution-actions">
          @if (!reviewing()) {
            <ion-button
              fill="outline"
              (click)="review()"
              [disabled]="!canReview()"
              ><ion-icon [icon]="reviewIcon" aria-hidden="true" />Review
              Resolve</ion-button
            >
          } @else {
            <ion-button (click)="confirm()" [disabled]="!canReview()"
              >Resolve Incident</ion-button
            ><ion-button fill="clear" (click)="reviewing.set(false)"
              >Cancel</ion-button
            >
          }
        </div>
        @if (reviewing()) {
          <p>
            Resolve criterion {{ criterion()?.version }} using only the selected
            run and source receipt above. A passing run alone does not close an
            Incident.
          </p>
        }
      </section>
    }`,
  styles: `
    :host {
      display: block;
      color: var(--ion-text-color);
    }
    .resolution-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
    }
    section {
      margin-block: 0.75rem;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.25rem 0.75rem;
    }
    h4 {
      font-size: 1rem;
      margin: 0.25rem 0;
    }
    p,
    details {
      font-size: 0.85rem;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    ion-button {
      min-height: 44px;
      --color: var(--ion-text-color);
      font-size: 0.85rem;
    }
    ion-select,
    ion-textarea {
      margin-block: 0.25rem;
    }
    details {
      margin-block: 0.5rem;
    }
  `,
})
export class IncidentResolvePanelComponent {
  readonly context = input.required<Cloud>();
  readonly projectRef = input.required<IProjectRef>();
  readonly environment = input.required<string>();
  readonly incidentRef = input.required<string>();
  readonly expectedSeq = input.required<number>();
  readonly criterion = input<IncidentResolutionCriterion>();
  readonly resolved = input<IncidentResolution>();
  readonly workItemId = input<string>();
  readonly manualCriteria = signal('');
  readonly manualReady = signal(false);
  readonly workCanResolve = signal(false);
  readonly manualAccepted = signal(false);
  readonly manualVersion = signal(0);
  readonly manualError = signal('');
  readonly incidentStatus = input('');
  readonly canWrite = input(false);
  readonly disabled = input(false);
  readonly prepared = output<HostedResolveAction>();
  readonly openEvidence = output<ArtifactRef>();
  readonly refreshIcon = refreshOutline;
  readonly reviewIcon = checkmarkOutline;
  readonly activityIcon = timeOutline;
  private readonly client = inject(DetectiveClientService);
  private readonly injector = inject(Injector);
  private readonly adapters = inject(INCIDENT_RECOVERY_ADAPTERS);
  private readonly native = useNativeRunLifetime();
  private readonly destroy = inject(DestroyRef);
  private lifetime = new AbortController();
  private generation = 0;
  private readonly key = computed(() =>
    JSON.stringify([
      this.context(),
      this.projectRef(),
      this.environment(),
      this.incidentRef(),
      this.expectedSeq(),
      this.workItemId(),
      this.criterion(),
      this.canWrite(),
      this.disabled(),
    ]),
  );
  readonly adapter = computed(() => {
    const matches = this.adapters.filter(
      (item) => item.sourceId === this.criterion()?.scope.sourceID,
    );
    return matches.length === 1 ? matches[0] : undefined;
  });
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly runs = signal<readonly CheckRun[]>([]);
  readonly runsLoaded = signal(false);
  readonly nextCursor = signal<string | undefined>(undefined);
  readonly recoveries = signal<readonly IncidentRecoveryCandidate[]>([]);
  readonly recoveriesLoaded = signal(false);
  readonly selectedRun = signal<RetainedCheckView | undefined>(undefined);
  readonly selectedRecovery = signal<IncidentRecoveryCandidate | undefined>(
    undefined,
  );
  readonly humanNote = signal('');
  readonly reviewing = signal(false);
  readonly noteError = computed(() =>
    new TextEncoder().encode(this.humanNote()).length > 4000
      ? 'The note is too long. Shorten it before review.'
      : '',
  );
  readonly selectionReason = computed(() => this.reason());
  readonly canReview = computed(
    () =>
      !this.busy() &&
      !this.disabled() &&
      this.canWrite() &&
      !this.selectionReason() &&
      (!this.workItemId() ||
        (this.manualReady() &&
          this.workCanResolve() &&
          (!this.manualCriteria() || this.manualAccepted()))) &&
      !!this.humanNote().trim() &&
      new TextEncoder().encode(this.humanNote()).length <= 4000,
  );
  constructor() {
    effect(() => {
      this.key();
      untracked(() => this.clear());
    });
    this.native.changes$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clear();
      this.notice.set(
        'Evidence access or source context changed. Select current evidence again.',
      );
    });
    this.destroy.onDestroy(() => this.lifetime.abort());
  }
  private clear() {
    ++this.generation;
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.busy.set(false);
    this.error.set('');
    this.notice.set('');
    this.runs.set([]);
    this.runsLoaded.set(false);
    this.nextCursor.set(undefined);
    this.recoveries.set([]);
    this.recoveriesLoaded.set(false);
    this.selectedRun.set(undefined);
    this.selectedRecovery.set(undefined);
    this.humanNote.set('');
    this.reviewing.set(false);
    this.manualCriteria.set('');
    this.manualAccepted.set(false);
    this.manualReady.set(false);
    this.workCanResolve.set(false);
    this.manualVersion.set(0);
    this.manualError.set('');
    const id = this.workItemId(),
      context = this.context(),
      generation = this.generation;
    if (id)
      void this.injector
        .get(WorkApiService)
        .read(
          { spaceID: context.spaceID, projectID: context.project },
          id,
          this.lifetime.signal,
        )
        .then((detail) => {
          if (generation !== this.generation) return;
          this.manualCriteria.set(detail.item.criteria || '');
          this.manualVersion.set(detail.item.version);
          this.workCanResolve.set(
            detail.capabilities.transitions.includes('resolved'),
          );
          this.manualReady.set(true);
        })
        .catch(() => {
          if (generation === this.generation)
            this.manualError.set(
              'Work closure criteria are unavailable. Reload the Incident before resolving.',
            );
        });
  }
  private scope() {
    const actor = this.context().principal;
    if (!actor) throw new Error('Current account is unavailable.');
    return {
      projectRef: structuredClone(this.projectRef()),
      environment: this.environment(),
      actor,
    };
  }
  private currentCriterion(): IncidentResolutionCriterion {
    const criterion = this.criterion();
    if (!criterion) throw new Error('The criterion is unavailable.');
    return criterion;
  }
  private async read(work: (signal: AbortSignal) => Promise<void>) {
    if (
      this.busy() ||
      this.disabled() ||
      !this.canWrite() ||
      !this.criterion()?.finalized ||
      this.resolved()
    )
      return;
    const generation = this.generation,
      key = this.key(),
      source = this.currentCriterion().scope.sourceID;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const captured = this.native.capture(
        this.projectRef(),
        this.context().principal,
        { sourceId: source, environment: this.environment() },
      );
      const signal = AbortSignal.any([captured.signal, this.lifetime.signal]);
      await work(signal);
      if (signal.aborted) return;
    } catch {
      if (
        key === this.key() &&
        generation === this.generation &&
        !this.destroy.destroyed
      ) {
        this.clear();
        this.error.set(
          'Evidence is unavailable under the current account and source context. Refresh and select again.',
        );
      }
    } finally {
      if (
        key === this.key() &&
        generation === this.generation &&
        !this.destroy.destroyed
      )
        this.busy.set(false);
    }
  }
  private current(signal: AbortSignal, key: string, generation: number) {
    return (
      !signal.aborted &&
      !this.destroy.destroyed &&
      key === this.key() &&
      generation === this.generation
    );
  }
  async loadRuns(older = false) {
    await this.read(async (signal) => {
      const key = this.key(),
        generation = this.generation;
      const state = await firstValueFrom(
        this.client
          .state(this.context(), older ? this.nextCursor() : undefined)
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
      );
      if (!this.current(signal, key, generation)) return;
      if (!state.capabilities.canRead) throw new Error('Read denied');
      const c = this.currentCriterion();
      const values = state.runs.filter(
        (run) =>
          run.kind === 'check' &&
          run.checkId === c.checkID &&
          run.definition?.version === c.checkVersion &&
          run.environment === this.environment(),
      );
      this.runs.set([
        ...new Map(
          [...(older ? this.runs() : []), ...values].map((run) => [
            run.id,
            run,
          ]),
        ).values(),
      ]);
      this.runsLoaded.set(true);
      this.nextCursor.set(state.runsHasMore ? state.runsNextCursor : undefined);
    });
  }
  async loadRecoveries() {
    await this.read(async (signal) => {
      const key = this.key(),
        generation = this.generation,
        adapter = this.adapter();
      if (!adapter) throw new Error('Source unavailable');
      const values = await adapter.discover(
        this.scope(),
        this.currentCriterion(),
        signal,
      );
      if (this.current(signal, key, generation)) {
        this.recoveries.set(values);
        this.recoveriesLoaded.set(true);
      }
    });
  }
  private runRef(run: CheckRun): RunRef {
    return {
      storeId: this.projectRef().storeId,
      projectId: this.projectRef().projectId,
      environment: this.environment(),
      checkId: run.checkId,
      checkVersion: run.definition.version,
      runId: run.id,
    };
  }
  async chooseRun(id: string) {
    this.selectedRun.set(undefined);
    this.reviewing.set(false);
    const candidate = this.runs().find((run) => run.id === id);
    if (!candidate) return;
    await this.read(async (signal) => {
      const key = this.key(),
        generation = this.generation;
      const value = await this.injector
        .get(RetainedEvidenceApiService)
        .read(
          this.scope(),
          { kind: 'check-run', checkRun: this.runRef(candidate) },
          signal,
        );
      if (!('run' in value)) throw new Error('Retained Check unavailable');
      if (this.current(signal, key, generation)) this.selectedRun.set(value);
    });
  }
  async chooseRecovery(id: string) {
    this.selectedRecovery.set(undefined);
    this.reviewing.set(false);
    const candidate = this.recoveries().find(
      (item) => item.reference.operationId === id && item.eligible,
    );
    if (!candidate) return;
    await this.read(async (signal) => {
      const key = this.key(),
        generation = this.generation,
        adapter = this.adapter();
      if (!adapter) throw new Error('Source unavailable');
      const value = await adapter.open(
        this.scope(),
        this.currentCriterion(),
        candidate.reference,
        signal,
      );
      if (
        this.current(signal, key, generation) &&
        value.eligible &&
        sameResolutionValue(value.reference, candidate.reference)
      )
        this.selectedRecovery.set(value);
    });
  }
  private reason() {
    const c = this.criterion(),
      held = this.selectedRun(),
      recovery = this.selectedRecovery();
    if (!c?.finalized) return 'Finalize the resolution criterion first.';
    if (!held) return 'Choose an actual retained Check run.';
    const run = held.run;
    if (run.executionStatus !== 'completed' || run.outcome !== 'pass')
      return 'The selected retained run is not a completed pass. Source correction alone does not establish a passing run.';
    if (
      run.checkId !== c.checkID ||
      run.definition.version !== c.checkVersion ||
      run.environment !== this.environment() ||
      held.sourcePin.sourceId !== c.scope.sourceID ||
      held.sourcePin.environment !== this.environment() ||
      held.sourcePin.revision.generation !== c.scope.generation ||
      held.manifest.incidentRef !== this.incidentRef() ||
      held.manifest.ref !== c.scope.appliedManifestRef ||
      held.manifest.sessionId !== c.scope.sessionRef ||
      held.manifest.bagId !== c.scope.bagID ||
      !sameResolutionValue(held.manifest.inputs, c.scope.affectedInputs)
    )
      return 'The selected run does not match the finalized criterion and applied scope.';
    const started = resolutionInstant(run.startedAt),
      finalized = resolutionInstant(c.finalizedAt);
    if (started === undefined || finalized === undefined || started < finalized)
      return 'Choose a run evaluated after criterion finalization.';
    if (
      BigInt(Date.now()) * 1000000n - started >
      BigInt(c.maxAgeSeconds) * 1000000000n
    )
      return 'This run is too old. Open the saved Check and produce fresh retained evidence.';
    if (!recovery) return 'Choose an eligible source operation from Activity.';
    if (
      !recovery.eligible ||
      recovery.reference.sourceId !== c.scope.sourceID ||
      recovery.reference.result.generation !== c.scope.generation ||
      !sameResolutionValue(recovery.reference.result, {
        generation: held.sourcePin.revision.generation,
        revision: held.sourcePin.revision.revision,
        sha256: held.sourcePin.revision.sha256,
      })
    )
      return 'The retained run and selected recovery do not identify the same source revision.';
    return '';
  }
  setNote(value: string) {
    this.humanNote.set(value);
    this.reviewing.set(false);
  }
  review() {
    const reason = this.reason();
    if (reason) {
      this.notice.set(reason);
      return;
    }
    if (this.canReview()) this.reviewing.set(true);
  }
  confirm() {
    const reason = this.reason();
    if (!this.reviewing() || reason || !this.canReview()) {
      if (reason) this.notice.set(reason);
      return;
    }
    const run = this.selectedRun(),
      recovery = this.selectedRecovery();
    if (!run || !recovery) return;
    this.prepared.emit({
      type: 'resolve',
      incidentRef: this.incidentRef(),
      environment: this.environment(),
      expectedSeq: this.expectedSeq(),
      criterionVersion: this.currentCriterion().version,
      run: this.runRef(run.run),
      recovery: structuredClone(recovery.reference),
      humanNote: this.humanNote(),
      ...(this.workItemId()
        ? {
            criteriaAccepted: this.manualAccepted(),
            expectedWorkVersion: this.manualVersion(),
          }
        : {}),
    });
  }
  openRun() {
    const held = this.selectedRun();
    if (held)
      this.openEvidence.emit({
        kind: 'check-run',
        checkRun: this.runRef(held.run),
      });
  }
  openRecovery() {
    const held = this.selectedRecovery();
    if (held)
      this.openEvidence.emit({
        kind: 'source-operation',
        sourceOperation: held.reference,
      });
  }
}

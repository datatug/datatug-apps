import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonButton, IonButtons, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';
import {
  originalLogText,
  type OriginalRecord,
} from './original-evidence-contract';
import {
  decodeResult,
  type ArtifactRef,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import { IProjectRef } from '../core/project-context';
import { RetainedEvidenceApiService } from './retained-evidence-api.service';
import {
  RetainedCheckView,
  RetainedExecutionView,
} from './retained-open-contract';
import { RetainedSourceOperationView } from './source-operation-contract';
import { useNativeRunLifetime } from './native-run-lifetime';
import { HeldResultPresentationComponent } from '../board/ui/components/held-result-presentation/held-result-presentation.component';
import { ValidationRunResultsComponent } from '../detective/validation-run-results.component';
@Component({
  selector: 'sneat-datatug-retained-evidence-viewer',
  imports: [
    IonButton,
    IonButtons,
    IonIcon,
    HeldResultPresentationComponent,
    ValidationRunResultsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-label="Retained execution evidence">
    <header class="evidence-header">
      <h3>
        {{
          target()?.kind === 'source-operation'
            ? 'Source operation receipt'
            : 'Retained execution evidence'
        }}
      </h3>
      @if (error()) {
        <ion-buttons slot="end"
          ><ion-button
            size="small"
            title="Retry current evidence read"
            aria-label="Retry current evidence read"
            (click)="retry.update(increment)"
          >
            <ion-icon
              slot="start"
              name="refresh-outline"
              aria-hidden="true"
            /><span class="action-label">Retry read</span>
          </ion-button></ion-buttons
        >
      }
    </header>
    <p>
      @if (target()?.kind === 'source-operation') {
        Opens the original receipt after a current rights check. Opening makes
        no source change and does not prove recovery.
      } @else {
        Opens the original admitted run and selected audit records after a
        current rights check. Opening does not run a query or Check.
      }
    </p>
    @if (loading()) {
      <p role="status">Checking current evidence access…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (operation(); as data) {
      <section
        aria-label="Historical source operation"
        class="source-operation"
      >
        <p>
          <strong>{{ data.receipt.action }}</strong> ·
          {{
            data.receipt.outcome === 'already-applied'
              ? 'No new change'
              : 'Applied'
          }}
          ·
          <time [attr.datetime]="data.receipt.acceptedAt">{{
            data.receipt.acceptedAt
          }}</time>
        </p>
        <p>
          Actor {{ data.receipt.actorId }} · operation
          {{ data.receipt.operationId }}
        </p>
        <p>
          Generation {{ data.reference.result.generation }} · revision
          {{ data.reference.result.revision }}
        </p>
        @if (data.receipt.outcome === 'already-applied') {
          <p>No new processing attempt is established by this receipt.</p>
        }
        <details>
          <summary>Immutable receipt details</summary>
          <p>
            Source {{ data.reference.sourceId }} · SHA-256
            {{ data.reference.result.sha256 }}
          </p>
          <p>Request SHA-256 {{ data.reference.requestSHA256 }}</p>
          <p>
            Revision producer {{ data.receipt.revision.actorId }} · accepted
            {{ data.receipt.revision.acceptedAt }}
          </p>
          <p>
            Routing configuration {{ data.receipt.revision.configuration }} ·
            fixture business clock {{ data.receipt.revision.businessClock }}
          </p>
          @for (
            artifact of data.receipt.revision.artifacts;
            track artifact.id
          ) {
            <p>{{ artifact.id }} · SHA-256 {{ artifact.sha256 }}</p>
          }
        </details>
      </section>
    }
    @if (runEvidence(); as data) {
      <p>
        Original actor {{ data.manifest.actorId }} · Incident
        {{ data.manifest.incidentRef }} · Session
        {{ data.manifest.sessionId }} · Bag {{ data.manifest.bagId }} · selected
        revision {{ data.manifest.revisionId }}
      </p>
      <p>
        Source generation {{ data.sourcePin.revision.generation }} · source
        revision {{ data.sourcePin.revision.revision }} ·
        {{ data.sourcePin.environment }}
      </p>
      @if (check(); as value) {
        <sneat-validation-run-results [run]="value.run" />
      }
      @for (query of queries(); track query.result.execution?.executionId) {
        <h4>{{ query.queryTitle }}</h4>
        <p>
          Saved query {{ query.queryId }} · revision {{ query.queryRevision }} ·
          execution {{ query.result.execution?.executionId }}
        </p>
        @if (query.originalEvidence; as original) {
          <section aria-label="Original evidence" class="original-evidence">
            <header class="evidence-header">
              <h4>Original evidence</h4>
              <span class="evidence-state">{{
                original.status === 'available'
                  ? original.log.parseStatus
                  : 'Unavailable'
              }}</span>
            </header>
            @if (original.status === 'unavailable') {
              <p role="status">
                Original evidence unavailable: {{ original.reason }}. The
                authorized retained result remains below.
              </p>
            } @else {
              <p>
                Synthetic Shipping source · historical configuration
                {{ original.records[3].key.value }}
              </p>
              <p>
                Route candidates show actual validity intervals without a
                current-time status. Multiple candidates do not establish a
                unique causal route.
              </p>
              @for (
                record of original.records;
                track record.collection + ':' + record.key.value
              ) {
                <h5>{{ record.collection }} · {{ record.key.value }}</h5>
                <dl>
                  @for (field of facts(record); track field[0]) {
                    <dt>{{ field[0] }}</dt>
                    <dd
                      [class.route-validity]="
                        record.collection === 'routes' &&
                        field[0].startsWith('valid_')
                      "
                    >
                      {{ field[1].type === 'null' ? 'NULL' : field[1].value }}
                    </dd>
                  }
                </dl>
                <details>
                  <summary>
                    Complete original {{ record.collection }} record
                  </summary>
                  <dl>
                    @for (field of fields(record); track field[0]) {
                      <dt>{{ field[0] }}</dt>
                      <dd>
                        {{ field[1].type === 'null' ? 'NULL' : field[1].value }}
                      </dd>
                    }
                  </dl>
                </details>
              }
              @if (original.records.length === 4) {
                <p>No route candidates in this historical configuration.</p>
              }
              <details>
                <summary>Original log bytes and provenance</summary>
                <p>
                  {{ original.log.artifact }} · bytes [{{
                    original.log.byteStart
                  }}, {{ original.log.byteEnd }}) of
                  {{ original.log.artifactBytes }} · {{ original.log.parser }} /
                  {{ original.log.parseStatus }}
                </p>
                <p>
                  SHA256 <code>{{ original.log.artifactSHA256 }}</code>
                </p>
                <p>
                  Source reference <code>{{ original.log.sourceRef }}</code>
                </p>
                @if (logText(original.log); as raw) {
                  <pre aria-label="Original log text">{{ raw }}</pre>
                } @else {
                  <p role="status">
                    Original bytes are not valid UTF8 text. Exact bytes remain
                    available as base64 below.
                  </p>
                }
                <details>
                  <summary>Exact original bytes (base64)</summary>
                  <pre>{{ original.log.rawBase64 }}</pre>
                </details>
              </details>
            }
          </section>
        }
        <sneat-datatug-held-result-presentation
          [result]="query.result"
          defaultView="grid"
          [embedded]="true"
        />
      }
    }
  </section>`,
  styles: [
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      .evidence-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.25rem 0.75rem;
        background: var(--ion-color-light);
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--ion-color-light-shade);
      }
      .evidence-header h3,
      .evidence-header h4 {
        margin: 0;
      }
      .evidence-state {
        margin-inline-start: auto;
        color: var(--ion-color-medium);
        font-size: 0.875rem;
      }
      .evidence-header ion-buttons {
        margin-inline-start: auto;
      }
      .original-evidence {
        margin-block: 0.75rem;
      }
      h5 {
        margin-block: 0.75rem 0.25rem;
      }
      dl {
        display: grid;
        grid-template-columns: minmax(7rem, auto) 1fr;
        gap: 0.15rem 0.75rem;
        margin-block: 0.25rem 0.5rem;
      }
      .source-operation {
        color: var(--ion-text-color);
        overflow-wrap: anywhere;
        font-size: 0.85rem;
      }
      .source-operation p {
        margin-block: 0.35rem;
      }
      .route-validity {
        color: var(--ion-color-medium-shade);
      }
      dt {
        color: var(--ion-color-medium);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      pre,
      code {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      details {
        margin-block: 0.5rem;
      }
      @container (max-width: 26rem) {
        .action-label {
          display: none;
        }
        dl {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class RetainedEvidenceViewerComponent {
  readonly projectRef = input<IProjectRef>();
  readonly environment = input('');
  readonly target = input<ArtifactRef>();
  readonly selector = input<RowEvidenceSelector>();
  readonly heldResult = input<unknown>();
  protected readonly retry = signal(0);
  protected readonly increment = (value: number) => value + 1;
  private readonly api = inject(RetainedEvidenceApiService);
  private readonly native = useNativeRunLifetime();
  private readonly destroy = inject(DestroyRef);
  private readonly held = signal<
    | {
        key: string;
        value:
          | RetainedExecutionView
          | RetainedCheckView
          | RetainedSourceOperationView;
      }
    | undefined
  >(undefined);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private readonly key = computed(() =>
    JSON.stringify([
      this.projectRef(),
      this.environment(),
      this.target(),
      this.selector(),
      this.heldResult() &&
      typeof this.heldResult() === 'object' &&
      'execution' in (this.heldResult() as object)
        ? (this.heldResult() as { execution?: unknown }).execution
        : undefined,
    ]),
  );
  protected readonly current = computed(() =>
    this.held()?.key === this.key() ? this.held()?.value : undefined,
  );
  protected readonly operation = computed(() => {
    const value = this.current();
    return value && 'receipt' in value ? value : undefined;
  });
  protected readonly runEvidence = computed(() => {
    const value = this.current();
    return value && !('receipt' in value) ? value : undefined;
  });
  protected readonly check = computed(() => {
    const value = this.runEvidence();
    return value && 'run' in value ? value : undefined;
  });
  protected readonly queries = computed(() => {
    const value = this.runEvidence();
    return !value ? [] : 'run' in value ? value.results : [value];
  });
  protected readonly logText = originalLogText;
  protected readonly facts = (record: OriginalRecord) => {
    const names: Record<string, readonly string[]> = {
      events: ['kind', 'occurred_at'],
      attempts: ['state', 'attempt_no', 'config_revision'],
      requests: ['order_id', 'shipper_id'],
      configurations: ['published_at'],
      routes: ['partner_id', 'valid_from', 'valid_until'],
      partners: ['enabled'],
    };
    return Object.entries(record.fields).filter(([name]) =>
      names[record.collection]?.includes(name),
    );
  };
  protected readonly fields = (record: OriginalRecord) =>
    Object.entries(record.fields);
  constructor() {
    addIcons({ refreshOutline });
    this.native.changes$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.held.set(undefined);
      this.loading.set(false);
      this.error.set(
        'Current execution context changed. Choose the retained evidence again.',
      );
    });
    effect((onCleanup) => {
      const key = this.key(),
        ref = this.projectRef(),
        environment = this.environment(),
        target = this.target(),
        selector = this.selector(),
        result = this.heldResult();
      this.retry();
      this.held.set(undefined);
      this.error.set('');
      this.loading.set(false);
      if (!ref || !environment || (!target && !selector)) return;
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      let actor: string, signal: AbortSignal;
      try {
        // Historical retained evidence is immutable. Keep only current
        // actor/project lifecycle fences here; source publication and reset
        // invalidate current held results, not an authorized cold-open.
        const current = this.native.capture(
          ref,
          undefined,
          target?.kind === 'source-operation'
            ? { sourceId: 'shipping-working-copy', environment }
            : undefined,
        );
        actor = current.actor;
        signal = AbortSignal.any([controller.signal, current.signal]);
      } catch (error) {
        this.error.set(
          error instanceof Error
            ? error.message
            : 'Current evidence scope is unavailable.',
        );
        return;
      }
      this.loading.set(true);
      const scope = { projectRef: ref, environment, actor };
      const request = Promise.resolve().then(() =>
        selector && result
          ? this.api.openRow(scope, decodeResult(result), selector, signal)
          : target
            ? this.api.read(scope, target, signal)
            : Promise.reject(
                new Error('The exact held row result is unavailable.'),
              ),
      );
      void request
        .then((value) => {
          if (!signal.aborted && !this.destroy.destroyed && key === this.key())
            this.held.set({ key, value });
        })
        .catch((error) => {
          if (!signal.aborted && !this.destroy.destroyed && key === this.key())
            this.error.set(
              error?.status === 403
                ? 'Retained evidence is no longer available to this account.'
                : error?.status === 404
                  ? 'This retained evidence is absent or unavailable.'
                  : error instanceof Error
                    ? error.message
                    : 'Retained evidence is unavailable.',
            );
        })
        .finally(() => {
          if (!signal.aborted && !this.destroy.destroyed && key === this.key())
            this.loading.set(false);
        });
    });
  }
}

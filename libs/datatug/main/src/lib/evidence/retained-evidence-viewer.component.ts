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
import { OriginalEvidencePanelComponent } from './original-evidence-panel.component';
import { EvidenceCopyLinkComponent } from './evidence-copy-link.component';
import type { EvidenceLinkTarget } from './evidence-link';
import {
  SOURCE_EVIDENCE_PRESENTERS,
  sourceEvidencePresenter,
} from './source-evidence-presentation';
import { SourceDetailsComponent } from '../source-workspace/source-details.component';
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
    OriginalEvidencePanelComponent,
    SourceDetailsComponent,
    EvidenceCopyLinkComponent,
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
      @if (linkTarget(); as link) {
        <sneat-datatug-evidence-copy-link
          class="evidence-link"
          [projectRef]="projectRef()"
          [environment]="environment()"
          [target]="link"
          [label]="selector() ? 'Copy link to this run' : 'Copy link'"
        />
      }
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
        <sneat-source-details [details]="data" />
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
        @if (query.originalEvidence) {
          <sneat-original-evidence-panel
            [presentation]="originalPresentation(query)"
          />
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
      .evidence-header ion-buttons,
      .evidence-link {
        margin-inline-start: auto;
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
      dt {
        color: var(--dt-text-muted);
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
  private readonly presenters = inject(SOURCE_EVIDENCE_PRESENTERS);
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
    if (!value || !('receipt' in value)) return undefined;
    const presenter = sourceEvidencePresenter(
      this.presenters,
      value.reference.sourceId,
    );
    return (
      presenter?.operation(value) || {
        title: 'Source receipt unavailable',
        summary:
          'No unique presentation adapter is registered for this source.',
        sections: [],
      }
    );
  });
  /** A loaded retained run can be linked; a selected row links to its run, never to the row's key. */
  protected readonly linkTarget = computed<EvidenceLinkTarget | undefined>(
    () => {
      const value = this.current(),
        target = this.target();
      if (!value || 'receipt' in value) return undefined;
      if (target?.kind === 'check-run') return target;
      if (target?.kind === 'execution')
        return { kind: 'execution', execution: target.execution };
      const execution = 'run' in value ? undefined : value.result.execution;
      return execution ? { kind: 'execution', execution } : undefined;
    },
  );
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
  protected originalPresentation(query: RetainedExecutionView) {
    return (
      sourceEvidencePresenter(
        this.presenters,
        query.sourcePin.sourceId,
      )?.original(query.originalEvidence) || {
        status: 'unavailable' as const,
        reason: 'No unique presentation adapter is registered for this source.',
      }
    );
  }
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
            ? { sourceId: target.sourceOperation.sourceId, environment }
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

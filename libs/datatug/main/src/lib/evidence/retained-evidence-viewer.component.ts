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
import { IonButton } from '@ionic/angular';
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
import { useNativeRunLifetime } from './native-run-lifetime';
import { HeldResultPresentationComponent } from '../board/ui/components/held-result-presentation/held-result-presentation.component';
import { ValidationRunResultsComponent } from '../detective/validation-run-results.component';
@Component({
  selector: 'sneat-datatug-retained-evidence-viewer',
  imports: [
    IonButton,
    HeldResultPresentationComponent,
    ValidationRunResultsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-label="Retained execution evidence">
    <h3>Retained execution evidence</h3>
    <p>
      Opens the original admitted run and selected audit records after a current
      rights check. Opening does not run a query or Check.
    </p>
    @if (loading()) {
      <p role="status">Checking current evidence access…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <ion-button (click)="retry.update(increment)"
        >Retry current evidence read</ion-button
      >
    }
    @if (current(); as data) {
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
        <sneat-datatug-held-result-presentation
          [result]="query.result"
          defaultView="grid"
          [embedded]="true"
        />
      }
    }
  </section>`,
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
    | { key: string; value: RetainedExecutionView | RetainedCheckView }
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
  protected readonly check = computed(() => {
    const value = this.current();
    return value && 'run' in value ? value : undefined;
  });
  protected readonly queries = computed(() => {
    const value = this.current();
    return !value ? [] : 'run' in value ? value.results : [value];
  });
  constructor() {
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
        const current = this.native.capture(ref);
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

import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonSpinner,
  IonText,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addCircleOutline,
  chevronDownOutline,
  chevronForwardOutline,
  linkOutline,
} from 'ionicons/icons';
import { forkJoin } from 'rxjs';
import { displayTypedValue, toFact, toTypedValue } from '../../../contract/adapt';
import { tryDecodeErrorEnvelope } from '../../../contract/decoders';
import {
  Candidate,
  CandidateState,
  CandidateTarget,
  Fact,
  RelatedLookup,
  Result,
} from '../../../contract/types';
import { SemanticSelection } from '../../models/models';
import { AgentContextService } from '../../services/agent-context.service';
import { InvestigationContextService } from '../../services/investigation-context.service';
import { SemanticApiService } from '../../services/semantic-api.service';

addIcons({
  addCircleOutline,
  chevronDownOutline,
  chevronForwardOutline,
  linkOutline,
});

/** Emitted when the user opens an applicable (or needs-target) query; the host page owns
 * navigation. Carries the Candidate's own bindings/targets/state so the query page can
 * render a target selector without a second `queries/applicable` round trip. */
export interface OpenQueryRequest {
  readonly queryId: string;
  readonly bindings: Candidate['bindings'];
  readonly targets: readonly CandidateTarget[];
  readonly selectedSource?: string;
  readonly state: CandidateState;
}

/**
 * REQ:related-lookup-model, REQ:applicable-queries, REQ:context-basket — the context
 * panel opened for a selected semantic value: its meaning, related records across
 * sources with counts, applicable queries with their resolution chain (and which ones
 * are not yet applicable and why), and "Add to context".
 *
 * All data comes from {@link SemanticApiService} — nothing here evaluates name patterns
 * or builds a query client-side (REQ:semantic-resolution-endpoint,
 * REQ:related-lookup-execution). Applicable queries are resolved against the selection
 * *and* the active Investigation Context, per REQ:applicable-queries. Opening an
 * applicable (or needs-target) query only emits {@link openQuery}; navigating to the
 * query page and running it is a host-page concern.
 *
 * Every request carries the current {@link AgentContextService.securityContextId}. A
 * `STALE_CONTEXT` response refreshes it and clears the Investigation Context (old-principal
 * facts must not survive a principal/policy-session change) before surfacing a retry prompt
 * — plan Task 12 item 3's cut-over scope; full reactive isolation (conflicts, late-response
 * discard) is Task 15.
 */
@Component({
  selector: 'sneat-datatug-context-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonBadge,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
  ],
  templateUrl: './context-panel.component.html',
  styleUrl: './context-panel.component.scss',
})
export class ContextPanelComponent {
  private readonly semanticApi = inject(SemanticApiService);
  private readonly agentContext = inject(AgentContextService);
  protected readonly context = inject(InvestigationContextService);

  readonly project = input.required<string>();
  readonly environment = input.required<string>();
  readonly selection = input<SemanticSelection | undefined>();
  readonly limit = input<number>(10);

  readonly openQuery = output<OpenQueryRequest>();

  protected readonly related = signal<readonly RelatedLookup[]>([]);
  protected readonly applicable = signal<readonly Candidate[]>([]);
  protected readonly notYet = signal<readonly Candidate[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly expandedRows = signal<Readonly<Record<string, Result | undefined>>>(
    {},
  );
  protected readonly expandedLoading = signal<Readonly<Record<string, boolean>>>({});

  protected readonly meaning = computed(() => {
    const selection = this.selection();
    return selection
      ? `${selection.entity}.${selection.field} = ${selection.value}`
      : undefined;
  });

  /** Guards against the effect below re-entering itself: `handleLoadError` clears the
   * Investigation Context on `STALE_CONTEXT`, and this effect also depends on
   * `context.items()` (to reload when the user changes it) — without this guard, that
   * self-inflicted clear would immediately re-trigger `load()` against the still-stale
   * `securityContextId`, which fails the same way, clears again, forever (a real,
   * reproduced infinite `effect` re-entry, not a hypothetical). */
  private suppressNextReload = false;

  constructor() {
    effect(() => {
      const selection = this.selection();
      const project = this.project();
      const environment = this.environment();
      // Re-run whenever the enabled context items change too, since REQ:applicable-queries
      // resolves against selection + context together.
      this.context.items();
      if (this.suppressNextReload) {
        this.suppressNextReload = false;
        return;
      }
      if (!selection || !project || !environment) {
        this.related.set([]);
        this.applicable.set([]);
        this.notYet.set([]);
        this.expandedRows.set({});
        return;
      }
      this.load(project, environment, selection);
    });
  }

  protected addToContext(): void {
    const selection = this.selection();
    if (!selection) {
      return;
    }
    this.context.addValue({
      entityField: { entity: selection.entity, field: selection.field },
      value: selection.value,
      label: this.meaning() ?? `${selection.entity}.${selection.field}`,
      source: selection.source,
    });
  }

  protected toggleRelated(lookup: RelatedLookup): void {
    const selection = this.selection();
    const project = this.project();
    const environment = this.environment();
    const securityContextId = this.agentContext.securityContextId();
    if (!selection || !project || !environment || !securityContextId) {
      return;
    }
    if (this.expandedRows()[lookup.lookupId]) {
      this.expandedRows.set({
        ...this.expandedRows(),
        [lookup.lookupId]: undefined,
      });
      return;
    }
    this.expandedLoading.set({
      ...this.expandedLoading(),
      [lookup.lookupId]: true,
    });
    this.semanticApi
      .getRelatedRows({
        project,
        environment,
        securityContextId,
        lookupId: lookup.lookupId,
        value: toTypedValue(selection.value),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.expandedRows.set({
            ...this.expandedRows(),
            [lookup.lookupId]: result,
          });
          this.expandedLoading.set({
            ...this.expandedLoading(),
            [lookup.lookupId]: false,
          });
        },
        error: () => {
          this.expandedLoading.set({
            ...this.expandedLoading(),
            [lookup.lookupId]: false,
          });
        },
      });
  }

  /** Renders a Result row (typed values) for the read-only related-rows preview — the
   * "grid adapters unwrap at the edge" half of plan Task 12 item 3. */
  protected rowText(row: Result['recordset']['rows'][number]): string {
    return row.map(displayTypedValue).join(', ');
  }

  protected chainText(chain: Candidate['chain']): string {
    return chain.map((step) => step.explanation).join(' → ');
  }

  protected missingText(missing: readonly string[]): string {
    return missing.join(', ');
  }

  protected countText(count: number | null): string {
    return count === null ? 'count unavailable' : String(count);
  }

  protected onOpenApplicable(candidate: Candidate): void {
    this.emitOpenQuery(candidate);
  }

  /** `needs-target` candidates are openable too — the query page renders the target
   * selector from `candidate.targets` (api-contract.md: "Render a real target selector...
   * without leaking hidden targets"). Other not-yet states stay informational only. */
  protected isOpenable(candidate: Candidate): boolean {
    return candidate.state === 'needs-target';
  }

  protected onOpenNotYet(candidate: Candidate): void {
    if (this.isOpenable(candidate)) {
      this.emitOpenQuery(candidate);
    }
  }

  private emitOpenQuery(candidate: Candidate): void {
    this.openQuery.emit({
      queryId: candidate.queryId,
      bindings: candidate.bindings,
      targets: candidate.targets,
      selectedSource: candidate.selectedSource,
      state: candidate.state,
    });
  }

  private load(project: string, environment: string, selection: SemanticSelection): void {
    const securityContextId = this.agentContext.securityContextId();
    if (!securityContextId) {
      // agent-info hasn't resolved yet (AgentContextService fetches it once, on
      // construction) — nothing to send a Scope-bearing request with yet.
      this.error.set('Waiting for the agent connection…');
      return;
    }
    this.loading.set(true);
    this.error.set(undefined);
    const scope = { project, environment, securityContextId };
    const values = this.applicableValues(selection);
    forkJoin({
      related: this.semanticApi.getRelated({
        ...scope,
        fact: values[0],
        limit: this.limit(),
      }),
      applicable: this.semanticApi.getApplicableQueries({ ...scope, values }),
    }).subscribe({
      next: ({ related, applicable }) => {
        this.related.set(related.related);
        this.applicable.set(applicable.applicable);
        this.notYet.set(applicable.notYet);
        this.loading.set(false);
      },
      error: (err: unknown) => this.handleLoadError(err),
    });
  }

  private handleLoadError(err: unknown): void {
    this.loading.set(false);
    const envelope =
      err instanceof HttpErrorResponse ? tryDecodeErrorEnvelope(err.error) : undefined;
    if (envelope?.error.code === 'STALE_CONTEXT') {
      // The principal/policy-session changed underneath this scope — old-principal
      // facts must not survive it (api-contract.md "Scope and identity"). See
      // `suppressNextReload`'s comment for why the clear below must not auto-reload.
      this.suppressNextReload = true;
      this.context.clear();
      this.agentContext.refresh().subscribe({
        error: () => undefined,
      });
      this.error.set('Your session changed — context was cleared, please retry.');
      return;
    }
    this.error.set('Failed to load the context panel');
  }

  /** Selection first, then enabled context items (REQ:applicable-queries), de-duplicated,
   * each wrapped as a wire {@link Fact} — the "grid adapters wrap at the edge" half of
   * plan Task 12 item 3. */
  private applicableValues(selection: SemanticSelection): Fact[] {
    const values: Fact[] = [
      toFact(selection.entity, selection.field, selection.value, 'selection'),
    ];
    for (const item of this.context.items().filter((i) => i.enabled)) {
      const isDuplicate = values.some(
        (v) =>
          v.entity === item.entityField.entity &&
          v.field === item.entityField.field &&
          displayTypedValue(v.value) === String(item.value),
      );
      if (!isDuplicate) {
        values.push(
          toFact(item.entityField.entity, item.entityField.field, item.value, 'context'),
        );
      }
    }
    return values;
  }
}

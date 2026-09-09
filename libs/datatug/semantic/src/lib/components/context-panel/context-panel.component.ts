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
      const securityContextId = this.agentContext.securityContextId();
      // Re-run whenever the enabled context items change too, since REQ:applicable-queries
      // resolves against selection + context together.
      this.context.items();
      // Task 15 item 2/4 — every project/environment/securityContextId change switches
      // (or opens) that scope's own Investigation Context basket before anything else
      // in this effect runs, so `this.context.items()` above already reflects the
      // *new* scope's own facts, never the previous scope's (api-contract.md
      // "Switching scope clears active bindings and opens that scope's own empty or
      // retained local context; it never imports facts automatically").
      if (project && environment && securityContextId) {
        this.context.setScope({ project, environment, securityContextId });
      }
      if (this.suppressNextReload) {
        this.suppressNextReload = false;
        return;
      }
      if (!selection || !project || !environment) {
        // Guarded (skip if already empty) rather than an unconditional `.set([])` on
        // every run — this runs inside an `effect()`, and a signal write on every
        // invocation (even to an equivalent value) can keep Angular's change-detection
        // loop from reaching a fixed point (reproduced directly in
        // QueryPageComponent's own effect — see its `updateBindings()` comment).
        if (this.related().length) this.related.set([]);
        if (this.applicable().length) this.applicable.set([]);
        if (this.notYet().length) this.notYet.set([]);
        if (Object.keys(this.expandedRows()).length) this.expandedRows.set({});
        return;
      }
      this.load(project, environment, securityContextId, selection);
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
    const requestScope = { project, environment, securityContextId };
    this.semanticApi
      .getRelatedRows({
        ...requestScope,
        lookupId: lookup.lookupId,
        value: toTypedValue(selection.value),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          // Task 15 item 4 — discard a late response for a scope the user has since
          // left (project/environment/principal switch mid-flight).
          if (!this.context.isCurrentScope(requestScope)) {
            return;
          }
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
          if (!this.context.isCurrentScope(requestScope)) {
            return;
          }
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

  private load(
    project: string,
    environment: string,
    securityContextId: string | undefined,
    selection: SemanticSelection,
  ): void {
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
        // Task 15 item 4 — a response whose requested scope no longer matches the
        // *current* scope (the user switched project/environment/principal while this
        // request was in flight) is a late response and must be discarded, never
        // applied to the now-different scope's panel (api-contract.md "late responses
        // from another scope are discarded").
        if (!this.context.isCurrentScope(scope)) {
          return;
        }
        this.related.set(related.related);
        this.applicable.set(applicable.applicable);
        this.notYet.set(applicable.notYet);
        this.loading.set(false);
      },
      error: (err: unknown) => this.handleLoadError(err, scope),
    });
  }

  private handleLoadError(
    err: unknown,
    requestScope: { project: string; environment: string; securityContextId: string },
  ): void {
    if (!this.context.isCurrentScope(requestScope)) {
      // Late error response for a scope we've already left — same discard rule as a
      // late success response.
      return;
    }
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
      toFact(
        selection.entity,
        selection.field,
        selection.value,
        'selection',
        true,
        selection.physical,
      ),
    ];
    // Task 15 item 2 — InvestigationContextService's items are now wire-shaped Facts
    // already (`origin: 'context'`), so no re-wrap through toFact() is needed here —
    // just typed-equality dedup against what's already in `values` (a same-typed-value
    // duplicate is dropped; a *different* typed value for the same entity.field is kept
    // as a genuine second candidate, letting the server's own ambiguity/conflict
    // detection see it, same as before).
    for (const item of this.context.items().filter((i) => i.enabled)) {
      const isDuplicate = values.some(
        (v) =>
          v.entity === item.entity &&
          v.field === item.field &&
          v.value.type === item.value.type &&
          v.value.value === item.value.value,
      );
      if (!isDuplicate) {
        values.push({
          id: item.id,
          entity: item.entity,
          field: item.field,
          value: item.value,
          origin: 'context',
          enabled: item.enabled,
        });
      }
    }
    return values;
  }
}

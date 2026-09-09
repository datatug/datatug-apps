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
import {
  ApplicableQuery,
  NotYetApplicableQuery,
  QueryParameterBinding,
  Recordset,
  RelatedLookup,
  SemanticSelection,
  SemanticValueWithOrigin,
} from '../../models/models';
import { InvestigationContextService } from '../../services/investigation-context.service';
import { SemanticApiService } from '../../services/semantic-api.service';

addIcons({
  addCircleOutline,
  chevronDownOutline,
  chevronForwardOutline,
  linkOutline,
});

/** Emitted when the user opens an applicable query; the host page owns navigation. */
export interface OpenQueryRequest {
  readonly queryId: string;
  readonly bindings: readonly QueryParameterBinding[];
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
 * applicable query only emits {@link openQuery}; navigating to the query page and
 * running it is a host-page concern (the later table/query-page integration task).
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
  protected readonly context = inject(InvestigationContextService);

  readonly project = input.required<string>();
  readonly selection = input<SemanticSelection | undefined>();
  readonly limit = input<number>(10);

  readonly openQuery = output<OpenQueryRequest>();

  protected readonly related = signal<readonly RelatedLookup[]>([]);
  protected readonly applicable = signal<readonly ApplicableQuery[]>([]);
  protected readonly notYet = signal<readonly NotYetApplicableQuery[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly expandedRows = signal<
    Readonly<Record<string, Recordset | undefined>>
  >({});
  protected readonly expandedLoading = signal<Readonly<Record<string, boolean>>>(
    {},
  );

  protected readonly meaning = computed(() => {
    const selection = this.selection();
    return selection
      ? `${selection.entity}.${selection.field} = ${selection.value}`
      : undefined;
  });

  constructor() {
    effect(() => {
      const selection = this.selection();
      const project = this.project();
      // Re-run whenever the enabled context items change too, since REQ:applicable-queries
      // resolves against selection + context together.
      this.context.items();
      if (!selection || !project) {
        this.related.set([]);
        this.applicable.set([]);
        this.notYet.set([]);
        this.expandedRows.set({});
        return;
      }
      this.load(project, selection);
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
    if (!selection || !project) {
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
        lookupId: lookup.lookupId,
        value: selection.value,
        limit: this.limit(),
      })
      .subscribe({
        next: (response) => {
          this.expandedRows.set({
            ...this.expandedRows(),
            [lookup.lookupId]: response.recordset,
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

  protected chainText(chain: readonly string[]): string {
    return chain.join(' → ');
  }

  protected missingText(missing: readonly string[]): string {
    return missing.join(', ');
  }

  protected countText(count: number | null): string {
    return count === null ? 'count unavailable' : String(count);
  }

  protected onOpenApplicable(query: ApplicableQuery): void {
    this.openQuery.emit({ queryId: query.queryId, bindings: query.bindings });
  }

  private load(project: string, selection: SemanticSelection): void {
    this.loading.set(true);
    this.error.set(undefined);
    const values = this.applicableValues(selection);
    forkJoin({
      related: this.semanticApi.getRelated({
        project,
        entity: selection.entity,
        field: selection.field,
        value: selection.value,
        limit: this.limit(),
      }),
      applicable: this.semanticApi.getApplicableQueries({ project, values }),
    }).subscribe({
      next: ({ related, applicable }) => {
        this.related.set(related);
        this.applicable.set(applicable.applicable);
        this.notYet.set(applicable.notYet);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load the context panel');
        this.loading.set(false);
      },
    });
  }

  /** Selection first, then enabled context items (REQ:applicable-queries), de-duplicated. */
  private applicableValues(
    selection: SemanticSelection,
  ): SemanticValueWithOrigin[] {
    const values: SemanticValueWithOrigin[] = [
      {
        entity: selection.entity,
        field: selection.field,
        value: selection.value,
        origin: selection.source,
      },
    ];
    for (const item of this.context.items().filter((i) => i.enabled)) {
      const isDuplicate = values.some(
        (v) =>
          v.entity === item.entityField.entity &&
          v.field === item.entityField.field &&
          v.value === item.value,
      );
      if (!isDuplicate) {
        values.push({
          entity: item.entityField.entity,
          field: item.entityField.field,
          value: item.value,
          origin: 'context',
        });
      }
    }
    return values;
  }
}

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
  ChartWidgetDef,
  BoardCard,
  BoardParameterDef,
} from '@datatug/board-models';
import {
  decodeEvidenceChartSpec,
  type EvidenceChartSpec,
} from '@sneat/datatug-semantic';
import { IProjectRef } from '../../../../core/project-context';
import { QueriesService } from '../../../../queries/queries.service';

export interface ChartQueryChoice {
  id: string;
  title?: string;
}
const roles = {
  timeline: [
    'laneColumn',
    'eventColumn',
    'sequenceColumn',
    'timeColumn',
    'clockDomainColumn',
    'precisionColumn',
    'statusColumn',
    'evidenceRefColumn',
  ],
  'timing-bars': [
    'rowKeyColumn',
    'labelColumn',
    'startTimeColumn',
    'endTimeColumn',
    'startClockDomainColumn',
    'endClockDomainColumn',
    'startPrecisionColumn',
    'endPrecisionColumn',
    'startEvidenceRefColumn',
    'endEvidenceRefColumn',
    'startIdentityColumn',
    'endIdentityColumn',
  ],
  heatmap: ['rowColumn', 'columnColumn', 'statusColumn', 'evidenceRefColumn'],
} as const;
/** Structured definition controls only. The canonical BoardWidget renders results. */
@Component({
  selector: 'sneat-datatug-board-chart-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section aria-label="Chart definition">
    <label
      >Chart kind
      <select
        aria-label="Chart kind"
        [value]="kind()"
        [disabled]="disabled()"
        (change)="chooseKind($any($event.target).value)"
      >
        <option value="timeline">Milestone timeline</option>
        <option value="timing-bars">Measured timing bars</option>
        <option value="heatmap">Readiness heatmap</option>
      </select></label
    >
    <label
      >Chart saved query
      <select
        aria-label="Chart saved query"
        [value]="queryId()"
        [disabled]="disabled()"
        (change)="chooseQuery($any($event.target).value)"
      >
        @for (query of queries(); track query.id) {
          <option [value]="query.id" [selected]="query.id === queryId()">
            {{ query.title || query.id }}
          </option>
        }
      </select></label
    >
    @if (loading()) {
      <p role="status">Loading declared query columns…</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (!loading() && columns().length) {
      <p>
        Map observed columns from this saved query. Mappings do not create
        timestamps or evidence.
      </p>
      @for (role of fields(); track role) {
        <label
          >{{ roleLabel(role) }}
          <select
            [attr.aria-label]="role"
            [value]="mapping()[role] || ''"
            [disabled]="disabled()"
            (change)="mapColumn(role, $any($event.target).value)"
          >
            <option value="">Choose a column</option>
            @for (column of columns(); track column) {
              <option [value]="column" [selected]="column === mapping()[role]">
                {{ column }}
              </option>
            }
          </select></label
        >
      }
      @for (parameter of queryParameters(); track parameter.id) {
        <label
          >Board input for {{ parameter.id }}
          <select
            [attr.aria-label]="'Board input for ' + parameter.id"
            [value]="bindings()[parameter.id] || ''"
            [disabled]="disabled()"
            (change)="bind(parameter.id, $any($event.target).value)"
          >
            <option value="">Keep existing constant or query default</option>
            @for (def of boardParameters(); track def.id) {
              @if (def.type === parameter.type) {
                <option
                  [value]="def.id"
                  [selected]="def.id === bindings()[parameter.id]"
                >
                  {{ def.title || def.id }}
                </option>
              }
            }
          </select></label
        >
      }
      <button
        type="button"
        [disabled]="disabled() || !complete()"
        (click)="apply()"
      >
        Apply chart definition
      </button>
    } @else if (!loading() && !error()) {
      <p role="status">
        This query has no declared result columns. A compatible saved query
        schema is required.
      </p>
    }
  </section>`,
  styles: [
    `
      section {
        display: grid;
        gap: 0.75rem;
        padding-block: 1rem;
      }
      label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      select {
        max-width: 100%;
        min-height: 2.5rem;
      }
      button {
        justify-self: start;
        min-height: 2.5rem;
      }
    `,
  ],
})
export class BoardChartEditorComponent {
  readonly card = input.required<BoardCard>();
  readonly queries = input<readonly ChartQueryChoice[]>([]);
  readonly project = input<IProjectRef>();
  readonly scopeIdentity = input('');
  readonly disabled = input(false);
  readonly boardParameters = input<readonly BoardParameterDef[]>([]);
  readonly definition = output<ChartWidgetDef>();
  readonly kind = signal<EvidenceChartSpec['type']>('timeline');
  readonly queryId = signal('');
  readonly mapping = signal<Record<string, string>>({});
  readonly bindings = signal<Record<string, string>>({});
  readonly columns = signal<readonly string[]>([]);
  readonly queryParameters = signal<readonly { id: string; type: string }[]>(
    [],
  );
  readonly error = signal('');
  readonly loading = signal(false);
  readonly fields = computed(() => roles[this.kind()]);
  readonly complete = computed(() =>
    this.fields().every((role) =>
      this.columns().includes(this.mapping()[role]),
    ),
  );
  private readonly api = inject(QueriesService);
  constructor() {
    effect(() => {
      this.scopeIdentity();
      const card = this.card();
      const data = card.widget?.data as ChartWidgetDef | undefined;
      if (
        card.widget?.name === 'chart' &&
        data &&
        ['timeline', 'timing-bars', 'heatmap'].includes(data.chart.type)
      ) {
        const chart = decodeEvidenceChartSpec(data.chart);
        this.kind.set(chart.type);
        this.mapping.set({
          ...('timeline' in chart
            ? chart.timeline
            : 'heatmap' in chart
              ? chart.heatmap
              : chart.timing),
        });
        this.queryId.set(data.sources[0]?.queryId || '');
        this.bindings.set(
          Object.fromEntries(
            (data.sources[0]?.parameters ?? [])
              .filter((p) => p.boardParameterId)
              .map((p) => [p.id, p.boardParameterId as string]),
          ),
        );
      } else {
        this.queryId.set(
          (card.widget?.data as { sql?: { queryId?: string } })?.sql?.queryId ||
            data?.sources?.[0]?.queryId ||
            '',
        );
        this.mapping.set({});
        this.bindings.set({});
      }
    });
    effect((onCleanup) => {
      this.scopeIdentity();
      const ref = this.project(),
        id = this.queryId();
      this.columns.set([]);
      this.queryParameters.set([]);
      this.error.set('');
      this.loading.set(false);
      if (!ref || !id || !this.queries().some((q) => q.id === id)) return;
      this.loading.set(true);
      const subscription = this.api.getQuery(ref, id).subscribe({
        next: (value) => {
          const columns =
            value.recordsets?.length === 1
              ? value.recordsets[0].columns.map((c) => c.name)
              : [];
          if (new Set(columns).size !== columns.length) {
            this.error.set('The query has ambiguous column names.');
            this.loading.set(false);
            return;
          }
          this.columns.set(columns);
          this.queryParameters.set(value.parameters ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(
            'The saved query schema is unavailable. Refresh current project access and retry.',
          );
          this.loading.set(false);
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }
  chooseQuery(value: string) {
    this.queryId.set(value);
    this.mapping.set({});
    this.bindings.set({});
  }
  chooseKind(value: EvidenceChartSpec['type']) {
    this.kind.set(value);
    this.mapping.set({});
  }
  roleLabel(role: string): string {
    return role
      .replace(/Column$/, '')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (first) => first.toUpperCase());
  }
  mapColumn(role: string, column: string) {
    this.mapping.update((value) => ({ ...value, [role]: column }));
  }
  bind(id: string, value: string) {
    this.bindings.update((current) => ({ ...current, [id]: value }));
  }
  apply() {
    if (this.disabled() || !this.complete()) return;
    try {
      const card = this.card(),
        old =
          card.widget?.name === 'chart'
            ? (card.widget.data as ChartWidgetDef)
            : undefined;
      const arm = this.kind() === 'timing-bars' ? 'timing' : this.kind();
      const chart = decodeEvidenceChartSpec({
        type: this.kind(),
        selectionId: old?.chart.selectionId || 'selection-' + card.id,
        [arm]: this.mapping(),
      });
      const original =
        old?.sources[0]?.queryId === this.queryId()
          ? old.sources[0]
          : undefined;
      const sql = (
        card.widget?.data as {
          sql?: {
            queryId?: string;
            parameters?: {
              id: string;
              value?: unknown;
              boardParameterId?: string;
            }[];
          };
        }
      )?.sql;
      const parameters = (
        original?.parameters ??
        (sql?.queryId === this.queryId() ? sql.parameters : undefined) ??
        []
      ).filter((p) => !this.bindings()[p.id]);
      for (const [id, boardParameterId] of Object.entries(this.bindings())) {
        if (!boardParameterId) continue;
        const parameter = this.queryParameters().find((p) => p.id === id);
        if (
          !parameter ||
          !this.boardParameters().some(
            (p) => p.id === boardParameterId && p.type === parameter.type,
          )
        )
          throw new Error('Choose a compatible declared board input.');
        parameters.push({ id, boardParameterId });
      }
      this.definition.emit({
        ...old,
        title: old?.title || card.title,
        sources: [
          {
            id: original?.id || 'source-' + card.id,
            queryId: this.queryId(),
            ...(parameters.length ? { parameters } : {}),
          },
        ],
        chart,
        defaultView: old?.defaultView || 'chart',
      });
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Invalid chart mapping.',
      );
    }
  }
}

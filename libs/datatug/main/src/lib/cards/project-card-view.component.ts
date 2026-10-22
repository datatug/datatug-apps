import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonInput, IonItem, IonToggle } from '@ionic/angular';
import type { BoardCard, ProjectCard } from '@datatug/board-models';
import { BoardCardComponent } from '../board/ui/components/board-card/board-card.component';
import type { BoardQueryResults } from '../board/core/board-query-results.service';
import type { IProjectRef } from '../core/project-context';
import type { IBoardContext } from '../models/definition/board/board';
import { cardBoardContext, isBlankValue, missingRequired } from './card-parameters';

/** Every saved query a card's widgets read, for cache invalidation. */
export function cardQueryIds(card: Pick<ProjectCard, 'widget'>): string[] {
  const ids = new Set<string>();
  const visit = (widget: unknown, depth = 0): void => {
    if (!widget || typeof widget !== 'object' || depth > 8) return;
    const { name, data } = widget as { name?: string; data?: any };
    if (name === 'SQL' && typeof data?.sql?.queryId === 'string')
      ids.add(data.sql.queryId);
    else if (name === 'fields' && typeof data?.source?.queryId === 'string')
      ids.add(data.source.queryId);
    else if (name === 'chart' && Array.isArray(data?.sources))
      for (const s of data.sources)
        if (typeof s?.queryId === 'string') ids.add(s.queryId);
    if (name === 'tabs' && Array.isArray(data?.tabs))
      for (const tab of data.tabs) {
        visit(tab?.widget, depth + 1);
        if (Array.isArray(tab?.widgets))
          for (const w of tab.widgets) visit(w, depth + 1);
      }
  };
  visit(card.widget);
  return [...ids];
}

/**
 * One project card rendered through the shared dashboard renderer
 * (`board-card` → `board-widget`), outside any board: for the panel beside a
 * grid and for the card page's live preview.
 *
 * Required parameters without a value show an inline form instead of
 * running any query; submitting emits {@link parameterValuesChange}.
 */
@Component({
  selector: 'datatug-project-card-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonButton, IonInput, IonItem, IonToggle, BoardCardComponent],
  template: `
    @if (showHeader()) {
      <header class="card-header">
        <h3>{{ card().title }}</h3>
        @if (card().description; as description) {
          <p class="card-description">{{ description }}</p>
        }
      </header>
    }
    @if (missing().length) {
      <form class="card-inputs" (ngSubmit)="submit()" aria-label="Card inputs">
        @for (param of missing(); track param.id) {
          @if (param.type === 'record' || param.type === 'recordset') {
            <p role="status">
              {{ param.title || param.id }} needs a selected record.
            </p>
          } @else if (param.type === 'boolean' || param.type === 'bit') {
            <ion-item>
              <ion-toggle
                [checked]="draft()[param.id] === true"
                (ionChange)="setDraft(param.id, $any($event).detail.checked)"
                >{{ param.title || param.id }}</ion-toggle
              >
            </ion-item>
          } @else {
            <ion-item>
              <ion-input
                [label]="param.title || param.id"
                labelPlacement="stacked"
                [type]="numeric(param.type) ? 'number' : 'text'"
                [attr.data-parameter]="param.id"
                [value]="draft()[param.id] ?? ''"
                (ionInput)="setDraft(param.id, $any($event).detail.value)"
              />
            </ion-item>
          }
        }
        @if (formError(); as error) {
          <p role="alert">{{ error }}</p>
        }
        <ion-button type="submit" size="small">Show</ion-button>
      </form>
    } @else {
      @for (generation of [generation()]; track generation) {
        <sneat-datatug-board-card
          [bare]="true"
          [cardMode]="true"
          [boarCardDef]="boardCard()"
          [boardContext]="context()"
          [projectRef]="projectRef()"
          [boardId]="'card:' + card().id"
          [resultCache]="cache()"
        />
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .card-header {
        padding: 0.5rem 1rem 0;
      }
      .card-header h3 {
        margin: 0;
      }
      .card-description {
        margin: 0.25rem 0 0;
        color: var(--ion-color-medium);
      }
      .card-inputs {
        padding: 0.5rem 1rem;
      }
    `,
  ],
})
export class ProjectCardViewComponent {
  readonly card = input.required<ProjectCard>();
  /** Values by parameter id; a `record` parameter holds one row object. */
  readonly parameterValues = input<Record<string, unknown>>({});
  readonly projectRef = input<IProjectRef>();
  /** Environment to query; overrides `boardContext().environment`. */
  readonly environment = input<string>();
  /** Execution context (target, security context, runtime) as boards pass it. */
  readonly boardContext = input<IBoardContext>();
  /** The result cache to share; omitted, the widgets run uncached. */
  readonly cache = input<BoardQueryResults>();
  readonly showHeader = input(true);

  /** All values after the user filled the form: supplied values plus entered ones. */
  readonly parameterValuesChange = output<Record<string, unknown>>();

  private readonly entered = signal<Record<string, unknown>>({});
  readonly draft = signal<Record<string, unknown>>({});
  readonly formError = signal<string | undefined>(undefined);
  readonly generation = signal(0);

  readonly values = computed(() => ({
    ...this.parameterValues(),
    ...this.entered(),
  }));
  readonly missing = computed(() => missingRequired(this.card(), this.values()));
  readonly context = computed<IBoardContext>(() => {
    const base = this.boardContext();
    const environment = this.environment() ?? base?.environment;
    return {
      ...cardBoardContext(base, this.card(), this.values()),
      ...(environment !== undefined ? { environment } : {}),
    };
  });
  readonly boardCard = computed<BoardCard>(() => ({
    id: this.card().id,
    title: this.card().title,
    widget: this.card().widget,
  }));

  constructor() {
    // A different card or newly supplied values drop what the user typed.
    effect(() => {
      this.card();
      this.parameterValues();
      untracked(() => {
        this.entered.set({});
        this.draft.set({});
        this.formError.set(undefined);
      });
    });
  }

  numeric(type: string): boolean {
    return ['integer', 'number', 'float', 'money'].includes(type);
  }

  setDraft(id: string, value: unknown): void {
    this.draft.update((d) => ({ ...d, [id]: value }));
  }

  submit(): void {
    const entered: Record<string, unknown> = {};
    for (const param of this.missing()) {
      if (param.type === 'record' || param.type === 'recordset') continue;
      const raw = this.draft()[param.id];
      if (param.type === 'boolean' || param.type === 'bit') {
        entered[param.id] = raw === true;
        continue;
      }
      if (isBlankValue(raw)) {
        this.formError.set(`Enter ${param.title || param.id}.`);
        return;
      }
      if (this.numeric(param.type)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          this.formError.set(`${param.title || param.id} must be a number.`);
          return;
        }
        entered[param.id] = n;
      } else entered[param.id] = String(raw);
    }
    this.formError.set(undefined);
    this.entered.update((e) => ({ ...e, ...entered }));
    this.parameterValuesChange.emit(this.values());
  }

  /**
   * Forgets this card's cached results and runs it again. Only entries of
   * the saved queries this card reads, in this project, are dropped.
   */
  refresh(): void {
    const cache = this.cache();
    const ref = this.projectRef();
    const ids = cardQueryIds(this.card());
    if (cache) {
      const project = ref ? JSON.stringify(JSON.stringify(ref)) : undefined;
      cache.invalidate(
        (key, scope) =>
          (!project || scope.includes(project)) &&
          ids.some((id) => key.includes(`"queryId":${JSON.stringify(id)}`)),
      );
    }
    this.generation.update((g) => g + 1);
  }
}

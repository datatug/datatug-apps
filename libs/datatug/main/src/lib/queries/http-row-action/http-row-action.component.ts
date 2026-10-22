import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { IonButton, IonIcon, IonNote, IonSelect, IonSelectOption } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { globeOutline } from 'ionicons/icons';
import { catchError, of, switchMap, map } from 'rxjs';
import type { IProjectContext } from '../../nav/nav-models';
import {
  QueryType,
  type IQueryDef,
  type IQueryFolder,
} from '../../models/definition/query-def';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { QueriesService } from '../queries.service';
import { canBindFromRow, type HttpRowBinding } from '../http-parameter-binding';
import { HttpRowBindingStore } from './http-row-binding.store';

interface Candidate {
  readonly id: string;
  readonly query: IQueryDef;
}

function httpQueries(folder: IQueryFolder | null | undefined, path: string[] = []): Candidate[] {
  if (!folder) return [];
  const own = (folder.items ?? [])
    .filter((q) => q.request?.queryType === QueryType.HTTP && (q.parameters?.length ?? 0) > 0)
    .map((query) => ({ id: [...path, query.id].join('/'), query }));
  return [
    ...own,
    ...(folder.folders ?? []).flatMap((f) => httpQueries(f, [...path, f.id])),
  ];
}

/**
 * "Run HTTP query" for the selected result row (http-query-parameters
 * REQ:row-binding, REQ:multi-row-selection): lists the project's saved HTTP
 * queries whose parameters bind from the row and opens the chosen one with
 * the row bound. One row only: several checked rows disable it.
 */
@Component({
  selector: 'sneat-datatug-http-row-action',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonButton, IonIcon, IonNote, IonSelect, IonSelectOption],
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      padding: 4px 16px;
    }
    ion-select {
      max-width: 320px;
    }
  `,
  template: `
    @if (candidates().length) {
      <ion-button
        size="small"
        fill="outline"
        [disabled]="!!blocked()"
        (click)="run()"
      >
        <ion-icon slot="start" name="globe-outline" />
        Run HTTP query
      </ion-button>
      @if (candidates().length > 1) {
        <ion-select
          aria-label="HTTP query to run"
          interface="popover"
          [value]="chosen()?.id"
          [disabled]="!!blocked()"
          (ionChange)="choose($event)"
        >
          @for (c of candidates(); track c.id) {
            <ion-select-option [value]="c.id">{{ c.query.title || c.id }}</ion-select-option>
          }
        </ion-select>
      } @else if (chosen(); as c) {
        <ion-note>{{ c.query.title || c.id }}</ion-note>
      }
      @if (blocked(); as reason) {
        <ion-note color="medium" role="status">{{ reason }}</ion-note>
      }
    }
  `,
})
export class HttpRowActionComponent {
  private readonly queries = inject(QueriesService);
  private readonly nav = inject(DatatugNavService);
  private readonly store = inject(HttpRowBindingStore);

  readonly project = input<IProjectContext | undefined>(undefined);
  /** The focused result row. */
  readonly row = input<HttpRowBinding | undefined>(undefined);
  /** How many rows are checked in the grid. */
  readonly checkedRows = input(0);

  private readonly all = toSignal(
    toObservable(computed(() => this.project()?.ref)).pipe(
      switchMap((ref) =>
        ref
          ? this.queries.getQueriesFolder(ref, '~').pipe(
              map((folder) => httpQueries(folder)),
              catchError(() => of([] as Candidate[])),
            )
          : of([] as Candidate[]),
      ),
    ),
    { initialValue: [] as Candidate[] },
  );

  /** HTTP queries whose parameters bind from the focused row (any row when none is focused). */
  protected readonly candidates = computed(() => {
    const row = this.row();
    return row
      ? this.all().filter((c) => canBindFromRow(c.query.parameters ?? [], row))
      : [];
  });
  private readonly chosenId = signal<string | undefined>(undefined);
  protected readonly chosen = computed<Candidate | undefined>(
    () =>
      this.candidates().find((c) => c.id === this.chosenId()) ??
      this.candidates()[0],
  );
  protected readonly blocked = computed(() =>
    this.checkedRows() > 1 ? 'Select one row.' : undefined,
  );

  constructor() {
    addIcons({ globeOutline });
  }

  protected choose(event: Event): void {
    this.chosenId.set((event as CustomEvent<{ value?: string }>).detail?.value);
  }

  protected run(): void {
    const project = this.project();
    const row = this.row();
    const c = this.chosen();
    if (!project || !row || !c || this.blocked()) return;
    this.store.offer(c.id, row);
    this.nav.goQuery(project, { ...c.query, id: c.id }, 'execute');
  }
}

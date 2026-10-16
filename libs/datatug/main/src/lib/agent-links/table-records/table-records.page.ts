import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { Subject, combineLatest, of, switchMap, map, catchError } from 'rxjs';
import {
  AgentLinkApiService,
  AgentRows,
  AgentTableRef,
  LinkProblem,
  classifyAgentError,
} from '../agent-link-api.service';
import {
  LIMIT_QUERY_PARAM,
  linkBackHref,
  linkTableRef,
  recordsLimit,
} from '../link-route';
import { LinkProblemComponent } from '../link-problem/link-problem.component';
import { qualifiedTableName } from '../table-identity';

type RecordsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'rows'; readonly rows: AgentRows }
  | { readonly kind: 'problem'; readonly problem: LinkProblem };

/**
 * The Table records card's link (Feature claude-mod-web-links, plan Task 8):
 * `…/table|view/<name>/records?limit=<N>&schema=<s>`. Reads at most `limit` rows (default 50, at most 1000) through
 * the agent, read-only: the table is first checked against its live schema (so an unknown project, database or
 * table is named), then its rows are read with `exec/select` and nothing else — no filter, sort or SQL from the
 * address, and no write.
 */
@Component({
  selector: 'sneat-datatug-table-records-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonMenuButton,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonText,
    LinkProblemComponent,
  ],
  templateUrl: './table-records.page.html',
  styleUrl: '../agent-link-page.scss',
})
export class TableRecordsPageComponent {
  private readonly api = inject(AgentLinkApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly reload$ = new Subject<void>();

  readonly tableRef = signal<AgentTableRef | undefined>(undefined);
  readonly limit = signal(recordsLimit(undefined));
  readonly state = signal<RecordsState>({ kind: 'loading' });
  readonly backHref = computed(() => {
    const ref = this.tableRef();
    return linkBackHref(ref?.storeId ?? '', ref?.project);
  });
  readonly title = computed(() => {
    const ref = this.tableRef();
    return ref ? `${qualifiedTableName(ref.table)} records` : 'Records';
  });

  constructor() {
    combineLatest([this.route.paramMap, this.route.queryParamMap, this.reload$])
      .pipe(
        switchMap(() => {
          const ref = linkTableRef(this.route.snapshot);
          const limit = recordsLimit(
            this.route.snapshot.queryParamMap.get(LIMIT_QUERY_PARAM),
          );
          this.tableRef.set(ref);
          this.limit.set(limit);
          this.state.set({ kind: 'loading' });
          if (!ref) {
            return of<RecordsState>({
              kind: 'problem',
              problem: 'table-not-found',
            });
          }
          return this.api.tableSchema(ref).pipe(
            switchMap(() => this.api.selectRows(ref, limit)),
            map((rows): RecordsState => ({ kind: 'rows', rows })),
            catchError((err: unknown) =>
              of<RecordsState>({
                kind: 'problem',
                problem: classifyAgentError(err),
              }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
    this.reload$.next();
  }

  /** Reads again (Check again). */
  reload(): void {
    this.reload$.next();
  }
}

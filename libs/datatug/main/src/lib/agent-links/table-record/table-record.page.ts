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
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import {
  Observable,
  Subject,
  catchError,
  combineLatest,
  map,
  of,
  switchMap,
} from 'rxjs';
import {
  AgentLinkApiService,
  AgentTableRef,
  AgentTableSchema,
  LinkProblem,
  LinkProblemError,
  classifyAgentError,
} from '../agent-link-api.service';
import { linkTableRef } from '../link-route';
import { lookupKey, parseKeyObject, pkOfRouteFragment } from '../record-key';
import { qualifiedTableName } from '../table-identity';

export interface RecordField {
  readonly name: string;
  readonly value: string;
  readonly key: boolean;
}

type RecordState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'record';
      readonly fields: readonly RecordField[];
      readonly schema: AgentTableSchema;
    }
  | { readonly kind: 'problem'; readonly problem: LinkProblem };

/**
 * The Record card's link (Feature claude-mod-web-links, plan Task 9): `…/table|view/<name>/record?schema=<s>` with
 * the primary key in the fragment only (`#…pk=<JSON>`). The key is parsed without rounding (`record-key.ts`), checked
 * against the table's live primary key and column types, and only then sent to the read-only `records/lookup`,
 * which binds it as parameters. A fragment that is malformed, names another column or holds a value of the wrong
 * type is `bad-key`, and no lookup is sent. No `where` is ever built.
 */
@Component({
  selector: 'sneat-datatug-table-record-page',
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
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonText,
  ],
  templateUrl: './table-record.page.html',
  styleUrl: '../agent-link-page.scss',
})
export class TableRecordPageComponent {
  private readonly api = inject(AgentLinkApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly reload$ = new Subject<void>();

  readonly tableRef = signal<AgentTableRef | undefined>(undefined);
  readonly state = signal<RecordState>({ kind: 'loading' });
  readonly title = computed(() => {
    const ref = this.tableRef();
    return ref ? `${qualifiedTableName(ref.table)} record` : 'Record';
  });

  constructor() {
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.route.fragment,
      this.reload$,
    ])
      .pipe(
        switchMap(() => this.load()),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
    this.reload$.next();
  }

  /** Reads again (Check again). */
  reload(): void {
    this.reload$.next();
  }

  private load(): Observable<RecordState> {
    const ref = linkTableRef(this.route.snapshot);
    this.tableRef.set(ref);
    this.state.set({ kind: 'loading' });
    if (!ref) {
      return of({ kind: 'problem', problem: 'table-not-found' });
    }
    // The router's copy of the fragment, decoded once: the address bar itself may already hold the router's
    // re-encoded form, in which a `&` inside a key value is bare (see pkOfRouteFragment).
    const pkText = pkOfRouteFragment(this.route.snapshot.fragment);
    const key = pkText === undefined ? undefined : parseKeyObject(pkText);
    if (!key) {
      return of({ kind: 'problem', problem: 'bad-key' });
    }
    return this.api.tableSchema(ref).pipe(
      switchMap((schema) => {
        const typed = lookupKey(key, schema);
        if (!typed) {
          throw new LinkProblemError('bad-key');
        }
        return this.api.lookupRecord(ref, typed).pipe(
          map((rows): RecordState => ({
            kind: 'record',
            schema,
            fields: rows.columns.map((name, i) => ({
              name,
              value: rows.rows[0][i] ?? '',
              key: schema.primaryKey.includes(name),
            })),
          })),
        );
      }),
      catchError((err: unknown) =>
        of<RecordState>({ kind: 'problem', problem: classifyAgentError(err) }),
      ),
    );
  }
}

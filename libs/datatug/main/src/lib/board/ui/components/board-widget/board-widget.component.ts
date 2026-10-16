import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  WritableSignal,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonButton } from '@ionic/angular';
import {
  BoardWidget,
  SQLWidgetDef,
  TabsWidgetDef,
} from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
import { equalProjectRef } from '../../../../core/project-context';
import { projectPageHref } from '../../../../nav/project-page-href';
import { QueryType } from '../../../../models/definition/query-def';
import { IQueryDef } from '../../../../models/definition/query-def';
import { firstValueFrom, timeout } from 'rxjs';
import { QueriesService } from '../../../../queries/queries.service';
import { PublicSqliteQueryService } from '../../../../queries/public-sqlite-query.service';
import { FederatedQueryResult } from '../../../../queries/federated-query-executor';
import { BoardChoicesService } from '../../../core/board-choices.service';
import { BoardReadForRun } from '../../../core/board-read-for-run';
import { signal } from '@angular/core';
import { githubProjectAddressForRef } from '../../../../services/project/project-assets-read.service';
import { qualifiedLocalReadVersionGuidance } from '../../../../services/project/project-query-api.service';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';
import { MAX_NESTED_TAB_DEPTH, widgetAtTabPath } from './nested-tab-path';

export interface BoardResultSnapshot {
  readonly queryId: string;
  readonly result: FederatedQueryResult;
}

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  styleUrl: './board-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TabsWidgetComponent, RouterLink, IonButton],
})
export class BoardWidgetComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly queries = inject(QueriesService);
  private readonly sqlite = inject(PublicSqliteQueryService);
  private readonly destroyRef = inject(DestroyRef);
  readonly choices = inject(BoardChoicesService);
  private generation = 0;
  private destroyed = false;
  readonly running = signal(false);
  private readonly ownSnapshot = signal<BoardResultSnapshot | undefined>(
    undefined,
  );
  /** Shared only through this card's nested widget tree; never persisted. */
  readonly resultSnapshot =
    input<WritableSignal<BoardResultSnapshot | undefined>>();
  readonly snapshotStore = computed(
    () => this.resultSnapshot() ?? this.ownSnapshot,
  );
  readonly result = computed(() => {
    const snapshot = this.snapshotStore()();
    return snapshot && snapshot.queryId === this.queryId()
      ? snapshot.result
      : undefined;
  });
  readonly runError = signal<string | undefined>(undefined);
  readonly choiceError = signal<string | undefined>(undefined);
  readonly unsupportedReason = signal<string | undefined>(undefined);
  readonly definitionLoading = signal(false);
  readonly definition = signal<IQueryDef | undefined>(undefined);
  readonly remembered = computed(
    () =>
      !this.sessionOnly() &&
      this.choices.read(this.projectRef(), this.boardId()).selectedQueryId ===
        this.queryId(),
  );
  readonly canRemember = computed(
    () => !this.sessionOnly() && this.choices.canPersist(this.projectRef()),
  );
  readonly sessionOnly = computed(
    () => this.queryParams().get('mode') === 'tutorial',
  );
  readonly level = input<number>();
  readonly widgetPath = input<readonly string[]>([]);
  readonly maxTabDepth = MAX_NESTED_TAB_DEPTH;
  readonly nestedWidgetComponent = BoardWidgetComponent;
  readonly cardTab = input<QueryType | 'grid' | 'card'>();
  // TODO: Skipped for migration because:
  //  This input is used in a control flow expression (e.g. `@if` or `*ngIf`)
  //  and migrating would break narrowing currently.
  readonly widgetDef = input<BoardWidget>();

  // In boards.go, BoardWidget.data for name "SQL" is the whole SQLWidgetDef
  // ({ title?, parameters?, sql: { query } }), not the inner settings.
  readonly tabsWidgetDef = computed(
    () => this.widgetDef()?.data as TabsWidgetDef | undefined,
  );
  readonly sqlWidgetDef = computed(
    () => this.widgetDef()?.data as SQLWidgetDef | undefined,
  );
  readonly queryId = computed(() => this.sqlWidgetDef()?.sql?.queryId?.trim());
  readonly boardId = input<string>();
  readonly cardId = input<string>();
  readonly readBoardForRun = input<BoardReadForRun>();
  readonly visibleRows = computed(
    () => this.result()?.recordset.rows.slice(0, 50) || [],
  );

  private queryReadRef(ref: IProjectRef): IProjectRef {
    if (
      ref.projectApi ||
      !ref.branch ||
      !['github', 'github.com'].includes(ref.storeId)
    )
      return ref;
    return { ...ref, projectId: githubProjectAddressForRef(ref) };
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.generation++;
    });
    effect((onCleanup) => {
      const ref = this.projectRef();
      const id = this.queryId();
      this.boardId();
      this.cardId();
      this.widgetPath();
      this.readBoardForRun();
      this.choices.actor();
      this.generation++;
      const generation = this.generation;
      this.definition.set(undefined);
      if (!this.resultSnapshot()) this.ownSnapshot.set(undefined);
      this.runError.set(undefined);
      this.choiceError.set(undefined);
      this.running.set(false);
      this.unsupportedReason.set(undefined);
      if (!ref || !id || this.widgetDef()?.name !== 'SQL') return;
      // The existing public GitHub query reader ignores branch. The qualified
      // reader and board revalidation must both be available before Run.
      if (
        ref.spaceID ||
        (!ref.projectApi && !['github', 'github.com'].includes(ref.storeId))
      ) {
        this.unsupportedReason.set(
          'Run from this project connection is unavailable. Open the saved query to run it there.',
        );
        return;
      }
      let queryRef: IProjectRef;
      try {
        queryRef = this.queryReadRef(ref);
      } catch {
        this.unsupportedReason.set(
          'The project branch conflicts with its GitHub address. Open the saved query to inspect it.',
        );
        return;
      }
      this.definitionLoading.set(true);
      const subscription = this.queries.getQuery(queryRef, id).subscribe({
        next: (definition) => {
          if (this.generation !== generation) return;
          this.definitionLoading.set(false);
          const reason = this.ineligibleReason(definition, id);
          this.unsupportedReason.set(reason);
          if (!reason) this.definition.set(definition);
        },
        error: () => {
          if (this.generation !== generation) return;
          this.definitionLoading.set(false);
          this.unsupportedReason.set(
            'This saved query could not be checked. Open it to inspect its source.',
          );
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  private stillCurrent(
    generation: number,
    ref: IProjectRef,
    boardId: string,
    cardId: string,
    queryId: string,
    actor: string | undefined,
    readBoard: BoardReadForRun,
    path: readonly string[],
  ): boolean {
    return (
      !this.destroyed &&
      this.generation === generation &&
      this.projectRef() === ref &&
      equalProjectRef(this.projectRef(), ref) &&
      this.boardId() === boardId &&
      this.cardId() === cardId &&
      this.queryId() === queryId &&
      this.widgetDef()?.name === 'SQL' &&
      this.choices.actor() === actor &&
      this.readBoardForRun() === readBoard &&
      this.widgetPath() === path
    );
  }

  private ineligibleReason(
    definition: IQueryDef,
    id: string,
  ): string | undefined {
    if (definition.id !== id && !id.endsWith('/' + definition.id))
      return 'The saved query identity changed. Open it to inspect the source.';
    if (definition.request.queryType !== QueryType.SQL)
      return 'This widget is not a SQL query. Open the saved query to run it.';
    if (definition.connectionId !== 'chinook-sqlite' || definition.federation)
      return 'This source cannot run in the board yet. Open the saved query to choose its supported runtime.';
    if (definition.parameters?.length)
      return 'This query needs inputs. Open the saved query to enter them and run it.';
    return undefined;
  }

  async run(): Promise<void> {
    const ref = this.projectRef();
    const boardId = this.boardId();
    const cardId = this.cardId();
    const queryId = this.queryId();
    const readBoard = this.readBoardForRun();
    const path = this.widgetPath();
    const actor = this.choices.actor();
    if (
      !ref ||
      !boardId ||
      !cardId ||
      !queryId ||
      !readBoard ||
      !this.definition() ||
      this.running() ||
      this.unsupportedReason()
    )
      return;
    const generation = ++this.generation;
    this.running.set(true);
    this.snapshotStore().set(undefined);
    this.runError.set(undefined);
    try {
      const board = await firstValueFrom(
        readBoard(ref, boardId).pipe(timeout(15000)),
      );
      if (
        !this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        return;
      const matchingCards = board.rows
        ?.flatMap((row) => row.cards || [])
        .filter((card) => card.id === cardId);
      const currentCard =
        matchingCards?.length === 1 ? matchingCards[0] : undefined;
      const currentWidget = widgetAtTabPath(currentCard?.widget, path);
      if (
        board.id !== boardId ||
        currentWidget?.name !== 'SQL' ||
        (
          currentWidget.data as SQLWidgetDef | undefined
        )?.sql?.queryId?.trim() !== queryId
      )
        throw new Error(
          'This board card changed. Reopen the board before running it.',
        );
      const queryRef = this.queryReadRef(ref);
      const definition = await firstValueFrom(
        this.queries.getQuery(queryRef, queryId).pipe(timeout(15000)),
      );
      if (
        !this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        return;
      const reason = this.ineligibleReason(definition, queryId);
      if (reason) throw new Error(reason);
      if (
        !this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        return;
      const result = await this.sqlite.run(queryRef, definition);
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      ) {
        this.snapshotStore().set({ queryId, result });
        this.rememberChoice();
      }
    } catch (error) {
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        this.runError.set(
          qualifiedLocalReadVersionGuidance(error) ??
            (error instanceof Error &&
            error.message.startsWith('This board card changed.')
              ? error.message
              : 'The saved query could not run. Try again or open the saved query to inspect it.'),
        );
    } finally {
      if (
        this.stillCurrent(
          generation,
          ref,
          boardId,
          cardId,
          queryId,
          actor,
          readBoard,
          path,
        )
      )
        this.running.set(false);
    }
  }

  rememberChoice(): void {
    const ref = this.projectRef();
    const boardId = this.boardId();
    const queryId = this.queryId();
    if (ref && boardId && queryId && this.canRemember())
      this.choiceError.set(
        this.choices.selectQuery(ref, boardId, queryId)
          ? undefined
          : 'This browser could not remember the selected query.',
      );
  }

  displayCell(cell: { readonly value?: unknown }): string {
    return cell.value == null ? 'NULL' : String(cell.value);
  }
  readonly queryUrlTree = computed<UrlTree | undefined>(() => {
    const ref = this.projectRef();
    const id = this.queryId();
    if (!ref || !id) return undefined;
    const href = projectPageHref(ref, ['query', id]);
    if (href === '/') return undefined;
    const tree = this.router.parseUrl(href);
    tree.queryParams = { ...tree.queryParams, id };
    return tree;
  });

  readonly boardContext = input<IBoardContext>();
  readonly projectRef = input<IProjectRef>();
}

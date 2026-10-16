import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { IonButton } from '@ionic/angular';
import {
  BoardWidget,
  SQLWidgetDef,
  TabsWidgetDef,
} from '@datatug/board-models';
import { IBoardContext } from '../../../../models/definition/board/board';
import { IProjectRef } from '../../../../core/project-context';
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
import {
  formatGithubProjectId,
  readGithubProjectId,
} from '../../../../nav/github-project-address';
import { TabsWidgetComponent } from '../widgets/tabs-widget/tabs-widget.component';

@Component({
  selector: 'sneat-datatug-board-widget',
  templateUrl: './board-widget.component.html',
  styleUrl: './board-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TabsWidgetComponent, RouterLink, IonButton],
})
export class BoardWidgetComponent {
  private readonly router = inject(Router);
  private readonly queries = inject(QueriesService);
  private readonly sqlite = inject(PublicSqliteQueryService);
  readonly choices = inject(BoardChoicesService);
  private generation = 0;
  readonly running = signal(false);
  readonly result = signal<FederatedQueryResult | undefined>(undefined);
  readonly runError = signal<string | undefined>(undefined);
  readonly choiceError = signal<string | undefined>(undefined);
  readonly unsupportedReason = signal<string | undefined>(undefined);
  readonly definitionLoading = signal(false);
  readonly definition = signal<IQueryDef | undefined>(undefined);
  readonly remembered = computed(
    () =>
      this.choices.read(this.projectRef(), this.boardId()).selectedQueryId ===
      this.queryId(),
  );
  readonly level = input<number>();
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
    const address = readGithubProjectId(ref.projectId);
    if (!address.ok || (address.id.ref && address.id.ref !== ref.branch))
      throw new Error('The project branch conflicts with its GitHub address.');
    return {
      ...ref,
      projectId: formatGithubProjectId({ ...address.id, ref: ref.branch }),
    };
  }

  constructor() {
    effect((onCleanup) => {
      const ref = this.projectRef();
      const id = this.queryId();
      this.boardId();
      this.cardId();
      this.choices.actor();
      this.generation++;
      const generation = this.generation;
      this.definition.set(undefined);
      this.result.set(undefined);
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
    this.result.set(undefined);
    this.runError.set(undefined);
    this.rememberChoice();
    try {
      const board = await firstValueFrom(
        readBoard(ref, boardId).pipe(timeout(15000)),
      );
      const matchingCards = board.rows
        ?.flatMap((row) => row.cards || [])
        .filter((card) => card.id === cardId);
      const currentCard =
        matchingCards?.length === 1 ? matchingCards[0] : undefined;
      const currentWidget = currentCard?.widget;
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
      const reason = this.ineligibleReason(definition, queryId);
      if (reason) throw new Error(reason);
      const result = await this.sqlite.run(queryRef, definition);
      if (generation === this.generation && actor === this.choices.actor())
        this.result.set(result);
    } catch (error) {
      if (generation === this.generation)
        this.runError.set(
          error instanceof Error &&
            error.message.startsWith('This board card changed.')
            ? error.message
            : 'The saved query could not run. Try again or open the saved query to inspect it.',
        );
    } finally {
      if (generation === this.generation) this.running.set(false);
    }
  }

  rememberChoice(): void {
    const ref = this.projectRef();
    const boardId = this.boardId();
    const queryId = this.queryId();
    if (ref && boardId && queryId)
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

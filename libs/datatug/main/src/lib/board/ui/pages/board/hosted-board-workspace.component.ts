import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
} from '@ionic/angular';
import {
  Board,
  editBoardDefinition,
  BoardDefinitionEdit,
  BoardCard,
  canonicalBoardQueryIds,
} from '@datatug/board-models';
import { firstValueFrom, map, tap } from 'rxjs';
import {
  ProjectAssetsApiService,
  BoardAssetSnapshot,
} from '../../../../services/project/project-assets-api.service';
import { ProjectQueryApiService } from '../../../../services/project/project-query-api.service';
import { QueryType } from '../../../../models/definition/query-def';
import { projectPageHref } from '../../../../nav/project-page-href';
import { detectiveErrorMessage } from '../../../../detective/detective-client.service';
import { IBoardContext } from '../../../../models/definition/board/board';
import { BoardComponent } from '../../components/board/board.component';
import { HostedBoardScope } from '../../../core/hosted-board-scope';
import {
  BoardSaveIntent,
  BoardSaveJournal,
} from '../../../core/board-save-intent';

interface QueryParameter {
  id: string;
  type: string;
  isRequired?: boolean;
  isMultiValue?: boolean;
  defaultValue?: unknown;
}
interface QueryChoice {
  id: string;
  title?: string;
  type: string;
  parameters?: QueryParameter[];
}
interface QueryFolder {
  id: string;
  folders?: QueryFolder[];
  items?: QueryChoice[];
}
@Component({
  selector: 'sneat-datatug-hosted-board-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [HostedBoardScope],
  imports: [
    RouterLink,
    IonButton,
    IonItem,
    IonLabel,
    IonInput,
    IonSelect,
    IonSelectOption,
    BoardComponent,
  ],
  template: ` <section aria-label="Hosted board">
    <a
      [routerLink]="listHref()"
      [queryParams]="{ environment: scope.environment() || null }"
      >Back to Boards</a
    >
    <h1>{{ isNew() ? 'New board' : draft()?.title || 'Board' }}</h1>
    <ion-item
      ><ion-label>Environment</ion-label
      ><ion-select
        aria-label="Board environment"
        [value]="scope.environment()"
        (ionChange)="scope.choose($event.detail.value)"
        [disabled]="saving()"
      >
        @for (env of scope.environments(); track env) {
          <ion-select-option [value]="env">{{ env }}</ion-select-option>
        }
      </ion-select></ion-item
    >
    @if (scope.loading() || loading()) {
      <p role="status">Loading board…</p>
    }
    @if (scope.error()) {
      <p role="alert">{{ scope.error() }}</p>
      <ion-button (click)="scope.refresh()">Retry project access</ion-button>
    }
    @if (!scope.loading() && !scope.error() && !scope.admitted()) {
      <p role="status">Choose an available environment to open this board.</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
      <ion-button (click)="reload()" [disabled]="saving() || !!pending()"
        >Reload board</ion-button
      >
    }
    @if (notice()) {
      <p role="status">{{ notice() }}</p>
    }
    @if (draft(); as board) {
      @if (!scope.canWrite()) {
        <p role="status">You can view this board, but cannot save changes.</p>
      }
      @if (scope.canWrite()) {
        <ion-item
          ><ion-label position="stacked">Board title</ion-label
          ><ion-input
            aria-label="Board title"
            [value]="board.title"
            [disabled]="saving() || !!pending()"
            (ionInput)="
              edit({ type: 'title', title: $event.detail.value || '' })
            "
        /></ion-item>
        <section aria-label="Saved query widgets">
          <h2>Saved query widgets</h2>
          @for (card of cards(); track card.id) {
            <div>
              <strong>{{ card.title || card.id }}</strong>
              @if (card.widget?.name === 'SQL') {
                <label
                  >Saved query
                  <select
                    [attr.aria-label]="
                      'Saved query for ' + (card.title || card.id)
                    "
                    [value]="cardQuery(card)"
                    [disabled]="saving() || !!pending()"
                    (change)="
                      edit({
                        type: 'set-query',
                        cardId: card.id,
                        queryId: $any($event.target).value,
                      })
                    "
                  >
                    @for (query of queries(); track query.id) {
                      <option [value]="query.id">
                        {{ query.title || query.id }}
                      </option>
                    }
                  </select></label
                >

                @for (parameter of cardParameters(card); track parameter.id) {
                  <label
                    >{{ parameter.id
                    }}{{ parameter.isRequired ? ' (required)' : '' }}
                    <input
                      [attr.aria-label]="
                        parameter.id + ' for ' + (card.title || card.id)
                      "
                      [value]="parameterValue(card, parameter)"
                      [disabled]="saving() || !!pending()"
                      (change)="
                        bindParameter(
                          card,
                          parameter,
                          $any($event.target).value
                        )
                      "
                    />
                  </label>
                }
              } @else {
                <p>
                  Existing {{ card.widget?.name || 'empty' }} widget is
                  preserved.
                </p>
              }
              <ion-button
                (click)="edit({ type: 'remove-card', cardId: card.id })"
                [disabled]="saving() || !!pending()"
                >Remove {{ card.title || card.id }}</ion-button
              >
            </div>
          }
          <label
            >Add saved query
            <select
              aria-label="Add saved query"
              [value]="selectedQuery()"
              [disabled]="saving() || !!pending()"
              (change)="selectedQuery.set($any($event.target).value)"
            >
              <option value="">Choose a saved query</option>
              @for (query of queries(); track query.id) {
                <option [value]="query.id">
                  {{ query.title || query.id }}
                </option>
              }
            </select></label
          >
          <ion-button
            (click)="addQuery()"
            [disabled]="!selectedQuery() || saving() || !!pending()"
            >Add query widget</ion-button
          >
        </section>
        @if (pending()) {
          <p role="status">
            This save may already have completed. Retry the original operation
            before starting another save.
          </p>
          @if (conflict()) {
            <p role="alert">
              The board changed. Review the current saved definition before
              creating a new save.
            </p>
          }
          <ion-button (click)="reviewCurrent()" [disabled]="saving()"
            >Review current saved board</ion-button
          >
          @if (reviewed()) {
            <p role="status">
              Current saved board reviewed: {{ reviewed()?.board?.title }}.
              Starting a new save may repeat changes already delivered.
            </p>
            <section aria-label="Current saved board review">
              <h3>Current saved widgets</h3>
              <ul>
                @for (
                  card of reviewed()?.board?.rows?.flatMap(flattenCards) || [];
                  track card.id
                ) {
                  <li>
                    {{ card.title || card.id }} ·
                    {{ card.widget?.name || 'empty' }}
                  </li>
                }
              </ul>
              <p>Saved queries: {{ reviewedQueries() }}</p>
            </section>
            <ion-button (click)="resumeDraft()"
              >Keep draft and start a new save</ion-button
            >
            <ion-button (click)="useCurrent()"
              >Use current saved board</ion-button
            >
          }
          @if (reviewedAbsent()) {
            <p role="status">
              No saved board currently exists at this identity. The earlier
              operation may have completed before it was deleted.
            </p>
            <ion-button (click)="resumeDraft()"
              >Review draft and start a new create</ion-button
            >
          }
        }
        <ion-button
          (click)="save()"
          [disabled]="
            saving() || loading() || conflict() || !board.title.trim()
          "
          >{{
            saving()
              ? 'Saving…'
              : pending()
                ? 'Retry original save'
                : 'Save board'
          }}</ion-button
        >
      }
      <sneat-datatug-board
        [boardDef]="board"
        [projectRef]="scope.page.ref()"
        [boardContext]="boardContext()"
        [readBoardForRun]="readForRun"
      />
    }
  </section>`,
})
export class HostedBoardWorkspaceComponent {
  private readonly destroyRef = inject(DestroyRef);
  readonly scope = inject(HostedBoardScope);
  private readonly api = inject(ProjectAssetsApiService);
  private readonly queryApi = inject(ProjectQueryApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly boardId = computed(() => this.params().get('board') || 'new');
  readonly isNew = computed(
    () => this.route.snapshot.data['createBoard'] === true,
  );
  readonly draft = signal<Board | undefined>(undefined);
  readonly revision = signal<string | undefined>(undefined);
  readonly queries = signal<QueryChoice[]>([]);
  readonly selectedQuery = signal('');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly pending = signal<BoardSaveIntent | undefined>(undefined);
  readonly conflict = signal(false);
  readonly reviewedAbsent = signal(false);
  readonly reviewed = signal<BoardAssetSnapshot | undefined>(undefined);
  private readonly refresh = signal(0);
  private generation = 0;
  private readonly journal = new BoardSaveJournal(
    typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
  );
  readonly key = computed(() =>
    JSON.stringify([this.scope.identity(), this.boardId()]),
  );
  readonly cards = computed(
    () => this.draft()?.rows?.flatMap((row) => row.cards ?? []) ?? [],
  );
  readonly boardContext = computed<IBoardContext>(() => ({
    mode: 'view',
    parameters: {},
    environment: this.scope.environment(),
    executionTarget: { kind: 'hosted-cloud' },
  }));
  readonly readForRun = (
    ref: NonNullable<ReturnType<typeof this.scope.page.ref>>,
    id: string,
  ) => {
    const key = this.key(),
      generation = this.generation;
    return this.api.board(ref, this.scope.environment(), id).pipe(
      tap({
        error: (error) => {
          if (this.active(key, generation)) this.failure(error);
        },
      }),
      map((snapshot) => snapshot.board),
    );
  };
  constructor() {
    effect((onCleanup) => {
      const key = this.key();
      const admitted = this.scope.admitted();
      this.refresh();
      let cancelled = false;
      const generation = ++this.generation;
      this.draft.set(undefined);
      this.queries.set([]);
      this.error.set('');
      this.notice.set('');
      this.pending.set(undefined);
      this.conflict.set(false);
      this.reviewed.set(undefined);
      this.reviewedAbsent.set(false);
      this.revision.set(undefined);
      this.saving.set(false);
      this.loading.set(false);
      this.selectedQuery.set('');
      if (!admitted) return;
      untracked(() => {
        void this.load(key, generation, () => cancelled);
      });
      onCleanup(() => {
        cancelled = true;
      });
    });
  }
  private active(key: string, generation: number) {
    return (
      !this.destroyRef.destroyed &&
      key === this.key() &&
      generation === this.generation &&
      this.scope.admitted()
    );
  }
  private async load(
    key: string,
    generation: number,
    cancelled: () => boolean,
  ) {
    const ref = this.scope.page.ref();
    if (!ref) return;
    this.loading.set(true);
    try {
      const folder = await firstValueFrom(
        this.queryApi.folder<QueryFolder>(ref),
      );
      const choices: QueryChoice[] = [];
      const ids = new Set<string>();
      const walk = (value: QueryFolder, path: string, depth = 0) => {
        if (depth > 8 || choices.length > 2000)
          throw new Error('Query catalog exceeds editor limits.');
        for (const item of value.items ?? []) {
          if (
            ![QueryType.SQL, QueryType.DTQL, QueryType.TugQL].includes(
              item.type as QueryType,
            )
          )
            continue;
          const id = path ? path + '/' + item.id : item.id;
          if (ids.has(id))
            throw new Error('Query catalog contains duplicate identities.');
          ids.add(id);
          choices.push({
            id: path ? path + '/' + item.id : item.id,
            title: item.title,
            type: item.type,
            parameters: item.parameters,
          });
        }
        for (const child of value.folders ?? [])
          walk(child, path ? path + '/' + child.id : child.id, depth + 1);
      };
      walk(folder, '');
      const pending = this.journal.read(key);
      const held = this.isNew()
        ? undefined
        : await firstValueFrom(
            this.api.board(ref, this.scope.environment(), this.boardId()),
          ).catch((error: unknown) => {
            if (
              pending &&
              error instanceof HttpErrorResponse &&
              error.status === 404
            )
              return undefined;
            throw error;
          });
      if (cancelled() || !this.active(key, generation)) return;
      this.queries.set(choices);
      this.revision.set(held?.revision);
      this.pending.set(pending);
      this.draft.set(
        pending?.write.board ??
          held?.board ?? {
            id: 'board-' + crypto.randomUUID(),
            title: '',
            rows: [],
          },
      );
      if (pending) this.revision.set(pending.write.ifMatch);
    } catch (error) {
      if (!cancelled() && this.active(key, generation)) this.failure(error);
    } finally {
      if (!cancelled() && this.active(key, generation)) this.loading.set(false);
    }
  }
  readonly flattenCards = (row: { cards?: BoardCard[] }) => row.cards ?? [];
  reviewedQueries(): string {
    const board = this.reviewed()?.board;
    return board ? canonicalBoardQueryIds(board).join(', ') : '';
  }
  listHref() {
    return projectPageHref(this.scope.page.ref(), 'boards');
  }
  reload() {
    this.refresh.update((n) => n + 1);
  }
  cardQuery(card: BoardCard) {
    return (
      (card.widget?.data as { sql?: { queryId?: string } })?.sql?.queryId || ''
    );
  }
  edit(action: BoardDefinitionEdit) {
    if (this.pending() || this.saving() || !this.scope.canWrite()) return;
    try {
      this.error.set('');
      const board = this.draft();
      if (board)
        this.draft.set(
          editBoardDefinition(
            board,
            action,
            this.queries().map((query) => query.id),
          ),
        );
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Board edit is unavailable.',
      );
    }
  }
  cardParameters(card: BoardCard): QueryParameter[] {
    return (
      this.queries().find((query) => query.id === this.cardQuery(card))
        ?.parameters ?? []
    );
  }
  parameterValue(card: BoardCard, parameter: QueryParameter): string {
    const binding = (
      card.widget?.data as {
        sql?: {
          parameters?: {
            id: string;
            value?: unknown;
            boardParameterId?: string;
          }[];
        };
      }
    )?.sql?.parameters?.find((item) => item.id === parameter.id);
    if (binding?.boardParameterId)
      return `Board parameter: ${binding.boardParameterId}`;
    const value = binding?.value ?? parameter.defaultValue;
    return value === undefined
      ? ''
      : Array.isArray(value)
        ? value.join(', ')
        : String(value);
  }
  bindParameter(
    card: BoardCard,
    parameter: QueryParameter,
    text: string,
  ): void {
    try {
      const parse = (value: string): unknown => {
        if (['number', 'integer', 'decimal'].includes(parameter.type)) {
          const number = Number(value);
          if (
            !value.trim() ||
            !Number.isFinite(number) ||
            (parameter.type === 'integer' && !Number.isSafeInteger(number))
          )
            throw new Error('Enter a supported exact numeric value.');
          if (parameter.type === 'decimal' && String(number) !== value.trim())
            throw new Error(
              'This decimal cannot be preserved exactly by the current editor.',
            );
          return number;
        }
        if (parameter.type === 'boolean') {
          if (!['true', 'false'].includes(value))
            throw new Error('Enter true or false.');
          return value === 'true';
        }
        if (['string', 'date', 'datetime'].includes(parameter.type))
          return value;
        throw new Error('This parameter type requires a compatible editor.');
      };
      const value =
        text === ''
          ? undefined
          : parameter.isMultiValue
            ? text.split(',').map((value) => parse(value.trim()))
            : parse(text);
      this.edit({
        type: 'bind-query',
        cardId: card.id,
        parameterId: parameter.id,
        value,
      });
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Invalid parameter value.',
      );
    }
  }
  addQuery() {
    const query = this.queries().find((q) => q.id === this.selectedQuery());
    if (query)
      this.edit({
        type: 'add-query',
        cardId: 'card-' + crypto.randomUUID(),
        queryId: query.id,
        title: query.title || query.id,
      });
  }
  private failure(error: unknown) {
    this.error.set(detectiveErrorMessage(error, true));
    if (
      error instanceof HttpErrorResponse &&
      [401, 403].includes(error.status)
    ) {
      this.draft.set(undefined);
      this.queries.set([]);
      this.scope.deny(error);
    }
  }
  async save() {
    const ref = this.scope.page.ref(),
      board = this.draft();
    if (
      !ref ||
      !board ||
      !this.scope.canWrite() ||
      this.saving() ||
      this.conflict()
    )
      return;
    const key = this.key(),
      generation = this.generation;
    this.saving.set(true);
    this.error.set('');
    try {
      const intent =
        this.pending() ?? this.journal.create(key, board, this.revision());
      this.pending.set(intent);
      await firstValueFrom(
        this.api.saveBoard(ref, this.scope.environment(), intent.write),
      );
      if (!this.active(key, generation)) return;
      // A replay may return an older receipt. Always fetch the current authorized definition.
      const current = await firstValueFrom(
        this.api.board(ref, this.scope.environment(), intent.write.board.id),
      );
      if (!this.active(key, generation)) return;
      this.journal.clear(key);
      this.pending.set(undefined);
      this.draft.set(current.board);
      this.revision.set(current.revision);
      this.notice.set('Board saved.');
      if (this.isNew())
        await this.router.navigateByUrl(
          projectPageHref(ref, ['board', current.board.id]) +
            '?environment=' +
            encodeURIComponent(this.scope.environment()),
          { replaceUrl: true },
        );
    } catch (error) {
      if (this.active(key, generation)) {
        this.conflict.set(
          error instanceof HttpErrorResponse && error.status === 409,
        );
        this.failure(error);
      }
    } finally {
      if (this.active(key, generation)) this.saving.set(false);
    }
  }
  async reviewCurrent() {
    const ref = this.scope.page.ref(),
      intent = this.pending();
    if (!ref || !intent || this.saving()) return;
    const key = this.key(),
      generation = this.generation;
    this.saving.set(true);
    this.reviewed.set(undefined);
    this.reviewedAbsent.set(false);
    try {
      const current = await firstValueFrom(
        this.api.board(ref, this.scope.environment(), intent.write.board.id),
      );
      if (this.active(key, generation)) this.reviewed.set(current);
    } catch (error) {
      if (this.active(key, generation)) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.reviewedAbsent.set(true);
          this.error.set('');
        } else this.failure(error);
      }
    } finally {
      if (this.active(key, generation)) this.saving.set(false);
    }
  }
  resumeDraft() {
    const current = this.reviewed();
    if ((!current && !this.reviewedAbsent()) || !this.scope.canWrite()) return;
    this.journal.clear(this.key());
    this.pending.set(undefined);
    this.conflict.set(false);
    this.revision.set(current?.revision);
    this.reviewed.set(undefined);
    this.reviewedAbsent.set(false);
    this.notice.set(
      'Review the draft before saving again; the earlier operation may already have completed.',
    );
  }
  useCurrent() {
    const current = this.reviewed();
    if (!current) return;
    this.resumeDraft();
    this.draft.set(current.board);
  }
}

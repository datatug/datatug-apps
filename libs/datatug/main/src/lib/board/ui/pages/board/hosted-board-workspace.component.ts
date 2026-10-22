import { EvidenceSharePanelComponent, EvidenceShareSelection } from '../../../../evidence/evidence-share-panel.component';
import { BoardChartEditorComponent } from './board-chart-editor.component';
import { parseBoardParameterValue } from '../../../core/board-parameter-value';
import {
  IParameterDef,
  IParamWithDefAndValue,
} from '../../../../models/definition/parameter';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IonButton,
  IonButtons,
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
import { filter, firstValueFrom, map, merge, switchMap, takeUntil, tap } from 'rxjs';
import { cardFromBoardCard } from '../../../../cards/card-model';
import { ProjectCardsService } from '../../../../cards/project-cards.service';
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
    EvidenceSharePanelComponent,
    BoardChartEditorComponent,
    RouterLink,
    IonButton,
    IonButtons,
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
    <header class="board-heading">
      <h1>{{ isNew() ? 'New board' : draft()?.title || 'Board' }}</h1>
      @if (scope.admitted() && scope.canWrite() && draft() && !editing()) {
        <ion-buttons
          ><ion-button (click)="beginEdit()"
            >Edit board</ion-button
          ></ion-buttons
        >
      }
    </header>
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
    @if (scope.admitted()) {
      <sneat-datatug-evidence-share-panel [environment]="scope.environment()" [disabled]="saving()" (selected)="evidenceSelection.set($event)" />
    }
    @if (scope.admitted() && parameters().length) {
      <section aria-label="Board runtime parameters">
        <p>
          Parameter changes clear previous results. Run or refresh a card to use
          the new values. These values are not saved with the board.
        </p>
        @for (parameter of parameters(); track parameter.def.id) {
          <ion-item>
            <ion-label>{{ parameter.def.title || parameter.def.id }}</ion-label>
            <ion-input
              [attr.aria-label]="'Board parameter ' + parameter.def.id"
              [placeholder]="parameter.def.type"
              [value]="parameterText(parameter)"
              [attr.aria-invalid]="
                parameterErrors()[parameter.def.id] ? 'true' : null
              "
              [attr.aria-describedby]="
                parameterErrors()[parameter.def.id]
                  ? 'hosted-board-parameter-error-' + parameter.def.id
                  : null
              "
              (ionInput)="setParameterValue(parameter, $event.detail.value)"
            />
          </ion-item>
          @if (parameterErrors()[parameter.def.id]; as error) {
            <p
              role="alert"
              [id]="'hosted-board-parameter-error-' + parameter.def.id"
            >
              {{ error }}
            </p>
          }
        }
      </section>
    }
    @if (scope.admitted() ? draft() : undefined; as board) {
      @if (!scope.canWrite()) {
        <p role="status">You can view this board, but cannot save changes.</p>
      }
      @if (scope.canWrite() && editing()) {
        <section class="board-editor" aria-label="Edit board definition">
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
          <section aria-label="Board parameter declarations">
            <h2>Board inputs</h2>
            <p>
              Declare reusable inputs here; active values above are never saved.
            </p>
            <label
              >Parameter ID
              <input
                aria-label="Parameter ID"
                [value]="newParameterId()"
                (input)="newParameterId.set($any($event.target).value)"
                [disabled]="saving() || !!pending()"
            /></label>
            <label
              >Parameter type
              <select
                aria-label="Parameter type"
                [value]="newParameterType()"
                (change)="newParameterType.set($any($event.target).value)"
                [disabled]="saving() || !!pending()"
              >
                <option value="integer">Integer</option>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="datetime">Date and time</option>
              </select></label
            >
            <ion-button
              (click)="declareParameter()"
              [disabled]="!newParameterId() || saving() || !!pending()"
              >Add or update required input</ion-button
            >
          </section>
          <section aria-label="Saved query widgets">
            <h2>Saved query widgets</h2>
            @for (card of cards(); track card.id) {
              <div>
                <strong>{{ card.title || card.id }}</strong>
                @if (
                  card.widget?.name === 'SQL' || card.widget?.name === 'chart'
                ) {
                  <sneat-datatug-board-chart-editor
                    [card]="card"
                    [queries]="queries()"
                    [project]="scope.page.ref()"
                    [scopeIdentity]="
                      scope.page.identity() + ':' + scope.environment()
                    "
                    [boardParameters]="board.parameters || []"
                    [disabled]="saving() || !!pending()"
                    (definition)="
                      edit({
                        type: 'set-chart',
                        cardId: card.id,
                        definition: $event,
                      })
                    "
                  />
                }
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
                        <option
                          [value]="query.id"
                          [selected]="query.id === cardQuery(card)"
                        >
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
                @if (card.widget) {
                  <ion-button
                    fill="outline"
                    (click)="saveAsProjectCard(card)"
                    [disabled]="saving() || !!pending() || savingCardId() === card.id"
                    >Save {{ card.title || card.id }} as project card</ion-button
                  >
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
                    card of reviewed()?.board?.rows?.flatMap(flattenCards) ||
                      [];
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
          <div class="editor-actions">
            @if (savedDefinition() && !pending()) {
              <ion-button
                fill="outline"
                (click)="cancelEdit()"
                [disabled]="saving()"
                >Cancel</ion-button
              >
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
          </div>
        </section>
      }
      <sneat-datatug-board
        [boardDef]="board"
        [projectRef]="scope.page.ref()"
        [boardContext]="boardContext()"
        [readBoardForRun]="readForRun"
      />
    }
  </section>`,
  styles: [
    `
      :host {
        display: block;
        padding: 16px;
      }
      .board-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      h1 {
        margin: 16px 0;
      }
      .board-editor {
        margin: 24px 0;
      }
      .board-editor > section {
        margin: 24px 0;
      }
      .board-editor label {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 16px 0;
      }
      .board-editor input,
      .board-editor select {
        padding: 10px;
        min-height: 44px;
        width: 100%;
        box-sizing: border-box;
      }
      .editor-actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 24px;
      }
    `,
  ],
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
  readonly savedDefinition = signal<Board | undefined>(undefined);
  private readonly editingKey = signal<string | undefined>(undefined);
  readonly editing = computed(
    () =>
      this.loadedKey() === this.key() &&
      (this.editingKey() === this.key() || !!this.pending()),
  );
  beginEdit() {
    if (this.loadedKey() === this.key() && this.scope.canWrite())
      this.editingKey.set(this.key());
  }
  cancelEdit() {
    const saved = this.savedDefinition();
    if (
      !saved ||
      this.pending() ||
      this.saving() ||
      this.loadedKey() !== this.key()
    )
      return;
    this.draft.set(saved);
    this.editingKey.set(undefined);
    this.error.set('');
    this.notice.set('Changes discarded. Showing the saved board.');
  }
  private readonly loadedKey = signal<string | undefined>(undefined);
  readonly revision = signal<string | undefined>(undefined);
  readonly queries = signal<QueryChoice[]>([]);
  readonly newParameterId = signal('');
  readonly newParameterType = signal('integer');
  declareParameter() {
    this.edit({
      type: 'set-parameter',
      parameter: {
        id: this.newParameterId(),
        type: this.newParameterType(),
        isRequired: true,
      },
    });
  }
  readonly selectedQuery = signal('');
  /** The inline card being copied into a project card right now. */
  readonly savingCardId = signal<string | undefined>(undefined);
  private readonly injector = inject(Injector);
  /**
   * "Save as project card" (spec REQ: dashboard-reference): creates a
   * project card from this inline card and its bound board parameters, then
   * turns the cell into a reference to it. The board itself is saved with
   * its own Save, like every other edit.
   */
  saveAsProjectCard(card: BoardCard) {
    const ref = this.scope.page.ref();
    const board = this.draft();
    if (!ref || !board || !this.editing() || !card.widget || this.savingCardId())
      return;
    const cards = this.injector.get(ProjectCardsService);
    const environment = this.scope.environment();
    this.error.set('');
    this.notice.set('');
    this.savingCardId.set(card.id);
    cards
      .listCards(ref, environment, true)
      .pipe(
        switchMap((briefs) => {
          const made = cardFromBoardCard(
            card,
            board,
            briefs.map((b) => b.id),
          );
          return cards
            .createCard(ref, made.card, environment)
            .pipe(map(() => made));
        }),
      )
      .subscribe({
        next: ({ card: created, ref: cardRef }) => {
          this.savingCardId.set(undefined);
          this.edit({ type: 'set-card-ref', cardId: card.id, ref: cardRef });
          this.notice.set(
            `Saved project card "${created.title}" (${created.id}). Save the board to use it in this dashboard.`,
          );
        },
        error: (error: unknown) => {
          this.savingCardId.set(undefined);
          this.error.set(
            error instanceof Error && error.message
              ? error.message
              : 'The project card could not be saved.',
          );
        },
      });
  }
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
  readonly parameters = signal<IParamWithDefAndValue[]>([]);
  readonly parameterErrors = signal<Readonly<Record<string, string>>>({});
  private readonly parameterValues = signal<IBoardContext['parameters']>({});
  private readonly parameterIdentity = computed(() =>
    JSON.stringify([
      this.key(),
      this.scope.admitted(),
      this.draft()?.parameters,
    ]),
  );
  readonly evidenceSelection = signal<EvidenceShareSelection | undefined>(undefined);
  readonly boardContext = computed<IBoardContext>(() => ({
    mode: 'view',
    parameters: this.scope.admitted() ? this.parameterValues() : {},
    environment: this.scope.environment(),
    executionTarget: { kind: 'hosted-cloud' },
    ...(this.evidenceSelection()?.identity === this.scope.page.identity() && this.evidenceSelection()?.environment === this.scope.environment() ? { evidenceSelection: this.evidenceSelection() } : {}),
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
    effect(() => {
      this.parameterIdentity();
      untracked(() => {
        this.parameters.set(
          (this.scope.admitted() ? (this.draft()?.parameters ?? []) : []).map(
            (def) => ({
              def: def as IParameterDef,
              val: '',
            }),
          ),
        );
        this.parameterErrors.set({});
        this.parameterValues.set({});
        for (const parameter of this.parameters()) {
          const value = (
            parameter.def as IParameterDef & { defaultValue?: unknown }
          ).defaultValue;
          if (value !== undefined) this.setParameterValue(parameter, value);
        }
      });
    });
    effect((onCleanup) => {
      const key = this.key();
      const admitted = this.scope.admitted();
      this.refresh();
      let cancelled = false;
      const generation = ++this.generation;
      this.loadedKey.set(undefined);
      this.draft.set(undefined);
      this.savedDefinition.set(undefined);
      this.editingKey.set(undefined);
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
  parameterText(parameter: IParamWithDefAndValue): string {
    return parameter.val == null ? '' : String(parameter.val);
  }
  setParameterValue(parameter: IParamWithDefAndValue, raw: unknown): void {
    if (
      !this.scope.admitted() ||
      !this.parameters().some((current) => current.def === parameter.def)
    )
      return;
    let value: IBoardContext['parameters'][string] | undefined;
    let error: string | undefined;
    try {
      value = parseBoardParameterValue(parameter.def, raw);
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : 'This parameter value is invalid.';
    }
    this.parameters.update((parameters) =>
      parameters.map((current) =>
        current.def === parameter.def
          ? {
              ...current,
              val: ['string', 'number', 'boolean'].includes(typeof raw)
                ? (raw as string | number | boolean)
                : undefined,
            }
          : current,
      ),
    );
    this.parameterErrors.update((errors) => {
      const next = { ...errors };
      if (error) next[parameter.def.id] = error;
      else delete next[parameter.def.id];
      return next;
    });
    // Publish a new context even on invalid/cleared input to cancel held runs.
    this.parameterValues.update((values) => {
      const next = { ...values };
      if (value) next[parameter.def.id] = value;
      else delete next[parameter.def.id];
      return next;
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
      this.loadedKey.set(key);
      this.queries.set(choices);
      this.revision.set(held?.revision);
      this.pending.set(pending);
      this.savedDefinition.set(held?.board);
      this.editingKey.set(this.isNew() || pending ? key : undefined);
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
    if (
      !this.editing() ||
      this.pending() ||
      this.saving() ||
      !this.scope.canWrite()
    )
      return;
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
      // A401 may follow a delivered save. Keep its exact journal for explicit
      // same-principal recovery; current403 revocation clears protected intent.
      if (error.status === 403) {
        this.journal.clear(this.key());
        this.pending.set(undefined);
      }
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
      !this.editing() ||
      this.loadedKey() !== this.key() ||
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
        this.api.saveBoard(ref, this.scope.environment(), intent.write).pipe(
          takeUntil(
            merge(
              this.scope.page.scopeChanges$,
              this.route.queryParamMap,
              this.route.paramMap,
            ).pipe(
              map(() => this.key()),
              filter((current) => current !== key),
            ),
          ),
          takeUntilDestroyed(this.destroyRef),
        ),
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
      this.savedDefinition.set(current.board);
      this.editingKey.set(undefined);
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
    this.savedDefinition.set(current?.board);
    this.editingKey.set(this.key());
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
    this.editingKey.set(undefined);
  }
}

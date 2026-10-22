import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonLabel,
  IonMenuButton,
  IonSegment,
  IonSegmentButton,
  IonSkeletonText,
  IonTextarea,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  arrowDownOutline,
  arrowUpOutline,
  refreshOutline,
  trashOutline,
} from 'ionicons/icons';
import {
  CARD_ID_PATTERN,
  validateProjectCard,
  type BoardWidget,
  type CardParameterDef,
  type ProjectCard,
  type TabWidget,
  type TabsWidgetDef,
} from '@datatug/board-models';
import { SneatDatatugPageTitleComponent } from '../components/page-title/sneat-datatug-page-title.component';
import { PROJECT_CARD_RESULTS } from '../board/core/board-query-results.service';
import { DatatugCoreModule } from '../core/datatug-core.module';
import { QueriesService } from '../queries/queries.service';
import { DatatugServicesNavModule } from '../services/nav/datatug-services-nav.module';
import { DatatugServicesProjectModule } from '../services/project/datatug-services-project.module';
import { DatatugServicesStoreModule } from '../services/repo/datatug-services-store.module';
import { DatatugServicesUnsortedModule } from '../services/unsorted/datatug-services-unsorted.module';
import { CardParametersEditorComponent } from './card-parameters-editor.component';
import {
  CardQueryChoice,
  CardWidgetEditorComponent,
} from './card-widget-editor.component';
import {
  EditableWidgetKind,
  WIDGET_KIND_LABELS,
  isEditableKind,
  newWidget,
} from './card-widget-model';
import {
  cardValidationError,
  coercePreviewValue,
  finishCard,
  flattenQueryFolder,
  newCardTemplate,
  slugifyCardId,
  uniqueCardId,
} from './card-model';
import { injectCardsContext } from './cards-context';
import { ProjectCardViewComponent } from './project-card-view.component';
import {
  CardNotFoundError,
  ProjectCardsService,
} from './project-cards.service';

addIcons({
  addOutline,
  arrowDownOutline,
  arrowUpOutline,
  refreshOutline,
  trashOutline,
});

type EditorTab = 'build' | 'preview' | 'json';

interface TabView {
  readonly title: string;
  readonly widgets: BoardWidget[];
}

const PREVIEW_DEBOUNCE_MS = 300;

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

function move<T>(list: T[], index: number, delta: number): void {
  const to = index + delta;
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(to, 0, item);
}

/**
 * Card page: create (`cards/new`) and edit (`card/:cardId`) a project card.
 *
 * Flow: Cards ──"New card"──▶ cards/new ──Save──▶ card/:id (replaceUrl)
 *       card/:id ──Delete (confirmed)──▶ Cards;  Back ──▶ Cards.
 * A cold deep-link to card/:id loads the card from the URL's id.
 */
@Component({
  selector: 'sneat-datatug-card-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatatugCoreModule,
    DatatugServicesNavModule,
    DatatugServicesProjectModule,
    DatatugServicesStoreModule,
    DatatugServicesUnsortedModule,
    CardParametersEditorComponent,
    CardWidgetEditorComponent,
    ProjectCardViewComponent,
    RouterLink,
    SneatDatatugPageTitleComponent,
    IonBackButton,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonIcon,
    IonInput,
    IonLabel,
    IonMenuButton,
    IonSegment,
    IonSegmentButton,
    IonSkeletonText,
    IonTextarea,
    IonToolbar,
  ],
  templateUrl: './card-page.component.html',
  styleUrl: './card-page.component.scss',
})
export class CardPageComponent {
  private readonly cards = inject(ProjectCardsService);
  private readonly queriesService = inject(QueriesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ctx = injectCardsContext();
  protected readonly cache = inject(PROJECT_CARD_RESULTS);
  protected readonly kindLabels = WIDGET_KIND_LABELS;

  readonly isNew = this.route.snapshot.data['newCard'] === true;
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly cardId = computed(() => this.params().get('cardId') ?? '');

  protected readonly tab = signal<EditorTab>('build');
  protected readonly card = signal<ProjectCard>(newCardTemplate());
  /** The saved form of the card (JSON), to tell unsaved changes. */
  private readonly baseline = signal(
    JSON.stringify(finishCard(newCardTemplate())),
  );
  protected readonly jsonText = signal(
    JSON.stringify(newCardTemplate(), null, 2),
  );
  protected readonly jsonError = signal<string | undefined>(undefined);
  protected readonly loading = signal(!this.isNew);
  protected readonly loadError = signal<string | undefined>(undefined);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | undefined>(undefined);
  protected readonly savedNotice = signal(false);
  private readonly idTouched = signal(false);
  private readonly existingIds = signal<readonly string[]>([]);
  protected readonly queries = signal<readonly CardQueryChoice[]>([]);
  protected readonly queriesError = signal<string | undefined>(undefined);
  private readonly reloads = signal(0);

  protected readonly previewText = signal<Record<string, string>>({});
  protected readonly previewInputError = signal<Record<string, string>>({});
  /** The card the preview shows: last valid form, after a short pause in editing. */
  protected readonly previewCard = signal<ProjectCard | undefined>(undefined);
  private readonly view = viewChild(ProjectCardViewComponent);

  protected readonly finished = computed(() => finishCard(this.card()));
  protected readonly problem = computed<string | undefined>(() => {
    const card = this.finished();
    if (!card.title.trim()) return 'Give the card a title.';
    if (!CARD_ID_PATTERN.test(card.id))
      return 'The card id may use letters, digits, - and _ (up to 128).';
    if (this.isNew && this.existingIds().includes(card.id))
      return `A card with the id "${card.id}" already exists.`;
    const duplicate = (card.parameters ?? []).find(
      (p, i, all) => all.findIndex((q) => q.id === p.id) !== i,
    );
    if (duplicate) return `Two inputs are named "${duplicate.id}".`;
    return cardValidationError(card);
  });
  protected readonly dirty = computed(
    () => JSON.stringify(this.finished()) !== this.baseline(),
  );
  protected readonly canSubmit = computed(
    () =>
      this.ctx.canWrite() &&
      !this.ctx.needsEnvironment() &&
      !this.problem() &&
      !this.jsonError() &&
      (this.isNew || this.dirty()) &&
      !this.saving() &&
      !this.loading(),
  );
  protected readonly parameters = computed<CardParameterDef[]>(
    () => this.card().parameters ?? [],
  );
  protected readonly previewInputs = computed(() =>
    (this.previewCard()?.parameters ?? []).map((p) => ({
      ...p,
      multiline: p.type === 'record' || p.type === 'recordset',
    })),
  );
  protected readonly previewValues = computed<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const p of this.previewCard()?.parameters ?? []) {
      const text = this.previewText()[p.id] ?? '';
      try {
        const value = coercePreviewValue(p.type, text);
        if (value !== undefined) out[p.id] = value;
      } catch {
        // The input shows its own error; the card just runs without the value.
      }
    }
    return out;
  });
  protected readonly tabs = computed<TabView[] | undefined>(() => {
    const widget = this.card().widget;
    if (widget?.name !== 'tabs') return undefined;
    const tabs = (widget.data as TabsWidgetDef | undefined)?.tabs ?? [];
    return tabs.map((tab) => ({
      title: tab.title,
      widgets: tab.widgets ?? (tab.widget ? [tab.widget] : []),
    }));
  });
  protected readonly rootKind = computed(() => this.card().widget?.name ?? '');
  protected readonly scopeIdentity = computed(() =>
    JSON.stringify([this.ctx.ref(), this.ctx.environment()]),
  );
  protected readonly addable: EditableWidgetKind[] = ['text', 'fields', 'SQL'];

  constructor() {
    // Load an existing card from the URL's id (cold deep links have no router state).
    effect((onCleanup) => {
      const ref = this.ctx.ref();
      const environment = this.ctx.environment();
      const blocked = this.ctx.needsEnvironment();
      const id = this.cardId();
      this.reloads();
      if (this.isNew || !ref || blocked || !id) return;
      untracked(() => {
        this.loading.set(true);
        this.loadError.set(undefined);
        this.notFound.set(false);
      });
      const subscription = this.cards.getCard(ref, id, environment).subscribe({
        next: (card) => {
          this.adopt(card);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          if (error instanceof CardNotFoundError) this.notFound.set(true);
          else this.loadError.set(errorText(error, 'The card could not be loaded.'));
        },
      });
      onCleanup(() => subscription.unsubscribe());
    });
    // A new card picks a free id from the cards that exist.
    effect((onCleanup) => {
      const ref = this.ctx.ref();
      const environment = this.ctx.environment();
      if (!this.isNew || !ref || this.ctx.needsEnvironment()) return;
      const subscription = this.cards.listCards(ref, environment).subscribe({
        next: (briefs) => {
          this.existingIds.set(briefs.map((b) => b.id));
          this.refreshAutoId();
        },
        error: () => undefined,
      });
      onCleanup(() => subscription.unsubscribe());
    });
    // Saved queries for the widget pickers.
    effect((onCleanup) => {
      const ref = this.ctx.ref();
      untracked(() => {
        this.queries.set([]);
        this.queriesError.set(undefined);
      });
      if (!ref || this.ctx.needsEnvironment()) return;
      const subscription = this.queriesService
        .getQueriesFolder(ref, '~')
        .subscribe({
          next: (folder) => this.queries.set(flattenQueryFolder(folder)),
          error: () =>
            this.queriesError.set('Saved queries could not be loaded.'),
        });
      onCleanup(() => subscription.unsubscribe());
    });
    // The preview follows the last valid card, after a short pause.
    effect((onCleanup) => {
      const card = this.finished();
      const valid = !this.problem() || this.isIdOnlyProblem();
      const timer = setTimeout(
        () => this.previewCard.set(valid ? card : undefined),
        this.previewCard() === undefined ? 0 : PREVIEW_DEBOUNCE_MS,
      );
      onCleanup(() => clearTimeout(timer));
    });
    const warn = (event: BeforeUnloadEvent): void => {
      if (!this.dirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    this.destroyRef.onDestroy(() =>
      window.removeEventListener('beforeunload', warn),
    );
  }

  /** The preview works while only the id is taken: the card itself is fine. */
  private isIdOnlyProblem(): boolean {
    const card = this.finished();
    return (
      this.isNew &&
      this.existingIds().includes(card.id) &&
      cardValidationError(card) === undefined &&
      !!card.title.trim()
    );
  }

  /** Ionic keeps routed pages: coming back shows what is saved unless there are unsaved edits. */
  ionViewWillEnter(): void {
    if (!this.isNew && !this.dirty() && this.ctx.ref()) {
      const ref = this.ctx.ref();
      if (ref) this.cards.invalidate(ref);
      this.reloads.update((n) => n + 1);
    }
  }

  private adopt(card: ProjectCard): void {
    this.card.set(card);
    this.baseline.set(JSON.stringify(finishCard(card)));
    this.jsonText.set(JSON.stringify(card, null, 2));
    this.jsonError.set(undefined);
    this.previewText.set({});
    this.previewCard.set(undefined);
  }

  private refreshAutoId(): void {
    if (!this.isNew || this.idTouched()) return;
    const id = uniqueCardId(
      slugifyCardId(this.card().title),
      this.existingIds(),
    );
    if (id !== this.card().id) this.card.update((c) => ({ ...c, id }));
  }

  /** Applies a change to a copy of the card and publishes it to the form and the JSON view. */
  protected mutate(fn: (draft: ProjectCard) => void): void {
    const draft = JSON.parse(JSON.stringify(this.card())) as ProjectCard;
    fn(draft);
    this.setCard(draft);
  }

  private setCard(card: ProjectCard): void {
    this.card.set(card);
    this.jsonText.set(JSON.stringify(card, null, 2));
    this.jsonError.set(undefined);
    this.savedNotice.set(false);
    this.saveError.set(undefined);
  }

  protected val(event: unknown): string {
    const value = (event as { detail?: { value?: unknown } }).detail?.value;
    return value == null ? '' : String(value);
  }

  protected setTitle(title: string): void {
    this.mutate((c) => (c.title = title));
    this.refreshAutoId();
  }
  protected setId(id: string): void {
    this.idTouched.set(true);
    this.mutate((c) => (c.id = id));
  }
  protected setDescription(text: string): void {
    this.mutate((c) => {
      if (text) c.description = text;
      else delete c.description;
    });
  }
  protected setDisplay(display: string): void {
    this.mutate((c) => (c.display = display === 'tooltip' ? 'tooltip' : 'panel'));
  }
  protected setParameters(parameters: CardParameterDef[]): void {
    this.mutate((c) => (c.parameters = parameters));
  }

  // ---- content (tabs and widgets) -------------------------------------------------

  private tabsOf(draft: ProjectCard): TabWidget[] {
    return (draft.widget?.data as TabsWidgetDef).tabs;
  }
  private tabWidgets(tab: TabWidget): BoardWidget[] {
    const widgets = tab.widgets ?? (tab.widget ? [tab.widget] : []);
    delete tab.widget;
    tab.widgets = widgets;
    return widgets;
  }

  protected convertToTabs(): void {
    this.mutate((c) => {
      const widget = c.widget;
      c.widget = {
        name: 'tabs',
        data: {
          tabs: [
            { id: 'details', title: 'Details', widgets: widget ? [widget] : [] },
          ],
        },
      };
    });
  }
  protected addTab(): void {
    this.mutate((c) => {
      const tabs = this.tabsOf(c);
      let n = tabs.length + 1;
      while (tabs.some((t) => t.id === `tab${n}`)) n++;
      tabs.push({
        id: `tab${n}`,
        title: `Tab ${tabs.length + 1}`,
        widgets: [{ name: 'text', data: { markdown: '' } }],
      });
    });
  }
  protected removeTab(index: number): void {
    this.mutate((c) => this.tabsOf(c).splice(index, 1));
  }
  protected moveTab(index: number, delta: number): void {
    this.mutate((c) => move(this.tabsOf(c), index, delta));
  }
  protected setTabTitle(index: number, title: string): void {
    this.mutate((c) => (this.tabsOf(c)[index].title = title));
  }
  protected addWidget(tab: number, kind: EditableWidgetKind): void {
    this.mutate((c) =>
      this.tabWidgets(this.tabsOf(c)[tab]).push(
        newWidget(kind, c.parameters ?? [], this.queries()[0]?.id ?? ''),
      ),
    );
  }
  protected removeWidget(tab: number, index: number): void {
    this.mutate((c) => this.tabWidgets(this.tabsOf(c)[tab]).splice(index, 1));
  }
  protected moveWidget(tab: number, index: number, delta: number): void {
    this.mutate((c) => move(this.tabWidgets(this.tabsOf(c)[tab]), index, delta));
  }
  protected setWidget(tab: number, index: number, widget: BoardWidget): void {
    this.mutate((c) => (this.tabWidgets(this.tabsOf(c)[tab])[index] = widget));
  }
  protected kindLabel(widget: BoardWidget): string {
    return isEditableKind(widget.name)
      ? WIDGET_KIND_LABELS[widget.name]
      : `${widget.name} widget`;
  }

  // ---- JSON ----------------------------------------------------------------------

  protected onJson(text: string): void {
    this.jsonText.set(text);
    try {
      const parsed: unknown = JSON.parse(text);
      validateProjectCard(parsed);
      this.card.set(parsed as ProjectCard);
      this.jsonError.set(undefined);
      this.savedNotice.set(false);
    } catch (error) {
      this.jsonError.set(errorText(error, 'The JSON is not a valid card.'));
    }
  }

  // ---- preview -------------------------------------------------------------------

  protected setPreviewText(id: string, text: string): void {
    this.previewText.update((all) => ({ ...all, [id]: text }));
    const type = this.previewCard()?.parameters?.find((p) => p.id === id)?.type;
    let message = '';
    if (type)
      try {
        coercePreviewValue(type, text);
      } catch {
        message = 'Enter valid JSON.';
      }
    this.previewInputError.update((all) => ({ ...all, [id]: message }));
  }
  protected refreshPreview(): void {
    this.view()?.refresh();
  }

  // ---- save / delete ---------------------------------------------------------------

  protected async save(): Promise<void> {
    const ref = this.ctx.ref();
    if (!ref || !this.canSubmit()) return;
    const card = this.finished();
    const environment = this.ctx.environment();
    this.saving.set(true);
    this.saveError.set(undefined);
    this.cards[this.isNew ? 'createCard' : 'saveCard'](ref, card, environment).subscribe({
      next: () => {
        this.saving.set(false);
        this.baseline.set(JSON.stringify(card));
        if (this.isNew) {
          const url = this.ctx.url(['card', card.id]);
          if (url) void this.router.navigateByUrl(url, { replaceUrl: true });
        } else {
          this.savedNotice.set(true);
          this.adoptSaved(card);
        }
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveError.set(errorText(error, 'The card could not be saved.'));
      },
    });
  }

  private adoptSaved(card: ProjectCard): void {
    this.baseline.set(JSON.stringify(card));
  }

  protected async confirmDelete(): Promise<void> {
    const ref = this.ctx.ref();
    if (!ref || !this.ctx.canDelete() || this.isNew) return;
    const alert = await this.alerts.create({
      header: 'Delete this card?',
      message: `"${this.card().title || this.card().id}" is removed from the project. Dashboards that reference it show "Card not found".`,
      buttons: [
        { text: 'Keep card', role: 'cancel' },
        { text: 'Delete card', role: 'destructive', handler: () => this.remove() },
      ],
    });
    await alert.present();
  }

  private remove(): void {
    const ref = this.ctx.ref();
    if (!ref) return;
    this.saving.set(true);
    this.cards
      .deleteCard(ref, this.card().id, this.ctx.environment())
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.baseline.set(JSON.stringify(this.finished()));
          const url = this.ctx.url(['cards']);
          if (url) void this.router.navigateByUrl(url, { replaceUrl: true });
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.saveError.set(errorText(error, 'The card could not be deleted.'));
        },
      });
  }
}

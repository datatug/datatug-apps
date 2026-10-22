import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Observable,
  Subject,
  Subscription,
  catchError,
  map,
  of,
  switchMap,
  timer,
} from 'rxjs';
import {
  matchCards,
  type CardCellIdentity,
  type CardDisplay,
  type CardMatch,
  type ProjectCard,
  type ProjectCardBrief,
} from '@datatug/board-models';
import type { IProjectRef } from '../core/project-context';
import type { IBoardContext } from '../models/definition/board/board';
import { isBlankValue } from './card-parameters';
import { ProjectCardsService } from './project-cards.service';

/** The project, environment and run context a lookup works in (a {@link CardsContext} fits). */
export interface LookupContext {
  readonly ref: Signal<IProjectRef | undefined>;
  readonly environment: Signal<string | undefined>;
  readonly runContext: Signal<IBoardContext>;
}

/** What the user selected in a grid: the cell's identity and value, its row, and where it is on screen. */
export interface CardCellSelection {
  identity: CardCellIdentity;
  value: unknown;
  /** The selected row by column name; handed to a `record` parameter when the card declares one. */
  row?: Record<string, unknown>;
  /** Viewport point under the selected cell, for the tooltip popover. */
  anchor?: { x: number; y: number };
}

/** Selecting a cell waits this long before looking cards up, so arrowing through cells costs nothing. */
export const CARD_LOOKUP_DEBOUNCE_MS = 150;

interface LookupRequest {
  readonly id: number;
  readonly cell: CardCellSelection | undefined;
}

const NUMERIC = new Set(['integer', 'number', 'float', 'money']);

/**
 * The values a matched card starts with: the cell's value on the matched
 * parameter (numbers for numeric types) and the selected row on a `record`
 * parameter, when the card declares one.
 */
export function bindCellValues(
  match: CardMatch | undefined,
  cell: CardCellSelection | undefined,
): Record<string, unknown> {
  if (!match || !cell) return {};
  const params = match.card.parameters ?? [];
  const values: Record<string, unknown> = {};
  const type = params.find((p) => p.id === match.parameterId)?.type ?? 'string';
  let value = cell.value;
  if (NUMERIC.has(type) && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) value = n;
  }
  values[match.parameterId] = value;
  if (cell.row)
    for (const p of params)
      if (p.type === 'record' && p.id !== match.parameterId)
        values[p.id] = cell.row;
  return values;
}

/**
 * Finds the cards that fit the selected grid cell and tracks the one on
 * show (spec REQ: cell-to-card). Provided by the page that owns the grid, so
 * each page has its own selection; the card list itself is cached by
 * {@link ProjectCardsService}.
 *
 * - Selecting waits 150 ms; a newer selection cancels the older lookup.
 * - A NULL or empty value shows nothing and cancels any lookup at once.
 * - With several matches {@link choose} picks one; the best ranks first.
 * - The panel/tooltip mode comes from the card, with a session override.
 */
@Injectable()
export class CardLookupService {
  private readonly cards = inject(ProjectCardsService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly source = signal<LookupContext | undefined>(undefined);
  readonly projectRef = computed<IProjectRef | undefined>(() =>
    this.source()?.ref(),
  );
  readonly environment = computed<string | undefined>(() =>
    this.source()?.environment(),
  );
  /** Where and as whom the card's saved queries run. */
  readonly runContext = computed<IBoardContext | undefined>(() =>
    this.source()?.runContext(),
  );

  /** The latest selection (also while its lookup is pending). */
  readonly cell = signal<CardCellSelection | undefined>(undefined);
  /** The selection the current matches belong to. */
  readonly resolvedCell = signal<CardCellSelection | undefined>(undefined);
  readonly matches = signal<readonly CardMatch[]>([]);
  private readonly chosenId = signal<string | undefined>(undefined);
  readonly active = computed<CardMatch | undefined>(() => {
    const all = this.matches();
    return all.find((m) => m.card.id === this.chosenId()) ?? all[0];
  });
  /** The full card of {@link active}. */
  readonly card = signal<ProjectCard | undefined>(undefined);
  readonly cardError = signal<string | undefined>(undefined);
  readonly cardLoading = signal(false);

  private readonly overrides = signal<Record<string, CardDisplay>>({});
  private readonly dismissed = signal<CardCellSelection | undefined>(undefined);

  /**
   * True when the page has no room beside its grid (narrow content area): every card then shows as a popover over
   * the selected cell, so a selection always gives visible feedback.
   */
  readonly compact = signal(false);

  /** How the active card shows: narrow pages always a tooltip; else the session override, its own `display`, a panel. */
  readonly mode = computed<CardDisplay>(() => {
    const active = this.active();
    if (!active) return 'panel';
    if (this.compact()) return 'tooltip';
    return this.overrides()[active.card.id] ?? active.card.display ?? 'panel';
  });
  private readonly shown = computed(
    () => !!this.active() && this.dismissed() !== this.resolvedCell(),
  );
  readonly panelOpen = computed(() => this.shown() && this.mode() === 'panel');
  /** The tooltip shows only for the cell still selected: a newer selection closes it at once. */
  readonly tooltipOpen = computed(
    () =>
      this.shown() &&
      this.mode() === 'tooltip' &&
      this.resolvedCell() === this.cell(),
  );
  /** Parameter values for the active card from the cell it matched. */
  readonly values = computed(() =>
    bindCellValues(this.active(), this.resolvedCell()),
  );

  private readonly requests = new Subject<LookupRequest>();
  /** Ordinal of the latest selection: an answer for an older one is dropped. */
  private latest = 0;
  private cardLoad?: Subscription;
  private loadedFor?: string;
  /** The brief the shown card was loaded for: a refreshed list means a different brief. */
  private loadedBrief?: ProjectCardBrief;

  constructor() {
    this.requests
      .pipe(
        // A newer selection (or a clear) cancels the older lookup at once, its card list read included.
        switchMap((request) =>
          request.cell
            ? timer(CARD_LOOKUP_DEBOUNCE_MS).pipe(
                switchMap(() => this.lookup(request.cell)),
                map((matches) => ({ request, matches })),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ request, matches }) => {
        // Never show an answer for a cell that is no longer the selected one.
        if (request.id === this.latest) this.apply(request.cell, matches);
      });
    this.destroyRef.onDestroy(() => this.cardLoad?.unsubscribe());
  }

  private lookup(cell: CardCellSelection | undefined): Observable<CardMatch[]> {
    const ref = this.projectRef();
    if (!cell || !ref) return of([]);
    return this.cards.listCards(ref, this.environment()).pipe(
      map((briefs: ProjectCardBrief[]) => matchCards(briefs, cell.identity)),
      catchError(() => of([] as CardMatch[])),
    );
  }

  /** Works in the project and environment of a page (call once, from the page's constructor). */
  use(context: LookupContext): void {
    this.source.set(context);
  }

  /** Selects a grid cell, or clears the selection (`undefined`). */
  select(cell: CardCellSelection | undefined): void {
    const id = ++this.latest;
    this.cell.set(cell);
    // A card still loading for the previous cell is of no use any more.
    if (this.cardLoading()) {
      this.cardLoad?.unsubscribe();
      this.cardLoad = undefined;
      this.loadedFor = undefined;
      this.loadedBrief = undefined;
      this.cardLoading.set(false);
    }
    if (!cell || isBlankValue(cell.value)) {
      this.requests.next({ id, cell: undefined });
      this.apply(undefined, []);
      return;
    }
    this.requests.next({ id, cell });
  }

  /** Forgets the selection and anything shown for it. */
  clear(): void {
    this.select(undefined);
  }

  private apply(
    cell: CardCellSelection | undefined,
    matches: readonly CardMatch[],
  ): void {
    this.resolvedCell.set(cell);
    this.matches.set(matches);
    this.loadActive();
  }

  /** Picks one of several matching cards. */
  choose(cardId: string): void {
    if (this.matches().some((m) => m.card.id === cardId)) {
      this.chosenId.set(cardId);
      this.loadActive();
    }
  }

  /** Session override of the active card's display. */
  setMode(mode: CardDisplay): void {
    const active = this.active();
    if (active)
      this.overrides.update((all) => ({ ...all, [active.card.id]: mode }));
  }

  /** Closes the panel or tooltip for this selection (Escape, close button). */
  dismiss(): void {
    this.dismissed.set(this.resolvedCell());
  }

  private loadActive(): void {
    const active = this.active();
    const ref = this.projectRef();
    const key = active && ref ? active.card.id : undefined;
    if (
      key === this.loadedFor &&
      active?.card === this.loadedBrief &&
      (key === undefined || this.card() || this.cardLoading())
    )
      return;
    const refreshed = key !== undefined && key === this.loadedFor && active?.card !== this.loadedBrief;
    this.cardLoad?.unsubscribe();
    // Another card, or none: nothing of the previous card stays on show while the next loads.
    if (key !== this.loadedFor) this.card.set(undefined);
    this.loadedFor = key;
    this.loadedBrief = active?.card;
    this.cardError.set(undefined);
    if (!key || !ref) {
      this.card.set(undefined);
      this.cardLoading.set(false);
      return;
    }
    this.cardLoading.set(true);
    // The list was refreshed (the card may have been edited): the card is read past its cache too.
    this.cardLoad = this.cards.getCard(ref, key, this.environment(), refreshed).subscribe({
      next: (card) => {
        this.card.set(card);
        this.cardLoading.set(false);
      },
      error: (error: unknown) => {
        this.card.set(undefined);
        this.cardLoading.set(false);
        this.cardError.set(
          error instanceof Error && error.message
            ? error.message
            : 'The card could not be loaded.',
        );
      },
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  numberAttribute,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  barChartOutline,
  closeCircle,
  codeSlashOutline,
  cubeOutline,
  checkmarkCircleOutline,
  eyeOutline,
  gridOutline,
  layersOutline,
  listOutline,
  pricetagOutline,
  searchOutline,
  serverOutline,
  arrowForwardOutline,
} from 'ionicons/icons';
import { combineLatest, filter, map, of, switchMap } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import { debouncedSignal } from './debounced-signal';
import { IProjectRef } from '../core/project-context';
import { projectPageHref } from '../nav/project-page-href';
import {
  HighlightPart,
  MetadataGroup,
  groupMatches,
  highlightParts,
  matchMetadata,
  secondaryLines,
  isSignedInViewer,
  quickSearchErrorMessage,
} from './project-metadata-search';
import { QueryListItemComponent } from '../components/query-list-item/query-list-item.component';
import {
  ProjectMetadataSearchService,
  ProjectMetadataState,
} from './project-metadata-search.service';

export const QUICK_SEARCH_DEBOUNCE_MS = 150;
export const QUICK_SEARCH_GROUP_LIMIT = 5;

export function registerQuickSearchIcons(): void {
  addIcons({
    'bar-chart-outline': barChartOutline,
    'close-circle': closeCircle,
    'code-slash-outline': codeSlashOutline,
    'cube-outline': cubeOutline,
    'checkmark-circle-outline': checkmarkCircleOutline,
    'eye-outline': eyeOutline,
    'grid-outline': gridOutline,
    'layers-outline': layersOutline,
    'list-outline': listOutline,
    'pricetag-outline': pricetagOutline,
    'search-outline': searchOutline,
    'server-outline': serverOutline,
    'arrow-forward-outline': arrowForwardOutline,
  });
}

interface OptionView {
  readonly id: string;
  /** The plain title (query rows mark the search text themselves). */
  readonly titleText: string;
  readonly title: readonly HighlightPart[];
  readonly secondary: string;
  readonly icon: string;
  readonly link?: UrlTree;
  /** Set for saved queries: they render as the shared query row (type icon and badge, date). */
  readonly query?: { readonly type?: string; readonly createdAt?: string };
}
interface GroupView {
  readonly group: MetadataGroup;
  readonly headingId: string;
  readonly options: readonly OptionView[];
}

let nextBoxId = 0;

/**
 * Instant Quick Search: a combobox whose suggestions are the project's own metadata, grouped by type, matched as the
 * person types (debounced). Enter opens the highlighted suggestion, or the full results page; Esc closes.
 *
 * Use: `<sneat-datatug-project-quick-search-box [projectRef]="ref" />`. With `[suggestions]="false"` it is only the
 * search field (the full results page renders its own groups) and reports the debounced text via `query`.
 */
@Component({
  selector: 'sneat-datatug-project-quick-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IonIcon, IonSpinner, QueryListItemComponent],
  host: {
    class: 'ph-no-capture',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <form role="search" (submit)="onSubmit($event)" [attr.aria-label]="label()">
      <label class="label" [for]="inputId">{{ label() }}</label>
      <div class="field" [class.open]="open()">
        <ion-icon name="search-outline" aria-hidden="true" />
        <input
          #input
          [id]="inputId"
          class="ph-no-capture ph-mask sentry-mask"
          data-sentry-mask
          type="search"
          name="q"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="search"
          [attr.role]="suggestions() ? 'combobox' : null"
          [attr.aria-autocomplete]="suggestions() ? 'list' : null"
          [attr.aria-expanded]="suggestions() ? hasOptions() : null"
          [attr.aria-controls]="suggestions() ? listboxId : null"
          [attr.aria-activedescendant]="activeOptionId()"
          [placeholder]="placeholder()"
          [value]="query()"
          (input)="onInput($event)"
          (focus)="onFocus()"
          (keydown)="onKeydown($event)"
        />
        @if (query()) {
          <button
            type="button"
            class="clear"
            aria-label="Clear search"
            title="Clear search"
            (click)="clear(input)"
          >
            <ion-icon name="close-circle" aria-hidden="true" />
          </button>
        }
      </div>
      @if (suggestions()) {
        <div class="panel" [hidden]="!open()">
          <div
            class="listbox"
            [id]="listboxId"
            role="listbox"
            [attr.aria-label]="label() + ' suggestions'"
          >
            @if (open()) {
              @for (view of groupViews(); track view.group.kind) {
                <div
                  class="group"
                  role="group"
                  [attr.aria-labelledby]="view.headingId"
                >
                  <div
                    class="group-title"
                    role="presentation"
                    [id]="view.headingId"
                  >
                    {{ view.group.title }}
                    <span class="count">{{ view.group.total }}</span>
                  </div>
                  @for (option of view.options; track option.id) {
                    @if (option.query; as query) {
                      <!-- The shared query row, as a combobox option: same icon, type badge and date as every query list. -->
                      <div
                        class="query-option"
                        (mousedown)="$event.preventDefault()"
                        (click)="close()"
                      >
                        <sneat-datatug-query-list-item
                          lines="none"
                          [optionId]="option.id"
                          [optionActive]="option.id === activeOptionId()"
                          [queryTitle]="option.titleText"
                          [type]="query.type"
                          [createdAt]="query.createdAt"
                          [href]="option.link"
                          [detail]="false"
                          [highlight]="term()"
                          ><span queryRowSubtitle class="secondary">{{
                            option.secondary
                          }}</span></sneat-datatug-query-list-item
                        >
                      </div>
                    } @else {
                      <a
                        class="option"
                        role="option"
                        [id]="option.id"
                        [class.active]="option.id === activeOptionId()"
                        [attr.aria-selected]="option.id === activeOptionId()"
                        [routerLink]="option.link"
                        tabindex="-1"
                        (mousedown)="$event.preventDefault()"
                        (click)="close()"
                      >
                        <ion-icon [name]="option.icon" aria-hidden="true" />
                        <span class="text">
                          <span class="title">
                            @for (part of option.title; track $index) {
                              @if (part.hit) {
                                <mark>{{ part.text }}</mark>
                              } @else {
                                <span>{{ part.text }}</span>
                              }
                            }
                          </span>
                          <span class="secondary">{{ option.secondary }}</span>
                        </span>
                      </a>
                    }
                  }
                </div>
              }
              @if (total()) {
                <a
                  class="option see-all"
                  role="option"
                  [id]="seeAllId"
                  [class.active]="seeAllId === activeOptionId()"
                  [attr.aria-selected]="seeAllId === activeOptionId()"
                  [routerLink]="seeAllLink()"
                  tabindex="-1"
                  (mousedown)="$event.preventDefault()"
                  (click)="close()"
                >
                  <span class="text"
                    ><span class="title"
                      >See all {{ total() }}
                      {{ total() === 1 ? 'result' : 'results' }}</span
                    ></span
                  >
                  <ion-icon name="arrow-forward-outline" aria-hidden="true" />
                </a>
              }
            }
          </div>
          <!-- Status words live outside the listbox, in one region that stays in the DOM so changes are announced. -->
          <div class="states" aria-live="polite" aria-atomic="true">
            @if (open()) {
              @if (!total() && state().loading) {
                <div class="state">
                  <ion-spinner name="dots" aria-hidden="true" />
                  Searching project metadata…
                </div>
              } @else if (!total()) {
                <div class="state">
                  No matches for “{{ term() }}”.
                  <span class="secondary"
                    >Try part of a query, table, column or tag name.</span
                  >
                </div>
              } @else if (state().loading) {
                <div class="state small">
                  <ion-spinner name="dots" aria-hidden="true" /> Still reading
                  project metadata…
                </div>
              }
              @if (errorText(); as text) {
                <div class="state small warning">{{ text }}</div>
              }
            }
          </div>
        </div>
      }
    </form>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      max-width: 100%;
    }
    form {
      margin: 0;
    }
    .label {
      display: block;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .field {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 0 8px 0 12px;
      border: 1px solid var(--ion-color-step-300, var(--ion-color-medium-tint));
      border-radius: 8px;
      background: var(--ion-background-color, #fff);
    }
    .field:focus-within {
      border-color: var(--ion-color-primary);
      box-shadow: 0 0 0 2px rgba(var(--ion-color-primary-rgb), 0.25);
    }
    .field > ion-icon {
      flex: none;
      color: var(--ion-color-medium);
      font-size: 18px;
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ion-text-color);
      font: inherit;
      padding: 10px 0;
    }
    input::-webkit-search-cancel-button {
      display: none;
    }
    .clear {
      flex: none;
      display: inline-flex;
      border: 0;
      background: transparent;
      padding: 6px;
      color: var(--ion-color-medium);
      cursor: pointer;
      font-size: 18px;
    }
    .panel {
      position: absolute;
      z-index: 20;
      left: 0;
      right: 0;
      margin-top: 4px;
      max-height: min(70vh, 520px);
      overflow-y: auto;
      overflow-x: hidden;
      border: 1px solid var(--ion-color-step-200, var(--ion-color-light-shade));
      border-radius: 8px;
      background: var(--ion-item-background, var(--ion-background-color, #fff));
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      padding: 4px 0;
    }
    .group + .group {
      border-top: 1px solid var(--ion-color-step-150, var(--ion-color-light));
    }
    .group-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px 4px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ion-color-medium-shade);
    }
    .count {
      font-weight: 500;
      color: var(--ion-color-medium);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      color: var(--ion-text-color);
      text-decoration: none;
      cursor: pointer;
      min-width: 0;
    }
    .option > ion-icon {
      flex: none;
      font-size: 18px;
      color: var(--ion-color-primary);
    }
    .option:hover,
    .option.active {
      background: rgba(var(--ion-color-primary-rgb), 0.1);
    }
    .option.active {
      box-shadow: inset 3px 0 0 var(--ion-color-primary);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .title,
    .secondary {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .secondary {
      font-size: 0.8rem;
      color: var(--ion-color-medium-shade);
    }
    mark {
      background: rgba(var(--ion-color-warning-rgb), 0.35);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    .see-all {
      border-top: 1px solid var(--ion-color-step-150, var(--ion-color-light));
      color: var(--ion-color-primary);
      font-weight: 600;
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      color: var(--ion-text-color);
    }
    .state.small {
      flex-direction: row;
      align-items: center;
      font-size: 0.8rem;
      color: var(--ion-color-medium-shade);
      padding-top: 4px;
    }
    .state.warning {
      color: var(--ion-color-warning-shade);
    }
    .state ion-spinner {
      width: 20px;
      height: 16px;
    }
  `,
})
export class ProjectQuickSearchBoxComponent {
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly metadataService = inject(ProjectMetadataSearchService);

  readonly projectRef = input<IProjectRef | undefined>(undefined);
  /** The text in the field; two-way bindable. */
  readonly query = model('');
  readonly label = input('Quick Search');
  readonly placeholder = input(
    'Search queries, boards, tables, columns, tags…',
  );
  /** Show the suggestion list (off on the full results page, which renders all groups itself). */
  readonly suggestions = input(true, { transform: booleanAttribute });
  /** Enter with no highlighted suggestion opens the full results page. */
  readonly navigateOnSubmit = input(true, { transform: booleanAttribute });
  readonly limit = input(QUICK_SEARCH_GROUP_LIMIT, {
    transform: numberAttribute,
  });
  /** The debounced search text, after each pause in typing. */
  readonly termChange = output<string>();
  /** Enter pressed with no suggestion highlighted. */
  readonly submitted = output<string>();

  readonly inputId = `project-quick-search-${++nextBoxId}`;
  readonly listboxId = `${this.inputId}-listbox`;
  readonly seeAllId = `${this.inputId}-all`;

  private readonly debounce = debouncedSignal(
    this.query,
    QUICK_SEARCH_DEBOUNCE_MS,
  );
  /** The query after the debounce; what is actually matched. */
  readonly term = this.debounce.value;
  readonly expanded = signal(false);
  readonly activeIndex = signal(-1);
  /** Metadata is read on first focus or input, so an untouched box costs no request. */
  private readonly activated = signal(false);
  private readonly signedIn = toSignal(
    inject(SneatAuthStateService).authState.pipe(
      map((auth) => isSignedInViewer(auth)),
    ),
    { initialValue: false },
  );
  private lastTerm = '';

  readonly state = toSignal(
    combineLatest([
      toObservable(this.projectRef),
      toObservable(this.activated).pipe(filter(Boolean)),
    ]).pipe(
      switchMap(([ref]) =>
        ref && this.suggestions()
          ? this.metadataService.metadata(ref)
          : of<ProjectMetadataState>({ items: [], loading: false }),
      ),
    ),
    { initialValue: { items: [], loading: true } as ProjectMetadataState },
  );

  readonly matches = computed(() =>
    matchMetadata(this.state().items, this.term()),
  );
  readonly total = computed(() => this.matches().length);
  readonly groupViews = computed<GroupView[]>(() => {
    const ref = this.projectRef(),
      term = this.term();
    let index = 0;
    return groupMatches(this.matches(), this.limit()).map((group) => {
      const lines = secondaryLines(group.matches);
      return {
        group,
        headingId: `${this.inputId}-g-${group.kind}`,
        options: group.matches.map((match, i) => ({
          id: `${this.inputId}-o-${index++}`,
          titleText: match.item.title,
          title: highlightParts(match.item.title, term),
          secondary: lines[i],
          icon: match.item.icon || group.icon,
          link:
            ref && match.item.href
              ? this.router.parseUrl(match.item.href)
              : undefined,
          ...(match.item.kind === 'query'
            ? {
                query: {
                  type: match.item.queryType,
                  createdAt: match.item.createdAt,
                },
              }
            : {}),
        })),
      };
    });
  });
  private readonly optionIds = computed(() => [
    ...this.groupViews().flatMap((g) => g.options.map((o) => o.id)),
    ...(this.total() ? [this.seeAllId] : []),
  ]);
  readonly activeOptionId = computed(() =>
    this.open() ? this.optionIds()[this.activeIndex()] : undefined,
  );
  readonly open = computed(
    () => this.suggestions() && this.expanded() && !!this.term().trim(),
  );
  /** `aria-expanded`: true only while the listbox shows options. */
  readonly hasOptions = computed(
    () => this.open() && this.optionIds().length > 0,
  );
  readonly seeAllLink = computed(() => this.resultsLink(this.term()));
  readonly errorText = computed(() => {
    const error = this.state().error;
    return error === undefined
      ? ''
      : quickSearchErrorMessage(error, undefined, {
          signedIn: this.signedIn(),
        });
  });

  constructor() {
    registerQuickSearchIcons();
    effect(() => {
      const term = this.term();
      const ref = this.projectRef();
      untracked(() => {
        // Column files are the one costly source: read them only once someone searches.
        if (ref && term.trim() && this.suggestions())
          this.metadataService.includeColumns(ref);
        if (term !== this.lastTerm) {
          this.lastTerm = term;
          this.termChange.emit(term);
        }
      });
    });
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activated.set(true);
    this.expanded.set(true);
    this.activeIndex.set(-1);
  }

  onFocus(): void {
    this.activated.set(true);
    if (this.query().trim()) this.expanded.set(true);
  }

  onKeydown(event: KeyboardEvent): void {
    // Within the debounce the shown suggestions belong to the previous text: never highlight or open them.
    const stale = this.debounce.pending();
    const count = this.optionIds().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!this.suggestions()) return;
        event.preventDefault();
        if (stale) return;
        if (!this.open()) {
          this.expanded.set(true);
          return;
        }
        if (!count) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const current = this.activeIndex();
        this.activeIndex.set(
          current < 0
            ? step > 0
              ? 0
              : count - 1
            : (current + step + count) % count,
        );
        this.scrollActiveIntoView();
        return;
      }
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      case 'Enter': {
        event.preventDefault();
        const active = stale ? undefined : this.activeOptionId();
        if (!active) {
          this.submit();
          return;
        }
        const link =
          active === this.seeAllId
            ? this.seeAllLink()
            : this.groupViews()
                .flatMap((g) => g.options)
                .find((o) => o.id === active)?.link;
        this.close();
        if (link) void this.router.navigateByUrl(link);
        return;
      }
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /** Searches the typed text now: the results page, or `submitted` for a host that shows results itself. */
  submit(): void {
    const q = this.query().trim();
    if (!q) return;
    this.debounce.flush();
    this.close();
    this.submitted.emit(q);
    const link = this.navigateOnSubmit() ? this.resultsLink(q) : undefined;
    if (link) void this.router.navigateByUrl(link);
  }

  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !this.host.nativeElement.contains(next)) this.close();
  }

  clear(input: HTMLInputElement): void {
    this.query.set('');
    this.debounce.flush();
    this.close();
    input.focus();
  }

  close(): void {
    this.expanded.set(false);
    this.activeIndex.set(-1);
  }

  private resultsLink(q: string): UrlTree | undefined {
    const ref = this.projectRef();
    if (!ref || !q.trim()) return undefined;
    // The project address may already carry qualifiers (`?projectApi=cloud&branch=main`): merge, never append.
    const link = this.router.parseUrl(projectPageHref(ref, ['quick-search']));
    link.queryParams = { ...link.queryParams, q: q.trim() };
    return link;
  }

  private scrollActiveIntoView(): void {
    queueMicrotask(() => {
      const id = this.activeOptionId();
      const el = id
        ? this.host.nativeElement.querySelector(`#${CSS.escape(id)}`)
        : null;
      (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
    });
  }
}

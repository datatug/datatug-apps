import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Params, RouterLink, UrlTree } from '@angular/router';
import { IonIcon, IonItem } from '@ionic/angular';
import { chevronForwardOutline } from 'ionicons/icons';
import { Observable, Subscription, catchError, of, take } from 'rxjs';
import { tokenizeTugql } from '../../queries/query/page/tugql-syntax';
import {
  QueryTypeIconComponent,
  queryTypeLabel,
} from '../query-type-icon/query-type-icon.component';
import {
  QueryItemHeadingComponent,
  formatQueryTimestamp,
} from './query-item-heading';

/** How many lines of the query text the hover preview shows. */
export const QUERY_PREVIEW_LINES = 8;

/** The first `QUERY_PREVIEW_LINES` lines of a query text, or undefined when there is no text to show. */
export function queryPreviewText(
  text: string | null | undefined,
): string | undefined {
  const trimmed = text?.replace(/\s+$/, '');
  if (!trimmed?.trim()) return undefined;
  const lines = trimmed.split(/\r?\n/);
  return lines.length > QUERY_PREVIEW_LINES
    ? [...lines.slice(0, QUERY_PREVIEW_LINES), '…'].join('\n')
    : trimmed;
}

let nextPreviewId = 0;

/** How long the pointer must rest on a row before its preview loads and shows. */
export const QUERY_PREVIEW_HOVER_DELAY_MS = 180;

/**
 * `<sneat-datatug-query-list-item [queryTitle]="q.title" [type]="q.request.queryType" [createdAt]="q.createdAt"
 *   [href]="link" [loadText]="loader" />`
 *
 * The ONE row for a saved query in any list (the project Queries tab, the Queries page folder and filter views, an
 * entity's related queries, the open-queries menu, the Quick Search suggestions and results). It renders an `ion-item` whose
 * main area is ONE light-DOM link (with `href`) or button (without, emitting `opened`) holding:
 * - the {@link QueryTypeIconComponent} (neutral icon, per-type badge), so the type shows once;
 * - the title and, on the right of the same line, the light locale date (time today) with the full "Added …" text
 *   as tooltip and accessible text;
 * - optional projected `[queryRowSubtitle]` content (a line under the title, e.g. the folder).
 * Row actions are projected as `[queryRowActions]` (an `<ion-buttons slot="end" queryRowActions>`); they are
 * siblings of the main link/button, never nested inside it.
 *
 * Optional read-only preview of the query text (first 8 lines, highlighted like the query editor): after the
 * pointer rests on the row for {@link QUERY_PREVIEW_HOVER_DELAY_MS}, or when the main link/button takes keyboard
 * focus, on devices that hover. It is described by the focused element (`aria-describedby`), and Escape dismisses
 * it. Leaving or blurring cancels a pending or in-flight load. Pass a loader from `QueryTextPreviewService`, which
 * caches texts per project; an empty text or a failed load shows nothing.
 *
 * Inputs: `queryTitle` (required), `type`, `createdAt`, `modifiedAt`, `href` + `queryParams` (navigation), `detail`
 * (chevron), `selected`, `titleTestId`, `itemTestId` (on the `ion-item`), `ariaLabel` (replaces the default
 * accessible name of the main link/button), `loadText`, `highlight` (search text marked in the title), `lines`,
 * and `optionId` + `optionActive` (combobox option mode, used by the Quick Search suggestions). Output: `opened`, emitted on activation when there is no
 * `href`.
 */
@Component({
  selector: 'sneat-datatug-query-list-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    IonIcon,
    IonItem,
    QueryTypeIconComponent,
    QueryItemHeadingComponent,
  ],
  host: {
    '(document:keydown.escape)': 'dismiss()',
  },
  template: `
    <ng-template #main>
      <sneat-datatug-query-type-icon [type]="type()" />
      <span class="query-row-text">
        <sneat-datatug-query-item-heading
          [queryTitle]="queryTitle()"
          [createdAt]="createdAt()"
          [modifiedAt]="modifiedAt()"
          [testId]="titleTestId()"
          [highlight]="highlight()"
        />
        <ng-content select="[queryRowSubtitle]" />
      </span>
      @if (detail()) {
        <ion-icon
          class="query-row-chevron"
          [icon]="chevronIcon"
          aria-hidden="true"
        />
      }
    </ng-template>
    <ion-item
      [attr.data-testid]="itemTestId()"
      [attr.lines]="lines() ?? null"
      [class.query-list-item-selected]="selected()"
      [class.query-list-item-option]="!!optionId()"
      [class.query-list-item-active]="optionActive()"
      (mouseenter)="hover(true)"
      (mouseleave)="hover(false)"
    >
      @if (href(); as link) {
        <a
          class="query-row-main"
          [routerLink]="link"
          [queryParams]="queryParams()"
          [attr.id]="optionId() ?? null"
          [attr.role]="optionId() ? 'option' : null"
          [attr.aria-selected]="optionId() ? optionActive() : null"
          [attr.tabindex]="optionId() ? -1 : null"
          [attr.aria-label]="accessibleName()"
          [attr.aria-describedby]="previewVisible() ? previewId : null"
          (focus)="focus(true)"
          (blur)="focus(false)"
          ><ng-container [ngTemplateOutlet]="main"
        /></a>
      } @else {
        <button
          type="button"
          class="query-row-main"
          [attr.id]="optionId() ?? null"
          [attr.role]="optionId() ? 'option' : null"
          [attr.aria-selected]="optionId() ? optionActive() : null"
          [attr.tabindex]="optionId() ? -1 : null"
          [attr.aria-label]="accessibleName()"
          [attr.aria-describedby]="previewVisible() ? previewId : null"
          (click)="opened.emit()"
          (focus)="focus(true)"
          (blur)="focus(false)"
        >
          <ng-container [ngTemplateOutlet]="main" />
        </button>
      }
      <ng-content select="[queryRowActions]" />
    </ion-item>
    @if (previewVisible()) {
      <div
        class="query-preview author-sql-preview"
        role="tooltip"
        [id]="previewId"
        data-testid="query-preview"
      >
        <pre><code>@for (token of previewTokens(); track $index) {<span [class]="token.kind ? 'tugql-token-' + token.kind : null">{{ token.text }}</span>}</code></pre>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    ion-item {
      --padding-start: 0;
      --inner-padding-end: 8px;
    }
    .query-row-main {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      min-width: 0;
      min-height: 48px;
      padding: 8px 0 8px 16px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: start;
      text-decoration: none;
      cursor: pointer;
    }
    .query-row-main:hover {
      background: var(--ion-color-light);
    }
    .query-row-main:focus-visible {
      outline: 2px solid var(--ion-color-primary);
      outline-offset: -2px;
    }
    .query-row-text {
      flex: 1 1 auto;
      min-width: 0;
    }
    /* Projected subtitles read like an ion-label paragraph. */
    :host ::ng-deep .query-row-text > [queryrowsubtitle] {
      display: block;
      margin: 2px 0 0;
      color: var(--dt-text-muted);
      font-size: 0.875rem;
    }
    .query-row-chevron {
      flex: 0 0 auto;
      margin-inline: 8px 4px;
      color: var(--ion-color-medium);
      font-size: 18px;
    }
    .query-list-item-selected .query-row-text {
      color: var(--ion-color-primary);
    }
    /* Combobox option rows (Quick Search suggestions): compact, no row lines, the keyboard-highlighted row marked
       like the other suggestions. */
    .query-list-item-option {
      --min-height: 0;
      --background: transparent;
      --inner-border-width: 0;
      --border-width: 0;
    }
    .query-list-item-option .query-row-main {
      min-height: 0;
      padding: 8px 12px;
    }
    .query-list-item-option .query-row-main:hover,
    .query-list-item-active .query-row-main {
      background: rgba(var(--ion-color-primary-rgb), 0.1);
    }
    .query-list-item-active .query-row-main {
      box-shadow: inset 3px 0 0 var(--ion-color-primary);
    }
    .query-preview {
      position: absolute;
      z-index: 20;
      top: calc(100% - 4px);
      left: 56px;
      max-width: min(560px, calc(100% - 72px));
      padding: 8px 12px;
      border: 1px solid var(--ion-color-light-shade);
      border-radius: 6px;
      background: var(--ion-background-color);
      box-shadow: 0 4px 16px rgb(0 0 0 / 18%);
      pointer-events: none;
    }
    .query-preview pre {
      margin: 0;
      overflow: hidden;
      font-family: var(
        --dt-font-mono,
        ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace
      );
      font-size: 0.75rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class QueryListItemComponent implements OnDestroy {
  readonly queryTitle = input.required<string>();
  readonly type = input<string | undefined>(undefined);
  readonly createdAt = input<string | undefined>(undefined);
  readonly modifiedAt = input<string | undefined>(undefined);
  readonly href = input<string | UrlTree | unknown[] | undefined>(undefined);
  readonly queryParams = input<Params | undefined>(undefined);
  readonly detail = input(true);
  readonly selected = input(false);
  readonly titleTestId = input<string | undefined>(undefined);
  readonly itemTestId = input<string | undefined>(undefined);
  readonly ariaLabel = input<string | undefined>(undefined);
  /** Search text marked in the title (Quick Search). */
  readonly highlight = input<string | undefined>(undefined);
  /** `ion-item` lines; unset keeps the list's own setting. */
  readonly lines = input<'full' | 'inset' | 'none' | undefined>(undefined);
  /**
   * Combobox option mode (Quick Search suggestions): the main link/button becomes `role="option"` with this id,
   * never takes focus (`tabindex="-1"`; focus stays in the search field, which points at it with
   * `aria-activedescendant`), and reports `optionActive` as `aria-selected`.
   */
  readonly optionId = input<string | undefined>(undefined);
  /** The keyboard-highlighted option (option mode only). */
  readonly optionActive = input(false);
  /** Loads the query's text for the hover preview (see `QueryTextPreviewService`). */
  readonly loadText = input<
    (() => Observable<string | null | undefined>) | undefined
  >(undefined);
  readonly opened = output<void>();

  protected readonly chevronIcon = chevronForwardOutline;
  protected readonly previewId = `query-preview-${++nextPreviewId}`;
  private readonly active = signal(false);
  private readonly dismissed = signal(false);
  protected readonly previewText = signal<string | undefined>(undefined);
  protected readonly previewVisible = computed(
    () => this.active() && !this.dismissed() && !!this.previewText(),
  );
  protected readonly previewTokens = computed(() =>
    tokenizeTugql(this.previewText() ?? ''),
  );
  protected readonly accessibleName = computed(() => {
    const custom = this.ariaLabel();
    if (custom) return custom;
    const stamp = formatQueryTimestamp(this.createdAt(), this.modifiedAt());
    return [
      `${this.queryTitle()}, ${queryTypeLabel(this.type())} query`,
      stamp?.full,
    ]
      .filter(Boolean)
      .join('. ');
  });

  private hoverTimer?: ReturnType<typeof setTimeout>;
  private load?: Subscription;
  private focused = false;

  protected hover(on: boolean): void {
    this.cancelHoverIntent();
    if (!on) {
      if (!this.focused) this.deactivate();
      return;
    }
    // Touch devices do not hover: tapping opens the query, with no preview.
    if (!canHover()) return;
    this.hoverTimer = setTimeout(
      () => this.activate(),
      QUERY_PREVIEW_HOVER_DELAY_MS,
    );
  }

  protected focus(on: boolean): void {
    this.focused = on;
    if (!on) {
      this.deactivate();
      return;
    }
    if (canHover()) this.activate();
  }

  /** Escape hides a visible preview until the row is left and entered again. */
  protected dismiss(): void {
    if (this.active()) this.dismissed.set(true);
  }

  ngOnDestroy(): void {
    this.cancelHoverIntent();
    this.load?.unsubscribe();
  }

  private activate(): void {
    this.active.set(true);
    const load = this.loadText();
    if (!load || this.previewText() !== undefined || this.load) return;
    this.load = load()
      .pipe(
        take(1),
        catchError(() => of(undefined)),
      )
      .subscribe((text) => this.previewText.set(queryPreviewText(text)));
  }

  private deactivate(): void {
    this.active.set(false);
    this.dismissed.set(false);
    // Cancel an in-flight load (the shared cache cancels the request when no row still waits for it).
    this.load?.unsubscribe();
    this.load = undefined;
  }

  private cancelHoverIntent(): void {
    if (this.hoverTimer !== undefined) clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }
}

function canHover(): boolean {
  try {
    return window.matchMedia?.('(hover: hover)').matches ?? true;
  } catch {
    return true;
  }
}

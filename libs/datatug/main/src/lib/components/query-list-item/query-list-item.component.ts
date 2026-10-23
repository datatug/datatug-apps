import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Params, RouterLink, UrlTree } from '@angular/router';
import { IonItem, IonLabel } from '@ionic/angular';
import { Observable, catchError, of, take } from 'rxjs';
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

/**
 * `<sneat-datatug-query-list-item [queryTitle]="q.title" [type]="q.request.queryType" [createdAt]="q.createdAt"
 *   [href]="link" [loadText]="loader" />`
 *
 * The ONE row for a saved query in any list (the project Queries tab, the Queries page folder and filter views, an
 * entity's related queries, the open-queries menu; Quick Search adopts it next). It renders an `ion-item` with:
 * - the {@link QueryTypeIconComponent} (neutral icon, per-type badge) in the start slot, so the type shows once;
 * - the title and, on the right of the same line, the light locale date (time today) with the full "Added …" text
 *   as tooltip and accessible text;
 * - optional projected content: `[queryRowSubtitle]` (a line under the title, e.g. the folder) and
 *   `[queryRowActions]` (put an `<ion-buttons slot="end" queryRowActions>` with edit/run/close buttons);
 * - an optional read-only preview of the query text (first 8 lines, highlighted like the query editor) shown on
 *   hover and keyboard focus on devices that hover. `loadText` is called once, on the first hover/focus; an empty
 *   text or a failed load shows nothing.
 *
 * Inputs: `queryTitle` (required), `type`, `createdAt`, `modifiedAt`, `href` + `queryParams` (navigation), `detail`,
 * `selected`, `titleTestId`, `itemTestId`, `ariaLabel` (replaces the default accessible name), `loadText`.
 * Output: `opened`, emitted on click when there is no `href`.
 */
@Component({
  selector: 'sneat-datatug-query-list-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonItem,
    IonLabel,
    QueryTypeIconComponent,
    QueryItemHeadingComponent,
  ],
  template: `
    <ion-item
      button
      [detail]="detail()"
      [routerLink]="href() ?? null"
      [queryParams]="queryParams()"
      [attr.aria-label]="accessibleName()"
      [attr.aria-describedby]="previewVisible() ? previewId : null"
      [attr.data-testid]="itemTestId()"
      [class.query-list-item-selected]="selected()"
      (click)="onClick()"
      (mouseenter)="hover(true)"
      (mouseleave)="hover(false)"
      (focusin)="focus(true)"
      (focusout)="focus(false)"
    >
      <sneat-datatug-query-type-icon slot="start" [type]="type()" />
      <ion-label>
        <sneat-datatug-query-item-heading
          [queryTitle]="queryTitle()"
          [createdAt]="createdAt()"
          [modifiedAt]="modifiedAt()"
          [testId]="titleTestId()"
        />
        <ng-content select="[queryRowSubtitle]" />
      </ion-label>
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
    .query-list-item-selected ion-label {
      color: var(--ion-color-primary);
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
export class QueryListItemComponent {
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
  /** Loads the query's text for the hover preview; called at most once per row. */
  readonly loadText = input<
    (() => Observable<string | null | undefined>) | undefined
  >(undefined);
  readonly opened = output<void>();

  private readonly destroyRef = inject(DestroyRef);
  protected readonly previewId = `query-preview-${++nextPreviewId}`;
  private readonly hovered = signal(false);
  private readonly focused = signal(false);
  private readonly loadState = signal<'idle' | 'loading' | 'done'>('idle');
  protected readonly previewText = signal<string | undefined>(undefined);
  protected readonly previewVisible = computed(
    () => (this.hovered() || this.focused()) && !!this.previewText(),
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

  protected onClick(): void {
    if (!this.href()) this.opened.emit();
  }

  protected hover(on: boolean): void {
    // Touch devices do not hover: tapping opens the query, with no preview.
    if (on && !canHover()) return;
    this.hovered.set(on);
    if (on) this.ensureText();
  }

  protected focus(on: boolean): void {
    if (on && !canHover()) return;
    this.focused.set(on);
    if (on) this.ensureText();
  }

  private ensureText(): void {
    const load = this.loadText();
    if (!load || this.loadState() !== 'idle') return;
    this.loadState.set('loading');
    load()
      .pipe(
        take(1),
        catchError(() => of(undefined)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (text) => this.previewText.set(queryPreviewText(text)),
        complete: () => this.loadState.set('done'),
      });
  }
}

function canHover(): boolean {
  try {
    return window.matchMedia?.('(hover: hover)').matches ?? true;
  } catch {
    return true;
  }
}

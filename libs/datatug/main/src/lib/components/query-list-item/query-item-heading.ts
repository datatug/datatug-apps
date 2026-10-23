import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { highlightParts } from './highlight-parts';

export interface QueryTimestamp {
  /** The machine-readable instant, for `<time datetime>`. */
  readonly iso: string;
  /** Time today, otherwise day and month, with the year only when it is not this year. */
  readonly short: string;
  /** Hover/focus and accessible text, e.g. "Added 22 Oct 2026, 14:05". */
  readonly full: string;
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Formats a query's timestamp for a list row in the user's locale (`locale` undefined) or a given one (tests).
 * Returns undefined when there is no valid creation time.
 */
export function formatQueryTimestamp(
  createdAt: string | undefined,
  modifiedAt?: string,
  now: Date = new Date(),
  locale?: string,
): QueryTimestamp | undefined {
  const created = createdAt ? new Date(createdAt) : undefined;
  if (!created || Number.isNaN(created.getTime())) return undefined;
  const short = sameDay(created, now)
    ? created.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : created.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        ...(created.getFullYear() === now.getFullYear()
          ? {}
          : { year: 'numeric' }),
      });
  const long = (date: Date): string =>
    date.toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const modified = modifiedAt ? new Date(modifiedAt) : undefined;
  const full =
    `Added ${long(created)}` +
    (modified && !Number.isNaN(modified.getTime())
      ? `. Modified ${long(modified)}`
      : '');
  return { iso: created.toISOString(), short, full };
}

/**
 * The first line of a query row: the title, then the timestamp as light text on the right of the same line. The
 * title wraps first; the timestamp never wraps under it. The full "Added …" text shows on hover and focus (`title`)
 * and is the timestamp's accessible text. With `highlight`, every case-insensitive occurrence of it in the title is
 * wrapped in `<mark>`.
 */
@Component({
  selector: 'sneat-datatug-query-item-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="query-item-heading">
      @if (titleParts(); as parts) {
        <h3 [attr.data-testid]="testId()">
          @for (part of parts; track $index) {
            @if (part.hit) {
              <mark>{{ part.text }}</mark>
            } @else {
              <span>{{ part.text }}</span>
            }
          }
        </h3>
      } @else {
        <h3 [attr.data-testid]="testId()">{{ queryTitle() }}</h3>
      }
      @if (stamp(); as s) {
        <time [attr.datetime]="s.iso" [attr.title]="s.full"
          ><span aria-hidden="true">{{ s.short }}</span
          ><span class="visually-hidden">{{ s.full }}</span></time
        >
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .query-item-heading {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }
    /* Same type scale as an ion-label h3, wherever the heading sits. */
    h3 {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      font-size: 1rem;
      font-weight: 400;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    mark {
      background: rgba(var(--ion-color-warning-rgb), 0.35);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    time {
      flex: 0 0 auto;
      margin-left: auto;
      color: var(--dt-text-muted);
      font-size: 0.8125rem;
      white-space: nowrap;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class QueryItemHeadingComponent {
  readonly queryTitle = input.required<string>();
  readonly createdAt = input<string | undefined>(undefined);
  readonly modifiedAt = input<string | undefined>(undefined);
  readonly testId = input<string | undefined>(undefined);
  /** Search text to mark in the title (Quick Search); empty marks nothing. */
  readonly highlight = input<string | undefined>(undefined);
  /** The title split around search hits, or undefined when nothing is marked (the title renders as plain text). */
  protected readonly titleParts = computed(() => {
    const parts = highlightParts(this.queryTitle(), this.highlight() ?? '');
    return parts.some((part) => part.hit) ? parts : undefined;
  });
  protected readonly stamp = computed(() =>
    formatQueryTimestamp(this.createdAt(), this.modifiedAt()),
  );
}

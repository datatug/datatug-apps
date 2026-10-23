import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

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
 * and is the timestamp's accessible text.
 */
@Component({
  selector: 'sneat-datatug-query-item-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="query-item-heading">
      <h3 [attr.data-testid]="testId()">{{ queryTitle() }}</h3>
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
    h3 {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
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
  protected readonly stamp = computed(() =>
    formatQueryTimestamp(this.createdAt(), this.modifiedAt()),
  );
}

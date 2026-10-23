import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { IonIcon } from '@ionic/angular';

/** The colour token a query type uses (`--datatug-query-type-<key>` in the app styles); unknown types are grey. */
export function queryTypeKey(
  type: string | undefined,
): 'sql' | 'tugql' | 'http' | 'other' {
  switch ((type ?? '').toUpperCase()) {
    case 'SQL':
      return 'sql';
    case 'TUGQL':
      return 'tugql';
    case 'HTTP':
      return 'http';
    default:
      return 'other';
  }
}

/**
 * The one map from a stored query type (case-insensitive) to the name users see. Unknown types show as stored, or
 * `?` when empty.
 */
export const QUERY_TYPE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  sql: 'SQL',
  tugql: 'TugQL',
  http: 'HTTP',
};

export function queryTypeLabel(type: string | undefined): string {
  const stored = type?.trim();
  if (!stored) return '?';
  return QUERY_TYPE_DISPLAY_NAMES[stored.toLowerCase()] ?? stored;
}

/**
 * `<sneat-datatug-query-type-icon [type]="query.request.queryType" slot="start" />`
 *
 * The one icon for a saved query anywhere it is listed (the project Queries tab, the Queries page, Quick Search):
 * the query document icon in a NEUTRAL colour (`--ion-color-medium`, never primary or the type colour) with the
 * query type as a small badge on its bottom-right corner, coloured by the type's token
 * (`--datatug-query-type-sql|tugql|http|other`, defined with light and dark values in the app `styles.scss`).
 *
 * API: one input, `type` (the query's `request.queryType`, e.g. `SQL`, `TugQL`, `HTTP`; any other value
 * shows grey). TugQL, DataTug's native format, uses the brand-blue token. The badge is decorative; the type is also rendered as
 * visually hidden text ("SQL query") for screen readers. Place it in an `ion-item` with `slot="start"`.
 */
@Component({
  selector: 'sneat-datatug-query-type-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonIcon],
  template: `
    <span class="query-type-icon" [attr.data-query-type]="key()">
      <ion-icon name="document-text-outline" aria-hidden="true" />
      <span class="query-type-badge" aria-hidden="true">{{ label() }}</span>
    </span>
    <span class="visually-hidden">{{ label() }} query</span>
  `,
  styles: `
    /* The icon column reserves the badge's overhang (6px past the icon's right edge), then keeps 12px of clear
       space between the badge's right edge and the title. */
    :host {
      display: inline-flex;
      padding-inline-end: 6px;
      margin-inline-end: 12px;
    }
    .query-type-icon {
      position: relative;
      display: inline-flex;
      font-size: 24px;
      color: var(--ion-color-medium);
      --datatug-query-type-color: var(--datatug-query-type-other);
    }
    .query-type-icon[data-query-type='sql'] {
      --datatug-query-type-color: var(--datatug-query-type-sql);
    }
    .query-type-icon[data-query-type='tugql'] {
      --datatug-query-type-color: var(--datatug-query-type-tugql);
    }
    .query-type-icon[data-query-type='http'] {
      --datatug-query-type-color: var(--datatug-query-type-http);
    }
    .query-type-badge {
      position: absolute;
      right: -6px;
      bottom: -4px;
      padding: 0 2px;
      border-radius: 3px;
      background: var(--datatug-query-type-color);
      color: var(--datatug-query-type-text);
      font-size: 8.5px;
      font-weight: 700;
      line-height: 12px;
      letter-spacing: 0.02em;
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
export class QueryTypeIconComponent {
  readonly type = input<string | undefined>(undefined);
  protected readonly key = computed(() => queryTypeKey(this.type()));
  protected readonly label = computed(() => queryTypeLabel(this.type()));
}

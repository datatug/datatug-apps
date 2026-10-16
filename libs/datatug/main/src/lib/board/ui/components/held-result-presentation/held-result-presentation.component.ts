import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import {
  LimitationHeaderComponent,
  SourceRightsNoticeComponent,
  type Result,
  type BrowserPublicApiChartRecordset,
  type TypedValue,
} from '@sneat/datatug-semantic';

import type { FederatedQueryResult } from '../../../../queries/federated-query-executor';

export interface CategoryBarFields {
  readonly categoryColumn: string;
  readonly measureColumn: string;
  readonly title: string;
  readonly unit?: string;
}

export interface CategoryBar {
  readonly category: string;
  readonly value: number;
  readonly sourceRow: number;
}

export type CategoryBarsResult =
  | { readonly ok: true; readonly bars: readonly CategoryBar[] }
  | { readonly ok: false; readonly message: string };

/** Only displays a previously admitted, held result; never executes or alters a query. */
export function prepareCategoryBars(
  result: Pick<Result, 'recordset'>,
  fields: CategoryBarFields,
): CategoryBarsResult {
  const columns = result.recordset.columns;
  const names = columns.map((column) => column.name);
  if (new Set(names).size !== names.length)
    return { ok: false, message: 'This result has duplicate column names.' };
  const categoryIndex = names.indexOf(fields.categoryColumn);
  const measureIndex = names.indexOf(fields.measureColumn);
  if (categoryIndex < 0 || measureIndex < 0 || categoryIndex === measureIndex) {
    return {
      ok: false,
      message: 'Choose distinct category and measure columns from this result.',
    };
  }
  if (
    columns[categoryIndex].type !== 'string' ||
    !['integer', 'number'].includes(columns[measureIndex].type)
  ) {
    return {
      ok: false,
      message: 'This chart needs a string category and an integer count.',
    };
  }

  const seen = new Set<string>();
  const bars: CategoryBar[] = [];
  for (const [sourceRow, row] of result.recordset.rows.entries()) {
    if (row.length !== columns.length)
      return {
        ok: false,
        message: `Row ${sourceRow + 1} has the wrong number of values.`,
      };
    const category = row[categoryIndex];
    const measure = row[measureIndex];
    if (
      category.type !== 'string' ||
      !category.value.trim() ||
      (measure.type !== 'number' && measure.type !== 'integer')
    ) {
      return {
        ok: false,
        message: `Row ${sourceRow + 1} cannot be displayed as a category count.`,
      };
    }
    const value = Number(measure.value);
    if (!Number.isSafeInteger(value) || value < 0) {
      return {
        ok: false,
        message: `Row ${sourceRow + 1} has an unsupported count.`,
      };
    }
    if (seen.has(category.value))
      return {
        ok: false,
        message: `Category ${category.value} occurs more than once.`,
      };
    seen.add(category.value);
    bars.push({ category: category.value, value, sourceRow });
  }
  bars.sort(
    (left, right) =>
      right.value - left.value || left.category.localeCompare(right.category),
  );
  return { ok: true, bars };
}

/** Bar view and row inspection share the exact same Result input and never refetch. */
@Component({
  selector: 'datatug-held-result-presentation',
  standalone: true,
  imports: [LimitationHeaderComponent, SourceRightsNoticeComponent],
  templateUrl: './held-result-presentation.component.html',
  styleUrl: './held-result-presentation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeldResultPresentationComponent implements OnChanges {
  @Input() result:
    | Result
    | FederatedQueryResult
    | BrowserPublicApiChartRecordset
    | null = null;
  @Input() fields: CategoryBarFields | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;

  get publicApiReceipt() {
    return this.result &&
      'runtime' in this.result &&
      this.result.runtime === 'browser-public-api'
      ? this.result.publicApiReceipt
      : null;
  }

  readonly topN = signal(10);
  readonly view = signal<'chart' | 'grid'>('chart');
  readonly page = signal(0);
  readonly selectedRow = signal<number | null>(null);
  readonly pageSize = 25;
  readonly numberFormat = new Intl.NumberFormat();
  prepared: CategoryBarsResult | null = null;
  private focusSelectedDetails = false;

  @ViewChild('selectedDetails') set selectedDetails(
    ref: ElementRef<HTMLElement> | undefined,
  ) {
    if (ref && this.focusSelectedDetails) {
      this.focusSelectedDetails = false;
      ref.nativeElement.focus();
    }
  }

  get bars(): readonly CategoryBar[] {
    return this.prepared?.ok ? this.prepared.bars.slice(0, this.topN()) : [];
  }

  get topNOptions(): readonly number[] {
    const count = this.prepared?.ok ? this.prepared.bars.length : 0;
    return [
      ...new Set([5, 10, 20, 50, 100].map((limit) => Math.min(count, limit))),
    ].filter(Boolean);
  }

  get maxValue(): number {
    return Math.max(1, ...this.bars.map((bar) => bar.value));
  }

  get rows(): readonly (readonly TypedValue[])[] {
    return (
      this.result?.recordset.rows.slice(
        this.page() * this.pageSize,
        (this.page() + 1) * this.pageSize,
      ) ?? []
    );
  }

  get pageCount(): number {
    return Math.max(
      1,
      Math.ceil((this.result?.recordset.rows.length ?? 0) / this.pageSize),
    );
  }

  get selectedValues(): readonly TypedValue[] | null {
    const row = this.selectedRow();
    return row === null ? null : (this.result?.recordset.rows[row] ?? null);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['result'] || changes['fields']) {
      this.prepared =
        this.result && this.fields
          ? prepareCategoryBars(this.result, this.fields)
          : null;
      this.view.set(this.prepared?.ok ? 'chart' : 'grid');
      this.topN.set(
        Math.min(
          10,
          this.prepared?.ok ? Math.max(1, this.prepared.bars.length) : 10,
        ),
      );
      this.page.set(0);
      this.selectedRow.set(null);
      this.focusSelectedDetails = false;
    }
  }

  setTopN(event: Event): void {
    const requested = Number((event.target as HTMLSelectElement).value);
    if (this.topNOptions.includes(requested)) this.topN.set(requested);
  }

  selectRow(index: number): void {
    if (!this.result?.recordset.rows[index]) return;
    this.selectedRow.set(index);
    this.page.set(Math.floor(index / this.pageSize));
    this.view.set('grid');
  }

  inspectBar(index: number): void {
    if (!this.result?.recordset.rows[index]) return;
    this.focusSelectedDetails = true;
    this.selectRow(index);
  }

  previousPage(): void {
    this.page.set(Math.max(0, this.page() - 1));
  }
  nextPage(): void {
    this.page.set(Math.min(this.pageCount - 1, this.page() + 1));
  }

  display(value: TypedValue): string {
    if (value.type === 'null') return '—';
    if (value.type === 'boolean') return value.value ? 'True' : 'False';
    return String(value.value);
  }
}

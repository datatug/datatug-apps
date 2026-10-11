import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type {
  ComparisonFixtureTarget,
  ComparisonSessionSnapshot,
  ComparisonSideState,
  CoreCompareChangedRow,
  CoreCompareRow,
  SessionCompareResult,
} from '../../public-sqlite-comparison';
import { PUBLIC_CHINOOK_COMPARISON_TARGETS } from '../../public-sqlite-comparison';

type CompareFilter = 'all' | 'changed' | 'baseline-only' | 'candidate-only';

interface DisplayDifference {
  readonly kind: 'changed' | 'baseline-only' | 'candidate-only';
  readonly key: string;
  readonly changed?: CoreCompareChangedRow;
  readonly row?: CoreCompareRow;
}

const typedValueText = (value: { readonly type: string; readonly value: string | null }): string =>
  value.value === null ? 'NULL' : value.value;

@Component({
  selector: 'sneat-public-sqlite-comparison-panel',
  templateUrl: './public-sqlite-comparison-panel.component.html',
  styleUrl: './public-sqlite-comparison-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
})
export class PublicSqliteComparisonPanelComponent {
  public readonly targetList = PUBLIC_CHINOOK_COMPARISON_TARGETS;
  public readonly snapshot = input<ComparisonSessionSnapshot>();
  public readonly result = input<SessionCompareResult>();
  public readonly blockedReason = input('Preview a supported bounded Invoice query to begin.');
  public readonly customerBinding = input('');
  public readonly queryLimit = input('');
  public readonly message = input('');
  public readonly busy = input(false);
  public readonly runBoth = output<void>();
  public readonly retrySide = output<ComparisonFixtureTarget['id']>();
  public readonly cancelSide = output<ComparisonFixtureTarget['id']>();
  public readonly compare = output<void>();
  public readonly filter = signal<CompareFilter>('all');

  public readonly sides = computed(() => this.snapshot()?.sides ?? []);
  public readonly canCompare = computed(() =>
    !this.busy() && this.sides().length === 2 &&
    this.sides().every((side) => side.status === 'complete' && !!side.observation) &&
    !this.snapshot()?.invalidated,
  );
  public readonly differences = computed<readonly DisplayDifference[]>(() => {
    const diff = this.result()?.diff;
    if (!diff) return [];
    const entries: DisplayDifference[] = [
      ...diff.changed.map((changed) => ({
        kind: 'changed' as const,
        key: changed.key.map(typedValueText).join(' · '),
        changed,
      })),
      ...diff.removed.map((row) => ({
        kind: 'baseline-only' as const,
        key: row.key.map(typedValueText).join(' · '),
        row,
      })),
      ...diff.added.map((row) => ({
        kind: 'candidate-only' as const,
        key: row.key.map(typedValueText).join(' · '),
        row,
      })),
    ];
    const filter = this.filter();
    return filter === 'all' ? entries : entries.filter((entry) => entry.kind === filter);
  });

  public sideLabel(side: ComparisonSideState): string {
    return side.target.role === 'baseline' ? 'Baseline' : 'Candidate';
  }

  public targetLabel(target: ComparisonFixtureTarget): string {
    return target.role === 'baseline' ? 'Baseline' : 'Candidate';
  }

  public statusText(side: ComparisonSideState): string {
    switch (side.status) {
      case 'queued': return 'Ready to run';
      case 'running': return 'Running bounded query…';
      case 'complete': return `${side.observation?.rowCount ?? 0} complete rows observed`;
      case 'failed': return side.error || 'This side failed.';
      case 'cancelled': return 'Cancelled. Retry this side when ready.';
    }
  }

  public valueText(row: CoreCompareRow, columnIndex: number): string {
    return typedValueText(row.row[columnIndex] ?? { type: 'null', value: null });
  }

  public changeValue(row: CoreCompareChangedRow, column: string, side: 'left' | 'right'): string {
    const changed = row.columns.find((item) => item.column === column);
    return changed ? typedValueText(changed[side]) : '—';
  }
}

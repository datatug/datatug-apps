import { Component, computed, inject, input, signal } from '@angular/core';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonInput,
  IonItem,
  IonNote,
} from '@ionic/angular';
import { IncidentClientService } from '../../../incidents/incident-client.service';
import {
  comparisonCacheId,
  formatCompareValue,
  type CompareCachedRow,
  type CompareChangedRow,
  type CompareColumn,
  type CompareRequest,
  type CompareResult,
  type CompareRow,
  type CompareSideReceipt,
} from '../../../incidents/incident-compare';
import { datatugServeProjectStoreId } from '../../../incidents/incident-route-context';
import type {
  IncidentDetail,
  IncidentRequestContext,
} from '../../../incidents/models';

@Component({
  selector: 'sneat-datatug-incident-compare-panel',
  templateUrl: './incident-compare-panel.component.html',
  imports: [IonButton, IonCard, IonCardContent, IonInput, IonItem, IonNote],
})
export class IncidentComparePanelComponent {
  private readonly incidentClient = inject(IncidentClientService);

  readonly context = input<IncidentRequestContext | undefined>(undefined);
  readonly incident = input<IncidentDetail | undefined>(undefined);

  protected readonly queryId = signal('');
  protected readonly distributionColumn = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly result = signal<CompareResult | undefined>(undefined);
  protected readonly matchingRows = signal<readonly CompareCachedRow[]>([]);
  protected readonly matchingNext = signal<string | undefined>(undefined);
  protected readonly matchingCountOnly = signal(false);
  private readonly mutationId = signal<string | undefined>(undefined);

  protected readonly canRun = computed(() => {
    return (
      !!this.context() &&
      !!this.incident() &&
      this.queryId().trim().length > 0 &&
      !this.loading()
    );
  });

  protected onQueryInput(event: Event): void {
    this.queryId.set(inputValue(event));
  }

  protected onDistributionInput(event: Event): void {
    this.distributionColumn.set(inputValue(event));
  }

  protected formatValue = formatCompareValue;

  protected run(): void {
    const context = this.context();
    const incident = this.incident();
    const queryId = this.queryId().trim();
    if (!context || !incident || !queryId || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set(undefined);
    this.result.set(undefined);
    this.matchingRows.set([]);
    this.matchingNext.set(undefined);
    this.matchingCountOnly.set(false);
    let mutationId = this.mutationId();
    if (!mutationId) {
      mutationId = `compare-${crypto.randomUUID()}`;
      this.mutationId.set(mutationId);
    }
    const distributionColumn = this.distributionColumn().trim();
    const request: CompareRequest = {
      securityContextId: context.scope.securityContextId,
      queryId,
      left: {
        kind: 'facts',
        storeId: datatugServeProjectStoreId,
        project: context.scope.project,
        environment: context.scope.environment,
        cohortRole: 'affected',
      },
      right: {
        kind: 'facts',
        storeId: datatugServeProjectStoreId,
        project: context.scope.project,
        environment: context.scope.environment,
        cohortRole: 'control',
      },
      incident: incident.ref,
      mutationId,
      ...(distributionColumn ? { distributionColumn } : {}),
    };
    this.incidentClient.compare(context, request).subscribe((response) => {
      this.loading.set(false);
      if (response.kind !== 'ok') {
        this.error.set(response.message);
        return;
      }
      this.mutationId.set(undefined);
      this.result.set(response.data);
      this.loadMatching(context, response.data);
    });
  }

  protected loadMoreMatching(): void {
    const context = this.context();
    const result = this.result();
    const after = this.matchingNext();
    if (!context || !result || !after || this.loading()) {
      return;
    }
    this.loadMatching(context, result, after);
  }

  private loadMatching(
    context: IncidentRequestContext,
    result: CompareResult,
    after?: string,
  ): void {
    this.incidentClient
      .compareRows(
        context,
        comparisonCacheId(result.left.execution, result.right.execution),
        'matched',
        after,
      )
      .subscribe((response) => {
        if (response.kind !== 'ok') {
          if (!after) {
            this.matchingCountOnly.set(true);
          }
          return;
        }
        this.matchingCountOnly.set(false);
        this.matchingRows.update((rows) =>
          after ? [...rows, ...response.data.rows] : [...response.data.rows],
        );
        this.matchingNext.set(response.data.nextSortKey);
      });
  }

  protected sideLabel(side: 'left' | 'right'): string {
    return side === 'left' ? 'Affected' : 'Control';
  }

  protected limitations(receipt: CompareSideReceipt): string {
    if (!receipt.limitations.length) {
      return 'None reported.';
    }
    return receipt.limitations
      .map((item) => {
        const hidden = item.hiddenColumns.length
          ? `; hidden ${item.hiddenColumns.join(', ')}`
          : '';
        return `${item.policy}${item.rowsFiltered ? ' (rows filtered)' : ''}${hidden}`;
      })
      .join(' · ');
  }

  protected rowCells(row: CompareRow | CompareCachedRow): readonly string[] {
    return row.row.map((value) => formatCompareValue(value));
  }

  protected keyCells(
    row: CompareRow | CompareChangedRow | CompareCachedRow,
  ): string {
    return row.key.map((value) => formatCompareValue(value)).join(', ');
  }

  protected columnNames(columns: readonly CompareColumn[]): readonly string[] {
    return columns.map((column) => column.name);
  }
}

function inputValue(event: Event): string {
  const detail = (event as CustomEvent<{ value?: string | null }>).detail;
  return detail?.value ?? '';
}

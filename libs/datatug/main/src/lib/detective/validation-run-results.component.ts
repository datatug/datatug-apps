import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { IonButton, IonItem, IonLabel, IonList } from '@ionic/angular';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule,
  ColDef,
  ModuleRegistry,
  RowClickedEvent,
} from 'ag-grid-community';
import {
  resultLines,
  validatorGridRows,
  ValidatorGridRow,
  ValidationRowSelection,
} from './detective-forms';
import { CheckRun, DetectiveExecutionRef } from './models';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Reusable status/tree view for Check and query-local Validator runs. */
@Component({
  selector: 'sneat-validation-run-results',
  templateUrl: './validation-run-results.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, IonButton, IonItem, IonLabel, IonList, AgGridAngular],
})
export class ValidationRunResultsComponent {
  readonly run = input.required<CheckRun>();
  readonly rootExecution = input<DetectiveExecutionRef | undefined>();
  readonly rootQueryId = input<string | undefined>();
  readonly rowSelected = output<ValidationRowSelection>();
  protected readonly lines = computed(() => resultLines(this.run().steps));
  protected readonly rows = computed(() => validatorGridRows(this.run().steps));
  private readonly expandedRunId = signal('');
  protected readonly showPassing = computed(
    () => this.expandedRunId() === this.run().id,
  );
  protected readonly passingCount = computed(
    () => this.rows().filter((row) => row.outcome === 'pass').length,
  );
  protected readonly failingCount = computed(
    () => this.rows().filter((row) => row.outcome === 'fail').length,
  );
  protected readonly unknownCount = computed(
    () => this.rows().filter((row) => row.outcome === 'unknown').length,
  );
  protected readonly visibleRows = computed(() =>
    this.showPassing()
      ? this.rows()
      : this.rows().filter((row) => row.outcome !== 'pass'),
  );
  protected readonly visibleLines = computed(() => {
    const lines = this.lines();
    if (this.showPassing()) return lines;
    const relevant = lines.filter((line) => line.outcome !== 'pass');
    const keys = new Set(relevant.map((line) => line.key));
    for (const line of relevant) {
      const parts = line.key.split('/');
      while (parts.length > 2) {
        parts.pop();
        keys.add(parts.join('/'));
      }
    }
    return lines.filter((line) => keys.has(line.key));
  });

  protected togglePassing(): void {
    this.expandedRunId.set(this.showPassing() ? '' : this.run().id);
  }
  protected readonly columns: ColDef<ValidatorGridRow>[] = [
    { field: 'query', headerName: 'Query' },
    { field: 'row', headerName: 'Row', width: 105 },
    { field: 'validator', headerName: 'Validator' },
    { field: 'outcome', headerName: 'Outcome', width: 125 },
    { field: 'severity', headerName: 'Severity', width: 125 },
    { field: 'message', headerName: 'Detail', flex: 2 },
  ];
  protected readonly defaultColumn: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    flex: 1,
  };

  protected onGridRowClicked(event: RowClickedEvent<ValidatorGridRow>): void {
    const row = event.data;
    if (row?.rowIndex !== undefined && this.canSelect(row))
      this.rowSelected.emit({
        rowIndex: row.rowIndex,
        queryId: row.queryId,
        execution: row.execution,
        nodePath: row.nodePath,
      });
  }
  protected canSelect(
    row: Omit<ValidationRowSelection, 'rowIndex'> & { rowIndex?: number },
  ): boolean {
    const root = this.rootExecution();
    return (
      row.rowIndex !== undefined &&
      !!root &&
      row.queryId === this.rootQueryId() &&
      /^root\/0\/validator\/\d+$/u.test(row.nodePath) &&
      row.execution?.storeId === root.storeId &&
      row.execution?.projectId === root.projectId &&
      row.execution?.executionId === root.executionId
    );
  }
  protected selectLine(line: ValidationRowSelection): void {
    if (this.canSelect(line)) this.rowSelected.emit(line);
  }
}

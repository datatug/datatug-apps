import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnChanges,
  SimpleChanges,
  inject,
  input
} from '@angular/core';
import { DataGridComponent } from '@sneat/datagrid';
import { IGridDef } from '@sneat/grid';
import { ErrorLogger, IErrorLogger } from '@sneat/core';

@Component({
  selector: 'sneat-datatug-grid-widget',
  templateUrl: './grid-widget.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataGridComponent],
})
export class GridWidgetComponent implements OnChanges {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  readonly recordset = input<IRecordset>();
  readonly hideColumns = input<string[]>();

  public grid?: IGridDef;

  ngOnChanges(changes: SimpleChanges): void {
    try {
      const recordset = this.recordset();
      if (changes['recordset'] && recordset) {
        this.grid = recordsetToGridDef(recordset, this.hideColumns());
        this.changeDetectorRef.markForCheck();
      }
    } catch (ex) {
      this.errorLogger.logError(
        ex,
        'Failed to process ngOnChanges by GridWidgetComponent',
      );
    }
  }
}

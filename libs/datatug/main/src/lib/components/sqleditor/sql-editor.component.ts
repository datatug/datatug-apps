import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';

@Component({
  selector: 'sneat-datatug-sql',
  templateUrl: './sql-editor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CodeEditor],
})
export class SqlEditorComponent {
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  readonly sql = input<string>();
  readonly lineNumbers = input(false);
  readonly readonly = input(true);

  @Output() sqlChanged = new EventEmitter<string>();

  public onSqlChanged(sql: string): void {
    this.sqlChanged.emit(sql);
  }
}

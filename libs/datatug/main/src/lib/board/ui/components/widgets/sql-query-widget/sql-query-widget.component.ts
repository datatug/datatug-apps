import {
  ChangeDetectorRef,
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
  input,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonSegment, IonSegmentButton } from '@ionic/angular';
import { GridWidgetComponent } from '../grid-widget/grid-widget.component';
import { BoardCardTabService } from '../../board-card/board-card.component';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SQLWidgetDef } from '@datatug/board-models';
import { SqlEditorComponent } from '../../../../../components/sqleditor/sql-editor.component';
import { QueryType } from '../../../../../models/definition/query-def';
import { IBoardContext } from '../../../../../models/definition/board/board';
import { IRecordsetResult, IRecordset } from '../../../../../dto/execute';

const reSqlParams = /@(\w+)/;

@Component({
  selector: 'sneat-datatug-sql-query-widget',
  templateUrl: './sql-query-widget.component.html',
  imports: [
    IonSegment,
    IonSegmentButton,
    SqlEditorComponent,
    GridWidgetComponent,
    FormsModule,
  ],
})
export class SqlQueryWidgetComponent implements OnChanges, OnDestroy {
  private readonly boardCardTab = inject(BoardCardTabService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly level = input<number>();
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  readonly tab = model<(QueryType | 'grid' | 'card') | undefined>(QueryType.SQL);
  readonly sqlWidgetDef = input<SQLWidgetDef>();
  readonly boardContext = input<IBoardContext>();

  public state?: 'loading' | 'loaded' | 'error';

  public sql?: string;
  public recordsetResult?: IRecordsetResult = undefined;
  public recordset?: IRecordset = undefined;

  destroyed = new Subject<boolean>();

  constructor() {
    const boardCardTab = this.boardCardTab;

    setTimeout(() => boardCardTab.setTab('grid'), 2000);
    this.boardCardTab.changed
      .pipe(takeUntil(this.destroyed))
      .subscribe(() => this.changeDetectorRef.markForCheck());
  }

  ngOnDestroy(): void {
    this.destroyed.next(true);
    this.destroyed.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const def = this.sqlWidgetDef();
    if ((changes['sqlWidgetDef'] || changes['boardContext']) && def) {
      let sql = def.sql.query;
      const match = sql.match(reSqlParams);
      if (match) {
        const paramName = match[1];
        const parameter = this.boardContext()?.parameters[paramName];
        if (parameter) {
          switch (parameter.type) {
            case 'string':
            case 'GUID':
            case 'UUID':
              sql = sql.replace(match[0], `'${parameter.value}'`);
              break;
            case 'integer':
              sql = sql.replace(match[0], `${parameter.value}`);
          }
        }
      }
      this.sql = sql;
      // boards.go's SQLWidgetSettings is `{ query }` only — no db/env
      // execution target. See @datatug/board-models README "Open questions
      // for boards.go (datatug-core)".
      this.changeDetectorRef.markForCheck();
    }
  }
}

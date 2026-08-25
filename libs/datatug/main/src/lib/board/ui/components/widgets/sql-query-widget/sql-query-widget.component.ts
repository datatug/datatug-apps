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
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { AgentService } from '../../../../../services/repo/agent.service';
import { SqlEditorComponent } from '../../../../../components/sqleditor/sql-editor.component';
import { QueryType } from '../../../../../models/definition/query-def';
import { ISqlWidgetSettings } from '../../../../../models/definition/board/widget-sql';
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
  private readonly agentService = inject(AgentService);
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);

  readonly level = input<number>();
  // TODO: Skipped for migration because:
  //  Your application code writes to the input. This prevents migration.
  readonly tab = model<(QueryType | 'grid' | 'card') | undefined>(QueryType.SQL);
  readonly data = input<ISqlWidgetSettings>();
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
    const data = this.data();
    if ((changes['data'] || changes['boardContext']) && data) {
      let sql = data.query;
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
      if (data.env && data.db) {
        this.agentService
          .select('localhost:8989', {
            sql,
            env: data.env || 'LOCAL',
            db: data.db,
            proj: '.',
          })
          .subscribe({
            next: () => {
              alert('not implemented processing response');
              // const itemWithRecordset = response.commands[0].items[0] as ICommandResponseWithRecordset
              // this.recordset = itemWithRecordset.value;
              this.changeDetectorRef.markForCheck();
            },
            error: (err) =>
              this.errorLogger.logError(err, 'Failed to load data'),
          });
      } else {
        // TODO: temporary debug thing
        console.log(
          `Not issuing SELECT query as env=${data.env}, db=${data.db}`,
        );
      }
      if (data.db) {
        this.sql = `-- USE ${data.db};
${this.sql}`;
      }
      this.changeDetectorRef.markForCheck();
    }
  }
}

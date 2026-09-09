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
  readonly tab = model<(QueryType | 'grid' | 'card') | undefined>(
    QueryType.SQL,
  );
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
      // boards.go's SQLWidgetSettings now references a query by id
      // (`sql.queryId`) instead of carrying inline SQL text — see the
      // widget-query-ref decision recorded in @datatug/board-models
      // README "Open questions for boards.go (datatug-core)". Resolving
      // queryId to query text (and substituting bound parameters) requires
      // a server call that does not exist yet, so this widget cannot
      // render SQL text until that lands (Phase 3,
      // REQ:board-persistence-and-query-binding). This component is
      // unreachable dead code today: the `@case ('SQL')` branch in
      // board-widget.component.html has been commented out since
      // 2026-03-04.
      this.sql = undefined;
      this.changeDetectorRef.markForCheck();
    }
  }
}

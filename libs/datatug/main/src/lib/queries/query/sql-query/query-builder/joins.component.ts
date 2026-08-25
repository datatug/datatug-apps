import { JsonPipe } from '@angular/common';
import {
  Component,
  EventEmitter,
  Output,
  inject,
  input,
  model,
} from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCheckbox,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonText,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { ISqlChanged } from '../intefaces';
import {
  ICanJoin,
  QueryContextSqlService,
} from '../../../query-context-sql.service';
import {
  IAstJoin,
  IAstQuery,
  SqlParser,
} from '../../../../services/unsorted/sql-parser';

@Component({
  selector: 'sneat-datatug-qe-joins',
  templateUrl: 'joins.component.html',
  imports: [
    IonCheckbox,
    IonCard,
    IonList,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonBadge,
    IonButtons,
    IonButton,
    IonIcon,
    IonText,
    JsonPipe,
  ],
})
export class JoinsComponent {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  readonly queryContextSqlService = inject(QueryContextSqlService);

  public readonly sql = model<string>();
  public readonly queryAst = model<IAstQuery>();
  public readonly sqlParser = input<SqlParser>();
  @Output() public astChanged = new EventEmitter<ISqlChanged>();

  public suggestedJoins?: ICanJoin[];

  constructor() {
    const queryContextSqlService = this.queryContextSqlService;

    queryContextSqlService.suggestedJoins.subscribe({
      next: (suggestedJoins) => {
        this.suggestedJoins = suggestedJoins;
      },
      error: this.errorLogger.logErrorHandler('failed to get suggested join'),
    });
  }

  public joinCheckChanged(event: Event, join: IAstJoin): void {
    // console.log('joinCheckChanged', event, join);
    const ce = event as CustomEvent;
    const checked = !!ce.detail.checked;
    const sqlParser = this.sqlParser();
    const sql = this.sql();
    if (sql) {
      if (checked) {
        this.sql.set(sqlParser?.uncommentJoin(sql, join));
      } else {
        this.sql.set(sqlParser?.commentOutJoin(sql, join));
      }
    }
    this.queryAst.set(sql ? sqlParser?.parseQuery(sql) : undefined);
    this.astChanged.emit({ sql: sql || '', ast: this.queryAst() || {} });
  }

  public addJoin(join: ICanJoin, type: 'left' | 'right' | 'inner'): void {
    alert(`Not implemented yet ${join} ${type}`);
  }
}

import { JsonPipe } from '@angular/common';
import {
  Component,
  EventEmitter,
  Output,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

  public readonly suggestedJoins = signal<ICanJoin[] | undefined>(undefined);

  constructor() {
    const queryContextSqlService = this.queryContextSqlService;

    queryContextSqlService.suggestedJoins.pipe(takeUntilDestroyed()).subscribe({
      next: (suggestedJoins) => {
        this.suggestedJoins.set(suggestedJoins);
      },
      error: this.errorLogger.logErrorHandler('failed to get suggested join'),
    });
  }

  public joinCheckChanged(event: Event, join: IAstJoin): void {
    // console.log('joinCheckChanged', event, join);
    const ce = event as CustomEvent;
    const checked = !!ce.detail.checked;
    const sqlParser = this.sqlParser();
    let sql = this.sql();
    if (sql && sqlParser) {
      sql = checked
        ? sqlParser.uncommentJoin(sql, join)
        : sqlParser.commentOutJoin(sql, join);
      this.sql.set(sql);
    }
    // Parse and emit the toggled SQL, not the text from before the change.
    this.queryAst.set(sql ? sqlParser?.parseQuery(sql) : undefined);
    this.astChanged.emit({ sql: sql || '', ast: this.queryAst() || {} });
  }

  public addJoin(join: ICanJoin, type: 'left' | 'right' | 'inner'): void {
    alert(`Not implemented yet ${join} ${type}`);
  }
}

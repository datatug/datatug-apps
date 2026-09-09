import {
  Component,
  OnChanges,
  SimpleChanges,
  inject,
  input
} from '@angular/core';
import {
  IonBadge,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonInput,
  IonItem,
  IonLabel,
  IonText,
} from '@ionic/angular';
import { ErrorLogger, IErrorLogger } from '@sneat/core';
import { IGridDef } from '@sneat/grid';
import {
  IForeignKey,
  ITableFull,
  ITableRef,
} from '../../../../models/definition/apis/database';
import {
  DatatugNavService,
  IDbObjectNavParams,
} from '../../../../services/nav/datatug-nav.service';
import { ProjectService } from '../../../../services/project/project.service';
import { AgentService } from '../../../../services/repo/agent.service';

@Component({
  selector: 'sneat-datatug-fk-card',
  templateUrl: './foreign-key-card.component.html',
  styleUrls: ['./foreign-key-card.component.scss'],
  imports: [
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonText,
    IonItem,
    IonLabel,
    IonInput,
    IonBadge,
  ],
})
export class ForeignKeyCardComponent implements OnChanges {
  private readonly errorLogger = inject<IErrorLogger>(ErrorLogger);
  private readonly projectService = inject(ProjectService);
  private readonly datatugNavService = inject(DatatugNavService);
  private readonly agentService = inject(AgentService);

  readonly fk = input<IForeignKey>();
  readonly row = input<Record<string, unknown>>();
  readonly tableNavParams = input<IDbObjectNavParams>();
  public grid?: IGridDef;
  public table?: {
    meta: ITableFull;
    row: Record<string, unknown>;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public goTable(event: Event, tableRef?: ITableRef): void {
    event.preventDefault();
    event.stopPropagation();
    throw new Error('not implemented yet');
    // this.datatugNavService.goTable({
    // 	...this.tableNavParams,
    // 	schema: this.fk.refTable.schema,
    // 	name: this.fk.refTable.name,
    // });
  }

  protected colValue(colName: string): string {
    return '' + this.table?.row[colName];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tableNavParams'] || changes['row'] || changes['fk']) {
      const fk = this.fk();
      const tableNavParams = this.tableNavParams();
      const row = this.row();
      if (fk && tableNavParams && row) {
        // console.log('tableNavParams', this.tableNavParams);
        if (!this.table?.meta) {
          this.projectService
            .getFull(tableNavParams.project.ref)
            .subscribe({
              next: () => {
                // console.log('ForeignKeyCardComponent => project:', project);
                // const env = project.environments.find(v => v.id === this.tableNavParams.env);
                // const db = env.dbServer.find(v => v.id === this.tableNavParams.db);
                // const table = db.tables.find(v =>
                //      v.name === this.fk.refTable.name && v.schema === this.fk.refTable.schema);
                // this.table = {
                // 	meta: table,
                // 	row: {[table.primaryKey.columns[0]]: this.row[this.fk.columns[0]]},
                // };
                this.loadData();
              },
              error: (err) =>
                this.errorLogger.logError(err, 'Failed to get project'),
            });
        } else if (
          !this.table.meta.primaryKey ||
          row[fk.columns[0]] !==
            this.table.row[this.table.meta.primaryKey.columns[0]]
        ) {
          this.loadData();
        }
      }
    }
  }

  public fkTitle(): string | undefined {
    return (
      this.row() &&
      this.fk()?.columns?.map((c) => {
      const row = this.row();
      return `${c}=${row && row[c]}`;
    }).join(', ')
    );
  }

  private loadData(): void {
    const fk = this.fk();
    const tableNavParams = this.tableNavParams();
    const rowValue = this.row();
    if (
      !this.table?.meta ||
      !tableNavParams?.db ||
      !tableNavParams.env ||
      !rowValue ||
      !fk?.columns?.length
    ) {
      return;
    }
    const { schema, name } = this.table.meta;
    this.agentService
      .select(tableNavParams.project.ref.storeId, {
        proj: tableNavParams.project.ref.projectId,
        db: tableNavParams?.db,
        env: tableNavParams?.env,
        from: `${schema}.${name}`,
        where: `${this.table.meta.primaryKey?.columns[0]}:${
          (rowValue as Record<string, unknown>)[fk.columns[0]]
        }`,
      })
      .subscribe({
        next: (response) => {
          // `/exec/select`'s response rows already arrive column-name-keyed
          // (ISelectResponse — see its own doc comment); no `commands[]`
          // envelope or positional zip to unwrap, unlike the old
          // (never-actually-reachable, since `this.table?.meta` gates this
          // whole method and nothing populates it yet) code assumed.
          const row = response.rows[0];
          if (this.table && row) {
            this.table = {
              ...this.table,
              row,
            };
          }
        },
        error: (err) => this.errorLogger.logError(err, 'Failed to get values'),
      });
  }
}

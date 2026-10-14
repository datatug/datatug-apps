import { Injectable, inject } from '@angular/core';
import { PublicSqliteQueryService } from '../queries/public-sqlite-query.service';
import { IProjectRef } from '../core/project-context';
import { IQueryDef } from '../models/definition/query-def';
import { SessionScope } from './session-context-contract';
import type { TypedValue } from '@sneat/datatug-semantic';

export interface SessionQueryRows { readonly rows: Record<string, unknown>[]; readonly columns: { field: string }[]; }
/** Source-specific adapter: exact existing Chinook admission, ordinary scalar query inputs. */
@Injectable()
export class SessionChinookQueryService {
  private readonly sqlite = inject(PublicSqliteQueryService);

  async execute(project: IProjectRef, _scope: SessionScope, definition: IQueryDef, value?: TypedValue): Promise<SessionQueryRows> {
    if (value && (value.type !== 'integer' || !Number.isSafeInteger(Number(value.value)))) throw new Error('The query input cannot be represented losslessly.');
    // Session context may be stored by a local agent, but this dashboard's
    // source is the independently admitted public Chinook fixture. The local
    // `/exec/select` SQL path has no bind-parameter API and requires a generic
    // opaque-SQL grant, so it must never receive this parameterized SQL.
    const result = value
      ? await this.sqlite.runParameterized(project, definition, { InvoiceId: value })
      : await this.sqlite.run(project, definition);
    const names = result.recordset.columns.map((column) => column.name);
    return { rows: result.recordset.rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index].value]))), columns: names.map((field) => ({ field })) };
  }
}

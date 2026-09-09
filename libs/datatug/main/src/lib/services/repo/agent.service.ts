import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { IExecuteRequest } from '../../dto/request';
import {
  IExecuteResponse,
  ISelectRequest,
  ISelectResponse,
} from '../../dto/execute';
import { ISqlCommandRequest } from '../../dto/requests';
import { Observable, map, throwError } from 'rxjs';
import { buildAgentUrl } from './agent-url';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

@Injectable()
export class AgentService {
  private readonly http = inject(HttpClient);

  public select(
    agentId: string,
    request: ISelectRequest,
  ): Observable<ISelectResponse> {
    if (!request.proj) {
      return throwError(() => 'Client side check failed: !request.proj');
    } else if (request.proj.includes('@')) {
      return throwError(
        () =>
          'Client side check failed: "@" character in project ID, store is supposed to be passed independently',
      );
    }
    let params = new HttpParams()
      .append('db', request.db)
      .append('env', request.env)
      .append('proj', request.proj);
    if (request.from) {
      params = params.append('from', request.from);
    } else if (request.sql) {
      params = params.append('sql', request.sql);
    }
    if (request.where) {
      params = params.append('where', request.where);
    }
    if (request.limit) {
      params = params.append('limit', '' + request.limit);
    }
    if (request.namedParams) {
      Object.entries(request.namedParams).forEach(([id, p]) => {
        params = params.append(`p:${id}:${p.type}`, '' + p.value);
      });
    }
    return this.http.get<ISelectResponse>(
      buildAgentUrl(agentId, '/exec/select'),
      { params },
    );
  }

  public execute(
    agentId: string,
    request: IExecuteRequest,
  ): Observable<IExecuteResponse> {
    if (!request.projectId) {
      return throwError(() => 'request.projectId is required parameter');
    }
    if (request.commands?.length === 1 && !!request.commands[0].namedParams) {
      const cmd = request.commands[0] as ISqlCommandRequest;
      // `select()` now returns `/exec/select`'s real, flat
      // `{columns, rows}` shape (see ISelectResponse's own doc comment) —
      // adapted here into the `commands[]` envelope this method's own
      // callers (Coordinator, sql-query-editor.component.ts) still expect,
      // so this delegation keeps compiling against the same contract it
      // always claimed. `dbType` isn't part of the real `/exec/select`
      // response (only column names), so it's a placeholder here — display
      // -only (grid alignment), never data-affecting. This specific
      // delegation branch (single command with namedParams) was not
      // otherwise touched or newly verified against a live agent by lane
      // S89 — only EnvDbTablePageComponent's own `select()` call was.
      return this.select(agentId, {
        db: cmd.db,
        env: cmd.env,
        sql: cmd.text,
        proj: request.projectId,
        namedParams: cmd.namedParams,
      }).pipe(
        map((selectResponse) => ({
          duration: 0,
          commands: [
            {
              commandId: cmd.id || '',
              items: [
                {
                  type: 'recordset' as const,
                  value: {
                    columns: selectResponse.columns.map((name) => ({
                      name,
                      dbType: 'string',
                    })),
                    rows: selectResponse.rows.map((row) =>
                      selectResponse.columns.map((name) => row[name]),
                    ),
                  },
                },
              ],
            },
          ],
        })),
      );
    }
    if (!request.projectId) {
      return throwError(() => 'Client side check failed: !request.proj');
    } else if (request.projectId.includes('@')) {
      return throwError(
        () =>
          'Client side check failed: "@" character in project ID, store is supposed to be passed independently',
      );
    }
    const params = new HttpParams().append('project', request.projectId);
    const body: Writeable<IExecuteRequest> = { ...request };
    delete body.projectId;
    return this.http.post<IExecuteResponse>(
      buildAgentUrl(agentId, '/exec/execute_commands'),
      body,
      { params },
    );
  }
}

import { Injectable, inject } from '@angular/core';
import { firstValueFrom, throwError, timeout } from 'rxjs';
import type { TypedValue } from '@sneat/datatug-semantic';
import type {
  IQueryDef,
  ITextQueryRequest,
} from '../models/definition/query-def';
import { QueryType } from '../models/definition/query-def';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import type { IProjectRef } from '../core/project-context';
import type { FederatedQueryResult } from './federated-query-executor';

const CONNECTION_ID = 'chinook-sqlite';
const FIXTURE_URL = 'https://chinook.demodb.dev/data/chinook.sqlite';
const FIXTURE_SHA256 =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const FIXTURE_BYTES = 1007616;
const RUN_TIMEOUT_MS = 10000;

interface ConnectionCatalog {
  readonly format?: string;
  readonly connections?: readonly {
    readonly id?: string;
    readonly dataset?: string;
    readonly storage?: string;
    readonly readiness?: string;
    readonly source?: string;
    readonly fixtureSha256?: string;
    readonly browserFixture?: {
      readonly url?: string;
      readonly bytes?: number;
    };
  }[];
}

/** The saved ID resolves in the project, while this browser build admits only one pinned public fixture. */
export function admitPublicSqliteSource(
  catalog: ConnectionCatalog | null | undefined,
  connectionId: string,
): void {
  const matches =
    catalog?.connections?.filter((item) => item.id === connectionId) ?? [];
  const entry = matches[0];
  if (
    catalog?.format !== 'datatug-demo-connections/v1' ||
    connectionId !== CONNECTION_ID ||
    matches.length !== 1 ||
    entry.dataset !== 'chinook' ||
    entry.storage !== 'sqlite' ||
    entry.readiness !== 'public-api' ||
    entry.source !== 'https://demodb.dev/ovdb/v1/databases/chinook' ||
    entry.fixtureSha256 !== FIXTURE_SHA256 ||
    entry.browserFixture?.url !== FIXTURE_URL ||
    entry.browserFixture.bytes !== FIXTURE_BYTES
  ) {
    throw new Error('This query has no admitted public browser SQLite source.');
  }
}

interface WorkerResult {
  readonly ok: boolean;
  readonly result?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly (string | number | null)[])[];
  };
  readonly error?: string;
}

function typed(cell: string | number | null): TypedValue {
  if (cell === null) return { type: 'null', value: null };
  if (typeof cell === 'string') return { type: 'string', value: cell };
  if (!Number.isFinite(cell))
    throw new Error('The browser query returned a non-finite number.');
  if (Number.isSafeInteger(cell))
    return { type: 'integer', value: String(cell) };
  return { type: 'number', value: cell };
}

@Injectable({ providedIn: 'root' })
export class PublicSqliteQueryService {
  private readonly reader = inject(GithubProjectReaderService);
  private readonly projectApi = inject(ProjectQueryApiService);

  async run(
    project: IProjectRef,
    definition: IQueryDef,
  ): Promise<FederatedQueryResult> {
    if (
      definition.request.queryType !== QueryType.SQL ||
      !definition.connectionId ||
      definition.federation ||
      definition.parameters?.length
    ) {
      throw new Error(
        'This query has no admitted public browser SQLite source.',
      );
    }
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const catalog = await firstValueFrom(
      (project.projectApi === 'cloud'
        ? this.projectApi.connectionCatalog<ConnectionCatalog>(project)
        : this.reader.getRawJson<ConnectionCatalog>(
            project.projectId,
            'connections/demo-db.json',
          )
      ).pipe(
        timeout({
          first: RUN_TIMEOUT_MS,
          with: () =>
            throwError(
              () =>
                new Error(
                  'The public SQLite source check exceeded 10 seconds.',
                ),
            ),
        }),
      ),
    );
    admitPublicSqliteSource(catalog, definition.connectionId);
    if (typeof Worker === 'undefined')
      throw new Error('This browser does not support SQLite query workers.');
    const sql = (definition.request as ITextQueryRequest).text;
    const worker = new Worker(
      new URL('./public-sqlite-query.worker.ts', import.meta.url),
      { type: 'module' },
    );
    try {
      const reply = await new Promise<WorkerResult>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error('The browser SQLite query exceeded 10 seconds.')),
          Math.max(1, deadline - Date.now()),
        );
        worker.onmessage = (event: MessageEvent<WorkerResult>) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('The browser SQLite worker failed.'));
        };
        worker.postMessage({ sql });
      });
      if (!reply.ok || !reply.result)
        throw new Error(reply.error ?? 'The browser SQLite query failed.');
      return {
        recordset: {
          columns: reply.result.columns.map((name) => ({
            name,
            type: 'unknown',
          })),
          rows: reply.result.rows.map((row) => row.map(typed)),
        },
        limitations: [],
        bindingsApplied: [],
        truncated: false,
        provenance: {
          source: 'Pinned public Chinook SQLite fixture',
          queryId: definition.id,
          mode: 'snapshot',
          observedAt: new Date().toISOString(),
          executionProfile: 'protected',
        },
      };
    } finally {
      worker.terminate();
    }
  }
}

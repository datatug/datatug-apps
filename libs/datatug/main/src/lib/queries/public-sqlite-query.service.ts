import { Injectable, inject } from '@angular/core';
import { parseTugQL, resolveTugQL } from '@dalgo/core';
import {
  Observable,
  firstValueFrom,
  fromEvent,
  takeUntil,
  throwError,
  throwIfEmpty,
  timeout,
} from 'rxjs';
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
import {
  compilePublicSqliteTugQL,
  requireCustomerIdParameterSource,
  requireLiteralHavingThreshold,
  type PublicSqlitePreparedPlan,
} from './public-sqlite-tugql';

const CONNECTION_ID = 'chinook-sqlite';
const FIXTURE_URL = 'https://chinook.demodb.dev/data/chinook.sqlite';
const FIXTURE_SHA256 =
  '7651ba378ac2fcd0dfc3c66fb101f7a7eed3ba39a612ec642b96e20702061f15';
const FIXTURE_BYTES = 1007616;
const RUN_TIMEOUT_MS = 10000;

function abortError(): Error {
  const error = new Error('The browser SQLite query was cancelled.');
  error.name = 'AbortError';
  return error;
}

function firstValueFromAbortable<T>(
  source: Observable<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return firstValueFrom(source);
  if (signal.aborted) return Promise.reject(abortError());
  return firstValueFrom(
    source.pipe(
      takeUntil(fromEvent(signal, 'abort')),
      throwIfEmpty(abortError),
    ),
  );
}

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
  readonly receipt?: {
    readonly executionId: string;
    readonly sql: string;
    readonly bindings: readonly (string | number | null)[];
    readonly bindingNames: readonly string[];
    readonly fixtureSha256: string;
    readonly schemaVersion: string;
    readonly draftRevision: number;
    readonly schemaFingerprint: string;
  };
}

interface InvoiceColumnsFile {
  readonly columns?: readonly {
    readonly name?: string;
    readonly dbType?: string;
    readonly isNullable?: boolean;
  }[];
}

const fixtureCatalogVersion = FIXTURE_SHA256;

function tugqlType(dbType: string): string {
  const normalized = dbType.trim().toUpperCase();
  if (
    /^(?:TINYINT|SMALLINT|MEDIUMINT|INTEGER|INT|BIGINT)(?:\b|\()/u.test(
      normalized,
    )
  )
    return 'integer';
  if (/^(?:CHAR|VARCHAR|NCHAR|NVARCHAR|TEXT|CLOB)(?:\b|\()/u.test(normalized))
    return 'string';
  if (/^(?:NUMERIC|DECIMAL)(?:\b|\()/u.test(normalized)) return 'decimal';
  if (/^DATE\b/u.test(normalized)) return 'date';
  if (/^(?:DATETIME|TIMESTAMP)\b/u.test(normalized)) return 'datetime';
  if (/^(?:REAL|FLOAT|DOUBLE)\b/u.test(normalized)) return 'number';
  return 'unknown';
}

function diagnosticsMessage(
  diagnostics: readonly { readonly message: string }[],
): string {
  return diagnostics.map((item) => item.message).join(' ');
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

  /** Compile only after re-reading both admitted-source and typed schema metadata. */
  async prepareTugQL(
    project: IProjectRef,
    definition: IQueryDef,
    draftRevision: number,
    customerIdText: string,
    signal?: AbortSignal,
  ): Promise<PublicSqlitePreparedPlan> {
    if (
      definition.request.queryType !== QueryType.DTQL ||
      definition.connectionId !== CONNECTION_ID ||
      definition.federation ||
      !/^-?\d+$/u.test(customerIdText) ||
      !Number.isSafeInteger(Number(customerIdText))
    ) {
      throw new Error(
        'Enter a whole-number CustomerId for the Chinook Invoice source.',
      );
    }
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const [catalog, metadata] = await Promise.all([
      firstValueFromAbortable(
        (project.projectApi === 'cloud'
          ? this.projectApi.connectionCatalog<ConnectionCatalog>(project)
          : this.reader.getRawJson<ConnectionCatalog>(
              project.projectId,
              'connections/demo-db.json',
            )
        ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
        signal,
      ),
      firstValueFromAbortable(
        this.reader
          .getRawJson<InvoiceColumnsFile>(
            project.projectId,
            'dbmodels/chinook/main/tables/Invoice/main.Invoice.columns.json',
          )
          .pipe(timeout({ first: RUN_TIMEOUT_MS })),
        signal,
      ),
    ]);
    if (Date.now() > deadline)
      throw new Error('The public SQLite schema check exceeded 10 seconds.');
    admitPublicSqliteSource(catalog, definition.connectionId);
    const columns = metadata?.columns;
    if (!columns?.length)
      throw new Error('The admitted Chinook Invoice schema is unavailable.');
    const requiredFields = ['CustomerId', 'InvoiceId', 'InvoiceDate'];
    const available = new Map(
      columns.map((column) => [column.name, column] as const),
    );
    const expectedTypes: Readonly<Record<string, string>> = {
      CustomerId: 'INTEGER',
      InvoiceId: 'INTEGER',
      InvoiceDate: 'DATETIME',
    };
    for (const name of requiredFields) {
      if (
        columns.filter((column) => column.name === name).length !== 1 ||
        available.get(name)?.dbType?.trim().toUpperCase() !==
          expectedTypes[name]
      )
        throw new Error(
          `The admitted Chinook Invoice schema is missing ${name}.`,
        );
    }
    const schemaVersion = `${fixtureCatalogVersion}:${JSON.stringify(
      columns
        .filter((column) => column.name && requiredFields.includes(column.name))
        .map((column) => ({
          name: column.name,
          dbType: column.dbType,
          isNullable: column.isNullable,
        })),
    )}`;
    const request = definition.request as ITextQueryRequest;
    const parsed = parseTugQL(request.text);
    if (parsed.diagnostics.length)
      throw new Error(diagnosticsMessage(parsed.diagnostics));
    const tree = parsed.document.tree;
    if (!tree) throw new Error('The TugQL draft is incomplete.');
    if (tree.definitions?.length)
      throw new Error(
        'WITH and saved-query imports are not supported by this SQLite preview.',
      );
    const parameters = tree.parameters ?? [];
    if (
      parameters.length !== 1 ||
      parameters[0]?.name !== 'CustomerId' ||
      parameters[0]?.type.toLowerCase() !== 'integer' ||
      parameters[0]?.required !== true
    ) {
      throw new Error('Declare one required integer parameter: @CustomerId.');
    }
    requireCustomerIdParameterSource(tree);
    requireLiteralHavingThreshold(tree);
    const value = Number(customerIdText);
    const authorization = resolveTugQL(parsed.document, {
      authorizedSchemas: [
        {
          version: schemaVersion,
          tables: [
            {
              name: 'Invoice',
              fields: requiredFields.map((name) => ({
                name,
                type: tugqlType(expectedTypes[name]),
                authorized: true,
              })),
            },
          ],
        },
      ],
      relationships: [],
      pinnedImports: [],
      bindings: [{ name: 'CustomerId', set: true, value }],
    });
    if (authorization.diagnostics.length || !authorization.resolved)
      throw new Error(
        diagnosticsMessage(authorization.diagnostics) ||
          'The TugQL draft could not be resolved against the admitted Invoice schema.',
      );
    return compilePublicSqliteTugQL(authorization.resolved, {
      fixtureSha256: FIXTURE_SHA256,
      schemaVersion,
      draftRevision,
    });
  }

  async runTugQL(
    project: IProjectRef,
    definition: IQueryDef,
    draftRevision: number,
    customerIdText: string,
    previewPlan: PublicSqlitePreparedPlan,
    signal?: AbortSignal,
  ): Promise<FederatedQueryResult> {
    const plan = await this.prepareTugQL(
      project,
      definition,
      draftRevision,
      customerIdText,
      signal,
    );
    if (JSON.stringify(plan) !== JSON.stringify(previewPlan))
      throw new Error(
        'The saved draft or its bindings changed. Preview SQL again before Run.',
      );
    const result = await this.executePlan(project, definition, plan, signal);
    return result;
  }

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

  private async executePlan(
    project: IProjectRef,
    definition: IQueryDef,
    plan: PublicSqlitePreparedPlan,
    signal?: AbortSignal,
  ): Promise<FederatedQueryResult> {
    if (
      definition.connectionId !== plan.sourceId ||
      plan.fixtureSha256 !== FIXTURE_SHA256 ||
      !Object.isFrozen(plan) ||
      !Object.isFrozen(plan.bindings)
    ) {
      throw new Error(
        'The prepared query plan is stale or invalid. Preview again.',
      );
    }
    const catalog = await firstValueFromAbortable(
      (project.projectApi === 'cloud'
        ? this.projectApi.connectionCatalog<ConnectionCatalog>(project)
        : this.reader.getRawJson<ConnectionCatalog>(
            project.projectId,
            'connections/demo-db.json',
          )
      ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
      signal,
    );
    admitPublicSqliteSource(catalog, plan.sourceId);
    if (typeof Worker === 'undefined')
      throw new Error('This browser does not support SQLite query workers.');
    const worker = new Worker(
      new URL('./public-sqlite-query.worker.ts', import.meta.url),
      { type: 'module' },
    );
    try {
      const reply = await new Promise<WorkerResult>((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = (): void => {
          cleanup();
          reject(abortError());
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('The browser SQLite query exceeded 10 seconds.'));
        }, RUN_TIMEOUT_MS);
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.onmessage = (event: MessageEvent<WorkerResult>) => {
          cleanup();
          resolve(event.data);
        };
        worker.onerror = () => {
          cleanup();
          reject(new Error('The browser SQLite worker failed.'));
        };
        worker.postMessage({
          sql: plan.sql,
          bindings: plan.bindings,
          bindingNames: plan.bindingNames,
          fixtureSha256: plan.fixtureSha256,
          schemaVersion: plan.schemaVersion,
          draftRevision: plan.draftRevision,
          authorProfile: true,
        });
      });
      if (!reply.ok || !reply.result)
        throw new Error(reply.error ?? 'The browser SQLite query failed.');
      const receipt = reply.receipt;
      if (
        !receipt?.executionId ||
        receipt.sql !== plan.sql ||
        JSON.stringify(receipt.bindings) !== JSON.stringify(plan.bindings) ||
        JSON.stringify(receipt.bindingNames) !==
          JSON.stringify(plan.bindingNames) ||
        receipt.fixtureSha256 !== plan.fixtureSha256 ||
        receipt.schemaVersion !== plan.schemaVersion ||
        receipt.draftRevision !== plan.draftRevision ||
        receipt.schemaFingerprint !==
          'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME'
      )
        throw new Error(
          'The SQLite worker receipt did not match the prepared request.',
        );
      const executionReceipt = Object.freeze({
        sql: receipt.sql,
        bindingNames: Object.freeze([...receipt.bindingNames]),
        sourceId: plan.sourceId,
        fixtureSha256: receipt.fixtureSha256,
        schemaVersion: receipt.schemaVersion,
        draftRevision: receipt.draftRevision,
        executionId: receipt.executionId,
      });
      return {
        recordset: {
          columns: reply.result.columns.map((name) => ({
            name,
            type: 'unknown',
          })),
          rows: reply.result.rows.map((row) => row.map(typed)),
        },
        limitations: [],
        bindingsApplied: [
          {
            parameterId: 'CustomerId',
            value: { type: 'integer', value: String(plan.bindings[0]) },
            origin: 'manual',
            originEvidence: 'client-reported',
          },
        ],
        truncated: false,
        publicSqliteReceipt: executionReceipt,
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

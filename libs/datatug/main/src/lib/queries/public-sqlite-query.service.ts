import { Injectable, inject } from '@angular/core';
import { parseTugQL, resolveTugQL } from '@dalgo/core';
import type { TugQLDocument } from '@dalgo/core';
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
  PUBLIC_CHINOOK_CUSTOMER_FK,
  type PublicSqliteRelationshipReceipt,
  type PublicSqlitePreparedPlan,
  type PublicSqliteQueryPreview,
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
    readonly relationship?: PublicSqliteRelationshipReceipt;
    readonly outputColumns?: readonly {
      readonly name: string;
      readonly type: 'integer' | 'string';
      readonly lineage: readonly {
        readonly source: string;
        readonly field: string;
      }[];
    }[];
  };
}

interface TableColumnsFile {
  readonly columns?: readonly {
    readonly name?: string;
    readonly dbType?: string;
    readonly isNullable?: boolean;
    readonly pkPosition?: number;
  }[];
}

interface ForeignKeysFile {
  readonly version?: number;
  readonly foreignKeys?: readonly {
    readonly name?: string;
    readonly table?: { readonly schema?: string; readonly name?: string };
    readonly columns?: readonly string[];
    readonly refTable?: { readonly schema?: string; readonly name?: string };
    readonly refColumns?: readonly string[];
  }[];
}

const CUSTOMER_INVOICE_FK = Object.freeze({
  name: PUBLIC_CHINOOK_CUSTOMER_FK,
  table: { schema: 'main', name: 'Invoice' },
  columns: ['CustomerId'],
  refTable: { schema: 'main', name: 'Customer' },
  refColumns: ['CustomerId'],
});
const CUSTOMER_INVOICE_FK_VERSION = `${FIXTURE_SHA256}:main.Invoice.CustomerId:INTEGER->main.Customer.CustomerId:INTEGER:PRIMARY_KEY:v1`;

function expandedJoinSource(
  source: string,
  join: Readonly<Record<string, unknown>>,
  fromAlias: string,
  toAlias: string,
): string | undefined {
  const on = join['on'];
  const onItems = Array.isArray(on) ? on : [];
  if (onItems.length === 1) {
    const item = onItems[0] as Readonly<Record<string, unknown>>;
    if (item['op'] !== 'relationship') return undefined;
    const lines = source.match(/[^\n]*(?:\n|$)/gu) ?? [];
    let matchIndex = -1;
    for (let index = 0; index < lines.length; index++) {
      if (
        /^\s*on\s+CustomerId\s*(?:--[^\n]*)?(?:\r?\n)?$/iu.test(
          lines[index] ?? '',
        )
      ) {
        if (matchIndex !== -1)
          throw new Error(
            'The relationship shorthand is ambiguous in this source.',
          );
        matchIndex = index;
      }
    }
    if (matchIndex < 0)
      throw new Error(
        'The relationship shorthand cannot be safely expanded in this source.',
      );
    const original = lines[matchIndex] ?? '';
    const body = original.replace(
      /^(\s*on\s+)CustomerId(\s*(?:--[^\n]*?)?)(\r?\n)?$/iu,
      `$1${fromAlias}.CustomerId = ${toAlias}.CustomerId$2$3`,
    );
    lines[matchIndex] = body;
    return lines.join('');
  }
  if (onItems.length) return undefined;

  const lines = source.match(/[^\n]*(?:\n|$)/gu) ?? [];
  const joinName = String(
    (join['from'] as Record<string, unknown> | undefined)?.['name'] ?? '',
  );
  const clause = new RegExp(
    `^(\\s*join\\s+${joinName}(?:\\s+as\\s+[A-Za-z_][A-Za-z0-9_]*)?)(\\s*(?:--[^\\n]*)?)(\\r?\\n)?$`,
    'iu',
  );
  let matchIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    if (clause.test(lines[index] ?? '')) {
      if (matchIndex !== -1)
        throw new Error('The joined table is ambiguous in this source.');
      matchIndex = index;
    }
  }
  if (matchIndex < 0)
    throw new Error(
      'The relationship join cannot be safely expanded in this source.',
    );
  const original = lines[matchIndex] ?? '';
  const eol = original.endsWith('\r\n')
    ? '\r\n'
    : original.endsWith('\n')
      ? '\n'
      : '';
  if (!eol)
    throw new Error(
      'Put the relationship JOIN on its own line before previewing.',
    );
  const upper =
    /\bFROM\b/u.test(source) && /\bFROM\b/u.exec(source)?.[0] === 'FROM';
  const tabs = /^\t/mu.test(source);
  const indentation = tabs ? '\t' : '  ';
  lines.splice(
    matchIndex + 1,
    0,
    `${indentation}${upper ? 'ON' : 'on'} ${fromAlias}.CustomerId = ${toAlias}.CustomerId${eol}`,
  );
  return lines.join('');
}

const fixtureCatalogVersion = FIXTURE_SHA256;
const JOINED_SCHEMA_FINGERPRINT =
  'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME|CustomerId:INTEGER:PK|FirstName:STRING|LastName:STRING|Email:STRING|FK_Invoice_Customer_CustomerId:Invoice.CustomerId->Customer.CustomerId';

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
    signal?: AbortSignal,
  ): Promise<PublicSqliteQueryPreview> {
    if (
      definition.request.queryType !== QueryType.DTQL ||
      definition.connectionId !== CONNECTION_ID ||
      definition.federation
    ) {
      throw new Error(
        'This preview supports the admitted Chinook Invoice TugQL source only.',
      );
    }
    const deadline = Date.now() + RUN_TIMEOUT_MS;
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
    const rawFrom = tree.query.from as Readonly<Record<string, unknown>>;
    const rawJoins = Array.isArray(rawFrom['joins'])
      ? (rawFrom['joins'] as readonly Readonly<Record<string, unknown>>[])
      : [];
    const joined = rawJoins.length > 0;
    const savedBindings = definition.relationshipBindings ?? [];
    if (joined && savedBindings.length !== 1)
      throw new Error(
        'Save this joined query with its declared relationship binding before previewing.',
      );
    if (!joined && savedBindings.length)
      throw new Error(
        'The saved relationship binding does not match this single-table query.',
      );
    if (
      joined &&
      (rawJoins.length !== 1 ||
        rawJoins[0]?.['type']?.toString().toLowerCase() === 'left')
    )
      throw new Error(
        'This preview supports one INNER Invoice-to-Customer relationship only.',
      );
    const [catalog, metadata, customerMetadata, refs] = await Promise.all([
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
          .getRawJson<TableColumnsFile>(
            project.projectId,
            'dbmodels/chinook/main/tables/Invoice/main.Invoice.columns.json',
          )
          .pipe(timeout({ first: RUN_TIMEOUT_MS })),
        signal,
      ),
      joined
        ? firstValueFromAbortable(
            this.reader
              .getRawJson<TableColumnsFile>(
                project.projectId,
                'dbmodels/chinook/main/tables/Customer/main.Customer.columns.json',
              )
              .pipe(timeout({ first: RUN_TIMEOUT_MS })),
            signal,
          )
        : Promise.resolve(undefined),
      joined
        ? firstValueFromAbortable(
            this.reader
              .getRawJson<ForeignKeysFile>(
                project.projectId,
                'dbmodels/chinook/chinook.refs.json',
              )
              .pipe(timeout({ first: RUN_TIMEOUT_MS })),
            signal,
          )
        : Promise.resolve(undefined),
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
    const invoiceSchema = columns
      .filter((column) => column.name && requiredFields.includes(column.name))
      .map((column) => ({
        name: column.name,
        dbType: column.dbType,
        isNullable: column.isNullable,
      }));
    let customerFields: readonly { name: string; type: string }[] = [];
    let relationship: PublicSqliteRelationshipReceipt | undefined;
    let schemaVersion = `${fixtureCatalogVersion}:${JSON.stringify(
      columns
        .filter((column) => column.name && requiredFields.includes(column.name))
        .map((column) => ({
          name: column.name,
          dbType: column.dbType,
          isNullable: column.isNullable,
        })),
    )}`;
    if (joined) {
      const customerColumns = customerMetadata?.columns;
      if (!customerColumns?.length)
        throw new Error('The admitted Chinook Customer schema is unavailable.');
      const requiredCustomer = ['CustomerId', 'FirstName', 'LastName', 'Email'];
      const byName = new Map(
        customerColumns.map((column) => [column.name, column] as const),
      );
      for (const name of requiredCustomer) {
        if (
          customerColumns.filter((column) => column.name === name).length !== 1
        )
          throw new Error(
            `The admitted Chinook Customer schema is missing ${name}.`,
          );
        const column = byName.get(name);
        if (name === 'CustomerId') {
          if (
            column?.dbType?.trim().toUpperCase() !== 'INTEGER' ||
            column.pkPosition !== 1 ||
            column.isNullable !== false
          )
            throw new Error(
              'Customer.CustomerId must be the non-null INTEGER primary key.',
            );
        } else if (
          !column?.dbType ||
          !/^(?:N?VARCHAR|N?CHAR|TEXT|CLOB)(?:\b|\()/iu.test(
            column.dbType.trim(),
          )
        ) {
          throw new Error(
            `The admitted Chinook Customer ${name} field must be a string.`,
          );
        }
      }
      const candidates =
        refs?.foreignKeys?.filter(
          (item) =>
            (item.table?.name === 'Invoice' &&
              item.refTable?.name === 'Customer') ||
            (item.table?.name === 'Customer' &&
              item.refTable?.name === 'Invoice'),
        ) ?? [];
      const namedRelationships =
        refs?.foreignKeys?.filter(
          (item) => item.name === CUSTOMER_INVOICE_FK.name,
        ) ?? [];
      const exact = candidates.filter(
        (item) =>
          item.name === CUSTOMER_INVOICE_FK.name &&
          item.table?.schema === 'main' &&
          item.table.name === 'Invoice' &&
          JSON.stringify(item.columns) ===
            JSON.stringify(CUSTOMER_INVOICE_FK.columns) &&
          item.refTable?.schema === 'main' &&
          item.refTable.name === 'Customer' &&
          JSON.stringify(item.refColumns) ===
            JSON.stringify(CUSTOMER_INVOICE_FK.refColumns),
      );
      if (
        refs?.version !== 1 ||
        namedRelationships.length !== 1 ||
        exact.length !== 1 ||
        candidates.length !== 1
      )
        throw new Error(
          'The declared Invoice-to-Customer foreign key is missing, changed, or ambiguous.',
        );
      customerFields = requiredCustomer.map((name) => ({
        name,
        type: name === 'CustomerId' ? 'integer' : 'string',
      }));
      const savedBinding = savedBindings[0];
      if (
        !savedBinding ||
        savedBinding.id !== CUSTOMER_INVOICE_FK.name ||
        savedBinding.version !== CUSTOMER_INVOICE_FK_VERSION ||
        savedBinding.from.schema !== 'main' ||
        savedBinding.from.table !== 'Invoice' ||
        savedBinding.to.schema !== 'main' ||
        savedBinding.to.table !== 'Customer' ||
        savedBinding.pairs.length !== 1 ||
        savedBinding.pairs[0]?.fromField !== 'CustomerId' ||
        savedBinding.pairs[0]?.toField !== 'CustomerId'
      )
        throw new Error(
          'The saved relationship binding is stale, changed, or unsupported.',
        );
      const relationshipVersion = savedBinding.version;
      relationship = Object.freeze({
        id: CUSTOMER_INVOICE_FK.name,
        version: relationshipVersion,
        fromSource: String(rawFrom['alias'] ?? 'Invoice'),
        toSource: String(
          (rawJoins[0]?.['from'] as Record<string, unknown> | undefined)?.[
            'alias'
          ] ?? 'Customer',
        ),
        joinType: 'inner',
        pairs: Object.freeze(
          savedBinding.pairs.map((pair) => Object.freeze({ ...pair })),
        ),
      });
      schemaVersion = JSON.stringify({
        fixtureSha256: FIXTURE_SHA256,
        invoice: invoiceSchema,
        customer: requiredCustomer.map((name) => ({
          name,
          dbType: byName.get(name)?.dbType,
          isNullable: byName.get(name)?.isNullable,
          pkPosition: byName.get(name)?.pkPosition ?? 0,
        })),
        foreignKeysVersion: refs.version,
        foreignKey: CUSTOMER_INVOICE_FK,
      });
    }
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
    const parameterFreeTree = { ...tree };
    delete parameterFreeTree.parameters;
    const structuralQuery = { ...tree.query };
    delete structuralQuery['where'];
    const structuralDocument: TugQLDocument = {
      sourceMetadata: parsed.document.sourceMetadata,
      tree: {
        ...parameterFreeTree,
        query: structuralQuery,
      },
    };
    const authorization = resolveTugQL(structuralDocument, {
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
            ...(joined
              ? [
                  {
                    name: 'Customer',
                    fields: customerFields.map((field) => ({
                      ...field,
                      authorized: true,
                    })),
                  },
                ]
              : []),
          ],
        },
      ],
      relationships: relationship
        ? [
            {
              id: relationship.id,
              version: relationship.version,
              from: { table: 'Invoice', source: relationship.fromSource },
              to: { table: 'Customer', source: relationship.toSource },
              pairs: relationship.pairs,
              exactTypedEquality: true,
            },
          ]
        : [],
      pinnedImports: [],
      bindings: [],
    });
    if (authorization.diagnostics.length || !authorization.resolved)
      throw new Error(
        diagnosticsMessage(authorization.diagnostics) ||
          'The TugQL draft could not be resolved against the admitted Invoice schema.',
      );
    if (
      joined &&
      (!relationship ||
        authorization.resolved.relationships.length !== 1 ||
        authorization.resolved.relationships[0]?.id !== relationship.id ||
        authorization.resolved.relationships[0]?.version !==
          relationship.version ||
        authorization.resolved.relationships[0]?.fromSource !==
          relationship.fromSource ||
        authorization.resolved.relationships[0]?.toSource !==
          relationship.toSource ||
        authorization.resolved.relationships[0]?.joinType !== 'inner' ||
        authorization.resolved.relationships[0]?.pairs.length !== 1 ||
        authorization.resolved.relationships[0]?.pairs[0]?.fromField !==
          'CustomerId' ||
        authorization.resolved.relationships[0]?.pairs[0]?.toField !==
          'CustomerId')
    )
      throw new Error(
        'The query did not resolve through the admitted declared foreign key.',
      );
    const expandedSource =
      joined && relationship
        ? expandedJoinSource(
            request.text,
            rawJoins[0] as Readonly<Record<string, unknown>>,
            relationship.fromSource,
            relationship.toSource,
          )
        : undefined;
    return compilePublicSqliteTugQL(authorization.resolved, {
      fixtureSha256: FIXTURE_SHA256,
      schemaVersion,
      draftRevision,
      ...(relationship ? { relationship } : {}),
      ...(expandedSource ? { expandedSource } : {}),
    });
  }

  async runTugQL(
    project: IProjectRef,
    definition: IQueryDef,
    draftRevision: number,
    customerIdText: string,
    previewPlan: PublicSqliteQueryPreview,
    signal?: AbortSignal,
  ): Promise<FederatedQueryResult> {
    if (previewPlan.expandedSource !== undefined)
      throw new Error(
        'Apply the displayed relationship completion and preview the updated draft before Run.',
      );
    if (
      !/^-?\d+$/u.test(customerIdText) ||
      !Number.isSafeInteger(Number(customerIdText))
    )
      throw new Error(
        'Enter a whole-number CustomerId before running this query.',
      );
    const plan = await this.prepareTugQL(
      project,
      definition,
      draftRevision,
      signal,
    );
    if (JSON.stringify(plan) !== JSON.stringify(previewPlan))
      throw new Error(
        'The saved draft or its bindings changed. Preview SQL again before Run.',
      );
    const { fixedBindings, ...structuralPlan } = plan;
    const preparedPlan: PublicSqlitePreparedPlan = Object.freeze({
      ...structuralPlan,
      bindings: Object.freeze([Number(customerIdText), ...fixedBindings]),
    });
    const result = await this.executePlan(
      project,
      definition,
      preparedPlan,
      signal,
    );
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
          ...(plan.relationship ? { relationship: plan.relationship } : {}),
          ...(plan.outputColumns ? { outputColumns: plan.outputColumns } : {}),
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
          (plan.relationship
            ? JOINED_SCHEMA_FINGERPRINT
            : 'CustomerId:INTEGER|InvoiceId:INTEGER|InvoiceDate:DATETIME') ||
        JSON.stringify(receipt.relationship) !==
          JSON.stringify(plan.relationship) ||
        JSON.stringify(receipt.outputColumns) !==
          JSON.stringify(plan.outputColumns) ||
        (plan.outputColumns !== undefined &&
          JSON.stringify(reply.result.columns) !==
            JSON.stringify(plan.outputColumns.map((column) => column.name)))
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
        ...(receipt.relationship ? { relationship: receipt.relationship } : {}),
        ...(receipt.outputColumns
          ? { outputColumns: receipt.outputColumns }
          : {}),
      });
      return {
        recordset: {
          columns: reply.result.columns.map((name) => ({
            name,
            type:
              plan.outputColumns?.find((column) => column.name === name)
                ?.type ?? 'unknown',
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

import { isDemoDbOvdbDatabaseUrl } from './demodb-ovdb';
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
import { decodeTypedValue, type TypedValue } from '@sneat/datatug-semantic';
import type {
  IQueryDef,
  IQueryRelationshipBinding,
  ITextQueryRequest,
} from '../models/definition/query-def';
import { QueryType } from '../models/definition/query-def';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import type { IProjectRef } from '../core/project-context';
import type { FederatedQueryResult } from './federated-query-executor';
import {
  admitPublicSqliteComparisonFixtures,
  assertComparisonProject,
  isSupportedPublicSqliteComparisonProjection,
  publicSqliteComparisonTarget,
  type ComparisonFixtureTarget,
  type ComparisonWorkerObservation,
} from './public-sqlite-comparison';
import {
  compilePublicSqliteTugQL,
  preparePublicSqliteCteStructuralDocument,
  preparePublicSqliteInvoiceStructuralDocument,
  requireCustomerIdParameterSource,
  requireLiteralHavingThreshold,
  validatePublicSqliteCteSource,
  PUBLIC_CHINOOK_CUSTOMER_FK,
  type PublicSqliteRelationshipReceipt,
  type PublicSqlitePreparedPlan,
  type PublicSqliteQueryPreview,
  type PublicSqliteClientReportedBinding,
} from './public-sqlite-tugql';
import { prepareDeclaredSqlBindings, type SqliteScalar } from './sql-bindings';

export { prepareDeclaredSqlBindings, type SqliteScalar } from './sql-bindings';

const CONNECTION_ID = 'chinook-sqlite';
import {
  PUBLIC_CHINOOK_FIXTURE_SHA256,
  PUBLIC_CHINOOK_BUNDLED_FIXTURE,
  PUBLIC_CHINOOK_LEGACY_FIXTURE_URL,
} from './public-sqlite-source-identity';
const FIXTURE_SHA256 = PUBLIC_CHINOOK_FIXTURE_SHA256;
const FIXTURE_BYTES = PUBLIC_CHINOOK_BUNDLED_FIXTURE.bytes;
const RUN_TIMEOUT_MS = 10000;
const GITHUB_STORES = new Set(['github', 'github.com', 'firestore']);

function usesAgentProjectApi(project: IProjectRef): boolean {
  return project.projectApi === 'local' || project.projectApi === 'cloud' || project.spaceID !== undefined || !GITHUB_STORES.has(project.storeId);
}

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
  readonly comparisonFixtures?: readonly unknown[];
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
    !isDemoDbOvdbDatabaseUrl(entry.source, 'chinook') ||
    entry.fixtureSha256 !== FIXTURE_SHA256 ||
    ![PUBLIC_CHINOOK_BUNDLED_FIXTURE.url, PUBLIC_CHINOOK_LEGACY_FIXTURE_URL].includes(entry.browserFixture?.url ?? '') ||
    entry.browserFixture?.bytes !== FIXTURE_BYTES
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
    readonly targetId?: ComparisonFixtureTarget['id'];
    readonly schemaSha256?: string;
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

interface AdmittedColumn {
  readonly name: string;
  readonly dbType: string;
  readonly isNullable?: boolean;
  readonly pkPosition?: number;
}

interface AdmittedSchemaSnapshot {
  readonly invoiceColumns: readonly AdmittedColumn[];
  readonly customerColumns?: readonly AdmittedColumn[];
  readonly schemaVersion: string;
  readonly relationshipVersion?: string;
  readonly relationship?: IQueryRelationshipBinding;
}

export interface PublicSqliteSourceDiscovery {
  readonly fixtureSha256: string;
  readonly schemaVersion: string;
  readonly invoiceFields: readonly { readonly name: string; readonly type: string }[];
  readonly customerFields: readonly { readonly name: string; readonly type: string }[];
  readonly relationship: IQueryRelationshipBinding;
  readonly relationshipProvenance: 'chinook.refs.json · Core v1 declared foreign key';
  readonly cardinality: 'many invoices to one customer · declared';
  readonly crossSourceCost: 'unknown';
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

  /** Executes one side in a fresh worker after re-reading the exact pair admission. */
  async runComparisonSide(
    project: IProjectRef,
    definition: IQueryDef,
    plan: PublicSqlitePreparedPlan,
    targetId: ComparisonFixtureTarget['id'],
    signal?: AbortSignal,
  ): Promise<ComparisonWorkerObservation> {
    assertComparisonProject(project);
    const target = publicSqliteComparisonTarget(targetId);
    if (
      definition.connectionId !== CONNECTION_ID ||
      plan.sourceId !== CONNECTION_ID ||
      plan.fixtureSha256 !== FIXTURE_SHA256 ||
      ('expandedSource' in plan && plan.expandedSource !== undefined) ||
      !plan.relationship ||
      plan.relationship.joinType !== 'inner' ||
      !Object.isFrozen(plan) ||
      !Object.isFrozen(plan.bindings) ||
      !Number.isSafeInteger(plan.draftRevision) ||
      plan.draftRevision < 0 ||
      !Number.isInteger(plan.authorProof.resolvedQuery.limit) ||
      (plan.authorProof.resolvedQuery.limit ?? 0) < 1 ||
      (plan.authorProof.resolvedQuery.limit ?? 101) > 100
    ) {
      throw new Error('The frozen query is not eligible for fixture comparison.');
    }
    if (plan.authorProof.profile !== 'invoice-query')
      throw new Error('Fixture comparison supports only the pinned Invoice query profile.');
    const columns = plan.outputColumns;
    if (!columns || !isSupportedPublicSqliteComparisonProjection(plan)) {
      throw new Error('Comparison requires InvoiceId followed by supported raw text columns.');
    }

    const preview = await this.prepareTugQL(project, definition, plan.draftRevision, signal, true);
    if (preview.expandedSource !== undefined)
      throw new Error(
        'Apply the displayed relationship completion and Preview the updated draft before comparing.',
      );
    const { fixedBindings, bindingSlots, ...previewPlan } = preview;
    if (JSON.stringify(preview.bindingNames) !== JSON.stringify(plan.bindingNames))
      throw new Error('The comparison binding slots changed after Preview.');
    let expectedBindings: readonly (string | number | null)[];
    if (bindingSlots) {
      if (bindingSlots.length !== plan.bindings.length)
        throw new Error('The comparison binding slots changed after Preview.');
      expectedBindings = bindingSlots.map((slot, index) => {
        const value = plan.bindings[index];
        if (slot.kind === 'customer-id') {
          if (typeof value !== 'number' || !Number.isSafeInteger(value))
            throw new Error('Comparison requires a whole-number CustomerId binding.');
          return value;
        }
        if (value !== slot.value)
          throw new Error('The prepared literal bindings changed after Preview.');
        return slot.value;
      });
    } else {
      const customerId = plan.bindings[0];
      if (
        preview.bindingNames[0] !== 'CustomerId' ||
        typeof customerId !== 'number' ||
        !Number.isSafeInteger(customerId) ||
        plan.bindings.length !== fixedBindings.length + 1
      )
        throw new Error('Comparison requires the current whole-number CustomerId binding.');
      expectedBindings = [customerId, ...fixedBindings];
    }
    if (
      JSON.stringify(previewPlan) !== JSON.stringify({ ...plan, bindings: undefined }) ||
      JSON.stringify(expectedBindings) !== JSON.stringify(plan.bindings)
    ) {
      throw new Error('The saved draft, schema, relationship, or bindings changed after Preview.');
    }
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
          reject(new Error('The browser SQLite comparison exceeded 10 seconds.'));
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
          reject(new Error('The browser SQLite comparison worker failed.'));
        };
        worker.postMessage({
          mode: 'comparison',
          comparisonTarget: target,
          sql: plan.sql,
          bindings: plan.bindings,
          bindingNames: plan.bindingNames,
          fixtureSha256: plan.fixtureSha256,
          schemaVersion: plan.schemaVersion,
          draftRevision: plan.draftRevision,
          authorProfile: true,
          authorProfileKind: plan.authorProof.profile,
          relationship: plan.relationship,
          outputColumns: plan.outputColumns,
          authorProof: plan.authorProof,
        });
      });
      if (!reply.ok || !reply.result)
        throw new Error(reply.error ?? 'The browser SQLite comparison failed.');
      const receipt = reply.receipt;
      if (
        !receipt?.executionId ||
        receipt.sql !== plan.sql ||
        JSON.stringify(receipt.bindings) !== JSON.stringify(plan.bindings) ||
        JSON.stringify(receipt.bindingNames) !== JSON.stringify(plan.bindingNames) ||
        receipt.fixtureSha256 !== target.sha256 ||
        receipt.targetId !== target.id ||
        receipt.schemaSha256 !== target.schemaSha256 ||
        receipt.schemaVersion !== plan.schemaVersion ||
        receipt.draftRevision !== plan.draftRevision ||
        receipt.schemaFingerprint !== JOINED_SCHEMA_FINGERPRINT ||
        JSON.stringify(receipt.relationship) !== JSON.stringify(plan.relationship) ||
        JSON.stringify(receipt.outputColumns) !== JSON.stringify(plan.outputColumns) ||
        JSON.stringify(reply.result.columns) !==
          JSON.stringify(columns?.map((column) => column.name))
      ) {
        throw new Error('The SQLite worker receipt did not match its comparison target.');
      }
      const seenKeys = new Set<number>();
      for (const row of reply.result.rows) {
        const keyValue = row[0];
        if (!Number.isSafeInteger(keyValue) || seenKeys.has(keyValue as number))
          throw new Error('Comparison rows require unique, non-null safe-integer InvoiceId keys.');
        seenKeys.add(keyValue as number);
        if (row.slice(1).some((cell) => cell !== null && typeof cell !== 'string'))
          throw new Error('Comparison supports only raw text result cells after InvoiceId.');
      }
      return Object.freeze({
        kind: 'browser-session',
        targetId: target.id,
        fixtureSha256: target.sha256,
        schemaSha256: target.schemaSha256,
        schemaFingerprint: receipt.schemaFingerprint,
        columns: Object.freeze(columns.map((column) => Object.freeze({
          name: column.name,
          type: column.type,
        }))),
        executionId: receipt.executionId,
        observedAt: new Date().toISOString(),
        rowCount: reply.result.rows.length,
        rows: Object.freeze(reply.result.rows.map((row) => Object.freeze([...row]))),
        resultComplete: true,
        expiresWithSession: true,
      });
    } finally {
      worker.terminate();
    }
  }

  /** One live, source-qualified metadata read shared by discovery and Preview/Run. */
  private async readAdmittedSchemaSnapshot(
    project: IProjectRef,
    includeRelationship: boolean,
    signal?: AbortSignal,
    includeComparisonPair = false,
  ): Promise<AdmittedSchemaSnapshot> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const [catalog, invoiceFile, customerFile, refs] = await Promise.all([
      firstValueFromAbortable(
        (usesAgentProjectApi(project)
          ? this.projectApi.connectionCatalog<ConnectionCatalog>(project)
          : this.reader.getRawJson<ConnectionCatalog>(
              project.projectId,
              'connections/demo-db.json',
            )
        ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
        signal,
      ),
      firstValueFromAbortable(
        this.reader.getRawJson<TableColumnsFile>(
          project.projectId,
          'dbmodels/chinook/main/tables/Invoice/main.Invoice.columns.json',
        ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
        signal,
      ),
      includeRelationship
        ? firstValueFromAbortable(
            this.reader.getRawJson<TableColumnsFile>(
              project.projectId,
              'dbmodels/chinook/main/tables/Customer/main.Customer.columns.json',
            ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
            signal,
          )
        : Promise.resolve(undefined),
      includeRelationship
        ? firstValueFromAbortable(
            this.reader.getRawJson<ForeignKeysFile>(
              project.projectId,
              'dbmodels/chinook/chinook.refs.json',
            ).pipe(timeout({ first: RUN_TIMEOUT_MS })),
            signal,
          )
        : Promise.resolve(undefined),
    ]);
    if (Date.now() > deadline)
      throw new Error('The public SQLite schema check exceeded 10 seconds.');
    admitPublicSqliteSource(catalog, CONNECTION_ID);
    if (includeComparisonPair) admitPublicSqliteComparisonFixtures(catalog);

    const invoiceColumns = invoiceFile?.columns;
    if (!invoiceColumns?.length)
      throw new Error('The admitted Chinook Invoice schema is unavailable.');
    const invoiceNames = ['CustomerId', 'InvoiceId', 'InvoiceDate'];
    const expectedTypes: Readonly<Record<string, string>> = {
      CustomerId: 'INTEGER',
      InvoiceId: 'INTEGER',
      InvoiceDate: 'DATETIME',
    };
    const admittedInvoice = invoiceNames.map((name) => {
      const matches = invoiceColumns.filter((column) => column.name === name);
      const column = matches[0];
      if (matches.length !== 1 || column?.dbType?.trim().toUpperCase() !== expectedTypes[name])
        throw new Error(`The admitted Chinook Invoice schema is missing ${name}.`);
      return {
        name,
        dbType: column.dbType as string,
        isNullable: column.isNullable,
        ...(column.pkPosition !== undefined ? { pkPosition: column.pkPosition } : {}),
      };
    });

    const customerColumns = customerFile?.columns;
    let admittedCustomer: AdmittedColumn[] | undefined;
    let relationship: IQueryRelationshipBinding | undefined;
    let relationshipVersion: string | undefined;
    let foreignKeyVersion: number | undefined;
    if (includeRelationship) {
      if (!customerColumns?.length)
        throw new Error('The admitted Chinook Customer schema is unavailable.');
      const customerNames = ['CustomerId', 'FirstName', 'LastName', 'Email'];
      admittedCustomer = customerNames.map((name) => {
      const matches = customerColumns.filter((column) => column.name === name);
      const column = matches[0];
      if (matches.length !== 1 || !column?.dbType)
        throw new Error(`The admitted Chinook Customer schema is missing ${name}.`);
      if (name === 'CustomerId') {
        if (column.dbType.trim().toUpperCase() !== 'INTEGER' || column.pkPosition !== 1 || column.isNullable !== false)
          throw new Error('Customer.CustomerId must be the non-null INTEGER primary key.');
      } else if (!/^(?:N?VARCHAR|N?CHAR|TEXT|CLOB)(?:\b|\()/iu.test(column.dbType.trim())) {
        throw new Error(`The admitted Chinook Customer ${name} field must be a string.`);
      }
      return {
        name,
        dbType: column.dbType,
        isNullable: column.isNullable,
        ...(column.pkPosition !== undefined ? { pkPosition: column.pkPosition } : {}),
      };
      });
      const candidates = refs?.foreignKeys?.filter(
      (item) => (item.table?.name === 'Invoice' && item.refTable?.name === 'Customer') ||
        (item.table?.name === 'Customer' && item.refTable?.name === 'Invoice'),
    ) ?? [];
    const namedRelationships = refs?.foreignKeys?.filter((item) => item.name === CUSTOMER_INVOICE_FK.name) ?? [];
    const exact = candidates.filter((item) =>
      item.name === CUSTOMER_INVOICE_FK.name &&
      item.table?.schema === 'main' && item.table.name === 'Invoice' &&
      JSON.stringify(item.columns) === JSON.stringify(CUSTOMER_INVOICE_FK.columns) &&
      item.refTable?.schema === 'main' && item.refTable.name === 'Customer' &&
      JSON.stringify(item.refColumns) === JSON.stringify(CUSTOMER_INVOICE_FK.refColumns),
    );
      if (refs?.version !== 1 || namedRelationships.length !== 1 || exact.length !== 1 || candidates.length !== 1)
        throw new Error('The declared Invoice-to-Customer foreign key is missing, changed, or ambiguous.');
      relationshipVersion = CUSTOMER_INVOICE_FK_VERSION;
      relationship = Object.freeze({
        id: CUSTOMER_INVOICE_FK.name,
        version: relationshipVersion,
        from: Object.freeze({ schema: 'main', table: 'Invoice' }),
        to: Object.freeze({ schema: 'main', table: 'Customer' }),
        pairs: Object.freeze([Object.freeze({ fromField: 'CustomerId', toField: 'CustomerId' })]),
      });
      foreignKeyVersion = refs.version;
    }
    const schemaVersion = includeRelationship
      ? JSON.stringify({
          fixtureSha256: FIXTURE_SHA256,
          invoice: admittedInvoice,
          customer: admittedCustomer,
          foreignKeysVersion: foreignKeyVersion,
          foreignKey: CUSTOMER_INVOICE_FK,
        })
      : `${FIXTURE_SHA256}:${JSON.stringify(admittedInvoice)}`;
    return Object.freeze({
      invoiceColumns: Object.freeze(admittedInvoice),
      ...(admittedCustomer ? { customerColumns: Object.freeze(admittedCustomer) } : {}),
      schemaVersion,
      relationshipVersion,
      ...(relationship ? { relationship } : {}),
    });
  }

  public async discoverInvoiceCustomerSources(
    project: IProjectRef,
    signal?: AbortSignal,
  ): Promise<PublicSqliteSourceDiscovery> {
    const snapshot = await this.readAdmittedSchemaSnapshot(project, true, signal);
    return Object.freeze({
      fixtureSha256: FIXTURE_SHA256,
      schemaVersion: snapshot.schemaVersion,
      invoiceFields: Object.freeze(snapshot.invoiceColumns.map((column) => ({ name: column.name, type: tugqlType(column.dbType) }))),
      customerFields: Object.freeze((snapshot.customerColumns ?? []).map((column) => ({ name: column.name, type: tugqlType(column.dbType) }))),
      relationship: snapshot.relationship as IQueryRelationshipBinding,
      relationshipProvenance: 'chinook.refs.json · Core v1 declared foreign key',
      cardinality: 'many invoices to one customer · declared',
      crossSourceCost: 'unknown',
    });
  }

  /** Compile only after re-reading both admitted-source and typed schema metadata. */
  async prepareTugQL(
    project: IProjectRef,
    definition: IQueryDef,
    draftRevision: number,
    signal?: AbortSignal,
    comparisonPair = false,
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
    const request = definition.request as ITextQueryRequest;
    const parsed = parseTugQL(request.text);
    if (parsed.diagnostics.length)
      throw new Error(diagnosticsMessage(parsed.diagnostics));
    const tree = parsed.document.tree;
    if (!tree) throw new Error('The TugQL draft is incomplete.');
    const cteProfile = validatePublicSqliteCteSource(tree);
    const structuralDocument = cteProfile
      ? preparePublicSqliteCteStructuralDocument(parsed.document)
      : undefined;
    const rawFrom = tree.query.from as Readonly<Record<string, unknown>>;
    const rawJoins = Array.isArray(rawFrom['joins'])
      ? (rawFrom['joins'] as readonly Readonly<Record<string, unknown>>[])
      : [];
    const joined = cteProfile || rawJoins.length > 0;
    const savedBindings = definition.relationshipBindings ?? [];
    if (joined && !cteProfile && savedBindings.length !== 1)
      throw new Error(
        'Save this joined query with its declared relationship binding before previewing.',
      );
    if (cteProfile && savedBindings.length)
      throw new Error('The explicit CTE Customer join does not use an Invoice relationship binding.');
    if (!joined && savedBindings.length)
      throw new Error(
        'The saved relationship binding does not match this single-table query.',
      );
    if (
      !cteProfile && joined &&
      (rawJoins.length !== 1 ||
        rawJoins[0]?.['type']?.toString().toLowerCase() === 'left')
    )
      throw new Error(
        'This preview supports one INNER Invoice-to-Customer relationship only.',
      );
    if (definition.connectionId !== CONNECTION_ID)
      throw new Error('This query has no admitted public browser SQLite source.');
    const snapshot = await this.readAdmittedSchemaSnapshot(project, joined, signal, comparisonPair);
    const requiredFields = ['CustomerId', 'InvoiceId', 'InvoiceDate'];
    const expectedTypes: Readonly<Record<string, string>> = {
      CustomerId: 'INTEGER',
      InvoiceId: 'INTEGER',
      InvoiceDate: 'DATETIME',
    };
    const customerFields = (snapshot.customerColumns ?? []).map((column) => ({
      name: column.name,
      type: tugqlType(column.dbType),
    }));
    let relationship: PublicSqliteRelationshipReceipt | undefined;
    const schemaVersion = snapshot.schemaVersion;
    if (joined) {
      const savedBinding = savedBindings[0];
      if (!cteProfile && (
        !savedBinding ||
        savedBinding.id !== snapshot.relationship?.id ||
        savedBinding.version !== snapshot.relationship?.version ||
        savedBinding.from.schema !== 'main' ||
        savedBinding.from.table !== 'Invoice' ||
        savedBinding.to.schema !== 'main' ||
        savedBinding.to.table !== 'Customer' ||
        savedBinding.pairs.length !== 1 ||
        savedBinding.pairs[0]?.fromField !== 'CustomerId' ||
        savedBinding.pairs[0]?.toField !== 'CustomerId'
      ))
        throw new Error(
          'The saved relationship binding is stale, changed, or unsupported.',
        );
      const relationshipVersion = savedBinding?.version ?? snapshot.relationshipVersion;
      if (!cteProfile) relationship = Object.freeze({
        id: snapshot.relationship?.id ?? CUSTOMER_INVOICE_FK.name,
        version: relationshipVersion ?? CUSTOMER_INVOICE_FK_VERSION,
        fromSource: String(rawFrom['alias'] ?? 'Invoice'),
        toSource: String(
          (rawJoins[0]?.['from'] as Record<string, unknown> | undefined)?.[
            'alias'
          ] ?? 'Customer',
        ),
        joinType: 'inner',
        pairs: Object.freeze(
          (savedBinding?.pairs ?? snapshot.relationship?.pairs ?? []).map((pair) => Object.freeze({ ...pair })),
        ),
      });
    }
    if (!structuralDocument) {
      requireCustomerIdParameterSource(tree);
      requireLiteralHavingThreshold(tree);
    }
    const structural = structuralDocument ?? preparePublicSqliteInvoiceStructuralDocument(parsed.document);
    const authorization = resolveTugQL(structural, {
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
      joined && !cteProfile &&
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
    const preview = compilePublicSqliteTugQL(authorization.resolved, {
      fixtureSha256: FIXTURE_SHA256,
      schemaVersion,
      draftRevision,
      authoredSource: request.text,
      ...(relationship ? { relationship } : {}),
      ...(expandedSource ? { expandedSource } : {}),
    });
    if (!cteProfile && preview.outputColumns) {
      const compilerColumns = preview.outputColumns ?? [];
      const resolverColumns = authorization.resolved.columns;
      const invoiceAlias = relationship?.fromSource ?? String(rawFrom['alias'] ?? 'Invoice');
      const dateIndexes = resolverColumns
        .map((column, index) =>
          column.lineage?.some((item) => item.source === invoiceAlias && item.field === 'InvoiceDate')
            ? index
            : -1,
        )
        .filter((index) => index >= 0);
      const hasInvoiceDate = dateIndexes.length > 0;
      if (
        compilerColumns.length !== resolverColumns.length ||
        (hasInvoiceDate && preview.authorProof.rawInvoiceDateTextRule !== 'chinook-invoice-datetime-text/v1')
      )
        throw new Error('The Invoice projection differs from Core resolution or lacks the pinned raw InvoiceDate rule.');
      for (let index = 0; index < resolverColumns.length; index++) {
        const resolvedColumn = resolverColumns[index];
        const compiledColumn = compilerColumns[index];
        if (!resolvedColumn || !compiledColumn ||
            resolvedColumn.name !== compiledColumn.name ||
            JSON.stringify(resolvedColumn.lineage ?? []) !== JSON.stringify(compiledColumn.lineage))
          throw new Error('The compiler output names or lineage differ from Core resolution.');
        const sourceQualifiedDate = dateIndexes.includes(index);
        const resolvedType = resolvedColumn.type.toLowerCase();
        if (sourceQualifiedDate) {
          if (!/(?:date|time)/u.test(resolvedType) || compiledColumn.type !== 'string')
            throw new Error('Invoice.InvoiceDate must resolve as DATETIME and lower to pinned raw SQLite text.');
        } else {
          const expectedType = /int/u.test(resolvedType)
            ? 'integer'
            : /char|text|string/u.test(resolvedType)
              ? 'string'
              : 'unsupported';
          if (compiledColumn.type !== expectedType)
            throw new Error('The compiler output type differs from Core resolution.');
        }
      }
    }
    if (cteProfile) {
      const compilerColumns = preview.outputColumns ?? [];
      const resolverColumns = authorization.resolved.columns.map((column) => ({
        name: column.name,
        type: column.type.toLowerCase().includes('int') ? 'integer' : column.type.toLowerCase().includes('char') || column.type.toLowerCase().includes('text') || column.type.toLowerCase().includes('string') ? 'string' : 'unsupported',
        lineage: column.lineage ?? [],
      }));
      if (JSON.stringify(compilerColumns) !== JSON.stringify(resolverColumns))
        throw new Error('The bounded CTE compiler output metadata differs from Core resolution.');
    }
    return preview;
  }

  async runTugQL(
    project: IProjectRef,
    definition: IQueryDef,
    draftRevision: number,
    customerIdText: string,
    previewPlan: PublicSqliteQueryPreview,
    signal?: AbortSignal,
    bindingProvenance: PublicSqliteClientReportedBinding = {
      origin: 'manual',
      originEvidence: 'client-reported',
    },
    onDispatched?: () => void,
  ): Promise<FederatedQueryResult> {
    const clientReportedBinding = Object.freeze({ ...bindingProvenance });
    if (
      !['manual', 'selection'].includes(clientReportedBinding.origin) ||
      clientReportedBinding.originEvidence !== 'client-reported' ||
      (clientReportedBinding.origin === 'selection' &&
        (!clientReportedBinding.sourceQueryId ||
          !clientReportedBinding.sourceColumn)) ||
      (clientReportedBinding.origin === 'manual' &&
        (clientReportedBinding.sourceQueryId ||
          clientReportedBinding.sourceColumn))
    ) {
      throw new Error('The CustomerId input origin is invalid.');
    }
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
    const { fixedBindings, bindingSlots, ...structuralPlan } = plan;
    const preparedPlan: PublicSqlitePreparedPlan = Object.freeze({
      ...structuralPlan,
      bindings: Object.freeze(bindingSlots
        ? bindingSlots.map((slot) => slot.kind === 'customer-id' ? Number(customerIdText) : slot.value)
        : [Number(customerIdText), ...fixedBindings]),
    });
    const result = await this.executePlan(
      project,
      definition,
      preparedPlan,
      signal,
      clientReportedBinding,
      onDispatched,
    );
    return result;
  }

  async run(
    project: IProjectRef,
    definition: IQueryDef,
    onDispatched?: () => void,
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
    return this.runBoundSql(project, definition, [], onDispatched);
  }

  /** Ordinary typed parameters, on the same admitted read-only worker and fixture. */
  async runParameterized(
    project: IProjectRef,
    definition: IQueryDef,
    values: Readonly<Record<string, TypedValue>>,
    onDispatched?: () => void,
  ): Promise<FederatedQueryResult> {
    if (definition.request.queryType !== QueryType.SQL || !definition.connectionId || definition.federation ||
      !definition.parameters?.length || Object.keys(values).length !== definition.parameters.length)
      throw new Error('This query requires its exact declared scalar inputs.');
    const scalarValues = new Map<string, SqliteScalar>();
    const bindings = definition.parameters.map((parameter): SqliteScalar => {
      const value = decodeTypedValue(values[parameter.id]);
      if (parameter.isMultiValue || value.type !== parameter.type)
        throw new Error(`Input ${parameter.id} has an incompatible type or cardinality.`);
      let scalar: SqliteScalar;
      if (value.type === 'integer') {
        const number = Number(value.value);
        if (!Number.isSafeInteger(number) || BigInt(value.value) !== BigInt(number)) throw new Error('This SQLite input cannot represent that integer losslessly.');
        scalar = number;
      } else if (value.type === 'string' || value.type === 'date' || value.type === 'datetime') {
        scalar = value.value;
      } else if (value.type === 'boolean') {
        scalar = value.value ? 1 : 0;
      } else {
        throw new Error('This browser SQLite binding requires a losslessly supported scalar type.');
      }
      scalarValues.set(parameter.id, scalar);
      return scalar;
    });
    const prepared = prepareDeclaredSqlBindings(
      (definition.request as ITextQueryRequest).text,
      definition.parameters,
      scalarValues,
      bindings,
    );
    return this.runBoundSql(project, definition, prepared.bindings, onDispatched, prepared.sql);
  }

  private async runBoundSql(
    project: IProjectRef, definition: IQueryDef, bindings: readonly SqliteScalar[], onDispatched?: () => void, preparedSql?: string,
  ): Promise<FederatedQueryResult> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    const catalog = await firstValueFrom(
      (usesAgentProjectApi(project)
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
    admitPublicSqliteSource(catalog, definition.connectionId ?? '');
    if (typeof Worker === 'undefined')
      throw new Error('This browser does not support SQLite query workers.');
    const sql = preparedSql ?? (definition.request as ITextQueryRequest).text;
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
        worker.postMessage({ sql, bindings });
        onDispatched?.();
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
    bindingProvenance?: PublicSqliteClientReportedBinding,
    onDispatched?: () => void,
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
      (usesAgentProjectApi(project)
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
          authorProfileKind: plan.authorProof.profile,
          ...(plan.relationship ? { relationship: plan.relationship } : {}),
          ...(plan.outputColumns ? { outputColumns: plan.outputColumns } : {}),
          authorProof: plan.authorProof,
        });
        onDispatched?.();
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
          (plan.relationship || plan.authorProof.profile === 'customer-count-cte' || plan.authorProof.profile === 'bounded-cte-query'
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
        ...(bindingProvenance
          ? { clientReportedBinding: Object.freeze({ ...bindingProvenance }) }
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
            value: { type: 'integer', value: String(plan.bindings[plan.bindingNames.indexOf('CustomerId')]) },
            origin: bindingProvenance?.origin ?? 'manual',
            originEvidence:
              bindingProvenance?.originEvidence ?? 'client-reported',
          },
        ],
        truncated: false,
        publicSqliteReceipt: executionReceipt,
        provenance: {
          source: 'Pinned public Chinook SQLite fixture',
          queryId: definition.id,
          mode: 'snapshot',
          observedAt: new Date().toISOString(),
        },
      };
    } finally {
      worker.terminate();
    }
  }
}

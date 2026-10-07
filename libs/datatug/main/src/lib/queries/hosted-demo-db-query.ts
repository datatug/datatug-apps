import { QueryType, type IQueryDef, type ITextQueryRequest } from '../models/definition/query-def';

export const HOSTED_DEMO_DB_OVDB_BASE_URL = 'https://demodb.dev/ovdb';

export interface HostedDemoDbSource {
  readonly id: string;
  readonly label: string;
  readonly database: string;
  readonly schema?: string;
  readonly name: string;
  readonly alias: string;
  readonly fields: readonly string[];
  readonly columns: readonly string[];
}

/** Starter tables are taken from the published DemoDB datasets and the
 * repository's existing Chinook/AdventureWorks query examples. The saved
 * definition carries this same table/source contract into browser execution. */
export const HOSTED_DEMO_DB_SOURCES: readonly HostedDemoDbSource[] = [
  {
    id: 'chinook.Customer',
    label: 'Chinook · Customer',
    database: 'chinook',
    name: 'Customer',
    alias: 'c',
    fields: ['CustomerId', 'FirstName', 'LastName', 'Country', 'City', 'Email'],
    columns: ['CustomerId', 'FirstName', 'LastName', 'Country'],
  },
  {
    id: 'adventureworks.Person.Person',
    label: 'AdventureWorks · Person.Person',
    database: 'adventureworks',
    // OVDB's strict SQLite schema mode exposes this under its complete
    // collection key and rejects schema-qualified DTQL sources.
    name: 'Person.Person',
    alias: 'p',
    fields: ['BusinessEntityID', 'PersonType', 'FirstName', 'LastName', 'EmailPromotion'],
    columns: ['BusinessEntityID', 'FirstName', 'LastName'],
  },
];

function bodyFor(source: HostedDemoDbSource): string {
  const relation = [
    `  database: ${source.database}`,
    ...(source.schema ? [`  schema: ${source.schema}`] : []),
    `  name: ${source.name}`,
    `  alias: ${source.alias}`,
  ].join('\n');
  const columns = source.columns
    .map((field) => `  - {field: ${field}, source: ${source.alias}}`)
    .join('\n');
  return `from:\n${relation}\ncolumns:\n${columns}\nlimit: 20\n`;
}

export function createHostedDemoDbQuery(id: string): IQueryDef {
  const source = HOSTED_DEMO_DB_SOURCES[0];
  return {
    id,
    title: 'New DemoDB query',
    request: { queryType: QueryType.DTQL, text: bodyFor(source) } as ITextQueryRequest,
    federation: {
      ovdbBaseUrl: HOSTED_DEMO_DB_OVDB_BASE_URL,
      tables: [{
        database: source.database,
        name: source.name,
        ...(source.schema ? { schema: source.schema } : {}),
        fields: [...source.fields],
      }],
    },
  };
}

export function hostedDemoDbSourceId(definition: IQueryDef | undefined): string | undefined {
  const tables = definition?.federation?.tables;
  if (tables?.length !== 1) return undefined;
  const table = tables[0];
  if (!definition || !table || definition.federation?.ovdbBaseUrl !== HOSTED_DEMO_DB_OVDB_BASE_URL) return undefined;
  return HOSTED_DEMO_DB_SOURCES.find((source) =>
    source.database === table.database &&
    source.name === table.name &&
    source.schema === table.schema,
  )?.id;
}

/** The selector is a starter-query convenience, never a query editor. Hide it
 * once the user authors a different body so changing sources cannot replace
 * custom filters, joins, projections, or limits. */
export function isHostedDemoDbStarterQuery(definition: IQueryDef | undefined): boolean {
  const sourceId = hostedDemoDbSourceId(definition);
  if (!sourceId || !definition || definition.request.queryType !== QueryType.DTQL) return false;
  const source = HOSTED_DEMO_DB_SOURCES.find((item) => item.id === sourceId);
  if (!source || (definition.request as ITextQueryRequest).text !== bodyFor(source)) return false;

  // The picker replaces both the DTQL body and federation settings. A query
  // with a starter-looking body can still carry meaningful execution metadata
  // (lookups, limits, source rights, graph plans, etc.), so only admit the exact
  // canonical federation emitted by createHostedDemoDbQuery().
  const federation = definition.federation;
  const table = federation?.tables[0];
  return !!federation &&
    Object.keys(federation).sort().join(',') === 'ovdbBaseUrl,tables' &&
    federation.ovdbBaseUrl === HOSTED_DEMO_DB_OVDB_BASE_URL &&
    federation.tables.length === 1 &&
    !!table &&
    Object.keys(table).sort().join(',') === 'database,fields,name' &&
    table.database === source.database &&
    table.name === source.name &&
    table.fields.length === source.fields.length &&
    table.fields.every((field, index) => field === source.fields[index]);
}

export function withHostedDemoDbSource(
  definition: IQueryDef,
  sourceId: string,
): IQueryDef {
  const source = HOSTED_DEMO_DB_SOURCES.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Unknown hosted DemoDB source: ${sourceId}`);
  if (!isHostedDemoDbStarterQuery(definition)) {
    throw new Error('Only an unchanged hosted DemoDB starter query can switch sources.');
  }
  return {
    ...definition,
    request: { queryType: QueryType.DTQL, text: bodyFor(source) } as ITextQueryRequest,
    federation: {
      ovdbBaseUrl: HOSTED_DEMO_DB_OVDB_BASE_URL,
      tables: [{
        database: source.database,
        name: source.name,
        ...(source.schema ? { schema: source.schema } : {}),
        fields: [...source.fields],
      }],
    },
  };
}

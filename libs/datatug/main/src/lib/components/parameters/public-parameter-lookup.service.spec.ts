import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import type { TypedValue } from '@sneat/datatug-semantic';
import { PublicParameterLookupService, isPublicBrowserProject } from './public-parameter-lookup.service';
import { QueryDispatchService } from '../../queries/query-dispatch.service';
import type { QueryDispatchRequest } from '../../queries/query-dispatch';
import { ProjectAssetsReadService } from '../../services/project/project-assets-read.service';
import type { IParameterDef } from '../../models/definition/parameter';

const ref = { storeId: 'github.com', projectId: 'datatug/demo' };
const param: IParameterDef = { id: 'CustomerID', type: 'string', meta: { entity: 'Customer', field: 'ID' } };
const s = (value: string): TypedValue => ({ type: 'string', value });
const i = (value: number): TypedValue => ({ type: 'integer', value: String(value) });

const customer = {
  id: 'Customer',
  display: ['CompanyName'],
  fields: [
    { id: 'ID', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'CustomerID' }] },
    { id: 'CompanyName', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers', column: 'CompanyName' }] },
  ],
};

const catalog = [
  { id: 'northwind-sqlite', dataset: 'northwind', storage: 'sqlite', environments: ['dev'], fixtureSha256: 'a'.repeat(64), browserFixture: { url: '/assets/showcase/northwind.sqlite', bytes: 1 } },
  { id: 'northwind-postgresql', dataset: 'northwind', storage: 'postgresql', environments: ['dev'] },
];

const pragma = (rows: [string, string, number][]) => ({
  recordset: { columns: [], rows: rows.map(([name, type, pk]) => [s(name), s(type), i(pk)]) },
  limitations: [],
});

describe('PublicParameterLookupService', () => {
  let execute: ReturnType<typeof vi.fn>;
  let connectionCatalog: ReturnType<typeof vi.fn>;
  let entity: ReturnType<typeof vi.fn>;
  let entities: ReturnType<typeof vi.fn>;
  let schemaRows: [string, string, number][];
  let authState: BehaviorSubject<{ status: string; user?: { uid: string } }>;

  beforeEach(() => {
    schemaRows = [['CustomerID', 'nchar(5)', 1], ['CompanyName', 'nvarchar(40)', 0], ['ContactName', 'nvarchar(30)', 0]];
    execute = vi.fn((request: QueryDispatchRequest) => {
      const sql = (request.definition.request as unknown as { text: string }).text;
      if (sql.includes('pragma_table_info')) return Promise.resolve(pragma(schemaRows));
      return Promise.resolve({
        recordset: { columns: [], rows: Array.from({ length: 51 }, (_, n) => [s(`C${n}`), s(`Company ${n}`)]) },
        limitations: [
          { policy: 'Chart usage rights are unavailable.', rowsFiltered: false, hiddenColumns: [] },
          { policy: 'Some rows are hidden by policy.', rowsFiltered: true, hiddenColumns: [] },
        ],
      });
    });
    connectionCatalog = vi.fn(() => Promise.resolve(catalog));
    authState = new BehaviorSubject<{ status: string; user?: { uid: string } }>({ status: 'notAuthenticated' });
    entity = vi.fn(() => of(customer));
    entities = vi.fn(() => of([{ id: 'Customer' }]));
    TestBed.configureTestingModule({
      providers: [
        PublicParameterLookupService,
        { provide: QueryDispatchService, useValue: { execute, connectionCatalog } },
        { provide: ProjectAssetsReadService, useValue: { entity, entities } },
        { provide: SneatAuthStateService, useValue: { authState } },
      ],
    });
  });

  it('takes the browser path only for public projects', () => {
    expect(isPublicBrowserProject(ref)).toBe(true);
    expect(isPublicBrowserProject({ storeId: 'localhost:8989', projectId: 'demo' })).toBe(false);
    expect(isPublicBrowserProject({ storeId: 'firestore', projectId: 'p', spaceID: 's' })).toBe(false);
    expect(isPublicBrowserProject(undefined)).toBe(false);
  });

  it('binds eligible candidates to the browser-runnable connection without downloading a fixture', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref, environment: 'dev', hostConnectionId: 'northwind-sqlite' });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ source: 'northwind', collection: 'Customers', keyColumn: 'CustomerID', environment: 'dev' });
    expect(sources[0].connection.id).toBe('northwind-sqlite');
    expect(execute).not.toHaveBeenCalled();
    await service.sources(param, { projectRef: ref });
    expect(entity).toHaveBeenCalledTimes(1);
    expect(connectionCatalog).toHaveBeenCalledTimes(1);
    expect(await service.sources({ ...param, meta: undefined }, { projectRef: ref })).toEqual([]);
    expect(await service.sources(param, { projectRef: { storeId: 'localhost:8989', projectId: 'demo' } })).toEqual([]);
  });

  it('infers a meta-less parameter\'s meaning from one key field\'s name pattern', async () => {
    const keyed = {
      ...customer,
      fields: [{ ...customer.fields[0], isKeyField: true, namePatterns: [{ type: 'regexp', value: '\\w+CustomerID', caseSensitive: true }] }, customer.fields[1]],
    };
    const supplier = { id: 'Supplier', fields: [{ id: 'ID', type: 'string', isKeyField: true, namePatterns: [{ type: 'exact', value: 'ShipCustomerID' }] }] };
    entity.mockImplementation((_ref: unknown, id: string) => of(id === 'Customer' ? keyed : supplier));
    const service = TestBed.inject(PublicParameterLookupService);
    const bare: IParameterDef = { id: '@ShipCustomerID', type: 'string' };
    const sources = await service.sources(bare, { projectRef: ref });
    expect(sources).toHaveLength(1);
    expect(sources[0].meaning).toEqual({ entity: 'Customer', field: 'ID', provenance: 'inferred', rule: 'namePattern:regexp:\\w+CustomerID' });
    const provider = service.provider({ ...bare, meta: { entity: 'Customer', field: 'ID' } }, { projectRef: ref }, sources, keyed);
    expect(provider.meaningNote).toBe('Meaning guessed from the name @ShipCustomerID: Customer.ID. Declare meta on this parameter to confirm it.');
    expect(service.provider(param, { projectRef: ref }, [], keyed).meaningNote).toBeUndefined();
    expect(await service.sources({ id: 'Region', type: 'string' }, { projectRef: ref })).toEqual([]);
    expect(await service.sources({ ...bare, meta: { entity: 'Customer', field: '' } }, { projectRef: ref })).toEqual([]);
    expect(await service.sources({ ...bare, isMultiValue: true }, { projectRef: ref })).toEqual([]);
    // A second project lists Customer and Supplier: two key fields match, so the name is ambiguous.
    entities.mockReturnValueOnce(of([{ id: 'Customer' }, { id: 'Supplier' }]));
    expect(await service.sources(bare, { projectRef: { ...ref, projectId: 'two' } })).toEqual([]);
    expect(entities).toHaveBeenCalledTimes(2);
  });

  it('retries the entity listing after a failure', async () => {
    entities.mockReturnValueOnce(throwError(() => new Error('offline')));
    const service = TestBed.inject(PublicParameterLookupService);
    const bare: IParameterDef = { id: 'CustomerID', type: 'string' };
    expect(await service.meaning(ref, bare)).toBeUndefined();
    entities.mockReturnValueOnce(of(undefined));
    expect(await service.meaning(ref, bare)).toBeUndefined();
    entities.mockReturnValueOnce(of(Array.from({ length: 101 }, (_, n) => ({ id: `E${n}` }))));
    expect(await service.meaning(ref, bare)).toBeUndefined();
    expect(entities).toHaveBeenCalledTimes(3);
  });

  it('fails closed, uncached, when one entity read fails', async () => {
    const keyed = (id: string, value: string) => ({ id, fields: [{ id: 'ID', type: 'string', isKeyField: true, namePatterns: [{ type: 'exact', value }] }] });
    entities.mockReturnValue(of([{ id: 'Customer' }, { id: 'Account' }]));
    let accountFails = true;
    entity.mockImplementation((_ref: unknown, id: string) =>
      id === 'Account' && accountFails ? throwError(() => new Error('503')) : of(keyed(id, 'ShipCustomerID')));
    const service = TestBed.inject(PublicParameterLookupService);
    const bare: IParameterDef = { id: 'ShipCustomerID', type: 'string' };
    // Account also matches; with its read failed, Customer alone must not win.
    expect(await service.meaning(ref, bare)).toBeUndefined();
    accountFails = false;
    expect(await service.meaning(ref, bare)).toBeUndefined();
    expect(entities).toHaveBeenCalledTimes(2);
  });

  it('has no source when the entity or the catalog cannot be read', async () => {
    entity.mockReturnValueOnce(throwError(() => new Error('404')));
    connectionCatalog.mockRejectedValueOnce(new Error('offline'));
    const service = TestBed.inject(PublicParameterLookupService);
    expect(await service.sources(param, { projectRef: ref })).toEqual([]);
    expect(await service.sources(param, { projectRef: { ...ref, projectId: 'other' } })).toHaveLength(1);
  });

  it('verifies the key in the fixture catalog, then runs one bounded, bound statement', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const context = { projectRef: ref, environment: 'dev', hostConnectionId: 'northwind-sqlite' };
    const sources = await service.sources(param, context);
    const provider = service.provider(param, context, sources, customer);
    expect(provider.preselectedSourceId).toBe(sources[0].id);
    expect(provider.sources).toEqual([{ id: sources[0].id, label: 'Customers · northwind' }]);
    const signal = new AbortController().signal;
    const page = await provider.search(sources[0].id, 'bott', signal);
    const [probe, rows] = execute.mock.calls.map((call) => call[0] as QueryDispatchRequest);
    expect(probe.target).toEqual({ kind: 'browser-sqlite' });
    expect(probe.parameters).toEqual({ collection: s('Customers') });
    expect(rows.definition.connectionId).toBe('northwind-sqlite');
    expect((rows.definition.request as unknown as { text: string }).text).toContain('FROM "Customers" WHERE');
    expect(rows.parameters).toEqual({ filter: s('%bott%') });
    expect(rows.environment).toBe('dev');
    expect(page.columns.map((c) => c.name)).toEqual(['CustomerID', 'CompanyName']);
    expect(page.rows).toHaveLength(50);
    expect(page.limited).toBe(true);
    expect(page.inferredNote).toBeUndefined();
    expect(page.limitations).toEqual(['Some rows are hidden by policy.']);
    await provider.search(sources[0].id, '', signal);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2][0].parameters).toBeUndefined();
    await expect(provider.search('nope', '', signal)).rejects.toThrow('Unknown lookup source.');
  });

  it('labels guessed display columns for signed-in authors only, in human words', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const bare = { id: 'Customer', fields: [customer.fields[0]] };
    entity.mockReturnValue(of(bare));
    const sources = await service.sources(param, { projectRef: ref });
    const provider = service.provider(param, { projectRef: ref }, sources, bare);
    expect(provider.sourceNote).toBe('Northwind sample, pinned · read in your browser.');
    const anonymous = await provider.search(sources[0].id, '', new AbortController().signal);
    expect(anonymous.columns.map((c) => c.name)).toEqual(['CustomerID', 'CompanyName', 'ContactName']);
    expect(anonymous.columns.map((c) => c.label)).toEqual(['Customer ID', 'Company name', 'Contact name']);
    expect(anonymous.inferredNote).toBeUndefined();
    authState.next({ status: 'authenticated', user: { uid: 'u1' } });
    const author = await provider.search(sources[0].id, '', new AbortController().signal);
    expect(author.inferredNote).toBe('Columns guessed: declare display on entity Customer to choose them.');
    provider.dispose?.();
  });

  it.each([
    [[], 'Customers cannot be used for this lookup: it is not in this sample.'],
    [[['CustomerID', 'nchar(5)', 1], ['Region', 'text', 2]], 'it has no single-column primary key on CustomerID'],
    [[['CompanyName', 'text', 1]], 'it has no single-column primary key on CustomerID'],
    [[['CustomerID', 'decimal', 1]], 'its key CustomerID is neither integer nor text'],
  ] as [[string, string, number][], string][])('explains an unusable source %#', async (rows, message) => {
    schemaRows = rows;
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref });
    const page = await service.provider(param, { projectRef: ref }, sources, customer).search(sources[0].id, '', new AbortController().signal);
    expect(page.unavailable).toContain(message);
    expect(page.rows).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('refuses a text key for an integer input when the fixture disagrees with the model', async () => {
    const intEntity = { ...customer, fields: [{ ...customer.fields[0], type: 'integer' }, customer.fields[1]] };
    entity.mockReturnValue(of(intEntity));
    const intParam = { ...param, type: 'integer' as const };
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(intParam, { projectRef: ref });
    const page = await service.provider(intParam, { projectRef: ref }, sources, intEntity).search(sources[0].id, '', new AbortController().signal);
    expect(page.unavailable).toBe('Customers cannot be used for this lookup: its key is text but this input expects integer.');
  });

  it('never interpolates a collection name the fixture does not know', async () => {
    const hostile = { ...customer, fields: [{ id: 'ID', type: 'string', mappings: [{ source: 'northwind', collection: 'Customers"; DROP TABLE x; --', column: 'CustomerID' }] }] };
    entity.mockReturnValue(of(hostile));
    schemaRows = [];
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref });
    const page = await service.provider(param, { projectRef: ref }, sources, hostile).search(sources[0].id, '', new AbortController().signal);
    expect(page.unavailable).toContain('it is not in this sample');
    expect(execute).toHaveBeenCalledTimes(1);
    expect((execute.mock.calls[0][0].definition.request as { text: string }).text).not.toContain('DROP');
  });

  it('lets a newer search reuse a probe that an aborted search started', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref });
    const provider = service.provider(param, { projectRef: ref }, sources, customer);
    const first = new AbortController();
    const older = provider.search(sources[0].id, 'b', first.signal);
    first.abort();
    await expect(older).rejects.toMatchObject({ name: 'AbortError' });
    const page = await provider.search(sources[0].id, 'bo', new AbortController().signal);
    expect(page.rows.length).toBe(50);
    expect(execute.mock.calls.filter((c) => (c[0].definition.request as unknown as { text: string }).text.includes('pragma'))).toHaveLength(1);
    const late = new AbortController();
    late.abort();
    await expect(provider.search(sources[0].id, 'x', late.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('forgets a failed schema probe so Retry can succeed', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref });
    const provider = service.provider(param, { projectRef: ref }, sources, customer);
    execute.mockRejectedValueOnce(new Error('worker failed'));
    await expect(provider.search(sources[0].id, '', new AbortController().signal)).rejects.toThrow('worker failed');
    const page = await provider.search(sources[0].id, '', new AbortController().signal);
    expect(page.rows.length).toBe(50);
  });

  it('narrows several mappings to those whose fixture key is the mapped column', async () => {
    const both = { ...customer, fields: [{ id: 'ID', type: 'string', mappings: [
      { source: 'northwind-sqlite', collection: 'Customers', column: 'CustomerID' },
      { source: 'northwind-sqlite', collection: 'Orders', column: 'CustomerID' },
    ] }, customer.fields[1]] };
    entity.mockReturnValue(of(both));
    execute.mockImplementation((request: QueryDispatchRequest) => {
      const collection = (request.parameters?.['collection'] as { value: string } | undefined)?.value;
      return Promise.resolve(pragma(collection === 'Orders'
        ? [['OrderID', 'integer', 1], ['CustomerID', 'nchar(5)', 0]]
        : [['CustomerID', 'nchar(5)', 1], ['CompanyName', 'text', 0]]));
    });
    const service = TestBed.inject(PublicParameterLookupService);
    const context = { projectRef: ref, hostConnectionId: 'northwind-sqlite' };
    const sources = await service.sources(param, context);
    expect(sources.map((s) => s.collection)).toEqual(['Customers', 'Orders']);
    const provider = service.provider(param, context, sources, both);
    expect(provider.preselectedSourceId).toBeUndefined();
    const prepared = await provider.prepare?.(new AbortController().signal);
    if (!prepared) throw new Error('Expected a prepare step');
    expect(prepared.sources).toEqual([{ id: sources[0].id, label: 'Customers · northwind-sqlite' }]);
    expect(prepared.preselectedSourceId).toBe(sources[0].id);
    execute.mockImplementation(() => Promise.resolve(pragma([['OrderID', 'integer', 1]])));
    const fresh = TestBed.inject(PublicParameterLookupService);
    const none = await fresh.provider(param, { projectRef: { ...ref, projectId: 'x' } }, sources, both).prepare?.(new AbortController().signal);
    if (!none) throw new Error('Expected a prepare step');
    expect(none.sources).toEqual([]);
    expect(none.unavailable).toContain('No table can be used for this lookup');
  });

  it('subjects the dialog with the entity title and leaves the choice open between several sources', async () => {
    const service = TestBed.inject(PublicParameterLookupService);
    const sources = await service.sources(param, { projectRef: ref });
    const twice = [sources[0], { ...sources[0], id: 'other', connection: { ...sources[0].connection, id: 'other' } }];
    const provider = service.provider(param, { projectRef: ref }, twice, { ...customer, title: 'Client' });
    expect(provider.subject).toBe('Client');
    expect(provider.preselectedSourceId).toBeUndefined();
    expect(service.provider({ id: 'p', type: 'string' }, { projectRef: ref }, twice, undefined).subject).toBe('p');
  });
});

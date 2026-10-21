import {
  createHostedDemoDbQuery,
  withHostedDemoDbSource,
} from './hosted-demo-db-query';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
  UnsupportedQueryContractError,
} from './project-query-contract';
import {
  QueryType,
  type IHttpQueryRequest,
  type ISqlQueryRequest,
} from '../models/definition/query-def';
import type { ProjectQueryReadWire, ProjectQueryWire } from './project-query-contract';

function asReadWire(wire: ProjectQueryWire): ProjectQueryReadWire {
  return { ...wire };
}

describe('common project query contract', () => {
  it('retains creation dates on reads without sending store-owned metadata on saves', () => {
    const wire = { ...toProjectQueryWire(createHostedDemoDbQuery('q')), createdAt: '2026-10-21T12:00:00Z' };
    const read = fromProjectQueryWire(wire);
    expect(read.createdAt).toBe(wire.createdAt);
    expect(toProjectQueryWire(read)).not.toHaveProperty('createdAt');
    expect(read.createdAt).toBe(wire.createdAt);
  });
  it.each(['chinook.Customer', 'adventureworks.Person.Person'])(
    'round-trips complete %s source and DTQL body',
    (source) => {
      const query = withHostedDemoDbSource(
        createHostedDemoDbQuery('test'),
        source,
      );
      const wire = toProjectQueryWire(query);
      expect(wire.folderPath).toBe('~');
      expect(wire.type).toBe(QueryType.DTQL);
      expect(fromProjectQueryWire(asReadWire(wire))).toEqual(query);
      expect(wire.federation).not.toBe(query.federation);
    },
  );
  it('preserves SQL newlines, empty body and folder location', () => {
    const query = {
      id: 'q',
      title: 'SQL',
      request: { queryType: QueryType.SQL, text: '\nSELECT 1;\n' } as ISqlQueryRequest,
    };
    expect(toProjectQueryWire(query, 'folder/q')).toMatchObject({
      folderPath: 'folder',
      id: 'q',
      text: '\nSELECT 1;\n',
    });
    expect(
      toProjectQueryWire({
        ...query,
        request: { queryType: QueryType.SQL, text: '' } as ISqlQueryRequest,
      }).text,
    ).toBe('');
  });
  it('round-trips the saved SQL project connection ID', () => {
    const query = {
      id: 'chinook-customer-genre-mix',
      connectionId: 'chinook-sqlite',
      request: { queryType: QueryType.SQL, text: 'SELECT Genre FROM Genre' } as ISqlQueryRequest,
    };
    const wire = toProjectQueryWire(query, 'demodb/chinook-customer-genre-mix');
    expect(wire.connectionId).toBe('chinook-sqlite');
    expect(fromProjectQueryWire(asReadWire(wire))).toEqual(query);
  });
  it('preserves a saved relationship pin on read and refuses a lossy project-query save', () => {
    const relationshipBindings = [
      {
        id: 'FK_Invoice_Customer_CustomerId',
        version:
          'fixture:main.Invoice.CustomerId:INTEGER->main.Customer.CustomerId:INTEGER:PRIMARY_KEY:v1',
        from: { schema: 'main', table: 'Invoice' },
        to: { schema: 'main', table: 'Customer' },
        pairs: [{ fromField: 'CustomerId', toField: 'CustomerId' }],
      },
    ];
    const wire = {
      folderPath: 'customers',
      id: 'customer-invoices-joined',
      type: QueryType.DTQL,
      text: 'from Invoice as i',
      connectionId: 'chinook-sqlite',
      relationshipBindings,
    };
    const definition = fromProjectQueryWire(wire);
    expect(definition.relationshipBindings).toEqual(relationshipBindings);
    expect(() =>
      toProjectQueryWire(definition, 'customers/customer-invoices-joined'),
    ).toThrow(UnsupportedQueryContractError);
  });
  it('refuses a definition whose leaf ID disagrees with the requested location', () => {
    expect(() =>
      toProjectQueryWire(createHostedDemoDbQuery('other'), 'folder/q'),
    ).toThrow(UnsupportedQueryContractError);
    expect(() =>
      toProjectQueryWire(createHostedDemoDbQuery('folder/q'), 'folder/q'),
    ).toThrow(UnsupportedQueryContractError);
  });
  it.each([
    'bounds',
    'expectedServerIdentity',
    'expectedSourceRights',
    'nativeGraph',
    'readReceipt',
  ])('refuses richer federation %s without changing the draft', (key) => {
    const query = createHostedDemoDbQuery('q');
    const federation = query.federation;
    if (!federation) throw new Error('Expected hosted federation metadata.');
    const enriched = {
      ...query,
      federation: { ...federation, [key]: {} },
    };
    const before = JSON.stringify(enriched);
    expect(() => toProjectQueryWire(enriched)).toThrow(
      UnsupportedQueryContractError,
    );
    expect(JSON.stringify(enriched)).toBe(before);
  });
  it('refuses unsupported HTTP and asset fields rather than stripping them', () => {
    expect(() =>
      toProjectQueryWire({
        id: 'q',
        request: { queryType: QueryType.HTTP, url: '/foo', method: 'GET' } as IHttpQueryRequest,
      }),
    ).toThrow(UnsupportedQueryContractError);
    expect(() =>
      toProjectQueryWire({ ...createHostedDemoDbQuery('q'), parameters: [] }),
    ).toThrow(UnsupportedQueryContractError);
  });
});

it('preserves richer legacy read metadata instead of silently dropping it into a supported save', () => {
  const wire = {
    folderPath: 'customers',
    id: 'query',
    type: QueryType.SQL,
    text: 'select 1',
    parameters: [{ id: 'customer' }],
    customMetadata: { source: 'legacy' },
  };
  const definition = fromProjectQueryWire(wire);
  expect(definition).toMatchObject({
    parameters: wire.parameters,
    customMetadata: wire.customMetadata,
  });
  expect(() => toProjectQueryWire(definition, 'customers/query')).toThrow(
    'cannot preserve',
  );
});

it('preserves legacy request-specific fields on read and refuses a lossy write', () => {
  const wire = {
    id: 'q',
    folderPath: '~',
    type: QueryType.SQL,
    text: 'body from sidecar',
    request: {
      queryType: QueryType.SQL,
      text: 'old body',
      dbCatalog: 'legacy',
      custom: true,
    },
  };
  const def = fromProjectQueryWire(wire);
  expect(def.request).toMatchObject({
    text: 'body from sidecar',
    dbCatalog: 'legacy',
    custom: true,
  });
  expect(() => toProjectQueryWire(def)).toThrow(UnsupportedQueryContractError);
});

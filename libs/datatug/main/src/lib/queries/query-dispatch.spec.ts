import { QueryType, type IQueryDef } from '../models/definition/query-def';
import type { QueryDispatchRequest } from './query-dispatch';
import { resolveQueryDispatchPlan } from './query-dispatch';

const definition = (overrides: Partial<IQueryDef> = {}): IQueryDef => ({
  id: 'reports/by-region',
  title: 'By region',
  connectionId: 'customer-ledger-v2',
  request: { queryType: QueryType.SQL, text: 'select Region from Account' } as import('../models/definition/query-def').ISqlQueryRequest,
  ...overrides,
});

const request = (overrides: Partial<QueryDispatchRequest> = {}): QueryDispatchRequest => ({
  projectRef: { storeId: 'github.com', projectId: 'acme/ledger', branch: 'feature/ledger' },
  definition: definition(),
  environment: 'qa',
  ...overrides,
});

const catalog = {
  connections: [{
    id: 'customer-ledger-v2', storage: 'sqlite', source: 'warehouse',
    environment: 'qa', fixtureSha256: 'a'.repeat(64),
    browserFixture: { url: 'https://fixtures.example.test/account.sqlite', bytes: 128 },
  }],
};

describe('query dispatch planning', () => {
  it('selects a pinned browser fixture for an arbitrary connection ID in the selected environment', () => {
    expect(resolveQueryDispatchPlan(request(), catalog).target).toEqual({ kind: 'browser-sqlite' });
  });

  it('rejects missing and ambiguous connection declarations', () => {
    expect(() => resolveQueryDispatchPlan(request(), undefined)).toThrow(/missing from this project/u);
    expect(() => resolveQueryDispatchPlan(request(), { connections: [...catalog.connections, ...catalog.connections] })).toThrow(/ambiguous/u);
  });

  it('rejects a descriptor outside the selected environment', () => {
    expect(() => resolveQueryDispatchPlan(request({ environment: 'prod' }), catalog)).toThrow(/unavailable in this environment/u);
  });

  it('requires an explicit target when the catalog does not declare a browser runtime', () => {
    expect(() => resolveQueryDispatchPlan(request(), { connections: [{ id: 'customer-ledger-v2', storage: 'sqlite' }] })).toThrow(/Choose a supported execution target/u);
  });

  it('does not let an explicit target silently fall back to the catalog runtime', () => {
    expect(() => resolveQueryDispatchPlan(request({ target: { kind: 'hosted-cloud' } }), catalog)).toThrow(/shared cloud project/u);
  });

  it('keeps a saved federation plan ahead of catalog inference and rejects a conflicting target', () => {
    const federated = definition({
      federation: { ovdbBaseUrl: 'https://db.example', tables: [] },
    });
    expect(resolveQueryDispatchPlan(request({ definition: federated }), catalog).target).toEqual({ kind: 'ovdb-federation' });
    expect(() => resolveQueryDispatchPlan(request({ definition: federated, target: { kind: 'browser-sqlite' } }), catalog)).toThrow(/admitted federation/u);
  });

  it('rejects sending a GitHub branch definition to an unrelated or revision-unaware local agent', () => {
    expect(() => resolveQueryDispatchPlan(request({
      queryId: 'queries/folder/query',
      environment: 'qa',
      securityContextId: 'principal-1',
      target: { kind: 'local-agent', agentStoreId: 'localhost:8989' },
    }), catalog)).toThrow(/local agent cannot bind/u);
  });
});

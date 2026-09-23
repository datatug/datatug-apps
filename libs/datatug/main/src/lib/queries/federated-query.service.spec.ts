import { afterEach, describe, expect, it, vi } from 'vitest';
import { FederatedQueryService } from './federated-query.service';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

describe('federated query worker boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fails clearly when workers are unavailable instead of running an unbounded query on the UI thread', async () => {
    vi.stubGlobal('Worker', undefined);
    const service = new FederatedQueryService();
    const definition = { id: 'query', title: 'Query', request: { queryType: QueryType.DTQL, text: '{}' } } as IQueryDef;
    await expect(service.run(definition)).rejects.toThrow(/does not support query workers/);
  });
});

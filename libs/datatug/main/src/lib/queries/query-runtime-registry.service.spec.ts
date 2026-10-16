import type { OvdbConnection } from '../ovdb/ovdb-connection';
import type { QueryConnectionDescriptor } from './query-dispatch';
import { QueryRuntimeRegistry } from './query-runtime-registry.service';

describe('QueryRuntimeRegistry URL identity', () => {
  it('never reuses a registration ID after the registry is recreated', () => {
    const sha = 'a'.repeat(64);
    const connection = { title: 'Edited copy', descriptor: {
      canonical: { sha256: sha }, capabilities: { query: true },
    } } as OvdbConnection;
    const declaration = { fixtureSha256: sha } as QueryConnectionDescriptor;
    const first = new QueryRuntimeRegistry();
    const staleId = first.register(connection).selectionId;
    const restarted = new QueryRuntimeRegistry();
    const freshId = restarted.register(connection).selectionId;
    expect(freshId).not.toBe(staleId);
    expect(restarted.resolve(staleId, declaration)).toBeUndefined();
    expect(restarted.resolve(freshId, declaration)).toBe(connection);
  });
});

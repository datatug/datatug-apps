import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProjectContinuationService, matchingDemoConnection } from './demo-project-continuation.service';
import { demoSqliteCatalog } from '../../queries/demo-sqlite-catalog';
const source = { kind: 'github-project' as const, repositoryID: 42, owner: 'datatug', name: 'demo', folder: 'demo-project-1', branch: 'main', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
const intent = { dataset: 'Chinook', canonicalSha256: demoSqliteCatalog.chinook.sha256, table: 'Artist', source };
const destination = { storeId: 'github.com', projectId: 'repo@owner@folder', projectApi: 'cloud' as const, branch: 'main' };
beforeEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
describe('private edited demo continuation', () => {
  it('restores canonical intent and binds one actor, immutable source, operation and destination', () => {
    const first = new DemoProjectContinuationService();
    const token = first.create(intent);
    expect(first.bind(token, 'actor', source, 'operation', destination)?.dataset).toBe('chinook');
    const reloaded = new DemoProjectContinuationService();
    expect(reloaded.find('actor', 'operation', source)).toBe(token);
    expect(reloaded.read(token)).toMatchObject({ table: 'Artist', destination });
    expect(reloaded.bind(token, 'another', source, 'operation')).toBeUndefined();
    expect(reloaded.bind(token, 'actor', { ...source, commit: 'c'.repeat(40) }, 'operation')).toBeUndefined();
    expect(reloaded.bind(token, 'actor', source, 'different')).toBeUndefined();
    expect(reloaded.bind(token, 'actor', source, 'operation', { ...destination, branch: 'other' })).toBeUndefined();
    expect(JSON.stringify(reloaded.read(token))).not.toContain('runtime-');
  });
  it('keeps memory continuation when browser storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { setItem: () => { throw Error('denied'); }, getItem: () => { throw Error('denied'); }, get length() { throw Error('denied'); } });
    const service = new DemoProjectContinuationService();
    const token = service.create(intent);
    service.bind(token, 'actor', source, 'operation');
    expect(service.find('actor', 'operation', source)).toBe(token);
    expect(new DemoProjectContinuationService().read(token)).toBeUndefined();
  });
  it('requires exactly one matching copied catalog declaration and original SHA', () => {
    const connection = { id: 'chinook-sqlite', dataset: 'chinook', storage: 'sqlite', fixtureSha256: intent.canonicalSha256 };
    const canonical = { ...intent, dataset: 'chinook' };
    expect(matchingDemoConnection(canonical, [connection])).toBe(connection);
    expect(() => matchingDemoConnection(canonical, [])).toThrow('no unique');
    expect(() => matchingDemoConnection(canonical, [connection, connection])).toThrow('no unique');
    expect(() => matchingDemoConnection(canonical, [{ ...connection, fixtureSha256: '0'.repeat(64) }])).toThrow('no unique');
  });
});

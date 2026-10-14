import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROJECT_REF, parseProjectUrl } from '../nav/github-project-address';
import { CHINOOK_SCHEMA } from './chat.types';
import { CHINOOK_FIXTURE_VERSION, ChinookChatDataService } from './chinook-chat-data.service';

const fixture = JSON.parse(readFileSync(resolve('apps/datatug-app/src/assets/chinook-full.json'), 'utf8')) as {
  version: string;
  tables: Record<string, Record<string, unknown>[]>;
};

describe('the advertised Chinook demo Chat uses the real bundled fixture', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('seeds all eleven tables for the canonical route and runs a deterministic bounded query', async () => {
    const address = parseProjectUrl('/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/chat');
    if (!address.ok) throw new Error('The advertised demo route is invalid.');
    expect(address).toMatchObject(DEMO_PROJECT_REF);
    expect(fixture.version).toBe(CHINOOK_FIXTURE_VERSION);
    expect(CHINOOK_SCHEMA.tables).toHaveLength(11);
    const service = new ChinookChatDataService();
    await service.ensureSeed(address.storeId, address.projectId);
    const scope = `${address.storeId}:${address.projectId}`;
    for (const table of CHINOOK_SCHEMA.tables) {
      const result = await service.query(scope, JSON.stringify({
        from: { schema: table.schema, name: table.name }, limit: 1,
      }));
      expect(result.rows, table.name).toHaveLength(1);
    }
    const result = await service.query(scope, JSON.stringify({
      from: { schema: 'main', name: 'Customer' }, orderBy: [{ field: 'CustomerId' }], limit: 3,
    }));
    expect(result.rows).toEqual(fixture.tables['Customer'].slice(0, 3));
    await service.ensureSeed(address.storeId, address.projectId);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('assets/chinook-full.json');
    await expect(service.query('other:project', '{"from":{"name":"Customer"},"limit":1}'))
      .rejects.toThrow(/project changed/);
  }, 30_000);

  it.each([
    ['localhost:8989', 'datatug-demo-project'],
    ['github', DEMO_PROJECT_REF.projectId],
  ])('keeps the supported trial at %s / %s working', async (storeId, projectId) => {
    const service = new ChinookChatDataService();
    await service.ensureSeed(storeId, projectId);
    const result = await service.query(`${storeId}:${projectId}`, JSON.stringify({ from: { name: 'Customer' }, limit: 1 }));
    expect(result.rows).toHaveLength(1);
  }, 30_000);

  it.each([
    ['github.com', 'chinook-demo@datatug@'],
    ['github.com', 'chinook-demo@other@'],
    ['github.com', 'chinook-demo@datatug@folder'],
    ['github.com', 'chinook-demo@datatug@@v1'],
    ['github.com', 'chinook-demo'],
    ['other-store', DEMO_PROJECT_REF.projectId],
  ])('refuses a different project at %s / %s before fetching data', async (storeId, projectId) => {
    await expect(new ChinookChatDataService().ensureSeed(storeId, projectId)).rejects.toThrow(/only for the Chinook demo/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

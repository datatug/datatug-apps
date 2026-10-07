import { describe, expect, it, vi } from 'vitest';
import { runFederatedQuery } from './federated-query-executor';
import { QueryType, type IQueryDef } from '../models/definition/query-def';

const definition: IQueryDef = {
  id: 'artist-tracks', title: 'Artist tracks',
  request: { queryType: QueryType.DTQL, text: JSON.stringify({
    from: { database: 'music', name: 'Artist', alias: 'artist', joins: [{
      from: { database: 'music', name: 'Album', alias: 'album', joins: [{
        from: { database: 'music', name: 'Track', alias: 'track' },
        on: [{ left: { field: 'AlbumId', source: 'album' }, op: '==', right: { field: 'AlbumId', source: 'track' } }],
      }] },
      on: [{ left: { field: 'ArtistId', source: 'artist' }, op: '==', right: { field: 'ArtistId', source: 'album' } }],
    }] },
    groupBy: [{ field: 'ArtistId', source: 'artist' }, { field: 'Name', source: 'artist' }],
    columns: [{ field: 'ArtistId', source: 'artist' }, { field: 'Name', source: 'artist', as: 'Artist' },
      { aggregate: { function: 'count', args: [{ field: 'TrackId', source: 'track' }] }, as: 'TrackCount' }],
    limit: 10,
  }) },
  federation: { ovdbBaseUrl: 'https://ovdb.example.test', tables: [
    { database: 'music', name: 'Artist', fields: ['ArtistId', 'Name'] },
    { database: 'music', name: 'Album', fields: ['AlbumId', 'ArtistId'] },
    { database: 'music', name: 'Track', fields: ['TrackId', 'AlbumId'] },
  ] },
  recordsets: [{ columns: [{ name: 'ArtistId', type: 'integer' }, { name: 'Artist', type: 'string' },
    { name: 'TrackCount', type: 'integer' }] }],
} as unknown as IQueryDef;

const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('same-database DALgo query streaming', () => {
  it('routes a schema-qualified three-table aggregate as one complete YAML request', async () => {
    const yaml = `from:
  database: music
  schema: chinook
  name: Artist
  alias: artist
  joins:
    - from:
        database: music
        schema: chinook
        name: Album
        alias: album
        joins:
          - from: {database: music, schema: chinook, name: Track, alias: track}
            on: [{left: {field: AlbumId, source: album}, op: '==', right: {field: AlbumId, source: track}}]
      on: [{left: {field: ArtistId, source: artist}, op: '==', right: {field: ArtistId, source: album}}]
groupBy: [{field: ArtistId, source: artist}, {field: Name, source: artist}]
columns:
  - {field: Name, source: artist, as: Artist}
  - {aggregate: {function: count, args: [{field: TrackId, source: track}]}, as: TrackCount}
  - {aggregate: {function: sum, args: [{field: Milliseconds, source: track}]}, as: TotalMilliseconds}
limit: 10`;
    const saved = { ...definition, request: { queryType: QueryType.DTQL, text: yaml },
      federation: { ...definition.federation, tables: definition.federation?.tables.map((table) =>
        ({ ...table, schema: 'chinook', fields: table.name === 'Track' ? [...table.fields, 'Milliseconds'] : table.fields })) },
      recordsets: [{ columns: [{ name: 'Artist', type: 'string' }, { name: 'TrackCount', type: 'integer' },
        { name: 'TotalMilliseconds', type: 'integer' }] }],
    } as IQueryDef;
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      return String(input).endsWith('/music')
        ? json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } })
        : json({ records: [{ data: { Artist: 'Iron Maiden', TrackCount: '213', TotalMilliseconds: '71844745' } }],
          columns: ['Artist', 'TrackCount', 'TotalMilliseconds'], execution: {}, complete: true });
    });
    const result = await runFederatedQuery(saved, undefined, '', undefined, undefined, 'full', undefined, undefined,
      { fetch: fetcher, onNativeRecord: async () => undefined });
    expect(calls).toHaveLength(2);
    expect(calls[1].init?.body).toBe(yaml);
    expect(result.recordset.rows[0]).toEqual([
      { type: 'string', value: 'Iron Maiden' }, { type: 'integer', value: '213' },
      { type: 'integer', value: '71844745' },
    ]);
  });

  it('routes an unqualified single collection through its one unambiguous configured database', async () => {
    const single = { ...definition,
      request: { queryType: QueryType.DTQL, text: JSON.stringify({ from: { name: 'Artist' }, limit: 2 }) },
      federation: { ovdbBaseUrl: 'https://ovdb.example.test', tables: [{ database: 'music', name: 'Artist', fields: ['ArtistId', 'Name'] }] },
      recordsets: [{ columns: [{ name: 'ArtistId', type: 'integer' }, { name: 'Name', type: 'string' }] }],
    } as unknown as IQueryDef;
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return String(input).endsWith('/music')
        ? json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } })
        : json({ records: [{ key: '1', data: { ArtistId: '1', Name: 'Alpha' } }], complete: true });
    });
    const result = await runFederatedQuery(single, undefined, '', undefined, undefined, 'full', undefined, undefined, { fetch: fetcher });
    expect(urls).toEqual(['https://ovdb.example.test/v1/databases/music', 'https://ovdb.example.test/v1/databases/music/dtql']);
    expect(result.recordset.columns.map((column) => column.name)).toEqual(['ArtistId', 'Name']);
    expect(result.recordset.rows[0][0]).toEqual({ type: 'integer', value: '1' });
  });

  it('sends one complete DTQL POST, stages a first record before EOF, and preserves declared integer types', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith('/music')) return json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } });
      return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
    });
    const first = vi.fn();
    let settled = false;
    const run = runFederatedQuery(definition, undefined, 'in-memory-token', undefined, undefined, 'full', undefined, undefined,
      { fetch: fetcher, onNativeRecord: first });
    void run.finally(() => { settled = true; });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe('https://ovdb.example.test/v1/databases/music/dtql');
    expect(calls[1].init?.body).toBe((definition.request as unknown as { text: string }).text);
    expect(new Headers(calls[1].init?.headers).get('Authorization')).toBe('Bearer in-memory-token');
    body.enqueue(new TextEncoder().encode('{"records":[{"data":{"ArtistId":"42","Artist":"Alpha","TrackCount":"213"}}'));
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    body.enqueue(new TextEncoder().encode('],"columns":["ArtistId","Artist","TrackCount"],"execution":{"route":"database"},"complete":true}'));
    body.close();
    const result = await run;
    expect(result.nativeStream).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.recordset.rows[0]).toEqual([
      { type: 'integer', value: '42' }, { type: 'string', value: 'Alpha' }, { type: 'integer', value: '213' },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('rejects a late truncated stream and never fetches leaf tables as a fallback', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/music')
      ? json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } })
      : new Response('{"records":[{"data":{"ArtistId":"42"}}', { headers: { 'Content-Type': 'application/json' } }));
    await expect(runFederatedQuery(definition, undefined, '', undefined, undefined, 'full', undefined, undefined,
      { fetch: fetcher, onNativeRecord: async () => undefined })).rejects.toThrow(/terminal footer/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not turn an unsupported native query into browser table scans', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/music')
      ? json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } })
      : new Response('{"error":{"code":"unsupported"}}', { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(runFederatedQuery(definition, undefined, '', undefined, undefined, 'full', undefined, undefined,
      { fetch: fetcher })).rejects.toThrow(/whole-query execution failed \(422\)/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requires a paged sink rather than buffering an unlimited direct result', async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({ data: { ArtistId: String(index) } }));
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/music')
      ? json({ id: 'music', capabilities: { dtql: true, dtqlStreaming: true } })
      : json({ records, columns: ['ArtistId'], execution: {}, complete: true }));
    await expect(runFederatedQuery(definition, undefined, '', undefined, undefined, 'full', undefined, undefined,
      { fetch: fetcher })).rejects.toThrow(/paged result sink/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

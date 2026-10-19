import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runFederatedQuery } from './federated-query-executor';
import { preflightSourceRights } from './federated-source-rights';
import { readOvdbOrdinaryResult } from './ovdb-ordinary-result';
import {
  readOvdbEarlyError,
  readOvdbJsonRecordStream,
} from './ovdb-json-record-stream';
import { boundedResponseBytes } from './public-data/bounded-response';
import { executePublishedCountryCounts } from './public-data/public-country-count-admission';
import { fetchOrdersRightsPublication } from './public-data/public-orders-admission';
import {
  QueryType,
  type IQueryDef,
  type ITextQueryRequest,
} from '../models/definition/query-def';

const fixture = (name: string) =>
  readFileSync(resolve('apps/datatug-app/e2e/fixtures', name));
const publication = fixture('northwind-country-count-rights.json');
const countryQuery = (
  JSON.parse(publication.toString()) as { admission: { query: string } }
).admission.query;
const orders = JSON.parse(
  fixture('northwind-orders-records.json').toString(),
) as { ShipCountry: string }[];
const countryNames = [...new Set(orders.map((row) => row.ShipCountry))].sort();
const counts = JSON.stringify({
  complete: true,
  columns: ['ShipCountry', 'orders'],
  records: countryNames.map((ShipCountry) => ({
    data: {
      ShipCountry,
      orders: orders.filter((row) => row.ShipCountry === ShipCountry).length,
    },
  })),
  execution: {
    rowsReturned: 21,
    sources: [{ database: 'northwind', collection: 'Orders' }],
  },
});
const json = (body: string | Uint8Array) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: { 'Content-Type': 'application/json' },
  });
const definition: IQueryDef = {
  id: 'artists',
  title: 'Artists',
  request: {
    queryType: QueryType.DTQL,
    text: JSON.stringify({
      from: { database: 'music', name: 'Artist' },
      limit: 2,
    }),
  } as ITextQueryRequest,
  federation: {
    ovdbBaseUrl: 'https://ovdb.example.test',
    tables: [{ database: 'music', name: 'Artist', fields: ['ArtistId'] }],
  },
  recordsets: [
    { name: 'Artists', columns: [{ name: 'ArtistId', type: 'integer' }] },
  ],
};
interface ReaderCase {
  name: string;
  valid: string | Uint8Array;
  maximum: number;
  errorIsMapped?: boolean;
  run(response: Response, signal?: AbortSignal): Promise<unknown>;
}
const readers: ReaderCase[] = [
  ...(['publication', 'countries POST'] as const).map(
    (part): ReaderCase => ({
      name: 'country-count ' + part,
      valid: part === 'publication' ? publication : counts,
      maximum: 65536,
      async run(response, signal) {
        let calls = 0;
        const result = await executePublishedCountryCounts(countryQuery, {
          signal,
          fetch: async () => {
            calls++;
            return calls === 1
              ? part === 'publication'
                ? response
                : json(publication)
              : part === 'countries POST'
                ? response
                : json(counts);
          },
        });
        expect(calls).toBe(2);
        expect(result.totalOrders).toBe(830);
        return result;
      },
    }),
  ),
  {
    name: 'Orders rights GET',
    valid: fixture('northwind-orders-rights.json'),
    maximum: 65536,
    run: (response, signal) =>
      fetchOrdersRightsPublication({ signal, fetch: async () => response }),
  },
  {
    name: 'native capability GET',
    valid: JSON.stringify({
      id: 'music',
      capabilities: { dtql: true, dtqlStreaming: true },
    }),
    maximum: 1048576,
    async run(response, signal) {
      const fetcher = vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith('/music')
          ? response
          : json(
              '{"records":[{"data":{"ArtistId":"1"}}],"columns":["ArtistId"],"execution":{},"complete":true}',
            ),
      );
      const result = await runFederatedQuery(
        definition,
        undefined,
        '',
        undefined,
        signal,
        'full',
        undefined,
        undefined,
        { fetch: fetcher },
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      return result;
    },
  },
  {
    name: 'source terms GET',
    valid: '{}',
    maximum: 1048576,
    run: (response, signal) =>
      preflightSourceRights(
        'https://ovdb.example.test',
        [{ database: 'music', name: 'Artist' }],
        async () => response,
        {},
        signal,
        undefined,
        undefined,
        'fixture-server',
      ),
  },
  {
    name: 'ordinary result',
    valid:
      '{"records":[{"data":{"id":1}}],"columns":["id"],"execution":{},"complete":true}',
    maximum: 8 * 1024 * 1024,
    run: readOvdbOrdinaryResult,
  },
  {
    name: 'mapped early error',
    valid: '{"error":{"code":"query_failed","message":"Readable failure"}}',
    maximum: 16384,
    errorIsMapped: true,
    run: readOvdbEarlyError,
  },
  {
    name: 'JSON record stream',
    valid:
      '{"records":[{"data":{"id":1}}],"columns":["id"],"execution":{},"complete":true}',
    maximum: 256,
    run: (response, signal) =>
      readOvdbJsonRecordStream(response, () => undefined, signal, {
        bytes: 256,
        rows: 10,
        recordBytes: 256,
        footerBytes: 256,
      }),
  },
  {
    name: 'shared bounded response',
    valid: '{}',
    maximum: 64,
    run: (response, signal) => boundedResponseBytes(response, 64, signal),
  },
];

function observe(response: Response) {
  const body = response.body;
  if (!body) throw new Error('Missing test response stream');
  const reader = body.getReader();
  const cancel = vi.spyOn(reader, 'cancel');
  const release = vi.spyOn(reader, 'releaseLock');
  vi.spyOn(body, 'getReader').mockReturnValue(reader);
  return { reader, cancel, release };
}

describe.each(readers)('$name reader ownership', (entry) => {
  it('releases a fully consumed response without cancelling it', async () => {
    const response = json(entry.valid);
    const watched = observe(response);
    await entry.run(response);
    expect(watched.cancel).not.toHaveBeenCalled();
    expect(watched.release).toHaveBeenCalledOnce();
  });

  it.each(['oversize', 'error', 'abort'] as const)(
    'cancels an incomplete %s body and releases its lock',
    async (failure) => {
      const controller = new AbortController();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            if (failure === 'error') stream.error(new Error('reader failed'));
            else
              stream.enqueue(
                new Uint8Array(
                  failure === 'oversize' ? entry.maximum + 1 : 1,
                ).fill(32),
              );
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
      const watched = observe(response);
      if (failure === 'abort') {
        const read = watched.reader.read.bind(watched.reader);
        vi.spyOn(watched.reader, 'read').mockImplementation(async () => {
          const part = await read();
          controller.abort(new DOMException('Scope changed', 'AbortError'));
          return part;
        });
      }
      const result = entry.run(response, controller.signal);
      if (entry.errorIsMapped && failure !== 'abort')
        expect(await result).toBeUndefined();
      else await expect(result).rejects.toThrow();
      await vi.waitFor(() => expect(watched.release).toHaveBeenCalledOnce());
      expect(watched.cancel).toHaveBeenCalled();
    },
  );
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CountriesRoutingBudget,
  configureCountriesRouting,
  consumeCountriesOnce,
  countriesEndpoint,
} from '../../e2e/helpers/showcase-routing-ab';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve('apps/datatug-app/e2e/fixtures', name), 'utf8'),
  );
const query = (
  fixture('northwind-country-count-rights.json') as {
    admission: { query: string };
  }
).admission.query;
const orders = fixture('northwind-orders-records.json') as {
  ShipCountry: string;
}[];
const data = [...new Set(orders.map((row) => row.ShipCountry))]
  .sort()
  .map((ShipCountry) => ({
    ShipCountry,
    orders: orders.filter((row) => row.ShipCountry === ShipCountry).length,
  }));
const envelope = {
  complete: true,
  columns: ['ShipCountry', 'orders'],
  records: data.map((row) => ({ data: row })),
  execution: {
    rowsReturned: 21,
    sources: [{ database: 'northwind', collection: 'Orders' }],
  },
};
afterEach(() => vi.unstubAllGlobals());
function inertOrigin() {
  vi.stubGlobal('origin', 'https://datatug.app');
  vi.stubGlobal('location', {
    origin: 'https://datatug.app',
    pathname: '/assets/icon/favicon.png',
    search: '',
    hash: '',
  });
  vi.stubGlobal('document', {
    contentType: 'image/png',
    scripts: { length: 0 },
  });
}
function watch(response: Response) {
  const body = response.body;
  if (!body) throw new Error('Missing test body');
  const reader = body.getReader();
  vi.spyOn(body, 'getReader').mockReturnValue(reader);
  return {
    read: vi.spyOn(reader, 'read'),
    cancel: vi.spyOn(reader, 'cancel'),
    release: vi.spyOn(reader, 'releaseLock'),
    clone: vi.spyOn(response, 'clone'),
    json: vi.spyOn(response, 'json'),
  };
}

describe('two-call routing A/B protection without network', () => {
  it('authorizes only the exact saved query in OFF then ON order, at most twice', () => {
    const budget = new CountriesRoutingBudget();
    expect(() => budget.claim('continued', query)).toThrow('guard');
    expect(() => budget.claim('unrouted', query + ' ')).toThrow('guard');
    expect(budget.snapshot()).toEqual([]);
    expect(budget.claim('unrouted', query)).toBe(query);
    expect(() => budget.claim('unrouted', query)).toThrow('guard');
    expect(budget.claim('continued', query)).toBe(query);
    expect(() => budget.claim('continued', query)).toThrow('guard');
    expect(budget.snapshot()).toEqual(['unrouted', 'continued']);
  });

  it('never registers a route in the control and only continues the exact provider route in ON', async () => {
    const route = vi.fn();
    const context = { route } as unknown as BrowserContext;
    await configureCountriesRouting(context, 'unrouted');
    expect(route).not.toHaveBeenCalled();
    await configureCountriesRouting(context, 'continued');
    expect(route).toHaveBeenCalledOnce();
    expect(route.mock.calls[0][0]).toBe(countriesEndpoint);
    const handler = route.mock.calls[0][1] as (r: Route) => Promise<void>;
    const proceed = vi.fn(async () => undefined);
    await handler({ continue: proceed } as unknown as Route);
    expect(proceed).toHaveBeenCalledWith();
  });

  it('uses the same single POST/options/body consumer in both variants, with no response clone or extra body reader', async () => {
    inertOrigin();
    const responses = [
      new Response(JSON.stringify(envelope)),
      new Response(JSON.stringify(envelope)),
    ];
    const watched = responses.map(watch);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1]);
    vi.stubGlobal('fetch', fetch);
    for (let index = 0; index < 2; index++) {
      const result = await consumeCountriesOnce(query);
      expect(result).toMatchObject({
        ok: true,
        eof: true,
        rows: 21,
        totalOrders: 830,
      });
      expect(watched[index].read).toHaveBeenCalledTimes(2);
      expect(watched[index].release).toHaveBeenCalledOnce();
      expect(watched[index].cancel).not.toHaveBeenCalled();
      expect(watched[index].clone).not.toHaveBeenCalled();
      expect(watched[index].json).not.toHaveBeenCalled();
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(countriesEndpoint);
      expect(options).toEqual({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      });
    }
  });

  it.each(['origin', 'query'] as const)(
    'refuses an invalid %s before any fetch',
    async (invalid) => {
      inertOrigin();
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal('fetch', fetch);
      if (invalid === 'origin') vi.stubGlobal('origin', 'null');
      const result = await consumeCountriesOnce(
        invalid === 'query' ? 'secret altered query' : query,
      );
      expect(result).toMatchObject({ ok: false, stage: 'identity' });
      expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/secret|https:|query text/);
    },
  );

  it.each(['oversize', 'reader-error', 'malformed'] as const)(
    'retains sanitized failure and releases the %s consumer',
    async (kind) => {
      inertOrigin();
      const response =
        kind === 'malformed'
          ? new Response('secret malformed content')
          : new Response(
              new ReadableStream<Uint8Array>({
                start(stream) {
                  if (kind === 'reader-error')
                    stream.error(new Error('secret failure message'));
                  else stream.enqueue(new Uint8Array(65537));
                },
              }),
            );
      const watched = watch(response);
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () => response),
      );
      const result = await consumeCountriesOnce(query);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(watched.release).toHaveBeenCalledOnce();
      if (kind === 'malformed') expect(watched.cancel).not.toHaveBeenCalled();
      else expect(watched.cancel).toHaveBeenCalledOnce();
    },
  );
});

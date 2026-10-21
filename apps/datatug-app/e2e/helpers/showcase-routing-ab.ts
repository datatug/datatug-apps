import { createHash } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

export const countriesEndpoint =
  'https://ovdb.demodb.dev/v1/databases/northwind/dtql';
export const inertDocument = 'https://datatug.app/assets/icon/favicon.png';
export const countriesQuerySHA =
  '2e320d487d7bbe7dbfc53abc55c08d12eb80a2e79b34cfe15a2148fa362acc9a';
export type RoutingVariant = 'unrouted' | 'continued';

/** Two authorizations only, consumed even if a variant fails before transmission. */
export class CountriesRoutingBudget {
  private readonly claims: RoutingVariant[] = [];
  claim(variant: RoutingVariant, query: string): string {
    if (
      variant !== (['unrouted', 'continued'] as const)[this.claims.length] ||
      createHash('sha256').update(query).digest('hex') !== countriesQuerySHA
    )
      throw new Error(
        'The two-call Countries routing diagnostic guard refused this call.',
      );
    this.claims.push(variant);
    return query;
  }
  snapshot(): readonly RoutingVariant[] {
    return [...this.claims];
  }
}

/** The control must never register a provider route, including a fallback route. */
export async function configureCountriesRouting(
  context: BrowserContext,
  variant: RoutingVariant,
): Promise<void> {
  if (variant === 'continued')
    await context.route(countriesEndpoint, (route) => route.continue());
}

/** Serialized into an actual datatug.app PNG document. This is the sole body consumer,
 * identical in both variants; passive CDP never reads, clones or replaces the body. */
export async function consumeCountriesOnce(query: string) {
  let stage = 'identity',
    status: number | undefined,
    bytes = 0,
    eof = false;
  const started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (
      globalThis.origin !== 'https://datatug.app' ||
      location.origin !== 'https://datatug.app' ||
      location.pathname !== '/assets/icon/favicon.png' ||
      location.search ||
      location.hash ||
      document.contentType !== 'image/png' ||
      document.scripts.length
    )
      throw new Error('The inert-document identity is unavailable.');
    const hex = async (value: Uint8Array) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new Uint8Array(value)),
        ),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
    if (
      (await hex(new TextEncoder().encode(query))) !==
      '2e320d487d7bbe7dbfc53abc55c08d12eb80a2e79b34cfe15a2148fa362acc9a'
    )
      throw new Error('The exact saved Countries query is required.');
    stage = 'fetch';
    const response = await fetch(
      'https://ovdb.demodb.dev/v1/databases/northwind/dtql',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    status = response.status;
    reader = response.body?.getReader();
    if (response.redirected || !response.ok || !reader)
      throw new Error('Countries response unavailable.');
    stage = 'body';
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        eof = true;
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > 65536)
        throw new Error('Countries response exceeds the 64 KiB bound.');
      chunks.push(part.value);
    }
    stage = 'admission';
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(body),
    ) as {
      complete?: unknown;
      columns?: unknown;
      records?: { data: { ShipCountry: string; orders: number } }[];
      execution?: { rowsReturned?: unknown; sources?: unknown };
    };
    if (
      result.complete !== true ||
      JSON.stringify(result.columns) !== '["ShipCountry","orders"]' ||
      !Array.isArray(result.records) ||
      result.records.length !== 21 ||
      result.execution?.rowsReturned !== 21 ||
      JSON.stringify(result.execution?.sources) !==
        '[{"database":"northwind","collection":"Orders"}]'
    )
      throw new Error(
        'Countries response is incomplete or has a different source.',
      );
    const rows = result.records.map(
      ({ data }) => [data.ShipCountry, data.orders] as const,
    );
    const canonicalSHA = await hex(
      new TextEncoder().encode(JSON.stringify(rows)),
    );
    if (
      canonicalSHA !==
      '10180147a7752d4006c28d438d7deed96461336b865156036c2c017f5c82b235'
    )
      throw new Error(
        'Countries rows differ from the captured canonical source.',
      );
    return {
      ok: true,
      stage: 'complete',
      status,
      bytes,
      eof,
      rows: rows.length,
      totalOrders: rows.reduce((sum, row) => sum + row[1], 0),
      canonicalSHA,
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    const name =
      error && typeof error === 'object' && 'name' in error
        ? error.name
        : undefined;
    return {
      ok: false,
      stage,
      status,
      bytes,
      eof,
      failure:
        typeof name === 'string' &&
        ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(name)
          ? name
          : 'other',
      elapsedMs: performance.now() - started,
    };
  } finally {
    if (reader) {
      if (!eof) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

// @vitest-environment node
// The platform Response, whose body is the stream it was given (as in browsers);
// happy-dom's wraps a stream error into a generic EncodingError.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  CanonicalFetchError,
  CanonicalIntegrityError,
  fetchCanonical,
  type CanonicalPin,
  type DemoDbProgressEvent,
} from '@dalgo/sqlite-wasm/opfs';
import {
  CHUNKED_MANIFEST_FORMAT,
  RATE_LIMITED_MESSAGE,
  createChunkedCanonicalFetch,
  isChunkedManifestUrl,
  parseChunkedManifest,
} from './demodb-chunked-fetch';

// Everything runs against a mocked fetch: no request leaves the test.
const manifestUrl = 'https://adventureworks.demodb.dev/data/adventureworks.sqlite.parts.json';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A small rollback-journal SQLite image: the engine checks the header after decoding. */
function sqliteImage(): Uint8Array {
  const bytes = new Uint8Array(8192);
  bytes.set(new TextEncoder().encode('SQLite format 3\u0000'), 0);
  bytes[18] = 1;
  bytes[19] = 1;
  for (let i = 100; i < bytes.length; i++) bytes[i] = (i * 31) % 251;
  return bytes;
}

function fixture(partCount = 3) {
  const sqlite = sqliteImage();
  const gzip = new Uint8Array(gzipSync(sqlite));
  const size = Math.ceil(gzip.byteLength / partCount);
  const parts = Array.from({ length: partCount }, (_, index) => gzip.subarray(index * size, (index + 1) * size));
  const manifest = {
    format: CHUNKED_MANIFEST_FORMAT,
    file: 'adventureworks.sqlite',
    compression: 'gzip',
    bytes: gzip.byteLength,
    sha256: sha256(gzip),
    uncompressedSha256: sha256(sqlite),
    parts: parts.map((part, index) => ({
      path: `adventureworks.sqlite.gz.part-${index + 1}`,
      bytes: part.byteLength,
      sha256: sha256(part),
    })),
  };
  const pin: CanonicalPin = { dataset: 'adventureworks', url: manifestUrl, sha256: sha256(sqlite), bytes: sqlite.byteLength, compression: 'gzip' };
  return { sqlite, gzip, parts, manifest, pin };
}

type Route = (attempt: number) => Response | Promise<Response>;

/** A fetch that answers from `routes` and records each request and the requests in flight. */
function mockFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const attempts = new Map<string, number>();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      const route = routes[url];
      if (!route) return new Response(null, { status: 404 });
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      return await route(attempt);
    } finally {
      inFlight--;
    }
  });
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

const partUrl = (index: number) => `https://adventureworks.demodb.dev/data/adventureworks.sqlite.gz.part-${index}`;

function routesFor(data: ReturnType<typeof fixture>, manifest: unknown = data.manifest): Record<string, Route> {
  const routes: Record<string, Route> = { [manifestUrl]: () => Response.json(manifest) };
  data.parts.forEach((part, index) => {
    routes[partUrl(index + 1)] = () => new Response(part.slice());
  });
  return routes;
}

/** As in the worker, the engine always reports progress, so it reads the body with a stream reader. */
const noProgress = () => undefined;

function chunkedFetch(fetch: ReturnType<typeof mockFetch>['fetch'], sleep = vi.fn(async () => undefined)) {
  return { sleep, fetch: createChunkedCanonicalFetch({ fetch, sleep, retryDelayMs: 1500 }) };
}

describe('createChunkedCanonicalFetch', () => {
  it('downloads the parts one at a time, verifies them and hands the engine the pinned SQLite file', async () => {
    const data = fixture();
    const network = mockFetch(routesFor(data));
    const progress: DemoDbProgressEvent[] = [];
    const decoded = await fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, (event) => progress.push(event));
    expect(decoded).toEqual(data.sqlite);
    expect(network.calls.map((call) => call.url)).toEqual([manifestUrl, partUrl(1), partUrl(2), partUrl(3)]);
    expect(network.maxInFlight()).toBe(1);
    // Simple CORS requests: no credentials and no request headers that need a preflight.
    for (const call of network.calls) expect(call.init).toEqual({ credentials: 'omit' });
    const fetchEvents = progress.filter((event) => event.phase === 'fetch');
    // The download bar counts the gzip parts against their total.
    expect(fetchEvents.at(-1)).toEqual({ phase: 'fetch', loaded: data.gzip.byteLength, total: data.gzip.byteLength });
    expect(progress.map((event) => event.phase)).toContain('verify');
  });

  it('stops at a part whose SHA-256 differs from the manifest and fetches no later part', async () => {
    const data = fixture();
    const routes = routesFor(data);
    const tampered = data.parts[1].slice();
    tampered[0] ^= 0xff;
    routes[partUrl(2)] = () => new Response(tampered);
    const network = mockFetch(routes);
    const failure = fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress);
    await expect(failure).rejects.toBeInstanceOf(CanonicalIntegrityError);
    await expect(failure).rejects.toThrow(/part 2 .* has SHA-256/u);
    expect(network.calls.map((call) => call.url)).toEqual([manifestUrl, partUrl(1), partUrl(2)]);
  });

  it('rejects a part of the wrong size', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[partUrl(1)] = () => new Response(data.parts[0].subarray(1).slice());
    const network = mockFetch(routes);
    await expect(fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress)).rejects.toThrow(/part 1 .* bytes, expected/u);
  });

  it('rejects parts whose joined gzip differs from the manifest SHA-256', async () => {
    const data = fixture();
    const network = mockFetch(routesFor(data, { ...data.manifest, sha256: 'f'.repeat(64) }));
    const failure = fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress);
    await expect(failure).rejects.toBeInstanceOf(CanonicalIntegrityError);
    await expect(failure).rejects.toThrow(/joined gzip/u);
  });

  it('keeps the catalog pin: verified parts that decode to another SQLite file are refused', async () => {
    const data = fixture();
    const network = mockFetch(routesFor(data));
    const pin = { ...data.pin, sha256: '0'.repeat(64) };
    await expect(fetchCanonical(pin, chunkedFetch(network.fetch).fetch, noProgress)).rejects.toThrow(/canonical file has SHA-256/u);
  });

  it('stops at once on HTTP 429 for a part: no retry and no later part', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[partUrl(2)] = () => new Response(null, { status: 429 });
    const network = mockFetch(routes);
    const { fetch, sleep } = chunkedFetch(network.fetch);
    const failure = fetchCanonical(data.pin, fetch, noProgress);
    await expect(failure).rejects.toBeInstanceOf(CanonicalFetchError);
    await expect(failure).rejects.toMatchObject({ status: 429, message: RATE_LIMITED_MESSAGE });
    expect(network.calls.map((call) => call.url)).toEqual([manifestUrl, partUrl(1), partUrl(2)]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops at once on HTTP 429 for the manifest', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[manifestUrl] = () => new Response(null, { status: 429 });
    const network = mockFetch(routes);
    await expect(fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress)).rejects.toMatchObject({
      name: 'CanonicalFetchError',
      status: 429,
    });
    expect(network.calls).toHaveLength(1);
  });

  it('refuses a manifest of another format before downloading any part', async () => {
    const data = fixture();
    const network = mockFetch(routesFor(data, { ...data.manifest, format: 'demodb-chunked-export/v2' }));
    const failure = fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress);
    await expect(failure).rejects.toBeInstanceOf(CanonicalIntegrityError);
    await expect(failure).rejects.toThrow(/format is "demodb-chunked-export\/v2"/u);
    expect(network.calls.map((call) => call.url)).toEqual([manifestUrl]);
  });

  it('refuses a manifest that is not JSON', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[manifestUrl] = () => new Response('<html>');
    const network = mockFetch(routes);
    await expect(fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress)).rejects.toThrow(/not JSON/u);
  });

  it('retries a part once after a back-off on HTTP 5xx', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[partUrl(2)] = (attempt) => (attempt === 1 ? new Response(null, { status: 503 }) : new Response(data.parts[1].slice()));
    const network = mockFetch(routes);
    const { fetch, sleep } = chunkedFetch(network.fetch);
    await expect(fetchCanonical(data.pin, fetch, noProgress)).resolves.toEqual(data.sqlite);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(network.calls.filter((call) => call.url === partUrl(2))).toHaveLength(2);
  });

  it('gives up after the one retry', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[partUrl(1)] = () => new Response(null, { status: 503 });
    const network = mockFetch(routes);
    await expect(fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress)).rejects.toMatchObject({ status: 503 });
    expect(network.calls.filter((call) => call.url === partUrl(1))).toHaveLength(2);
    expect(network.calls.map((call) => call.url)).not.toContain(partUrl(2));
  });

  it('retries a network error once, then reports it as a download failure', async () => {
    const data = fixture();
    const routes = routesFor(data);
    routes[partUrl(1)] = () => Promise.reject(new TypeError('Failed to fetch'));
    const network = mockFetch(routes);
    const failure = fetchCanonical(data.pin, chunkedFetch(network.fetch).fetch, noProgress);
    await expect(failure).rejects.toBeInstanceOf(CanonicalFetchError);
    expect(network.calls.filter((call) => call.url === partUrl(1))).toHaveLength(2);
  });

  it('passes any other URL to the network unchanged', async () => {
    const network = mockFetch({ 'https://chinook.demodb.dev/data/chinook.sqlite': () => new Response('x') });
    const response = await chunkedFetch(network.fetch).fetch('https://chinook.demodb.dev/data/chinook.sqlite');
    expect(await response.text()).toBe('x');
    expect(network.calls).toEqual([{ url: 'https://chinook.demodb.dev/data/chinook.sqlite', init: undefined }]);
  });
});

describe('parseChunkedManifest', () => {
  const { manifest } = fixture(2);

  it('resolves part paths against the manifest URL', () => {
    expect(parseChunkedManifest(manifest, manifestUrl).parts.map((part) => part.url)).toEqual([partUrl(1), partUrl(2)]);
  });

  it.each([
    ['a non-object', [], /not an object/u],
    ['gzip only', { ...manifest, compression: 'br' }, /compression/u],
    ['the manifest file name', { ...manifest, file: 'other.sqlite' }, /file does not match/u],
    ['a positive size', { ...manifest, bytes: 0 }, /bytes must be/u],
    ['a joined SHA-256', { ...manifest, sha256: 'ABC' }, /sha256 must be/u],
    ['at least one part', { ...manifest, parts: [] }, /parts must list/u],
    ['parts that add up', { ...manifest, bytes: manifest.bytes + 1 }, /do not add up/u],
    ['parts on the same origin', { ...manifest, parts: [{ ...manifest.parts[0], path: 'https://evil.example/x' }, manifest.parts[1]] }, /leaves/u],
    ['relative part paths without a query', { ...manifest, parts: [{ ...manifest.parts[0], path: 'p?x=1' }, manifest.parts[1]] }, /relative file path/u],
    ['part sizes', { ...manifest, parts: [{ ...manifest.parts[0], bytes: -1 }, manifest.parts[1]] }, /parts\[0\]\.bytes/u],
    ['part hashes', { ...manifest, parts: [manifest.parts[0], { ...manifest.parts[1], sha256: null }] }, /parts\[1\]\.sha256/u],
  ])('requires %s', (_label, json, problem) => {
    expect(() => parseChunkedManifest(json, manifestUrl)).toThrow(problem);
  });

  it('recognises manifest URLs only by their .parts.json path', () => {
    expect(isChunkedManifestUrl(manifestUrl)).toBe(true);
    expect(isChunkedManifestUrl('https://chinook.demodb.dev/data/chinook.sqlite')).toBe(false);
    expect(isChunkedManifestUrl('not a url')).toBe(false);
  });
});

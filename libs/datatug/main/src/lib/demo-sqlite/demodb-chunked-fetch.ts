// Downloads a DemoDB dataset that is served as gzip parts (`source: 'chunked'` in
// demo-sqlite-catalog.ts). DemoDB's static hosting caps files at 25 MiB, so a
// larger SQLite file is published only as
//
//   GET https://<id>.demodb.dev/data/<file>.parts.json
//   { "format": "demodb-chunked-export/v1", "file": "<file>", "compression": "gzip",
//     "bytes": <gzip bytes>, "sha256": "<sha256 of the joined gzip>",
//     "uncompressedSha256": "<sha256>" | null,
//     "parts": [{ "path": "<file>.gz.part-1", "bytes": N, "sha256": "..." }, ...] }
//
// with part paths relative to the manifest.
//
// The dataset worker (local-demodb.worker.ts) gives this fetch to
// @dalgo/sqlite-wasm's engine. The engine fetches the pin's `url` (the manifest)
// and, for a `compression: 'gzip'` pin, reads the body as one gzip stream. This
// fetch answers a manifest URL with that stream, built here as:
//
//   manifest (format checked) → each part in order, one at a time → part size and
//   SHA-256 → joined gzip SHA-256 → end of stream
//
// The engine must read the body with its stream reader (it does when it reports progress;
// the worker always gives it a listener) for these errors to keep their class.
//
// Bytes are passed on as they arrive so the download bar moves, but the stream
// only ends successfully after every check above; any failure errors the stream,
// so the engine never decodes (DecompressionStream('gzip')), verifies the pinned
// SQLite SHA-256 of, or stores a file that failed one of them.
//
// Politeness towards DemoDB: no parallel requests, at most one retry per request
// (after a back-off, only for a network error or HTTP 5xx before any byte of the
// part was passed on), and HTTP 429 stops the download at once.
import { CanonicalFetchError, CanonicalIntegrityError } from '@dalgo/sqlite-wasm/opfs';

export const CHUNKED_MANIFEST_FORMAT = 'demodb-chunked-export/v1';
export const CHUNKED_MANIFEST_SUFFIX = '.parts.json';
export const RATE_LIMITED_STATUS = 429;
export const RATE_LIMITED_MESSAGE =
  'DemoDB is limiting downloads right now (HTTP 429). Wait a few minutes, then try again.';

const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_PARTS = 1_000;
const sha256Pattern = /^[0-9a-f]{64}$/u;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChunkedManifestPart {
  /** Absolute URL of the part (resolved against the manifest URL). */
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ChunkedManifest {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly parts: readonly ChunkedManifestPart[];
}

export interface ChunkedFetchOptions {
  /** Default: the global fetch. */
  readonly fetch?: Fetch;
  /** Waits before the one retry of a request. Default: setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Default 2 s. */
  readonly retryDelayMs?: number;
}

/** Whether a URL is a chunked-export manifest (which this fetch answers itself). */
export function isChunkedManifestUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(CHUNKED_MANIFEST_SUFFIX);
  } catch {
    return false;
  }
}

function invalidManifest(manifestUrl: string, problem: string): CanonicalIntegrityError {
  return new CanonicalIntegrityError(`DemoDB manifest ${manifestUrl} is not a ${CHUNKED_MANIFEST_FORMAT} manifest: ${problem}`);
}

function positiveSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Checks a parsed manifest against the contract; part URLs must stay on the manifest's origin. */
export function parseChunkedManifest(json: unknown, manifestUrl: string): ChunkedManifest {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw invalidManifest(manifestUrl, 'not an object');
  const manifest = json as Record<string, unknown>;
  if (manifest['format'] !== CHUNKED_MANIFEST_FORMAT)
    throw invalidManifest(manifestUrl, `format is ${JSON.stringify(manifest['format'])}`);
  if (manifest['compression'] !== 'gzip')
    throw invalidManifest(manifestUrl, `compression is ${JSON.stringify(manifest['compression'])}`);
  const file = manifest['file'];
  const base = new URL(manifestUrl);
  if (typeof file !== 'string' || file === '' || !base.pathname.endsWith(`/${file}${CHUNKED_MANIFEST_SUFFIX}`))
    throw invalidManifest(manifestUrl, 'file does not match the manifest name');
  const bytes = manifest['bytes'];
  if (!positiveSize(bytes)) throw invalidManifest(manifestUrl, 'bytes must be a positive integer');
  const sha256 = manifest['sha256'];
  if (typeof sha256 !== 'string' || !sha256Pattern.test(sha256))
    throw invalidManifest(manifestUrl, 'sha256 must be 64 lowercase hex characters');
  const partsJson = manifest['parts'];
  if (!Array.isArray(partsJson) || partsJson.length === 0 || partsJson.length > MAX_PARTS)
    throw invalidManifest(manifestUrl, `parts must list 1 to ${MAX_PARTS} parts`);
  const parts = partsJson.map((value: unknown, index): ChunkedManifestPart => {
    const part = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const label = `parts[${index}]`;
    const path = part['path'];
    if (typeof path !== 'string' || path === '' || /[?#]/u.test(path))
      throw invalidManifest(manifestUrl, `${label}.path must be a relative file path`);
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw invalidManifest(manifestUrl, `${label}.path leaves ${base.origin}`);
    if (!positiveSize(part['bytes'])) throw invalidManifest(manifestUrl, `${label}.bytes must be a positive integer`);
    const partSha256 = part['sha256'];
    if (typeof partSha256 !== 'string' || !sha256Pattern.test(partSha256))
      throw invalidManifest(manifestUrl, `${label}.sha256 must be 64 lowercase hex characters`);
    return { url: url.href, bytes: part['bytes'], sha256: partSha256 };
  });
  if (parts.reduce((total, part) => total + part.bytes, 0) !== bytes)
    throw invalidManifest(manifestUrl, 'the parts do not add up to bytes');
  return { file, bytes, sha256, parts };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function httpFailure(url: string, status: number): CanonicalFetchError {
  return status === RATE_LIMITED_STATUS
    ? new CanonicalFetchError(RATE_LIMITED_MESSAGE, status)
    : new CanonicalFetchError(`failed to fetch ${url}: HTTP ${String(status)}`, status);
}

/**
 * The fetch the dataset worker gives @dalgo/sqlite-wasm: a manifest URL
 * (`*.parts.json`) is answered with the verified gzip stream described above;
 * any other URL goes to the network unchanged.
 */
export function createChunkedCanonicalFetch(options: ChunkedFetchOptions = {}): Fetch {
  const fetchFn: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  /** One GET (no credentials, no extra headers), retried once after a back-off on a network error or HTTP 5xx. */
  const get = async (url: string): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= 1;
      let response: Response;
      try {
        response = await fetchFn(url, { credentials: 'omit' });
      } catch (error) {
        if (last) throw new CanonicalFetchError(`failed to fetch ${url}`, undefined, { cause: error });
        await sleep(retryDelayMs);
        continue;
      }
      if (response.status >= 500 && !last) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(retryDelayMs);
        continue;
      }
      return response;
    }
  };

  const readManifest = async (manifestUrl: string): Promise<ChunkedManifest | Response> => {
    const response = await get(manifestUrl);
    // The engine turns a failed status into a CanonicalFetchError that keeps it (429 included).
    if (!response.ok) return new Response(null, { status: response.status, statusText: response.statusText });
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw invalidManifest(manifestUrl, `not JSON (${(error as Error).message})`);
    }
    return parseChunkedManifest(json, manifestUrl);
  };

  /** Streams one part to `controller`, checks its size and SHA-256, and returns its bytes. */
  const streamPart = async (
    part: ChunkedManifestPart,
    index: number,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<Uint8Array> => {
    const label = `part ${String(index + 1)} (${part.url})`;
    const response = await get(part.url);
    if (!response.ok) throw httpFailure(part.url, response.status);
    if (!response.body) throw new CanonicalFetchError(`failed to fetch ${part.url}: empty body`, response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > part.bytes) {
          await reader.cancel().catch(() => undefined);
          throw new CanonicalIntegrityError(`${label} is larger than its ${String(part.bytes)} bytes`);
        }
        chunks.push(value);
        controller.enqueue(value.slice());
      }
    } catch (error) {
      if (error instanceof CanonicalIntegrityError) throw error;
      throw new CanonicalFetchError(`failed to read ${part.url}`, undefined, { cause: error });
    } finally {
      reader.releaseLock();
    }
    if (length !== part.bytes)
      throw new CanonicalIntegrityError(`${label} is ${String(length)} bytes, expected ${String(part.bytes)}`);
    const bytes = concat(chunks, length);
    const actual = await sha256Hex(bytes);
    if (actual !== part.sha256) throw new CanonicalIntegrityError(`${label} has SHA-256 ${actual}, expected ${part.sha256}`);
    return bytes;
  };

  const streamParts = async (manifest: ChunkedManifest, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const parts: Uint8Array[] = [];
    for (const [index, part] of manifest.parts.entries()) parts.push(await streamPart(part, index, controller));
    const joined = await sha256Hex(concat(parts, manifest.bytes));
    if (joined !== manifest.sha256)
      throw new CanonicalIntegrityError(`the joined gzip of ${manifest.file} has SHA-256 ${joined}, expected ${manifest.sha256}`);
  };

  return async (input, init) => {
    if (!isChunkedManifestUrl(input)) return fetchFn(input, init);
    let manifest: ChunkedManifest | Response;
    try {
      manifest = await readManifest(input);
    } catch (error) {
      // An error thrown here would be reported as a plain fetch failure; an errored body keeps its class.
      return new Response(new ReadableStream({ start: (controller) => controller.error(error) }));
    }
    if (manifest instanceof Response) return manifest;
    const parts = manifest;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        void streamParts(parts, controller).then(
          () => controller.close(),
          (error: unknown) => controller.error(error),
        );
      },
    });
    // No Content-Encoding: the engine reads this length as the download's total.
    return new Response(body, { status: 200, headers: { 'content-length': String(parts.bytes) } });
  };
}

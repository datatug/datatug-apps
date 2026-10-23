import { PUBLIC_OVDB_LOOPBACK_MODE, type PublicOvdbDevTransport } from '@sneat/datatug-semantic';
export { PUBLIC_OVDB_LOOPBACK_MODE, type PublicOvdbDevTransport } from '@sneat/datatug-semantic';

const publicHeaders = new Set(['accept', 'content-type', 'ovdb-page-snapshot',
  'ovdb-page-offset', 'ovdb-page-limit', 'ovdb-page-close']);

const routes: Readonly<Record<string, string>> = {
  'https://cloud.openvaultdb.com': '/__datatug_public_ovdb/cloud',
  'https://ovdb.demodb.dev': '/__datatug_public_ovdb/demodb',
};

function loopbackOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'The public OVDB development transport requires a loopback origin.',
    );
  return url.origin;
}

/** Rewrites transport only, after callers validate canonical endpoints and rights. */
export function createPublicOvdbDevFetch(
  mode?: PublicOvdbDevTransport | null,
  fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  origin: string = globalThis.location?.origin ?? '',
): typeof fetch {
  if (mode == null) return fetcher;
  if (mode !== PUBLIC_OVDB_LOOPBACK_MODE)
    throw new Error('Unknown public OVDB development transport.');
  const local = loopbackOrigin(origin);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const prefix = routes[url.origin];
    if (!prefix || url.username || url.password || url.search || url.hash)
      return fetcher(input, init);
    const original = input instanceof Request ? input : undefined;
    // Inspect effective options without cloning/consuming a Request body: a
    // credential-bearing request must remain available to the direct fetch.
    const method = (init?.method ?? original?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? original?.headers);
    const credentials = init?.credentials ?? original?.credentials;
    const path = url.pathname;
    const allowed =
      method === 'GET'
        ? /^\/v1\/databases\/[A-Za-z0-9_-]+$/.test(path)
        : method === 'POST' &&
          /^\/v1\/(?:tugql|databases\/[A-Za-z0-9_-]+\/tugql)$/.test(path);
    // Explicit credentials retain their original authorized direct transport.
    if (
      !allowed ||
      headers.has('Authorization') ||
      headers.has('Cookie') ||
      [...headers.keys()].some(name => !publicHeaders.has(name.toLowerCase())) ||
      credentials === 'include'
    )
      return fetcher(input, init);
    const inherited: RequestInit = original
      ? {
          method: original.method,
          headers: original.headers,
          body: original.body,
          signal: original.signal,
          cache: original.cache,
          mode: original.mode,
          integrity: original.integrity,
          keepalive: original.keepalive,
          referrer: original.referrer,
          referrerPolicy: original.referrerPolicy,
        }
      : {};
    const body = init?.body ?? inherited.body;
    return fetcher(`${local}${prefix}${path}`, {
      ...inherited,
      ...init,
      body,
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      // Required by native fetch when an incoming Request supplies a stream.
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    });
  };
}

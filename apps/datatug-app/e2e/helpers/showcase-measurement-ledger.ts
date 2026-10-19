import { createHash } from 'node:crypto';
import type { BrowserContext, Request } from '@playwright/test';

// Hashes are trim + CRLF-normalized UTF-8 DTQL at Demo subtree b9743cc8f6306f8421abb0f98b188d10e0fb1b78.
const queryHashes: Record<string, string> = {
  '48ddadfbb85bdbb9c2eb432cfd94c50c3201bfb62fc4557fcbf235af5b10c1be': 'orders',
  '7779615c15bc3fcd5e28bd85d406f431881eb38e3709788a15ac238e4922aaaa':
    'countries',
  '526bafd3b0aa1515466602f9d2df424ae54b61917495cdeb58fbe995d8fcc0c1':
    'comparison',
  '40d245692840903fc5c9af7b7d491d63291151fdc71c0e105add01b300763602': 'billing',
  d674e1397f9c9a900035bfc8164d7a4393f0eb161383418f318ebee478a293c0:
    'inspector-countries',
};
type Kind =
  | 'read'
  | 'auth-read'
  | 'query'
  | 'telemetry'
  | 'auth'
  | 'project-write'
  | 'other-write';
type Row = {
  id: number;
  phase: string;
  method: string;
  endpoint: string;
  kind: Kind;
  query?: string;
  bodyHash?: string;
  bodyFormat?: string;
  transport?: string;
  canonicalEndpoint?: string;
  attemptedAtMs: number;
  status?: number;
  responseReceivedAtMs?: number;
  responseContentType?: string;
  finishedAtMs?: number;
  outcome: 'pending' | 'finished' | 'failed';
  failure?: string;
  protectedAbort?: string;
  sizes?: Awaited<ReturnType<Request['sizes']>>;
  sizesUnavailable?: string;
  responseEndMs?: number;
};
const safeMethod = (method: string) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(method);
const approvedQueries = [
  'orders',
  'countries',
  'comparison',
  'inspector-countries',
];

function identify(
  request: Request,
): Omit<Row, 'id' | 'phase' | 'attemptedAtMs' | 'outcome'> {
  const url = new URL(request.url());
  const method = request.method();
  const endpoint = url.origin + url.pathname; // Never record URL parameters or headers.
  const proxy =
    url.origin === 'https://datatug.app' &&
    /^\/__datatug_public_ovdb\/(cloud|demodb)\//.test(url.pathname);
  const provider = [
    'https://cloud.openvaultdb.com',
    'https://ovdb.demodb.dev',
  ].includes(url.origin);
  const path = proxy
    ? url.pathname.replace(/^\/__datatug_public_ovdb\/(cloud|demodb)/, '')
    : url.pathname;
  if (
    method === 'POST' &&
    (provider || proxy) &&
    /^\/v1\/(?:databases\/[^/]+\/)?dtql$/.test(path)
  ) {
    let text = request.postData() ?? '';
    let bodyFormat = 'raw-dtql';
    if (text.trimStart().startsWith('{')) {
      try {
        const body = JSON.parse(text) as { query?: unknown };
        text = typeof body.query === 'string' ? body.query : '';
        bodyFormat = text ? 'json-query-string' : 'unrecognized-json';
      } catch {
        text = '';
        bodyFormat = 'unrecognized-json';
      }
    }
    const bodyHash = createHash('sha256')
      .update(text.replace(/\r\n/g, '\n').trim())
      .digest('hex');
    const query = queryHashes[bodyHash] ?? 'unknown';
    return {
      method,
      endpoint,
      kind: 'query',
      query,
      bodyHash,
      bodyFormat,
      transport: proxy ? 'loopback-proxy' : 'direct',
      canonicalEndpoint:
        (proxy && url.pathname.includes('/demodb/')
          ? 'https://ovdb.demodb.dev'
          : proxy
            ? 'https://cloud.openvaultdb.com'
            : url.origin) + path,
    };
  }
  const authEndpoint =
    ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com'].includes(
      url.hostname,
    ) || /\/auth\//.test(url.pathname);
  if (safeMethod(method))
    return { method, endpoint, kind: authEndpoint ? 'auth-read' : 'read' };
  // Known telemetry is separate from source writes. Unknown POSTs fail visibly.
  if (
    (/(^|\.)google-analytics\.com$/.test(url.hostname) &&
      /\/(?:g\/)?collect$/.test(url.pathname)) ||
    (/(^|\.)sentry\.io$/.test(url.hostname) &&
      /\/api\/\d+\/envelope\/$/.test(url.pathname))
  )
    return { method, endpoint, kind: 'telemetry' };
  if (authEndpoint) return { method, endpoint, kind: 'auth' };
  if (
    url.hostname === 'api.github.com' ||
    /\/(?:boards|queries)\/(?:save|create|update|delete)_/.test(url.pathname) ||
    /\/(?:project|projects)\/(?:create|save|update|delete|copy|setup)/.test(
      url.pathname,
    )
  )
    return { method, endpoint, kind: 'project-write' };
  return { method, endpoint, kind: 'other-write' };
}

export async function installShowcaseMeasurementLedger(
  context: BrowserContext,
) {
  const start = performance.now();
  const rows: Row[] = [];
  const entries = new Map<Request, Row>();
  const tasks = new Set<Promise<void>>();
  const violations: string[] = [];
  let phase = 'identity-check',
    phaseCap = 0,
    phaseStart = 0;
  let phaseIdentityCaps: Record<string, number> = {};
  const elapsed = () => performance.now() - start;
  const violate = (reason: string) => {
    if (!violations.includes(reason)) violations.push(reason);
  };
  const track = (task: Promise<void>) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };
  context.on('request', (request) => {
    const row: Row = {
      ...identify(request),
      id: rows.length + 1,
      phase,
      attemptedAtMs: elapsed(),
      outcome: 'pending',
    };
    rows.push(row);
    entries.set(request, row);
    if (/\.(sqlite|wasm)(?:$|\?)/i.test(request.url()))
      violate('SQLite/WASM download attempted');
    if (row.kind === 'query') {
      const phaseQueries = rows
        .slice(phaseStart)
        .filter((item) => item.kind === 'query');
      if (
        rows.filter((item) => item.kind === 'query').length > 12 ||
        phaseQueries.length > phaseCap
      )
        violate('Query budget exceeded in ' + phase);
      if (!approvedQueries.includes(row.query ?? ''))
        violate('Unexpected query identity: ' + row.query);
      if (
        phaseQueries.filter((item) => item.query === row.query).length >
        (phaseIdentityCaps[row.query ?? ''] ?? 0)
      )
        violate('Per-query phase budget exceeded: ' + phase + '/' + row.query);
      if (row.transport !== 'direct')
        violate('Production unexpectedly used a proxy');
      const expectedSuffix =
        row.query === 'comparison'
          ? '/v1/dtql'
          : '/v1/databases/northwind/dtql';
      if (
        new URL(row.canonicalEndpoint ?? row.endpoint).pathname !==
        expectedSuffix
      )
        violate('Unexpected query endpoint for ' + row.query);
      const expectedOrigin =
        row.query === 'comparison'
          ? 'https://cloud.openvaultdb.com'
          : 'https://ovdb.demodb.dev';
      if (
        new URL(row.canonicalEndpoint ?? row.endpoint).origin !== expectedOrigin
      )
        violate('Unexpected query provider for ' + row.query);
      const expectedFormat = ['orders', 'countries'].includes(row.query ?? '')
        ? 'json-query-string'
        : 'raw-dtql';
      if (row.bodyFormat !== expectedFormat)
        violate('Unexpected wire body format for ' + row.query);
    }
    if (['auth', 'project-write', 'other-write'].includes(row.kind))
      violate('Forbidden request attempt: ' + row.kind + ' ' + row.endpoint);
  });
  // Separate protection layer: ledger still records attempts and resulting aborts.
  // Routing disables Chromium HTTP cache; this is declared in the receipt.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const row = entries.get(request);
    if (!row) {
      violate('Request bypassed ledger registration');
      await route.abort('blockedbyclient');
      return;
    }
    const forbidden =
      row && ['auth', 'project-write', 'other-write'].includes(row.kind);
    const download = /\.(sqlite|wasm)(?:$|\?)/i.test(request.url());
    if (forbidden || download || (violations.length && row?.kind === 'query')) {
      if (row)
        row.protectedAbort = forbidden
          ? 'forbidden-write-or-auth'
          : download
            ? 'sqlite-or-wasm'
            : 'query-budget-or-identity';
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  context.on('response', (response) => {
    const mime = (response.headers()['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const row = entries.get(response.request());
    if (row) {
      row.status = response.status();
      row.responseReceivedAtMs = elapsed();
      // Record bounded metadata, never arbitrary headers, URLs or response bodies.
      row.responseContentType = [
        'application/json',
        'application/yaml',
        'text/plain',
        'text/html',
      ].includes(mime)
        ? mime
        : mime
          ? 'other'
          : 'missing';
      if (row.kind === 'query' && (row.status < 200 || row.status >= 300))
        violate('Query returned non-2xx: ' + row.query + ' ' + row.status);
    }
    if (
      [
        'application/wasm',
        'application/vnd.sqlite3',
        'application/x-sqlite3',
      ].includes(mime)
    )
      violate('SQLite/WASM response detected by MIME type');
  });
  context.on('requestfinished', (request) => {
    const row = entries.get(request);
    if (!row) return;
    row.outcome = 'finished';
    row.finishedAtMs = elapsed();
    track(
      (async () => {
        const response = await request.response();
        row.status = response?.status();
        if (
          row.kind === 'query' &&
          (!row.status || row.status < 200 || row.status >= 300)
        )
          violate('Query returned non-2xx: ' + row.query + ' ' + row.status);
        try {
          row.sizes = await request.sizes();
        } catch {
          row.sizesUnavailable = 'Browser did not expose size information';
        }
        row.responseEndMs = request.timing().responseEnd;
      })().catch(() => {
        if (row.kind === 'query')
          violate('Query completion metadata unavailable');
      }),
    );
  });
  context.on('requestfailed', (request) => {
    const row = entries.get(request);
    if (!row) return;
    row.outcome = 'failed';
    row.finishedAtMs = elapsed();
    row.failure = request.failure()?.errorText ?? 'request failed';
    if (row.kind === 'query') violate('Query failed: ' + row.query);
  });
  return {
    rows,
    violations,
    phase(
      name: string,
      cap: number,
      identityCaps: Record<string, number> = {},
    ) {
      phase = name;
      phaseCap = cap;
      phaseStart = rows.length;
      phaseIdentityCaps = identityCaps;
    },
    healthy() {
      if (violations.length) throw new Error(violations.join('\n'));
    },
    async drain() {
      await Promise.all([...tasks]);
    },
    summary() {
      const queries = rows.filter((row) => row.kind === 'query');
      return {
        requestAttempts: rows.length,
        requestFinished: rows.filter((row) => row.outcome === 'finished')
          .length,
        requestFailed: rows.filter((row) => row.outcome === 'failed').length,
        pendingRequests: rows.filter((row) => row.outcome === 'pending').length,
        encodedResponseBodyBytes: rows.reduce(
          (sum, row) => sum + (row.sizes?.responseBodySize ?? 0),
          0,
        ),
        requestSizeMissing: rows.filter((row) => !row.sizes).length,
        queryAttempts: queries.length,
        queryFinished: queries.filter((row) => row.outcome === 'finished')
          .length,
        queryFailed: queries.filter((row) => row.outcome === 'failed').length,
        projectWriteAttempts: rows.filter((row) => row.kind === 'project-write')
          .length,
        protectedAbortAttempts: rows.filter((row) => row.protectedAbort).length,
        telemetryAttempts: rows.filter((row) => row.kind === 'telemetry')
          .length,
        authAttempts: rows.filter((row) => row.kind === 'auth').length,
        authReadRequests: rows.filter((row) => row.kind === 'auth-read').length,
        otherWriteAttempts: rows.filter((row) => row.kind === 'other-write')
          .length,
        pendingQueries: queries.filter((row) => row.outcome === 'pending')
          .length,
        encodedQueryResponseBodyBytes: queries.reduce(
          (sum, row) => sum + (row.sizes?.responseBodySize ?? 0),
          0,
        ),
        querySizeMissing: queries.filter((row) => !row.sizes).length,
      };
    },
  };
}

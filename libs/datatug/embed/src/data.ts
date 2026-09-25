export type Row = Record<string, unknown>;
export interface TableData {
  rows: Row[];
  columns: string[];
  keys?: string[];
  metadata?: Record<string, unknown>;
}

export function safeHttpUrl(value: string, base: string): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Source URL must be HTTP(S) without embedded credentials.');
  }
  return url;
}

function object(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function tableFromJson(value: unknown): TableData {
  const root = object(value) ? value : undefined;
  const source = Array.isArray(value) ? value : root?.['records'] ?? root?.['rows'] ?? root?.['data'];
  if (!Array.isArray(source)) throw new Error('JSON source must be a row array or contain records, rows, or data.');
  const rows: Row[] = [];
  const keys: string[] = [];
  for (const record of source) {
    if (!object(record)) throw new Error('Every JSON row must be an object.');
    if (object(record['data']) && typeof record['key'] === 'string') {
      rows.push(record['data']);
      keys.push(record['key']);
    } else {
      rows.push(record);
    }
  }
  const columns = Array.isArray(root?.['columns']) && root['columns'].every((column) => typeof column === 'string')
    ? root['columns'] as string[]
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { rows, columns, keys: keys.length === rows.length ? keys : undefined, metadata: root };
}

export function tableFromCsv(text: string): TableData {
  const parsed: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field) throw new Error('Malformed CSV quote.');
      quoted = true;
    } else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); parsed.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (field || row.length) { row.push(field); parsed.push(row); }
  if (!parsed.length) return { rows: [], columns: [] };
  const columns = parsed.shift() ?? [];
  if (columns.some((column) => !column) || new Set(columns).size !== columns.length) throw new Error('CSV header columns must be nonempty and unique.');
  return { columns, rows: parsed.map((values) => {
    if (values.length !== columns.length) throw new Error('CSV row has a different number of columns than its header.');
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  }) };
}

export function detectFormat(contentType: string | null, url: URL, override?: string | null): 'json' | 'csv' {
  const media = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (media === 'application/json' || media?.endsWith('+json')) return 'json';
  if (media === 'text/csv' || media === 'application/csv') return 'csv';
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith('.json')) return 'json';
  if (pathname.endsWith('.csv')) return 'csv';
  if (override === 'json' || override === 'csv') return override;
  throw new Error('Cannot detect data format. Set format="json" or format="csv".');
}

async function checked(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;
  let detail = '';
  try {
    const body = await response.json() as unknown;
    if (object(body)) {
      const error = body['error'];
      const message = body['message'] ?? (object(error) ? error['message'] : error);
      if (typeof message === 'string') detail = message;
    }
  } catch { /* The HTTP status remains useful. */ }
  throw new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ''}.`);
}

export async function loadDirect(value: string, format: string | null, signal: AbortSignal): Promise<TableData> {
  const url = safeHttpUrl(value, document.baseURI);
  const response = await checked(await fetch(url, { signal, credentials: 'same-origin', headers: { Accept: 'application/json, text/csv;q=0.9' } }), 'Data request');
  const selected = detectFormat(response.headers.get('Content-Type'), url, format);
  return selected === 'json' ? tableFromJson(await response.json()) : tableFromCsv(await response.text());
}

interface DiscoveryDatabase { id?: string; url?: string; apiUrl?: string; capabilities?: unknown }

export async function loadConnection(connection: string, query: string, parameters: Row, signal: AbortSignal): Promise<TableData> {
  const identity = safeHttpUrl(connection, document.baseURI);
  const discoveryUrl = new URL('/.well-known/openvaultdb', identity.origin);
  const discoveryResponse = await checked(await fetch(discoveryUrl, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } }), 'OVDB discovery');
  const discovery = await discoveryResponse.json() as { databases?: DiscoveryDatabase[] };
  const database = discovery.databases?.find((item) => {
    if (!item.url) return false;
    try { return safeHttpUrl(item.url, discoveryUrl.href).href.replace(/\/$/, '') === identity.href.replace(/\/$/, ''); }
    catch { return false; }
  });
  if (!database?.apiUrl) throw new Error('OVDB discovery does not list this database connection URL.');
  const apiUrl = safeHttpUrl(database.apiUrl, discoveryUrl.href);
  const metadataResponse = await checked(await fetch(apiUrl, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } }), 'OVDB database metadata');
  const metadata = await metadataResponse.json() as { capabilities?: unknown; endpoints?: { dtql?: string }; queryFormat?: string };
  const capabilities = metadata.capabilities ?? database.capabilities;
  const canQuery = Array.isArray(capabilities) ? capabilities.includes('dtql') : object(capabilities) && capabilities['dtql'] === true;
  if (!canQuery || !metadata.endpoints?.dtql) throw new Error('This OVDB database does not advertise DTQL queries.');
  const endpoint = safeHttpUrl(metadata.endpoints.dtql, apiUrl.href);
  let body: string, contentType: string;
  if (metadata.queryFormat === 'dtql-yaml+json') {
    body = JSON.stringify({ query, parameters });
    contentType = 'application/json';
  } else if (metadata.queryFormat === 'dtql-yaml') {
    if (Object.keys(parameters).length) throw new Error('This OVDB endpoint does not support bound DTQL parameters.');
    body = query;
    contentType = 'application/yaml';
  } else throw new Error(`Unsupported OVDB query format: ${metadata.queryFormat ?? 'missing'}.`);
  const response = await checked(await fetch(endpoint, { method: 'POST', signal, credentials: 'same-origin', headers: { 'Content-Type': contentType, Accept: 'application/json' }, body }), 'DTQL query');
  return tableFromJson(await response.json());
}

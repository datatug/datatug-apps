import { decodeSourceRightsEvidence, type SourceRightsEvidence } from '@sneat/datatug-semantic';

/** A publisher pin is a policy input; the project query or API response cannot supply it. */
export interface PublishedOrdersPin {
  readonly publicationUrl: string;
  readonly publicationSha256: string;
  readonly endpoint: string;
  readonly querySha256: string;
  readonly rows: number;
  readonly fields: readonly string[];
  readonly canonicalRowsSha256: string;
  readonly sourceId: string;
  readonly serverId: string;
  readonly databaseId: string;
  readonly recordset: string;
}

/**
 * Reviewed provider/site publication pair. Update only with a new evidence receipt.
 * `endpoint` and `serverId` name the OVDB API as the SHA-pinned publication does (the legacy
 * base); requests go to `currentDemoDbOvdbUrl(endpoint)`.
 */
export const NORTHWIND_ORDERS_PIN: PublishedOrdersPin = Object.freeze({
  publicationUrl: 'https://raw.githubusercontent.com/demo-db/northwind/83ea600a7eae8b35ad33bf4c53bab6440d697850/artifacts/hosting-imports/source-rights.json',
  publicationSha256: '50454d5f30db615178fcd0c6a846854f9434f4f93bb44835cc75fdad4af52e30',
  endpoint: 'https://demodb.dev/ovdb/v1/databases/northwind/dtql', // as the pinned publication names it; requested as /tugql (currentDemoDbOvdbUrl)
  querySha256: 'ba8e43a239489bfb17761990658909b969c9d4939dd8aa008615c867671b2c52',
  rows: 830,
  fields: [
    'OrderID', 'CustomerID', 'EmployeeID', 'OrderDate', 'RequiredDate', 'ShippedDate',
    'ShipVia', 'Freight', 'ShipName', 'ShipAddress', 'ShipCity', 'ShipRegion',
    'ShipPostalCode', 'ShipCountry',
  ],
  canonicalRowsSha256: '69e054b6e952a3c1df7b549fdf7b474a353f18edd9f968560ad1d4bfb6894f0a',
  sourceId: 'ovdb:https%3A%2F%2Fdemodb.dev%2Fovdb/northwind/Orders',
  serverId: 'https://demodb.dev/ovdb',
  databaseId: 'northwind',
  recordset: 'Orders',
});

export interface OrdersAdmission {
  readonly rows: readonly (readonly (string | number | null)[])[];
  readonly canonicalRowsSha256: string;
  readonly rightsPublication: { readonly url: string; readonly sha256: string; readonly sourceId: string };
  readonly sourceRights: SourceRightsEvidence['sourceRights'];
  readonly usedSourceIds: SourceRightsEvidence['usedSourceIds'];
}

const dateFields = new Set(['OrderDate', 'RequiredDate', 'ShippedDate']);
const integerFields = new Set(['OrderID', 'EmployeeID', 'ShipVia']);
const encoder = new TextEncoder();
const MAX_PUBLICATION_BYTES = 64 * 1024;

export class PublicOrdersAdmissionError extends Error {}

function reject(reason: string): never {
  throw new PublicOrdersAdmissionError(reason);
}

async function boundedBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || !response.body) return reject('The public source did not return a readable response.');
  const sizeHeader = response.headers.get('Content-Length');
  if (sizeHeader && Number(sizeHeader) > maximum)
    return reject('The public source response exceeds the browser size limit.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reachedEnd = false;
  try {
    while (true) {
      if (signal.aborted) return reject('The public source request was cancelled.');
      const { value, done } = await reader.read();
      if (done) { reachedEnd = true; break; }
      size += value.byteLength;
      if (size > maximum) return reject('The public source response exceeds the browser size limit.');
      chunks.push(value);
    }
  } finally {
    if (reachedEnd) reader.releaseLock();
    else void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Read only the pinned publisher artifact. TugQL execution uses the shared transport. */
export async function fetchOrdersRightsPublication(
  options: { readonly signal?: AbortSignal; readonly fetch?: typeof globalThis.fetch; readonly pin?: PublishedOrdersPin } = {},
): Promise<Uint8Array> {
  const pin = options.pin ?? NORTHWIND_ORDERS_PIN;
  const deadline = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const transport = options.fetch ?? globalThis.fetch;
  let publicationBytes: Uint8Array;
  try {
    const publicationResponse = await transport(pin.publicationUrl, {
      method: 'GET', headers: { Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    });
    publicationBytes = await boundedBytes(publicationResponse, MAX_PUBLICATION_BYTES, signal);
  } catch (error) {
    if (signal.aborted) return reject(deadline.aborted ? 'The public source timed out.' : 'The public source request was cancelled.');
    throw error;
  }
  if (signal.aborted) return reject(deadline.aborted ? 'The public source timed out.' : 'The public source request was cancelled.');
  return publicationBytes;
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('The Orders response contains a malformed row.');
  return value as Record<string, unknown>;
}

function canonicalDate(value: string, field: string): string {
  const date = value.endsWith('T00:00:00Z') ? value.slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    value !== date && value !== `${date}T00:00:00Z` ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    return reject(`The Orders response has an invalid ${field} date.`);
  return date;
}

/** Match the provider's Python Decimal.normalize() fixed-point representation. */
function canonicalDecimal(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string' ||
    typeof value === 'number' && !Number.isFinite(value))
    return reject('The Orders response has an invalid Freight value.');
  const raw = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return reject('The Orders response has an invalid Freight value.');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    return reject('The Orders response has an unsupported Freight exponent.');
  const digits = `${match[2]}${match[3] ?? ''}`;
  const point = match[2].length + exponent;
  let fixed = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const parts = fixed.split('.');
  const integer = parts[0].replace(/^0+(?=\d)/, '');
  const fraction = parts[1]?.replace(/0+$/, '');
  fixed = fraction ? `${integer}.${fraction}` : integer;
  return fixed === '0' ? '0' : `${match[1] === '-' ? '-' : ''}${fixed}`;
}

function canonicalValue(value: unknown, field: string): string | number | null {
  if (value === null) return null;
  if (dateFields.has(field)) {
    if (typeof value !== 'string') return reject(`The Orders response has a non-text ${field} date.`);
    return canonicalDate(value, field);
  }
  if (field === 'Freight') return canonicalDecimal(value);
  if (integerFields.has(field)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      return reject(`The Orders response has an invalid ${field} integer.`);
    return value;
  }
  if (typeof value !== 'string') return reject(`The Orders response has an invalid ${field} text value.`);
  return value;
}

/** A digest alone never admits a partial or structurally different response. */
export async function verifyPublishedOrders(
  endpoint: string,
  query: string,
  response: unknown,
  publicationBytes: Uint8Array,
  pin: PublishedOrdersPin,
): Promise<OrdersAdmission> {
  if (endpoint !== pin.endpoint || await sha256Hex(encoder.encode(query)) !== pin.querySha256)
    return reject('The saved Orders query does not match the publisher admission.');
  const body = record(response);
  if (body['complete'] !== true || body['nextCursor'] != null || !Array.isArray(body['records']) ||
    body['records'].length !== pin.rows ||
    body['columns'] !== undefined && JSON.stringify(body['columns']) !== JSON.stringify(pin.fields))
    return reject('The Orders response is incomplete or has a different projection.');
  const execution = body['execution'];
  if (execution !== undefined) {
    const details = record(execution);
    if (details['rowsReturned'] !== pin.rows ||
      JSON.stringify(details['sources']) !== JSON.stringify([{ database: pin.databaseId, collection: pin.recordset }]))
      return reject('The Orders execution source differs from the publisher admission.');
  }
  const rows: (string | number | null)[][] = [];
  let priorId = 0;
  for (const item of body['records']) {
    const raw = record(record(item)['data']);
    if (Object.keys(raw).length !== pin.fields.length || pin.fields.some((field) => !Object.hasOwn(raw, field)))
      return reject('The Orders response has different source fields.');
    const row = pin.fields.map((field) => canonicalValue(raw[field], field));
    const orderId = row[0];
    if (pin.fields[0] !== 'OrderID' || typeof orderId !== 'number' || orderId <= priorId)
      return reject('The Orders response has missing, duplicate or unordered OrderID values.');
    priorId = orderId;
    rows.push(row);
  }
  const digest = await sha256Hex(encoder.encode(JSON.stringify(rows)));
  if (digest !== pin.canonicalRowsSha256)
    return reject('The Orders rows differ from the pinned publisher dataset.');
  if (await sha256Hex(publicationBytes) !== pin.publicationSha256)
    return reject('The publisher rights publication differs from the pinned artifact.');
  let publication: Record<string, unknown>;
  try {
    publication = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(publicationBytes)));
  } catch {
    return reject('The publisher rights publication is not valid UTF-8 JSON.');
  }
  const admission = record(publication['admission']);
  if (admission['endpoint'] !== pin.endpoint || admission['querySha256'] !== pin.querySha256 ||
    admission['canonicalRowsSha256'] !== pin.canonicalRowsSha256 ||
    admission['complete'] !== true || admission['rows'] !== pin.rows ||
    JSON.stringify(admission['fields']) !== JSON.stringify(pin.fields))
    return reject('The publisher rights publication has a different admission scope.');
  let evidence: SourceRightsEvidence;
  try {
    evidence = decodeSourceRightsEvidence(publication);
  } catch {
    return reject('The publisher rights publication has invalid source terms.');
  }
  const right = evidence.sourceRights?.[0];
  if (evidence.sourceRights?.length !== 1 || evidence.usedSourceIds?.length !== 1 ||
    evidence.usedSourceIds[0] !== pin.sourceId || right?.sourceId !== pin.sourceId ||
    right.source.serverId !== pin.serverId || right.source.databaseId !== pin.databaseId ||
    right.source.recordset !== pin.recordset || right.declaredAt.serverId !== pin.serverId ||
    right.declarationScope !== 'recordset' || right.evidenceOrigin !== 'publisher-verified')
    return reject('The publisher rights declaration does not cover this exact Orders source.');
  return {
    rows,
    canonicalRowsSha256: digest,
    rightsPublication: { url: pin.publicationUrl, sha256: pin.publicationSha256, sourceId: pin.sourceId },
    sourceRights: evidence.sourceRights,
    usedSourceIds: evidence.usedSourceIds,
  };
}

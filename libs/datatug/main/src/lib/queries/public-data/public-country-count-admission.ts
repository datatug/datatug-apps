import { currentDemoDbOvdbUrl } from '../demodb-ovdb';
import { decodeSourceRightsEvidence, type SourceRightsEvidence } from '@sneat/datatug-semantic';
import { strictJson } from './strict-json';

/** Pinned publisher evidence, not a declaration supplied by a saved project. */
export interface CountryCountPin {
  readonly publicationUrl: string;
  readonly publicationSha256: string;
  readonly endpoint: string;
  readonly querySha256: string;
  readonly rows: number;
  readonly totalOrders: number;
  readonly canonicalRowsSha256: string;
  readonly sourceId: string;
  readonly serverId: string;
  readonly databaseId: string;
  readonly collectionId: string;
}

// `endpoint`/`serverId` are as published (legacy base); requests use currentDemoDbOvdbUrl(endpoint).
export const NORTHWIND_COUNTRY_COUNT_PIN: CountryCountPin = Object.freeze({
  publicationUrl: 'https://raw.githubusercontent.com/demo-db/northwind/76fe0a1ccc82b6c0c5a035d76c9df7522713d618/artifacts/hosting-imports/shipping-country-count-rights.json',
  publicationSha256: 'fd88fdf5a029e94ee2566cb9196cec09fa3b7dbe0cd074fbc1f1baadb878f823',
  endpoint: 'https://demodb.dev/ovdb/v1/databases/northwind/dtql', // as the pinned publication names it; requested as /tugql (currentDemoDbOvdbUrl)
  querySha256: '2e320d487d7bbe7dbfc53abc55c08d12eb80a2e79b34cfe15a2148fa362acc9a',
  rows: 21,
  totalOrders: 830,
  canonicalRowsSha256: '10180147a7752d4006c28d438d7deed96461336b865156036c2c017f5c82b235',
  sourceId: 'ovdb:https%3A%2F%2Fdemodb.dev%2Fovdb/northwind/Orders',
  serverId: 'https://demodb.dev/ovdb',
  databaseId: 'northwind',
  collectionId: 'Orders',
});

export interface AdmittedCountryCounts {
  readonly rows: readonly (readonly [country: string, orders: number])[];
  readonly totalOrders: number;
  readonly canonicalRowsSha256: string;
  readonly sourceRights: NonNullable<SourceRightsEvidence['sourceRights']>;
  readonly usedSourceIds: NonNullable<SourceRightsEvidence['usedSourceIds']>;
  readonly provenance: {
    readonly endpoint: string;
    readonly databaseId: string;
    readonly collectionId: string;
    readonly observedAt: string;
    readonly publicationUrl: string;
    readonly publicationSha256: string;
  };
}

const encoder = new TextEncoder();
const MAX_BYTES = 64 * 1024;

export class PublicCountryCountAdmissionError extends Error {}
const reject = (message: string): never => { throw new PublicCountryCountAdmissionError(message); };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('The public country-count evidence has an invalid shape.');
  return value as Record<string, unknown>;
}

function same(value: unknown, expected: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function bounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok || !response.body) return reject('The public country-count source is unavailable.');
  const lengthHeader = response.headers.get('Content-Length');
  if (lengthHeader && Number(lengthHeader) > MAX_BYTES) return reject('The public country-count response exceeds the browser limit.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reachedEnd = false;
  try {
    while (true) {
      if (signal.aborted) return reject('The public country-count request was cancelled.');
      const { done, value } = await reader.read();
      if (done) { reachedEnd = true; break; }
      size += value.byteLength;
      if (size > MAX_BYTES) return reject('The public country-count response exceeds the browser limit.');
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

function decode(bytes: Uint8Array): Record<string, unknown> {
  try { return object(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch { return reject('The public country-count source returned malformed JSON.'); }
}

/** Pure admission check; callers may inspect rows only after every bound passes. */
export async function verifyPublishedCountryCounts(
  query: string,
  response: unknown,
  publicationBytes: Uint8Array,
  pin: CountryCountPin = NORTHWIND_COUNTRY_COUNT_PIN,
): Promise<AdmittedCountryCounts> {
  if (await sha256(encoder.encode(query)) !== pin.querySha256)
    return reject('The saved country-count query differs from the published query.');
  if (await sha256(publicationBytes) !== pin.publicationSha256)
    return reject('The country-count rights publication differs from the pinned artifact.');
  const publication = decode(publicationBytes);
  const admission = object(publication['admission']);
  if (publication['format'] !== 'demodb-observed-aggregate-rights/v1' ||
    admission['endpoint'] !== pin.endpoint || admission['query'] !== query ||
    admission['querySha256'] !== pin.querySha256 || admission['complete'] !== true ||
    admission['rows'] !== pin.rows || admission['totalOrders'] !== pin.totalOrders ||
    admission['canonicalRowsSha256'] !== pin.canonicalRowsSha256 ||
    !same(admission['fields'], ['ShipCountry', 'orders']) ||
    !same(admission['executionSource'], { database: pin.databaseId, collection: pin.collectionId }))
    return reject('The country-count publication has a different admission scope.');
  let rights: SourceRightsEvidence;
  try { rights = decodeSourceRightsEvidence(publication); }
  catch { return reject('The country-count publication has invalid source terms.'); }
  const right = rights.sourceRights?.[0];
  if (rights.sourceRights?.length !== 1 || rights.usedSourceIds?.length !== 1 ||
    rights.usedSourceIds[0] !== pin.sourceId || right?.sourceId !== pin.sourceId ||
    right.source.serverId !== pin.serverId || right.source.databaseId !== pin.databaseId ||
    right.source.recordset !== pin.collectionId || right.declarationScope !== 'recordset' ||
    right.evidenceOrigin !== 'publisher-verified' || right.declaration.spdx !== 'MIT')
    return reject('The publisher declaration does not cover this exact Orders source.');

  const body = object(response);
  if (!same(Object.keys(body).sort(), ['columns', 'complete', 'execution', 'records']) ||
    body['complete'] !== true || !same(body['columns'], ['ShipCountry', 'orders']) ||
    !Array.isArray(body['records']) || body['records'].length !== pin.rows)
    return reject('The country-count response is incomplete or has changed shape.');
  const execution = object(body['execution']);
  if (execution['rowsReturned'] !== pin.rows ||
    !same(execution['sources'], [{ database: pin.databaseId, collection: pin.collectionId }]))
    return reject('The country-count execution has a different physical source.');
  const rows: [string, number][] = [];
  let total = 0;
  let previous = '';
  for (const entry of body['records']) {
    const record = object(entry);
    if (!same(Object.keys(record), ['data'])) return reject('The country-count response has a malformed row.');
    const data = object(record['data']);
    if (!same(Object.keys(data).sort(), ['ShipCountry', 'orders'].sort())) return reject('The country-count response has different fields.');
    const country = data['ShipCountry'];
    const count = data['orders'];
    if (typeof country !== 'string' || !country || country.trim() !== country ||
      country <= previous || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0)
      return reject('The country-count response has invalid or unordered values.');
    previous = country;
    total += count;
    if (!Number.isSafeInteger(total)) return reject('The country-count sum exceeds the safe integer range.');
    rows.push([country, count]);
  }
  if (total !== pin.totalOrders || await sha256(encoder.encode(JSON.stringify(rows))) !== pin.canonicalRowsSha256)
    return reject('The country-count rows differ from the pinned Orders aggregate.');
  return {
    rows,
    totalOrders: total,
    canonicalRowsSha256: pin.canonicalRowsSha256,
    sourceRights: rights.sourceRights,
    usedSourceIds: rights.usedSourceIds,
    provenance: {
      endpoint: pin.endpoint, databaseId: pin.databaseId, collectionId: pin.collectionId,
      observedAt: new Date().toISOString(), publicationUrl: pin.publicationUrl,
      publicationSha256: pin.publicationSha256,
    },
  };
}

/** The production entry point uses only the immutable provider pin and two anonymous HTTPS reads. */
export async function executePublishedCountryCounts(
  query: string,
  options: { readonly fetch?: typeof globalThis.fetch; readonly signal?: AbortSignal } = {},
): Promise<AdmittedCountryCounts> {
  const pin = NORTHWIND_COUNTRY_COUNT_PIN;
  if (await sha256(encoder.encode(query)) !== pin.querySha256)
    return reject('The saved country-count query differs from the published query.');
  const deadline = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  if (signal.aborted) return reject('The country-count request was cancelled.');
  const transport = options.fetch ?? globalThis.fetch;
  let publication: Uint8Array;
  let response: Uint8Array;
  try {
    publication = await bounded(await transport(pin.publicationUrl, {
      method: 'GET', headers: { Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    }), signal);
    if (await sha256(publication) !== pin.publicationSha256)
      return reject('The country-count rights publication differs from the pinned artifact.');
    response = await bounded(await transport(currentDemoDbOvdbUrl(pin.endpoint), {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    }), signal);
  } catch (error) {
    if (signal.aborted) return reject(deadline.aborted ? 'The country-count request timed out.' : 'The country-count request was cancelled.');
    throw error;
  }
  if (signal.aborted) return reject(deadline.aborted ? 'The country-count request timed out.' : 'The country-count request was cancelled.');
  return verifyPublishedCountryCounts(query, decode(response), publication, pin);
}

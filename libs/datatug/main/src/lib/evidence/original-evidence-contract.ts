import {
  decodeTypedValue,
  evidenceObject,
  resolveRowEvidence,
  type Result,
  type RowEvidenceSelector,
  type TypedValue,
} from '@sneat/datatug-semantic';

export interface OriginalRecord {
  readonly collection: string;
  readonly key: TypedValue;
  readonly fields: Readonly<Record<string, TypedValue>>;
}
export interface OriginalLog {
  readonly artifact: string;
  readonly artifactSHA256: string;
  readonly artifactBytes: number;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly sourceRef: string;
  readonly parser: 'jsonl';
  readonly parseStatus: 'parsed' | 'missing_timestamp' | 'invalid_timestamp';
  readonly rawBase64: string;
}
export type OriginalEvidence =
  | {
      readonly version: 1;
      readonly status: 'unavailable';
      readonly reason: string;
    }
  | {
      readonly version: 1;
      readonly status: 'available';
      readonly selection: RowEvidenceSelector;
      readonly records: readonly OriginalRecord[];
      readonly log: OriginalLog;
    };

// Fixed admitted shippingfixture/38a51dda schema. This is a contract decoder,
// not source discovery or a client-side original-record resolver.
const schemas = {
  events:
    'event_id:s attempt_id:s sequence:i kind:s occurred_at:s clock_domain:s precision_ms:i artifact:s byte_start:i byte_end:i artifact_sha256:s',
  attempts:
    'attempt_id:s request_id:s attempt_no:i config_revision:i started_at:s state:s',
  requests:
    'request_id:s order_id:i shipper_id:i message_id:s correlation_id:s created_at:s',
  configurations: 'revision:i published_at:s',
  routes:
    'route_id:s revision:i shipper_id:i partner_id:s valid_from:s valid_until:n',
  partners: 'partner_id:s enabled:i',
} as const;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const fail = (): never => {
  throw new Error('Original evidence is invalid or unavailable.');
};
const text = (value: unknown, max: number): string => {
  if (
    typeof value !== 'string' ||
    !value ||
    new TextEncoder().encode(value).length > max
  )
    return fail();
  return value;
};
const integer = (value: unknown, min: number, max: number): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return fail();
  return value;
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function record(value: unknown): OriginalRecord {
  const raw = evidenceObject(value, ['collection', 'key', 'fields']);
  const collection = text(raw['collection'], 128);
  if (!Object.hasOwn(schemas, collection)) return fail();
  const columns = schemas[collection as keyof typeof schemas]
    .split(' ')
    .map((x) => x.split(':'));
  const fields = evidenceObject(
    raw['fields'],
    columns.map((x) => x[0]),
  );
  if (Object.keys(fields).length !== columns.length || columns.length > 16)
    return fail();
  const decoded: Record<string, TypedValue> = Object.create(null);
  for (const [name, kind] of columns) {
    const cell = decodeTypedValue(fields[name]);
    if (
      !(kind === 'i'
        ? cell.type === 'integer'
        : kind === 'n'
          ? cell.type === 'null' || cell.type === 'string'
          : cell.type === 'string')
    )
      return fail();
    if (
      typeof cell.value === 'string' &&
      new TextEncoder().encode(cell.value).length > 1024
    )
      return fail();
    decoded[name] = cell;
  }
  const key = decodeTypedValue(raw['key']);
  if (!equal(key, decoded[columns[0][0]])) return fail();
  return { collection, key, fields: decoded };
}
function log(value: unknown): OriginalLog {
  if (bytes(value) > 24 * 1024) return fail();
  const raw = evidenceObject(value, [
    'artifact',
    'artifactSHA256',
    'artifactBytes',
    'byteStart',
    'byteEnd',
    'sourceRef',
    'parser',
    'parseStatus',
    'rawBase64',
  ]);
  const artifact = text(raw['artifact'], 128);
  if (
    artifact.startsWith('/') ||
    artifact.includes('\\') ||
    artifact.split('/').some((x) => !x || x === '.' || x === '..') ||
    /[:?#]/.test(artifact)
  )
    return fail();
  const artifactSHA256 = text(raw['artifactSHA256'], 64);
  if (!/^[a-f0-9]{64}$/.test(artifactSHA256)) return fail();
  const artifactBytes = integer(raw['artifactBytes'], 1, 8 * 1024 * 1024);
  const byteStart = integer(raw['byteStart'], 0, artifactBytes - 1);
  const byteEnd = integer(raw['byteEnd'], byteStart + 1, artifactBytes);
  if (
    byteEnd - byteStart > 16 * 1024 ||
    raw['parser'] !== 'jsonl' ||
    !['parsed', 'missing_timestamp', 'invalid_timestamp'].includes(
      String(raw['parseStatus']),
    )
  )
    return fail();
  const rawBase64 = text(raw['rawBase64'], 4 * Math.ceil((16 * 1024) / 3));
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      rawBase64,
    )
  )
    return fail();
  let decoded: string;
  try {
    decoded = atob(rawBase64);
  } catch {
    return fail();
  }
  if (decoded.length !== byteEnd - byteStart || btoa(decoded) !== rawBase64)
    return fail();
  return {
    artifact,
    artifactSHA256,
    artifactBytes,
    byteStart,
    byteEnd,
    sourceRef: text(raw['sourceRef'], 512),
    parser: 'jsonl',
    parseStatus: raw['parseStatus'] as OriginalLog['parseStatus'],
    rawBase64,
  };
}
/** Display only. Invalid UTF8 never becomes replacement text labelled original. */
export function originalLogText(value: OriginalLog): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(atob(value.rawBase64), (x) => x.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
}
export async function readOriginalEvidence(
  value: unknown,
  result: Result,
  expected?: RowEvidenceSelector,
): Promise<OriginalEvidence> {
  if (bytes(value) > 64 * 1024) return fail();
  const raw = evidenceObject(value, [
    'version',
    'status',
    'reason',
    'selection',
    'records',
    'log',
  ]);
  if (raw['version'] !== 1) return fail();
  if (raw['status'] === 'unavailable') {
    if (
      Object.keys(raw).length !== 3 ||
      ![
        'not-admitted',
        'not-observed',
        'original-missing',
        'original-invalid',
        'limit',
      ].includes(String(raw['reason']))
    )
      return fail();
    return {
      version: 1,
      status: 'unavailable',
      reason: raw['reason'] as string,
    };
  }
  if (raw['status'] !== 'available' || Object.keys(raw).length !== 5)
    return fail();
  const selected = evidenceObject(raw['selection'], [
    'execution',
    'recordsetFingerprint',
    'scope',
    'source',
    'rowKeyColumn',
    'rowKey',
    'slotColumn',
  ]);
  if (Object.keys(selected).length !== 7) return fail();
  evidenceObject(selected['execution'], [
    'storeId',
    'projectId',
    'executionId',
  ]);
  evidenceObject(selected['scope'], [
    'storeId',
    'spaceID',
    'projectId',
    'environment',
  ]);
  evidenceObject(selected['source'], ['id', 'generation']);
  decodeTypedValue(selected['rowKey']);
  const selection = selected as unknown as RowEvidenceSelector;
  if (
    (expected && !equal(selection, expected)) ||
    !(await resolveRowEvidence(result, selection))
  )
    return fail();
  if (!Array.isArray(raw['records']) || bytes(raw['records']) > 32 * 1024)
    return fail();
  const records = raw['records'].map(record);
  if (
    records.length < 4 ||
    records.length > 36 ||
    !['events', 'attempts', 'requests', 'configurations'].every(
      (x, i) => records[i].collection === x,
    )
  )
    return fail();
  const routes = records.slice(4).filter((x) => x.collection === 'routes');
  const partners = records.slice(4).filter((x) => x.collection === 'partners');
  if (
    routes.length > 16 ||
    partners.length > 16 ||
    routes.length + partners.length !== records.length - 4 ||
    !equal(
      records.slice(4).map((x) => x.collection),
      [...routes.map(() => 'routes'), ...partners.map(() => 'partners')],
    )
  )
    return fail();
  for (const group of [routes, partners]) {
    if (
      group.some(
        (x, i) =>
          i > 0 && String(group[i - 1].key.value) >= String(x.key.value),
      )
    )
      return fail();
  }
  const [event, attempt, request, config] = records.map((x) => x.fields);
  const same = (a: TypedValue, b: TypedValue) => {
    if (!equal(a, b)) fail();
  };
  same(event['attempt_id'], attempt['attempt_id']);
  same(attempt['request_id'], request['request_id']);
  same(attempt['config_revision'], config['revision']);
  for (const route of routes) {
    same(route.fields['revision'], config['revision']);
    same(route.fields['shipper_id'], request['shipper_id']);
    if (!partners.some((x) => equal(x.key, route.fields['partner_id'])))
      return fail();
  }
  if (
    partners.some(
      (x) => !routes.some((r) => equal(r.fields['partner_id'], x.key)),
    )
  )
    return fail();
  const originalLog = log(raw['log']);
  if (
    event['artifact'].value !== originalLog.artifact ||
    event['artifact_sha256'].value !== originalLog.artifactSHA256 ||
    event['byte_start'].value !== String(originalLog.byteStart) ||
    event['byte_end'].value !== String(originalLog.byteEnd)
  )
    return fail();
  return {
    version: 1,
    status: 'available',
    selection: structuredClone(selection),
    records,
    log: originalLog,
  };
}

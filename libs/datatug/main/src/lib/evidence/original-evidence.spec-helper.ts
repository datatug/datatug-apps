import type { RowEvidenceSelector, TypedValue } from '@sneat/datatug-semantic';
import type {
  OriginalEvidence,
  OriginalRecord,
} from './original-evidence-contract';
import fixture from './testdata/backend-v044-retained.json';
/** CONTRACT ONLY: no implemented Backend original-evidence fixture yet.
 * Existing retained wrapper is actual Go output; this extension is design data.
 * Root must require actual Backend JSON parity before integration acceptance. */
export function originalContractFixture(): Extract<
  OriginalEvidence,
  { status: 'available' }
> {
  const str = (value: string): TypedValue => ({ type: 'string', value });
  const int = (value: string): TypedValue => ({ type: 'integer', value });
  const make = (
    collection: string,
    fields: Record<string, TypedValue>,
  ): OriginalRecord => ({ collection, key: Object.values(fields)[0], fields });
  const raw =
    '{"event_id":"event-blocked","attempt_id":"attempt-1","kind":"routing.blocked","order_id":11045,"occurred_at":"2026-10-22T12:00:00Z"}\r\n';
  const hash = 'a'.repeat(64);
  return {
    version: 1,
    status: 'available',
    selection: structuredClone(fixture.selector) as RowEvidenceSelector,
    records: [
      make('events', {
        event_id: str('event-blocked'),
        attempt_id: str('attempt-1'),
        sequence: int('1'),
        kind: str('routing.blocked'),
        occurred_at: str('2026-10-22T12:00:00Z'),
        clock_domain: str('shipping'),
        precision_ms: int('1'),
        artifact: str('logs/baseline.jsonl'),
        byte_start: int('0'),
        byte_end: int(String(raw.length)),
        artifact_sha256: str(hash),
      }),
      make('attempts', {
        attempt_id: str('attempt-1'),
        request_id: str('request-1'),
        attempt_no: int('1'),
        config_revision: int('17'),
        started_at: str('2026-10-22T12:00:00Z'),
        state: str('blocked'),
      }),
      make('requests', {
        request_id: str('request-1'),
        order_id: int('11045'),
        shipper_id: int('2'),
        message_id: str('message-1'),
        correlation_id: str('correlation-1'),
        created_at: str('2026-10-22T12:00:00Z'),
      }),
      make('configurations', {
        revision: int('17'),
        published_at: str('2026-10-21T12:00:00Z'),
      }),
      make('routes', {
        route_id: str('route-expired'),
        revision: int('17'),
        shipper_id: int('2'),
        partner_id: str('partner-1'),
        valid_from: str('2026-10-20T00:00:00Z'),
        valid_until: str('2026-10-21T00:00:00Z'),
      }),
      make('partners', { partner_id: str('partner-1'), enabled: int('1') }),
    ],
    log: {
      artifact: 'logs/baseline.jsonl',
      artifactSHA256: hash,
      artifactBytes: raw.length,
      byteStart: 0,
      byteEnd: raw.length,
      sourceRef: 'actual-reader-reference-required-at-parity',
      parser: 'jsonl',
      parseStatus: 'parsed',
      rawBase64: btoa(raw),
    },
  };
}

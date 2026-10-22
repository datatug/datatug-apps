import type { RetainedSourcePin } from './retained-evidence-contract';
import type { OriginalLog } from './original-evidence-contract';
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
    '{"event_id":"fixture-row","attempt_id":"attempt-1","kind":"routing.blocked","order_id":11045,"occurred_at":"2026-10-22T12:00:00Z"}\r\n';
  const hash = 'a'.repeat(64);
  return {
    version: 1,
    status: 'available',
    selection: structuredClone(fixture.selector) as RowEvidenceSelector,
    records: [
      make('events', {
        event_id: str('fixture-row'),
        attempt_id: str('attempt-1'),
        sequence: int('1'),
        kind: str('routing.blocked'),
        occurred_at: str('2026-10-22T12:00:00Z'),
        clock_domain: str('shipping'),
        precision_ms: int('1'),
        artifact: str('base.jsonl'),
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
      artifact: 'logs/base.jsonl',
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

/** Synthetic wrapper pin for this CONTRACT ONLY extension. The checked-in
 * backend-v044 fixture itself remains untouched and is not relabelled. */
export function originalContractPin(
  log: OriginalLog = originalContractFixture().log,
): RetainedSourcePin {
  return {
    ...structuredClone(fixture.execution.sourcePin),
    revision: {
      ...structuredClone(fixture.execution.sourcePin.revision),
      fixtureCommit: '38a51dda39d988f2d2bcf23703bd1a969d49f4a3',
      fixtureSHA256:
        '73f0d871607ee5b24de68b5398c25806f556a3126a31e1865fee79b2881977e0',
      schemaSHA256:
        'df7cbb329274eb7b9365c6215ee5083359a43b9ae6f0ee6b3c5f61ef748bedd5',
      artifacts: [
        {
          id: log.artifact,
          sha256: log.artifactSHA256,
          bytes: log.artifactBytes,
        },
      ],
    },
  } as RetainedSourcePin;
}

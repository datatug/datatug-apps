import {
  decodeResult,
  type RowEvidenceSelector,
} from '@sneat/datatug-semantic';
import fixture from './testdata/backend-v044-retained.json';
import {
  originalContractFixture,
  originalContractPin,
} from './original-evidence.spec-helper';
import {
  readOriginalEvidence,
  originalLogText,
} from './original-evidence-contract';
import { readRetainedExecution } from './retained-open-contract';
const result = decodeResult(fixture.row.result);
const selector = fixture.selector as RowEvidenceSelector;
const pin = originalContractPin();
const scope = {
  projectRef: {
    storeId: 'firestore',
    spaceID: 'fixture-space',
    projectId: 'fixture-project',
  },
  environment: 'demo',
  actor: 'current-reader',
  nativeDatabaseId: 'fixture-db',
  nativeProjectId: 'fixture-project',
};
describe('Original evidence approved contract (contract-only extension, pending actual Backend parity)', () => {
  it('keeps exact CRLF bytes, integer schema, historical config and expired candidate', async () => {
    const wire = originalContractFixture();
    const value = await readOriginalEvidence(wire, result, pin, selector);
    expect(value).toEqual(wire);
    expect(originalLogText(wire.log)).toMatch(/}\r\n$/);
    expect(wire.records[3].key).toEqual({ type: 'integer', value: '17' });
    expect(wire.records[4].fields['valid_until'].value).toBe(
      '2026-10-21T00:00:00Z',
    );
  });
  it('requires POST status, permits GET omission, rejects malformed present data', async () => {
    await expect(
      readRetainedExecution(fixture.row, scope, undefined, selector),
    ).rejects.toThrow('status is missing');
    await expect(
      readRetainedExecution(fixture.execution, scope),
    ).resolves.toHaveProperty('queryId');
    await expect(
      readRetainedExecution({ ...fixture.row, originalEvidence: null }, scope),
    ).rejects.toThrow();
    const unavailable = {
      version: 1,
      status: 'unavailable',
      reason: 'not-admitted',
    };
    const value = await readRetainedExecution(
      { ...fixture.row, originalEvidence: unavailable },
      scope,
      undefined,
      selector,
    );
    expect(value.originalEvidence).toEqual(unavailable);
    expect(value.result.recordset.rows).toEqual(result.recordset.rows);
  });
  it.each([
    'version',
    'unknown',
    'selection',
    'selection-extra',
    'hash',
    'span',
    'unsafe',
    'base64',
    'padding',
    'length',
    'size',
    'path',
    'schema',
    'typed',
    'key',
    'relation',
    'candidate',
    'duplicate',
    'order',
    'malformed',
    'partial-unavailable',
  ])('fails closed for %s', async (change) => {
    const value = originalContractFixture();
    const wire = value as unknown as Record<string, unknown>;
    switch (change) {
      case 'version':
        wire['version'] = 2;
        break;
      case 'unknown':
        wire['pass'] = true;
        break;
      case 'selection':
        (value.selection.scope as unknown as Record<string, unknown>)[
          'environment'
        ] = 'other';
        break;
      case 'selection-extra':
        (value.selection as unknown as Record<string, unknown>)['latest'] =
          true;
        break;
      case 'hash':
        (value.log as unknown as Record<string, unknown>)['artifactSHA256'] =
          'A'.repeat(64);
        break;
      case 'span':
        (value.log as unknown as Record<string, unknown>)['byteStart'] = 1;
        break;
      case 'unsafe':
        (value.log as unknown as Record<string, unknown>)['artifactBytes'] =
          Number.MAX_SAFE_INTEGER + 1;
        break;
      case 'base64':
        (value.log as unknown as Record<string, unknown>)['rawBase64'] = '!!!!';
        break;
      case 'padding':
        (value.log as unknown as Record<string, unknown>)['rawBase64'] = 'Zh==';
        break;
      case 'length':
        (value.log as unknown as Record<string, unknown>)['rawBase64'] = 'YQ==';
        break;
      case 'size':
        (value.log as unknown as Record<string, unknown>)['sourceRef'] =
          'x'.repeat(513);
        break;
      case 'path':
        (value.log as unknown as Record<string, unknown>)['artifact'] =
          '../baseline.jsonl';
        break;
      case 'schema':
        delete (value.records[0].fields as Record<string, unknown>)['kind'];
        break;
      case 'typed':
        (value.records[3].fields as Record<string, unknown>)['revision'] = {
          type: 'number',
          value: 17,
        };
        break;
      case 'key':
        (value.records[3] as unknown as Record<string, unknown>)['key'] = {
          type: 'integer',
          value: '18',
        };
        break;
      case 'relation':
        (value.records[1].fields as Record<string, unknown>)[
          'config_revision'
        ] = { type: 'integer', value: '18' };
        break;
      case 'candidate':
        (value.records[4].fields as Record<string, unknown>)['shipper_id'] = {
          type: 'integer',
          value: '3',
        };
        break;
      case 'duplicate':
        wire['records'] = [
          ...value.records.slice(0, 5),
          value.records[4],
          value.records[5],
        ];
        break;
      case 'order':
        wire['records'] = [
          value.records[1],
          value.records[0],
          ...value.records.slice(2),
        ];
        break;
      case 'malformed':
        (value.log as unknown as Record<string, unknown>)['parseStatus'] =
          'malformed';
        break;
      case 'partial-unavailable':
        wire['status'] = 'unavailable';
        wire['reason'] = 'original-invalid';
        break;
    }
    await expect(
      readOriginalEvidence(value, result, pin, selector),
    ).rejects.toThrow();
  });
  it.each(['missing_timestamp', 'invalid_timestamp'] as const)(
    'preserves %s without invented normalized time',
    async (parseStatus) => {
      const value = originalContractFixture();
      const log = { ...value.log, parseStatus };
      expect(
        await readOriginalEvidence({ ...value, log }, result, pin, selector),
      ).toHaveProperty('log.parseStatus', parseStatus);
    },
  );
  it('never presents replacement text as original invalid UTF8 bytes', () => {
    expect(
      originalLogText({ ...originalContractFixture().log, rawBase64: '/w==' }),
    ).toBeUndefined();
  });
  it('admits the 16KiB raw span with base64 metadata within 24KiB and rejects one extra byte', async () => {
    const value = originalContractFixture();
    const bounded = (length: number) => ({
      ...value,
      records: value.records.map((record, index) =>
        index
          ? record
          : {
              ...record,
              fields: {
                ...record.fields,
                byte_end: { type: 'integer' as const, value: String(length) },
              },
            },
      ),
      log: {
        ...value.log,
        artifactBytes: length,
        byteEnd: length,
        rawBase64: btoa('x'.repeat(length)),
      },
    });
    await expect(
      readOriginalEvidence(
        bounded(16384),
        result,
        originalContractPin(bounded(16384).log),
        selector,
      ),
    ).resolves.toHaveProperty('log.byteEnd', 16384);
    await expect(
      readOriginalEvidence(bounded(16385), result, pin, selector),
    ).rejects.toThrow();
  });
  it('rejects originals for another manifest order even when the internal record chain is consistent', async () => {
    const original = originalContractFixture();
    const records = original.records.map((record, index) =>
      index !== 2
        ? record
        : {
            ...record,
            fields: {
              ...record.fields,
              order_id: { type: 'integer' as const, value: '11062' },
            },
          },
    );
    await expect(
      readRetainedExecution(
        {
          ...fixture.row,
          sourcePin: pin,
          originalEvidence: { ...original, records },
        },
        scope,
        undefined,
        selector,
      ),
    ).rejects.toThrow('Original order');
  });
  it('preserves multiple historical candidates, including SQL NULL interval ends, and rejects a seventeenth route', async () => {
    const value = originalContractFixture();
    const routes = Array.from({ length: 17 }, (_, index) => {
      const key = {
        type: 'string' as const,
        value: `route-${String(index).padStart(2, '0')}`,
      };
      return {
        ...value.records[4],
        key,
        fields: {
          ...value.records[4].fields,
          route_id: key,
          valid_until: { type: 'null' as const, value: null },
        },
      };
    });
    const within = {
      ...value,
      records: [
        ...value.records.slice(0, 4),
        ...routes.slice(0, 16),
        value.records[5],
      ],
    };
    const decoded = await readOriginalEvidence(within, result, pin, selector);
    expect(decoded).toHaveProperty('records.length', 21);
    expect(decoded).toHaveProperty('records.4.fields.valid_until.type', 'null');
    await expect(
      readOriginalEvidence(
        {
          ...within,
          records: [...value.records.slice(0, 4), ...routes, value.records[5]],
        },
        result,
        pin,
        selector,
      ),
    ).rejects.toThrow();
  });
  it('rejects a self-consistent same-order event chain for a different exact selected event', async () => {
    const value = originalContractFixture();
    const unrelated = {
      type: 'string' as const,
      value: 'other-event-same-order',
    };
    const records = value.records.map((record, index) =>
      index
        ? record
        : {
            ...record,
            key: unrelated,
            fields: { ...record.fields, event_id: unrelated },
          },
    );
    await expect(
      readOriginalEvidence({ ...value, records }, result, pin, selector),
    ).rejects.toThrow();
  });
  it.each([
    'reason-array',
    'reason-object',
    'reason-number',
    'parse-status-array',
    'parse-status-object',
    'parse-status-number',
  ] as const)('rejects nonstring enum %s without coercion', async (mode) => {
    const value = originalContractFixture();
    const invalid = mode.endsWith('array')
      ? [mode.startsWith('reason') ? 'not-admitted' : 'parsed']
      : mode.endsWith('object')
        ? { value: 'parsed' }
        : 1;
    const wire = mode.startsWith('reason')
      ? { version: 1, status: 'unavailable', reason: invalid }
      : { ...value, log: { ...value.log, parseStatus: invalid } };
    await expect(
      readOriginalEvidence(wire, result, pin, selector),
    ).rejects.toThrow();
  });
  it.each([
    'foreign-basename',
    'prefixed-basename',
    'foreign-path',
    'hash',
    'bytes',
    'missing',
    'duplicate',
    'future-artifact',
  ] as const)(
    'rejects original artifact profile or pin mismatch: %s',
    async (mode) => {
      const original = originalContractFixture();
      const admitted = structuredClone(pin);
      const event = original.records[0];
      let records = original.records;
      let log = original.log;
      if (
        mode === 'foreign-basename' ||
        mode === 'prefixed-basename' ||
        mode === 'future-artifact'
      ) {
        const name =
          mode === 'foreign-basename'
            ? 'foreign.jsonl'
            : mode === 'prefixed-basename'
              ? 'logs/base.jsonl'
              : 'future.jsonl';
        records = [
          {
            ...event,
            fields: {
              ...event.fields,
              artifact: { type: 'string', value: name },
            },
          },
          ...original.records.slice(1),
        ];
        if (mode === 'future-artifact') {
          log = { ...log, artifact: 'logs/future.jsonl' };
          admitted.revision.artifacts = [
            {
              id: log.artifact,
              sha256: log.artifactSHA256,
              bytes: log.artifactBytes,
            },
          ];
        }
      } else if (mode === 'foreign-path')
        log = { ...log, artifact: 'foreign/base.jsonl' };
      else if (mode === 'hash')
        admitted.revision.artifacts = [
          { ...admitted.revision.artifacts[0], sha256: 'b'.repeat(64) },
        ];
      else if (mode === 'bytes')
        admitted.revision.artifacts = [
          { ...admitted.revision.artifacts[0], bytes: log.artifactBytes + 1 },
        ];
      else if (mode === 'missing') admitted.revision.artifacts = [];
      else
        admitted.revision.artifacts = [
          ...admitted.revision.artifacts,
          ...admitted.revision.artifacts,
        ];
      await expect(
        readOriginalEvidence(
          { ...original, records, log },
          result,
          admitted,
          selector,
        ),
      ).rejects.toThrow();
    },
  );
  it.each(['fixtureCommit', 'fixtureSHA256', 'schemaSHA256'] as const)(
    'rejects an unrecognized original source profile: %s',
    async (field) => {
      const unknown = structuredClone(pin);
      unknown.revision[field] = 'f'.repeat(field === 'fixtureCommit' ? 40 : 64);
      await expect(
        readOriginalEvidence(
          originalContractFixture(),
          result,
          unknown,
          selector,
        ),
      ).rejects.toThrow();
    },
  );
});

// Fixture-driven contract tests (plan Task 12, "Acceptance and migration":
// "freeze schema fixtures beside the owning code contract and consume the
// same fixtures on server and client... Cover empty arrays, null/false/zero/
// large integer, ambiguous and missing inputs, omitted unauthorized
// metadata, HTTP failures, all envelopes and errors").
//
// These fixtures are this repo's OWN copy, hand-authored against the appendix
// (datatug/datatug: spec/features/core-investigation-loop/api-contract.md)
// because the shared schema authority (github.com/datatug/datatug-core
// pkg/apicontract, lane S64a) has not published a fixture tag yet — see
// ../../INTEGRATION.md and this stream's PR body. When that tag lands:
//   1. replace every file under ./fixtures/ with the datatug-core copy,
//   2. regenerate ./fixtures/checksums.json the same way (sha256 of each
//      file, see the PR body for the one-liner), and
//   3. pin PINNED_DATATUG_CORE_VERSION below to that tag.
// Until then, the checksum test below only proves OUR copy hasn't silently
// drifted from what this test suite last saw — it is not yet the
// cross-repo drift check the brief describes.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeAgentInfo,
  decodeApplicableQueriesResponse,
  decodeErrorEnvelope,
  decodeFact,
  decodeResult,
  decodeSemanticColumnsResponse,
  decodeSemanticRelatedResponse,
  decodeTypedValue,
  ContractDecodeError,
} from './decoders';
import { ERROR_CODES } from './types';

import agentInfoAdmin from './fixtures/success/agent-info.json';
import agentInfoSupport from './fixtures/success/agent-info.support.json';
import applicable from './fixtures/success/applicable.json';
import applicableAmbiguous from './fixtures/success/applicable.ambiguous.json';
import resultLive from './fixtures/success/result.live.json';
import resultOpaquePrivileged from './fixtures/success/result.opaque-privileged.json';
import resultRestricted from './fixtures/success/result.restricted.json';
import resultSnapshot from './fixtures/success/result.snapshot.json';
import semanticColumns from './fixtures/success/semantic-columns.json';
import semanticColumnsEmpty from './fixtures/success/semantic-columns.empty.json';
import semanticRelated from './fixtures/success/semantic-related.json';
import semanticRelatedEmpty from './fixtures/success/semantic-related.empty.json';
import semanticRelatedTruncated from './fixtures/success/semantic-related.truncated.json';

import errorAccessDenied from './fixtures/errors/access-denied.json';
import errorAmbiguousBinding from './fixtures/errors/ambiguous-binding.json';
import errorInvalidRequest from './fixtures/errors/invalid-request.json';
import errorMissingParameter from './fixtures/errors/missing-parameter.json';
import errorNotFound from './fixtures/errors/not-found.json';
import errorResponseTooLarge from './fixtures/errors/response-too-large.json';
import errorSourceUnavailable from './fixtures/errors/source-unavailable.json';
import errorStaleContext from './fixtures/errors/stale-context.json';
import errorTargetRequired from './fixtures/errors/target-required.json';
import errorTimeout from './fixtures/errors/timeout.json';
import errorTypeMismatch from './fixtures/errors/type-mismatch.json';
import errorUnauthenticated from './fixtures/errors/unauthenticated.json';
import errorUnsupportedProtectedExecution from './fixtures/errors/unsupported-protected-execution.json';

import checksums from './fixtures/checksums.json';

/** Not yet a real pin — see the file header. Bump this alongside the fixtures/checksums
 * update once lane S64a announces a datatug-core tag with published fixtures. */
export const PINNED_DATATUG_CORE_VERSION = 'unpinned-local-fixtures';

describe('contract fixtures decode without throwing', () => {
  it('agent-info (admin, support)', () => {
    expect(decodeAgentInfo(agentInfoAdmin).principal.id).toBe('admin');
    expect(decodeAgentInfo(agentInfoSupport).principal.id).toBe('support');
  });

  it('semantic/columns (success, empty)', () => {
    expect(decodeSemanticColumnsResponse(semanticColumns).columns).toHaveLength(2);
    expect(decodeSemanticColumnsResponse(semanticColumnsEmpty).columns).toEqual([]);
  });

  it('semantic/related (success, empty, truncated with null count)', () => {
    expect(decodeSemanticRelatedResponse(semanticRelated).related).toHaveLength(2);
    expect(decodeSemanticRelatedResponse(semanticRelatedEmpty).related).toEqual([]);
    const truncated = decodeSemanticRelatedResponse(semanticRelatedTruncated);
    expect(truncated.truncated).toBe(true);
    expect(truncated.related[0].count).toBeNull();
  });

  it('Result: live, snapshot, opaque-privileged, restricted (empty rows, hidden columns omitted)', () => {
    const live = decodeResult(resultLive);
    expect(live.provenance.mode).toBe('live');
    // null/false/zero(-like)/large-integer coverage in one recordset row.
    expect(live.recordset.rows[0]).toEqual([
      { type: 'integer', value: '9007199254740993' },
      { type: 'integer', value: '5' },
      { type: 'decimal', value: '0.00' },
      { type: 'string', value: '' },
      { type: 'boolean', value: false },
      { type: 'datetime', value: '2026-09-09T12:00:00Z' },
      { type: 'date', value: '2026-09-09' },
      { type: 'null', value: null },
    ]);

    expect(decodeResult(resultSnapshot).provenance.mode).toBe('snapshot');
    expect(decodeResult(resultSnapshot).provenance.snapshotId).toBe(
      'exchange-rates-2026-09-01',
    );

    expect(decodeResult(resultOpaquePrivileged).provenance.executionProfile).toBe(
      'opaque-privileged',
    );

    const restricted = decodeResult(resultRestricted);
    expect(restricted.recordset.rows).toEqual([]);
    // "omitted unauthorized metadata": a protected name stays hidden behind an
    // empty hiddenColumns list and a generic policy label, never enumerated.
    expect(restricted.limitations).toEqual([
      { policy: 'customers-support', rowsFiltered: true, hiddenColumns: [] },
    ]);
  });

  it('queries/applicable: runnable, needs-input, needs-target, source-unavailable, ambiguous', () => {
    const decoded = decodeApplicableQueriesResponse(applicable);
    expect(decoded.applicable.every((c) => c.state === 'runnable')).toBe(true);
    const states = decoded.notYet.map((c) => c.state);
    expect(states).toEqual(
      expect.arrayContaining(['needs-input', 'needs-target', 'source-unavailable']),
    );

    const ambiguous = decodeApplicableQueriesResponse(applicableAmbiguous);
    expect(ambiguous.notYet[0].ambiguous).toEqual([
      { parameterId: 'GenreId', factIds: ['Genre.ID=1', 'Genre.ID=2'] },
    ]);
  });

  it('every documented error code has a fixture that decodes', () => {
    const fixtures: Record<string, unknown> = {
      INVALID_REQUEST: errorInvalidRequest,
      TYPE_MISMATCH: errorTypeMismatch,
      MISSING_PARAMETER: errorMissingParameter,
      AMBIGUOUS_BINDING: errorAmbiguousBinding,
      TARGET_REQUIRED: errorTargetRequired,
      UNAUTHENTICATED: errorUnauthenticated,
      ACCESS_DENIED: errorAccessDenied,
      UNSUPPORTED_PROTECTED_EXECUTION: errorUnsupportedProtectedExecution,
      NOT_FOUND: errorNotFound,
      STALE_CONTEXT: errorStaleContext,
      RESPONSE_TOO_LARGE: errorResponseTooLarge,
      SOURCE_UNAVAILABLE: errorSourceUnavailable,
      TIMEOUT: errorTimeout,
    };
    // Fails loudly if a code is added to ERROR_CODES without a matching fixture,
    // or vice versa — keeps the two lists honest.
    expect(Object.keys(fixtures).sort()).toEqual([...ERROR_CODES].sort());
    for (const [code, fixture] of Object.entries(fixtures)) {
      const envelope = decodeErrorEnvelope(fixture);
      expect(envelope.error.code).toBe(code);
      expect(envelope.error.requestId).toBeTruthy();
    }
    // Only TARGET_REQUIRED carries `targets`.
    expect(decodeErrorEnvelope(errorTargetRequired).error.targets).toHaveLength(2);
    expect(decodeErrorEnvelope(errorAccessDenied).error.targets).toBeUndefined();
  });
});

describe('decoders reject what the appendix forbids (no coercion, no unknown fields)', () => {
  it('TypedValue: no string-to-number coercion', () => {
    expect(() => decodeTypedValue({ type: 'number', value: '5' })).toThrow(
      ContractDecodeError,
    );
  });

  it('TypedValue integer: rejects a leading zero / leading plus', () => {
    expect(() => decodeTypedValue({ type: 'integer', value: '05' })).toThrow();
    expect(() => decodeTypedValue({ type: 'integer', value: '+5' })).toThrow();
  });

  it('TypedValue: rejects an unknown discriminant', () => {
    expect(() => decodeTypedValue({ type: 'bigint', value: '5' })).toThrow();
  });

  it('TypedValue: rejects an extra, unknown field (security-relevant leaf)', () => {
    expect(() =>
      decodeTypedValue({ type: 'string', value: 'x', trusted: true }),
    ).toThrow(/unknown field/);
  });

  it('Fact: rejects an unknown field instead of silently dropping it', () => {
    expect(() =>
      decodeFact({
        id: 'Customer.ID=5',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
        enabled: true,
        role: 'admin', // not part of Fact — must never be silently accepted
      }),
    ).toThrow(/unknown field/);
  });

  it('Fact: rejects a client-supplied role/principal-shaped field the same way', () => {
    expect(() =>
      decodeFact({
        id: 'x',
        entity: 'Customer',
        field: 'ID',
        value: { type: 'integer', value: '5' },
        origin: 'selection',
        enabled: true,
        principal: 'admin',
      }),
    ).toThrow(ContractDecodeError);
  });

  it('agent-info: rejects a missing required field', () => {
    const { securityContextId: _drop, ...withoutId } = agentInfoAdmin;
    void _drop;
    expect(() => decodeAgentInfo(withoutId)).toThrow(/securityContextId/);
  });
});

describe('fixtures/checksums.json has no drift', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, 'fixtures');

  function collectJsonFiles(dir: string, base: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        files.push(...collectJsonFiles(join(dir, entry.name), join(base, entry.name)));
      } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'checksums.json') {
        files.push(join(base, entry.name));
      }
    }
    return files;
  }

  it('every fixture file matches its recorded sha256, and none are missing/extra', () => {
    const onDisk = collectJsonFiles(fixturesDir, '').map((p) =>
      relative('', p).split('\\').join('/'),
    );
    expect(onDisk.sort()).toEqual(Object.keys(checksums).sort());

    for (const relPath of onDisk) {
      const bytes = readFileSync(join(fixturesDir, relPath));
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(actual, `${relPath} drifted from fixtures/checksums.json`).toBe(
        (checksums as Record<string, string>)[relPath],
      );
    }
  });
});

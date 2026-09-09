// Fixture-driven contract tests (plan Task 12, "Acceptance and migration":
// "freeze schema fixtures beside the owning code contract and consume the
// same fixtures on server and client... Cover empty arrays, null/false/zero/
// large integer, ambiguous and missing inputs, omitted unauthorized
// metadata, HTTP failures, all envelopes and errors").
//
// Task 15 item 1: these fixtures are now the GOLDEN copies from datatug-core
// tag PINNED_DATATUG_CORE_VERSION (github.com/datatug/datatug-core
// pkg/apicontract/fixtures/*.json), copied byte-for-byte — filenames
// unchanged from the tag, so `fixtures/manifest.json`'s recorded SHA-256s
// (extracted from that tag's tree; the Go Manifest() function embeds only at
// Go runtime, so this repo cannot call it directly — see manifest.json's own
// `source` field) really do pin the same bytes datatug-core ships. The drift
// test below re-hashes every fixture and fails if a byte changes without a
// matching manifest.json/version bump.
//
// A small number of `client-only-*.json` fixtures cover cases the golden set
// doesn't (documented per-file below and excluded from the manifest.json
// drift check, since they're not part of the golden set): currently just
// `client-only-related-response-truncated.json` (api-contract.md "reaching
// the cap sets truncated" — no golden fixture has `truncated: true`).

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
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

import agentInfo from './fixtures/agent_info.json';
import agentInfoNoPrincipalRoles from './fixtures/agent_info_no_principal_roles.json';
import applicableResponse from './fixtures/applicable_response.json';
import relatedResponse from './fixtures/related_response.json';
import relatedResponseEmpty from './fixtures/related_response_empty.json';
import relatedResponseTruncated from './fixtures/client-only-related-response-truncated.json';
import resultGenericPolicyNoVisibleNames from './fixtures/result_generic_policy_no_visible_names.json';
import resultLive from './fixtures/result_live.json';
import resultOpaquePrivileged from './fixtures/result_opaque_privileged.json';
import resultRestricted from './fixtures/result_restricted.json';
import resultSnapshot from './fixtures/result_snapshot.json';
import resultTruncated from './fixtures/result_truncated.json';
import semanticColumnsResponse from './fixtures/semantic_columns_response.json';
import semanticColumnsResponseEmpty from './fixtures/semantic_columns_response_empty.json';
import scopeFixture from './fixtures/scope.json';
import sourceRefFixture from './fixtures/source_ref.json';
import executionRequestAdhoc from './fixtures/execution_request_adhoc.json';
import executionRequestSaved from './fixtures/execution_request_saved.json';
import executionRequestSnapshot from './fixtures/execution_request_snapshot.json';

import typedValueBooleanFalse from './fixtures/typed_value_boolean_false.json';
import typedValueDate from './fixtures/typed_value_date.json';
import typedValueDatetime from './fixtures/typed_value_datetime.json';
import typedValueDecimal from './fixtures/typed_value_decimal.json';
import typedValueIntegerLarge from './fixtures/typed_value_integer_large.json';
import typedValueNull from './fixtures/typed_value_null.json';
import typedValueNumber from './fixtures/typed_value_number.json';
import typedValueNumberZero from './fixtures/typed_value_number_zero.json';
import typedValueString from './fixtures/typed_value_string.json';

import errorAccessDenied from './fixtures/error_access_denied.json';
import errorAmbiguousBinding from './fixtures/error_ambiguous_binding.json';
import errorInvalidRequest from './fixtures/error_invalid_request.json';
import errorMissingParameter from './fixtures/error_missing_parameter.json';
import errorNotFound from './fixtures/error_not_found.json';
import errorResponseTooLarge from './fixtures/error_response_too_large.json';
import errorSourceUnavailable from './fixtures/error_source_unavailable.json';
import errorStaleContext from './fixtures/error_stale_context.json';
import errorTargetRequired from './fixtures/error_target_required.json';
import errorTimeout from './fixtures/error_timeout.json';
import errorTypeMismatch from './fixtures/error_type_mismatch.json';
import errorUnauthenticated from './fixtures/error_unauthenticated.json';
import errorUnsupportedProtectedExecution from './fixtures/error_unsupported_protected_execution.json';

import manifest from './fixtures/manifest.json';

/** The datatug-core tag these fixtures were copied from byte-for-byte
 * (github.com/datatug/datatug-core pkg/apicontract/fixtures/*.json). Bump
 * this, re-copy every file and regenerate fixtures/manifest.json together —
 * never edit a fixture's bytes by hand. */
export const PINNED_DATATUG_CORE_VERSION = manifest.tag;

describe('contract fixtures decode without throwing', () => {
  it('agent-info (default principal, empty-roles/groups/projects variant)', () => {
    expect(decodeAgentInfo(agentInfo).principal.id).toBe('boss');
    expect(decodeAgentInfo(agentInfo).capabilities.protectedQueries).toBe(true);

    const noRoles = decodeAgentInfo(agentInfoNoPrincipalRoles);
    expect(noRoles.principal.roles).toEqual([]);
    expect(noRoles.principal.groups).toEqual([]);
    expect(noRoles.projects).toEqual([]);
    expect(noRoles.capabilities).toEqual({
      protectedQueries: false,
      opaqueReadOnly: false,
    });
  });

  it('semantic/columns (success, empty)', () => {
    expect(decodeSemanticColumnsResponse(semanticColumnsResponse).columns).toHaveLength(3);
    expect(decodeSemanticColumnsResponse(semanticColumnsResponseEmpty).columns).toEqual([]);
  });

  it('semantic/related (success, empty, truncated with null count)', () => {
    const related = decodeSemanticRelatedResponse(relatedResponse);
    expect(related.related).toHaveLength(2);
    expect(related.related[1].count).toBeNull(); // "count unavailable"
    expect(decodeSemanticRelatedResponse(relatedResponseEmpty).related).toEqual([]);

    // client-only-related-response-truncated.json — see this file's header comment.
    const truncated = decodeSemanticRelatedResponse(relatedResponseTruncated);
    expect(truncated.truncated).toBe(true);
  });

  it('Result: live, snapshot, opaque-privileged, restricted, generic-policy, truncated', () => {
    const live = decodeResult(resultLive);
    expect(live.provenance.mode).toBe('live');
    expect(live.bindingsApplied[0]).toMatchObject({
      parameterId: 'CustomerId',
      origin: 'selection',
      originEvidence: 'client-reported',
    });

    expect(decodeResult(resultSnapshot).provenance.mode).toBe('snapshot');
    expect(decodeResult(resultSnapshot).provenance.snapshotId).toBe('snap-2026-09-09');

    expect(decodeResult(resultOpaquePrivileged).provenance.executionProfile).toBe(
      'opaque-privileged',
    );

    const restricted = decodeResult(resultRestricted);
    expect(restricted.limitations).toEqual([
      { policy: 'support/customers-support', rowsFiltered: true, hiddenColumns: ['Email'] },
    ]);

    // "omitted unauthorized metadata": a protected name stays hidden behind an
    // empty hiddenColumns list and a generic policy label, never enumerated.
    const generic = decodeResult(resultGenericPolicyNoVisibleNames);
    expect(generic.limitations).toEqual([
      { policy: 'restricted', rowsFiltered: true, hiddenColumns: [] },
    ]);

    expect(decodeResult(resultTruncated).truncated).toBe(true);
  });

  it('queries/applicable: runnable, needs-input, needs-target (with ambiguous), source-unavailable', () => {
    const decoded = decodeApplicableQueriesResponse(applicableResponse);
    expect(decoded.applicable.every((c) => c.state === 'runnable')).toBe(true);
    const states = decoded.notYet.map((c) => c.state);
    expect(states).toEqual(
      expect.arrayContaining(['needs-input', 'needs-target', 'source-unavailable']),
    );
    const needsTarget = decoded.notYet.find((c) => c.state === 'needs-target');
    expect(needsTarget?.ambiguous).toEqual([
      { parameterId: 'CountryName', factIds: ['f2', 'f3'] },
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

  it('TypedValue: every documented kind, including null/false/zero/large-integer', () => {
    expect(decodeTypedValue(typedValueString)).toEqual({ type: 'string', value: 'Rock' });
    expect(decodeTypedValue(typedValueNumber)).toEqual({ type: 'number', value: 14.85 });
    expect(decodeTypedValue(typedValueNumberZero)).toEqual({ type: 'number', value: 0 });
    expect(decodeTypedValue(typedValueIntegerLarge)).toEqual({
      type: 'integer',
      value: '90071992547409925',
    });
    expect(decodeTypedValue(typedValueDecimal)).toEqual({ type: 'decimal', value: '10.50' });
    expect(decodeTypedValue(typedValueBooleanFalse)).toEqual({
      type: 'boolean',
      value: false,
    });
    expect(decodeTypedValue(typedValueDate)).toEqual({ type: 'date', value: '2026-09-09' });
    expect(decodeTypedValue(typedValueDatetime)).toEqual({
      type: 'datetime',
      value: '2026-09-09T12:00:00Z',
    });
    expect(decodeTypedValue(typedValueNull)).toEqual({ type: 'null', value: null });
  });

  it('Scope / SourceRef fixtures carry the exact appendix field names', () => {
    expect(scopeFixture).toEqual({
      project: 'demo-project-1',
      environment: 'local',
      securityContextId: 'sc-abc123',
    });
    expect(sourceRefFixture).toEqual({ source: 'chinook-local', collection: 'Customer' });
  });

  it('ExecutionRequest fixtures (adhoc dtql, saved query, snapshot) carry valid typed parameters', () => {
    // ExecutionRequest is client-constructed, never server-decoded — there is no
    // decodeExecutionRequest. This proves each fixture's `parameters` values are
    // still valid TypedValues (the one part of the shape that IS decoded, inside
    // recordset rows elsewhere), so the "same fixtures on server and client" claim
    // is meaningful for these too.
    for (const [name, req] of Object.entries({
      adhoc: executionRequestAdhoc,
      saved: executionRequestSaved,
      snapshot: executionRequestSnapshot,
    })) {
      const parameters = (req as { parameters: Record<string, unknown> }).parameters;
      for (const [paramId, value] of Object.entries(parameters)) {
        expect(
          () => decodeTypedValue(value, `${name}.parameters.${paramId}`),
          `${name}.parameters.${paramId}`,
        ).not.toThrow();
      }
    }
    expect(executionRequestSaved.mode).toBe('live');
    expect(executionRequestSnapshot.mode).toBe('snapshot');
    expect(executionRequestSnapshot.snapshotId).toBe('snap-2026-09-09');
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
    const { securityContextId: _drop, ...withoutId } = agentInfo;
    void _drop;
    expect(() => decodeAgentInfo(withoutId)).toThrow(/securityContextId/);
  });
});

describe('fixtures/manifest.json has no drift from the pinned datatug-core tag', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, 'fixtures');

  it('every golden fixture matches its recorded sha256, and none are missing', () => {
    for (const entry of manifest.entries) {
      const bytes = readFileSync(join(fixturesDir, entry.name));
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(actual, `${entry.name} drifted from fixtures/manifest.json (tag ${manifest.tag})`).toBe(
        entry.sha256,
      );
    }
  });

  it('every fixture file on disk is either a golden (manifest-listed) file or an explicit client-only-* extra', () => {
    const manifestNames = new Set(manifest.entries.map((e) => e.name));
    const onDisk = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    for (const name of onDisk) {
      if (name === 'manifest.json') {
        continue;
      }
      const isGolden = manifestNames.has(name);
      const isClientOnly = name.startsWith('client-only-');
      expect(
        isGolden || isClientOnly,
        `${name} is neither a golden fixture in manifest.json nor prefixed client-only-`,
      ).toBe(true);
    }
    // Every manifest entry must actually be present on disk (not just checked above per-file).
    for (const name of manifestNames) {
      expect(onDisk, `${name} listed in manifest.json but missing from fixtures/`).toContain(
        name,
      );
    }
  });
});

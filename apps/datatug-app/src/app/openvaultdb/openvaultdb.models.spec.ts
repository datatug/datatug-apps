import { describe, expect, it } from 'vitest';
import {
  isAuthorizationResult,
  isUpdateResponse,
} from './openvaultdb.models';

function executionResult(enforced: boolean): unknown {
  return {
    apiVersion: 'dtql.org/authorization/v1',
    requestId: 'request-1',
    mode: 'execution',
    scope: 'request',
    result: 'allow',
    allowed: true,
    hypothetical: false,
    operations: [],
    layers: [],
    blockers: [],
    coverage: {
      evaluation: 'complete',
      disclosure: 'full',
      truncated: false,
      unevaluated: [],
    },
    restrictions: [
      {
        id: 'row-filter',
        operationId: 'update-1',
        representation: 'reference',
        kind: 'row_filter',
        omissionReason: 'not_authorized',
        enforced,
      },
    ],
  };
}

describe('OpenVaultDB authorization response validation', () => {
  it('accepts an allowed execution whose restrictions were enforced', () => {
    const authorization = executionResult(true);
    expect(isAuthorizationResult(authorization)).toBe(true);
    expect(
      isUpdateResponse({ authorization, dataRevision: 'revision-2' }),
    ).toBe(true);
  });

  it('rejects an allowed execution with an unenforced restriction', () => {
    expect(isAuthorizationResult(executionResult(false))).toBe(false);
  });

  it('rejects an update that did not produce an allowed execution result', () => {
    const authorization = {
      ...(executionResult(true) as Record<string, unknown>),
      result: 'deny',
      allowed: false,
      blockers: [
        { operationId: 'update-1', code: 'ACCESS_DENIED', scope: 'operation' },
      ],
    };
    expect(
      isUpdateResponse({ authorization, dataRevision: 'revision-2' }),
    ).toBe(false);
  });

  it('requires dry-run restrictions to remain unenforced', () => {
    const authorization = {
      ...(executionResult(false) as Record<string, unknown>),
      mode: 'plan',
      result: 'conditional',
      allowed: false,
    };
    expect(isAuthorizationResult(authorization)).toBe(true);
    expect(
      isAuthorizationResult({
        ...authorization,
        restrictions: [
          {
            ...(authorization['restrictions'] as Record<string, unknown>[])[0],
            enforced: true,
          },
        ],
      }),
    ).toBe(false);
  });
});

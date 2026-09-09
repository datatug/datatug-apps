export interface OpenVaultTarget {
  readonly id: string;
  readonly databaseId: string;
}

export interface OpenVaultTargetsResponse {
  readonly targets: readonly OpenVaultTarget[];
}

export interface OpenVaultRecord {
  readonly key: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface OpenVaultQueryResponse {
  readonly records: readonly OpenVaultRecord[];
}

export type AuthorizationOutcome =
  | 'allow'
  | 'conditional'
  | 'deny'
  | 'indeterminate';

export interface AuthorizationResource {
  readonly databaseId: string;
  readonly path: string;
  readonly table?: string;
  readonly rowId?: string;
  readonly columns?: readonly (readonly string[])[];
}

export interface AuthorizationOperationResult {
  readonly id: string;
  readonly requestOperationId: string;
  readonly action: string;
  readonly resource: AuthorizationResource;
  readonly result: AuthorizationOutcome;
}

export interface AuthorizationPolicyReference {
  readonly ownerId: string;
  readonly databaseId: string;
  readonly policyId: string;
  readonly revision: string;
  readonly ruleId?: string;
}

export interface AuthorizationLayer {
  readonly layerId: string;
  readonly source: {
    readonly ownerId: string;
    readonly provider: string;
    readonly databaseId: string;
    readonly kind: string;
    readonly reference?: string;
  };
  readonly aclState: string;
  readonly result: AuthorizationOutcome;
  readonly policyRevision?: string;
  readonly decisions: readonly {
    readonly operationId: string;
    readonly result: AuthorizationOutcome;
    readonly policyRef?: AuthorizationPolicyReference;
  }[];
}

export interface AuthorizationResult {
  readonly apiVersion: 'dtql.org/authorization/v1';
  readonly requestId: string;
  readonly mode: 'plan' | 'inspect' | 'sample' | 'execution';
  readonly scope: 'request' | 'sample';
  readonly result: AuthorizationOutcome;
  readonly allowed: boolean;
  readonly hypothetical: boolean;
  readonly operations: readonly AuthorizationOperationResult[];
  readonly layers: readonly AuthorizationLayer[];
  readonly blockers: readonly {
    readonly operationId: string;
    readonly code: string;
    readonly scope: string;
    readonly layerId?: string;
    readonly policyRef?: AuthorizationPolicyReference;
  }[];
  readonly coverage: {
    readonly evaluation: 'complete' | 'partial';
    readonly disclosure: 'full' | 'redacted';
    readonly truncated: boolean;
    readonly unevaluated: readonly {
      readonly operationId: string;
      readonly layerId?: string;
      readonly reason: string;
    }[];
  };
  readonly restrictions: readonly {
    readonly id: string;
    readonly operationId: string;
    readonly layerId?: string;
    readonly policyRef?: AuthorizationPolicyReference;
    readonly representation: string;
    readonly kind: string;
    readonly enforced: boolean;
    readonly omissionReason?: string;
  }[];
}

export interface EvidenceResponse {
  readonly apiVersion: string;
  readonly resource: AuthorizationResource;
  readonly exists: true;
  readonly dataRevision: string;
  readonly fields: readonly unknown[];
}

export interface UpdateResponse {
  readonly authorization: AuthorizationResult;
  readonly dataRevision: string;
}

export function isAuthorizationResult(
  value: unknown,
): value is AuthorizationResult {
  if (!isObject(value)) return false;
  const mode = value['mode'];
  const outcome = value['result'];
  const coverage = value['coverage'];
  const restrictions = value['restrictions'];
  const blockers = value['blockers'];
  if (
    value['apiVersion'] !== 'dtql.org/authorization/v1' ||
    typeof value['requestId'] !== 'string' ||
    value['requestId'].length === 0 ||
    !['plan', 'inspect', 'sample', 'execution'].includes(String(mode)) ||
    !['allow', 'conditional', 'deny', 'indeterminate'].includes(
      String(outcome),
    ) ||
    typeof value['allowed'] !== 'boolean' ||
    typeof value['hypothetical'] !== 'boolean' ||
    !Array.isArray(value['operations']) ||
    !Array.isArray(value['layers']) ||
    !Array.isArray(blockers) ||
    !Array.isArray(restrictions) ||
    !isObject(coverage) ||
    !['complete', 'partial'].includes(String(coverage['evaluation'])) ||
    !['full', 'redacted'].includes(String(coverage['disclosure'])) ||
    typeof coverage['truncated'] !== 'boolean' ||
    !Array.isArray(coverage['unevaluated']) ||
    !restrictions.every(
      (restriction) =>
        isObject(restriction) && typeof restriction['enforced'] === 'boolean',
    )
  ) {
    return false;
  }

  const allowed = value['allowed'];
  const completeAllow =
    outcome === 'allow' &&
    value['scope'] === 'request' &&
    coverage['evaluation'] === 'complete' &&
    coverage['truncated'] === false;
  if (allowed !== completeAllow) return false;
  if (mode === 'sample') {
    if (value['scope'] !== 'sample' || allowed) return false;
  } else if (value['scope'] !== 'request') {
    return false;
  }
  if (
    ['plan', 'inspect', 'sample'].includes(String(mode)) &&
    restrictions.some((restriction) => restriction['enforced'] !== false)
  ) {
    return false;
  }
  return (
    !allowed ||
    (blockers.length === 0 &&
      restrictions.every((restriction) => restriction['enforced'] === true))
  );
}

export function isUpdateResponse(value: unknown): value is UpdateResponse {
  return (
    isObject(value) &&
    typeof value['dataRevision'] === 'string' &&
    value['dataRevision'].length > 0 &&
    isAuthorizationResult(value['authorization']) &&
    value['authorization'].mode === 'execution' &&
    value['authorization'].allowed
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

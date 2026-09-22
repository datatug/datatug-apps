import type { Limitation, TypedValue } from '@sneat/datatug-semantic';
import type { IncidentRef } from './models';

export interface CompareExecutionRef {
  readonly storeId: string;
  readonly projectId: string;
  readonly executionId: string;
}

export interface CompareSideSpec {
  readonly kind: 'facts';
  readonly storeId: string;
  readonly project: string;
  readonly environment: string;
  readonly cohortRole: 'affected' | 'control';
}

export interface CompareRequest {
  readonly securityContextId: string;
  readonly queryId: string;
  readonly left: CompareSideSpec;
  readonly right: CompareSideSpec;
  readonly incident: IncidentRef;
  readonly mutationId: string;
  readonly distributionColumn?: string;
}

export interface CompareColumn {
  readonly name: string;
  readonly type: string;
}

export interface CompareSideReceipt {
  readonly execution: CompareExecutionRef;
  readonly executedAt: string;
  readonly rowCount: number;
  readonly limitations: readonly Limitation[];
  readonly reproducible: boolean;
}

export interface CompareRow {
  readonly key: readonly TypedValue[];
  readonly row: readonly TypedValue[];
}

export interface CompareColumnChange {
  readonly column: string;
  readonly left: TypedValue;
  readonly right: TypedValue;
}

export interface CompareChangedRow {
  readonly key: readonly TypedValue[];
  readonly columns: readonly CompareColumnChange[];
}

export interface CompareSummary {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly columnsOnlyOnOneSide: readonly {
    readonly column: string;
    readonly side: string;
  }[];
}

export interface CompareDistribution {
  readonly column: string;
  readonly truncated: boolean;
  readonly values: readonly {
    readonly value: TypedValue;
    readonly left: { readonly count: number; readonly pct: number };
    readonly right: { readonly count: number; readonly pct: number };
    readonly ratio: number | null;
  }[];
}

export interface CompareResult {
  readonly left: CompareSideReceipt;
  readonly right: CompareSideReceipt;
  readonly columns: readonly CompareColumn[];
  readonly key: readonly string[];
  readonly added: readonly CompareRow[];
  readonly removed: readonly CompareRow[];
  readonly changed: readonly CompareChangedRow[];
  readonly summary: CompareSummary;
  readonly distribution?: CompareDistribution;
  readonly policyLimited: boolean;
  readonly truncated: boolean;
}

export interface CompareCachedDelta {
  readonly column: string;
  readonly value?: TypedValue;
  readonly absent?: boolean;
}

export interface CompareCachedRow {
  readonly sortKey: string;
  readonly key: readonly TypedValue[];
  readonly row: readonly TypedValue[];
  readonly deltas?: readonly CompareCachedDelta[];
}

export interface CompareRowsPage {
  readonly comparisonId: string;
  readonly state: string;
  readonly columns: readonly CompareColumn[];
  readonly key: readonly string[];
  readonly rows: readonly CompareCachedRow[];
  readonly nextSortKey?: string;
  readonly truncated: boolean;
}

export function comparisonCacheId(
  left: CompareExecutionRef,
  right: CompareExecutionRef,
): string {
  return `${left.storeId}/${left.projectId}/${left.executionId}|${right.storeId}/${right.projectId}/${right.executionId}`;
}

export function formatCompareValue(value: TypedValue | undefined): string {
  if (!value || value.type === 'null') {
    return 'null';
  }
  return String(value.value);
}

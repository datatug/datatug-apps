import { InjectionToken } from '@angular/core';
import type { SourceOperationRef } from '@sneat/datatug-semantic';
import type { IncidentResolutionCriterion } from '../incidents/models';
import type { RetainedEvidenceScope } from '../evidence/retained-evidence-contract';
export interface IncidentRecoveryCandidate {
  readonly reference: SourceOperationRef;
  readonly label: string;
  readonly acceptedAt: string;
  readonly eligible: boolean;
  readonly reason?: string;
}
/** The source owner interprets its recovery protocol; descriptors never grant authority. */
export interface IncidentRecoveryAdapter {
  readonly sourceId: string;
  discover(
    scope: RetainedEvidenceScope,
    criterion: IncidentResolutionCriterion,
    signal: AbortSignal,
  ): Promise<readonly IncidentRecoveryCandidate[]>;
  open(
    scope: RetainedEvidenceScope,
    criterion: IncidentResolutionCriterion,
    reference: SourceOperationRef,
    signal: AbortSignal,
  ): Promise<IncidentRecoveryCandidate>;
}
export const INCIDENT_RECOVERY_ADAPTERS = new InjectionToken<
  readonly IncidentRecoveryAdapter[]
>('incident recovery source adapters', {
  providedIn: 'root',
  factory: () => [],
});

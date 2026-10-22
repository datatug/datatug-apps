import { inject, Injectable } from '@angular/core';
import type {
  IncidentRecoveryAdapter,
  IncidentRecoveryCandidate,
} from '../detective/incident-recovery-adapter';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import type { SourceOperationSummary } from '../evidence/source-operation-contract';
import type { IncidentResolutionCriterion } from '../incidents/models';
import { SHIPPING_SOURCE } from './shipping-api.service';

/** Stateless protocol adapter. Opening/discovery uses existing owner-checked endpoints only. */
@Injectable({ providedIn: 'root' })
export class ShippingResolutionAdapterService {
  private readonly api = inject(RetainedEvidenceApiService);
  readonly registration: IncidentRecoveryAdapter = {
    sourceId: SHIPPING_SOURCE,
    discover: async (scope, criterion, signal) => {
      if (criterion.scope.sourceID !== SHIPPING_SOURCE)
        throw new Error('Recovery source is unavailable.');
      return (await this.api.sourceOperations(scope, signal)).map((item) =>
        this.candidate(item, criterion),
      );
    },
    open: async (scope, criterion, reference, signal) => {
      if (
        criterion.scope.sourceID !== SHIPPING_SOURCE ||
        reference.sourceId !== SHIPPING_SOURCE
      )
        throw new Error('Recovery source is unavailable.');
      const value = await this.api.read(
        scope,
        { kind: 'source-operation', sourceOperation: reference },
        signal,
      );
      return this.candidate(
        {
          reference: value.reference,
          action: value.receipt.action,
          outcome: value.receipt.outcome as SourceOperationSummary['outcome'],
          acceptedAt: value.receipt.acceptedAt,
        },
        criterion,
      );
    },
  };
  private candidate(
    item: SourceOperationSummary,
    criterion: IncidentResolutionCriterion,
  ): IncidentRecoveryCandidate {
    const eligible =
      item.action === 'replay' &&
      item.outcome === 'applied' &&
      item.reference.result.generation === criterion.scope.generation;
    return {
      reference: item.reference,
      label: `${item.action} · ${item.outcome === 'already-applied' ? 'No new change' : 'Applied'}`,
      acceptedAt: item.acceptedAt,
      eligible,
      ...(!eligible
        ? {
            reason:
              item.reference.result.generation !== criterion.scope.generation
                ? 'This operation belongs to another source generation.'
                : 'This receipt does not establish a new recovery attempt.',
          }
        : {}),
    };
  }
}

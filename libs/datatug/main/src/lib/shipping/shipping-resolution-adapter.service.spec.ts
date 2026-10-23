import { TestBed } from '@angular/core/testing';
import { ShippingResolutionAdapterService } from './shipping-resolution-adapter.service';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { readSourceOperationHistory } from '../evidence/source-operation-contract';
import { isIncidentResolutionCriterion } from '../incidents/resolution-criterion';
import historyWire from '../evidence/testdata/source-operation.facade.go.json';
import resolveWire from '../detective/testdata/backend-resolve-complete.http.go.json';

describe('source-owned recovery classification', () => {
  it('keeps actual no-op history neutral and ineligible even when its retained result pointer matches an applied replay', async () => {
    const { spaceID, projectId, environment, reference } = historyWire.request;
    const scope = {
      projectRef: { storeId: reference.storeId, spaceID, projectId },
      environment,
      actor: reference.receiptActorId,
    };
    const history = readSourceOperationHistory(
      structuredClone(historyWire.discovery),
      scope,
    );
    const api = { sourceOperations: vi.fn().mockResolvedValue(history) };
    TestBed.configureTestingModule({
      providers: [{ provide: RetainedEvidenceApiService, useValue: api }],
    });
    // Classification-unit criterion uses the real history generation; native Resolve chain is tested separately verbatim.
    const criterion = structuredClone(
      resolveWire.beforeResolve.incident.resolutionCriterion,
    );
    criterion.scope.generation = reference.result.generation;
    if (!isIncidentResolutionCriterion(criterion))
      throw new Error('Invalid criterion fixture');
    const items = await TestBed.inject(
      ShippingResolutionAdapterService,
    ).registration.discover(scope, criterion, new AbortController().signal);
    const noop = items.find(
      (item) => item.reference.operationId === 'source-op-noop',
    );
    expect(noop?.label).toContain('No new change');
    expect(noop?.eligible).toBe(false);
    expect(noop?.reason).toBeTruthy();
    expect(
      items.find((item) => item.reference.operationId === reference.operationId)
        ?.eligible,
    ).toBe(true);
    expect(api.sourceOperations).toHaveBeenCalledWith(
      scope,
      expect.any(AbortSignal),
    );
  });
});

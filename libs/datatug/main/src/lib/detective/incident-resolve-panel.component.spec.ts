import { WorkApiService } from '../work/work-api.service';
import { inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { SneatAuthStateService } from '@sneat/auth-core';
import type { ArtifactRef } from '@sneat/datatug-semantic';
import wire from './testdata/backend-resolve-complete.http.go.json';
import { IncidentResolvePanelComponent } from './incident-resolve-panel.component';
import { INCIDENT_RECOVERY_ADAPTERS } from './incident-recovery-adapter';
import { ShippingResolutionAdapterService } from '../shipping/shipping-resolution-adapter.service';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import {
  readRetainedCheck,
  type RetainedCheckView,
} from '../evidence/retained-open-contract';
import {
  readSourceOperation,
  readSourceOperationHistory,
} from '../evidence/source-operation-contract';
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import {
  DetectiveClientService,
  normalizeDetectiveState,
} from './detective-client.service';
import type { DetectiveState } from './models';
import type { HostedResolveAction } from './hosted-linkage.models';
import { isHostedResolveAction } from './hosted-resolve-contract';
import { isIncidentResolutionCriterion } from '../incidents/resolution-criterion';

// Actual registered HTTP fragments from the same native journey, never synthesized receipt metadata.
// Producer a74c6dc7 (test-only), normal Root-owned Core071 pin; raw SHA256 b287269d5b4a5230cc705660b059e32abd8ac185511c982258cf26d236b0a848.
const request = wire.request;
const context = {
  kind: 'cloud' as const,
  storage: 'firestore' as const,
  spaceID: request.spaceID,
  project: request.project,
  principal: request.recovery.receiptActorId,
};
const ref = {
  storeId: context.storage,
  spaceID: context.spaceID,
  projectId: context.project,
};
const scope = {
  projectRef: ref,
  environment: request.environment,
  actor: context.principal,
};
const openScope = {
  ...scope,
  nativeDatabaseId: wire.greenOpen.manifest.session.databaseId,
  nativeProjectId: wire.greenOpen.manifest.session.projectId,
};
function criterion() {
  const value = structuredClone(
    wire.beforeResolve.incident.resolutionCriterion,
  );
  if (!isIncidentResolutionCriterion(value))
    throw new Error('Actual source criterion invalid');
  return value;
}
const runRef = (runId: string) => ({ ...request.run, runId });
async function retained(runId = request.run.runId): Promise<RetainedCheckView> {
  const value =
    runId === wire.red.run.id
      ? wire.redOpen
      : runId === wire.stillRed.run.id
        ? wire.stillRedOpen
        : wire.greenOpen;
  return readRetainedCheck(structuredClone(value), openScope, runRef(runId));
}
function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required fixture value is unavailable');
  return value;
}

describe('generic human Resolve selection using actual same-chain source fragments', () => {
  const auth = new BehaviorSubject({
    status: 'authenticated',
    user: { uid: context.principal },
  });
  const client = { state: vi.fn(), action: vi.fn(), incidentAction: vi.fn() };
  const api = { sourceOperations: vi.fn(), read: vi.fn() };
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(wire.green.run.startedAt));
    auth.next({ status: 'authenticated', user: { uid: context.principal } });
    client.state
      .mockReset()
      .mockReturnValue(
        of(
          normalizeDetectiveState(
            structuredClone(
              wire.stateBeforeResolve,
            ) as unknown as DetectiveState,
          ),
        ),
      );
    client.action.mockReset();
    client.incidentAction.mockReset();
    api.sourceOperations
      .mockReset()
      .mockImplementation(async () =>
        readSourceOperationHistory(structuredClone(wire.discovery), scope),
      );
    api.read
      .mockReset()
      .mockImplementation(async (_scope, target: ArtifactRef) => {
        if (target.kind === 'check-run') return retained(target.checkRun.runId);
        if (target.kind === 'source-operation')
          return readSourceOperation(
            structuredClone(wire.recoveryOpen),
            scope,
            target.sourceOperation,
          );
        throw new Error('Unexpected read');
      });
    TestBed.configureTestingModule({
      imports: [IncidentResolvePanelComponent],
      providers: [
        { provide: DetectiveClientService, useValue: client },
        { provide: RetainedEvidenceApiService, useValue: api },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: new BehaviorSubject({ ref }) },
        },
        {
          provide: INCIDENT_RECOVERY_ADAPTERS,
          useFactory: () => [
            inject(ShippingResolutionAdapterService).registration,
          ],
        },
      ],
    });
  });
  afterEach(() => vi.restoreAllMocks());
  async function mount() {
    const f = TestBed.createComponent(IncidentResolvePanelComponent);
    for (const [key, value] of Object.entries({
      context,
      projectRef: ref,
      environment: request.environment,
      incidentRef: request.incidentRef,
      expectedSeq: request.expectedSeq,
      criterion: criterion(),
      incidentStatus: wire.beforeResolve.incident.status,
      canWrite: true,
    }))
      f.componentRef.setInput(key, value);
    f.detectChanges();
    await f.whenStable();
    return f;
  }
  async function select(
    f: Awaited<ReturnType<typeof mount>>,
    id = request.run.runId,
  ) {
    await f.componentInstance.loadRuns();
    await f.componentInstance.loadRecoveries();
    await f.componentInstance.chooseRun(id);
    await f.componentInstance.chooseRecovery(request.recovery.operationId);
    await f.whenStable();
  }
  it('offers actual red/corrected-red/green history, excludes a different passing Check and emits no action until explicit note/review/Confirm', async () => {
    const f = await mount(),
      prepared: HostedResolveAction[] = [];
    f.componentInstance.prepared.subscribe((value) => prepared.push(value));
    expect(client.state).not.toHaveBeenCalled();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.sourceOperations).not.toHaveBeenCalled();
    await select(f, wire.red.run.id);
    expect(f.componentInstance.runs().map((run) => run.id)).not.toContain(
      wire.baseline.run.id,
    );
    expect(
      f.componentInstance.runs().filter((run) => run.outcome === 'fail'),
    ).toHaveLength(2);
    f.componentInstance.setNote(request.humanNote);
    expect(f.componentInstance.canReview()).toBe(false);
    f.componentInstance.review();
    f.componentInstance.confirm();
    expect(prepared).toHaveLength(0);
    await f.componentInstance.chooseRun(wire.stillRed.run.id);
    expect(f.componentInstance.selectedRun()?.run.outcome).toBe('fail');
    expect(f.componentInstance.canReview()).toBe(false);
    await f.componentInstance.chooseRun(request.run.runId);
    expect(f.componentInstance.selectedRun()?.run.outcome).toBe('pass');
    expect(f.componentInstance.canReview()).toBe(true);
    f.componentInstance.confirm();
    expect(prepared).toHaveLength(0);
    f.componentInstance.review();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Resolve Incident');
    expect(f.nativeElement.querySelector('details').open).toBe(false);
    f.componentInstance.confirm();
    expect(prepared).toHaveLength(1);
    expect(isHostedResolveAction(prepared[0])).toBe(true);
    expect(prepared[0]).toEqual({
      type: 'resolve',
      incidentRef: request.incidentRef,
      environment: request.environment,
      expectedSeq: request.expectedSeq,
      criterionVersion: request.criterionVersion,
      run: request.run,
      recovery: request.recovery,
      humanNote: request.humanNote,
    });
    expect(client.action).not.toHaveBeenCalled();
    expect(client.incidentAction).not.toHaveBeenCalled();
    expect(
      api.read.mock.calls.filter((call) => call[1].kind === 'source-operation'),
    ).toHaveLength(1);
  });
  it('requires explicit approval of current Work criteria and emits their version fence', async () => {
    TestBed.overrideProvider(WorkApiService, {
      useValue: {
        read: vi.fn().mockResolvedValue({
          item: { criteria: 'Confirm customer receipt', version: 14 },
          capabilities: { transitions: ['resolved'] },
        }),
      },
    });
    const f = await mount(),
      prepared = vi.fn();
    f.componentRef.setInput('workItemId', 'canonical-incident');
    await f.whenStable();
    await select(f);
    f.componentInstance.prepared.subscribe(prepared);
    f.componentInstance.setNote(request.humanNote);
    expect(f.componentInstance.manualCriteria()).toBe(
      'Confirm customer receipt',
    );
    expect(f.componentInstance.manualAccepted()).toBe(false);
    expect(f.nativeElement.textContent).toContain(
      'I verified these closure criteria',
    );
    expect(f.nativeElement.querySelector('ion-checkbox')).not.toBeNull();
    expect(f.componentInstance.canReview()).toBe(false);
    f.componentInstance.confirm();
    expect(prepared).not.toHaveBeenCalled();
    f.componentInstance.manualAccepted.set(true);
    f.componentInstance.review();
    f.componentInstance.confirm();
    expect(prepared).toHaveBeenCalledWith(
      expect.objectContaining({
        criteriaAccepted: true,
        expectedWorkVersion: 14,
      }),
    );
    expect(isHostedResolveAction(prepared.mock.calls[0][0])).toBe(true);
  });
  it('keeps non-recovery activity visible as noneligible and requires an actual reopened reference', async () => {
    const f = await mount();
    await f.componentInstance.loadRecoveries();
    const ineligible = f.componentInstance
      .recoveries()
      .filter((item) => !item.eligible);
    expect(ineligible.length).toBeGreaterThan(0);
    await f.componentInstance.chooseRecovery(
      ineligible[0].reference.operationId,
    );
    expect(api.read).not.toHaveBeenCalled();
    expect(f.componentInstance.selectedRecovery()).toBeUndefined();
    await f.componentInstance.chooseRecovery('not-returned');
    expect(api.read).not.toHaveBeenCalled();
  });
  it.each(['source', 'actor', 'criterion', 'sequence'] as const)(
    'clears proof and rejects an ignored-abort retained result after %s replacement',
    async (change) => {
      const f = await mount();
      await f.componentInstance.loadRuns();
      let finish: (value: RetainedCheckView) => void = () => undefined;
      api.read.mockImplementationOnce(
        () =>
          new Promise<RetainedCheckView>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = f.componentInstance.chooseRun(request.run.runId);
      await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
      const signal = api.read.mock.calls[0][2] as AbortSignal;
      if (change === 'source')
        TestBed.inject(NativeSourceInvalidationService).invalidate({
          projectRef: ref,
          actor: context.principal,
          sourceId: request.recovery.sourceId,
          action: 'reset',
        });
      else if (change === 'actor')
        auth.next({
          status: 'authenticated',
          user: { uid: 'different-account' },
        });
      else if (change === 'criterion')
        f.componentRef.setInput('criterion', {
          ...criterion(),
          version: request.criterionVersion + 1,
        });
      else f.componentRef.setInput('expectedSeq', request.expectedSeq + 1);
      f.detectChanges();
      finish(await retained());
      await pending;
      await f.whenStable();
      expect(signal.aborted).toBe(true);
      expect(f.componentInstance.selectedRun()).toBeUndefined();
      expect(f.componentInstance.canReview()).toBe(false);
    },
  );
  it('denies a mismatched applied input/source pointer, expired run and oversized note without sending', async () => {
    const f = await mount();
    await select(f);
    f.componentInstance.setNote('é'.repeat(2001));
    expect(f.componentInstance.canReview()).toBe(false);
    expect(f.componentInstance.noteError()).toBeTruthy();
    f.componentInstance.setNote(request.humanNote);
    const selected = requireValue(f.componentInstance.selectedRun());
    f.componentInstance.selectedRun.set({
      ...selected,
      manifest: { ...selected.manifest, inputs: {} },
    });
    expect(f.componentInstance.canReview()).toBe(false);
    f.componentInstance.selectedRun.set(selected);
    const recovery = requireValue(f.componentInstance.selectedRecovery());
    f.componentInstance.selectedRecovery.set({
      ...recovery,
      reference: {
        ...recovery.reference,
        result: {
          ...recovery.reference.result,
          revision: recovery.reference.result.revision + 1,
        },
      },
    });
    expect(f.componentInstance.canReview()).toBe(false);
    f.componentInstance.selectedRecovery.set(recovery);
    vi.mocked(Date.now).mockReturnValue(
      Date.parse(wire.green.run.startedAt) +
        (criterion().maxAgeSeconds + 1) * 1000,
    );
    f.componentInstance.review();
    expect(f.componentInstance.reviewing()).toBe(false);
    expect(f.componentInstance.notice()).toContain('too old');
    expect(client.incidentAction).not.toHaveBeenCalled();
  });
  it('clears protected selection and discovery after an owner read denial', async () => {
    const f = await mount();
    await select(f);
    f.componentInstance.setNote(request.humanNote);
    api.read.mockRejectedValueOnce(new Error('denied'));
    await f.componentInstance.chooseRun(request.run.runId);
    await f.whenStable();
    expect(f.componentInstance.selectedRun()).toBeUndefined();
    expect(f.componentInstance.selectedRecovery()).toBeUndefined();
    expect(f.componentInstance.runs()).toEqual([]);
    expect(f.componentInstance.recoveries()).toEqual([]);
    expect(f.componentInstance.humanNote()).toBe('');
    expect(f.componentInstance.error()).toContain('unavailable');
  });
});

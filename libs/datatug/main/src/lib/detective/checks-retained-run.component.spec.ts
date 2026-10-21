import { IonTextarea } from '@ionic/angular';
import { By } from '@angular/platform-browser';
import { EvidenceSharePanelComponent } from '../evidence/evidence-share-panel.component';
import { readRetainedCheck } from '../evidence/retained-open-contract';
import fixtureWire from '../evidence/testdata/backend-v044-retained.json';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { ChecksPageComponent } from './checks-page.component';
import { DetectiveClientService } from './detective-client.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { ProjectService } from '../services/project/project.service';
import { QueriesService } from '../queries/queries.service';
import { SessionContextApiService } from '../session-context/session-context-api.service';
import { RetainedEvidenceApiService } from '../evidence/retained-evidence-api.service';
import { CheckDefinition } from './models';
const ref = {
  storeId: 'firestore',
  spaceID: 'fixture-space',
  projectId: 'fixture-project',
};
const check: CheckDefinition = {
  id: 'request-received',
  title: 'Request received',
  version: 1,
  inputs: [
    {
      name: 'order_id',
      type: 'integer',
      cardinality: 'scalar',
      required: true,
    },
  ],
  steps: [],
};
describe('Ordinary Check retained evidence before a Case', () => {
  const client = { state: vi.fn(), action: vi.fn(), projectIncidents: vi.fn() };
  let auth: BehaviorSubject<{ status: 'authenticated'; user: { uid: string } }>;
  let routeParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    client.state.mockReturnValue(
      of({
        checks: [check],
        cases: [],
        runs: [],
        validators: [],
        queryValidators: [],
        scenarios: [],
        environments: ['demo'],
        capabilities: { canRun: true, canWrite: true },
      }),
    );
    client.projectIncidents.mockReturnValue(of({ incidents: [] }));
  });
  const retainedRead = vi.fn();
  async function mount(actor = 'sarah') {
    auth = new BehaviorSubject({
      status: 'authenticated' as const,
      user: { uid: actor },
    });
    routeParams = new BehaviorSubject(convertToParamMap({ checkId: check.id }));
    const query = convertToParamMap({});
    await TestBed.configureTestingModule({
      imports: [ChecksPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: routeParams.value, queryParamMap: query },
            paramMap: routeParams,
            queryParamMap: of(query),
          },
        },
        { provide: DetectiveClientService, useValue: client },
        { provide: ProjectService, useValue: {} },
        { provide: QueriesService, useValue: { getQuery: vi.fn() } },
        { provide: SessionContextApiService, useValue: {} },
        {
          provide: RetainedEvidenceApiService,
          useValue: { read: retainedRead },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of({ ref }),
            currentEnv: of({ id: 'demo' }),
          },
        },
        { provide: SneatAuthStateService, useValue: { authState: auth } },
        { provide: AgentContextService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ChecksPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('keeps ordinary Run independent from Case creation and does not silently share', async () => {
    const fixture = await mount();
    const input = fixture.nativeElement.querySelector(
      'ion-textarea[aria-label="Check input"]',
    );
    expect(input, fixture.nativeElement.textContent).not.toBeNull();
    input.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '11045' } }),
    );
    const run = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent?.trim() === 'Run Check');
    expect(run).toBeDefined();
    client.action.mockImplementation((_context, _action, _version, intent) =>
      of({
        receipt: intent.operationId,
        run: {
          id: 'run',
          kind: 'check',
          definition: check,
          dependencies: [],
          publishedValidators: [],
          queryValidators: [],
          inputNames: ['order_id'],
          steps: [],
          actor: 'sarah',
          checkId: check.id,
          environment: 'demo',
          executionStatus: 'completed',
          outcome: 'pass',
          startedAt: '2026-10-21T00:00:00Z',
          durationMs: 1,
          checkInvocations: 1,
          queryExecutions: 0,
        },
      }),
    );
    run?.click();
    await vi.waitFor(() => expect(client.action).toHaveBeenCalledOnce());
    expect(client.action.mock.calls[0][1]).toEqual({
      type: 'run-check',
      checkId: check.id,
      caseId: undefined,
      environment: 'demo',
      inputs: { order_id: { type: 'integer', value: '11045' } },
    });
    expect(client.action.mock.calls[0][3].signal).toBeInstanceOf(AbortSignal);
    fixture.destroy();
  });
  it('shares an ordinary real Check before any Case and verifies the cold original run/manifest before showing its outcome', async () => {
    const f = await mount('fixture-actor');
    const manifest = fixtureWire.check.manifest,
      selected = manifest.entries[0];
    const evidence = {
      retention: 'project-pinned' as const,
      incidentRef: manifest.incidentRef,
      context: {
        sessionId: manifest.session.id,
        expectedSessionVersion: manifest.session.version,
        expectedContextSetId: manifest.contextSet.id,
        scope: manifest.scope,
        bindings: [
          {
            inputName: 'order_id',
            entryId: selected.entryId,
            revisionId: selected.revisionId,
          },
        ],
      },
    };
    const view = await readRetainedCheck(
      fixtureWire.check,
      { projectRef: ref, environment: 'demo', actor: 'fixture-actor' },
      {
        storeId: 'firestore',
        projectId: ref.projectId,
        environment: 'demo',
        checkId: 'request-received',
        checkVersion: 1,
        runId: 'fixture-run',
      },
    );
    retainedRead.mockResolvedValue(view);
    const input = f.debugElement.query(By.directive(IonTextarea)).nativeElement;
    expect(input, f.nativeElement.textContent).not.toBeNull();
    input.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '11045' } }),
    );
    f.debugElement
      .query(By.directive(EvidenceSharePanelComponent))
      .triggerEventHandler('selected', {
        identity: JSON.stringify([
          'firestore',
          ref.spaceID,
          ref.projectId,
          '',
          'fixture-actor',
          '',
        ]),
        environment: 'demo',
        choice: {
          evidence,
          value: { type: 'integer', value: '11045' },
          bagId: manifest.bag.id,
          label: 'Selected applied order',
        },
      });
    client.action.mockImplementation((_context, _action, _version, intent) =>
      of({ receipt: intent.operationId, run: view.run }),
    );
    await f.whenStable();
    const button = Array.from(
      f.nativeElement.querySelectorAll('ion-button') as NodeListOf<HTMLElement>,
    ).find(
      (value) =>
        value.textContent?.trim() === 'Run Check and attach to Incident',
    );
    expect(button).toBeDefined();
    button?.click();
    await vi.waitFor(() => expect(retainedRead).toHaveBeenCalledOnce());
    expect(client.action.mock.calls[0][1]).toMatchObject({
      type: 'run-check',
      caseId: undefined,
      evidence,
      inputs: { order_id: { type: 'integer', value: '11045' } },
    });
    expect(retainedRead.mock.calls[0][1]).toMatchObject({
      kind: 'check-run',
      checkRun: {
        checkId: 'request-received',
        checkVersion: 1,
        runId: 'fixture-run',
      },
    });
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('fixture-run');
    f.destroy();
  });
  it('cancels the actual pending command signal synchronously on actor change', async () => {
    const fixture = await mount();
    const input = fixture.nativeElement.querySelector(
      'ion-textarea[aria-label="Check input"]',
    );
    input.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '11045' } }),
    );
    const held = new Subject();
    client.action.mockReturnValue(held);
    const run = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ion-button',
      ) as NodeListOf<HTMLElement>,
    ).find((button) => button.textContent?.trim() === 'Run Check');
    run?.click();
    await vi.waitFor(() => expect(client.action).toHaveBeenCalledOnce());
    const signal = client.action.mock.calls[0][3].signal as AbortSignal;
    auth.next({ status: 'authenticated', user: { uid: 'maya' } });
    expect(signal.aborted).toBe(true);
    held.complete();
    fixture.destroy();
  });
});

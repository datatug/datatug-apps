import { IonTextarea } from '@ionic/angular';
import { Window } from 'happy-dom';
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
import { NativeSourceInvalidationService } from '../evidence/native-source-invalidation';
import { CheckDefinition, CheckRun, DetectiveState } from './models';
const ref = {
  storeId: 'firestore',
  spaceID: 'fixture-space',
  projectId: 'fixture-project',
};
const check: CheckDefinition = {
  id: 'request-received',
  title: 'Request received',
  version: 1,
  updatedAt: '0001-01-01T00:00:00Z',
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
const historicalRun: CheckRun = {
  id: 'historical-run',
  kind: 'check',
  definition: check,
  dependencies: [],
  publishedValidators: [],
  queryValidators: [],
  inputNames: ['order_id'],
  steps: [],
  actor: 'fixture-actor',
  checkId: check.id,
  environment: 'demo',
  executionStatus: 'completed',
  outcome: 'pass',
  startedAt: '2026-10-20T00:00:00Z',
  durationMs: 4,
  checkInvocations: 1,
  queryExecutions: 1,
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
  afterEach(() => vi.unstubAllGlobals());
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
  it('uses compact card headers, keeps the manual Run action in its header, and omits the duplicate catalog link', async () => {
    const fixture = await mount();
    expect(
      fixture.nativeElement
        .querySelector('ion-header ion-toolbar')
        ?.getAttribute('color'),
    ).toBe('light');
    const overview = fixture.nativeElement.querySelector(
      'ion-card.check-detail-overview',
    );
    expect(
      overview?.querySelector('ion-item > ion-label > h1')?.textContent,
    ).toContain('Request received');
    expect(overview?.textContent).toContain('Steps and validation rules');
    const overviewMetadata = overview?.querySelector(
      'ion-item.check-detail-card-header ion-label p.muted',
    );
    expect(overviewMetadata?.textContent).toContain('update time not recorded');
    expect(overviewMetadata?.textContent).not.toContain('Dec 31, 1');
    const editAction = overview?.querySelector('.check-detail-edit-action');
    expect(editAction?.getAttribute('aria-label')).toBe('Edit Check');
    expect(editAction?.querySelector('ion-icon')?.getAttribute('name')).toBe(
      'create-outline',
    );
    expect(
      fixture.nativeElement.querySelector(
        'ion-textarea[aria-label="Order ID"]',
      ),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('All Checks');

    const runCard = fixture.nativeElement.querySelector(
      'ion-card.check-detail-run-card',
    );
    const runHeader = runCard?.querySelector(
      'ion-item.check-detail-run-header',
    );
    expect(runHeader?.querySelector('h2')?.textContent).toContain(
      'Run manually',
    );
    const runAction = runHeader?.querySelector(
      '[data-testid="run-check-action"]',
    );
    expect(runAction?.getAttribute('aria-label')).toBe('Run Check');
    expect(runAction?.getAttribute('title')).toBe('Run Check');
    expect(runAction?.textContent).toContain('Run Check');
    expect(runAction?.querySelector('ion-icon')?.getAttribute('name')).toBe(
      'play-outline',
    );
    expect(
      runCard?.querySelector(
        'ion-card-content [data-testid="run-check-action"]',
      ),
    ).toBeNull();

    const disclosure = overview?.querySelector(
      'details.check-detail-execution',
    ) as HTMLDetailsElement | null;
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector('summary')?.textContent).toContain(
      'Execution details',
    );
    fixture.destroy();
  });
  it.each([
    [true, false, 'Check execution is disabled on the connected local agent.'],
    [
      false,
      true,
      'Check execution is unavailable for this project on the connected service.',
    ],
  ])(
    'explains unavailable execution with localOnly=%s and canWrite=%s',
    async (localOnly, canWrite, message) => {
      // The shared setup stubs observers; use a real one for Ionic ARIA forwarding.
      vi.stubGlobal('MutationObserver', new Window().MutationObserver);
      const states = new Subject<DetectiveState>();
      client.state.mockReturnValue(states);
      const fixture = await mount();
      expect(
        fixture.nativeElement.querySelector('#check-run-capability-hint'),
      ).toBeNull();
      states.next({
        checks: [check],
        cases: [],
        runs: [],
        runsHasMore: false,
        validators: [],
        queryValidators: [],
        scenarios: [],
        environments: ['demo'],
        capabilities: { localOnly, canRead: true, canRun: false, canWrite },
      } as DetectiveState);
      await fixture.whenStable();
      const action = () =>
        fixture.nativeElement.querySelector('[data-testid="run-check-action"]');
      const hint = fixture.nativeElement.querySelector(
        '#check-run-capability-hint',
      );
      expect(hint?.textContent).toBe(message);
      expect(hint?.getAttribute('role')).toBe('status');
      expect(action()?.disabled).toBe(true);
      // Ionic forwards live host ARIA attributes to its native shadow button.
      const nativeAction = () => action()?.shadowRoot?.querySelector('button');
      await vi.waitFor(() =>
        expect(nativeAction()?.getAttribute('aria-describedby')).toBe(hint?.id),
      );
      expect(hint?.closest('ion-card-content')).not.toBeNull();

      states.next({
        checks: [check],
        cases: [],
        runs: [],
        runsHasMore: false,
        validators: [],
        queryValidators: [],
        scenarios: [],
        environments: ['demo'],
        capabilities: {
          localOnly,
          canRead: true,
          canRun: true,
          canWrite: false,
        },
      } as DetectiveState);
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('#check-run-capability-hint'),
      ).toBeNull();
      await vi.waitFor(() =>
        expect(nativeAction()?.getAttribute('aria-describedby')).toBe(''),
      );
      expect(action()?.disabled).toBe(false);

      states.next({
        checks: [check],
        cases: [],
        runs: [],
        runsHasMore: false,
        validators: [],
        queryValidators: [],
        scenarios: [],
        environments: ['demo'],
        capabilities: { localOnly, canRead: true, canRun: false, canWrite },
      } as DetectiveState);
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('#check-run-capability-hint'),
      ).not.toBeNull();
      auth.next({ status: 'authenticated', user: { uid: 'another-actor' } });
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector('#check-run-capability-hint'),
      ).toBeNull();
      fixture.destroy();
    },
  );
  it('keeps ordinary Run independent from Case creation and does not silently share', async () => {
    const fixture = await mount();
    const input = fixture.nativeElement.querySelector(
      'ion-textarea[aria-label="Order ID"]',
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
      {
        projectRef: ref,
        environment: 'demo',
        actor: 'fixture-actor',
        nativeDatabaseId: 'fixture-db',
        nativeProjectId: 'fixture-project',
      },
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
      'ion-textarea[aria-label="Order ID"]',
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
  it('cancels a pending shared Check on matching source reset, clears the current selection, and preserves historical runs', async () => {
    client.state.mockReturnValue(
      of({
        checks: [check],
        cases: [],
        runs: [historicalRun],
        validators: [],
        queryValidators: [],
        scenarios: [],
        environments: ['demo'],
        capabilities: { canRun: true, canWrite: true },
      }),
    );
    const fixture = await mount('fixture-actor');
    const input = fixture.nativeElement.querySelector(
      'ion-textarea[aria-label="Order ID"]',
    );
    input.dispatchEvent(
      new CustomEvent('ionInput', { detail: { value: '11045' } }),
    );
    const manifest = fixtureWire.check.manifest;
    const selected = manifest.entries[0];
    fixture.debugElement
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
          evidence: {
            retention: 'project-pinned',
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
          },
          value: { type: 'integer', value: '11045' },
          bagId: manifest.bag.id,
          label: 'Selected applied order',
        },
      });
    await fixture.whenStable();
    const held = new Subject();
    client.action.mockReturnValue(held);
    const run = fixture.nativeElement.querySelector(
      '[data-testid="run-check-action"]',
    );
    expect(run?.textContent).toContain('Run Check and attach to Incident');
    run?.click();
    await vi.waitFor(() => expect(client.action).toHaveBeenCalledOnce());
    const signal = client.action.mock.calls[0][3].signal as AbortSignal;

    TestBed.inject(NativeSourceInvalidationService).invalidate({
      projectRef: ref,
      actor: 'fixture-actor',
      sourceId: 'shipping-working-copy',
      action: 'reset',
    });
    expect(signal.aborted).toBe(true);
    held.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(
      'completed · pass · no severity · 4 ms',
    );
    await vi.waitFor(() =>
      expect(
        fixture.nativeElement.querySelector('[data-testid="run-check-action"]')
          ?.textContent,
      ).toContain('Run Check'),
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="run-check-action"]')
        ?.textContent,
    ).not.toContain('attach to Incident');
    fixture.destroy();
  });
});

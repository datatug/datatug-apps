import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  RouterLink,
} from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import { AgentContextService } from '@sneat/datatug-semantic';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DetectiveClientService } from './detective-client.service';
import { DetectiveState } from './models';
import { ScenarioDetailPageComponent } from './scenario-detail-page.component';

const state: DetectiveState = {
  checks: [],
  validators: [],
  queryValidators: [],
  cases: [],
  runs: [],
  scenarios: [
    {
      id: 'invoice-review',
      title: 'Review invoice totals',
      description: 'Investigate a mismatched invoice.',
      version: 2,
      inputs: [
        {
          name: 'invoice_id',
          type: 'string',
          cardinality: 'scalar',
          required: true,
        },
      ],
      steps: [{ id: 'find-invoice', kind: 'query', ref: 'invoice-by-id' }],
    },
  ],
  runsHasMore: false,
  capabilities: {
    localOnly: false,
    canRead: true,
    canWrite: false,
    canRun: false,
    maxRows: 500,
    maxFanout: 100,
  },
};

describe('ScenarioDetailPageComponent', () => {
  const params = new BehaviorSubject(
    convertToParamMap({ scenarioId: 'invoice-review' }),
  );
  const response = new Subject<DetectiveState>();
  const client = { state: vi.fn(() => response.asObservable()) };
  const project = new BehaviorSubject({
    ref: {
      storeId: 'firestore',
      spaceID: 'space-1',
      projectId: 'project-1',
    } as IProjectRef,
  });

  beforeEach(async () => {
    params.next(convertToParamMap({ scenarioId: 'invoice-review' }));
    project.next({
      ref: {
        storeId: 'firestore',
        spaceID: 'space-1',
        projectId: 'project-1',
      },
    });
    client.state.mockClear();
    await TestBed.configureTestingModule({
      imports: [ScenarioDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: DetectiveClientService, useValue: client },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: project,
            currentEnv: of(undefined),
          },
        },
        {
          provide: AgentContextService,
          useValue: {
            contextFor: () => ({ securityContextId: () => 'session-1' }),
          },
        },
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ user: { uid: 'actor-1' } }) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: params.value },
            paramMap: params.asObservable(),
          },
        },
      ],
    }).compileComponents();
  });

  it('loads a cold URL by Scenario ID and displays the saved manual steps', async () => {
    const fixture = TestBed.createComponent(ScenarioDetailPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(client.state).toHaveBeenCalledOnce();
    response.next(state);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      scenario(): DetectiveState['scenarios'][number] | undefined;
    };
    expect(page.scenario()).toEqual(state.scenarios[0]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Investigate a mismatched invoice');
    expect(text).toContain('1 manual step');
    expect(text).toContain('Apply it from a compatible Case');
  });

  it('shows a missing Scenario without treating its ID as a Case', async () => {
    params.next(convertToParamMap({ scenarioId: 'missing' }));
    const fixture = TestBed.createComponent(ScenarioDetailPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    response.next(state);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Scenario missing was not found',
    );
    expect(fixture.nativeElement.textContent).toContain('Back to Detective');
  });

  it('keeps qualified local context on the Back to Detective link', async () => {
    project.next({
      ref: {
        storeId: 'http-localhost:8989',
        projectId: 'demo',
        projectApi: 'local',
        branch: 'feature/demo',
      },
    });
    params.next(convertToParamMap({ scenarioId: 'missing' }));
    const fixture = TestBed.createComponent(ScenarioDetailPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    response.next(state);
    fixture.detectChanges();
    const back = fixture.debugElement.query(By.directive(RouterLink));
    const tree = back?.injector.get(RouterLink).urlTree;
    expect(tree?.root.children['primary'].segments.at(-1)?.path).toBe(
      'detective',
    );
    expect(tree?.queryParams).toEqual({
      projectApi: 'local',
      branch: 'feature/demo',
    });
  });

  it('ignores an old response after navigating to another Scenario', async () => {
    const oldResponse = new Subject<DetectiveState>();
    const newResponse = new Subject<DetectiveState>();
    client.state
      .mockImplementationOnce(() => oldResponse.asObservable())
      .mockImplementationOnce(() => newResponse.asObservable());
    const fixture = TestBed.createComponent(ScenarioDetailPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    params.next(convertToParamMap({ scenarioId: 'second-review' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(client.state).toHaveBeenCalledTimes(2);
    oldResponse.next(state);
    newResponse.next({
      ...state,
      scenarios: [
        { ...state.scenarios[0], id: 'second-review', title: 'Second review' },
      ],
    });
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as {
      scenario(): DetectiveState['scenarios'][number] | undefined;
    };
    expect(page.scenario()?.title).toBe('Second review');
  });
});

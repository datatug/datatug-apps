import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  RouterLink,
} from '@angular/router';
import { SneatAuthStateService } from '@sneat/auth-core';
import {
  AgentContextService,
  InvestigationContextService,
} from '@sneat/datatug-semantic';
import { signal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { CasesPageComponent } from './cases-page.component';
import { DetectiveClientService } from './detective-client.service';
import { DetectiveState } from './models';

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
      version: 1,
      inputs: [],
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

describe('Detective Scenario list navigation', () => {
  it('links a saved Scenario row to its project-scoped detail page', async () => {
    await TestBed.configureTestingModule({
      imports: [CasesPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DetectiveClientService,
          useValue: { state: () => of(state) },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: new BehaviorSubject({
              ref: {
                storeId: 'firestore',
                spaceID: 'space-1',
                projectId: 'project-1',
              },
            }),
            currentEnv: of(undefined),
          },
        },
        { provide: AgentContextService, useValue: {} },
        {
          provide: SneatAuthStateService,
          useValue: { authState: of({ user: { uid: 'actor-1' } }) },
        },
        {
          provide: InvestigationContextService,
          useValue: { scope: signal(undefined), items: signal([]) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({}),
              queryParamMap: convertToParamMap({}),
            },
            paramMap: of(convertToParamMap({})),
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CasesPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const links = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((element) => element.injector.get(RouterLink).urlTree?.toString());
    expect(links).toContain(
      '/space/space-1/store/firestore/project/project-1/detective/scenario/invoice-review',
    );
  });
});

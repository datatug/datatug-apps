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
import { IProjectRef } from '../core/project-context';
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
  async function scenarioLink(ref: IProjectRef) {
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
            currentProject: new BehaviorSubject({ ref }),
            currentEnv: of(undefined),
          },
        },
        {
          provide: AgentContextService,
          useValue: {
            contextFor: () => ({ securityContextId: signal('session-1') }),
          },
        },
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
    return fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .find(
        (element) =>
          element.nativeElement.getAttribute('aria-label') ===
          'View Scenario Review invoice totals',
      );
  }

  it('links a saved Scenario row to its shared project detail page', async () => {
    const link = await scenarioLink({
      storeId: 'firestore',
      spaceID: 'space-1',
      projectId: 'project-1',
    });
    expect(link?.injector.get(RouterLink).urlTree?.toString()).toBe(
      '/space/space-1/store/firestore/project/project-1/detective/scenario/invoice-review',
    );
    expect(link?.nativeElement.tagName).toBe('A');
    expect(
      link?.nativeElement.closest('ion-item')?.hasAttribute('button'),
    ).toBe(false);
  });

  it('keeps local project qualifiers as query params on the actual link', async () => {
    const link = await scenarioLink({
      storeId: 'http-localhost:8989',
      projectId: 'demo',
      projectApi: 'local',
      branch: 'feature/demo',
    });
    const tree = link?.injector.get(RouterLink).urlTree;
    expect(
      tree?.root.children['primary'].segments
        .slice(-3)
        .map((segment) => segment.path),
    ).toEqual(['detective', 'scenario', 'invoice-review']);
    expect(tree?.queryParams).toEqual({
      projectApi: 'local',
      branch: 'feature/demo',
    });
    expect(link?.nativeElement.getAttribute('href')).toContain(
      '?projectApi=local&branch=feature%2Fdemo',
    );
    expect(
      link?.nativeElement.closest('ion-item')?.hasAttribute('button'),
    ).toBe(false);
  });
});

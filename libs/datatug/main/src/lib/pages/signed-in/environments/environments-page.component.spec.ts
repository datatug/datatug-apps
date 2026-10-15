import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { EnvironmentsPageComponent } from './environments-page.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { ProjectService } from '../../../services/project/project.service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';

describe('EnvironmentsPage', () => {
  let component: EnvironmentsPageComponent;
  let fixture: ComponentFixture<EnvironmentsPageComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { projSummary: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [EnvironmentsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
          },
        },
        // `EnvironmentsPageComponent` fetches its environments list via
        // `ProjectService.getFull()`, not `project?.environments` (Task 17
        // item B.1, S121 — see the component's own doc comment on
        // `environments`): `currentProject` above emits `undefined` in this
        // describe block, so `loadEnvironments()` never actually runs, but
        // the component now injects `ProjectService` unconditionally and
        // `TestBed` needs a provider for it regardless.
        {
          provide: ProjectService,
          useValue: { getFull: vi.fn(() => of({ environments: [] })) },
        },
        // GitHub-store branch (`loadEnvironments()`) reads through
        // `EnvironmentService.listEnvironments()` instead — see this
        // component's own doc comment. `currentProject` above emits
        // `undefined`, so `loadEnvironments()` never actually runs here
        // either, but `TestBed` needs a provider regardless (now
        // unconditionally injected).
        {
          provide: EnvironmentService,
          useValue: { listEnvironments: vi.fn(() => of([])) },
        },
      ],
    })
      .overrideComponent(EnvironmentsPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvironmentsPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('EnvironmentsPage metadata', () => {
  it('renders late metadata, retains IDs in navigation, and cancels a replaced project', async () => {
    const { BehaviorSubject, Subject } = await import('rxjs');
    const project = { ref: { storeId: 'github.com', projectId: 'r@o@' } };
    const currentProject = new BehaviorSubject<
      import('../../../nav/nav-models').IProjectContext
    >(project);
    const first = new Subject<
      import('../../../models/definition/environments').IEnvironmentFull[]
    >();
    const next = new Subject<
      import('../../../models/definition/environments').IEnvironmentFull[]
    >();
    const goEnvironment = vi.fn();
    const navToken = (await import('../../../services/nav/datatug-nav.service'))
      .DatatugNavService;
    const listEnvironments = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(next);
    await TestBed.configureTestingModule({
      imports: [EnvironmentsPageComponent],
      providers: [
        { provide: DatatugNavContextService, useValue: { currentProject } },
        { provide: ProjectService, useValue: {} },
        { provide: EnvironmentService, useValue: { listEnvironments } },
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        { provide: navToken, useValue: { goEnvironment } },
      ],
    })
      .overrideComponent(EnvironmentsPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(EnvironmentsPageComponent);
    fixture.detectChanges();
    const env = {
      id: 'live-a',
      title: 'live-a',
      presentation: { label: 'Production', tone: 'danger' as const },
    };
    first.next([env]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Production');
    expect(fixture.nativeElement.textContent).toContain('High caution');
    fixture.nativeElement
      .querySelector('[data-testid="environment-list-item"]')
      .click();
    expect(goEnvironment).toHaveBeenCalledWith(project, env);
    currentProject.next({
      ref: { storeId: 'github.com', projectId: 'r@o@', branch: 'release' },
    });
    first.next([env]);
    next.next([{ id: 'qa', title: 'Quality assurance' }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Quality assurance');
    expect(fixture.nativeElement.textContent).not.toContain('Production');
  });
});

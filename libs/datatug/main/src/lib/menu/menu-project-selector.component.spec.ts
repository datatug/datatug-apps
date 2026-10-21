import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject, of, Subject } from 'rxjs';

import { NewProjectService } from '../project/new-project/new-project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { MenuProjectSelectorComponent } from './menu-project-selector.component';
import { IProjectContext } from '../nav/nav-models';
import { IProjectBase } from '../models/definition/project';
import { DatatugStoreService } from '../services/repo/datatug-store.service';

describe('MenuProjectSelectorComponent', () => {
  it('refreshes project options when the current store changes', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>(
      'github.com',
    );
    const currentProject = new BehaviorSubject<IProjectContext | undefined>(undefined);
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
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
          provide: NewProjectService,
          useValue: { navigateToNewProjectPage: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId,
            currentProject,
            setCurrentProject: vi.fn(),
          },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
        { provide: DatatugStoreService, useValue: { getProjects: vi.fn(() => of([])) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          'github.com': {
            type: 'github',
            title: 'GitHub',
            projects: { repo: { title: 'Repository' } },
          },
          firestore: {
            type: 'firestore',
            title: 'Cloud',
            projects: { cloud: { title: 'Cloud project' } },
          },
        },
      },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.projects()?.map(({ id }) => id)).toEqual([
      'repo',
    ]);

    currentStoreId.next('firestore');
    await fixture.whenStable();

    expect(fixture.componentInstance.projects()?.map(({ id }) => id)).toEqual([
      'cloud',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Cloud project');
    expect(fixture.nativeElement.querySelector('ion-select')?.getAttribute('label')).toBe('Project');
    expect(fixture.nativeElement.querySelector('ion-select')?.getAttribute('labelPlacement')).toBe('floating');
  });

  it('selects the chosen project and navigates with its store context', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>('github.com');
    const currentProject = new BehaviorSubject<IProjectContext | undefined>(undefined);
    const setCurrentProject = vi.fn();
    const goProject = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
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
          provide: NewProjectService,
          useValue: { navigateToNewProjectPage: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: { currentStoreId, currentProject, setCurrentProject },
        },
        { provide: DatatugNavService, useValue: { goProject } },
        { provide: DatatugStoreService, useValue: { getProjects: vi.fn(() => of([])) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          'github.com': {
            type: 'github',
            title: 'GitHub.com',
            projects: { demo: { title: 'Demo', projectApi: 'cloud', branch: 'main' } },
          },
        },
      },
    });
    fixture.detectChanges();

    fixture.componentInstance.switchProject({
      detail: { value: 'demo' },
    } as CustomEvent);

    expect(setCurrentProject).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { projectId: 'demo', storeId: 'github.com', projectApi: 'cloud', branch: 'main' },
      }),
    );
    expect(goProject).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { projectId: 'demo', storeId: 'github.com', projectApi: 'cloud', branch: 'main' },
      }),
    );
  });

  it('keeps the current public demo selectable with its exact project reference', async () => {
    const ref = {
      projectId: 'datatug-demo-project@datatug@demo-project-1',
      storeId: 'github.com',
      projectApi: 'cloud' as const,
      branch: 'release/demo',
    };
    const currentStoreId = new BehaviorSubject<string | undefined>('github.com');
    const currentProject = new BehaviorSubject<IProjectContext | undefined>({
      ref,
      summary: { id: ref.projectId, title: 'DataTug Demo: DemoDB datasets' },
    } as IProjectContext);
    const setCurrentProject = vi.fn();
    const goProject = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) } },
        { provide: NewProjectService, useValue: { navigateToNewProjectPage: vi.fn() } },
        { provide: DatatugNavContextService, useValue: { currentStoreId, currentProject, setCurrentProject } },
        { provide: DatatugNavService, useValue: { goProject } },
        { provide: DatatugStoreService, useValue: { getProjects: vi.fn(() => of([])) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: { stores: { 'github.com': { type: 'github', title: 'GitHub.com' } } },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.projects().map(({ id }) => id)).toEqual([ref.projectId]);
    expect(fixture.componentInstance.projects()[0].title).toBe('DataTug Demo: DemoDB datasets');
    expect(fixture.componentInstance.projectChoiceDescription(fixture.componentInstance.projects()[0])).toBe('datatug/datatug-demo-project · demo-project-1');
    fixture.componentInstance.switchProject({ detail: { value: ref.projectId } } as CustomEvent);
    expect(goProject).toHaveBeenCalledWith(expect.objectContaining({ ref }));
    expect(setCurrentProject).toHaveBeenCalledWith(expect.objectContaining({ ref }));
  });

  it('loads real agent projects and ignores a late result after the store changes', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>('http-localhost:8989');
    const currentProject = new BehaviorSubject<IProjectContext | undefined>(undefined);
    const projects = new Subject<IProjectBase[]>();
    const getProjects = vi.fn(() => projects.asObservable());
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) } },
        { provide: NewProjectService, useValue: { navigateToNewProjectPage: vi.fn() } },
        { provide: DatatugNavContextService, useValue: { currentStoreId, currentProject, setCurrentProject: vi.fn() } },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
        { provide: DatatugStoreService, useValue: { getProjects } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.detectChanges();
    expect(getProjects).toHaveBeenCalledWith('http-localhost:8989');
    expect(fixture.componentInstance.projectListState()).toBe('loading');

    projects.next([{ id: 'local-one', title: 'Local one', access: 'private' }]);
    expect(fixture.componentInstance.projects().map(({ id }) => id)).toEqual(['local-one']);

    currentStoreId.next('firestore');
    expect(fixture.componentInstance.projects()).toEqual([]);
    projects.next([{ id: 'stale-agent-project', title: 'Stale', access: 'private' }]);
    expect(fixture.componentInstance.projects()).toEqual([]);
  });

  it('keeps saved project choices and reports an agent project-list error', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>(
      'http-localhost:8989',
    );
    const currentProject = new BehaviorSubject<IProjectContext | undefined>(
      undefined,
    );
    const projects = new Subject<IProjectBase[]>();
    const logError = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) } },
        { provide: NewProjectService, useValue: { navigateToNewProjectPage: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: { currentStoreId, currentProject, setCurrentProject: vi.fn() },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
        {
          provide: DatatugStoreService,
          useValue: { getProjects: vi.fn(() => projects.asObservable()) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          'http-localhost:8989': {
            type: 'agent',
            title: 'Local',
            projects: { saved: { title: 'Saved project' } },
          },
        },
      },
    });
    fixture.detectChanges();

    projects.error(new Error('agent is unavailable'));
    fixture.detectChanges();

    expect(fixture.componentInstance.projectListState()).toBe('error');
    expect(fixture.componentInstance.projects().map(({ id }) => id)).toEqual([
      'saved',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Saved project');
    expect(fixture.nativeElement.textContent).toContain('Could not load all projects');
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to list projects in the selected store',
    );
  });

  it('keeps the current project selectable and exposes an accessible icon-only add action', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>('firestore');
    const currentProject = new BehaviorSubject<IProjectContext | undefined>({
      ref: { storeId: 'firestore', projectId: 'detective-demo' },
      summary: { title: 'Detective demo with a long project title' },
    });
    const navigateToNewProjectPage = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuProjectSelectorComponent],
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
          provide: NewProjectService,
          useValue: { navigateToNewProjectPage },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentStoreId,
            currentProject,
            setCurrentProject: vi.fn(),
          },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
        {
          provide: DatatugStoreService,
          useValue: { getProjects: vi.fn(() => of([])) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          firestore: { type: 'firestore', title: 'Cloud', projects: {} },
        },
      },
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.projects().map(({ id }) => id)).toEqual([
      'detective-demo',
    ]);
    expect(fixture.nativeElement.textContent).toContain(
      'Detective demo with a long project title',
    );
    const button = fixture.nativeElement.querySelector(
      'ion-button[aria-label="New project"]',
    );
    expect(button?.getAttribute('title')).toBe('New project');
    expect(button?.textContent?.trim()).toBe('');
    expect(button?.querySelector('ion-icon')?.getAttribute('slot')).toBe(
      'icon-only',
    );
    button?.click();
    expect(navigateToNewProjectPage).toHaveBeenCalledOnce();
  });
});

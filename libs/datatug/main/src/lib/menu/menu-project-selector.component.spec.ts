import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { BehaviorSubject } from 'rxjs';

import { NewProjectService } from '../project/new-project/new-project.service';
import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { MenuProjectSelectorComponent } from './menu-project-selector.component';

describe('MenuProjectSelectorComponent', () => {
  it('refreshes project options when the current store changes', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>(
      'github.com',
    );
    const currentProject = new BehaviorSubject<undefined>(undefined);
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
    const select = fixture.nativeElement.querySelector('ion-select');
    expect(select?.getAttribute('label')).toBe('Project');
    expect(select?.getAttribute('labelplacement')).toBe('floating');
    expect(select?.classList.contains('project-selector')).toBe(true);

    currentStoreId.next('firestore');
    await fixture.whenStable();

    expect(fixture.componentInstance.projects()?.map(({ id }) => id)).toEqual([
      'cloud',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Cloud project');
  });

  it('selects the chosen project and navigates with its store context', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>('firestore');
    const currentProject = new BehaviorSubject<undefined>(undefined);
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
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          firestore: {
            type: 'firestore',
            title: 'Cloud',
            projects: { demo: { title: 'Demo' } },
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
        ref: { projectId: 'demo', storeId: 'firestore' },
      }),
    );
    expect(goProject).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { projectId: 'demo', storeId: 'firestore' },
      }),
    );
  });

  it('shows one wrapped read-only title and an accessible icon-only new-project action', async () => {
    const currentStoreId = new BehaviorSubject<string | undefined>('firestore');
    const currentProject = new BehaviorSubject({
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
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuProjectSelectorComponent);
    fixture.componentRef.setInput('datatugUser', {
      datatug: {
        stores: {
          firestore: {
            type: 'firestore',
            title: 'Cloud',
            projects: {},
          },
        },
      },
    });
    fixture.detectChanges();

    const readonly = fixture.nativeElement.querySelector(
      'ion-label.project-readonly',
    );
    expect(readonly?.querySelector('p')?.textContent).toBe('Project');
    expect(readonly?.querySelector('h2')?.textContent).toContain(
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

    fixture.componentInstance.projects.set(undefined);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        'ion-button[aria-label="New project"]',
      )?.disabled,
    ).toBe(true);
  });
});

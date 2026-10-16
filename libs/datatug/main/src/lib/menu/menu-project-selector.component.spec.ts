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
});

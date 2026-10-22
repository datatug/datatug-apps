import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProjectRef } from '../core/project-context';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';

import { DatatugNavContextService } from '../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../services/nav/datatug-nav.service';
import { EnvironmentService } from '../services/unsorted/environment.service';
import { MenuEnvSelectorComponent } from './menu-env-selector.component';
import { provideMockErrorLogger } from '../testing/error-logger.spec-helper';

describe('MenuEnvSelectorComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });
  it('hides old project environments while the next project is loading', async () => {
    const nextProjectEnvironments = new Subject<
      { id: string; title: string }[]
    >();
    const listEnvironments = vi.fn((project: IProjectRef) =>
      project.projectId === 'old'
        ? of([{ id: 'old-env', title: 'Old' }])
        : nextProjectEnvironments.asObservable(),
    );
    await TestBed.configureTestingModule({
      imports: [MenuEnvSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn() },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            setCurrentEnvironment: vi.fn(),
            clearCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: DatatugNavService,
          useValue: { goEnvironment: vi.fn(), goProject: vi.fn() },
        },
        { provide: EnvironmentService, useValue: { listEnvironments } },
      ],
    })
      .overrideComponent(MenuEnvSelectorComponent, {
        set: {
          imports: [],
          template: '<span>{{ environments().length }}</span>',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    const fixture = TestBed.createComponent(MenuEnvSelectorComponent);
    fixture.componentRef.setInput('project', {
      ref: { projectId: 'old', storeId: 'github.com' },
    });
    fixture.detectChanges();
    expect(
      fixture.componentInstance.environments().map(({ id }) => id),
    ).toEqual(['old-env']);

    fixture.componentRef.setInput('project', {
      ref: { projectId: 'new', storeId: 'github.com' },
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.environments()).toEqual([]);

    nextProjectEnvironments.next([{ id: 'new-env', title: 'New' }]);
    await fixture.whenStable();
    expect(
      fixture.componentInstance.environments().map(({ id }) => id),
    ).toEqual(['new-env']);
  });

  it('lists the GitHub project environment folders and navigates with a selected environment', async () => {
    const listEnvironments = vi.fn(() =>
      of([
        { id: 'local', title: 'local' },
        { id: 'prod', title: 'prod' },
      ]),
    );
    const setCurrentEnvironment = vi.fn();
    const goEnvironment = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuEnvSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: DatatugNavContextService,
          useValue: { setCurrentEnvironment, clearCurrentEnvironment: vi.fn() },
        },
        {
          provide: DatatugNavService,
          useValue: { goEnvironment, goProject: vi.fn() },
        },
        { provide: EnvironmentService, useValue: { listEnvironments } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuEnvSelectorComponent);
    fixture.componentRef.setInput('project', {
      ref: {
        projectId: 'demo',
        storeId: 'github.com',
        branch: 'review',
        projectApi: 'cloud',
      },
      summary: {
        id: 'demo',
        title: 'Demo',
        access: 'public',
        environments: [{ id: 'stale', title: 'Stale summary' }],
      },
    });
    fixture.componentRef.setInput('currentEnvId', 'local');
    fixture.detectChanges();

    expect(listEnvironments).toHaveBeenCalledWith({
      projectId: 'demo',
      storeId: 'github.com',
      branch: 'review',
      projectApi: 'cloud',
    });
    expect(
      fixture.componentInstance.environments().map(({ id }) => id),
    ).toEqual(['local', 'prod']);
    expect(
      fixture.nativeElement.querySelector('.menu-env-heading a')?.textContent,
    ).toContain('Environments');
    expect(
      fixture.nativeElement.querySelector('ion-badge')?.textContent,
    ).toContain('2');
    expect(fixture.nativeElement.querySelector('ion-select')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Clear environment"]'),
    ).not.toBeNull();
    fixture.componentRef.setInput('currentEnvId', undefined);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-select')).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('.menu-env-choices ion-button'),
    ).toHaveLength(2);
    expect(
      fixture.nativeElement.querySelector('[aria-label="Clear environment"]'),
    ).toBeNull();
    fixture.componentInstance.switchEnv({
      detail: { value: 'prod' },
    } as CustomEvent);
    expect(setCurrentEnvironment).toHaveBeenCalledWith('prod');
    expect(goEnvironment).toHaveBeenCalledWith(
      fixture.componentInstance.project(),
      undefined,
      'prod',
    );
  });

  it('clears the persisted choice through nav context before returning to the project', async () => {
    const clearCurrentEnvironment = vi.fn();
    const goProject = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MenuEnvSelectorComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        provideMockErrorLogger(),
        {
          provide: DatatugNavContextService,
          useValue: { setCurrentEnvironment: vi.fn(), clearCurrentEnvironment },
        },
        {
          provide: DatatugNavService,
          useValue: { goEnvironment: vi.fn(), goProject },
        },
        {
          provide: EnvironmentService,
          useValue: { listEnvironments: vi.fn(() => of([])) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(MenuEnvSelectorComponent);
    const project = {
      ref: { projectId: 'demo', storeId: 'firestore' },
      summary: { id: 'demo' },
    };
    fixture.componentRef.setInput('project', project);
    fixture.componentRef.setInput('currentEnvId', 'prod');
    fixture.detectChanges();

    fixture.componentInstance.clearEnv();

    expect(clearCurrentEnvironment).toHaveBeenCalledOnce();
    expect(goProject).toHaveBeenCalledWith(project);
  });
});

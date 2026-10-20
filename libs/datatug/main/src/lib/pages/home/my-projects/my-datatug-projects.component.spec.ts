import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { Subject, of } from 'rxjs';
import { Router } from '@angular/router';

import { MyDatatugProjectsComponent } from './my-datatug-projects.component';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { NewProjectService } from '../../../project/new-project/new-project.service';
import { DetectiveClientService } from '../../../detective/detective-client.service';

describe('MyProjectsComponent', () => {
  let component: MyDatatugProjectsComponent;
  let fixture: ComponentFixture<MyDatatugProjectsComponent>;
  let userState$: Subject<{ status: string; record: null }>;
  const router = {
    url: '/home',
    createUrlTree: vi.fn((commands: unknown[], options?: unknown) => ({
      commands,
      options,
    })),
    serializeUrl: vi.fn(() => '/new-project?returnUrl=%2Fhome'),
    navigateByUrl: vi.fn(),
  };
  const newProjectService = { navigateToNewProjectPage: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    userState$ = new Subject();
    await TestBed.configureTestingModule({
      imports: [MyDatatugProjectsComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: DatatugNavService, useValue: { goProject: vi.fn() } },
        { provide: Router, useValue: router },
        {
          provide: SneatAuthStateService,
          useValue: {
            authState: of({ status: undefined }),
            authStatus: of(undefined),
          },
        },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: userState$.asObservable(),
          },
        },
        {
          provide: NewProjectService,
          useValue: newProjectService,
        },
        { provide: DetectiveClientService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MyDatatugProjectsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('always shows Add and routes unsigned users through login to new project', () => {
    component.authState = { status: 'notAuthenticated' } as never;
    fixture.detectChanges();

    const addButton = fixture.nativeElement.querySelector('ion-button');
    expect(addButton).toBeTruthy();
    addButton.click();

    expect(router.createUrlTree).toHaveBeenNthCalledWith(1, ['/new-project'], {
      queryParams: { returnUrl: '/home' },
    });
    expect(router.serializeUrl).toHaveBeenCalledTimes(1);
    expect(router.createUrlTree).toHaveBeenNthCalledWith(2, ['/login'], {
      queryParams: { returnTo: '/new-project?returnUrl=%2Fhome' },
    });
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(newProjectService.navigateToNewProjectPage).not.toHaveBeenCalled();
  });

  it('shows the empty state after an authenticated user record has loaded', async () => {
    userState$.next({ status: 'authenticated', record: null });
    expect(component.authState?.status).toBe('authenticated');
    expect(component.userRecordLoaded).toBe(true);
    expect(component.projects).toEqual([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain(
      'You have no personal or shared projects yet.',
    );
    expect(
      fixture.nativeElement.querySelector('.empty-project-visual')?.getAttribute('src'),
    ).toBe('assets/home/empty-harbour-pencil.webp');
  });

  it('shows the empty-project illustration only for signed-out or loaded-empty states', async () => {
    userState$.next({ status: 'authenticating', record: null });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-project-visual')).toBeNull();

    userState$.next({ status: 'notAuthenticated', record: null });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-project-visual')).toBeTruthy();

    userState$.next({ status: 'authenticated', record: undefined } as never);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-project-visual')).toBeNull();

    userState$.next({ status: 'authenticated', record: null });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-project-visual')).toBeTruthy();

    userState$.next({
      status: 'authenticated',
      record: {
        datatug: {
          stores: {
            github: {
              title: 'GitHub',
              type: 'github',
              projects: { demo: { title: 'Demo project' } },
            },
          },
        },
      },
    } as never);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.empty-project-visual')).toBeNull();
  });

  it('uses the existing new-project navigation for authenticated users', () => {
    component.authState = { status: 'authenticated' } as never;
    component.addProject();

    expect(newProjectService.navigateToNewProjectPage).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('gives each demo the same visual structure and one action', () => {
    fixture.detectChanges();

    const divider = fixture.nativeElement.querySelector(
      '.demo-list ion-item-divider',
    );
    const entries = fixture.nativeElement.querySelectorAll(
      '.demo-details[data-demo-slot]',
    );
    expect(divider.getAttribute('color')).toBe('light');
    expect(entries).toHaveLength(component.demoOptions.length);

    const entry = entries[0] as HTMLElement;
    expect(entry.querySelector('.demo-copy h3')?.textContent).toContain(
      'DataTug public demo',
    );
    expect(entry.querySelector('.demo-provider')?.textContent).toContain(
      'Public · GitHub',
    );
    expect(entry.querySelector('.demo-summary')?.textContent).toContain(
      'Browse the project and three saved Chinook SQL examples.',
    );
    expect(entry.querySelectorAll('ion-button')).toHaveLength(1);
    expect(
      entry.querySelector('[data-testid="open-demo-github"]'),
    ).toBeTruthy();
    expect(entry.querySelector('ion-item[button]')).toBeNull();
    expect(entry.querySelector('.demo-visual')).toBeTruthy();
    const privateDemo = fixture.nativeElement.querySelector(
      '.private-demo-entry',
    );
    expect(privateDemo?.querySelector('h3')?.textContent).toContain(
      'Detective demo',
    );
    expect(privateDemo?.querySelector('.demo-summary')?.textContent).toContain(
      'Create a private Detective project and explore its case workflow.',
    );
    expect(privateDemo?.querySelectorAll('ion-button')).toHaveLength(1);
    expect(
      privateDemo?.querySelector('sneat-datatug-detective-demo-starter'),
    ).toBeTruthy();
    expect(privateDemo?.closest('.demo-list')).toBeTruthy();
    expect(privateDemo?.querySelector('.demo-visual')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Try Detective with real checks',
    );
  });

  it('opens the public demo from its single CTA', () => {
    fixture.detectChanges();
    const nav = TestBed.inject(DatatugNavService) as unknown as {
      goProject: ReturnType<typeof vi.fn>;
    };

    fixture.nativeElement
      .querySelector('[data-testid="open-demo-github"]')
      .click();

    expect(nav.goProject).toHaveBeenCalledTimes(1);
    expect(nav.goProject.mock.calls[0][0].brief.title).toBe(
      'DataTug public demo',
    );
  });

  // G-A1c: the demo entry opens the one shared nested project; the nav service writes its canonical path.
  it('opens the shared demo project, whose title is unchanged', () => {
    const nav = TestBed.inject(DatatugNavService) as unknown as {
      goProject: ReturnType<typeof vi.fn>;
    };
    expect(component.demoProjects).toHaveLength(1);
    const [demo] = component.demoProjects;
    expect(demo.title).toBe('DataTug public demo');

    component.goDemoProject(demo);

    expect(nav.goProject).toHaveBeenCalledTimes(1);
    expect(nav.goProject.mock.calls[0][0]).toMatchObject({
      ref: {
        storeId: 'github',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      },
      brief: { title: 'DataTug public demo', access: 'public' },
    });
  });
});

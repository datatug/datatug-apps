import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { SneatAuthStateService } from '@sneat/auth-core';
import { of } from 'rxjs';

import { MyDatatugProjectsComponent } from './my-datatug-projects.component';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { NewProjectService } from '../../../project/new-project/new-project.service';

describe('MyProjectsComponent', () => {
  let component: MyDatatugProjectsComponent;
  let fixture: ComponentFixture<MyDatatugProjectsComponent>;

  beforeEach(async () => {
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
            datatugUserState: of({ status: undefined, record: null }),
          },
        },
        {
          provide: NewProjectService,
          useValue: { navigateToNewProjectPage: vi.fn() },
        },
      ],
    })
      .overrideComponent(MyDatatugProjectsComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MyDatatugProjectsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // G-A1c: the demo entry opens the one shared nested project; the nav service writes its canonical path.
  it('opens the shared demo project, whose title is unchanged', () => {
    const nav = TestBed.inject(DatatugNavService) as unknown as {
      goProject: ReturnType<typeof vi.fn>;
    };
    expect(component.demoProjects).toHaveLength(1);
    const [demo] = component.demoProjects;
    expect(demo.title).toBe('DataTug Demo Project @ GitHub');

    component.goDemoProject(demo);

    expect(nav.goProject).toHaveBeenCalledTimes(1);
    expect(nav.goProject.mock.calls[0][0]).toMatchObject({
      ref: {
        storeId: 'github',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      },
      brief: { title: 'DataTug Demo Project @ GitHub', access: 'public' },
    });
  });
});

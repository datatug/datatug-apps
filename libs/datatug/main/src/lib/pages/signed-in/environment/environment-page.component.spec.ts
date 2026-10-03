import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { EnvironmentPageComponent } from './environment-page.component';
import { EnvironmentService } from '../../../services/unsorted/environment.service';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';

describe('EnvironmentPage', () => {
  let component: EnvironmentPageComponent;
  let fixture: ComponentFixture<EnvironmentPageComponent>;
  let navigateForward: ReturnType<typeof vi.fn>;
  let logError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    navigateForward = vi.fn(() => Promise.resolve(true));
    logError = vi.fn();
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { projEnv: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [EnvironmentPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null } },
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
        {
          provide: NavController,
          useValue: { navigateForward },
        },
        {
          provide: ErrorLogger,
          useValue: {
            logError,
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
      ],
    })
      .overrideComponent(EnvironmentPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EnvironmentPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // G-A1c: with no history the back button goes to the store page of the project's own store (it was always the
  // default local agent's, whatever the project), and, until the project is known, still to that one.
  it.each([
    ['no project yet', undefined, '/store/localhost:8989'],
    [
      'an agent project',
      { storeId: 'localhost:8989', projectId: 'p1' },
      '/store/localhost:8989',
    ],
    [
      'a project of another agent',
      { storeId: 'http-example.com', projectId: 'p1' },
      '/store/http-example.com',
    ],
    [
      'a GitHub project',
      { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      '/store/github.com',
    ],
  ])('the back button of %s goes to %s', (_name, ref, href) => {
    component.project = ref ? { ref } : undefined;
    expect(component.defaultBackUrl).toBe(href);
  });

  describe('opening a server of the environment', () => {
    const server = { host: 'db1' } as Parameters<
      EnvironmentPageComponent['goDbServer']
    >[0];

    it.each([
      [
        'an agent project',
        { storeId: 'localhost:8989', projectId: 'p1' },
        '/store/localhost:8989/project/p1/env/local/servers/dbserver/db1',
      ],
      [
        'a GitHub project',
        { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
        '/project/github.com/datatug/chinook-demo/env/local/servers/dbserver/db1',
      ],
      [
        'a GitHub project in a folder',
        { storeId: 'github.com', projectId: 'r@o@d' },
        '/project/github.com/o/r/tree/HEAD/d/-/env/local/servers/dbserver/db1',
      ],
    ])('navigates to the address of %s', (_name, ref, address) => {
      component.project = { ref };
      component.projEnv = { id: 'local' } as typeof component.projEnv;

      component.goDbServer(server);

      expect(navigateForward).toHaveBeenCalledWith(address, {
        state: { envServer: server },
      });
      expect(logError).not.toHaveBeenCalled();
    });

    it('names the environment by the one the nav context is on when the page was opened without one', () => {
      component.project = {
        ref: { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      };
      component.projEnv = undefined;
      (component as unknown as { envId?: string }).envId = 'prod';

      component.goDbServer(server);

      expect(navigateForward).toHaveBeenCalledWith(
        '/project/github.com/datatug/chinook-demo/env/prod/servers/dbserver/db1',
        { state: { envServer: server } },
      );
    });

    it('navigates nowhere when the environment is not known at all', () => {
      component.project = {
        ref: { storeId: 'github.com', projectId: 'chinook-demo@datatug@' },
      };
      component.projEnv = undefined;

      component.goDbServer(server);

      expect(navigateForward).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no project', undefined],
      [
        'a project with no exact address',
        { storeId: 'localhost:8989', projectId: '50%' },
      ],
    ])('navigates nowhere, and says so, for %s', (_name, ref) => {
      component.project = ref ? { ref } : undefined;
      component.projEnv = { id: 'local' } as typeof component.projEnv;

      component.goDbServer(server);

      expect(navigateForward).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to navigate to db page',
      );
    });
  });
});

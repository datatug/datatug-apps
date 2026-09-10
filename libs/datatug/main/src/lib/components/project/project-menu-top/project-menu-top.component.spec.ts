import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { ProjectMenuTopComponent } from './project-menu-top.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../services/nav/datatug-nav.service';
import { DatatugUserService } from '../../../services/base/datatug-user-service';
import { datatugProjectRoutes } from '../../../routes/datatug-routing-proj';

describe('ProjectContextMenuComponent', () => {
  let component: ProjectMenuTopComponent;
  let fixture: ComponentFixture<ProjectMenuTopComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectMenuTopComponent],
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
            currentFolder: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        { provide: DatatugNavService, useValue: { goProjPage: vi.fn() } },
        {
          provide: DatatugUserService,
          useValue: {
            datatugUserState: of({ status: undefined, record: null }),
          },
        },
      ],
    })
      .overrideComponent(ProjectMenuTopComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectMenuTopComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('REQ:context-basket — links to the Investigation Context screen (the former "Variables" empty-shell entry), unconditionally', () => {
    const entry = component.projTopLevelPages.find(
      (page) => page.path === 'variables',
    );
    expect(entry).toMatchObject({
      path: 'variables',
      title: 'Investigation Context',
    });
  });

  // Regression coverage for the founder-reported NG04002 ("Overview" 404):
  // every item actually rendered in the side menu must resolve to a route
  // under `store/:storeId/project/:projectId/*` — a menu entry with no
  // matching route is exactly the class of bug this test catches, without
  // booting the router (imports the routes array directly and matches
  // paths, per the task brief).
  it('every rendered projTopLevelPages entry has a matching datatugProjectRoutes path', () => {
    const routePaths = new Set(datatugProjectRoutes.map((r) => r.path));
    for (const page of component.projTopLevelPages) {
      expect(routePaths.has(page.path), `no route for menu item "${page.path}"`).toBe(
        true,
      );
    }
  });

  // Any `buttons` shortcut (e.g. a former "+" add button) must itself
  // resolve too — a shortcut to nowhere is the same class of bug as a
  // top-level menu item to nowhere (see the removed "query" add button,
  // which routed to a bare 'query' segment with no matching route: only
  // 'query/:queryId', requiring an id, exists).
  it('every projTopLevelPages button target has a matching datatugProjectRoutes path', () => {
    const routePaths = new Set(datatugProjectRoutes.map((r) => r.path));
    for (const page of component.projTopLevelPages) {
      for (const button of page.buttons ?? []) {
        expect(
          routePaths.has(button.path),
          `no route for button "${button.path}" on menu item "${page.path}"`,
        ).toBe(true);
      }
    }
  });
});

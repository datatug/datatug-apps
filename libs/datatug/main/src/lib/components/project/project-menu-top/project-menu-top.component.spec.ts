import { Router } from '@angular/router';
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
  let router: { url: string; events: ReturnType<typeof of> };

  beforeEach(async () => {
    router = { url: '/', events: of() };
    await TestBed.configureTestingModule({
      imports: [ProjectMenuTopComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: Router, useValue: router },
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

  it.each([
    [{ storeId: 'localhost:8989', projectId: 'p1' }, '/store/localhost:8989/project/p1'],
    [{ storeId: 'firestore', spaceID: 'S1', projectId: 'p1' }, '/space/S1/store/firestore/project/p1'],
  ])('builds visible menu links in the admitted project/session scopes for %j', (ref, base) => {
    component.project = { ref };
    router.url = `${base}/sessions/session-a/overview`;
    expect(component.projectPageUrl('queries')).toBe(`${base}/sessions/session-a/queries`);
    expect(component.projectPageUrl('overview')).toBe(`${base}/sessions/session-a/overview`);
    expect(component.projectPageUrl('checks')).toBe(`${base}/checks`);
    expect(component.projectPageUrl('detective')).toBe(`${base}/detective`);
    expect(component.projectPageUrl('sessions')).toBe(`${base}/sessions`);
    if (!('spaceID' in ref)) expect(component.projectPageUrl('variables')).toBe(`${base}/sessions/session-a/variables`);
    router.url = '/store/localhost:8989/project/other/sessions/session-b/overview';
    expect(component.projectPageUrl('queries')).toBe(`${base}/queries`);
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

  it('offers the sandbox entry only in the canonical DemoDB project', () => {
    const setProject = (
      component as unknown as {
        setProject(project?: {
          ref: { storeId: string; projectId: string };
        }): void;
      }
    ).setProject;
    setProject({
      ref: {
        storeId: 'github.com',
        projectId: 'datatug-demo-project@datatug@demo-project-1',
      },
    });
    expect(component.isDemoDbProject()).toBe(true);

    setProject({
      ref: { storeId: 'github.com', projectId: 'another-project' },
    });
    expect(component.isDemoDbProject()).toBe(false);
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
      expect(
        routePaths.has(page.path),
        `no route for menu item "${page.path}"`,
      ).toBe(true);
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

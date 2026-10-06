import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of } from 'rxjs';

import { ProjectMenuComponent } from './project-menu.component';
import { ProjectContextService } from '../../../services/project/project-context.service';
import { QueriesUiService } from '../../../queries/queries-ui.service';
import { QueryEditorStateService } from '../../../queries/query-editor-state-service';

describe('ProjectContextMenuComponent', () => {
  let component: ProjectMenuComponent;
  let fixture: ComponentFixture<ProjectMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectMenuComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(ProjectMenuComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectMenuComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression (S157, founder report 2026-09-10): the "should create" spec
 * above overrides `ProjectMenuComponent` with an EMPTY template, so it
 * never actually renders `<sneat-datatug-queries-menu>` — it could not have
 * caught the live `NG0201: No provider found for QueryEditorStateService`
 * selecting the "Active Queries" tab threw (`QueriesMenuComponent`'s own
 * `queries-menu.component.spec.ts` has the identical gap: it mocks
 * `QueryEditorStateService`/`QueriesUiService` directly, so it never
 * exercises real module wiring either). `query-editor-state-singleton.spec.ts`
 * (this folder's sibling) is the real-DI proof that the root-provided fix
 * works; this spec is the shallower, template-level proof that
 * `ProjectMenuComponent` actually renders `QueriesMenuComponent` for the
 * "queries" tab, with the REAL template and REAL child component
 * construction — only the three leaf services `QueriesMenuComponent`
 * itself injects are mocked, same convention as `queries-menu.component.spec.ts`
 * and `project-menu-top.component.spec.ts` (sibling specs) use for
 * `ProjectContextService`/nav context.
 */
describe('ProjectMenuComponent — Active Queries tab renders QueriesMenuComponent', () => {
  let fixture: ComponentFixture<ProjectMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectMenuComponent],
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
          provide: ProjectContextService,
          useValue: { current: undefined, current$: of(undefined) },
        },
        {
          provide: QueriesUiService,
          useValue: { openNewQuery: vi.fn() },
        },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(undefined),
            setCurrentQuery: vi.fn(),
            closeQuery: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectMenuComponent);
  });

  it('selecting the "queries" tab renders sneat-datatug-queries-menu without throwing', () => {
    fixture.componentInstance.tab = 'queries';

    expect(() => fixture.detectChanges()).not.toThrow();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('sneat-datatug-queries-menu')).toBeTruthy();
  });
});

describe('shared metadata menu refuses active-query tab', () => {
  it('renders only Overview even when an old menu instance retains the queries tab', async () => {
    const { DatatugNavContextService } =
      await import('../../../services/nav/datatug-nav-context.service');
    const { DatatugNavService } =
      await import('../../../services/nav/datatug-nav.service');
    const { DatatugUserService } =
      await import('../../../services/base/datatug-user-service');
    const nav = { goProjPage: vi.fn() };
    const queryActions = { openNewQuery: vi.fn() };
    const queryState = {
      queryEditorState: of(undefined),
      setCurrentQuery: vi.fn(),
      closeQuery: vi.fn(),
    };
    const project = {
      ref: { storeId: 'firestore', spaceID: 'S1', projectId: 'same' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    );
    await TestBed.configureTestingModule({
      imports: [ProjectMenuComponent],
      providers: [
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(project),
            currentFolder: of('overview'),
          },
        },
        { provide: DatatugNavService, useValue: nav },
        { provide: DatatugUserService, useValue: { datatugUserState: of({}) } },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: QueriesUiService, useValue: queryActions },
        { provide: QueryEditorStateService, useValue: queryState },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProjectMenuComponent);
    fixture.componentInstance.tab = 'queries';
    fixture.componentRef.setInput('metadataOnly', true);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('sneat-datatug-queries-menu')).toBeNull();
    expect(
      host.querySelector('sneat-datatug-investigation-context-bar'),
    ).toBeNull();
    expect(host.querySelectorAll('ion-item')).toHaveLength(1);
    const overview = host.querySelector('ion-item');
    if (!overview) throw new Error('Missing overview menu item');
    overview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(nav.goProjPage).toHaveBeenCalledWith('overview', project, {
      project,
    });
    expect(queryActions.openNewQuery).not.toHaveBeenCalled();
    expect(queryState.setCurrentQuery).not.toHaveBeenCalled();
  });
});

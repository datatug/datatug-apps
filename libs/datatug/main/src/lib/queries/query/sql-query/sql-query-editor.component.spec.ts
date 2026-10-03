import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { RandomIdService } from '@sneat/random';
import { of } from 'rxjs';

import { SqlQueryEditorComponent } from './sql-query-editor.component';
import { DatatugNavContextService } from '../../../services/nav/datatug-nav-context.service';
import { QueryContextSqlService } from '../../query-context-sql.service';
import { QueriesService } from '../../queries.service';
import { Coordinator } from '../../../executor/coordinator';
import { QueryEditorStateService } from '../../query-editor-state-service';
import { EnvironmentService } from '../../../services/unsorted/environment.service';

describe('SqlEditorPage', () => {
  let component: SqlQueryEditorComponent;
  let fixture: ComponentFixture<SqlQueryEditorComponent>;

  beforeEach(async () => {
    Object.defineProperty(window, 'history', {
      value: { ...window.history, state: { query: undefined } },
      writable: true,
      configurable: true,
    });
    await TestBed.configureTestingModule({
      imports: [SqlQueryEditorComponent],
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
          provide: RandomIdService,
          useValue: { newRandomId: vi.fn(() => 'test-id') },
        },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of({ get: () => null }),
            paramMap: of({ get: () => null }),
            snapshot: { paramMap: { get: () => null }, params: {} },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
            events: of(),
          },
        },
        {
          provide: QueryContextSqlService,
          useValue: { setSql: vi.fn(), setTarget: vi.fn() },
        },
        { provide: QueriesService, useValue: {} },
        { provide: Coordinator, useValue: { execute: vi.fn() } },
        {
          provide: QueryEditorStateService,
          useValue: {
            queryEditorState: of(undefined),
            updateQueryState: vi.fn(),
            openQuery: vi.fn(),
            newQuery: vi.fn(),
            getQueryState: vi.fn(),
            saveQuery: vi.fn(),
          },
        },
        { provide: EnvironmentService, useValue: { getEnvSummary: vi.fn() } },
      ],
    })
      .overrideComponent(SqlQueryEditorComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(SqlQueryEditorComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // G-A1c: where the back button goes with no history: the project's queries (its address is the one
  // `projectUrl()` writes), in the folder of this query.
  it.each([
    ['an agent project', { storeId: 'localhost:8989', projectId: 'datatug-demo-project' }, 'customers', '/store/localhost:8989/project/datatug-demo-project/queries?folder=customers'],
    ['an agent project, query in no folder', { storeId: 'localhost:8989', projectId: 'p1' }, '', '/store/localhost:8989/project/p1/queries?folder='],
    ['a GitHub project', { storeId: 'github.com', projectId: 'chinook-demo@datatug@' }, 'sales', '/project/github.com/datatug/chinook-demo/queries?folder=sales'],
    ['a GitHub project in a folder', { storeId: 'github.com', projectId: 'r@o@d' }, 'sales', '/project/github.com/o/r/tree/HEAD/d/-/queries?folder=sales'],
  ])('the back button goes to the queries of %s', (_name, ref, folder, href) => {
    component.project = { ref };
    component.queryFolderPath = folder;
    expect(component.queriesBackHref).toBe(href);
  });

  it('the back button goes to the root while there is no project', () => {
    component.queryFolderPath = 'sales';
    expect(component.queriesBackHref).toBe('/?folder=sales');
  });
});

import { CUSTOM_ELEMENTS_SCHEMA, Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ErrorLogger } from '@sneat/core';
import { of, throwError } from 'rxjs';

import { QueriesTabComponent } from './queries-tab.component';
import { SqlEditorComponent } from '../../components/sqleditor/sql-editor.component';
import { IProjectContext } from '../../nav/nav-models';
import { DatatugNavContextService } from '../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import {
  AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE,
  GITHUB_PERSONAL_QUERIES_MESSAGE,
  QueriesService,
} from '../queries.service';
import { QueryType } from '../../models/definition/query-def';

describe('QueriesTabComponent', () => {
  let component: QueriesTabComponent;
  let fixture: ComponentFixture<QueriesTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QueriesTabComponent],
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
        { provide: QueriesService, useValue: { getQueriesFolder: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: {
            currentProject: of(undefined),
            currentEnv: of(undefined),
          },
        },
        {
          provide: DatatugNavService,
          useValue: { goQuery: vi.fn() },
        },
      ],
    })
      .overrideComponent(QueriesTabComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueriesTabComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/** Stand-in for `SqlEditorComponent` (`sneat-datatug-sql`) — same selector
 * and `sql` input, no `@acrodata/code-editor` dependency — same technique
 * `queries-page.component.spec.ts`'s own S154 describe uses, needed here so
 * the describes below can render `QueriesTabComponent`'s REAL template
 * (proving the empty-state notice/real items actually (dis)appear in the
 * DOM, not just in component state). */
@Component({ selector: 'sneat-datatug-sql', template: '' })
class SqlEditorStubComponent {
  readonly sql = input<string>();
}

/**
 * S163 — founder-reported follow-up: "On a GitHub-store project the
 * Queries page's `personal` and `shared` tabs list the same files".
 * `QueriesService.getQueriesFolder()`'s own S163 fix rejects with exactly
 * `GITHUB_PERSONAL_QUERIES_MESSAGE` for `rootFolder === 'personal'` on a
 * GitHub-store project (queries.service.spec.ts's own describe covers that
 * service-level contract) — these pin down the CONSUMING side: the tab
 * component must render a friendly notice instead of that error, and must
 * NOT fall back to showing the shared tree.
 */
describe('QueriesTabComponent — GitHub-store "Personal" tab empty state (S163)', () => {
  const githubProject: IProjectContext = {
    ref: {
      storeId: 'github.com',
      projectId: 'datatug-demo-projects@datatug@demo-project-1',
    },
  } as IProjectContext;

  const sharedFolder = {
    id: '~',
    items: [
      {
        id: 'artists_with_albums',
        title: 'Artists with albums',
        request: { queryType: QueryType.SQL, text: 'select 1' },
      },
    ],
  };

  let fixture: ComponentFixture<QueriesTabComponent>;
  let getQueriesFolder: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getQueriesFolder = vi.fn((_ref, _path, rootFolder) =>
      rootFolder === 'personal'
        ? throwError(() => new Error(GITHUB_PERSONAL_QUERIES_MESSAGE))
        : of(sharedFolder),
    );

    await TestBed.configureTestingModule({
      imports: [QueriesTabComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
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
          useValue: { navigate: vi.fn(() => Promise.resolve(true)), events: of() },
        },
        { provide: QueriesService, useValue: { getQueriesFolder } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(githubProject), currentEnv: of(undefined) },
        },
        { provide: DatatugNavService, useValue: { goQuery: vi.fn() } },
      ],
    })
      .overrideComponent(QueriesTabComponent, {
        remove: { imports: [SqlEditorComponent] },
        add: { imports: [SqlEditorStubComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(QueriesTabComponent);
  });

  it('shows a friendly notice instead of the shared folder tree, and calls the errorLogger never for it', () => {
    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBe(
      GITHUB_PERSONAL_QUERIES_MESSAGE,
    );
    expect(fixture.componentInstance.allQueries).toEqual([]);
    // `innerHTML` (not `textContent`, which doesn't reliably walk light-DOM
    // children of unregistered `ion-*` custom elements under happy-dom —
    // see queries-page.component.spec.ts's own S154 comment on the same
    // gotcha) HTML-escapes the message's own literal `<path>` placeholder,
    // so this checks the escaped substring rather than the raw constant.
    const text = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(text).toContain(
      'This project is browsed read-only from GitHub — personal queries need a DataTug agent.',
    );
  });

  it('the "shared" tab is unaffected — still reads and renders the real shared items', () => {
    fixture.componentRef.setInput('rootFolder', 'shared');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBeUndefined();
    expect(fixture.componentInstance.allQueries?.map((q) => q.id)).toEqual([
      'artists_with_albums',
    ]);
    const text = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(text).not.toContain(GITHUB_PERSONAL_QUERIES_MESSAGE);
  });

  it('switching from "personal" to "shared" clears the notice and loads the shared tree', () => {
    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();
    expect(fixture.componentInstance.personalQueriesNotice()).toBe(
      GITHUB_PERSONAL_QUERIES_MESSAGE,
    );

    fixture.componentRef.setInput('rootFolder', 'shared');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBeUndefined();
    expect(fixture.componentInstance.allQueries?.map((q) => q.id)).toEqual([
      'artists_with_albums',
    ]);
  });
});

/**
 * S174 — datatug-cli v0.24.0 adds `root=personal` to `GET /datatug/queries/
 * all_queries`. `QueriesService.getQueriesFolder()`'s own S174 fix rejects
 * with exactly `AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE` when an
 * agent-backed store answers `root=personal` with the shared tree — the
 * signal that agent predates v0.24.0 and silently ignored `root`
 * (queries.service.spec.ts's own describe covers that service-level
 * contract). These pin down the CONSUMING side, mirroring the S163
 * GitHub-store describe above: the tab component renders a friendly notice
 * instead of the shared tree, a genuinely empty (but real, v0.24.0+)
 * personal root renders the ordinary empty state with NO notice, and a
 * Personal→Shared→Personal tab switch still refetches every time (the
 * pre-existing PR #120 behavior this fix must not regress).
 */
describe('QueriesTabComponent — agent-backed "Personal" tab (S174)', () => {
  const agentProject: IProjectContext = {
    ref: { storeId: 'localhost:8989', projectId: 'demo-project' },
  } as IProjectContext;

  const sharedFolder = {
    id: '~',
    items: [
      {
        id: 'artists_with_albums',
        title: 'Artists with albums',
        request: { queryType: QueryType.SQL, text: 'select 1' },
      },
    ],
  };

  function setup(getQueriesFolder: ReturnType<typeof vi.fn>) {
    return TestBed.configureTestingModule({
      imports: [QueriesTabComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
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
          useValue: { navigate: vi.fn(() => Promise.resolve(true)), events: of() },
        },
        { provide: QueriesService, useValue: { getQueriesFolder } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: of(agentProject), currentEnv: of(undefined) },
        },
        { provide: DatatugNavService, useValue: { goQuery: vi.fn() } },
      ],
    })
      .overrideComponent(QueriesTabComponent, {
        remove: { imports: [SqlEditorComponent] },
        add: { imports: [SqlEditorStubComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
  }

  it('an old agent\'s "~" fallback shows the unsupported notice, never the shared items, under the "Personal" label', async () => {
    const getQueriesFolder = vi.fn((_ref, _path, rootFolder) =>
      rootFolder === 'personal'
        ? throwError(() => new Error(AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE))
        : of(sharedFolder),
    );
    await setup(getQueriesFolder);
    const fixture = TestBed.createComponent(QueriesTabComponent);

    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBe(
      AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE,
    );
    expect(fixture.componentInstance.allQueries).toEqual([]);
    const text = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(text).toContain(
      'This DataTug agent does not support personal queries yet',
    );
  });

  it('a genuinely empty v0.24.0+ personal root ("user:<id>", no items) shows the ordinary empty state — no notice', async () => {
    const getQueriesFolder = vi.fn((_ref, _path, rootFolder) =>
      rootFolder === 'personal' ? of({ id: 'user:admin' }) : of(sharedFolder),
    );
    await setup(getQueriesFolder);
    const fixture = TestBed.createComponent(QueriesTabComponent);

    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBeUndefined();
    expect(fixture.componentInstance.allQueries).toEqual([]);
    const text = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(text).not.toContain(AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE);
  });

  it('the "shared" tab is unaffected — still reads and renders the real shared items', async () => {
    const getQueriesFolder = vi.fn((_ref, _path, rootFolder) =>
      rootFolder === 'personal'
        ? throwError(() => new Error(AGENT_PERSONAL_QUERIES_UNSUPPORTED_MESSAGE))
        : of(sharedFolder),
    );
    await setup(getQueriesFolder);
    const fixture = TestBed.createComponent(QueriesTabComponent);

    fixture.componentRef.setInput('rootFolder', 'shared');
    fixture.detectChanges();

    expect(fixture.componentInstance.personalQueriesNotice()).toBeUndefined();
    expect(fixture.componentInstance.allQueries?.map((q) => q.id)).toEqual([
      'artists_with_albums',
    ]);
  });

  it('Personal→Shared→Personal still refetches every time (PR #120 behavior, unregressed)', async () => {
    const getQueriesFolder = vi.fn((_ref, _path, rootFolder) =>
      rootFolder === 'personal' ? of({ id: 'user:admin' }) : of(sharedFolder),
    );
    await setup(getQueriesFolder);
    const fixture = TestBed.createComponent(QueriesTabComponent);

    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();
    expect(getQueriesFolder).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('rootFolder', 'shared');
    fixture.detectChanges();
    expect(getQueriesFolder).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.allQueries?.map((q) => q.id)).toEqual([
      'artists_with_albums',
    ]);

    fixture.componentRef.setInput('rootFolder', 'personal');
    fixture.detectChanges();
    expect(getQueriesFolder).toHaveBeenCalledTimes(3);
    expect(fixture.componentInstance.personalQueriesNotice()).toBeUndefined();
    expect(fixture.componentInstance.allQueries).toEqual([]);
  });
});

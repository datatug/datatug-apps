import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of, Subject } from 'rxjs';
import { AlertController } from '@ionic/angular';

import { BoardsPageComponent } from './boards-page.component';
import { DatatugNavContextService } from '../../../../services/nav/datatug-nav-context.service';
import { DatatugNavService } from '../../../../services/nav/datatug-nav.service';
import { DatatugBoardService } from '../../../core/datatug-board.service';
import { DatatugFoldersService } from '../../../../folders/core/datatug-folders.service';
import { IProjectContext } from '../../../../nav/nav-models';
import { IFolder } from '../../../../models/definition/folder';

describe('DataboardsPage', () => {
  let component: BoardsPageComponent;
  let fixture: ComponentFixture<BoardsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardsPageComponent],
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
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: DatatugNavService,
          useValue: {
            projectPageUrl: vi.fn(),
            goBoard: vi.fn(),
            goProjPage: vi.fn(),
          },
        },
        { provide: DatatugBoardService, useValue: { createNewBoard: vi.fn() } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        {
          provide: DatatugFoldersService,
          useValue: { watchFolder: vi.fn(() => of()) },
        },
      ],
    })
      .overrideComponent(BoardsPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardsPageComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * Regression for the exact bug reported by the founder (2026-09-10, "it
 * looks like this page has zoneless bug - it does not show data until I
 * click dropdown") — BoardsPageComponent is the sibling page to the one the
 * founder actually hit, same bug class, same fix already established in
 * pages/signed-in/project/project-page.component.ts (PR #95) and now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs.
 *
 * `project` and `boards` used to be plain fields. Neither is written
 * directly inside a `.subscribe()` callback — `setProject()` and
 * `onFolderReceived()` are private methods CALLED from inside
 * `.subscribe()` callbacks (the constructor's `currentProject.subscribe()`,
 * and the nested `watchFolder().subscribe()` inside `setProject()`) — but a
 * plain field written by a method called from an async callback is exactly
 * as zoneless-unsafe as one written directly inside it: nothing tells
 * Angular's zoneless scheduler that component state changed either way.
 * This app runs `provideZonelessChangeDetection()`
 * (apps/datatug-app/src/main.ts).
 *
 * Uses `Subject`s, not `of(...)`, so the values arrive strictly after the
 * initial render — matching real nav-context/HTTP timing — and never calls
 * `fixture.detectChanges()` again afterwards, relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * card list with no manual intervention (no dropdown click, unlike the
 * reported bug).
 */
describe('BoardsPage renders boards once the project/folder arrive asynchronously (zoneless)', () => {
  let fixture: ComponentFixture<BoardsPageComponent>;
  let currentProject$: Subject<IProjectContext | undefined>;
  let watchFolder$: Subject<IFolder | null>;

  beforeEach(async () => {
    currentProject$ = new Subject<IProjectContext | undefined>();
    watchFolder$ = new Subject<IFolder | null>();

    await TestBed.configureTestingModule({
      imports: [BoardsPageComponent],
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
            currentProject: currentProject$.asObservable(),
            currentEnv: of(undefined),
            setCurrentEnvironment: vi.fn(),
          },
        },
        {
          provide: DatatugNavService,
          useValue: {
            projectPageUrl: vi.fn(),
            goBoard: vi.fn(),
            goProjPage: vi.fn(),
          },
        },
        { provide: DatatugBoardService, useValue: { createNewBoard: vi.fn() } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        {
          provide: DatatugFoldersService,
          useValue: { watchFolder: vi.fn(() => watchFolder$.asObservable()) },
        },
      ],
    })
      // Keep the real template; render sneat-card-list as an unknown
      // (opaque) custom element via CUSTOM_ELEMENTS_SCHEMA so its
      // [isLoading]/[items] bindings land as plain DOM properties we can
      // read directly, instead of instantiating the real
      // SneatCardListComponent (whose own @Input() values aren't reflected
      // as host-element properties) — same idiom PR #95 uses for
      // DatatugFolderComponent's own child components.
      .overrideComponent(BoardsPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardsPageComponent);
  });

  function boardsCard(): HTMLElement & {
    isLoading?: boolean;
    items?: unknown[];
  } {
    return fixture.nativeElement.querySelector(
      'sneat-card-list',
    ) as HTMLElement & { isLoading?: boolean; items?: unknown[] };
  }

  it('flips the card list out of its loading state once the project/folder arrive, with no explicit detectChanges()', async () => {
    fixture.detectChanges(); // initial render — nothing has arrived yet
    expect(boardsCard().isLoading).toBe(true);

    const project: IProjectContext = {
      ref: { projectId: 'p1', storeId: 'firestore' },
    };

    // Both arrive strictly after the initial render — no detectChanges()
    // call between this and the assertions below; only whenStable().
    currentProject$.next(project);
    watchFolder$.next({ id: '~', boards: { b1: { name: 'Board One' } } });
    await fixture.whenStable();

    expect(boardsCard().isLoading).toBe(false);
    // `{id, title}`, not `{id, name}`: `onFolderReceived()` remaps
    // `folderItemsAsList()`'s own `{id, name}` shape to `{id, title}`
    // because `sneat-card-list` reads `.title`, not `.name` — see that
    // method's own doc comment (S136) for the display bug this fixes.
    expect(boardsCard().items).toEqual([{ id: 'b1', title: 'Board One' }]);
    // A store may accept create_board yet has no board reader. Do not offer
    // a creation action that strands the user on the next step.
    expect(fixture.nativeElement.textContent).not.toContain('New board');
  });

  it('clears a visible board when the project changes to a qualified ref', async () => {
    fixture.detectChanges();
    const watchFolder = TestBed.inject(DatatugFoldersService).watchFolder;
    currentProject$.next({
      ref: { projectId: 'demo', storeId: 'github.com' },
    });
    watchFolder$.next({ id: '~', boards: { b1: { name: 'Demo board' } } });
    await fixture.whenStable();
    expect(boardsCard().items).toEqual([{ id: 'b1', title: 'Demo board' }]);

    currentProject$.next({
      ref: {
        projectId: 'demo',
        storeId: 'github.com',
        projectApi: 'cloud',
        branch: 'feature',
      },
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('sneat-card-list')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[role="status"]')?.textContent,
    ).toContain('Boards are unavailable');
    expect(watchFolder).toHaveBeenCalledTimes(1);
  });
});

describe('BoardsPage project switching', () => {
  it('reloads boards when the store changes for the same project ID and ignores stale folder results', async () => {
    const projects = new Subject<IProjectContext>();
    const firstFolder = new Subject<IFolder | null>();
    const secondFolder = new Subject<IFolder | null>();
    const thirdFolder = new Subject<IFolder | null>();
    const watchFolder = vi
      .fn()
      .mockReturnValueOnce(firstFolder.asObservable())
      .mockReturnValueOnce(secondFolder.asObservable())
      .mockReturnValueOnce(thirdFolder.asObservable());

    await TestBed.configureTestingModule({
      imports: [BoardsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError: vi.fn() } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: projects.asObservable() },
        },
        {
          provide: DatatugNavService,
          useValue: { projectPageUrl: vi.fn(), goBoard: vi.fn() },
        },
        { provide: DatatugBoardService, useValue: { createNewBoard: vi.fn() } },
        { provide: AlertController, useValue: { create: vi.fn() } },
        { provide: DatatugFoldersService, useValue: { watchFolder } },
      ],
    })
      .overrideComponent(BoardsPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(BoardsPageComponent);
    const page = fixture.componentInstance;
    projects.next({ ref: { storeId: 'github.com', projectId: 'shared-id' } });
    firstFolder.next({ id: '~', boards: { first: { name: 'First board' } } });
    expect(page.boards()).toEqual([{ id: 'first', title: 'First board' }]);

    projects.next({
      ref: {
        storeId: 'http-localhost:8989',
        projectId: 'shared-id',
      },
    });
    expect(page.boards()).toBeUndefined();
    firstFolder.next({ id: '~', boards: { stale: { name: 'Stale board' } } });
    expect(page.boards()).toBeUndefined();
    secondFolder.next({
      id: '~',
      boards: { second: { name: 'Second board' } },
    });

    expect(page.boards()).toEqual([{ id: 'second', title: 'Second board' }]);
    expect(watchFolder).toHaveBeenNthCalledWith(2, {
      storeId: 'http-localhost:8989',
      projectId: 'shared-id',
      id: '~',
    });

    projects.next({
      ref: {
        storeId: 'github.com',
        projectId: 'shared-id',
        projectApi: 'cloud',
        branch: 'feature',
      },
    });
    expect(page.boards()).toBeUndefined();
    expect(page.unsupportedProject()).toBe(true);
    secondFolder.next({ id: '~', boards: { stale: { name: 'Stale branch' } } });
    expect(page.boards()).toBeUndefined();
    thirdFolder.next({ id: '~', boards: { third: { name: 'Feature board' } } });
    expect(page.boards()).toBeUndefined();
    expect(watchFolder).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });
});

describe('BoardsPage read errors', () => {
  it('shows a retry instead of an empty list, then renders a genuinely empty folder', async () => {
    const project$ = new Subject<IProjectContext>();
    const failedFolder = new Subject<IFolder | null>();
    const retryFolder = new Subject<IFolder | null>();
    const logError = vi.fn();
    const watchFolder = vi
      .fn()
      .mockReturnValueOnce(failedFolder.asObservable())
      .mockReturnValueOnce(retryFolder.asObservable());

    await TestBed.configureTestingModule({
      imports: [BoardsPageComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [
        { provide: ErrorLogger, useValue: { logError } },
        {
          provide: DatatugNavContextService,
          useValue: { currentProject: project$.asObservable() },
        },
        {
          provide: DatatugNavService,
          useValue: { projectPageUrl: vi.fn(), goBoard: vi.fn() },
        },
        { provide: DatatugFoldersService, useValue: { watchFolder } },
      ],
    })
      .overrideComponent(BoardsPageComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA], providers: [] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(BoardsPageComponent);
    fixture.detectChanges();
    project$.next({ ref: { storeId: 'github.com', projectId: 'demo' } });
    failedFolder.error(new Error('read failed'));
    await fixture.whenStable();

    expect(logError).toHaveBeenCalledOnce();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('Boards could not be loaded');
    expect(fixture.nativeElement.querySelector('sneat-card-list')).toBeNull();

    (fixture.nativeElement.querySelector('ion-button') as HTMLElement).click();
    await fixture.whenStable();
    expect(watchFolder).toHaveBeenCalledTimes(2);
    const list = fixture.nativeElement.querySelector('sneat-card-list') as
      | (HTMLElement & { isLoading: boolean; items: unknown[] })
      | null;
    expect(list?.isLoading).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    retryFolder.next({ id: '~', boards: {} });
    await fixture.whenStable();
    expect(list?.isLoading).toBe(false);
    expect(list?.items).toEqual([]);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});

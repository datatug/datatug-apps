import { TitleCasePipe } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of, throwError, Subject } from 'rxjs';
import { IFolder } from '../../models/definition/folder';

import { DatatugFolderComponent } from './datatug-folder.component';
import { DatatugFoldersService } from '../core/datatug-folders.service';
import { DatatugBoardService } from '../../board/core/datatug-board.service';
import { DatatugNavService } from '../../services/nav/datatug-nav.service';
import { EntityService } from '../../services/unsorted/entity.service';
import { EnvironmentService } from '../../services/unsorted/environment.service';
import { SchemaService } from '../../services/unsorted/schema.service';

describe('DatatugFolderComponent', () => {
  let fixture: ComponentFixture<DatatugFolderComponent>;
  let watchFolder: ReturnType<typeof vi.fn>;
  let logError: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    watchFolder = vi.fn();
    logError = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DatatugFolderComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError, logErrorHandler: vi.fn(() => vi.fn()) },
        },
        { provide: DatatugFoldersService, useValue: { watchFolder } },
        { provide: DatatugNavService, useValue: {} },
        { provide: SchemaService, useValue: {} },
        { provide: EnvironmentService, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
        { provide: EntityService, useValue: {} },
      ],
    })
      // Keep the real template; render Ionic and card-list children as
      // unknown elements so no Ionic runtime is needed here.
      .overrideComponent(DatatugFolderComponent, {
        set: { imports: [TitleCasePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(DatatugFolderComponent);
  });

  it('treats an absent (null) folder as an empty boards list and ends the loading state', () => {
    watchFolder.mockReturnValue(of(null));
    fixture.componentRef.setInput('projectRef', {
      storeId: 'localhost:8989',
      projectId: 'datatug-demo-project',
    });
    fixture.detectChanges();
    expect(watchFolder).toHaveBeenCalledWith({
      storeId: 'localhost:8989',
      projectId: 'datatug-demo-project',
      id: '~',
    });
    expect(fixture.componentInstance.folder()).toBeNull();
    expect(fixture.componentInstance.boards()).toEqual([]);
    const boardsCard = fixture.nativeElement.querySelector(
      'sneat-card-list',
    ) as HTMLElement & { isLoading?: boolean };
    expect(boardsCard.isLoading).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs a failed folder watch through ErrorLogger instead of raising an unhandled error', () => {
    // Defends the general contract at this level regardless of which
    // store is asked: SOME future store implementation erroring here (the
    // GitHub store itself no longer does — `datatug-store.service.github.ts`'s
    // `watchProjectItem()` and `datatug-store.service.github.spec.ts`'s own
    // S163 tests cover that directly) must still not take the whole project
    // page down with it.
    const failure = new Error('not implemented');
    watchFolder.mockReturnValue(throwError(() => failure));
    fixture.componentRef.setInput('projectRef', {
      storeId: 'github.com',
      projectId: 'datatug-demo-projects@datatug@demo-project-1',
    });
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      failure,
      expect.stringContaining('folder'),
    );
  });
});

/**
 * Regression for numberOf() self-recursing instead of indexing into
 * folder().numberOf: `return (this.folder()?.numberOf && this.numberOf(tab)) || 0;`
 * called itself with the identical `tab` argument whenever the map was
 * truthy, recursing until the stack overflowed — crashing any folder page
 * whose numberOf map was populated (this.numberOf(tab) is invoked once per
 * tab from the @for loop in datatug-folder.component.html). The fix reads
 * `this.folder()?.numberOf?.[tab] ?? 0` instead.
 */
describe('DatatugFolderComponent.numberOf()', () => {
  let fixture: ComponentFixture<DatatugFolderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatatugFolderComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        {
          provide: DatatugFoldersService,
          useValue: { watchFolder: vi.fn(() => of(null)) },
        },
        { provide: DatatugNavService, useValue: {} },
        { provide: SchemaService, useValue: {} },
        { provide: EnvironmentService, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
        { provide: EntityService, useValue: {} },
      ],
    })
      .overrideComponent(DatatugFolderComponent, {
        set: { imports: [TitleCasePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(DatatugFolderComponent);
  });

  it("indexes into the folder's numberOf map instead of recursing", () => {
    fixture.componentInstance.folder.set({ id: '~', numberOf: { queries: 3 } });
    expect(fixture.componentInstance.numberOf('queries')).toBe(3);
  });

  it('returns 0 for a tab absent from the numberOf map', () => {
    fixture.componentInstance.folder.set({ id: '~', numberOf: { queries: 3 } });
    expect(fixture.componentInstance.numberOf('boards')).toBe(0);
  });

  it('returns 0 when no folder has loaded yet', () => {
    expect(fixture.componentInstance.folder()).toBeUndefined();
    expect(fixture.componentInstance.numberOf('boards')).toBe(0);
  });
});

/**
 * Regression for the zoneless bug class this repo hit in
 * pages/signed-in/project/project-page.component.ts (PR #95) and is now
 * guarded fleet-wide by tools/check-zoneless-fields.mjs: `folder` and
 * `boards` used to be plain fields, written from inside the `.subscribe()`
 * callback in subscribeForFolder(). This app runs
 * `provideZonelessChangeDetection()` (apps/datatug-app/src/main.ts), so a
 * plain-field write from an async callback never schedules a repaint on its
 * own — the Boards card would stay stuck showing its loading state forever
 * once the real folder arrived, with no unrelated event around to
 * accidentally mask the gap. This component is embedded on the project page
 * the founder reported the bug against (2026-09-10), via
 * `<sneat-datatug-folder>`.
 *
 * The two tests above use `of(...)`, a SYNCHRONOUS observable that already
 * delivers the folder before the first (real, TestBed-driven)
 * `detectChanges()` call resolves — so that first change-detection pass
 * would mask this exact bug regardless of whether the fix is present. This
 * test uses a `Subject` instead, so the folder arrives strictly AFTER the
 * component has already rendered once, and never calls
 * `fixture.detectChanges()` again afterwards — relying only on
 * `fixture.whenStable()` to prove the signal writes alone re-render the
 * Boards card with no manual intervention.
 */
describe('DatatugFolderComponent renders the Boards card once the folder arrives asynchronously (zoneless)', () => {
  let fixture: ComponentFixture<DatatugFolderComponent>;
  let watchFolder$: Subject<IFolder | null>;

  beforeEach(async () => {
    watchFolder$ = new Subject<IFolder | null>();
    await TestBed.configureTestingModule({
      imports: [DatatugFolderComponent],
      providers: [
        {
          provide: ErrorLogger,
          useValue: { logError: vi.fn(), logErrorHandler: vi.fn(() => vi.fn()) },
        },
        {
          provide: DatatugFoldersService,
          useValue: { watchFolder: vi.fn(() => watchFolder$.asObservable()) },
        },
        { provide: DatatugNavService, useValue: {} },
        { provide: SchemaService, useValue: {} },
        { provide: EnvironmentService, useValue: {} },
        { provide: DatatugBoardService, useValue: {} },
        { provide: EntityService, useValue: {} },
      ],
    })
      .overrideComponent(DatatugFolderComponent, {
        set: { imports: [TitleCasePipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(DatatugFolderComponent);
  });

  it('flips the Boards card out of its loading state once the folder arrives, with no explicit detectChanges()', async () => {
    fixture.componentRef.setInput('projectRef', {
      storeId: 'localhost:8989',
      projectId: 'datatug-demo-project',
    });
    fixture.detectChanges(); // initial render — no folder has arrived yet

    const boardsCard = () =>
      fixture.nativeElement.querySelector('sneat-card-list') as HTMLElement & {
        isLoading?: boolean;
        items?: unknown[];
      };
    expect(boardsCard().isLoading).toBe(true);

    // The folder arrives strictly after the initial render — no
    // detectChanges() call between this and the assertions below; only
    // whenStable().
    watchFolder$.next({
      id: '~',
      boards: { b1: { name: 'Board One' } },
    });
    await fixture.whenStable();

    expect(boardsCard().isLoading).toBe(false);
    expect(boardsCard().items).toEqual([{ id: 'b1', title: 'Board One' }]);
  });
});

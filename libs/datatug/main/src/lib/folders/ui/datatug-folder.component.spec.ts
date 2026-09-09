import { TitleCasePipe } from '@angular/common';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorLogger } from '@sneat/core';
import { of, throwError } from 'rxjs';

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
    expect(fixture.componentInstance.folder).toBeNull();
    expect(fixture.componentInstance.boards).toEqual([]);
    const boardsCard = fixture.nativeElement.querySelector(
      'sneat-card-list',
    ) as HTMLElement & { isLoading?: boolean };
    expect(boardsCard.isLoading).toBe(false);
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs a failed folder watch through ErrorLogger instead of raising an unhandled error', () => {
    // e.g. the GitHub store's watchProjectItem still errors with
    // "not implemented" — that must not take the project page down with it.
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

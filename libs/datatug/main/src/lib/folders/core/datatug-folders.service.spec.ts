import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'firebase/firestore';
import { of } from 'rxjs';

import { DatatugFoldersService } from './datatug-folders.service';
import { DatatugStoreServiceFactory } from '../../services/repo/datatug-store-service-factory.service';

describe('DatatugFoldersService', () => {
  describe('with a stubbed store service factory', () => {
    let service: DatatugFoldersService;
    let getDatatugStoreService: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      getDatatugStoreService = vi.fn();
      TestBed.configureTestingModule({
        providers: [
          DatatugFoldersService,
          {
            provide: DatatugStoreServiceFactory,
            useValue: { getDatatugStoreService },
          },
        ],
      });
      service = TestBed.inject(DatatugFoldersService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('turns a store-lookup throw into an erroring observable instead of throwing synchronously', () => {
      // A synchronous throw here escapes DatatugFolderComponent.ngOnChanges
      // and aborts the whole change-detection pass that was rendering the
      // project page — so the contract is: watchFolder never throws, it
      // errors through the observable, where the component can log it.
      getDatatugStoreService.mockImplementation(() => {
        throw new Error('unknown store: nope');
      });
      let result: ReturnType<DatatugFoldersService['watchFolder']> | undefined;
      expect(() => {
        result = service.watchFolder({
          storeId: 'nope',
          projectId: 'p',
          id: '~',
        });
      }).not.toThrow();
      const error = vi.fn();
      result?.subscribe({ error });
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'unknown store: nope' }),
      );
    });
  });

  describe('with the real store service factory', () => {
    let service: DatatugFoldersService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          { provide: HttpClient, useValue: { get: vi.fn() } },
          { provide: Firestore, useValue: {} },
        ],
      });
      service = TestBed.inject(DatatugFoldersService);
    });

    it.each(['localhost:8989', '127.0.0.1:8989', 'http-localhost:8989'])(
      'reports the root folder of a project on the local agent %s as absent (null) rather than throwing',
      (storeId) => {
        const next = vi.fn();
        const error = vi.fn();
        expect(() =>
          service
            .watchFolder({
              storeId,
              projectId: 'datatug-demo-project',
              id: '~',
            })
            .subscribe({ next, error }),
        ).not.toThrow();
        expect(error).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(null);
      },
    );
  });

  /**
   * S163 — founder-reported follow-up: every GitHub-store project page logs
   * `ErrorLoggerService.logError: Failed to watch folder "~" of project …
   * at store github.com: not implemented … /folders/~`
   * (`datatug-folder.component.ts`'s own error handler wraps whatever
   * `watchFolder()` errors with). `DatatugStoreGithubService.
   * watchProjectItem()` already special-cases `/folders/~` (returns the
   * real root folder) and falls back to `of(null)` — never an error — for
   * any other path, so these pin down the actual, current contract this
   * component depends on: a proper ONE-SHOT read (emits once, completes,
   * no error) for both the root folder and an arbitrary sub-folder path,
   * through the SAME `DatatugFoldersService.watchFolder()` entry point the
   * `it.each` above already covers for the CLI-agent store.
   */
  describe('with the real store service factory, for a GitHub-store project', () => {
    let service: DatatugFoldersService;
    let httpGet: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      httpGet = vi.fn(() =>
        of({
          id: 'datatug-demo-projects@datatug@demo-project-1',
          title: 'DataTug Demo Project 1',
          boards: [{ id: 'board1', title: '1st board' }],
        }),
      );
      TestBed.configureTestingModule({
        providers: [
          { provide: HttpClient, useValue: { get: httpGet } },
          { provide: Firestore, useValue: {} },
        ],
      });
      service = TestBed.inject(DatatugFoldersService);
    });

    it('emits the real root folder once, with no error, for a GitHub-store project', () => {
      const next = vi.fn();
      const error = vi.fn();
      const complete = vi.fn();
      service
        .watchFolder({
          storeId: 'github.com',
          projectId: 'datatug-demo-projects@datatug@demo-project-1',
          id: '~',
        })
        .subscribe({ next, error, complete });

      expect(error).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '~',
          boards: { board1: { name: '1st board' } },
        }),
      );
    });

    it('reports an arbitrary sub-folder as absent (null) once, with no error, rather than "not implemented"', () => {
      const next = vi.fn();
      const error = vi.fn();
      const complete = vi.fn();
      service
        .watchFolder({
          storeId: 'github.com',
          projectId: 'datatug-demo-projects@datatug@demo-project-1',
          id: 'customers',
        })
        .subscribe({ next, error, complete });

      expect(error).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(null);
      // Never even reaches out for a folder this store can't answer for —
      // matching `watchProjectItem()`'s own doc comment (only `/folders/~`
      // is implemented).
      expect(httpGet).not.toHaveBeenCalled();
    });
  });
});

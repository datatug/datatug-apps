import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Firestore } from 'firebase/firestore';

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
});

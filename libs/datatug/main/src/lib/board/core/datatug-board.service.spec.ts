import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../../services/base/datatug-api.service';

import { DatatugBoardService } from './datatug-board.service';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../../services/base/datatug-api.test-helpers';
import { CreateNamedRequest } from '../../dto/requests';

describe('BoardService', () => {
  let service: DatatugBoardService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DatatugBoardService,
        {
          provide: DatatugApiService,
          useValue: { post: vi.fn(), put: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(DatatugBoardService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('DatatugBoardService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DatatugBoardService, ...datatugApiRealProviders()],
    });
  });

  it('posts create_board to the DataTug API base URL', () => {
    TestBed.inject(DatatugBoardService)
      .createNewBoard({
        projectRef: { storeId: 'firestore', projectId: 'project_1' },
        name: 'Board',
      } as CreateNamedRequest)
      .subscribe();
    // Keeps today's URL shape, including the double slash after `v0/`.
    expectDatatugApiRequest('POST', '/datatug/boards/create_board');
  });
});

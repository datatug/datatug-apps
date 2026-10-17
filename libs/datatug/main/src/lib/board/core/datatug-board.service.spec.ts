import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../../services/base/datatug-api.service';

import { DatatugBoardService } from './datatug-board.service';
import {
  datatugApiRealProviders,
  datatugApiTestBaseUrl,
  datatugApiTestToken,
} from '../../services/base/datatug-api.test-helpers';
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
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(
      `${datatugApiTestBaseUrl}datatug/boards/create_board?project=project_1&store=firestore`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.params.get('project')).toBe('project_1');
    expect(request.request.headers.get('Authorization')).toBe(
      `Bearer ${datatugApiTestToken}`,
    );
    http.verify();
  });
});

import { TestBed } from '@angular/core/testing';
import { SneatApiService } from '@sneat/api';

import { DatatugBoardService } from './datatug-board.service';

describe('BoardService', () => {
  let service: DatatugBoardService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DatatugBoardService,
        {
          provide: SneatApiService,
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

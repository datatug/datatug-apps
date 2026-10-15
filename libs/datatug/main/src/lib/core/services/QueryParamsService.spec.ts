import { TestBed } from '@angular/core/testing';

import { QueryParamsService } from './QueryParamsService';

describe('QueryParamsService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [QueryParamsService],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(QueryParamsService)).toBeTruthy();
  });
});

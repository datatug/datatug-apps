import { TestBed } from '@angular/core/testing';

import { QueryContextSqlService } from './query-context-sql.service';
import { TableService } from '../services/unsorted/table.service';
import { provideMockErrorLogger } from '../testing/error-logger.spec-helper';

describe('QueryContextSqlService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        QueryContextSqlService,
        provideMockErrorLogger(),
        {
          provide: TableService,
          useValue: {
            getDbCatalogRefs: vi.fn(),
            getTableMeta: vi.fn(),
          },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(QueryContextSqlService)).toBeTruthy();
  });
});

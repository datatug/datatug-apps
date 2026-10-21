import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../base/datatug-api.service';

import { SchemaService } from './schema.service';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../base/datatug-api.test-helpers';
import { CreateNamedRequest } from '../../dto/requests';

describe('SchemaService', () => {
  let service: SchemaService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SchemaService,
        { provide: DatatugApiService, useValue: { post: vi.fn() } },
      ],
    });
    service = TestBed.inject(SchemaService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('SchemaService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SchemaService, ...datatugApiRealProviders()],
    });
  });

  it('posts create_schema to the DataTug API base URL', () => {
    TestBed.inject(SchemaService)
      .createSchema({
        projectRef: { storeId: 'firestore', projectId: 'project_1' },
        name: 'Schema',
      } as CreateNamedRequest)
      .subscribe();
    expectDatatugApiRequest('POST', 'datatug/schema/create_schema');
  });
});

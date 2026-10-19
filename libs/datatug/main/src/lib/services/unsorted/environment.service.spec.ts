import { TestBed } from '@angular/core/testing';
import { DatatugApiService } from '../base/datatug-api.service';

import { EnvironmentService } from './environment.service';
import { ProjectContextService } from '../project/project-context.service';
import { ProjectService } from '../project/project.service';
import { StoreApiService } from '../repo/store-api.service';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../base/datatug-api.test-helpers';
import { CreateNamedRequest } from '../../dto/requests';

describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EnvironmentService,
        {
          provide: ProjectContextService,
          useValue: { current: undefined, setCurrent: vi.fn() },
        },
        { provide: DatatugApiService, useValue: {} },
        { provide: ProjectService, useValue: {} },
        { provide: StoreApiService, useValue: { get: vi.fn() } },
      ],
    });
    service = TestBed.inject(EnvironmentService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

describe('EnvironmentService DataTug API base URL', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        EnvironmentService,
        ...datatugApiRealProviders(),
        { provide: ProjectService, useValue: {} },
      ],
    });
  });

  it('posts create_environment to the DataTug API base URL', () => {
    TestBed.inject(EnvironmentService)
      .createEnvironment({
        projectRef: { storeId: 'firestore', projectId: 'project_1' },
        name: 'Env',
      } as CreateNamedRequest)
      .subscribe();
    expectDatatugApiRequest('POST', 'datatug/environment/create_environment');
  });
});

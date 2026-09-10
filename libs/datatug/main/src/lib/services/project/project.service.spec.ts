import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ErrorLogger } from '@sneat/core';
import { PrivateTokenStoreService } from '@sneat/auth-core';
import { SneatApiServiceFactory } from '@sneat/api';
import { Observable, Subject } from 'rxjs';

import { ProjectService } from './project.service';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';
import { IProjectRef, projectRefToString } from '../../core/project-context';
import { IProjectSummary } from '../../models/definition/project';

describe('ProjectService', () => {
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        { provide: HttpClient, useValue: http },
        {
          provide: ErrorLogger,
          useValue: {
            logError: vi.fn(),
            logErrorHandler: vi.fn(() => vi.fn()),
          },
        },
        { provide: PrivateTokenStoreService, useValue: {} },
        {
          provide: SneatApiServiceFactory,
          useValue: { getSneatApiService: vi.fn() },
        },
        {
          provide: DatatugStoreServiceFactory,
          useValue: { getDatatugStoreService: vi.fn() },
        },
      ],
    });
  });

  it('should be created', () => {
    expect(TestBed.inject(ProjectService)).toBeTruthy();
  });

  describe('project summary cache', () => {
    const projectRef: IProjectRef = {
      storeId: 'localhost:8989',
      projectId: 'demo-project',
    };
    const summary = { id: 'demo-project' } as unknown as IProjectSummary;

    type SummaryCall = 'getSummary' | 'watchProjectSummary';
    const call = (
      service: ProjectService,
      method: SummaryCall,
    ): Observable<IProjectSummary | undefined> =>
      method === 'getSummary'
        ? service.getSummary(projectRef)
        : service.watchProjectSummary(projectRef);

    it.each<[SummaryCall, SummaryCall]>([
      ['watchProjectSummary', 'getSummary'],
      ['getSummary', 'watchProjectSummary'],
    ])(
      '%s() then %s() for the same project share one HTTP request',
      (firstCall, secondCall) => {
        const response$ = new Subject<IProjectSummary>();
        http.get.mockReturnValue(response$);
        const service = TestBed.inject(ProjectService);

        const received: Record<string, (IProjectSummary | undefined)[]> = {
          first: [],
          second: [],
        };
        call(service, firstCall).subscribe((v) => received['first'].push(v));
        call(service, secondCall).subscribe((v) => received['second'].push(v));

        response$.next(summary);
        response$.complete();

        expect(http.get).toHaveBeenCalledTimes(1);
        expect(received['first']).toEqual([summary]);
        expect(received['second']).toEqual([summary]);
      },
    );

    it('keeps a single cache entry per project, keyed by projectRefToString()', () => {
      http.get.mockReturnValue(new Subject<IProjectSummary>());
      const service = TestBed.inject(ProjectService);

      service.watchProjectSummary(projectRef).subscribe();
      service.getSummary(projectRef).subscribe();

      // Private state is inspected on purpose: the defect under test is two
      // differently keyed entries for one project in this dictionary.
      const cache = (service as unknown as { projSummary: object }).projSummary;
      expect(Object.keys(cache)).toEqual([projectRefToString(projectRef)]);
    });
  });
});

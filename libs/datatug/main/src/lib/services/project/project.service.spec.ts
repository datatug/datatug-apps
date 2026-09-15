import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ErrorLogger } from '@sneat/core';
import { PrivateTokenStoreService } from '@sneat/auth-core';
import { SneatApiService } from '@sneat/api';
import { Observable, Subject, of } from 'rxjs';

import { ProjectService } from './project.service';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';
import { IProjectRef, projectRefToString } from '../../core/project-context';
import { IProjectSummary } from '../../models/definition/project';

describe('ProjectService', () => {
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let sneatApi: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() };
    sneatApi = { post: vi.fn() };
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
        { provide: SneatApiService, useValue: sneatApi },
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

  // The cloud store's projects live in Firestore; the summary comes from the
  // Firestore store service (which watches datatug_projects/{id}), NOT from
  // ProjectService itself — it used to throw 'Not implemented' here, which made
  // every cloud project page show "Something went wrong".
  it('reads a cloud (firestore) project summary from the firestore store service', () => {
    const summary$ = new Subject<IProjectSummary | undefined>();
    const storeService = {
      getProjectSummary: vi.fn(() => summary$.asObservable()),
      watchProjectItem: vi.fn(),
    };
    TestBed.overrideProvider(DatatugStoreServiceFactory, {
      useValue: { getDatatugStoreService: vi.fn(() => storeService) },
    });
    const service = TestBed.inject(ProjectService);
    const projectRef: IProjectRef = {
      storeId: 'firestore',
      projectId: 'X91FirPb',
    };

    const received: (IProjectSummary | undefined)[] = [];
    service
      .watchProjectSummary(projectRef)
      .subscribe((summary) => received.push(summary));

    expect(storeService.getProjectSummary).toHaveBeenCalledWith('X91FirPb');

    const summary = { id: 'X91FirPb', title: 'Project 1' } as IProjectSummary;
    summary$.next(summary);
    expect(received).toEqual([summary]);
  });

  // Regression for the NG0203 the founder hit on datatug.app (2026-09-14) when
  // submitting "Create new project" from the My projects card: the call used to
  // be routed through `SneatApiServiceFactory.getSneatApiService()`, which
  // called `inject()` inside that method. A click handler has no injection
  // context, so it threw NG0203. Note these tests call `createNewProject()`
  // *outside* any `runInInjectionContext()` — the whole point of the fix is
  // that this path never needs an injection context.
  describe('createNewProject', () => {
    const projData = { title: 'New project', userIDs: [] };

    it('posts to the Firestore-backed create_project endpoint and maps the id', () => {
      sneatApi.post.mockReturnValue(of({ id: 'new-project-id' }));
      const service = TestBed.inject(ProjectService);

      let createdId: string | undefined;
      service.createNewProject('firestore', projData).subscribe((id) => {
        createdId = id;
      });

      // The path is relative to an API base URL that already ends in `/v0/`:
      // a leading slash here produced `https://api.sneat.cloud/v0//datatug/...`
      // and 404'd, so this assertion is the regression guard for that.
      expect(sneatApi.post).toHaveBeenCalledWith(
        'datatug/projects/create_project?store=firestore',
        projData,
      );
      expect(createdId).toBe('new-project-id');
    });

    it('errors as an Observable (not a throw) for an unsupported store type', () => {
      const service = TestBed.inject(ProjectService);

      let error: unknown;
      expect(() =>
        service
          .createNewProject('github', projData)
          .subscribe({ error: (err) => (error = err) }),
      ).not.toThrow();
      expect(error).toEqual(new Error('unknown store type: github'));
      expect(sneatApi.post).not.toHaveBeenCalled();
    });
  });
});

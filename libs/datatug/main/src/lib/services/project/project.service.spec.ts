import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ErrorLogger } from '@sneat/core';
import { PrivateTokenStoreService } from '@sneat/auth-core';
import { DatatugApiService } from '../base/datatug-api.service';
import { firstValueFrom, Observable, Subject, of } from 'rxjs';

import { ProjectService } from './project.service';
import { DatatugStoreServiceFactory } from '../repo/datatug-store-service-factory.service';
import { IProjectRef, projectRefToString } from '../../core/project-context';
import { IProjectSummary } from '../../models/definition/project';
import { datatugApiRealProviders, expectDatatugApiRequest } from '../base/datatug-api.test-helpers';
import { provideMockErrorLogger } from '../../testing/error-logger.spec-helper';


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
        provideMockErrorLogger(),
        { provide: PrivateTokenStoreService, useValue: {} },
        { provide: DatatugApiService, useValue: sneatApi },
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

  it('keeps full project responses separate when two agent stores use the same project ID', async () => {
    http.get.mockImplementation((url: string) =>
      of({
        id: 'demo',
        title: url.includes('8989') ? 'First store' : 'Second store',
        environments: [],
      }),
    );
    const service = TestBed.inject(ProjectService);
    const first = { storeId: 'localhost:8989', projectId: 'demo' };
    const second = { storeId: 'localhost:8990', projectId: 'demo' };

    expect((await firstValueFrom(service.getFull(first))).title).toBe(
      'First store',
    );
    expect((await firstValueFrom(service.getFull(second))).title).toBe(
      'Second store',
    );
    expect((await firstValueFrom(service.getFull(first))).title).toBe(
      'First store',
    );
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get.mock.calls[0][0]).not.toBe(http.get.mock.calls[1][0]);
  });

  it.each([
    { storeId: 'localhost:8989', projectId: 'demo', branch: 'feature' },
    {
      storeId: 'localhost:8989',
      projectId: 'demo',
      projectApi: 'local' as const,
      branch: 'feature',
    },
    {
      storeId: 'github.com',
      projectId: 'repo@owner',
      projectApi: 'cloud' as const,
      branch: 'feature',
    },
    { storeId: 'firestore', projectId: 'demo', spaceID: 'space' },
  ])(
    'rejects qualified full reads before cache or HTTP: $storeId $branch',
    async (ref) => {
      const service = TestBed.inject(ProjectService);
      await expect(firstValueFrom(service.getFull(ref))).rejects.toThrow(
        'Project full reads are unavailable',
      );
      expect(http.get).not.toHaveBeenCalled();
      expect(
        Object.keys((service as unknown as { projects: object }).projects),
      ).toEqual([]);
    },
  );

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

  it('loads direct GitHub project summaries from the selected branch', () => {
    const storeService = { getProjectSummary: vi.fn(() => of({ id: 'p' })) };
    TestBed.overrideProvider(DatatugStoreServiceFactory, {
      useValue: { getDatatugStoreService: vi.fn(() => storeService) },
    });
    TestBed.inject(ProjectService)
      .watchProjectSummary({
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        branch: 'work',
      })
      .subscribe();
    expect(storeService.getProjectSummary).toHaveBeenCalledWith(
      'repo@owner@folder@work',
    );
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
        { ...projData, billingIntent: 'personal_pro' },
      );
      expect(createdId).toBe('new-project-id');
    });

    it('preserves an explicit Space Business billing intent in the request', () => {
      sneatApi.post.mockReturnValue(of({ id: 'new-project-id' }));
      const service = TestBed.inject(ProjectService);

      service
        .createNewProject('firestore', {
          ...projData,
          billingIntent: 'space_business',
          spaceID: 'space_1',
        })
        .subscribe();

      expect(sneatApi.post).toHaveBeenCalledWith(
        'datatug/projects/create_project?store=firestore',
        {
          ...projData,
          billingIntent: 'space_business',
          spaceID: 'space_1',
        },
      );
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

describe('ProjectService local summary HTTP context', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockErrorLogger(),
        { provide: PrivateTokenStoreService, useValue: {} },
        { provide: DatatugApiService, useValue: { post: vi.fn() } },
        {
          provide: DatatugStoreServiceFactory,
          useValue: { getDatatugStoreService: vi.fn() },
        },
      ],
    });
  });

  it.each([
    ['http-localhost:8989', 'http://localhost:8989'],
    ['localhost:8989', '//localhost:8989'],
  ])(
    'sends the selected branch to the guarded local project summary endpoint for %s',
    async (storeId, baseUrl) => {
      const service = TestBed.inject(ProjectService);
      const request = firstValueFrom(
        service.getSummary({
          storeId,
          projectId: 'demo',
          projectApi: 'local',
          branch: 'feature/demo',
        }),
      );
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(`${baseUrl}/datatug/agent-info`).flush({
        version: '0.97.0',
        uptimeMinutes: 3,
      });
      const call = http.expectOne(
        (item) =>
          item.url === `${baseUrl}/datatug/projects/project_summary` &&
          item.params.get('id') === 'demo' &&
          item.params.get('branch') === 'feature/demo',
      );
      expect(call.request.params.get('id')).toBe('demo');
      expect(call.request.params.get('branch')).toBe('feature/demo');
      call.flush({ id: 'demo', title: 'Feature demo' });
      expect((await request)?.title).toBe('Feature demo');
      http.verify();
    },
  );

  it.each(['0.93.0', 'dev'])(
    'blocks qualified summary HTTP when local CLI version is %s',
    async (version) => {
      const service = TestBed.inject(ProjectService);
      const request = firstValueFrom(
        service.getSummary({
          storeId: 'http-localhost:8989',
          projectId: 'demo',
          projectApi: 'local',
          branch: 'feature/demo',
        }),
      );
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('http://localhost:8989/datatug/agent-info').flush({
        version,
        uptimeMinutes: 3,
      });
      await expect(request).rejects.toThrow(
        /update DataTug CLI to v0\.97\.0 or later.*restart/i,
      );
      http.expectNone((item) => item.url.includes('/projects/project_summary'));
      http.verify();
    },
  );
});

describe('ProjectService shared operation fence', () => {
  it('refuses getFull even if the legacy same-ID cache already contains a result', () => {
    const http = { get: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        { provide: HttpClient, useValue: http },
        { provide: DatatugApiService, useValue: {} },
        { provide: ErrorLogger, useValue: {} },
        { provide: PrivateTokenStoreService, useValue: {} },
        { provide: DatatugStoreServiceFactory, useValue: {} },
      ],
    });
    const service = TestBed.inject(ProjectService);
    (
      service as unknown as {
        projects: Record<string, Observable<IProjectSummary>>;
      }
    ).projects['same'] = of({
      id: 'same',
      title: 'private',
      access: 'private',
    });
    let error: unknown;
    service
      .getFull({ storeId: 'firestore', spaceID: 'S1', projectId: 'same' })
      .subscribe({ error: (e) => (error = e) });
    expect(error).toBeTruthy();
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe('ProjectService DataTug API base URL', () => {
  it('posts create_project to the DataTug API base URL', () => {
    TestBed.configureTestingModule({
      providers: [
        ProjectService,
        ...datatugApiRealProviders(),
        provideMockErrorLogger(),
        { provide: PrivateTokenStoreService, useValue: {} },
        {
          provide: DatatugStoreServiceFactory,
          useValue: { getDatatugStoreService: vi.fn() },
        },
      ],
    });
    TestBed.inject(ProjectService)
      .createNewProject('firestore', { title: 'New project', userIDs: [] } as never)
      .subscribe();
    expectDatatugApiRequest('POST', 'datatug/projects/create_project');
  });
});

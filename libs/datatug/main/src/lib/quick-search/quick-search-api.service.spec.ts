import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SneatApiNotAuthenticatedError } from '@sneat/api';
import { DatatugApiService } from '../services/base/datatug-api.service';
import {
  QuickSearchApiService,
  quickSearchParams,
} from './quick-search-api.service';

describe('QuickSearchApiService', () => {
  const ref = { storeId: 'firestore', spaceID: 'space', projectId: 'project' };
  it('uses the complete established project identity', () => {
    const params = quickSearchParams(ref);
    expect(params.get('storage')).toBe('firestore');
    expect(params.get('spaceID')).toBe('space');
    expect(params.get('project')).toBe('project');
    expect(() => quickSearchParams({ ...ref, spaceID: '../other' })).toThrow();
  });
  it('reads status without sending a snapshot and uploads only explicit enable consent', () => {
    const api = {
      get: vi.fn((...args: unknown[]) => {
        void args;
        return of({});
      }),
      post: vi.fn((...args: unknown[]) => {
        void args;
        return of({});
      }),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    const service = TestBed.inject(QuickSearchApiService);
    service.status(ref).subscribe();
    expect(api.post).not.toHaveBeenCalled();
    service.enable(ref, { documents: [], sourceCoverage: [] }).subscribe();
    expect(api.post.mock.calls[0][0]).toBe(
      'datatug/project/quick-search/enable',
    );
    expect(api.post.mock.calls[0][1]).toEqual({
      consent: true,
      consentVersion: 'project-quick-search/1',
      documents: [],
      sourceCoverage: [],
    });
  });
  it('allows anonymous public GitHub reads only when no signed-in token exists', () => {
    const api = {
      get: vi.fn(() => throwError(() => SneatApiNotAuthenticatedError)),
      getAsAnonymous: vi.fn(() => of({ state: 'ready' })),
      post: vi.fn(() => throwError(() => SneatApiNotAuthenticatedError)),
      postAsAnonymous: vi.fn((endpoint: string) => of({ items: [], endpoint })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    const service = TestBed.inject(QuickSearchApiService),
      github = { storeId: 'github.com', projectId: 'repo@owner@' };
    service.status(github).subscribe();
    service.search(github, 'customer').subscribe();
    expect(api.getAsAnonymous).toHaveBeenCalledOnce();
    expect(api.postAsAnonymous).toHaveBeenCalledOnce();
    expect(api.postAsAnonymous.mock.calls[0][0]).not.toContain('customer');
  });
  it('never retries protected or HTTP-denied reads anonymously', () => {
    const api = {
      get: vi.fn(() => throwError(() => ({ status: 403 }))),
      getAsAnonymous: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    TestBed.inject(QuickSearchApiService)
      .status(ref)
      .subscribe({ error: () => undefined });
    expect(api.getAsAnonymous).not.toHaveBeenCalled();
  });
});

describe('authenticated Quick Search metadata preview', () => {
  it('uses only the established qualified identity and optional environment body', () => {
    const post = vi.fn(() => of({ documents: [], sourceCoverage: [] }));
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: { post } }],
    });
    const service = TestBed.inject(QuickSearchApiService),
      ref = {
        storeId: 'github.com',
        projectId: 'repo@owner@folder',
        projectApi: 'cloud' as const,
        branch: 'private-ref',
      };
    service.preview(ref, 'env-1').subscribe();
    const [path, body, options] = post.mock.calls[0] as unknown as [
      string,
      unknown,
      { params: import('@angular/common/http').HttpParams },
    ];
    expect(path).toBe('datatug/project/quick-search/preview');
    expect(body).toEqual({ environmentId: 'env-1' });
    expect(options.params.get('project')).toBe('repo@owner@folder');
    expect(options.params.get('branch')).toBe('private-ref');
    service.preview(ref).subscribe();
    expect((post.mock.calls[1] as unknown[])[1]).toEqual({});
  });
  it.each([SneatApiNotAuthenticatedError, { status: 403 }])(
    'never retries preview anonymously (%s)',
    (error) => {
      const api = {
        post: vi.fn(() => throwError(() => error)),
        postAsAnonymous: vi.fn(),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: DatatugApiService, useValue: api }],
      });
      TestBed.inject(QuickSearchApiService)
        .preview({
          storeId: 'github.com',
          projectId: 'repo@owner@',
          projectApi: 'cloud',
        })
        .subscribe({ error: () => undefined });
      expect(api.postAsAnonymous).not.toHaveBeenCalled();
      expect(api.post).toHaveBeenCalledOnce();
    },
  );
});

describe('Quick Search status fields and typed search errors', () => {
  const ref = { storeId: 'firestore', spaceID: 's', projectId: 'p' };
  it('passes schemaVersion and countsUnavailable through unchanged', () => {
    const body = {
      state: 'ready',
      canManage: false,
      eligible: false,
      audience: 'private',
      provider: 'Typesense',
      documentCount: 0,
      schemaVersion: 2,
      countsUnavailable: 'not_eligible',
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DatatugApiService,
          useValue: { get: vi.fn(() => of(body)) },
        },
      ],
    });
    let received: unknown;
    TestBed.inject(QuickSearchApiService)
      .status(ref)
      .subscribe((status) => (received = status));
    expect(received).toEqual(body);
  });
  it('searches without any status call', () => {
    const api = {
      get: vi.fn(),
      post: vi.fn(() => of({ items: [], tags: [], itemCount: 0 })),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    TestBed.inject(QuickSearchApiService).search(ref, 'x').subscribe();
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.get).not.toHaveBeenCalled();
  });
  it.each([
    'quick_search_reindex_required',
    'quick_search_unsupported_storage',
    'quick_search_premium_required',
    'consent_required',
  ])('surfaces the %s error untouched with no anonymous retry', (code) => {
    const failure = { status: 409, error: { error: { code } } };
    const api = {
      post: vi.fn(() => throwError(() => failure)),
      postAsAnonymous: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DatatugApiService, useValue: api }],
    });
    let received: unknown;
    TestBed.inject(QuickSearchApiService)
      .search({ storeId: 'github.com', projectId: 'repo@owner@' }, 'x')
      .subscribe({ error: (error) => (received = error) });
    expect(received).toBe(failure);
    expect(api.postAsAnonymous).not.toHaveBeenCalled();
  });
});

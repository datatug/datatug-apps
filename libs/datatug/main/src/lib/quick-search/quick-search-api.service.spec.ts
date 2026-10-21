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

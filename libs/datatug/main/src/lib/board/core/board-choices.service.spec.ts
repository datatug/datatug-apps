import { TestBed } from '@angular/core/testing';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject } from 'rxjs';
import { BoardChoicesService } from './board-choices.service';

describe('BoardChoicesService', () => {
  const auth = new BehaviorSubject<{
    status: 'notAuthenticated' | 'authenticated';
    user?: { uid: string };
  }>({ status: 'notAuthenticated' });
  const ref = { storeId: 'github.com', projectId: 'demo@owner@@main' };
  let service: BoardChoicesService;

  beforeEach(() => {
    localStorage.clear();
    auth.next({ status: 'notAuthenticated' });
    TestBed.configureTestingModule({
      providers: [
        BoardChoicesService,
        {
          provide: SneatAuthStateService,
          useValue: { authState: auth.asObservable() },
        },
      ],
    });
    service = TestBed.inject(BoardChoicesService);
  });

  it('stores only choices and isolates actor, board, and full project ref', () => {
    expect(service.setFavorite(ref, 'board1', true)).toBe(true);
    expect(service.selectQuery(ref, 'board1', 'demodb/q')).toBe(true);
    expect(service.read(ref, 'board1')).toEqual({
      favorite: true,
      selectedQueryId: 'demodb/q',
    });
    expect(service.read(ref, 'board2').favorite).toBe(false);
    expect(service.read({ ...ref, branch: 'feature' }, 'board1').favorite).toBe(
      false,
    );
    expect(
      service.read({ ...ref, projectApi: 'cloud' }, 'board1').favorite,
    ).toBe(false);
    auth.next({ status: 'authenticated', user: { uid: 'person-1' } });
    expect(service.read(ref, 'board1').favorite).toBe(false);
    expect(
      Array.from({ length: localStorage.length }, (_, i) =>
        localStorage.getItem(localStorage.key(i) || ''),
      ).join(''),
    ).not.toContain('rows');
  });

  it('does not use malformed persisted choices as authority', () => {
    service.setFavorite(ref, 'board1', true);
    const key = localStorage.key(0);
    if (!key) throw new Error('Expected a stored choice');
    localStorage.setItem(
      key,
      JSON.stringify({
        favorite: 'true',
        selectedQueryId: 4,
        result: { rows: [1] },
      }),
    );
    expect(service.read(ref, 'board1')).toEqual({ favorite: false });
  });

  it('does not persist choices for a local agent without an attested principal', () => {
    const local = {
      storeId: 'agent',
      projectId: 'personal',
      projectApi: 'local' as const,
      branch: 'main',
    };
    expect(service.canPersist(local)).toBe(false);
    expect(service.setFavorite(local, 'board1', true)).toBe(false);
    expect(service.selectQuery(local, 'board1', 'q')).toBe(false);
    expect(service.read(local, 'board1')).toEqual({ favorite: false });
    expect(localStorage.length).toBe(0);
  });
});

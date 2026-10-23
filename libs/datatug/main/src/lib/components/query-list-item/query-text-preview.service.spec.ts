import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { QueriesService } from '../../queries/queries.service';
import { QueryTextPreviewService } from './query-text-preview.service';

const ref = { storeId: 'github.com', projectId: 'repo@owner@folder' };

function setup(getQuery: ReturnType<typeof vi.fn>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: QueriesService, useValue: { getQuery } }],
  });
  return TestBed.inject(QueryTextPreviewService);
}

describe('QueryTextPreviewService', () => {
  it('returns the same loader for the same query and caches the text across rows', async () => {
    const getQuery = vi.fn(() => of({ request: { text: 'select 1' } }));
    const service = setup(getQuery);
    const first = service.loader(ref, 'sales/orders');
    expect(service.loader(ref, 'sales/orders')).toBe(first);
    expect(await firstValueFrom(first())).toBe('select 1');
    expect(await firstValueFrom(service.loader(ref, 'sales/orders')())).toBe(
      'select 1',
    );
    expect(getQuery).toHaveBeenCalledOnce();
    expect(getQuery).toHaveBeenCalledWith(ref, 'sales/orders');
  });

  it('keys the cache per project', async () => {
    const getQuery = vi.fn(() => of({ request: { text: 'select 1' } }));
    const service = setup(getQuery);
    await firstValueFrom(service.loader(ref, 'q')());
    await firstValueFrom(
      service.loader({ ...ref, projectId: 'other@owner@' }, 'q')(),
    );
    expect(getQuery).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request and cancels it when nobody waits any more', () => {
    const pending = new Subject<{ request: { text: string } }>();
    const getQuery = vi.fn(() => pending);
    const service = setup(getQuery);
    const a = service.loader(ref, 'q')().subscribe();
    const b = service.loader(ref, 'q')().subscribe();
    expect(getQuery).toHaveBeenCalledOnce();
    a.unsubscribe();
    expect(pending.observed).toBe(true);
    b.unsubscribe();
    expect(pending.observed).toBe(false);
  });

  it('uses a listed text without a request', async () => {
    const getQuery = vi.fn();
    const service = setup(getQuery);
    expect(await firstValueFrom(service.loader(ref, 'q', 'select 2')())).toBe(
      'select 2',
    );
    expect(getQuery).not.toHaveBeenCalled();
  });

  it('forgets a failed read so a later hover retries', async () => {
    const getQuery = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ request: { text: 'select 3' } }));
    const service = setup(getQuery);
    await expect(firstValueFrom(service.loader(ref, 'q')())).rejects.toThrow(
      'offline',
    );
    expect(await firstValueFrom(service.loader(ref, 'q')())).toBe('select 3');
    expect(getQuery).toHaveBeenCalledTimes(2);
  });
});

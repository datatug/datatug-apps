import { Subject } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { ProjectItemsByAgent } from './caching';

describe('ProjectItemsByAgent', () => {
  const ref: IProjectRef = { storeId: 's1', projectId: 'p1' };
  const otherRef: IProjectRef = { storeId: 's1', projectId: 'p1', branch: 'dev' };
  let cache: ProjectItemsByAgent<string>;

  beforeEach(() => {
    cache = new ProjectItemsByAgent<string>();
  });

  it('returns nothing for an unknown or missing ref', () => {
    expect(cache.getItems$(ref)).toBeUndefined();
    expect(cache.getSubject(ref)).toBeUndefined();
    const missing = undefined as unknown as IProjectRef;
    expect(cache.getItems$(missing)).toBeUndefined();
    expect(cache.getSubject(missing)).toBeUndefined();
    expect(() => cache.clear(missing)).not.toThrow();
  });

  it('throws when setting items for a missing ref', () => {
    expect(() =>
      cache.setItems$(undefined as unknown as IProjectRef, new Subject()),
    ).toThrow('Invalid project reference for project-item cache');
  });

  it('caches items per full project ref and skips the initial undefined', () => {
    const source = new Subject<string[]>();
    const seen: string[][] = [];
    const cached: string[][] = [];
    cache.setItems$(ref, source).subscribe((v) => seen.push(v));
    expect(seen).toEqual([]);
    expect(cache.getItems$(otherRef)).toBeUndefined();

    source.next(['a']);
    expect(seen).toEqual([['a']]);
    expect(cache.getSubject(ref)?.value).toEqual(['a']);

    cache.getItems$(ref)?.subscribe((v) => cached.push(v));
    expect(cached).toEqual([['a']]);
    source.next(['b']);
    expect(cached).toEqual([['a'], ['b']]);
  });

  it('clear removes the cached entry', () => {
    cache.setItems$(ref, new Subject());
    cache.clear(ref);
    expect(cache.getSubject(ref)).toBeUndefined();
  });

  it('evicts the entry and propagates errors from the source', () => {
    const source = new Subject<string[]>();
    const onError = vi.fn();
    cache.setItems$(ref, source).subscribe({ error: onError });
    const err = new Error('boom');
    source.error(err);
    expect(onError).toHaveBeenCalledWith(err);
    expect(cache.getSubject(ref)).toBeUndefined();
  });

  it('keeps a newer entry when a superseded source errors', () => {
    const first = new Subject<string[]>();
    const onError = vi.fn();
    cache.setItems$(ref, first).subscribe({ error: onError });
    cache.setItems$(ref, new Subject());
    const current = cache.getSubject(ref);
    first.error(new Error('stale'));
    expect(onError).toHaveBeenCalled();
    expect(cache.getSubject(ref)).toBe(current);
    expect(current).toBeDefined();
  });
});

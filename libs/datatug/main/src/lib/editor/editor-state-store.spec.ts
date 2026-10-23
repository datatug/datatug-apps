import { firstValueFrom, isEmpty } from 'rxjs';
import { EditorStateStore } from './editor-state-store';
import { IQueryStateDto } from './models';

describe('EditorStateStore', () => {
  const state = { queryType: 'SQL' } as IQueryStateDto;

  it('returns undefined for an unknown id', async () => {
    const store = new EditorStateStore();
    await expect(firstValueFrom(store.getQueryStateDto('q1'))).resolves.toBeUndefined();
  });

  it('saves a state that completes without emitting and is read back by id', async () => {
    const store = new EditorStateStore();
    await expect(
      firstValueFrom(store.saveQueryStateDto('q1', state).pipe(isEmpty())),
    ).resolves.toBe(true);
    expect(store.states).toEqual({ q1: state });
    await expect(firstValueFrom(store.getQueryStateDto('q1'))).resolves.toBe(state);
    await expect(firstValueFrom(store.getQueryStateDto('q2'))).resolves.toBeUndefined();
  });

  it('overwrites a previously saved state and keeps stores independent', async () => {
    const store = new EditorStateStore();
    const next = { queryType: 'HTTP' } as IQueryStateDto;
    store.saveQueryStateDto('q1', state);
    store.saveQueryStateDto('q1', next);
    await expect(firstValueFrom(store.getQueryStateDto('q1'))).resolves.toBe(next);
    expect(new EditorStateStore().states).toEqual({});
  });
});

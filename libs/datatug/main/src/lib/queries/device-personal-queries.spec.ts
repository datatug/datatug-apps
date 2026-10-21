import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, it, expect } from 'vitest';
import {
  DevicePersonalQueries,
  isDevicePersonalQuery,
} from './device-personal-queries';
import { QueryType } from '../models/definition/query-def';
import { createSemanticModel } from './semantic-mapping';
describe('device personal complete query persistence', () => {
  const ref = { storeId: 'github.com', projectId: 'repo@owner@folder' };
  const id = 'device-personal-11111111-1111-1111-1111-111111111111';
  const query = {
    id,
    title: 'My query',
    request: { queryType: QueryType.SQL, text: 'SELECT Email FROM Customer' },
    connectionId: 'chinook-sqlite',
    semanticModel: createSemanticModel({
      queryHash: 'a'.repeat(64),
      resultIndex: 0,
      columns: [{ name: 'Email', dataType: 'string' }],
    }),
  };
  query.semanticModel.meaning.concepts.push({
    id: 'customer',
    kind: 'entity',
    labels: { en: 'Customer' },
    description: 'Customer',
  });
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  it('cold reopens the full query and bundle under the same project only', async () => {
    await new DevicePersonalQueries().save(ref, query, 0);
    const reopened = await new DevicePersonalQueries().read(ref, id);
    expect(reopened.query).toEqual(query);
    expect(reopened.revision).toBe(1);
    await expect(
      new DevicePersonalQueries().read({ ...ref, projectId: 'other' }, id),
    ).rejects.toThrow('unavailable');
  });
  it('rejects concurrent stale writes atomically and retains committed data', async () => {
    const store = new DevicePersonalQueries();
    await store.save(ref, query, 0);
    await store.save(ref, { ...query, title: 'Committed' }, 1);
    await expect(
      store.save(ref, { ...query, title: 'Stale' }, 1),
    ).rejects.toThrow('another tab');
    expect((await store.read(ref, id)).query.title).toBe('Committed');
  });
  it('replays an unchanged retry without a second revision', async () => {
    const store = new DevicePersonalQueries();
    await store.save(ref, query, 0);
    expect((await store.save(ref, query, 0)).revision).toBe(1);
    expect((await store.read(ref, id)).revision).toBe(1);
  });
  it('detaches canonical provider references while preserving a personal definition snapshot', async () => {
    const linked = structuredClone(query);
    linked.semanticModel.meaning.concepts[0].meaningRef = {
      documentId: 'project',
      conceptId: 'customer',
      scope: { storage: 'firestore', project: 'p1', spaceID: 's1' },
    };
    const store = new DevicePersonalQueries();
    await store.save(ref, linked, 0);
    const reopened = await store.read(ref, id);
    expect(
      reopened.query.semanticModel?.meaning.concepts[0].meaningRef,
    ).toBeUndefined();
    expect(reopened.query.semanticModel?.meaning.concepts[0].labels).toEqual(
      linked.semanticModel.meaning.concepts[0].labels,
    );
    expect(linked.semanticModel.meaning.concepts[0].meaningRef).toBeDefined();
  });
  it('refuses non-personal identities', async () => {
    expect(isDevicePersonalQuery('shared-query')).toBe(false);
    await expect(
      new DevicePersonalQueries().save(
        ref,
        { ...query, id: 'shared-query' },
        0,
      ),
    ).rejects.toThrow('identity');
  });
});

describe('device query rejects invalid semantic input before mutation', () => {
  it('rejects malformed/credential documents and preserves original complete query', async () => {
    globalThis.indexedDB = new IDBFactory();
    const ref = { storeId: 'github.com', projectId: 'repo@owner@folder' },
      store = new DevicePersonalQueries();
    const semanticModel = createSemanticModel({
      queryHash: 'a'.repeat(64),
      resultIndex: 0,
      columns: [{ name: 'ID', dataType: 'integer' }],
    });
    semanticModel.meaning.concepts = [
      {
        id: 'invoice',
        kind: 'entity',
        labels: { en: 'Invoice' },
        description: 'Invoice',
      },
    ];
    const query = {
      id: 'device-personal-22222222-2222-2222-2222-222222222222',
      request: { queryType: QueryType.SQL, text: 'SELECT ID' },
      semanticModel,
    };
    await store.save(ref, query, 0);
    for (const mutate of [
      (bundle: typeof semanticModel) => {
        bundle.meaning.concepts[0].description = 'Bearer not-a-real-token';
      },
      (bundle: typeof semanticModel) => {
        bundle.model.records.QueryResult.fields['column2'] = { type: 'any' };
      },
      (bundle: typeof semanticModel) => {
        (bundle.meaning.concepts[0].labels as unknown as { en: number }).en =
          42;
      },
    ]) {
      const invalid = structuredClone(query);
      mutate(invalid.semanticModel);
      await expect(store.save(ref, invalid, 1)).rejects.toThrow('invalid');
      expect((await store.read(ref, query.id)).query).toEqual(query);
    }
  });
});

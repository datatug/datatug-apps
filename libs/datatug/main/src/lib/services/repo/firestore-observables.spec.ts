import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  disableNetwork,
  doc,
  initializeFirestore,
  memoryLocalCache,
  setDoc,
  terminate,
  type Firestore,
} from 'firebase/firestore';
import { firstValueFrom, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { collectionData, docData, docSnapshots } from './firestore-observables';

/** An offline, in-memory Firestore: listeners run against the local cache only. */
async function offlineFirestore(
  name: string,
): Promise<{ app: FirebaseApp; db: Firestore }> {
  const app = initializeApp({ projectId: 'demo-offline', apiKey: 'fake' }, name);
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  await disableNetwork(db);
  return { app, db };
}

/** Offline writes never resolve, but land in the local cache immediately. */
function writeLocally(
  db: Firestore,
  path: string,
  data: Record<string, unknown>,
): void {
  void setDoc(doc(db, path), data).catch(() => undefined);
}

const firstMatching = <T>(source: Observable<T>, test: (value: T) => boolean) =>
  firstValueFrom(source.pipe(filter(test)));

describe('firestore-observables', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    ({ app, db } = await offlineFirestore(`fo-${Math.random()}`));
  });

  afterEach(async () => {
    await terminate(db);
    await deleteApp(app);
  });

  it('docSnapshots emits snapshots of a document', async () => {
    writeLocally(db, 'spaces/s1', { title: 'One' });
    const snapshot = await firstMatching(
      docSnapshots(doc(db, 'spaces/s1')),
      (s) => s.exists(),
    );
    expect(snapshot.id).toBe('s1');
    expect(snapshot.data()).toEqual({ title: 'One' });
  });

  it.each([
    [undefined, { title: 'One' }],
    [{}, { title: 'One' }],
    [{ idField: '__id' }, { title: 'One', __id: 's1' }],
  ])('docData with options %j emits %j', async (options, expected) => {
    writeLocally(db, 'spaces/s1', { title: 'One' });
    const data = await firstMatching(
      docData(doc(db, 'spaces/s1'), options),
      (d) => d !== undefined,
    );
    expect(data).toEqual(expected);
  });

  it('docData emits undefined for a missing document', async () => {
    await expect(
      firstValueFrom(docData(doc(db, 'spaces/missing'))),
    ).resolves.toBeUndefined();
  });

  it.each([
    [undefined, [{ n: 1 }, { n: 2 }]],
    [
      { idField: 'id' },
      [
        { n: 1, id: 'a' },
        { n: 2, id: 'b' },
      ],
    ],
  ])('collectionData with options %j emits %j', async (options, expected) => {
    writeLocally(db, 'items/a', { n: 1 });
    writeLocally(db, 'items/b', { n: 2 });
    const items = await firstMatching(
      collectionData(collection(db, 'items'), options),
      (list) => list.length === 2,
    );
    expect(items).toEqual(expected);
  });

  it('collectionData emits an empty list for an unknown collection', async () => {
    await expect(
      firstValueFrom(collectionData(collection(db, 'nothing'))),
    ).resolves.toEqual([]);
  });

  it.each([
    ['docSnapshots', () => docSnapshots(doc(db, 'spaces/s1'))],
    ['collectionData', () => collectionData(collection(db, 'items'))],
  ])('%s forwards listener errors to the subscriber', async (_, source) => {
    const error = new Promise((resolve) =>
      source().subscribe({ error: resolve }),
    );
    await terminate(db);
    await expect(error).resolves.toBeTruthy();
  });

  it('unsubscribing stops the listener', async () => {
    const seen: unknown[] = [];
    const subscription = docData(doc(db, 'spaces/s2')).subscribe((value) =>
      seen.push(value),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    subscription.unsubscribe();
    const count = seen.length;
    writeLocally(db, 'spaces/s2', { title: 'later' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.length).toBe(count);
  });
});

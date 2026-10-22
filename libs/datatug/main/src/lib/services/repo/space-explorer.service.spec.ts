import { TestBed } from '@angular/core/testing';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  disableNetwork,
  doc,
  Firestore,
  initializeFirestore,
  memoryLocalCache,
  setDoc,
  terminate,
} from 'firebase/firestore';
import { firstValueFrom, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SpaceExplorerService } from './space-explorer.service';

const firstMatching = <T>(source: Observable<T>, test: (value: T) => boolean) =>
  firstValueFrom(source.pipe(filter(test)));

describe('SpaceExplorerService', () => {
  let app: FirebaseApp;
  let db: Firestore;
  let service: SpaceExplorerService;

  // Offline in-memory Firestore: writes land in the local cache (their
  // promises never resolve) and listeners read only that cache.
  const writeLocally = (path: string, data: Record<string, unknown>) =>
    void setDoc(doc(db, path), data).catch(() => undefined);

  beforeEach(async () => {
    app = initializeApp(
      { projectId: 'demo-offline', apiKey: 'fake' },
      `se-${Math.random()}`,
    );
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
    await disableNetwork(db);
    TestBed.configureTestingModule({
      providers: [SpaceExplorerService, { provide: Firestore, useValue: db }],
    });
    service = TestBed.inject(SpaceExplorerService);
  });

  afterEach(async () => {
    await terminate(db);
    await deleteApp(app);
  });

  it('streams a document with its id and path, omitting the internal id field', async () => {
    writeLocally('spaces/s1', { title: 'Space', count: 2 });
    const explored = await firstMatching(
      service.watchDocument$(['spaces', 's1']),
      (d) => d.data !== undefined,
    );
    expect(explored).toEqual({
      id: 's1',
      path: 'spaces/s1',
      data: { title: 'Space', count: 2 },
    });
  });

  it('streams undefined data for a missing document', async () => {
    await expect(
      firstValueFrom(service.watchDocument$(['spaces', 'nope'])),
    ).resolves.toEqual({ id: 'nope', path: 'spaces/nope', data: undefined });
  });

  it('streams collection items with ids and full paths', async () => {
    writeLocally('spaces/s1/ext/contactus', { a: 1 });
    writeLocally('spaces/s1/ext/listus', { b: 2 });
    const items = await firstMatching(
      service.watchCollection$(['spaces', 's1', 'ext']),
      (list) => list.length === 2,
    );
    expect(items).toEqual([
      { id: 'contactus', path: 'spaces/s1/ext/contactus', data: { a: 1 } },
      { id: 'listus', path: 'spaces/s1/ext/listus', data: { b: 2 } },
    ]);
  });

  it('streams an empty list for a collection that does not exist', async () => {
    await expect(
      firstValueFrom(service.watchCollection$(['spaces', 's1', 'none'])),
    ).resolves.toEqual([]);
  });

  it.each([
    ['document', () => service.watchDocument$(['spaces'])],
    ['collection', () => service.watchCollection$(['spaces', 's1'])],
  ])('rejects a %s path with the wrong segment parity', (_, watch) => {
    expect(watch).toThrow();
  });
});

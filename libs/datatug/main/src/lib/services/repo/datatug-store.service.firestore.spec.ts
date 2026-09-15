import { TestBed } from '@angular/core/testing';
import { Firestore } from 'firebase/firestore';
import { Observable, Subject, of, throwError } from 'rxjs';
import { IProjectSummary } from '../../models/definition/project';
import {
  DatatugStoreFirestoreService,
  FIRESTORE_PROJECTS_COLLECTION,
} from './datatug-store.service.firestore';

const { docMock, docDataMock } = vi.hoisted(() => ({
  docMock: vi.fn((..._args: unknown[]) => ({ path: 'stub' })),
  docDataMock: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: (...args: unknown[]) => docMock(...args),
}));

vi.mock('./firestore-observables', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./firestore-observables')>()),
  docData: (...args: unknown[]) => docDataMock(...args),
}));

describe('DatatugStoreFirestoreService.getProjectSummary', () => {
  let service: DatatugStoreFirestoreService;

  beforeEach(() => {
    docMock.mockClear();
    docDataMock.mockClear();
    TestBed.configureTestingModule({
      providers: [
        DatatugStoreFirestoreService,
        { provide: Firestore, useValue: {} },
      ],
    });
    service = TestBed.inject(DatatugStoreFirestoreService);
  });

  it('watches the cloud project record and adds the project id', () => {
    // A Subject, not of(...): the summary must arrive after the caller has
    // subscribed, the way Firestore emits.
    const project$ = new Subject<IProjectSummary | undefined>();
    docDataMock.mockReturnValue(project$.asObservable());

    const received: (IProjectSummary | undefined)[] = [];
    service
      .getProjectSummary('X91FirPb')
      .subscribe((summary) => received.push(summary));

    expect(docMock).toHaveBeenCalledWith(
      expect.anything(),
      FIRESTORE_PROJECTS_COLLECTION,
      'X91FirPb',
    );

    project$.next({ title: 'Project 1' } as IProjectSummary);

    // The record itself has no `id` field (the document id is the project id),
    // so the summary carries it — pages and caches key off it.
    expect(received).toEqual([{ title: 'Project 1', id: 'X91FirPb' }]);
  });

  it('emits undefined for a project record that does not exist', () => {
    docDataMock.mockReturnValue(of(undefined));

    const received: (IProjectSummary | undefined)[] = [];
    service
      .getProjectSummary('missing')
      .subscribe((summary) => received.push(summary));

    expect(received).toEqual([undefined]);
  });

  it('rejects an empty project id without touching Firestore', () => {
    let error: unknown;
    service.getProjectSummary('').subscribe({ error: (err) => (error = err) });

    expect(error).toBe('projectId is a required parameter');
    expect(docMock).not.toHaveBeenCalled();
  });
});

import {
  CollectionReference,
  DocumentData,
  DocumentReference,
  FirestoreError,
  QuerySnapshot,
  DocumentSnapshot,
  onSnapshot,
} from 'firebase/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export function docSnapshots<T = DocumentData>(
  ref: DocumentReference<T>,
): Observable<DocumentSnapshot<T>> {
  return new Observable((subscriber) =>
    onSnapshot(
      ref,
      (snapshot) => subscriber.next(snapshot),
      (error: FirestoreError) => subscriber.error(error),
    ),
  );
}

export function docData<T = DocumentData>(
  ref: DocumentReference<T>,
  options?: { idField?: string },
): Observable<T | undefined> {
  return docSnapshots(ref).pipe(
    map((snapshot) => {
      if (!snapshot.exists()) {
        return undefined;
      }
      const data = snapshot.data() as T;
      return options?.idField
        ? ({ ...data, [options.idField]: snapshot.id } as T)
        : data;
    }),
  );
}

export function collectionData<T = DocumentData>(
  ref: CollectionReference<T>,
  options?: { idField?: string },
): Observable<T[]> {
  return new Observable((subscriber) =>
    onSnapshot(
      ref,
      (snapshot: QuerySnapshot<T>) => {
        subscriber.next(
          snapshot.docs.map((doc) => {
            const data = doc.data() as T;
            return options?.idField
              ? ({ ...data, [options.idField]: doc.id } as T)
              : data;
          }),
        );
      },
      (error: FirestoreError) => subscriber.error(error),
    ),
  );
}

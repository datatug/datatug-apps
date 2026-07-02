// READ-ONLY BY CONSTRUCTION.
//
// This service backs the "Explore my raw data" transparency viewer
// (see backstage/docs/roadmaps/datatug-transparency-explorer.md). It must
// NEVER import or call a Firestore write API (setDoc/updateDoc/deleteDoc/
// addDoc/writeBatch/runTransaction). It only ever reads `spaces/{spaceId}`
// and whatever the signed-in user's own Firestore security rules
// (`match /spaces/{space}/{document=**}`) already let them read — same
// AngularFire session `datatug-apps` already authenticates with against
// `sneat-eur3-1` for the rest of the app (see
// `apps/datatug-app/src/environments/environment.prod.ts`).
//
// Path model: a Firestore path is an alternating list of segments,
// `[collection, doc, collection, doc, ...]`. The explorer always starts at
// the space document itself, `spaces/{spaceId}` (an even number of
// segments), and lets the user descend into further collections/docs from
// there (e.g. `spaces/{spaceId}/ext/contactus/contacts/{contactId}`, per the
// `/spaces/{spaceID}/ext/{module}/{collection}/{itemID}` convention
// documented in
// `backstage/spec/research/core-modules-interface.md`).
//
// IMPORTANT client-SDK limitation this service works around: the Firestore
// *client* SDK (unlike the Admin SDK's `listCollections()`) cannot enumerate
// which subcollections exist under a given document — that introspection is
// deliberately not exposed to end users. So this viewer cannot show a true
// "here are all the subcollections of this doc" list; instead the UI (see
// `SpaceExplorerPageComponent`) offers well-known collection-name shortcuts
// plus a free-text "browse a subcollection" input. Attempting to read a
// collection that doesn't exist simply yields an empty list — that's
// expected, not an error.
import { Injectable, inject } from '@angular/core';
import {
  collection,
  collectionData,
  doc,
  docData,
  Firestore as AngularFirestore,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const ID_FIELD = '__docId';

export interface IExploreDoc {
  readonly id: string;
  readonly path: string;
  /** `undefined` when the document does not exist. */
  readonly data: Record<string, unknown> | undefined;
}

export interface IExploreCollectionItem {
  readonly id: string;
  readonly path: string;
  readonly data: Record<string, unknown>;
}

@Injectable()
export class SpaceExplorerService {
  private readonly db = inject(AngularFirestore);

  /** Streams one document's raw fields as stored, read-only. */
  watchDocument$(pathSegments: readonly string[]): Observable<IExploreDoc> {
    const path = pathSegments.join('/');
    const id = pathSegments[pathSegments.length - 1];
    const ref = doc(this.db, path);
    return docData(ref, { idField: ID_FIELD }).pipe(
      map((record) => {
        const typedRecord = record as Record<string, unknown> | undefined;
        return {
          id,
          path,
          data: typedRecord ? omitIdField(typedRecord) : undefined,
        };
      }),
    );
  }

  /** Streams the raw documents of one collection, read-only. */
  watchCollection$(
    pathSegments: readonly string[],
  ): Observable<IExploreCollectionItem[]> {
    const path = pathSegments.join('/');
    const ref = collection(this.db, path);
    return collectionData(ref, { idField: ID_FIELD }).pipe(
      map((records) =>
        (records as Array<Record<string, unknown>>).map((record) => {
          const id = String(record[ID_FIELD]);
          return {
            id,
            path: `${path}/${id}`,
            data: omitIdField(record),
          };
        }),
      ),
    );
  }
}

function omitIdField(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const data = { ...record };
  delete data[ID_FIELD];
  return data;
}

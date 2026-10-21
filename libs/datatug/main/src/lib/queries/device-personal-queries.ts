import { isQueryCreationTime } from './query-creation-time';
import {
  validateSemanticModel,
  detachProjectMeaningReferences,
} from './semantic-mapping';
import { Injectable } from '@angular/core';
import type { IProjectRef } from '../core/project-context';
import type { IQueryDef } from '../models/definition/query-def';
export const isDevicePersonalQuery = (id: string): boolean =>
  /^device-personal-[a-f0-9-]{36}$/.test(id);
interface Stored {
  key: string;
  scope: string;
  query: IQueryDef;
  revision: number;
}
const scope = (ref: IProjectRef): string =>
  JSON.stringify([
    ref.storeId,
    ref.projectId,
    ref.spaceID ?? '',
    ref.branch ?? '',
  ]);
@Injectable({ providedIn: 'root' })
export class DevicePersonalQueries {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('datatug-personal-queries', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('queries', { keyPath: 'key' });
      request.onblocked = () =>
        reject(
          new Error(
            'Personal query storage is busy in another tab. Close that tab and retry.',
          ),
        );
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(
          new Error('Personal queries could not be opened on this device.'),
        );
    });
  }
  async list(ref: IProjectRef): Promise<Stored[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queries', 'readonly');
      const request = tx.objectStore('queries').getAll();
      tx.oncomplete = () => {
        db.close();
        const items = (request.result as Stored[]).filter(item => item.scope === scope(ref));
        if (items.some(item => !isQueryCreationTime(item.query.createdAt))) {
          reject(new Error('Saved queries require a valid creation timestamp.'));
          return;
        }
        resolve(items);
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('Personal queries could not be read.'));
      };
    });
  }
  async read(ref: IProjectRef, id: string): Promise<Stored> {
    const found = (await this.list(ref)).find((item) => item.query.id === id);
    if (!found)
      throw new Error('This personal query is unavailable on this device.');
    return found;
  }
  async save(
    ref: IProjectRef,
    query: IQueryDef,
    expectedRevision: number,
  ): Promise<Stored> {
    if (query.semanticModel) {
      validateSemanticModel(query.semanticModel);
      query = {
        ...query,
        semanticModel: detachProjectMeaningReferences(query.semanticModel),
      };
    }
    if (!isDevicePersonalQuery(query.id))
      throw new Error('Invalid personal query identity.');
    const db = await this.open();
    const key = `${scope(ref)}:${query.id}`;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queries', 'readwrite');
      const store = tx.objectStore('queries');
      const request = store.get(key);
      let conflict = false;
      let invalidCreation = false;
      let saved: Stored = {
        key,
        scope: scope(ref),
        query: structuredClone(query),
        revision: expectedRevision + 1,
      };
      request.onsuccess = () => {
        // Persisted metadata is required and remains immutable across edits and retries.
        const definition: { -readonly [K in keyof IQueryDef]: IQueryDef[K] } = { ...query };
        delete definition.createdAt;
        const createdAt = request.result ? request.result.query.createdAt : new Date().toISOString();
        if (!isQueryCreationTime(createdAt)) {
          invalidCreation = true;
          tx.abort();
          return;
        }
        saved.query = structuredClone({ ...definition, ...(createdAt ? { createdAt } : {}) });
        if (
          request.result?.revision === expectedRevision + 1 &&
          JSON.stringify(request.result.query) === JSON.stringify(saved.query)
        ) {
          saved = request.result;
          return;
        }
        if ((request.result?.revision ?? 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(saved);
      };
      tx.oncomplete = () => {
        db.close();
        resolve(saved);
      };
      tx.onabort = () => {
        db.close();
        reject(
          new Error(
            invalidCreation
              ? 'Saved queries require a valid creation timestamp.'
              : conflict
              ? 'This personal query changed in another tab. Reload before saving; your draft is retained.'
              : 'Personal query was not saved. Your draft is retained.',
          ),
        );
      };
    });
  }
}

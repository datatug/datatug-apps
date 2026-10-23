import { inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import type { ImmutableFile } from '../queries/public-data/canonical-metadata';
import {
  listNativeDataModels,
  readNativeDataModel,
  type DataModelDetail,
  type DataModelSummary,
} from './native-data-models-reader';
export type {
  DataModelDetail,
  DataModelSummary,
  LogicalRecord,
  LogicalField,
  LogicalEnum,
} from './native-data-models-reader';

/** Reviewed public catalog; applications may override the pin or disable with null. */
export const MEANINGGRAPH_CATALOG_PIN =
  new InjectionToken<ImmutableFile | null>('MEANINGGRAPH_CATALOG_PIN', {
    providedIn: 'root',
    factory: () => ({
      repository: 'https://github.com/meaninggraph/registry',
      revision: '4865a0351c49283dcc1eac2c963f677e6ad30bd0',
      path: 'catalog.json',
      sha256:
        'f4103c609d1d8fc2422b854d3a2652b138ad7836fb28247e8576f3459013f631',
    }),
  });
export const MEANINGGRAPH_CATALOG_FETCH = new InjectionToken<typeof fetch>(
  'MEANINGGRAPH_CATALOG_FETCH',
  { providedIn: 'root', factory: () => globalThis.fetch.bind(globalThis) },
);

@Injectable({ providedIn: 'root' })
export class NativeDataModelsService {
  private readonly pin = inject(MEANINGGRAPH_CATALOG_PIN);
  private readonly http = inject(MEANINGGRAPH_CATALOG_FETCH);
  readonly configured = this.pin !== null;
  list(): Observable<readonly DataModelSummary[]> {
    return this.read((signal) =>
      listNativeDataModels(this.requirePin(), this.http, signal),
    );
  }
  detail(id: string, commit: string): Observable<DataModelDetail> {
    return this.read((signal) =>
      readNativeDataModel(this.requirePin(), id, commit, this.http, signal),
    );
  }
  private requirePin(): ImmutableFile {
    if (!this.pin)
      throw new Error('No reviewed MeaningGraph catalog pin is configured.');
    return this.pin;
  }
  private read<T>(load: (signal: AbortSignal) => Promise<T>): Observable<T> {
    return new Observable((subscriber) => {
      const controller = new AbortController();
      void Promise.resolve()
        .then(() => load(controller.signal))
        .then(
          (value) => {
            if (!subscriber.closed) {
              subscriber.next(value);
              subscriber.complete();
            }
          },
          (error) => {
            if (!subscriber.closed) subscriber.error(error);
          },
        );
      return () => controller.abort(new Error('Native model read cancelled.'));
    });
  }
}

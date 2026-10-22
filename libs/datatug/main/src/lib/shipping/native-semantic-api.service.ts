import { HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, map, takeUntil } from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { hostedAssetScope } from '../services/project/project-assets-api.service';
import { DatatugApiService } from '../services/base/datatug-api.service';
import {
  CanonicalEntity,
  NativeScope,
  NativeRequest,
  NativeMapping,
  NativeLookup,
  decodeEntity,
  decodeSchema,
  decodeRows,
  decodeResolution,
  decodeRelated,
  validateScope,
  validateSelection,
  validateMapping,
  entityRevision,
  exact,
} from './native-semantic-contract';
import { decodeNativeApplicable } from './native-check-preflight-contract';
@Injectable({ providedIn: 'root' })
export class NativeSemanticApiService {
  private readonly api = inject(DatatugApiService);
  private read<T>(
    source: import('rxjs').Observable<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error('Context changed.'));
    return firstValueFrom(source.pipe(takeUntil(fromEvent(signal, 'abort'))));
  }
  schema(ref: IProjectRef, environment: string, signal: AbortSignal) {
    return this.read(
      this.api
        .get<unknown>(
          'datatug/semantic/schema',
          new HttpParams({
            fromObject: {
              ...hostedAssetScope(ref, environment),
              sourceId: 'shipping-working-copy',
            },
          }),
        )
        .pipe(
          map((v) => {
            const schema = decodeSchema(v);
            if (schema.source.environment !== environment)
              throw new Error('Schema environment differs.');
            return schema;
          }),
        ),
      signal,
    );
  }
  private post<T>(
    route: string,
    request: NativeScope,
    decode: (v: unknown) => T,
    signal: AbortSignal,
  ) {
    const scopeKeys = [
      'spaceID',
      'projectId',
      'environment',
      'sourceId',
      'evidence',
    ];
    exact(request, [
      ...scopeKeys,
      ...(route === 'browse'
        ? ['schemaToken', 'collection']
        : route === 'mappings/add'
          ? ['selection', 'operationId', 'entityId', 'fieldId', 'ifMatch']
          : route === 'related/read'
            ? ['selection', 'lookup']
            : ['selection']),
    ]);
    validateScope(request);
    if (new TextEncoder().encode(JSON.stringify(request)).length > 16384)
      throw new Error('Native request exceeds the limit.');
    return this.read(
      this.api
        .post<unknown>('datatug/semantic/' + route, request, {
          retryUnauthorizedOnce: false,
        })
        .pipe(map(decode)),
      signal,
    );
  }
  browse(
    request: NativeScope & { schemaToken: string; collection: string },
    signal: AbortSignal,
  ) {
    return this.post(
      'browse',
      request,
      (v) => {
        const rows = decodeRows(v);
        if (
          rows.schemaToken !== request.schemaToken ||
          rows.collection !== request.collection
        )
          throw new Error('Rows differ from the requested table.');
        return rows;
      },
      signal,
    );
  }
  resolve(request: NativeRequest, signal: AbortSignal) {
    validateSelection(request.selection);
    return this.post(
      'resolve',
      request,
      (v) => {
        const r = decodeResolution(v);
        if (r.column !== request.selection.column)
          throw new Error('Resolved column differs.');
        return r;
      },
      signal,
    );
  }
  related(request: NativeRequest, signal: AbortSignal) {
    validateSelection(request.selection);
    return this.post(
      'related',
      request,
      (v) => {
        const r = decodeRelated(v);
        if (JSON.stringify(r.selection) !== JSON.stringify(request.selection))
          throw new Error('Related selection differs.');
        return r;
      },
      signal,
    );
  }
  relatedRows(
    request: NativeRequest & { lookup: NativeLookup },
    signal: AbortSignal,
  ) {
    validateSelection(request.selection);
    return this.post(
      'related/read',
      request,
      (v) => {
        const r = decodeRows(v);
        if (
          r.schemaToken !== request.selection.schemaToken ||
          r.collection !== request.lookup.collection
        )
          throw new Error('Related table differs.');
        return r;
      },
      signal,
    );
  }
  addMapping(request: NativeMapping, signal: AbortSignal) {
    validateMapping(request);
    return this.post(
      'mappings/add',
      request,
      (v) => {
        const o = exact(v, ['entity', 'revision', 'receipt']),
          entity = decodeEntity(o['entity']);
        if (
          entity.id !== request.entityId ||
          o['receipt'] !== request.operationId ||
          !entityRevision(o['revision'])
        )
          throw new Error(
            'Mapping receipt is unavailable. Retry the original operation.',
          );
        return { entity, revision: o['revision'], receipt: o['receipt'] } as {
          entity: CanonicalEntity;
          revision: string;
          receipt: string;
        };
      },
      signal,
    );
  }
  /** Binding preflight only; never a Check result or permission to execute. */
  applicable(request: NativeRequest, signal: AbortSignal) {
    validateSelection(request.selection);
    return this.post('applicable', request, decodeNativeApplicable, signal);
  }
}

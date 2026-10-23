import { Injectable, inject } from '@angular/core';
import { Observable, map, of, shareReplay, tap } from 'rxjs';
import type { IProjectRef } from '../../core/project-context';
import { QueriesService } from '../../queries/queries.service';

const MAX_ENTRIES = 500;

/**
 * Query texts for the query-row hover preview, cached per project and query id for the whole app session.
 *
 * A folder listing deliberately carries no query text (the body is a sidecar file), so the preview reads one query
 * on demand. Rows share this cache across lists and re-renders, so a list sweep or a filter change costs nothing
 * after the first read, and concurrent hovers of the same query share one in-flight request. A request whose last
 * subscriber leaves before it answers is cancelled (`refCount`), and a failed read is evicted so a later hover can
 * retry.
 */
@Injectable({ providedIn: 'root' })
export class QueryTextPreviewService {
  private readonly queriesService = inject(QueriesService);
  private readonly texts = new Map<string, Observable<string | undefined>>();
  private readonly loaders = new Map<
    string,
    () => Observable<string | undefined>
  >();

  /**
   * A stable loader for one query's text (the same function for the same query, so a row input keeps its
   * identity). `listed` is the text a listing already carried, if any; it is used without a request.
   */
  loader(
    ref: IProjectRef,
    queryId: string,
    listed?: string,
  ): () => Observable<string | undefined> {
    const key = cacheKey(ref, queryId);
    let loader = this.loaders.get(key);
    if (!loader) {
      loader = () => (listed ? of(listed) : this.text(ref, queryId));
      this.remember(this.loaders, key, loader);
    }
    return loader;
  }

  private text(
    ref: IProjectRef,
    queryId: string,
  ): Observable<string | undefined> {
    const key = cacheKey(ref, queryId);
    let text = this.texts.get(key);
    if (!text) {
      text = this.queriesService.getQuery(ref, queryId).pipe(
        map(
          (def) =>
            (def?.request as { readonly text?: string } | undefined)?.text,
        ),
        tap({ error: () => this.texts.delete(key) }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.remember(this.texts, key, text);
    }
    return text;
  }

  private remember<T>(cache: Map<string, T>, key: string, value: T): void {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
  }
}

function cacheKey(ref: IProjectRef, queryId: string): string {
  return [
    ref.storeId,
    ref.projectId,
    ref.spaceID ?? '',
    ref.projectApi ?? '',
    ref.branch ?? '',
    queryId,
  ].join('\u0000');
}

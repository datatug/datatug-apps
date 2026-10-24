import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { DatatugApiService } from '../services/base/datatug-api.service';
import type { WorkScope } from '../work/work.models';
import type {
  GenerationCandidate,
  PostmortemAction,
  PostmortemDetail,
  ReportEvidence,
  ReportRevision,
} from './postmortem.models';
@Injectable({ providedIn: 'root' })
export class PostmortemApiService {
  private readonly api = inject(DatatugApiService);
  private params(scope: WorkScope, id: string) {
    return new HttpParams({
      fromObject: { spaceID: scope.spaceID, projectID: scope.projectID, id },
    });
  }
  read(scope: WorkScope, id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    return firstValueFrom(
      this.api
        .get<PostmortemDetail>(
          'datatug/postmortems/item',
          this.params(scope, id),
        )
        .pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
  evidence(scope: WorkScope, id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    return firstValueFrom(
      this.api
        .get<{ evidence: ReportEvidence[] }>(
          'datatug/postmortems/evidence',
          this.params(scope, id),
        )
        .pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
  action(action: PostmortemAction, signal: AbortSignal) {
    signal.throwIfAborted();
    return firstValueFrom(
      this.api
        .post<PostmortemDetail>('datatug/postmortems/actions', action, {
          retryUnauthorizedOnce: false,
        })
        .pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
  generate(action: PostmortemAction, signal: AbortSignal) {
    signal.throwIfAborted();
    return firstValueFrom(
      this.api
        .post<{ candidate: GenerationCandidate }>(
          'datatug/postmortems/generate',
          action,
          { retryUnauthorizedOnce: false },
        )
        .pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
  revisions(scope: WorkScope, id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    return firstValueFrom(
      this.api
        .get<ReportRevision[]>(
          'datatug/postmortems/revisions',
          this.params(scope, id),
        )
        .pipe(takeUntil(fromEvent(signal, 'abort'))),
    );
  }
}

import { Injectable, inject } from '@angular/core';
import { StoreApiService } from './store-api.service';
import { interval, Observable, of, throwError } from 'rxjs';
import { catchError, first, map, startWith, switchMap } from 'rxjs/operators';

export interface IAgentInfo {
  version: string;
  uptimeMinutes: number;
}

export interface IAgentState {
  lastCheckedAt: Date;
  info?: IAgentInfo;
  isNotAvailable?: boolean;
  error?: unknown;
}

const periodMs = 10000;

@Injectable()
export class AgentStateService {
  private repoApiService = inject(StoreApiService);

  private watchers: Record<string, Observable<IAgentState>> = {};

  // Stores for which we already logged the "no agent detected" info, so the
  // 10s polling watcher does not repeat it on every failed probe.
  private readonly noAgentLoggedFor = new Set<string>();

  public getAgentInfo(storeId: string): Observable<IAgentState> {
    return this.watchAgentInfo(storeId).pipe(first());
  }

  public watchAgentInfo(storeId: string): Observable<IAgentState> {
    let watcher = this.watchers[storeId];
    if (watcher) {
      return watcher;
    }
    watcher = interval(periodMs).pipe(
      startWith(0),
      switchMap(() =>
        this.repoApiService.get<IAgentInfo>(storeId, '/agent-info').pipe(
          catchError((err) => {
            if (
              err.name === 'HttpErrorResponse' &&
              err.ok === false &&
              err.status === 0
            ) {
              // Connection refused / unreachable = no local agent running.
              // This is an expected, normal situation. The browser still logs a
              // "net::ERR_CONNECTION_REFUSED" error for the request itself, which
              // cannot be suppressed from JS, so explain it once per store.
              if (!this.noAgentLoggedFor.has(storeId)) {
                this.noAgentLoggedFor.add(storeId);
                console.info(
                  `DataTug: no local agent detected at "${storeId}". This is ` +
                    `normal if you are not running a local DataTug agent. The ` +
                    `preceding "net::ERR_CONNECTION_REFUSED" console error for ` +
                    `the agent-info request is expected and can be ignored.`,
                );
              }
              return of(undefined);
            }
            return throwError(err);
          }),
        ),
      ),
      map((info) => ({
        info,
        lastCheckedAt: new Date(),
        isNotAvailable: info === undefined,
      })),
    );
    this.watchers[storeId] = watcher;
    return watcher;
  }
}

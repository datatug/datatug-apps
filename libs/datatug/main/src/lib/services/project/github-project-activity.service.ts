import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { SneatApiService } from '@sneat/api';
import { SneatAuthStateService } from '@sneat/auth-core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  IProjectRef,
  equalProjectRef,
} from '../../core/project-context';
import {
  GitHubProjectActivityScope,
  ProjectQueryCapabilities,
} from '../../queries/project-query-contract';
import { ProjectContextService } from './project-context.service';
import { ProjectQueryApiService } from './project-query-api.service';

export type QueryActivityKind =
  | 'query_edit'
  | 'query_execution_dispatched';

export interface QueryActivityContext {
  readonly contextID: string;
  readonly expiresAtUTC: string;
}

export interface QueryActivityReportResult {
  readonly accepted: boolean;
  readonly coalesced: boolean;
  readonly receiptID?: string;
}

export interface GitHubProjectActivitySession {
  readonly project: IProjectRef;
  readonly scope: GitHubProjectActivityScope;
  readonly context: QueryActivityContext;
}

interface BoundSession {
  readonly session: GitHubProjectActivitySession;
  readonly actorID: string;
  readonly generation: number;
}

const sharedID = /^[A-Za-z0-9_-]{1,128}$/;

function isActivityID(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    !/[\\/\r\n]/.test(value) &&
    !value.includes(String.fromCharCode(0)) &&
    value.trim() === value
  );
}

function isActivityContextCurrent(context: QueryActivityContext): boolean {
  const expiresAt = Date.parse(context.expiresAtUTC);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function isGithubCloudProject(ref: IProjectRef): boolean {
  return (
    (ref.storeId === 'github.com' || ref.storeId === 'github') &&
    ref.projectApi === 'cloud' &&
    ref.spaceID === undefined &&
    typeof ref.projectId === 'string' &&
    ref.projectId.length > 0
  );
}

function readActivityScope(
  capabilities: ProjectQueryCapabilities,
): GitHubProjectActivityScope | undefined {
  const value: unknown = capabilities?.activityScope;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') {
    throw new Error('GitHub project activity scope could not be verified.');
  }
  const candidate = value as Partial<GitHubProjectActivityScope>;
  if (
    typeof candidate.spaceID !== 'string' ||
    !sharedID.test(candidate.spaceID) ||
    typeof candidate.projectID !== 'string' ||
    !sharedID.test(candidate.projectID)
  ) {
    throw new Error('GitHub project activity scope could not be verified.');
  }
  return {
    spaceID: candidate.spaceID,
    projectID: candidate.projectID,
  };
}

function readActivityContext(value: unknown): QueryActivityContext {
  if (!value || typeof value !== 'object') {
    throw new Error('Query activity context could not be verified.');
  }
  const context = value as Partial<QueryActivityContext>;
  const expiresAt =
    typeof context.expiresAtUTC === 'string'
      ? Date.parse(context.expiresAtUTC)
      : Number.NaN;
  if (
    typeof context.contextID !== 'string' ||
    !isActivityID(context.contextID) ||
    typeof context.expiresAtUTC !== 'string' ||
    !context.expiresAtUTC.endsWith('Z') ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error('Query activity context could not be verified.');
  }
  return { contextID: context.contextID, expiresAtUTC: context.expiresAtUTC };
}

/**
 * Resolves server-issued Business usage context for the current authenticated
 * GitHub project. Scope is kept separate from IProjectRef so GitHub query
 * transport never mistakes billing metadata for a Firestore project.
 */
@Injectable({ providedIn: 'root' })
export class GitHubProjectActivityService {
  private readonly api = inject(SneatApiService);
  private readonly auth = inject(SneatAuthStateService);
  private readonly projects = inject(ProjectContextService);
  private readonly projectQueries = inject(ProjectQueryApiService);

  private actorID?: string;
  private currentProject?: IProjectRef;
  private generation = 0;
  private bound?: BoundSession;
  private readonly $current = new BehaviorSubject<
    GitHubProjectActivitySession | undefined
  >(undefined);
  readonly current = this.$current.asObservable();

  /** Changes whenever auth or project scope changes, for caller-side throttles. */
  get bindingGeneration(): number {
    return this.generation;
  }

  constructor() {
    this.auth.authState.subscribe((state) => {
      const next =
        state.status === 'authenticated' ? state.user?.uid : undefined;
      if (next !== this.actorID) {
        this.actorID = next;
        this.invalidate();
      }
    });
    this.projects.current$.subscribe((ref) => {
      if (!equalProjectRef(ref, this.currentProject)) {
        this.currentProject = ref;
        this.invalidate();
      }
    });
  }

  /** Fetches capabilities again on project load, so reloads recover server scope. */
  resolve(ref: IProjectRef): Observable<GitHubProjectActivitySession | undefined> {
    const actorID = this.actorID;
    const generation = this.generation;
    if (
      !isGithubCloudProject(ref) ||
      !actorID ||
      !equalProjectRef(this.currentProject, ref)
    ) {
      this.invalidate();
      return throwError(
        () => new Error('A current authenticated GitHub project is required.'),
      );
    }

    return this.projectQueries.capabilities(ref).pipe(
      switchMap((capabilities) => {
        const scope = readActivityScope(capabilities);
        if (!scope) return of(undefined);
        const params = new HttpParams({
          fromObject: {
            storage: 'firestore',
            spaceID: scope.spaceID,
            project: scope.projectID,
          },
        });
        return this.api
          .get<unknown>('datatug/projects/query_activity_context', params)
          .pipe(
            map((response) => {
              const session: GitHubProjectActivitySession = {
                project: Object.freeze({ ...ref }),
                scope: Object.freeze(scope),
                context: Object.freeze(readActivityContext(response)),
              };
              return Object.freeze(session);
            }),
          );
      }),
      map((session) => {
        if (!session) {
          if (generation === this.generation) this.invalidate();
          return undefined;
        }
        if (
          generation !== this.generation ||
          this.actorID !== actorID ||
          !equalProjectRef(this.currentProject, ref)
        ) {
          return undefined;
        }
        this.bound = { session, actorID, generation };
        this.$current.next(session);
        return session;
      }),
      catchError((error: unknown) => {
        if (generation === this.generation) this.invalidate();
        return throwError(() => error);
      }),
    );
  }

  /** operationID is generated once by the caller and reused for retries. */
  report(
    session: GitHubProjectActivitySession,
    operationID: string,
    kind: QueryActivityKind,
  ): Observable<QueryActivityReportResult> {
    const bound = this.bound;
    if (
      !bound ||
      bound.session !== session ||
      bound.generation !== this.generation ||
      bound.actorID !== this.actorID ||
      !equalProjectRef(this.currentProject, session.project) ||
      !isGithubCloudProject(session.project) ||
      !isActivityContextCurrent(session.context) ||
      !isActivityID(operationID) ||
      (kind !== 'query_edit' && kind !== 'query_execution_dispatched')
    ) {
      return throwError(
        () => new Error('Query activity context is no longer current.'),
      );
    }
    const params = new HttpParams({
      fromObject: { storage: 'firestore', spaceID: session.scope.spaceID },
    });
    return this.api.post<QueryActivityReportResult>(
      'datatug/projects/query_activity_report',
      { contextID: session.context.contextID, operationID, kind },
      { params },
    );
  }

  /** Resolve a fresh context if needed, then report this one dispatched query. */
  reportForCurrentProject(
    ref: IProjectRef,
    operationID: string,
    kind: QueryActivityKind,
  ): Observable<QueryActivityReportResult | undefined> {
    const bound = this.bound;
    if (
      bound &&
      bound.generation === this.generation &&
      bound.actorID === this.actorID &&
      isActivityContextCurrent(bound.session.context) &&
      equalProjectRef(this.currentProject, ref) &&
      equalProjectRef(bound.session.project, ref)
    ) {
      return this.report(bound.session, operationID, kind);
    }
    return this.resolve(ref).pipe(
      switchMap((session) =>
        session ? this.report(session, operationID, kind) : of(undefined),
      ),
    );
  }

  private invalidate(): void {
    this.generation++;
    this.bound = undefined;
    this.$current.next(undefined);
  }
}

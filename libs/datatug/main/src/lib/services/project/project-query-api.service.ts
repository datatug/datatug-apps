import { projectApiQuery } from '../../nav/project-api-routing';
import { type IProjectSummary } from '../../models/definition/project';
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import {
  formatGithubProjectApiKey,
  readGithubProjectId,
} from '@datatug/project-address';
import {
  type Observable,
  throwError,
  Subject,
  tap,
  switchMap,
  catchError,
  defer,
} from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../../core/project-context';
import { buildAgentUrl } from '../repo/agent-url';
import { StoreApiService } from '../repo/store-api.service';
import {
  type ProjectQueryCapabilities,
  type ProjectQueryRevision,
  type ProjectQueryWire,
} from '../../queries/project-query-contract';

export interface ProjectQuerySave {
  readonly branch?: string;
  readonly expectedBranchHead?: string;
  readonly operationId: string;
  readonly ifNoneMatch?: true;
  readonly ifMatch?: string;
  readonly query: ProjectQueryWire;
}

export interface ProjectBranches {
  readonly branches: readonly {
    readonly name: string;
    readonly head: string;
  }[];
  readonly defaultBranch?: string;
  readonly capabilities?: ProjectQueryCapabilities;
  readonly currentBranch?: string;
}

export const DATATUG_DEMO_PROJECT_TEMPLATE = {
  id: 'demo-project-1',
  commit: '436350d41371103be11144ffa346c605f85e1342',
} as const;

const MIN_QUALIFIED_READ_CLI_VERSION = [0, 97, 0] as const;
const QUALIFIED_READ_CLI_UPDATE_MESSAGE =
  'To load the selected project branch, update DataTug CLI to v0.97.0 or later, restart its agent, and retry.';

/** A safe, actionable client message for agents that predate branch-qualified reads. */
export class QualifiedLocalReadVersionError extends Error {
  constructor() {
    super(QUALIFIED_READ_CLI_UPDATE_MESSAGE);
    this.name = 'QualifiedLocalReadVersionError';
  }
}

/** Only this client-created error is safe to show verbatim in the UI. */
export function qualifiedLocalReadVersionGuidance(
  error: unknown,
): string | undefined {
  return error instanceof QualifiedLocalReadVersionError
    ? QUALIFIED_READ_CLI_UPDATE_MESSAGE
    : undefined;
}

function supportsQualifiedLocalReads(version: unknown): boolean {
  if (typeof version !== 'string') return false;
  // Deliberately require a stable release version. Development builds and
  // prereleases cannot establish that the branch-qualified endpoints exist.
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version.trim(),
    );
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  if (actual.some((part) => !Number.isSafeInteger(part))) return false;
  for (let i = 0; i < MIN_QUALIFIED_READ_CLI_VERSION.length; i++) {
    if (actual[i] > MIN_QUALIFIED_READ_CLI_VERSION[i]) return true;
    if (actual[i] < MIN_QUALIFIED_READ_CLI_VERSION[i]) return false;
  }
  return true;
}

export type ProjectBillingIntent = 'personal_pro' | 'space_business';

export interface CreateGithubProject {
  readonly title: string;
  readonly spaceID: string;
  readonly billingIntent: ProjectBillingIntent;
  readonly operationId: string;
  readonly github: {
    readonly repositoryID: number;
    readonly owner: string;
    readonly name: string;
    readonly folder: string;
    readonly branch: string;
    readonly expectedBranchHead: string;
  };
  readonly template: typeof DATATUG_DEMO_PROJECT_TEMPLATE;
}

export interface CreatedGithubProject {
  readonly id: string;
  readonly storage: 'github.com';
  readonly project: string;
  readonly spaceID: string;
  readonly sharedProjectID: string;
  readonly branch: string;
  readonly branchHead: string;
  readonly revision: string;
}

/** Store-specific transport only. Cloud always uses the shared Firebase auth bridge; no provider token or private fallback. */
@Injectable({ providedIn: 'root' })
export class ProjectQueryApiService {
  private readonly deniedReads = new Subject<IProjectRef>();
  readonly authorityDenied = this.deniedReads.asObservable();
  private readonly api = inject(SneatApiService);
  private readonly http = inject(HttpClient);
  private readonly storeApi = inject(StoreApiService);

  private needsQualifiedLocalReadVersionCheck(ref: IProjectRef): boolean {
    return (
      !!ref.branch &&
      ref.spaceID === undefined &&
      ref.projectApi !== 'cloud' &&
      !['github.com', 'github', 'firestore'].includes(ref.storeId)
    );
  }

  private qualifiedRead<T>(
    ref: IProjectRef,
    path: string,
    extra?: Record<string, string>,
  ): Observable<T> {
    if (!this.needsQualifiedLocalReadVersionCheck(ref))
      return this.get<T>(ref, path, extra);

    return this.readAfterQualifiedLocalProbe(ref, () =>
      this.get<T>(ref, path, extra),
    );
  }

  private readAfterQualifiedLocalProbe<T>(
    ref: IProjectRef,
    read: () => Observable<T>,
  ): Observable<T> {
    try {
      this.reference(ref);
    } catch (error) {
      return throwError(() => error);
    }
    // This probe is intentionally fresh for every qualified read. Agent version
    // admission must never be reused across a different principal or request.
    return defer(() =>
      this.storeApi.get<unknown>(ref.storeId, '/agent-info'),
    ).pipe(
      catchError(() =>
        throwError(
          () =>
            new Error(
              `Could not verify the local DataTug CLI version. ${QUALIFIED_READ_CLI_UPDATE_MESSAGE}`,
            ),
        ),
      ),
      switchMap((info) => {
        const version =
          info && typeof info === 'object' && 'version' in info
            ? info.version
            : undefined;
        if (!supportsQualifiedLocalReads(version))
          return throwError(() => new QualifiedLocalReadVersionError());
        return read();
      }),
    );
  }

  private reference(ref: IProjectRef): {
    storage: string;
    project: string;
    spaceID?: string;
  } {
    if (ref.projectApi !== undefined) projectApiQuery(ref);
    if (ref.spaceID !== undefined) {
      if (!isSharedProjectRef(ref))
        throw new Error('Invalid shared project reference');
      return {
        storage: 'firestore',
        spaceID: ref.spaceID,
        project: ref.projectId,
      };
    }
    if (ref.storeId === 'github' || ref.storeId === 'github.com') {
      const address = readGithubProjectId(ref.projectId);
      if (!address.ok) throw new Error('Invalid GitHub project reference');
      if (ref.branch && address.id.ref && ref.branch !== address.id.ref)
        throw new Error('Project branch conflicts with its GitHub address');
      return {
        storage: 'github.com',
        project: formatGithubProjectApiKey({
          repo: address.id.repo,
          org: address.id.org,
          folder: address.id.folder,
        }),
      };
    }
    return {
      storage: ref.storeId === 'firestore' ? 'firestore' : 'local',
      project: ref.projectId,
    };
  }

  private get<T>(
    ref: IProjectRef,
    path: string,
    extra?: Record<string, string>,
  ): Observable<T> {
    try {
      const params = new HttpParams({
        fromObject: { ...this.reference(ref), ...extra },
      });
      const request = ['github.com', 'github', 'firestore'].includes(
        ref.storeId,
      )
        ? this.api.get<T>(`datatug/${path}`, params)
        : this.http.get<T>(buildAgentUrl(ref.storeId, `/${path}`), { params });
      return request.pipe(
        tap({
          error: (error) => {
            if (
              (ref.projectApi === 'cloud' || isSharedProjectRef(ref)) &&
              [401, 403].includes(error?.status)
            )
              this.deniedReads.next(ref);
          },
        }),
      );
    } catch (error) {
      return throwError(() => error);
    }
  }

  summary(ref: IProjectRef): Observable<IProjectSummary> {
    if (this.needsQualifiedLocalReadVersionCheck(ref)) {
      const params = new HttpParams({
        fromObject: {
          storage: 'local',
          id: ref.projectId,
          branch: ref.branch as string,
        },
      });
      return this.readAfterQualifiedLocalProbe(ref, () =>
        this.http.get<IProjectSummary>(
          buildAgentUrl(ref.storeId, '/projects/project_summary'),
          { params },
        ),
      );
    }
    return this.qualifiedRead(
      ref,
      'projects/project_summary',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  /** Authenticated, fixed-file catalogue read for private GitHub projects. */
  connectionCatalog<T>(ref: IProjectRef): Observable<T> {
    return this.qualifiedRead(
      ref,
      'projects/connection_catalog',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  /** Fixed read-only asset endpoints; all identifiers and refs remain query params. */
  boards<T>(ref: IProjectRef): Observable<T> {
    return this.qualifiedRead(
      ref,
      'boards/all_boards',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  board<T>(ref: IProjectRef, id: string): Observable<T> {
    return this.qualifiedRead(ref, 'boards/board', {
      id,
      ...(ref.branch ? { branch: ref.branch } : {}),
    });
  }

  entities<T>(ref: IProjectRef): Observable<T> {
    return this.qualifiedRead(
      ref,
      'entities/all_entities',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  entity<T>(ref: IProjectRef, id: string): Observable<T> {
    return this.qualifiedRead(ref, 'entities/entity', {
      id,
      ...(ref.branch ? { branch: ref.branch } : {}),
    });
  }

  environments<T>(ref: IProjectRef): Observable<T> {
    return this.qualifiedRead(
      ref,
      'environments/all_environments',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  folder<T>(ref: IProjectRef): Observable<T> {
    return this.get(
      ref,
      'queries/all_queries',
      ref.branch ? { branch: ref.branch } : undefined,
    );
  }

  capabilities(ref: IProjectRef): Observable<ProjectQueryCapabilities> {
    return this.get(ref, 'projects/capabilities');
  }

  branches(ref: IProjectRef): Observable<ProjectBranches> {
    return this.get(ref, 'projects/branches');
  }

  read(
    ref: IProjectRef,
    id: string,
    branch?: string,
  ): Observable<ProjectQueryRevision> {
    return this.get(ref, 'queries/query_revision', {
      id,
      ...(branch ? { branch } : {}),
    });
  }

  save(
    ref: IProjectRef,
    save: ProjectQuerySave,
  ): Observable<ProjectQueryRevision> {
    try {
      const body = { ...this.reference(ref), ...save };
      return ['github.com', 'github', 'firestore'].includes(ref.storeId)
        ? this.api.post<ProjectQueryRevision>(
            'datatug/queries/save_query',
            body,
          )
        : this.http.post<ProjectQueryRevision>(
            buildAgentUrl(ref.storeId, '/queries/save_query'),
            body,
          );
    } catch (error) {
      return throwError(() => error);
    }
  }

  create(request: CreateGithubProject): Observable<CreatedGithubProject> {
    return this.api.post<CreatedGithubProject>(
      'datatug/projects/create_project',
      request,
      { params: { store: 'github.com' } },
    );
  }
}

import { projectApiQuery } from '../../nav/project-api-routing';
import { type IProjectSummary } from '../../models/definition/project';
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { readGithubProjectId } from '@datatug/project-address';
import { type Observable, throwError } from 'rxjs';
import { IProjectRef } from '../../core/project-context';
import { buildAgentUrl } from '../repo/agent-url';
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

export interface CreateGithubProject {
  readonly title: string;
  readonly spaceID: string;
  readonly operationId: string;
  readonly github: {
    readonly repositoryID: number;
    readonly owner: string;
    readonly name: string;
    readonly folder: string;
    readonly branch: string;
    readonly expectedBranchHead: string;
  };
  readonly template: {
    readonly id: 'demo-project-1';
    readonly commit: '51716f3a4d682d5cb7ef70a7fd37f42e5418fd3d';
  };
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
  private readonly api = inject(SneatApiService);
  private readonly http = inject(HttpClient);

  private reference(ref: IProjectRef): { storage: string; project: string } {
    if (ref.projectApi) projectApiQuery(ref);
    if (ref.spaceID !== undefined)
      throw new Error(
        'Shared metadata-only projects do not support this query API',
      );
    if (ref.storeId === 'github' || ref.storeId === 'github.com') {
      const address = readGithubProjectId(ref.projectId);
      if (!address.ok) throw new Error('Invalid GitHub project reference');
      return {
        storage: 'github.com',
        project: `${address.id.repo}@${address.id.org}@${address.id.folder}`,
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
      return ['github.com', 'github', 'firestore'].includes(ref.storeId)
        ? this.api.get<T>(`datatug/${path}`, params)
        : this.http.get<T>(buildAgentUrl(ref.storeId, `/${path}`), { params });
    } catch (error) {
      return throwError(() => error);
    }
  }

  summary(ref: IProjectRef): Observable<IProjectSummary> {
    return this.get(ref, 'projects/project_summary', {
      branch: ref.branch ?? '',
    });
  }

  folder<T>(ref: IProjectRef): Observable<T> {
    return this.get(ref, 'queries/all_queries', { branch: ref.branch ?? '' });
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

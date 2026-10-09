import { Injectable, inject } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import { SneatApiService } from '@sneat/api';
import { IProjectRef, isSharedProjectRef } from '../../core/project-context';
import { ProjectQueryApiService } from './project-query-api.service';
import { Observable, map } from 'rxjs';

export interface ProjectAIEligibility {
  readonly aiAllowed: boolean;
  readonly reason?: string;
}

function eligibility(value: unknown): ProjectAIEligibility {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { aiAllowed?: unknown }).aiAllowed !== 'boolean'
  ) {
    throw new Error('Project AI access could not be verified.');
  }
  const result = value as { aiAllowed: boolean; reason?: unknown };
  if (result.reason !== undefined && typeof result.reason !== 'string') {
    throw new Error('Project AI access could not be verified.');
  }
  return {
    aiAllowed: result.aiAllowed,
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
  };
}

/** Reads sponsor entitlement for one shared project; the result is never cached. */
@Injectable({ providedIn: 'root' })
export class ProjectAIEligibilityService {
  private readonly api = inject(SneatApiService);
  private readonly projectQueries = inject(ProjectQueryApiService);

  read(ref: IProjectRef): Observable<ProjectAIEligibility> {
    if (ref.projectApi === 'cloud') {
      return this.projectQueries
        .capabilities(ref)
        .pipe(
          map((value) =>
            eligibility(
              (value as unknown as { projectAI?: unknown })?.projectAI,
            ),
          ),
        );
    }
    const spaceID = ref.spaceID;
    if (!isSharedProjectRef(ref) || !spaceID) {
      throw new Error('Project AI access could not be verified.');
    }
    const params = new HttpParams({
      fromObject: { storage: 'firestore', spaceID, project: ref.projectId },
    });
    return this.api
      .get<unknown>('datatug/projects/ai_eligibility', params)
      .pipe(map(eligibility));
  }
}

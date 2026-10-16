import { Injectable, inject } from '@angular/core';
import {
  Observable,
  defer,
  from,
  mergeMap,
  map,
  of,
  switchMap,
  throwError,
  toArray,
} from 'rxjs';
import { IProjectRef, isSharedProjectRef } from '../../core/project-context';
import { IProjBoard, IProjEntity } from '../../models/definition/project';
import {
  IEnvironmentFull,
  IEnvironmentPresentation,
} from '../../models/definition/environments';
import { Board } from '@datatug/board-models';
import { IEntity } from '../../models/definition/metapedia/entity';
import { ProjectQueryApiService } from './project-query-api.service';
import {
  GithubProjectReaderService,
  IGithubEnvironmentSummary,
  parseGithubProjectId,
} from '../repo/github/github-project-reader.service';
import { formatGithubProjectId } from '@datatug/project-address';
import { projectApiQuery } from '../../nav/project-api-routing';

export interface ProjectEntityBrief extends IProjEntity {
  readonly fields?: IEntity['fields'];
}

export function githubProjectAddressForRef(ref: IProjectRef): string {
  const address = parseGithubProjectId(ref.projectId);
  if (ref.branch && address.ref && ref.branch !== address.ref)
    throw new Error('Project branch conflicts with its GitHub address');
  if (!ref.branch || address.ref) return ref.projectId;
  return formatGithubProjectId({ ...address, ref: ref.branch });
}

const MAX_PROJECT_ASSETS = 100;
const MAX_PARALLEL_PUBLIC_ASSET_READS = 8;

function safeEnvironmentPresentation(
  value: IEnvironmentPresentation | undefined,
): IEnvironmentPresentation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: IEnvironmentPresentation = {
    ...(typeof value.label === 'string' && value.label.length <= 120
      ? { label: value.label }
      : {}),
    ...(typeof value.icon === 'string' &&
    [
      'globe-outline',
      'desktop-outline',
      'flask-outline',
      'cloud-outline',
      'shield-checkmark-outline',
      'warning-outline',
    ].includes(value.icon)
      ? { icon: value.icon }
      : {}),
    ...(typeof value.tone === 'string' &&
    ['neutral', 'primary', 'success', 'warning', 'danger'].includes(value.tone)
      ? { tone: value.tone as IEnvironmentPresentation['tone'] }
      : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

/** Read-only project assets scoped to the selected immutable project reference. */
@Injectable({ providedIn: 'root' })
export class ProjectAssetsReadService {
  private readonly api = inject(ProjectQueryApiService);
  private readonly github = inject(GithubProjectReaderService);

  private githubProject(ref: IProjectRef): Observable<string> {
    return defer(() => of(githubProjectAddressForRef(ref)));
  }

  private isUnsupported(ref: IProjectRef): boolean {
    return ref.spaceID !== undefined || isSharedProjectRef(ref);
  }

  private invalidTransport(ref: IProjectRef): Observable<never> | undefined {
    try {
      if (ref.projectApi !== undefined) projectApiQuery(ref);
      if (ref.storeId === 'github' || ref.storeId === 'github.com')
        githubProjectAddressForRef(ref);
      return undefined;
    } catch (error) {
      return throwError(() => error);
    }
  }

  private readPublicAssets<T>(
    ids: readonly string[],
    read: (id: string) => Observable<T>,
  ): Observable<T[]> {
    if (ids.length > MAX_PROJECT_ASSETS) {
      return throwError(
        () =>
          new Error(`Project asset list exceeds ${MAX_PROJECT_ASSETS} items`),
      );
    }
    return from(ids).pipe(
      mergeMap(
        (id, index) => read(id).pipe(map((value) => ({ index, value }))),
        MAX_PARALLEL_PUBLIC_ASSET_READS,
      ),
      toArray(),
      map((results) =>
        results.sort((a, b) => a.index - b.index).map((result) => result.value),
      ),
    );
  }

  boards(ref: IProjectRef): Observable<IProjBoard[]> {
    const invalid = this.invalidTransport(ref);
    if (invalid) return invalid;
    if (this.isUnsupported(ref))
      return throwError(
        () =>
          new Error(
            'Project asset reads are not supported for shared Firestore projects',
          ),
      );
    if (ref.projectApi === 'cloud') return this.api.boards<IProjBoard[]>(ref);
    if (ref.storeId === 'github' || ref.storeId === 'github.com') {
      return this.githubProject(ref).pipe(
        switchMap((project) =>
          this.github.listDirectory(project, 'boards').pipe(
            map((entries) =>
              entries.filter((e) => e.type === 'dir').map((e) => e.name),
            ),
            switchMap((ids) =>
              this.readPublicAssets(ids, (id) =>
                this.github.getBoard(project, id),
              ),
            ),
            map((items) => items as unknown as IProjBoard[]),
          ),
        ),
      );
    }
    return this.api.boards<IProjBoard[]>(ref);
  }

  board(ref: IProjectRef, id: string): Observable<Board> {
    const invalid = this.invalidTransport(ref);
    if (invalid) return invalid;
    if (this.isUnsupported(ref))
      return throwError(
        () =>
          new Error(
            'Project asset reads are not supported for shared Firestore projects',
          ),
      );
    if (!id || /[\\/]/.test(id))
      return throwError(() => new Error('Invalid board id'));
    if (ref.projectApi === 'cloud') return this.api.board<Board>(ref, id);
    if (ref.storeId === 'github' || ref.storeId === 'github.com')
      return this.githubProject(ref).pipe(
        switchMap(
          (project) => this.github.getBoard(project, id) as Observable<Board>,
        ),
      );
    return this.api.board<Board>(ref, id);
  }

  entities(ref: IProjectRef): Observable<ProjectEntityBrief[]> {
    const invalid = this.invalidTransport(ref);
    if (invalid) return invalid;
    if (this.isUnsupported(ref))
      return throwError(
        () =>
          new Error(
            'Project asset reads are not supported for shared Firestore projects',
          ),
      );
    if (ref.projectApi === 'cloud')
      return this.api.entities<ProjectEntityBrief[]>(ref);
    if (ref.storeId === 'github' || ref.storeId === 'github.com') {
      return this.githubProject(ref).pipe(
        switchMap((project) =>
          this.github.listEntityIds(project).pipe(
            switchMap((ids) =>
              this.readPublicAssets(ids, (id) =>
                this.github.getEntity(project, id),
              ),
            ),
            map((items) =>
              items.map((item) => ({
                id: item.id || '',
                title:
                  typeof item['title'] === 'string' ? item['title'] : undefined,
              })),
            ),
          ),
        ),
      );
    }
    return this.api.entities<ProjectEntityBrief[]>(ref);
  }

  entity(ref: IProjectRef, id: string): Observable<IEntity> {
    const invalid = this.invalidTransport(ref);
    if (invalid) return invalid;
    if (this.isUnsupported(ref))
      return throwError(
        () =>
          new Error(
            'Project asset reads are not supported for shared Firestore projects',
          ),
      );
    if (!id || /[\\/]/.test(id))
      return throwError(() => new Error('Invalid entity id'));
    if (ref.projectApi === 'cloud') return this.api.entity<IEntity>(ref, id);
    if (ref.storeId === 'github' || ref.storeId === 'github.com')
      return this.githubProject(ref).pipe(
        switchMap(
          (project) =>
            this.github.getEntity(project, id) as Observable<IEntity>,
        ),
      );
    return this.api.entity<IEntity>(ref, id);
  }

  environments(ref: IProjectRef): Observable<IEnvironmentFull[]> {
    const invalid = this.invalidTransport(ref);
    if (invalid) return invalid;
    if (this.isUnsupported(ref))
      return throwError(
        () =>
          new Error(
            'Project asset reads are not supported for shared Firestore projects',
          ),
      );
    if (ref.projectApi === 'cloud')
      return this.api.environments<IEnvironmentFull[]>(ref);
    if (ref.storeId === 'github' || ref.storeId === 'github.com') {
      return this.githubProject(ref).pipe(
        switchMap((project) =>
          this.github.listEnvironmentIds(project).pipe(
            switchMap((ids) =>
              this.readPublicAssets(ids, (id) =>
                this.github.getEnvironmentSummary(project, id),
              ),
            ),
            map((items) =>
              items.map((item: IGithubEnvironmentSummary) => {
                const presentation = safeEnvironmentPresentation(
                  item.presentation,
                );
                return {
                  id: item.id,
                  title:
                    typeof item.title === 'string' && item.title.length <= 200
                      ? item.title
                      : item.id,
                  ...(presentation ? { presentation } : {}),
                };
              }),
            ),
          ),
        ),
      );
    }
    return this.api.environments<IEnvironmentFull[]>(ref);
  }
}

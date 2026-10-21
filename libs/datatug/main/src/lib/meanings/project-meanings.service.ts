import { RepositoryMeaningsReaderService } from './repository-meanings-reader.service';
import { inject, Injectable } from '@angular/core';
import {
  defer,
  forkJoin,
  map,
  mergeMap,
  Observable,
  of,
  switchMap,
  from,
  toArray,
} from 'rxjs';
import { IProjectRef } from '../core/project-context';
import { ProjectQueryApiService } from '../services/project/project-query-api.service';
import {
  ProjectAssetsReadService,
  githubProjectAddressForRef,
} from '../services/project/project-assets-read.service';
import { GithubProjectReaderService } from '../services/repo/github/github-project-reader.service';
import {
  locatedMeaningQueries,
  projectQueryMeanings,
  mergeStandaloneProjectMeanings,
  standaloneProjectMeanings,
} from './project-meanings';
import {
  ProjectMeaningAck,
  ProjectMeaningsCatalog,
  ProjectMeaningWrite,
  validateProjectMeaningsCatalog,
} from './project-meanings-contract';

@Injectable({ providedIn: 'root' })
export class ProjectMeaningsService {
  private readonly api = inject(ProjectQueryApiService);
  private readonly github = inject(GithubProjectReaderService);
  private readonly assets = inject(ProjectAssetsReadService);
  private readonly repositoryMeanings = inject(RepositoryMeaningsReaderService);

  catalog(ref: IProjectRef): Observable<ProjectMeaningsCatalog> {
    return this.catalogAt(ref).pipe(
      switchMap((catalog) => this.presentation(ref, catalog)),
      map((catalog) => {
        validateProjectMeaningsCatalog(catalog);
        const expected = this.api.meaningScope(ref),
          scope = catalog.scope;
        if (
          scope.storage !== expected.storage ||
          scope.project !== expected.project ||
          scope.spaceID !== expected.spaceID ||
          (expected.branch !== undefined && scope.branch !== expected.branch)
        )
          throw new Error(
            'The meanings catalog belongs to another project scope.',
          );
        return catalog;
      }),
    );
  }
  private async presentation(
    ref: IProjectRef,
    catalog: ProjectMeaningsCatalog,
  ): Promise<ProjectMeaningsCatalog> {
    try {
      const result = await this.repositoryMeanings.enrich(ref, catalog);
      validateProjectMeaningsCatalog(result);
      return result;
    } catch {
      return {
        ...catalog,
        discoveryComplete: false,
        notices: [
          ...(catalog.notices ?? []),
          'Repository meaning discovery could not be completed. The provider-managed catalog is still available.',
        ],
      };
    }
  }
  refForCatalog(
    ref: IProjectRef,
    catalog: ProjectMeaningsCatalog,
  ): IProjectRef {
    return catalog.scope.storage === 'local'
      ? { ...ref, projectApi: 'local', branch: catalog.scope.branch }
      : ref;
  }
  private catalogAt(ref: IProjectRef): Observable<ProjectMeaningsCatalog> {
    return defer(() => {
      if (
        ['github', 'github.com'].includes(ref.storeId) &&
        ref.projectApi === undefined
      ) {
        const address = githubProjectAddressForRef(ref);
        return forkJoin({
          folder: this.github.getQueriesFolder(address),
          standalone: this.github
            .listDirectory(address, '')
            .pipe(
              switchMap((entries) =>
                entries.some(
                  (entry) =>
                    entry.type === 'file' &&
                    entry.name === 'datatug-meanings.json',
                )
                  ? this.github
                      .getRawJson(address, 'datatug-meanings.json')
                      .pipe(
                        map((value) =>
                          standaloneProjectMeanings(
                            value,
                            this.api.meaningScope(ref),
                          ),
                        ),
                      )
                  : of([]),
              ),
            ),
          boards: this.assets.boards(ref).pipe(
            switchMap((boards) => {
              if (boards.length > 100)
                throw new Error(
                  'The meanings dashboard catalog exceeds its read limit.',
                );
              return boards.length
                ? from(boards).pipe(
                    mergeMap((board) => this.assets.board(ref, board.id), 8),
                    toArray(),
                  )
                : of([]);
            }),
          ),
        }).pipe(
          map(({ folder, boards, standalone }) => {
            const queries = locatedMeaningQueries(folder);
            return mergeStandaloneProjectMeanings(
              projectQueryMeanings(queries, boards, this.api.meaningScope(ref)),
              standalone,
              queries,
              this.api.meaningScope(ref),
            );
          }),
        );
      }
      return this.api.meaningsCatalog(ref);
    }).pipe(
      map((catalog) => {
        validateProjectMeaningsCatalog(catalog);
        return catalog;
      }),
    );
  }

  change(
    ref: IProjectRef,
    write: ProjectMeaningWrite,
  ): Observable<ProjectMeaningsCatalog> {
    return defer(() => {
      if (
        ['github', 'github.com'].includes(ref.storeId) &&
        ref.projectApi === undefined
      )
        throw new Error('Open an editable project copy to manage meanings.');
      if (!write.operationId || !write.ifMatch)
        throw new Error('Reload the meanings catalog before saving.');
      return this.api.changeMeaning(ref, write);
    }).pipe(
      map((ack: ProjectMeaningAck) => {
        if (ack?.receipt !== write.operationId)
          throw new Error(
            'The meanings save receipt could not be verified. Reload before retrying.',
          );
        validateProjectMeaningsCatalog(ack.catalog);
        const expected = this.api.meaningScope(ref),
          scope = ack.catalog.scope;
        if (
          scope.storage !== expected.storage ||
          scope.project !== expected.project ||
          scope.spaceID !== expected.spaceID ||
          (expected.branch !== undefined && scope.branch !== expected.branch)
        )
          throw new Error(
            'The saved meanings catalog belongs to another project scope.',
          );
        return ack.catalog;
      }),
      switchMap((catalog) => this.presentation(ref, catalog)),
    );
  }
}

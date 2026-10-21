import { firstValueFrom } from 'rxjs';
import type { IProjectRef } from '../core/project-context';
import type { IQueryDef } from '../models/definition/query-def';
import type { ProjectMeaningsService } from '../meanings/project-meanings.service';
import type { QueriesService } from './queries.service';
import {
  fromProjectQueryWire,
  toProjectQueryWire,
} from './project-query-contract';

export interface LocalMeaningSaveSnapshot {
  readonly ref: IProjectRef;
  readonly revision: string;
  readonly branchHead?: string;
}

/** Upgrade a legacy local read only after exact definition and revision admission. */
export async function prepareLocalMeaningSave(
  queries: Pick<QueriesService, 'getRevision'>,
  meanings: Pick<ProjectMeaningsService, 'catalog' | 'refForCatalog'>,
  ref: IProjectRef,
  location: string,
  definition: IQueryDef,
): Promise<LocalMeaningSaveSnapshot> {
  const catalog = await firstValueFrom(meanings.catalog(ref));
  const pinned = meanings.refForCatalog(ref, catalog);
  if (catalog.scope.storage !== 'local' || !pinned.branch)
    throw new Error('The local meanings branch could not be verified.');
  const loaded = await firstValueFrom(queries.getRevision(pinned, location));
  if (
    loaded.saveSupported === false ||
    !loaded.revision ||
    JSON.stringify(
      toProjectQueryWire(fromProjectQueryWire(loaded.query), location),
    ) !== JSON.stringify(toProjectQueryWire(definition, location))
  )
    throw new Error(
      'The saved query changed or cannot be saved without losing metadata. Reload before linking project meanings.',
    );
  return {
    ref: pinned,
    revision: loaded.revision,
    ...(loaded.branchHead ? { branchHead: loaded.branchHead } : {}),
  };
}

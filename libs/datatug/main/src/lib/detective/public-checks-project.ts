import { DEMO_PROJECT_REF } from '@datatug/project-address';
import { IProjectRef } from '../core/project-context';

/** Public execution is deliberately limited to the default demo, never arbitrary GitHub projects/refs. */
export function isPublicChecksProject(
  ref: IProjectRef | undefined,
): ref is IProjectRef {
  return (
    !!ref &&
    ref.storeId === DEMO_PROJECT_REF.storeId &&
    ref.projectId === DEMO_PROJECT_REF.projectId &&
    !ref.branch &&
    !ref.spaceID &&
    !ref.projectApi
  );
}

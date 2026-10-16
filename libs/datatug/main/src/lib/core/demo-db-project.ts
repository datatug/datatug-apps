import type { IProjectRef } from './project-context';

export const CANONICAL_DEMODB_PROJECT_ID =
  'datatug-demo-project@datatug@demo-project-1';

/** Keep private sandbox entry points on the public DemoDB project only. */
export function isCanonicalDemoDbProject(ref?: IProjectRef): boolean {
  return (
    ref?.storeId === 'github.com' &&
    ref.projectId === CANONICAL_DEMODB_PROJECT_ID
  );
}

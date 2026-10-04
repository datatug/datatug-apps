import { DEMO_PROJECT_REF } from '../nav/github-project-address';

/** Only the advertised demo and the existing local trial expose the bundled Chinook data. */
export function isChinookChatProject(storeId: string, projectId: string): boolean {
  return projectId === 'datatug-demo-project' ||
    ((storeId === DEMO_PROJECT_REF.storeId || storeId === 'github') && projectId === DEMO_PROJECT_REF.projectId);
}

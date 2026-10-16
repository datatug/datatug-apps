import { IProjectRef } from '../core/project-context';
/** Local recovery retains the explicit agent address, without a project/content guard. */
export function nativeRecoveryHref(
  project: IProjectRef,
  recoveryId: string,
): string {
  const cloud = ['github', 'github.com', 'firestore'].includes(project.storeId);
  return `${cloud ? '' : '/store/' + encodeURIComponent(project.storeId)}/native-check-status/${encodeURIComponent(recoveryId)}`;
}

import { type IProjectRef } from '../core/project-context';

export function projectApiQuery(ref: IProjectRef): string {
  if (!ref.projectApi) return '';
  if (
    !['cloud', 'local'].includes(ref.projectApi) ||
    !ref.branch ||
    /[\x00-\x1f\x7f]/.test(ref.branch) ||
    ref.spaceID !== undefined ||
    (ref.projectApi === 'cloud'
      ? !['github.com', 'github'].includes(ref.storeId)
      : ['github.com', 'github', 'firestore'].includes(ref.storeId))
  )
    throw new Error('Invalid common project API route');
  return new URLSearchParams({
    projectApi: ref.projectApi,
    branch: ref.branch,
  }).toString();
}
/** Explicit, closed transport selection. Malformed qualifiers must never become anonymous reads. */
export function readProjectApiQuery(params: {
  getAll(name: string): string[];
}): Pick<IProjectRef, 'projectApi' | 'branch'> {
  const modes = params.getAll('projectApi');
  if (!modes.length) return {};
  const branches = params.getAll('branch');
  if (
    modes.length !== 1 ||
    !['cloud', 'local'].includes(modes[0]) ||
    branches.length !== 1 ||
    !branches[0] ||
    /[\x00-\x1f\x7f]/.test(branches[0])
  )
    throw new Error('Invalid common project API route');
  return { projectApi: modes[0] as 'cloud' | 'local', branch: branches[0] };
}

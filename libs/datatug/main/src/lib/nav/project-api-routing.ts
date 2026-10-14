import { type IProjectRef } from '../core/project-context';

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export function projectApiQuery(ref: IProjectRef): string {
  if (!ref.projectApi) return '';
  if (
    !['cloud', 'local'].includes(ref.projectApi) ||
    !ref.branch ||
    hasControlCharacter(ref.branch) ||
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
    hasControlCharacter(branches[0])
  )
    throw new Error('Invalid common project API route');
  return { projectApi: modes[0] as 'cloud' | 'local', branch: branches[0] };
}

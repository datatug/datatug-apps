import type { Board } from '@datatug/board-models';
import type { IProjectRef } from '../../../../core/project-context';
import { parseProjectUrl } from '../../../../nav/nav-models';
import { projectPageHref } from '../../../../nav/project-page-href';

/** Tutorial writes are admitted only for the published, saved showcase board route. */
export function isShowcaseTutorialBoard(
  ref: IProjectRef | undefined,
  board: Board | undefined,
): boolean {
  return (
    !!ref &&
    !!board &&
    !ref.spaceID &&
    projectPageHref(ref, ['board', board.id]) ===
      '/project/github.com/datatug/datatug-demo-project/tree/HEAD/demo-project-1/-/board/showcase'
  );
}

/** Published demo charts may run read-only at HEAD or an immutable Git revision. */
export function isPublishedShowcaseBoard(
  ref: IProjectRef | undefined,
  board: Board | undefined,
): boolean {
  if (!ref || !board || ref.spaceID || ref.projectApi) return false;
  const address = parseProjectUrl(projectPageHref(ref, ['board', board.id]));
  return (
    address.ok &&
    address.github?.owner === 'datatug' &&
    address.github.repo === 'datatug-demo-project' &&
    address.github.folder === 'demo-project-1' &&
    (!address.github.ref || /^[a-f0-9]{40}$/.test(address.github.ref)) &&
    address.rest === '/board/showcase'
  );
}

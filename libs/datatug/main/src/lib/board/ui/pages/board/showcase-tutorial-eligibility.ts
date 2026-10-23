import type { Board } from '@datatug/board-models';
import type { IProjectRef } from '../../../../core/project-context';
import { projectPageHref } from '../../../../nav/project-page-href';

/** Tutorial writes are admitted only for the published, saved showcase board route. */
export function isShowcaseTutorialBoard(ref: IProjectRef | undefined, board: Board | undefined): boolean {
  return !!ref && !!board && !ref.spaceID &&
    projectPageHref(ref, ['board', board.id]) ===
      '/project/github.com/datatug/datatug-demo-project/demo-project-1/-/board/showcase';
}

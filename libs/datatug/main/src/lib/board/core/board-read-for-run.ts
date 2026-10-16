import { Board } from '@datatug/board-models';
import { Observable } from 'rxjs';
import { IProjectRef } from '../../core/project-context';

/** Re-read a board in the exact project context before executing its saved widget. */
export type BoardReadForRun = (
  ref: IProjectRef,
  boardId: string,
) => Observable<Board>;

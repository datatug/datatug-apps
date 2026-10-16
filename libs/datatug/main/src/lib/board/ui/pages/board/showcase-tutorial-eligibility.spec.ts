import { describe, expect, it } from 'vitest';
import type { Board } from '@datatug/board-models';
import { isShowcaseTutorialBoard } from './showcase-tutorial-eligibility';

const ref = { storeId: 'github.com', projectId: 'datatug-demo-project@datatug@demo-project-1' };
const board: Board = { id: 'showcase', title: 'Saved showcase' };

describe('showcase tutorial route admission', () => {
  it('admits the exact published demo board route', () => {
    expect(isShowcaseTutorialBoard(ref, board)).toBe(true);
  });

  it('keeps other boards, projects, branches, stores and Spaces on the ordinary board path', () => {
    expect(isShowcaseTutorialBoard(ref, { ...board, id: 'board1' })).toBe(false);
    expect(isShowcaseTutorialBoard({ ...ref, projectId: 'other@datatug@demo-project-1' }, board)).toBe(false);
    expect(isShowcaseTutorialBoard({ ...ref, projectId: 'datatug-demo-project@datatug@other' }, board)).toBe(false);
    expect(isShowcaseTutorialBoard({ ...ref, storeId: 'firestore' }, board)).toBe(false);
    expect(isShowcaseTutorialBoard({ ...ref, spaceID: 'space' }, board)).toBe(false);
  });
});

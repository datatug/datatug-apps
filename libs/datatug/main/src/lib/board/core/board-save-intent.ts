import { Board, validateHostedBoardDefinition } from '@datatug/board-models';
import { BoardAssetWrite } from '../../services/project/project-assets-api.service';

export interface BoardSaveIntent {
  readonly scope: string;
  readonly write: BoardAssetWrite;
}
const limit = 256 * 1024;
/** Session-only definition journal. Never stores results, query text or credentials. */
export class BoardSaveJournal {
  constructor(
    private readonly storage:
      | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
      | undefined,
  ) {}
  private key(scope: string) {
    return `datatug:board-save:${scope}`;
  }
  read(scope: string): BoardSaveIntent | undefined {
    try {
      const raw = this.storage?.getItem(this.key(scope));
      if (!raw || new TextEncoder().encode(raw).length > limit)
        return undefined;
      const value = JSON.parse(raw) as BoardSaveIntent;
      if (
        value.scope !== scope ||
        !value.write?.operationId ||
        !!value.write.ifNoneMatch === !!value.write.ifMatch
      )
        return undefined;
      validateHostedBoardDefinition(value.write.board);
      return value;
    } catch {
      return undefined;
    }
  }
  create(scope: string, board: Board, revision?: string): BoardSaveIntent {
    validateHostedBoardDefinition(board);
    const intent: BoardSaveIntent = {
      scope,
      write: {
        operationId: crypto.randomUUID(),
        ...(revision ? { ifMatch: revision } : { ifNoneMatch: true }),
        board: JSON.parse(JSON.stringify(board)) as Board,
      },
    };
    const raw = JSON.stringify(intent);
    if (new TextEncoder().encode(raw).length > limit)
      throw new Error('Board definition exceeds the save limit.');
    try {
      this.storage?.setItem(this.key(scope), raw);
    } catch {
      /* In-memory intent still freezes this mounted retry. */
    }
    return intent;
  }
  clear(scope: string): void {
    try {
      this.storage?.removeItem(this.key(scope));
    } catch {
      /* Confirmed receipt remains authoritative. */
    }
  }
}

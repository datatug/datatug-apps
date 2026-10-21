import { BoardSaveJournal } from './board-save-intent';
import { Board } from '@datatug/board-models';
describe('BoardSaveJournal', () => {
  beforeEach(() => sessionStorage.clear());
  it('preserves the exact operation, payload and precondition across a lost reply and remount', () => {
    const board: Board = { id: 'b', title: 'Shipping', rows: [] };
    const journal = new BoardSaveJournal(sessionStorage);
    const intent = journal.create(
      'sarah:space:p:demo:b',
      board,
      'revision-one',
    );
    board.title = 'changed';
    const replay = new BoardSaveJournal(sessionStorage).read(
      'sarah:space:p:demo:b',
    );
    expect(replay).toEqual(intent);
    expect(replay?.write.board.title).toBe('Shipping');
    expect(journal.read('maya:space:p:demo:b')).toBeUndefined();
    expect(journal.read('sarah:space:p:prod:b')).toBeUndefined();
    journal.clear(intent.scope);
    expect(journal.read(intent.scope)).toBeUndefined();
  });
  it('uses create-only and bounds definitions without storing results or query text', () => {
    const journal = new BoardSaveJournal(sessionStorage);
    expect(
      journal.create('new', { id: 'b', title: 'New', rows: [] }).write
        .ifNoneMatch,
    ).toBe(true);
    expect(() =>
      journal.create('huge', { id: 'b', title: 'x'.repeat(256 * 1024) }),
    ).toThrow('limit');
    expect(() =>
      journal.create('sql', {
        id: 'b',
        title: 'Bad',
        rows: [
          {
            cards: [
              {
                id: 'a',
                title: 'Bad',
                widget: {
                  name: 'SQL',
                  data: { sql: { queryId: 'q', text: 'SELECT secret' } },
                } as never,
              },
            ],
          },
        ],
      }),
    ).toThrow('inline SQL');
  });
});

import { arrayToGrid } from './array-to-grid';
import { IPipe } from './interfaces';

describe('arrayToGrid', () => {
  it('returns an empty grid for an empty array', () => {
    expect(arrayToGrid([])).toEqual({ cols: [], rows: [] });
  });

  it('collects columns in first-seen order and aligns row values', () => {
    const grid = arrayToGrid([
      { a: 1, b: 'x' },
      { b: 'y', c: true },
    ]);
    expect(grid.cols).toEqual(['a', 'b', 'c']);
    expect(grid.rows).toEqual([
      [1, 'x'],
      [undefined, 'y', true],
    ]);
  });

  it('leaves falsy values as empty cells', () => {
    expect(arrayToGrid([{ a: 0, b: '', c: null, d: false, e: 'v' }]).rows).toEqual([
      [undefined, undefined, undefined, undefined, 'v'],
    ]);
  });

  it('applies pipes in order before reading keys', () => {
    const pipes: IPipe[] = [
      { tunnel: (o) => ({ ...(o as object), added: 'p1' }) },
      {
        tunnel: (o) => {
          const { drop, ...rest } = o as Record<string, unknown>;
          void drop;
          return rest;
        },
      },
    ];
    expect(arrayToGrid([{ id: 1, drop: 'gone' }], pipes)).toEqual({
      cols: ['id', 'added'],
      rows: [[1, 'p1']],
    });
  });

  it('ignores an empty pipe list', () => {
    expect(arrayToGrid([{ k: 'v' }], [])).toEqual({ cols: ['k'], rows: [['v']] });
  });
});

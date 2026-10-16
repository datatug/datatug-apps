import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GRID_STATE_VERSION,
  columnSignature,
  gridStateKey,
  parseGridState,
  readGridState,
  toTsv,
  tsvField,
  writeGridState,
} from './results-grid-state';

const cols = [
  { colId: 'c0', name: 'A', type: 'dtNumber' },
  { colId: 'c1', name: 'B', type: 'dtText' },
];
const sig = columnSignature(cols);
const ids = ['c0', 'c1'];
const stored = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: GRID_STATE_VERSION,
    density: 'compact',
    sig,
    cols: [
      {
        colId: 'c1',
        hide: true,
        width: 150,
        pinned: 'left',
        sort: 'desc',
        sortIndex: 0,
      },
      {
        colId: 'c0',
        hide: false,
        width: 90,
        pinned: null,
        sort: null,
        sortIndex: null,
      },
    ],
    ...extra,
  });

describe('gridStateKey', () => {
  it('is built from ids only, percent-encoded, with the kind last', () => {
    expect(
      gridStateKey({
        project: 'demo',
        context: 'customers/by-city',
        kind: 'query',
      }),
    ).toBe('datatug.grid.v1:demo:customers%2Fby-city:query');
    expect(gridStateKey({ project: 'a:b', context: 'x', kind: 'result' })).toBe(
      'datatug.grid.v1:a%3Ab:x:result',
    );
  });
  it('is undefined without a project or a context', () => {
    expect(
      gridStateKey({ project: '', context: 'x', kind: 'source' }),
    ).toBeUndefined();
    expect(
      gridStateKey({ project: 'p', context: undefined, kind: 'source' }),
    ).toBeUndefined();
  });
  it('bounds the length of each id', () => {
    const key =
      gridStateKey({ project: 'p', context: 'x'.repeat(500), kind: 'query' }) ??
      '';
    expect(key.length).toBeLessThan(140);
  });
});

describe('columnSignature', () => {
  it('changes with an id, a name or a type', () => {
    expect(columnSignature(cols)).toBe(sig);
    expect(columnSignature([{ ...cols[0], name: 'Z' }, cols[1]])).not.toBe(sig);
    expect(columnSignature([{ ...cols[0], type: 'dtText' }, cols[1]])).not.toBe(
      sig,
    );
    expect(columnSignature([cols[0]])).not.toBe(sig);
  });
});

describe('parseGridState', () => {
  it('returns the layout and density of a matching state', () => {
    const s = parseGridState(stored(), sig, ids);
    expect(s?.density).toBe('compact');
    expect(s?.cols?.map((c) => c.colId)).toEqual(['c1', 'c0']);
    expect(s?.cols?.[0]).toMatchObject({
      hide: true,
      width: 150,
      pinned: 'left',
      sort: 'desc',
    });
  });
  it('ignores the layout (keeps the density) when the columns changed', () => {
    expect(parseGridState(stored(), 'ffffffff', ids)).toEqual({
      v: 1,
      density: 'compact',
    });
    expect(parseGridState(stored(), sig, ['c0', 'c9'])?.cols).toBeUndefined();
    expect(parseGridState(stored(), sig, ['c0'])?.cols).toBeUndefined();
  });
  it('rejects text that is not ours', () => {
    for (const raw of [
      null,
      '',
      'not json',
      '[]',
      '{"v":2}',
      '{"density":"compact"}',
      'x'.repeat(300_000),
    ]) {
      expect(parseGridState(raw, sig, ids)).toBeUndefined();
    }
  });
  it('sanitizes fields and drops duplicates', () => {
    const s = parseGridState(
      stored({
        density: 'huge',
        cols: [
          {
            colId: 'c0',
            width: 'wide',
            pinned: 'middle',
            sort: 'up',
            sortIndex: -3,
            hide: 'yes',
          },
          { colId: 'c1', width: 99999 },
        ],
      }),
      sig,
      ids,
    );
    expect(s?.density).toBe('comfortable');
    expect(s?.cols?.[0]).toEqual({
      colId: 'c0',
      hide: false,
      pinned: null,
      sort: null,
      sortIndex: null,
    });
    expect(s?.cols?.[1].width).toBeUndefined();
    const dup = parseGridState(
      stored({ cols: [{ colId: 'c0' }, { colId: 'c0' }] }),
      sig,
      ids,
    );
    expect(dup?.cols).toBeUndefined();
  });
});

describe('storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  it('writes and reads back the state under the key', () => {
    const key = 'datatug.grid.v1:p:q:query';
    expect(
      writeGridState(key, {
        v: 1,
        density: 'compact',
        sig,
        cols: [
          {
            colId: 'c0',
            hide: false,
            width: 100,
            pinned: null,
            sort: null,
            sortIndex: null,
          },
          {
            colId: 'c1',
            hide: true,
            pinned: null,
            sort: null,
            sortIndex: null,
          },
        ],
      }),
    ).toBe(true);
    expect(readGridState(key, sig, ids)?.cols).toHaveLength(2);
    // Only ids and layout are stored: no cell, filter or name text.
    expect(localStorage.getItem(key)).not.toMatch(/Invoice|filter|prompt/i);
  });
  it('does nothing without a key', () => {
    expect(writeGridState(undefined, { v: 1, density: 'compact' })).toBe(false);
    expect(readGridState(undefined, sig, ids)).toBeUndefined();
  });
  it('survives a storage that throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(readGridState('k', sig, ids)).toBeUndefined();
    expect(writeGridState('k', { v: 1, density: 'compact' })).toBe(false);
  });
  it('survives a missing storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(writeGridState('k', { v: 1, density: 'compact' })).toBe(false);
    expect(readGridState('k', sig, ids)).toBeUndefined();
  });
});

describe('tab-separated text', () => {
  it('quotes only what needs it', () => {
    expect(tsvField('plain')).toBe('plain');
    expect(tsvField(null)).toBe('');
    expect(tsvField('a\tb')).toBe('"a\tb"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
    expect(tsvField('l1\nl2')).toBe('"l1\nl2"');
  });
  it('writes the header first, then a line per row', () => {
    expect(
      toTsv(
        ['A', 'B'],
        [
          ['1', null],
          ['x\ty', '2'],
        ],
      ),
    ).toBe('A\tB\n1\t\n"x\ty"\t2');
  });
});

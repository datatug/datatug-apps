import { IRecordsetResult } from '../dto/execute';
import { IRecordsetCheckDef } from '../models/definition/checks/recordset-checks';
import { IRecordsetDef } from '../models/definition/recordset';
import {
  RecordsetMaxCountCheck,
  RecordsetMinCountCheck,
} from './recordset/count-checks';
import {
  checkRecordsetResult,
  newRecordsetCheckFromDef,
} from './recordset-row-checker';

describe('newRecordsetCheckFromDef', () => {
  it.each([
    ['min', RecordsetMinCountCheck],
    ['max', RecordsetMaxCountCheck],
  ] as const)('maps %s to its check class', (type, cls) => {
    const def = { type, value: 1 } as IRecordsetCheckDef;
    const check = newRecordsetCheckFromDef(def);
    expect(check).toBeInstanceOf(cls);
    expect((check as RecordsetMinCountCheck).def).toBe(def);
  });

  it('throws for an unknown type', () => {
    expect(() =>
      newRecordsetCheckFromDef({ type: 'avg', value: 1 } as unknown as IRecordsetCheckDef),
    ).toThrow('unknown recordset check type: avg');
  });
});

describe('checkRecordsetResult', () => {
  const result: IRecordsetResult = {
    columns: [],
    rows: [
      ['a', '1', 'x'],
      ['b', 'z', 'x'],
      ['c', '3', 'q'],
    ],
  };

  it('returns empty results when there are no checks', () => {
    const def: IRecordsetDef = {
      name: 'rs',
      columns: [
        { name: 'c0', type: 'string' },
        { name: 'c1', type: 'string', checks: [] },
      ],
    };
    expect(checkRecordsetResult(def, result)).toEqual({
      recordset: [],
      byColumn: {},
    });
  });

  it('runs recordset checks and groups failing cells by column and row', () => {
    const minDef = { type: 'min', value: 1 } as IRecordsetCheckDef;
    const def: IRecordsetDef = {
      name: 'rs',
      checks: [minDef],
      columns: [
        { name: 'c0', type: 'string' },
        {
          name: 'c1',
          type: 'string',
          checks: [
            { type: 'regexp', value: '^\\d+$' },
            { type: 'enum', value: ['1', '3'] },
          ],
        },
        { name: 'c2', type: 'string', checks: [{ type: 'enum', value: ['x'] }] },
      ],
    };
    const checked = checkRecordsetResult(def, result);
    expect(checked.recordset).toEqual([{ def: minDef, ok: true }]);
    expect(checked).toEqual({
      recordset: [{ def: minDef, ok: true }],
      byColumn: {
        1: {
          1: [
            { ok: false, message: 'does not match regular expression: /^\\d+$/' },
            { ok: false, message: 'does not match any of known values: 1, 3' },
          ],
        },
        2: {
          2: [{ ok: false, message: 'does not match any of known values: x' }],
        },
      },
    });
  });
});

import { IRecordsetResult } from '../../dto/execute';
import {
  IRecordsetMaxCountCheckDef,
  IRecordsetMinCountCheckDef,
} from '../../models/definition/checks/recordset-checks';
import { RecordsetMaxCountCheck, RecordsetMinCountCheck } from './count-checks';

const result = (count: number): IRecordsetResult => ({
  columns: [],
  rows: Array.from({ length: count }, (_, i) => [i]),
});

describe('RecordsetMinCountCheck', () => {
  const def: IRecordsetMinCountCheckDef = { type: 'min', value: 2 };
  const check = new RecordsetMinCountCheck(def);

  it.each([2, 3, 10])('passes with %i rows (at least 2)', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({ def, ok: true });
  });

  it.each([0, 1])('fails with %i rows', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({
      def,
      ok: false,
      message: `expected at least 2 records, got ${n}`,
    });
  });
});

describe('RecordsetMaxCountCheck', () => {
  const def: IRecordsetMaxCountCheckDef = { type: 'max', value: 2 };
  const check = new RecordsetMaxCountCheck(def);

  it.each([0, 1, 2])('passes with %i rows (no more than 2)', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({ def, ok: true });
  });

  it.each([3, 10])('fails with %i rows', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({
      def,
      ok: false,
      message: `expected no more than 2 records, got ${n}`,
    });
  });
});

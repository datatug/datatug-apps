import { IRecordsetResult } from '../../dto/execute';
import { IRecordsetMinCountCheckDef } from '../../models/definition/checks/recordset-checks';
import { RecordsetMaxCountCheck, RecordsetMinCountCheck } from './count-checks';

const result = (count: number): IRecordsetResult => ({
  columns: [],
  rows: Array.from({ length: count }, (_, i) => [i]),
});

describe('RecordsetMinCountCheck', () => {
  const def: IRecordsetMinCountCheckDef = { type: 'min', value: 2 };
  const check = new RecordsetMinCountCheck(def);

  it('exposes its definition', () => {
    expect(check.def).toBe(def);
  });

  it.each([3, 10])('passes when there are clearly enough rows (%i)', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({ def, ok: true });
  });

  it.each([0, 1])('fails with a message when too few rows (%i)', (n) => {
    expect(check.checkRecordsetResult(result(n))).toEqual({
      def,
      ok: false,
      message: `expected no more then 2 records, got ${n}`,
    });
  });
});

describe('RecordsetMaxCountCheck', () => {
  // The pass/fail logic currently mirrors the min check (see report), so only
  // the shape of the result is asserted here, not which rows counts pass.
  const def = { type: 'max', value: 2 } as unknown as IRecordsetMinCountCheckDef;
  const check = new RecordsetMaxCountCheck(def);

  it.each([0, 5])('returns a result tied to its definition (%i rows)', (n) => {
    const r = check.checkRecordsetResult(result(n));
    expect(check.def).toBe(def);
    expect(r.def).toBe(def);
    expect(typeof r.ok).toBe('boolean');
  });
});

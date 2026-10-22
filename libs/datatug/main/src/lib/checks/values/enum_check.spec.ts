import { EnumValidCheck } from './enum_check';

describe('EnumValidCheck', () => {
  const check = new EnumValidCheck(['a', 1, true, null]);

  it.each(['a', 1, true, null])('accepts known value %j', (value) => {
    expect(check.checkValue(value)).toEqual({ ok: true });
  });

  it.each(['b', '1', 'true', undefined, 0])(
    'rejects unknown value %j using strict equality',
    (value) => {
      expect(check.checkValue(value)).toEqual({
        ok: false,
        message: 'does not match any of known values: a, 1, true, ',
      });
    },
  );

  it('rejects everything when no values are known', () => {
    expect(new EnumValidCheck([]).checkValue('a')).toEqual({
      ok: false,
      message: 'does not match any of known values: ',
    });
  });
});

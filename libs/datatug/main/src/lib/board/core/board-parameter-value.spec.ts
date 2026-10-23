import { IParameterDef } from '../../models/definition/parameter';
import { DataType } from '../../models/definition/types';
import { parseBoardParameterValue } from './board-parameter-value';

const def = (type: DataType, extra: Partial<IParameterDef> = {}) =>
  ({ id: 'p1', type, ...extra }) as IParameterDef;

describe('parseBoardParameterValue', () => {
  describe('empty input', () => {
    it.each([null, undefined, ''])(
      'requires a value for %j by default, naming the title or id',
      (raw) => {
        expect(() =>
          parseBoardParameterValue(def('string', { title: 'Name' }), raw),
        ).toThrow('Enter a value for Name.');
        expect(() => parseBoardParameterValue(def('string'), raw)).toThrow(
          'Enter a value for p1.',
        );
      },
    );

    it('returns undefined for an optional parameter', () => {
      expect(
        parseBoardParameterValue(def('string', { isRequired: false }), ''),
      ).toBeUndefined();
    });
  });

  it.each([
    ['multi-value def', def('string', { isMultiValue: true }), 'a'],
    ['object raw', def('string'), { a: 1 }],
    ['array raw', def('string'), ['a']],
  ])('rejects a non-single value: %s', (_, d, raw) => {
    expect(() => parseBoardParameterValue(d, raw)).toThrow(
      'Enter a single parameter value.',
    );
  });

  it.each([
    ['0', 0],
    ['42', 42],
    ['-7', -7],
    [12, 12],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('parses integer %j', (raw, value) => {
    expect(parseBoardParameterValue(def('integer'), raw)).toEqual({
      type: 'integer',
      value,
    });
  });

  it.each(['1.5', '01', '+1', 'abc', '1e3', '9007199254740993', ' 1'])(
    'rejects integer %j',
    (raw) => {
      expect(() => parseBoardParameterValue(def('integer'), raw)).toThrow(
        'Enter a whole number within the supported integer range.',
      );
    },
  );

  it.each([
    ['number', '1.5', 1.5],
    ['float', '-.5', -0.5],
    ['money', '+10.', 10],
    ['number', '1e3', 1000],
    ['float', '2E-2', 0.02],
    ['number', 3, 3],
  ] as const)('parses %s %j', (type, raw, value) => {
    expect(parseBoardParameterValue(def(type), raw)).toEqual({ type, value });
  });

  it.each(['abc', '1,5', '.', 'Infinity', '1e999', 'NaN', '0x10'])(
    'rejects non-finite or malformed number %j',
    (raw) => {
      expect(() => parseBoardParameterValue(def('number'), raw)).toThrow(
        'Enter a finite number.',
      );
    },
  );

  it.each([
    ['boolean', true, true],
    ['boolean', 'true', true],
    ['bit', '1', true],
    ['boolean', false, false],
    ['bit', 'false', false],
    ['boolean', '0', false],
    ['bit', 1, true],
    ['bit', 0, false],
  ] as const)('parses %s %j', (type, raw, value) => {
    expect(parseBoardParameterValue(def(type), raw)).toEqual({ type, value });
  });

  it.each(['yes', 'TRUE', '2'])('rejects boolean %j', (raw) => {
    expect(() => parseBoardParameterValue(def('boolean'), raw)).toThrow(
      'Enter true or false.',
    );
  });

  it.each(['2024-02-29', '1999-12-31'])('parses date %j', (raw) => {
    expect(parseBoardParameterValue(def('date'), raw)).toEqual({
      type: 'date',
      value: raw,
    });
  });

  it.each(['2023-02-29', '2024-13-01', '24-01-01', '2024-01-01T00:00:00Z'])(
    'rejects date %j',
    (raw) => {
      expect(() => parseBoardParameterValue(def('date'), raw)).toThrow(
        'Enter an ISO date (YYYY-MM-DD).',
      );
    },
  );

  it.each([
    '2024-01-01T10:20Z',
    '2024-01-01T23:59:59.123+05:30',
    '2024-01-01T00:00:00-00:00',
  ])('parses datetime %j', (raw) => {
    expect(parseBoardParameterValue(def('datetime'), raw)).toEqual({
      type: 'datetime',
      value: raw,
    });
  });

  it.each([
    '2024-01-01',
    '2024-01-01T10:20',
    '2024-01-01T24:00Z',
    '2024-02-30T10:00Z',
    '2024-01-01T10:00:00.1234Z',
  ])('rejects datetime %j', (raw) => {
    expect(() => parseBoardParameterValue(def('datetime'), raw)).toThrow(
      'Enter an ISO date and time including its timezone.',
    );
  });

  it.each(['string', 'text', 'UUID', 'GUID'] as const)(
    'returns %s text as-is, coercing primitives',
    (type) => {
      expect(parseBoardParameterValue(def(type), 'abc')).toEqual({
        type,
        value: 'abc',
      });
      expect(parseBoardParameterValue(def(type), 5)).toEqual({
        type,
        value: '5',
      });
    },
  );

  it.each([
    ['ab', { minLength: 3 }, false],
    ['abc', { minLength: 3 }, true],
    ['abcd', { maxLength: 3 }, false],
    ['abc', { minLength: 3, maxLength: 3 }, true],
  ])('enforces text length for %j %j', (raw, extra, ok) => {
    const parse = () => parseBoardParameterValue(def('string', extra), raw);
    if (ok) expect(parse()).toEqual({ type: 'string', value: raw });
    else expect(parse).toThrow('outside its allowed length');
  });

  it('refuses manual entry for unsupported types', () => {
    expect(() =>
      parseBoardParameterValue(def('blob' as DataType), 'x'),
    ).toThrow('Manual entry is unavailable for parameter type blob.');
  });
});

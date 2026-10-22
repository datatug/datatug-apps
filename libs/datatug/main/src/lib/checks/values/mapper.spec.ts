import { IFieldCheckDef } from '../../models/definition/checks/field-checks';
import { EnumValidCheck } from './enum_check';
import { newFieldCheckFromDef } from './mapper';
import { RegExpCheck } from './regexp_check';

describe('newFieldCheckFromDef', () => {
  it('creates a RegExpCheck from a pattern string', () => {
    const check = newFieldCheckFromDef({ type: 'regexp', value: '^\\d+$' });
    expect(check).toBeInstanceOf(RegExpCheck);
    expect(check.checkValue('123').ok).toBe(true);
    expect(check.checkValue('12a').ok).toBe(false);
  });

  it('creates an EnumValidCheck from a value list', () => {
    const check = newFieldCheckFromDef({ type: 'enum', value: ['x', 'y'] });
    expect(check).toBeInstanceOf(EnumValidCheck);
    expect(check.checkValue('y').ok).toBe(true);
    expect(check.checkValue('z').ok).toBe(false);
  });

  it.each(['ref', 'unknown'])('throws for unsupported type %s', (type) => {
    expect(() =>
      newFieldCheckFromDef({ type, value: 'x' } as unknown as IFieldCheckDef),
    ).toThrow(`unknown field check type: ${type}`);
  });

  it('throws for an invalid regular expression', () => {
    expect(() => newFieldCheckFromDef({ type: 'regexp', value: '(' })).toThrow(
      SyntaxError,
    );
  });
});

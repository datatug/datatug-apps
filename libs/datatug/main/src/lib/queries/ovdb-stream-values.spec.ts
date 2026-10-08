import { describe, expect, it } from 'vitest';
import { ovdbStreamCell, ovdbStreamRow } from './ovdb-stream-values';

describe('provider-neutral streamed value presentation', () => {
  it('preserves declared exact numbers and opaque binary strings without guessing unknown types', () => {
    expect(ovdbStreamCell('98765432101234567890.123456789', 'decimal')).toEqual({ type: 'decimal', value: '98765432101234567890.123456789' });
    expect(ovdbStreamCell('9007199254740993', 'integer')).toEqual({ type: 'integer', value: '9007199254740993' });
    expect(ovdbStreamCell('AAE=', 'bytea')).toEqual({ type: 'string', value: 'AAE=' });
    expect(ovdbStreamCell('', 'bytea')).toEqual({ type: 'string', value: '' });
    expect(ovdbStreamCell(null, 'bytea')).toEqual({ type: 'null', value: null });
    expect(ovdbStreamCell('9007199254740993')).toEqual({ type: 'string', value: '9007199254740993' });
    expect(() => ovdbStreamCell(1.25, 'decimal')).toThrow(/unquoted exact decimal/);
  });

  it('fills late-unioned absent fields with NULL in the server column order', () => {
    expect(ovdbStreamRow({ second: 's' }, [{ name: 'first', type: 'unknown' }, { name: 'second', type: 'string' }])).toEqual([
      { type: 'null', value: null }, { type: 'string', value: 's' },
    ]);
  });
});

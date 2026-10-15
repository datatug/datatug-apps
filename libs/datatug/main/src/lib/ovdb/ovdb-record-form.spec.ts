import { describe, expect, it } from 'vitest';
import { formatOvdbValue, ovdbFormFields, ovdbRecordChanges, parseOvdbInput } from './ovdb-record-form';
import type { OvdbCollectionSchema } from './ovdb-connection';

const track: OvdbCollectionSchema = {
  primaryKey: ['TrackId'],
  fields: {
    TrackId: { type: 'integer', declaredType: 'INTEGER', notNull: true, primaryKeyPosition: 1 },
    Name: { type: 'string', declaredType: 'NVARCHAR(200)', notNull: true },
    Composer: { type: 'string', declaredType: 'NVARCHAR(220)', notNull: false },
    UnitPrice: { type: 'decimal', declaredType: 'NUMERIC(10,2)', notNull: true },
    Ratio: { type: 'number', declaredType: 'REAL' },
    Cover: { type: 'blob', declaredType: 'BLOB' },
  },
};
const record = { TrackId: 7, Name: 'Song', Composer: null, UnitPrice: 0.99, Ratio: 1.5, Cover: null };

describe('ovdbFormFields', () => {
  it('derives kinds, keys, nullability and decimal scale from the schema', () => {
    const fields = ovdbFormFields(track, record);
    expect(fields.map((f) => [f.name, f.kind, f.editable, f.nullable])).toEqual([
      ['TrackId', 'integer', false, false],
      ['Name', 'text', true, false],
      ['Composer', 'text', true, true],
      ['UnitPrice', 'decimal', true, false],
      ['Ratio', 'number', true, true],
      ['Cover', 'blob', false, true],
    ]);
    expect(fields.find((f) => f.name === 'UnitPrice')?.scale).toBe(2);
  });

  it('infers kinds from values without a schema', () => {
    expect(ovdbFormFields(undefined, { a: 1, b: 1.5, c: 'x', d: true, e: new Uint8Array(2) }).map((f) => f.kind))
      .toEqual(['integer', 'number', 'text', 'boolean', 'blob']);
  });
});

describe('formatting and parsing', () => {
  const fields = ovdbFormFields(track, record);
  const field = (name: string) => {
    const found = fields.find((f) => f.name === name);
    if (!found) throw new Error(`no field ${name}`);
    return found;
  };

  it('shows decimals as fixed-point text and blobs by size', () => {
    expect(formatOvdbValue(field('UnitPrice'), 0.1 + 0.2)).toBe('0.30');
    expect(formatOvdbValue(field('Cover'), new Uint8Array(3))).toBe('(binary, 3 bytes)');
    expect(formatOvdbValue(field('Composer'), null)).toBe('');
  });

  it('parses each kind and refuses bad input', () => {
    expect(parseOvdbInput(field('UnitPrice'), { text: '1.49', isNull: false })).toEqual({ ok: true, value: '1.49' });
    expect(parseOvdbInput(field('UnitPrice'), { text: '1,49', isNull: false }).ok).toBe(false);
    expect(parseOvdbInput(field('Ratio'), { text: '2.5', isNull: false })).toEqual({ ok: true, value: 2.5 });
    expect(parseOvdbInput(field('Ratio'), { text: 'x', isNull: false }).ok).toBe(false);
    expect(parseOvdbInput(field('Name'), { text: '', isNull: true }).ok).toBe(false);
    expect(parseOvdbInput(field('Composer'), { text: '', isNull: true })).toEqual({ ok: true, value: null });
    expect(parseOvdbInput({ ...field('TrackId'), editable: true }, { text: '99999999999999999', isNull: false }).ok).toBe(false);
    expect(parseOvdbInput({ ...field('Name'), kind: 'boolean' }, { text: 'true', isNull: false })).toEqual({ ok: true, value: true });
    expect(parseOvdbInput(field('Cover'), { text: '', isNull: false }).ok).toBe(false);
  });

  it('returns only the changed editable fields', () => {
    const result = ovdbRecordChanges(fields, record, {
      TrackId: { text: '8', isNull: false },
      Name: { text: 'Song', isNull: false },
      Composer: { text: 'AC/DC', isNull: false },
      UnitPrice: { text: '0.99', isNull: false },
      Ratio: { text: '', isNull: true },
    });
    expect(result).toEqual({ changes: { Composer: 'AC/DC', Ratio: null }, errors: {} });
  });
});

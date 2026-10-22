import type { ContextSnapshot } from '../session-context/session-context-contract';
import {
  bagEntriesFromSnapshot,
  canBindFromRow,
  httpRunParameterRecord,
  resolveHttpParameters,
  type HttpRowBinding,
} from './http-parameter-binding';
import type { HttpParameterDecl } from './http-template';

const orderId: HttpParameterDecl = {
  id: 'order_id',
  type: 'string',
  isRequired: true,
  meta: { entity: 'Order', field: 'id' },
};
const asOf: HttpParameterDecl = { id: 'as_of', type: 'date', isRequired: true };
const row: HttpRowBinding = {
  columns: [{ name: 'OrderRef', meta: { entity: 'Order', field: 'id' } }, { name: 'AS_OF' }],
  values: ['ord-7', '2026-03-04T23:30:00Z'],
};

describe('resolveHttpParameters', () => {
  it('binds from the row by meaning, then by column name (AC row-binds-parameters)', () => {
    const r = resolveHttpParameters([orderId, asOf], { row });
    expect(r).toEqual([
      { id: 'order_id', source: 'row', value: 'ord-7', rendered: 'ord-7', column: 'OrderRef' },
      { id: 'as_of', source: 'row', value: '2026-03-04T23:30:00Z', rendered: '2026-03-04', column: 'AS_OF' },
    ]);
  });

  it('follows typed, row, board, bag, default (AC precedence-order)', () => {
    const def: HttpParameterDecl = { ...orderId, isRequired: false, defaultValue: 'dflt' };
    const bag = [{ entity: 'Order', field: 'id', kind: 'scalar' as const, value: 'bagv' }];
    const all = { typed: { order_id: 'typed' }, row, board: { order_id: 'boardv' }, bag };
    const pick = (s: object) => resolveHttpParameters([def], s)[0].source;
    expect(pick(all)).toBe('typed');
    expect(pick({ ...all, typed: {} })).toBe('row');
    expect(pick({ board: all.board, bag })).toBe('board');
    expect(pick({ bag })).toBe('bag');
    expect(pick({})).toBe('default');
  });

  it('blocks a required parameter with no value and a null column (AC null-column-missing)', () => {
    const r = resolveHttpParameters([orderId], { row: { ...row, values: [null, 'x'] } });
    expect(r[0].error).toContain('order_id');
    expect(r[0].source).toBeUndefined();
  });

  it('ignores a set-valued bag entry (AC set-bag-entry-ignored)', () => {
    const r = resolveHttpParameters([orderId], {
      bag: [{ entity: 'Order', field: 'id', kind: 'set' }],
    });
    expect(r[0].error).toBeDefined();
  });

  it('blocks a value that cannot be coerced, naming parameter and source (AC bad-coercion-blocks)', () => {
    const r = resolveHttpParameters([asOf], { typed: { as_of: 'not-a-date' } });
    expect(r[0]).toMatchObject({ source: 'typed', error: 'as_of: the typed value is not a valid date.' });
  });

  it('takes a credential from typed values only (AC credential-parameter-isolated)', () => {
    const token: HttpParameterDecl = { id: 'token', type: 'string', isRequired: true, isCredential: true };
    const tokenRow: HttpRowBinding = { columns: [{ name: 'token' }], values: ['from-row'] };
    const refused = resolveHttpParameters([token], { row: tokenRow, board: { token: 'b' } })[0];
    expect(refused.error).toContain('Type a value');
    expect(refused.refused).toEqual(['row', 'board']);
    const typed = resolveHttpParameters([token], { row: tokenRow, typed: { token: 's3' } })[0];
    expect(typed).toMatchObject({ source: 'typed', rendered: 's3', refused: ['row'] });
  });
});

describe('httpRunParameterRecord (AC history-redaction)', () => {
  it('keeps ids and sources, and no credential value', () => {
    const token: HttpParameterDecl = { id: 'token', type: 'string', isRequired: true, isCredential: true };
    const defs = [orderId, token];
    const resolved = resolveHttpParameters(defs, { row, typed: { token: 'secret' } });
    const record = httpRunParameterRecord(defs, resolved);
    expect(record).toEqual([
      { id: 'order_id', source: 'row', value: 'ord-7' },
      { id: 'token', source: 'typed' },
    ]);
    expect(JSON.stringify(record)).not.toContain('secret');
  });
});

describe('canBindFromRow', () => {
  it('needs every parameter without a default bound from the row', () => {
    expect(canBindFromRow([orderId, asOf], row)).toBe(true);
    expect(canBindFromRow([orderId, { id: 'region', type: 'string', isRequired: true }], row)).toBe(false);
    expect(canBindFromRow([{ id: 'x', type: 'string', defaultValue: 'a' }], row)).toBe(false);
  });
});

describe('bagEntriesFromSnapshot', () => {
  it('reads applied scalar and set entries', () => {
    const snapshot = {
      contextSet: { enabled: true, slots: [{ entries: [{ entryId: 'e1', revisionId: 'r1' }, { entryId: 'e2', revisionId: 'r2' }, { entryId: 'e3', revisionId: 'gone' }] }] },
      revisions: [
        { id: 'r1', entryId: 'e1', subject: { conceptId: 'Order', fieldId: 'id' }, value: { kind: 'scalar', scalar: { type: 'string', value: 'o1' } } },
        { id: 'r2', entryId: 'e2', subject: { conceptId: 'Order', fieldId: 'id' }, value: { kind: 'set', values: [] } },
      ],
    } as unknown as ContextSnapshot;
    expect(bagEntriesFromSnapshot(snapshot)).toEqual([
      { entity: 'Order', field: 'id', kind: 'scalar', value: 'o1' },
      { entity: 'Order', field: 'id', kind: 'set' },
    ]);
    expect(bagEntriesFromSnapshot(undefined)).toEqual([]);
    expect(bagEntriesFromSnapshot({ ...snapshot, contextSet: { ...snapshot.contextSet, enabled: false } })).toEqual([]);
  });
});

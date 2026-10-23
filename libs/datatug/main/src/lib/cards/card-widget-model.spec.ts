import type { BoardWidget } from '@datatug/board-models';
import {
  bindingChoice,
  bindingValue,
  fieldsToText,
  getSource,
  newWidget,
  setSource,
  textToFields,
  withBinding,
} from './card-widget-model';

describe('card widget sources', () => {
  it('reads and writes the source of a grid widget, query or parameter', () => {
    const grid: BoardWidget = { name: 'SQL', data: { title: 'T', sql: { queryId: 'q', parameters: [{ id: 'a', value: 1 }] } } };
    expect(getSource(grid)).toEqual({ kind: 'query', queryId: 'q', parameters: [{ id: 'a', value: 1 }] });
    const fromParam = setSource(grid, { kind: 'parameter', parameter: 'rows' });
    expect(fromParam.data).toEqual({ title: 'T', source: { parameter: 'rows' } });
    expect(getSource(fromParam)).toEqual({ kind: 'parameter', parameter: 'rows' });
    const back = setSource(fromParam, { kind: 'query', queryId: 'z', parameters: [] });
    expect(back.data).toEqual({ title: 'T', sql: { queryId: 'z' } });
  });
  it('reads and writes the source of a fields widget', () => {
    const w: BoardWidget = { name: 'fields', data: { source: { queryId: 'q' }, fields: [{ column: 'A' }] } };
    expect(getSource(w)).toEqual({ kind: 'query', queryId: 'q', parameters: [] });
    const next = setSource(w, { kind: 'parameter', parameter: 'row' });
    expect(next.data).toEqual({ source: { parameter: 'row' }, fields: [{ column: 'A' }] });
    expect(getSource({ name: 'text', data: {} })).toBeUndefined();
  });
  it('wires new widgets to record inputs when there are some', () => {
    const params = [
      { id: 'row', type: 'record' },
      { id: 'rows', type: 'recordset' },
    ];
    expect(newWidget('text', []).data).toEqual({ markdown: '' });
    expect(newWidget('fields', params).data).toEqual({ source: { parameter: 'row' } });
    expect(newWidget('SQL', params).data).toEqual({ source: { parameter: 'rows' } });
    expect(newWidget('fields', [], 'q').data).toEqual({ source: { queryId: 'q' } });
    expect(newWidget('SQL', [], 'q').data).toEqual({ sql: { queryId: 'q' } });
    expect(newWidget('chart', [], 'q').name).toBe('SQL');
  });
});

describe('query parameter bindings', () => {
  it('reads the choice and the fixed value', () => {
    const b = [{ id: 'a', boardParameterId: 'cust' }, { id: 'b', value: 5 }];
    expect(bindingChoice(b, 'a')).toBe('p:cust');
    expect(bindingChoice(b, 'b')).toBe('v');
    expect(bindingChoice(b, 'c')).toBe('');
    expect(bindingValue(b, 'b')).toBe('5');
    expect(bindingValue(b, 'a')).toBe('');
  });
  it('sets, replaces and clears a binding with typed values', () => {
    let b = withBinding([], 'a', 'p:cust');
    expect(b).toEqual([{ id: 'a', boardParameterId: 'cust' }]);
    b = withBinding(b, 'a', 'v', '12', 'integer');
    expect(b).toEqual([{ id: 'a', value: 12 }]);
    b = withBinding(b, 'f', 'v', 'true', 'boolean');
    expect(b).toContainEqual({ id: 'f', value: true });
    b = withBinding(b, 's', 'v', 'text');
    expect(b).toContainEqual({ id: 's', value: 'text' });
    expect(withBinding(b, 'a', '').find((x) => x.id === 'a')).toBeUndefined();
  });
});

describe('fields text', () => {
  it('round-trips Column = Label lines', () => {
    const fields = textToFields('Name = Full name\n\n City \n=\nAge=Years = old');
    expect(fields).toEqual([
      { column: 'Name', label: 'Full name' },
      { column: 'City' },
      { column: 'Age', label: 'Years = old' },
    ]);
    expect(fieldsToText(fields)).toBe('Name = Full name\nCity\nAge = Years = old');
    expect(textToFields('   ')).toBeUndefined();
    expect(fieldsToText(undefined)).toBe('');
  });
});
